import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {parseConfig} from '../suno/audio/config.mjs';
import {autoChunkPlan,normalizeUploadConstraints,encodedWavBytes,planForCuts,chunkSummary,technicalChunkFailure,actualBoundaryRegion,needsSeamMitigation,assertUploadPlan} from '../suno/audio/chunk-strategy.mjs';
import {wav,readPCM,sha256} from '../suno/audio/pcm.mjs';
import {buildTimeline,timelineReport} from '../suno/audio/timeline.mjs';
import {calibrationPlan,sourceFingerprint} from '../suno/audio/calibration.mjs';
import {analyzeBoundaries,writeAnalysis,qualityGate} from '../suno/audio/boundaries.mjs';
import {summarizeQuality,QUALITY_THRESHOLDS} from '../suno/audio/quality.mjs';
import {inspectSaveSerializedState} from '../suno/studio/state-boundaries.mjs';
import {runPipeline} from '../scripts/studio-pipeline.mjs';
import {uploadSlice} from '../suno/audio/upload.mjs';
import {SunoBridge} from '../suno/bridge/client.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json',import.meta.url)));
const constraints=(max=480,bytes=null)=>normalizeUploadConstraints({min:6,max,maxUploadBytes:bytes});
function signal(seconds=36,rate=8000,channels=1){const frames=Math.round(seconds*rate),data=Buffer.alloc(frames*channels*4);for(let i=0;i<frames;i++)for(let c=0;c<channels;c++)data.writeFloatLE(.2*Math.sin(i/rate*2*Math.PI*(233+c*70)),(i*channels+c)*4);return{tag:3,bits:32,channels,blockAlign:channels*4,sampleRate:rate,frames,data};}
test('CLI defaults to auto; explicit auto and legacy numeric cuts remain valid',()=>{
  assert.equal(parseConfig(['x.mp3'])['chunk-seconds'],'auto');assert.equal(parseConfig(['x.mp3','--chunk-seconds=auto'])['chunk-seconds'],'auto');assert.equal(parseConfig(['x.mp3','--chunk-seconds','6'])['chunk-seconds'],6);
  for(const n of ['AUTO','NaN','0','5'])assert.throws(()=>parseConfig(['x.mp3','--chunk-seconds',n]));
});
test('auto minimizes clips from actual inverse PCM duration and encoded format',()=>{
  for(const seconds of [6,91.36,174.96,480]){const p=signal(seconds),plan=autoChunkPlan(p,constraints());assert.equal(plan.length,1);assert.equal(plan[0].readOffsetSeconds,0);assert.equal(plan[0].sourceEnd,p.frames);}
  assert.equal(autoChunkPlan(signal(91.36),constraints(60)).length,2);
  assert.equal(autoChunkPlan(signal(174.96),constraints(60)).length,3);
  assert.throws(()=>autoChunkPlan(signal(5.999),constraints()),/shorter/);
});
test('minimum-count approximately equal partition is gapless and reconstructs every sample',()=>{
  const p=signal(174.960125,8000,2),plan=autoChunkPlan(p,constraints(60));assert.equal(plan.length,3);assert.ok(Math.max(...plan.map(s=>s.end-s.start))-Math.min(...plan.map(s=>s.end-s.start))<=1);
  assert.deepEqual(Buffer.concat(plan.map(s=>readPCM(wav(p,s.start,s.end)).data)),p.data);assert.ok(plan.every(s=>s.durSec>=6&&s.durSec<=60));
  const wire=buildTimeline(fixture,plan.map(s=>({...s,clipId:`c-${s.index}`})),{transpose:-8,title:'auto'}),t=timelineReport(wire,plan,p.sampleRate);assert.equal(t.exactContinuous,true);assert.equal(t.boundariesSeconds.length,2);assert.ok(t.arrangements.every(a=>a.fadeIn===0&&a.fadeOut===0&&a.amplitude===1));
});
test('actual WAV size, odd RIFF padding and channels can increase the minimum count',()=>{
  const p=signal(30,8000,2),limit=encodedWavBytes(p,15*p.sampleRate);assert.equal(autoChunkPlan(p,constraints(480,limit)).length,2);
  assert.equal(autoChunkPlan({...p,channels:1,blockAlign:4,data:p.data.subarray(0,p.frames*4)},constraints(480,limit)).length,1);
  const odd={...signal(6),bits:24,tag:1,blockAlign:3,data:Buffer.alloc(48000*3)};assert.equal(encodedWavBytes(odd,1),48);
  assert.throws(()=>autoChunkPlan(p,constraints(480,100)),/No allowed/);
});
test('handles fit verified source capacity, never create a subminimum tail or overlap',()=>{
  const p=signal(120),limits=constraints(60),exact=autoChunkPlan(p,limits);assert.equal(exact.length,2);
  const handles=autoChunkPlan(p,limits,{prerollMs:50,postrollMs:200});assert.equal(handles.length,3);assertUploadPlan(p,handles,limits);assert.equal(handles[1].readOffsetSeconds,.05);assert.equal(handles.at(-1).end,p.frames);
  for(let i=1;i<handles.length;i++)assert.equal(handles[i].start,handles[i-1].end);
  assert.equal(autoChunkPlan(signal(30),limits,{prerollMs:500,postrollMs:200})[0].sourceDurationSeconds,30);
});
test('only definite technical failure allows a new partition; policy/auth/rate/unknown failures stop',()=>{
  assert.equal(technicalChunkFailure({status:413,message:'Payload too large'}).reason,'size');assert.equal(technicalChunkFailure({kind:'technical_upload_constraint',constraintReason:'transfer'}).reason,'transfer');
  for(const e of [{status:413,message:'catalog match'},{kind:'technical_upload_constraint',constraintReason:'duration',message:'copyright policy'},{status:403,message:'permission'},{status:429},{kind:'timeout'},{status:500},{message:'Unknown processing error'}])assert.equal(technicalChunkFailure(e),null);
});
test('seam mitigation uses only actual internal boundary metrics, not unrelated EOF or duration warnings',()=>{
  assert.equal(needsSeamMitigation({boundaryCount:0,anomalyCount:1}),false);assert.equal(needsSeamMitigation({boundaryCount:2,anomalyCount:0,internalSilentGapCount:0,clippingCandidateCount:0,maxScore:2,averageScore:1,durationErrorMs:150}),false);
  for(const q of [{anomalyCount:1},{internalSilentGapCount:1},{maxScore:7},{averageScore:4}])assert.equal(needsSeamMitigation({boundaryCount:2,...q}),true);
});
test('short calibration aligns with a measured real production cut instead of fabricated six-second cuts',()=>{
  const p=signal(174.96),full=autoChunkPlan(p,constraints(60)),cut=full[2].startSec,region=actualBoundaryRegion(p,full,{boundaries:[{timestamp:cut,score:40}]});assert.equal(region.actualProductionBoundarySeconds,cut);assert.equal(region.duration,24);assert.equal(region.logicalBoundaryCount,1);
  const plan=calibrationPlan(p,full,region,{prerollMs:50,postrollMs:200});assert.equal(plan.length,2);assert.equal(plan[1].startSec,12);assert.equal(plan[1].sourceStart,full[2].start-400);assert.equal(plan[1].localHash,sha256(wav(p,plan[1].sourceStart,plan[1].sourceEnd)));
});
test('calibration fingerprint changes with actual cuts and count even if the CLI is still auto',()=>{
  const p=signal(36),c=parseConfig(['x.wav']),a={...c,chunkSelection:chunkSummary(p,autoChunkPlan(p,constraints()),constraints())},b={...c,chunkSelection:chunkSummary(p,autoChunkPlan(p,constraints(18)),constraints(18))};assert.notEqual(sourceFingerprint('same',p,a).sourceFingerprint,sourceFingerprint('same',p,b).sourceFingerprint);
});
test('logical cut hash stays stable with handles while upload geometry/content hash changes',()=>{const p=signal(40),limits=constraints(24),exact=autoChunkPlan(p,limits),handles=planForCuts(p,[0,exact[0].end,p.frames],{prerollMs:50,postrollMs:200}),a=chunkSummary(p,exact,limits),b=chunkSummary(p,handles,limits);assert.equal(a.planHash,b.planHash);assert.notEqual(a.uploadPlanHash,b.uploadPlanHash);assert.notEqual(exact[1].localHash,handles[1].localHash);});
test('short calibration reserves source capacity for the largest candidate handles',()=>{const p=signal(36),limits=constraints(12),full=autoChunkPlan(p,limits),region=actualBoundaryRegion(p,full,null,limits);const plan=calibrationPlan(p,full,region,{prerollMs:500,postrollMs:200});assertUploadPlan(p,plan,limits);assert.equal(plan.length,2);});
async function harness(seconds=36,{max=480,failCounts=[],seamFailure=false,interrupt=false}={}){
  const dir=await mkdtemp(join(tmpdir(),'suno-auto-chunk-')),p=signal(seconds),input=join(dir,'input.wav');await writeFile(input,wav(p));const run=join(dir,'run');await mkdir(run);
  const states=new Map(),renders=new Map(),counts=[],qaCalls=[];let creates=0,renderCount=0,uploadCount=0;
  const client={create_project:async()=>({id:`project-${++creates}`}),save_project:async q=>{states.set(q.project_id,inspectSaveSerializedState(q.state));return{version_id:`version-${q.project_id}`};},get_project_version:async id=>({state:states.get(id)}),render_project:async q=>{const id=`render-${++renderCount}`;renders.set(id,q);return{id};}};
  const bridge={call:async q=>{assert.equal(q.method,'GET');if(q.path.startsWith('/api/clip/')){const id=q.path.split('/').at(-1),r=renders.get(id);return{result:{id,status:'complete',metadata:{studio_project_id:r.project_id,studio_project_version_id:r.studio_project_version_id,studio_project_start_beats:0,studio_project_end_beats:r.end_beats,duration:r.end_beats/1.95}}};}if(q.path.startsWith('/api/download/clip/'))return{result:{status:'ready',download_url:'https://downloads.s3.amazonaws.com/test.m4a'}};throw Error('Unexpected API call');}};
  const upload=async(bridge,s,file,record,checkpoint)=>{const n=Number(/AUTO_\d+_(\d+)_/.exec(file)?.[1]??0);if(s.index===0&&n&&!counts.includes(n))counts.push(n);if(failCounts.includes(n))throw Object.assign(Error('WAV too large'),{status:413});uploadCount++;const result={...s,clipId:`source-${s.localHash}`,status:'complete',stages:{}};await checkpoint(result);return result;};
  const qa=async q=>{qaCalls.push(basename(q.directory));if(interrupt){interrupt=false;throw Error('QA interrupted');}const start=Math.round((q.sourceOffsetSeconds??0)*p.sampleRate),part=readPCM(wav(p,start,Math.min(p.frames,start+Math.round(q.expectedDuration*p.sampleRate)))),analysis=analyzeBoundaries(part,q.times);analysis.duration=q.expectedDuration+.0135;const gate=qualityGate(analysis,q.expectedDuration,q.expectedDuration);
    if(seamFailure&&q.directory.endsWith('PRODUCTION_EXACT_PROBE')){analysis.detectedAnomalyCount=1;gate.status='QUALITY WARNING';}
    await writeAnalysis(join(q.directory,'diagnostics'),analysis,part,false);return{analysis,gate,qualitySummary:{...summarizeQuality(analysis,gate),remoteProbeMode:'RANGE',qualityProbeMs:1,deliveryInfo:{formatName:'m4a',codec:'opus'}}};};
  const config=parseConfig([input,'--studio-speed','1','--preprocessed',input,'--upload-concurrency','1']);await writeFile(join(run,'config.json'),JSON.stringify(config));
  const deps={client,bridge,qa,uploadSlice:upload,uploadConstraints:constraints(max),calibrationCacheDir:join(dir,'calibration-cache')};
  return{dir,run,input,deps,counts,qaCalls,stats:()=>({creates,renderCount,uploadCount}),cleanup:async()=>rm(dir,{recursive:true,force:true})};
}
test('daily single-clip production skips calibration and all handles even with explicit pre-roll override',async()=>{
  const h=await harness();try{const config=JSON.parse(await readFile(join(h.run,'config.json')));config.strategy='preroll';config['preroll-ms']=300;await writeFile(join(h.run,'config.json'),JSON.stringify(config));const r=await runPipeline(parseConfig(['--resume',h.run]),h.deps);assert.equal(r.clipCount,1);assert.equal(r.internalBoundaryCount,0);assert.equal(r.strategy,'exact');assert.equal(r.preRollMs,0);assert.equal(r.postRollMs,0);assert.equal(r.calibration.status,'SKIPPED_NO_INTERNAL_BOUNDARIES');assert.equal(r.calibration.candidatesTested,0);assert.equal(h.stats().creates,1);assert.deepEqual(h.qaCalls,['PRODUCTION']);assert.equal(r.downloaded,false);await assert.rejects(access(join(h.run,'preprocessed.wav')));const wire=JSON.parse(await readFile(join(h.run,'PRODUCTION','studio-state-before-save.json')));assert.equal(wire.tracks[0].clips[0].readStartBeats,0);}finally{await h.cleanup();}
});
test('multi-clip exact PASS uses just one real render and no mitigation calibration',async()=>{
  const h=await harness(36,{max:18});try{const r=await runPipeline(parseConfig(['--resume',h.run]),h.deps);assert.equal(r.clipCount,2);assert.equal(r.internalBoundaryCount,1);assert.equal(r.strategy,'exact');assert.equal(r.calibration.status,'EXACT_PRODUCTION_QA');assert.equal(h.stats().creates,1);assert.equal(h.stats().renderCount,1);assert.equal(h.qaCalls.filter(x=>x.startsWith('CALIBRATION')).length,0);assert.equal(r.detectedAnomalyCount,0);}finally{await h.cleanup();}
});
test('minimum successful count fallback tries 1 then 2 then 3 without fixed six-second slices',async()=>{
  const h=await harness(36,{failCounts:[1,2]});try{const r=await runPipeline(parseConfig(['--resume',h.run]),h.deps);assert.deepEqual(h.counts,[1,2,3]);assert.equal(r.clipCount,3);assert.equal(r.chunkSelection.uploadBytes.length,3);assert.equal(r.chunkSelection.cuts[1],12*8000);assert.equal(h.stats().creates,1);}finally{await h.cleanup();}
});
test('content rejection never changes clip count or submits a project',async()=>{
  const h=await harness();try{h.deps.uploadSlice=async()=>{throw Object.assign(Error('Recording catalog match'),{kind:'technical_upload_constraint',constraintReason:'duration'});};await assert.rejects(runPipeline(parseConfig(['--resume',h.run]),h.deps),/catalog match/);assert.equal(h.stats().creates,0);assert.equal(JSON.parse(await readFile(join(h.run,'chunk-selection.json'))).clipCount,1);await access(join(h.run,'preprocessed.wav'));}finally{await h.cleanup();}
});
test('actual exact seam failure triggers shortest-handle search, then full production boundary QA',async()=>{
  const h=await harness(40,{max:24,seamFailure:true});let cache;
  try{const r=await runPipeline(parseConfig(['--resume',h.run]),h.deps);assert.equal(r.strategy,'preroll');assert.equal(r.preRollMs,50);assert.equal(r.clipCount,2);assert.equal(r.calibration.candidatesTested,1);assert.equal(r.calibration.region.logicalBoundaryCount,1);assert.equal(h.stats().creates,3);assert.equal(h.qaCalls.filter(x=>/^CALIBRATION_.*_0$/.test(x)).length,0);assert.equal(h.qaCalls.filter(x=>/^CALIBRATION_.*_50$/.test(x)).length,1);assert.equal(r.internalBoundaryCount,1);}finally{await h.cleanup();}
});
test('single-clip render-before-QA resume preserves bound render and uploads',async()=>{
  const h=await harness(36,{interrupt:true});try{await assert.rejects(runPipeline(parseConfig(['--resume',h.run]),h.deps),/QA interrupted/);const first=h.stats();const r=await runPipeline(parseConfig(['--resume',h.run]),h.deps);assert.equal(h.stats().creates,first.creates);assert.equal(h.stats().renderCount,first.renderCount);assert.equal(h.stats().uploadCount,first.uploadCount);assert.equal(r.clipCount,1);assert.equal(r.calibration.candidatesTested,0);}finally{await h.cleanup();}
});
test('mitigation cache is reused only after the new full exact production QA has failed',async()=>{
  const h=await harness(40,{max:24,seamFailure:true});try{const first=await runPipeline(parseConfig(['--resume',h.run]),h.deps);const next=join(h.dir,'next');await mkdir(next);const config=JSON.parse(await readFile(join(h.run,'config.json')));await writeFile(join(next,'config.json'),JSON.stringify(config));const result=await runPipeline(parseConfig(['--resume',next]),h.deps);assert.equal(result.strategy,'preroll');assert.equal(result.calibration.cacheHit,true);assert.equal(result.calibration.candidatesTested,0);assert.equal(h.qaCalls.filter(x=>x==='PRODUCTION_EXACT_PROBE').length,2);assert.equal(result.calibration.sourceFingerprint,first.calibration.sourceFingerprint);}finally{await h.cleanup();}
});
test('auto dry-run uses the actual PCM and does zero network dispatches',async()=>{
  const h=await harness();try{const fail=()=>{throw Error('Network forbidden');};const r=await runPipeline(parseConfig(['--resume',h.run,'--dry-run']),{bridge:{call:fail},client:{create_project:fail},uploadConstraints:constraints()});assert.equal(r.networkWrites,0);assert.equal(r.clipCount,1);assert.equal(r.internalBoundaryCount,0);assert.equal(r.chunkStrategy,'AUTO_CHUNK');}finally{await h.cleanup();}
});
test('fresh read-only upload constraints can reduce an unbound offline plan back to one clip',async()=>{
  const h=await harness(36,{max:18});try{const p=signal(36),old=chunkSummary(p,autoChunkPlan(p,constraints(18)),constraints(18));await writeFile(join(h.run,'chunk-selection.json'),JSON.stringify(old));const original=h.deps.bridge;const bridge=new SunoBridge({base:'http://127.0.0.1:3000',key:'offline-test-key',allow_verified_studio_writes:true});let reads=0;bridge.call=async q=>{if(q.path==='/api/billing/info/'){reads++;assert.equal(q.method,'GET');return{result:{audio_upload_limits:{min:6,max:480}}};}return original.call(q);};h.deps.bridge=bridge;h.deps.sharedUploadCache=false;delete h.deps.uploadConstraints;const r=await runPipeline(parseConfig(['--resume',h.run]),h.deps);assert.equal(reads,1);assert.equal(r.clipCount,1);assert.equal(r.calibration.candidatesTested,0);assert.equal(h.stats().creates,1);}finally{await h.cleanup();}
});
test('an in-flight content rejection outranks a simultaneous technical failure; no repartition',async()=>{
  const h=await harness(36,{max:18});try{const c=JSON.parse(await readFile(join(h.run,'config.json')));c['upload-concurrency']=2;await writeFile(join(h.run,'config.json'),JSON.stringify(c));h.deps.uploadSlice=async(bridge,s)=>{if(s.index===0)throw Object.assign(Error('Payload too large'),{status:413});await new Promise(r=>setTimeout(r,5));throw Error('Recording catalog match');};await assert.rejects(runPipeline(parseConfig(['--resume',h.run]),h.deps),/catalog match/);assert.equal(h.stats().creates,0);assert.equal(JSON.parse(await readFile(join(h.run,'chunk-selection.json'))).clipCount,2);}finally{await h.cleanup();}
});
test('size fallback cannot exceed the minimum-duration partition bound; failure artifacts remain',async()=>{
  const h=await harness(12,{failCounts:[1,2]});try{await assert.rejects(runPipeline(parseConfig(['--resume',h.run]),h.deps),/No allowed/);assert.deepEqual(h.counts,[1,2]);assert.equal(h.stats().creates,0);assert.equal(JSON.parse(await readFile(join(h.run,'chunk-selection.json'))).attempts.length,2);await access(join(h.run,'preprocessed.wav'));}finally{await h.cleanup();}
});
test('signed S3 policy rejects oversize WAV before any bytes transfer and exposes only safe capacity',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-policy-')),p=signal(6),s=autoChunkPlan(p,constraints())[0],file=join(dir,'s.wav');await writeFile(file,wav(p));let calls=0;
  try{const bridge={call:async()=>{calls++;return{result:{id:'slot',url:'https://downloads.s3.amazonaws.com/',fields:{policy:Buffer.from(JSON.stringify({conditions:[['content-length-range',0,1000]]})).toString('base64')}}};}};await assert.rejects(uploadSlice(bridge,s,file,null,async()=>{},async()=>{}),e=>e.kind==='technical_upload_constraint'&&e.maxUploadBytes===1000);assert.equal(calls,1);}finally{await rm(dir,{recursive:true,force:true});}
});
