import {libraryExportFixture} from './helpers/library-export-fixture.mjs';
const runPipeline=(config,deps={})=>productionPipeline(config,libraryExportFixture(deps));
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPCM, wav, slicePlan, sha256, verifyAlignment } from '../suno/audio/pcm.mjs';
import { analyzeBoundaries, classifyABC, silentGaps } from '../suno/audio/boundaries.mjs';
import { buildTimeline, timelineReport, semanticDiff, chooseHandleStrategy } from '../suno/audio/timeline.mjs';
import { boundedMap, resumableSlice, retry429, retryDelay, uploadSlice, retryS3Transfer } from '../suno/audio/upload.mjs';
import { parseConfig } from '../suno/audio/config.mjs';
import { runPipeline as productionPipeline } from '../scripts/studio-pipeline.mjs';
import privacy from '../shared/privacy.cjs';
import { inspectSaveSerializedState } from '../suno/studio/state-boundaries.mjs';
import {qualityFromDelivery} from '../suno/audio/remote-qa.mjs';
import { estimateSliceGains } from '../suno/audio/gain.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json', import.meta.url), 'utf8'));
function signal(seconds = 20, channels = 2, rate = 8000) {
  const frames = Math.round(seconds * rate), data = Buffer.alloc(frames * channels * 4);
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) data.writeFloatLE(.2 * Math.sin(i / rate * 2 * Math.PI * (230 + ch * 70)), (i * channels + ch) * 4);
  return { frames, channels, sampleRate: rate, tag: 3, bits: 32, blockAlign: channels * 4, data };
}
async function offlineQA(options){
  const p=options.sourcePCM,start=Math.round((options.sourceOffsetSeconds??0)*p.sampleRate),end=start+Math.round(options.expectedDuration*p.sampleRate),bytes=wav(p,start,Math.min(p.frames,end));
  return qualityFromDelivery(options,{probe:async()=>({sampleRate:p.sampleRate,channels:p.channels,codec:'pcm_f32le',duration:options.expectedDuration}),fetch:async()=>new Response(bytes),window:async()=>{throw Error('offline seek fallback');},download:async(url,file)=>{await writeFile(file,bytes);return file;}});
}
test('sample slicing handles mono/stereo/multichannel, non-48k, short tail, RIFF padding and bit-exact reconstruction', () => {
  for (const channels of [1,2,6]) {
    const p = signal(2.017, channels, 44100), parsed = readPCM(wav(p)); assert.equal(parsed.frames, p.frames);
    const plan = slicePlan(parsed, {chunkSeconds:.7}); assert.equal(plan.at(-1).end, p.frames);
    const joined = Buffer.concat(plan.map(s => readPCM(wav(parsed, s.sourceStart, s.sourceEnd)).data)); assert.deepEqual(joined, p.data);
    assert.equal(plan[1].start, plan[0].end);
  }
  const p = {tag:1,channels:1,sampleRate:8000,bits:24,blockAlign:3,frames:1,data:Buffer.from([0,0,0])}; assert.equal(readPCM(wav(p)).frames,1);
  assert.throws(() => readPCM(wav(p).subarray(0, 44)), /Truncated/);
});
test('absolute sample placement has zero gaps, zero fade, exact fractional render duration; handles change source read offset only', () => {
  const p = signal(18.012,2,44100), plan = slicePlan(p,{chunkSeconds:6,prerollMs:300,postrollMs:200}).map(s=>({...s,clipId:`clip-${s.index}`}));
  const wire = buildTimeline(fixture,plan,{transpose:-8,title:'test'}), report = timelineReport(wire,plan,p.sampleRate);
  assert.equal(report.exactContinuous,true); assert.equal(report.gaps[0].estimatedSourceSamples,0);
  assert.equal(report.arrangements[1].readStartBeats,.3*1.95);
  assert.ok(Math.abs(report.expectedTimelineSeconds-p.frames/p.sampleRate)<1e-12);
  assert.ok(report.arrangements.every(c=>c.fadeIn===0&&c.fadeOut===0));
  wire.tracks[0].clips[1].startBeats+=1.95/p.sampleRate;
  const bad=timelineReport(wire,plan,p.sampleRate); assert.equal(bad.exactContinuous,false); assert.ok(Math.abs(bad.gaps[0].estimatedSourceSamples-1)<1e-9);
  assert.throws(()=>buildTimeline(fixture,plan,{transpose:-8,title:'test',strategy:'crossfade'}),/not verified/);
});
test('observed six-second upload minimum merges a short tail without changing source samples, duration or handles math',()=>{
  const p=signal(174.96,2,44100),plan=slicePlan(p,{chunkSeconds:6,minimumSliceSeconds:6});
  assert.equal(plan.length,29);assert.equal(plan.at(-1).startSec,168);assert.equal(plan.at(-1).durSec,6.96);
  assert.ok(plan.every(s=>s.durSec>=6));assert.deepEqual(Buffer.concat(plan.map(s=>readPCM(wav(p,s.start,s.end)).data)),p.data);
  const wire=buildTimeline(fixture,plan.map(s=>({...s,clipId:`merged-${s.index}`})),{transpose:-8,title:'merged'});
  assert.equal(timelineReport(wire,plan,p.sampleRate).exactContinuous,true);
  const h=slicePlan(p,{chunkSeconds:6,minimumSliceSeconds:6,prerollMs:300,postrollMs:200});assert.equal(h.at(-1).readOffsetSeconds,.3);assert.equal(h.at(-1).end,plan.at(-1).end);
  for(const seconds of [6,12,18])assert.equal(slicePlan(signal(seconds),{minimumSliceSeconds:6}).length,seconds/6);
  assert.throws(()=>slicePlan(signal(5.99),{minimumSliceSeconds:6}),/shorter/);
  assert.throws(()=>slicePlan(p,{chunkSeconds:5,minimumSliceSeconds:6}),/minimum/);
});
test('bounded uploads never exceed workers and return input ordering despite completion order',async()=>{
  let active=0,max=0;const completed=[];
  const out=await boundedMap([0,1,2,3,4,5],3,async i=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10*(3-i%3)));active--;completed.push(i);return i;});
  assert.equal(max,3);assert.deepEqual(out,[0,1,2,3,4,5]);assert.notDeepEqual(completed,out);
});
test('worker failure drains in-flight checkpoints before rejecting',async()=>{
  let completed=false;const started=[];await assert.rejects(boundedMap([0,1,2],2,async i=>{started.push(i);await new Promise(r=>setTimeout(r,i===0?5:15));if(i===0)throw Error('fail');completed=true;}),/fail/);
  assert.equal(completed,true);assert.deepEqual(started,[0,1]);
});
test('resume requires content hash AND logical/source mapping',()=>{
  const s=slicePlan(signal())[1],r={...s,clipId:'x',status:'complete'};
  assert.equal(resumableSlice(r,s),true);assert.equal(resumableSlice({...r,localHash:'changed'},s),false);assert.equal(resumableSlice({...r,start:r.start+1},s),false);
});
test('handle alignment accepts identical trim but rejects an offset larger than tolerance',()=>{
  const p=signal(18),q={...p,data:Buffer.from(p.data)};
  // Nonstationary envelope disambiguates a periodic sine's many correlation peaks.
  for(let i=0;i<p.frames;i++)for(let c=0;c<p.channels;c++)p.data.writeFloatLE(p.data.readFloatLE(i*p.blockAlign+c*4)*(.5+.4*Math.sin(i/p.sampleRate*3.789)),i*p.blockAlign+c*4);
  q.data=Buffer.from(p.data);assert.equal(verifyAlignment(p,q,[7,13]).passed,true);
  const shift=Math.round(.1*p.sampleRate);q.data.fill(0);p.data.copy(q.data,shift*p.blockAlign,0,p.data.length-shift*p.blockAlign);
  const result=verifyAlignment(p,q,[7,13]);assert.equal(result.passed,false);assert.ok(result.checks.every(c=>Math.abs(c.lagMs-100)<.1));
});
test('upload resume retains initialized clip and retries only metadata, no slot/finish/initialize',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-upload-'));try{
    const p=signal(1),s=slicePlan(p)[0],file=join(dir,'slice.wav');await writeFile(file,wav(p));
    const calls=[],bridge={call:async c=>{calls.push(c);return {result:{}};}};
    const result=await uploadSlice(bridge,s,file,{...s,clipId:'clip1',uploadId:'upload1',status:'initialized',stages:{}},async()=>{},async()=>{});
    assert.equal(result.status,'complete');assert.deepEqual(calls.map(c=>c.path),['/api/gen/clip1/set_metadata/']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Retry-After, exponential jitter, max retry, no retry of unknown writes',async()=>{
  assert.equal(retryDelay({retryAfter:'2'},0),2000);assert.equal(retryDelay({retryAfter:'Thu, 01 Jan 1970 00:00:03 GMT'},0,()=>.5,1000),2000);
  assert.equal(retryDelay({},3,()=>.5),8000);
  let n=0,waits=[];await retry429(async()=>{if(n++<2)throw Object.assign(Error('rate'),{status:429,retryAfter:'0'});return 1;},{wait:async ms=>waits.push(ms)});assert.equal(n,3);assert.deepEqual(waits,[0,0]);
  n=0;await assert.rejects(retry429(async()=>{n++;throw Object.assign(Error('unknown'),{status:504});}));assert.equal(n,1);
});
test('transient S3 byte-transfer retry is bounded and never handles rejection or 429 as an unknown write retry',async()=>{
  let calls=0;const waits=[];await retryS3Transfer(async()=>{if(calls++<2)throw TypeError('fetch failed');return true;},{wait:async ms=>waits.push(ms)});assert.equal(calls,3);assert.deepEqual(waits,[500,1000]);
  calls=0;await assert.rejects(retryS3Transfer(async()=>{calls++;throw TypeError('fetch failed');},{wait:async()=>{}}));assert.equal(calls,3);
  for(const status of [403,429]){calls=0;await assert.rejects(retryS3Transfer(async()=>{calls++;throw Object.assign(Error('rejected'),{status});},{wait:async()=>{}}));assert.equal(calls,1);}
});
test('detector compares normal controls; injected impulse detected, clean high derivative sine not a click',()=>{
  const p=signal(),times=[6,12,18],clean=analyzeBoundaries(p,times);assert.equal(clean.detectedAnomalyCount,0);assert.equal(clean.baselineCount,128);
  p.data.writeFloatLE(.98,6*p.sampleRate*p.blockAlign); const bad=analyzeBoundaries(p,times);assert.ok(bad.boundaries[0].findings.some(f=>f.metric==='sample_discontinuity_candidate'));
  assert.equal(bad.boundaries[0].windows.ms500.endSample-bad.boundaries[0].windows.ms500.startSample,p.sampleRate);
  const a={...clean,responseValidated:true},b={...bad,responseValidated:true};assert.equal(classifyABC(a,b,a),'LIKELY_PER_CLIP_DSP_RESET');assert.equal(classifyABC(b,b,a),'INVESTIGATE_TIMELINE_CUT_WARP_PLACEMENT');
});
test('silent gap and clipping metrics measured across all channels',()=>{
  const p=signal();p.data.fill(0,7*p.sampleRate*p.blockAlign,7.1*p.sampleRate*p.blockAlign);assert.ok(silentGaps(p).some(g=>g.start===7));
  for(let i=0;i<20;i++)p.data.writeFloatLE(1.01,6*p.sampleRate*p.blockAlign+i*p.blockAlign+4);
  const a=analyzeBoundaries(p,[6]);assert.ok(a.boundaries[0].features.clippedSamples>2);assert.ok(a.boundaries[0].findings.some(f=>f.metric==='clipping'));
});
test('semantic diff ignores independent identities/UI, preserves warp/playback changes and correlation',()=>{
  const p=signal(),s=slicePlan(p).map(s=>({...s,clipId:`source-${s.index}`}));const a=buildTimeline(fixture,s,{title:'a',transpose:-8}),b=buildTimeline(fixture,s,{title:'b',transpose:-8});
  assert.equal(semanticDiff(a,b).changes.length,0);b.tracks[0].clips[0].readStartBeats=1;assert.ok(semanticDiff(a,b).changes.some(d=>d.path.endsWith('readStartBeats')));
  assert.equal(semanticDiff(fixture.state,a).historicalWarpCorrelation.allMatch,true);
});
test('CLI validates concurrency/ranges/options and resume can omit input',()=>{
  assert.equal(parseConfig(['x.wav','--upload-concurrency','4','--diagnose']).diagnose,true);assert.equal(parseConfig(['--resume','runs/x']).input,undefined);
  for(const args of [['x.wav','--upload-concurrency','0'],['x.wav','--chunk-seconds','NaN'],['x.wav','--strategy','magic'],['x.wav','--unknown'],['x.wav','--output'],['x.wav','--output','out.mp3'],['x.wav','--handle-test'],['x.wav','--abc-test-only'],['x.wav','--handle-clip-count','2.5']])assert.throws(()=>parseConfig(args));
});
test('handle selection requires measured alignment, mean/max improvement and duration; prefers the shortest equally clean qualifying handle',()=>{
  const baseline={averageBoundaryScore:20,maxBoundaryScore:50,detectedAnomalyCount:3,duration:42};
  const tests=[{...baseline,prerollMs:500,averageBoundaryScore:1,maxBoundaryScore:3,detectedAnomalyCount:0},{...baseline,prerollMs:50,averageBoundaryScore:2,maxBoundaryScore:4,detectedAnomalyCount:0}];
  assert.equal(chooseHandleStrategy(baseline,tests,true).prerollMs,50);assert.equal(chooseHandleStrategy(baseline,tests,false),null);
  assert.equal(chooseHandleStrategy(baseline,[{...tests[0],maxBoundaryScore:45}],true),null);
  assert.equal(chooseHandleStrategy(baseline,[{...tests[0],duration:41.9}],true),null);
  assert.equal(chooseHandleStrategy(baseline,[{...tests[0],detectedAnomalyCount:4}],true),null);
});
test('explicit gain estimation recovers constant slice multipliers; silence, variable gain and unrelated signals are rejected',()=>{
  const reference=signal(12),slices=slicePlan(reference),rendered={...reference,data:Buffer.from(reference.data)};
  for(let i=0;i<reference.frames;i++)for(let c=0;c<reference.channels;c++)rendered.data.writeFloatLE(reference.data.readFloatLE(i*reference.blockAlign+c*4)*(i<6*reference.sampleRate?2:.5),i*reference.blockAlign+c*4);
  const result=estimateSliceGains(reference,rendered,slices);assert.equal(result.passed,true);assert.ok(Math.abs(result.estimates[0].amplitude-.5)<1e-7);assert.ok(Math.abs(result.estimates[1].amplitude-2)<1e-7);
  const wire=buildTimeline(fixture,slices.map((s,i)=>({...s,clipId:`gain-${i}`,amplitude:result.estimates[i].amplitude})),{title:'gain',transpose:0});
  const timeline=timelineReport(wire,slices,reference.sampleRate);assert.equal(timeline.exactContinuous,true);assert.ok(timeline.arrangements.every(c=>c.fadeIn===0&&c.fadeOut===0));
  const quiet={...reference,data:Buffer.alloc(reference.data.length)};assert.equal(estimateSliceGains(quiet,quiet,slices).passed,false);
  for(let i=0;i<reference.frames;i++)for(let c=0;c<reference.channels;c++)rendered.data.writeFloatLE(reference.data.readFloatLE(i*reference.blockAlign+c*4)*(1+i/reference.frames),i*reference.blockAlign+c*4);
  assert.equal(estimateSliceGains(reference,rendered,slices).passed,false);
  assert.equal(estimateSliceGains(reference,signal(12,2,8000),slices).passed,true);
  const unrelated=signal(12);for(let i=0;i<unrelated.frames;i++)for(let c=0;c<unrelated.channels;c++)unrelated.data.writeFloatLE(.2*Math.sin(i/8000*2*Math.PI*(413+c*30)),i*unrelated.blockAlign+c*4);
  assert.equal(estimateSliceGains(reference,unrelated,slices).passed,false);
  assert.equal(parseConfig(['x.wav','--gain-test'])['gain-test'],true);assert.equal(parseConfig(['x.wav'])['gain-test'],undefined);
});
test('scoped presigned upload transport preserves operation only; logs, other endpoints and auth always redact',()=>{
  const value={ok:true,status:200,result:{id:'up',url:'https://suno-uploads.s3.amazonaws.com/',fields:{key:'object',AWSAccessKeyId:'public-id',policy:'policy',signature:'SENSITIVE_SIGNATURE'},token:'AUTH_SECRET'}};
  const context={method:'POST',path:'/api/uploads/audio/'};
  assert.equal(privacy.transportResponse(value,context).result.fields.signature,'SENSITIVE_SIGNATURE');
  assert.equal(privacy.transportResponse(value,context).result.token,privacy.MASK);
  assert.equal(privacy.transportResponse(value,{...context,path:'/api/studio/create-project'}).result.fields.signature,privacy.MASK);
  assert.equal(privacy.redact(privacy.transportResponse(value,context)).result.fields.signature,privacy.MASK);
  assert.equal(privacy.transportResponse({...value,result:{...value.result,url:'https://attacker.test/'}},context).result.fields.signature,privacy.MASK);
});
test('dry-run performs zero network including controller and injected clients',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-dry-'));let calls=0;const previous=globalThis.fetch;
  try{const input=join(dir,'input.wav');await writeFile(input,wav(signal(12)));globalThis.fetch=async()=>{calls++;throw Error('network forbidden');};
    const config=parseConfig([input,'--chunk-seconds','6','--studio-speed','1','--preprocessed',input,'--dry-run']); const result=await runPipeline(config,{bridge:{call:()=>{calls++;throw Error('write forbidden');}},client:{create_project:()=>{calls++;throw Error('write forbidden');}}});assert.equal(result.networkWrites,0);assert.equal(calls,0);
    const stored=JSON.parse(await readFile(join(result.work,'config.json'),'utf8'));stored['dry-run']=false;await writeFile(join(result.work,'config.json'),JSON.stringify(stored));
    const resumed=await runPipeline(parseConfig(['--resume',result.work,'--dry-run']));assert.equal(resumed.networkWrites,0);assert.equal(calls,0);
    await rm(result.work,{recursive:true,force:true});
  }finally{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true});}
});
test('official download capability is scoped to ready responses and never exported as signed secrets',()=>{
  const url='https://downloads.s3.amazonaws.com/song.m4a?X-Amz-Signature=SECRET_DOWNLOAD_SIGNATURE';
  const value={ok:true,status:200,result:{status:'ready',download_url:url,token:'SECRET_AUTH'}};
  const context={method:'GET',path:'/api/download/clip/clip1?format=m4a'};
  assert.equal(privacy.transportResponse(value,context).result.download_url,url);
  assert.equal(privacy.transportResponse(value,context).result.token,privacy.MASK);
  assert.ok(!JSON.stringify(privacy.redact(privacy.transportResponse(value,context))).includes('SECRET_DOWNLOAD_SIGNATURE'));
  assert.ok(!JSON.stringify(privacy.transportResponse(value,{...context,method:'POST'})).includes('SECRET_DOWNLOAD_SIGNATURE'));
  assert.ok(!JSON.stringify(privacy.transportResponse({...value,result:{...value.result,download_url:'https://evil.test/?signature=SECRET_DOWNLOAD_SIGNATURE'}},context)).includes('SECRET_DOWNLOAD_SIGNATURE'));
});
test('rejected upload is durable and resume makes zero network calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-reject-'));try{
    const p=signal(1),s=slicePlan(p)[0],file=join(dir,'slice.wav');await writeFile(file,wav(p));let calls=0,saved;
    const bridge={call:async()=>{calls++;return {result:{status:'error',error_type:'upload_failure_match_acrcloud',error_message:'Recording match'}};}};
    await assert.rejects(uploadSlice(bridge,s,file,{...s,status:'processing',uploadId:'existing',stages:{}},async r=>{saved=structuredClone(r);},async()=>{}),/Recording match/);
    assert.equal(saved.status,'rejected');assert.equal(calls,1);
    await assert.rejects(uploadSlice(bridge,s,file,saved,async()=>{},async()=>{}),/Previously rejected/);assert.equal(calls,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('offline production resume keeps project after definite save rejection and render after download failure',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-resume-'));const previous=globalThis.fetch;
  try{
    const p=signal(12.012),input=join(dir,'input.wav');await writeFile(input,wav(p));
    const config=parseConfig([input,'--chunk-seconds','6','--studio-speed','1','--preprocessed',input,'--strategy','exact','--download','--keep-workdir','--output',join(dir,'output.wav')]);
    await writeFile(join(dir,'config.json'),JSON.stringify(config));
    const records=Object.fromEntries(slicePlan(p,{minimumSliceSeconds:6}).map(s=>[s.index,{...s,clipId:`cached-${s.index}`,uploadId:`upload-${s.index}`,status:'complete',stages:{}}]));
    await writeFile(join(dir,'upload-results.json'),JSON.stringify({exact:records}));
    let creates=0,saves=0,renders=0,wire,renderRequest,downloadAvailable=false;
    const client={create_project:async()=>{creates++;return {id:'existing-project'};},save_project:async request=>{saves++;if(saves===1)throw Object.assign(Error('definite save rejection'),{status:429});wire=inspectSaveSerializedState(request.state);return{version_id:'saved-version'};},get_project_version:async()=>({state:wire}),render_project:async request=>{renders++;renderRequest=request;return{id:'existing-render'};}};
    const bridge={call:async request=>{
      if(request.path==='/api/clip/existing-render')return{result:{id:'existing-render',status:'complete',metadata:{studio_project_id:'existing-project',studio_project_version_id:'saved-version',studio_project_start_beats:0,studio_project_end_beats:renderRequest.end_beats,duration:p.frames/p.sampleRate}}};
      if(request.path==='/api/download/clip/existing-render?format=m4a'){if(!downloadAvailable)throw Object.assign(Error('download unavailable'),{status:403});return{result:{status:'ready',download_url:'https://downloads.s3.amazonaws.com/test.m4a'}};}
      throw Error(`Unexpected offline request ${request.path}`);
    }};
    const resume=parseConfig(['--resume',dir]);
    await assert.rejects(runPipeline(resume,{bridge,client,qa:offlineQA}),/definite save rejection/);
    assert.equal(JSON.parse(await readFile(join(dir,'jobs.json'))).PRODUCTION.projectId,'existing-project');
    await assert.rejects(runPipeline(resume,{bridge,client,qa:offlineQA}),/download unavailable/);
    assert.equal(JSON.parse(await readFile(join(dir,'jobs.json'))).PRODUCTION.renderClipId,'existing-render');
    const incomplete=JSON.parse(await readFile(join(dir,'run-status.json')));assert.equal(incomplete.status,'INCOMPLETE');assert.equal(incomplete.studioProjectSaved,true);assert.equal(incomplete.renderSubmitted,true);assert.equal(incomplete.runSuccess,false);assert.equal(incomplete.deliveryResolved,false);
    downloadAvailable=true;globalThis.fetch=async()=>new Response(wav(p));
    const result=await runPipeline(resume,{bridge,client,qa:offlineQA});assert.equal(result.quality,'PASS');assert.equal(creates,1);assert.equal(saves,2);assert.equal(renders,1);
    assert.equal(readPCM(await readFile(result.output)).frames,p.frames);
  }finally{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true});}
});
test('ABC retains completed A/C when B is rejected, and never runs production with incomplete evidence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-abc-')),previous=globalThis.fetch;
  try{
    const p=signal(12),input=join(dir,'input.wav');await writeFile(input,wav(p));
    await writeFile(join(dir,'config.json'),JSON.stringify(parseConfig([input,'--chunk-seconds','6','--studio-speed','1','--preprocessed',input,'--abc-test','--abc-test-only','--keep-workdir'])));
    const records=plan=>Object.fromEntries(plan.map(s=>[s.index,{...s,clipId:`cached-${s.durSec}-${s.index}`,status:'complete',stages:{}}]));
    await writeFile(join(dir,'upload-results.json'),JSON.stringify({exact:records(slicePlan(p,{minimumSliceSeconds:6})),continuous:records(slicePlan(p,{chunkSeconds:12}))}));
    const states=new Map(),requests=new Map();let creates=0,denyB=true;
    const client={create_project:async()=>({id:`project-${++creates}`}),save_project:async r=>{states.set(r.project_id,inspectSaveSerializedState(r.state));return{version_id:`version-${r.project_id}`};},get_project_version:async id=>({state:states.get(id)}),render_project:async r=>{const id=`render-${r.project_id}`;requests.set(id,r);return{id};}};
    const bridge={call:async r=>{
      const id=r.path.split('/')[3]?.split('?')[0];
      if(r.path.startsWith('/api/clip/')){const q=requests.get(id);if(id==='render-project-2'&&denyB)throw Object.assign(Error('B denied'),{status:403});return{result:{id,status:'complete',metadata:{studio_project_id:q.project_id,studio_project_version_id:q.studio_project_version_id,studio_project_start_beats:0,studio_project_end_beats:q.end_beats,duration:12}}};}
      if(r.path.startsWith('/api/download/clip/'))return{result:{status:'ready',download_url:'https://downloads.s3.amazonaws.com/test.m4a'}};
      throw Error('Unexpected network');
    }};
    globalThis.fetch=async()=>new Response(wav(p));
    await assert.rejects(runPipeline(parseConfig(['--resume',dir]),{bridge,client,qa:offlineQA}),/A\/B\/C incomplete/);
    const report=JSON.parse(await readFile(join(dir,'diagnostics','abc-summary.json')));
    assert.deepEqual(report.experiments.map(e=>e.mode),['SLICED_ZERO_TRANSPOSE','CONTINUOUS_NEG8_TRANSPOSE']);assert.deepEqual(report.missing,['SLICED_NEG8_TRANSPOSE']);assert.equal(report.failures[0].status,403);assert.equal(creates,3);
    const jobs=JSON.parse(await readFile(join(dir,'jobs.json')));assert.equal(jobs.PRODUCTION,undefined);assert.ok(Object.values(jobs).every(j=>j.wire.tracks[0].clips.every(c=>c.amplitude===1)));
    denyB=false;const completed=await runPipeline(parseConfig(['--resume',dir]),{bridge,client,qa:offlineQA});assert.equal(completed.diagnosticOnly,true);assert.equal(completed.productionRun,false);assert.equal(creates,3);assert.equal(JSON.parse(await readFile(join(dir,'jobs.json'))).PRODUCTION,undefined);
  }finally{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true});}
});
test('missing render is eventual visibility until timeout; subsequent resume never submits a replacement',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-missing-'));
  try{
    const p=signal(12),input=join(dir,'input.wav');await writeFile(input,wav(p));await writeFile(join(dir,'config.json'),JSON.stringify(parseConfig([input,'--chunk-seconds','6','--studio-speed','1','--preprocessed',input,'--strategy','exact','--keep-workdir'])));
    await writeFile(join(dir,'upload-results.json'),JSON.stringify({exact:Object.fromEntries(slicePlan(p).map(s=>[s.index,{...s,clipId:`cached-${s.index}`,status:'complete',stages:{}}]))}));
    let creates=0,saves=0,renders=0,wire;const bindings=[];
    const client={create_project:async()=>{creates++;return{id:'same-project'};},save_project:async r=>{saves++;wire=inspectSaveSerializedState(r.state);return{version_id:'same-version'};},get_project_version:async()=>({state:wire}),render_project:async r=>{bindings.push([r.project_id,r.studio_project_version_id]);return{id:`missing-${++renders}`};}};
    const bridge={call:async r=>{if(r.path.startsWith('/api/clips/get_songs_by_ids'))return{result:{clips:[]}};if(r.path.startsWith('/api/clip/'))throw Object.assign(Error('Not found'),{status:404});if(r.path.startsWith('/api/download/clip/'))return{result:{ok:false,reason:'invalid_asset'}};throw Error('Unexpected request');}};
    let clock=Date.now();const lifecycle={now:()=>clock,wait:async ms=>{clock+=ms;},playerProbe:async()=>({unavailable:true})};
    await assert.rejects(runPipeline(parseConfig(['--resume',dir,'--render-timeout-seconds','15']),{bridge,client,qa:offlineQA,renderLifecycle:lifecycle}),/Render TIMEOUT/);assert.equal(renders,1);assert.equal(creates,1);assert.equal(saves,1);assert.deepEqual(bindings,[['same-project','same-version']]);
    const job=JSON.parse(await readFile(join(dir,'jobs.json'))).PRODUCTION;assert.equal(job.missingRenderRetryAttempted,undefined);assert.equal(job.renderJobs.length,1);assert.equal(job.renderClipId,'missing-1');assert.equal(job.renderJobs[0].state,'TIMEOUT');
    await assert.rejects(runPipeline(parseConfig(['--resume',dir]),{bridge,client,qa:offlineQA,renderLifecycle:lifecycle}),/Render TIMEOUT/);assert.equal(renders,1);assert.equal(creates,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('resume recovers a queued transport acknowledgement and dispatches no create/save/render/upload writes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-queued-ack-'));
  try{
    const p=signal(12),input=join(dir,'input.wav'),config=parseConfig([input,'--chunk-seconds','6','--studio-speed','1','--preprocessed',input,'--strategy','exact']);
    await writeFile(input,wav(p));await writeFile(join(dir,'config.json'),JSON.stringify(config));
    const slices=slicePlan(p).map(s=>({...s,clipId:`cached-${s.index}`,status:'complete',stages:{}})),wire=buildTimeline(fixture,slices,{transpose:-8,title:'test'}),endBeats=23.4;
    await writeFile(join(dir,'upload-results.json'),JSON.stringify({exact:Object.fromEntries(slices.map(s=>[s.index,s]))}));
    await writeFile(join(dir,'jobs.json'),JSON.stringify({PRODUCTION:{projectId:'project',versionId:'version',phase:'render_submitting',wire}}));
    const metadata={studio_project_id:'project',studio_project_version_id:'version',studio_project_start_beats:0,studio_project_end_beats:endBeats,duration:12};
    await writeFile(join(dir,'last-render-transport-response.json'),JSON.stringify({requestBinding:{projectId:'project',versionId:'version',startBeats:0,endBeats},response:{status:200,result:{id:'acknowledged',status:'queued',metadata}}}));
    const forbidden=async()=>{throw Error('Unexpected write');},client={create_project:forbidden,save_project:forbidden,render_project:forbidden,get_project_version:async()=>({state:wire})};
    const bridge={call:async q=>{assert.equal(q.method,'GET');if(q.path==='/api/clip/acknowledged')return{result:{id:'acknowledged',status:'complete',metadata}};if(q.path.startsWith('/api/download/clip/acknowledged'))return{result:{status:'ready',download_url:'https://downloads.s3.amazonaws.com/render.m4a'}};throw Error('Unexpected request');}};
    const result=await runPipeline(parseConfig(['--resume',dir]),{client,bridge,uploadSlice:forbidden,qa:offlineQA});
    assert.equal(result.renderClipId,'acknowledged');const job=JSON.parse(await readFile(join(dir,'jobs.json'))).PRODUCTION;assert.equal(job.renderJobs.length,1);assert.equal(job.renderJobs[0].id,'acknowledged');assert.equal(job.phase,'complete');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('explicit upload reuse verifies handle source hashes/mapping and uploads no duplicate sources',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-handle-reuse-')),previous=globalThis.fetch;
  try{
    const p=signal(12),input=join(dir,'input.wav'),cache=join(dir,'cache.json');await writeFile(input,wav(p));
    const slices=slicePlan(p,{minimumSliceSeconds:6,prerollMs:300,postrollMs:200}),cached=[];
    for(const s of slices){const file=join(dir,`slice-${s.index}.wav`);await writeFile(file,wav(p,s.sourceStart,s.sourceEnd));cached.push({...s,file,clipId:`cached-handle-${s.index}`,status:'complete'});}
    await writeFile(cache,JSON.stringify(cached));await writeFile(join(dir,'config.json'),JSON.stringify(parseConfig([input,'--chunk-seconds','6','--studio-speed','1','--preprocessed',input,'--strategy','preroll','--preroll-ms','300','--reuse-uploads',cache,'--keep-workdir'])));
    let wire,request;
    const client={create_project:async()=>({id:'project'}),save_project:async r=>{wire=inspectSaveSerializedState(r.state);return{version_id:'version'};},get_project_version:async()=>({state:wire}),render_project:async r=>{request=r;return{id:'render'};}};
    const bridge={call:async r=>{assert.equal(r.method,'GET');if(r.path==='/api/clip/render')return{result:{id:'render',status:'complete',metadata:{studio_project_id:'project',studio_project_version_id:'version',studio_project_start_beats:0,studio_project_end_beats:request.end_beats,duration:12}}};if(r.path==='/api/download/clip/render?format=m4a')return{result:{status:'ready',download_url:'https://downloads.s3.amazonaws.com/test.m4a'}};throw Error(`Duplicate source request ${r.path}`);}};
    globalThis.fetch=async()=>new Response(wav(p));const result=await runPipeline(parseConfig(['--resume',dir]),{bridge,client,qa:offlineQA});assert.equal(result.strategy,'preroll');
    const store=JSON.parse(await readFile(join(dir,'upload-results.json')))['handles-300'];assert.ok(Object.values(store).every(s=>s.reusedFromHashVerifiedEvidence));
    assert.equal(wire.tracks[0].clips[1].readStartBeats,.3*1.95);assert.ok(wire.tracks[0].clips.every(c=>c.amplitude===1&&c.fadeInBeats===0&&c.fadeOutBeats===0));
  }finally{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true});}
});
test('matching-source strategy evidence selects measured handles in dry-run; mismatched evidence makes zero network calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-strategy-'));let work;
  try{
    const p=signal(12),input=join(dir,'input.wav'),calibration=join(dir,'calibration');await writeFile(input,wav(p));
    const {mkdir}=await import('node:fs/promises');await mkdir(join(calibration,'diagnostics'),{recursive:true});
    await writeFile(join(calibration,'source-info.json'),JSON.stringify({preprocessedHash:sha256(wav(p))}));
    await writeFile(join(calibration,'config.json'),JSON.stringify(parseConfig([input,'--chunk-seconds','6'])));
    const baseline={averageBoundaryScore:20,maxBoundaryScore:50,detectedAnomalyCount:3,duration:12},candidate={averageBoundaryScore:1,maxBoundaryScore:3,detectedAnomalyCount:0,duration:12,prerollMs:50};
    await writeFile(join(calibration,'diagnostics','handle-experiment.json'),JSON.stringify({status:'E2E_MEASURED_READ_OFFSETS',selected:50,baseline,tests:[candidate]}));
    await writeFile(join(calibration,'diagnostics','handle-alignment.json'),JSON.stringify({passed:true,checks:[{passed:true,correlation:.99,lagMs:0}]}));
    const forbidden={bridge:{call:()=>{throw Error('network forbidden');}},client:{create_project:()=>{throw Error('network forbidden');}}};
    const result=await runPipeline(parseConfig([input,'--chunk-seconds','6','--studio-speed','1','--preprocessed',input,'--strategy-evidence',calibration,'--dry-run']),forbidden);work=result.work;assert.equal(result.networkWrites,0);
    const timeline=JSON.parse(await readFile(join(work,'diagnostics-local-timeline.json')));assert.equal(timeline.arrangements[1].readStartBeats,.05*1.95);
    await writeFile(join(calibration,'source-info.json'),JSON.stringify({preprocessedHash:'changed'}));
    await assert.rejects(runPipeline(parseConfig(['--resume',work,'--dry-run']),forbidden),/source hash mismatch/);
  }finally{if(work)await rm(work,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});}
});
