import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveRenderDelivery, restoreRenderJobs, rememberRenderSubmission, recoverRenderAcknowledgement, probeObservedPlayer, RENDER_LIFECYCLE } from '../suno/audio/render-lifecycle.mjs';
const sequences=JSON.parse(await readFile(new URL('../fixtures/render_lifecycle_sequences.json',import.meta.url)));
const binding={projectId:'project',versionId:'version',startBeats:0,endBeats:46.8};
const clip=(status='complete',id='render')=>({id,status,audio_url:'',metadata:{studio_project_id:'project',studio_project_version_id:'version',studio_project_start_beats:0,studio_project_end_beats:46.8}});
const ready={status:'ready',download_url:'https://downloads.s3.amazonaws.com/render.m4a'};
function harness({metadata=['complete'],delivery=[ready],job,timeoutMs=900000,deliveryTimeoutMs=180000}={}) {
  let clock=Date.now(), mi=0,di=0; const logs=[],requests=[],checkpoints=[],delays=[];
  job??={renderClipId:'render',phase:'render_queued'};
  const deps={binding,timeoutMs,deliveryTimeoutMs,now:()=>clock,wait:async ms=>{delays.push(ms);clock+=ms;},log:async e=>logs.push(e),persist:async()=>checkpoints.push(structuredClone(job)),playerProbe:async()=>({unavailable:true}),
    bridge:{call:async q=>{requests.push(q);assert.equal(q.method,'GET','resolver must never write');if(q.path.startsWith('/api/clips/get_songs_by_ids'))return{result:{clips:[]}};if(q.path.startsWith('/api/clip/')){const value=metadata[Math.min(mi++,metadata.length-1)];if(value===404)throw Object.assign(Error('Not found'),{status:404});return{result:typeof value==='string'?clip(value,q.path.split('/').at(-1)):value};}if(q.path.startsWith('/api/download/clip/'))return{result:delivery[Math.min(di++,delivery.length-1)]};throw Error('Unknown endpoint');}}};
  return{job,deps,logs,requests,checkpoints,delays,advance:ms=>{clock+=ms;}};
}
test('queued -> 404 x8 -> ready retains the ID and uses bounded exponential intervals',async()=>{
  const h=harness({metadata:sequences.queued404Ready});const result=await resolveRenderDelivery(h.job,h.deps);
  assert.equal(result.record.id,'render');assert.equal(result.deliverySource,'OFFICIAL_DELIVERY');assert.equal(h.job.renderLifecycle.state,'READY');
  assert.deepEqual(h.delays.slice(0,6),RENDER_LIFECYCLE.pollingMs);assert.equal(h.logs.filter(e=>e.metadata===404&&e.transient).length,8);assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);
  assert.ok(h.checkpoints.every(j=>j.renderClipId==='render'));
});
test('queued/processing audio_url empty is normal; completed metadata waits for delayed official delivery',async()=>{
  const h=harness({metadata:sequences.emptyAudioUntilReady,delivery:sequences.delayedDelivery});const result=await resolveRenderDelivery(h.job,h.deps);
  assert.equal(result.deliveryURL,ready.download_url);assert.equal(h.logs.filter(e=>e.delivery==='pending').length,3);assert.equal(h.logs.some(e=>e.state==='FAILED'),false);
});
test('process restart while queued resumes the same persisted render ID without a submission capability',async()=>{
  const h=harness({metadata:['queued']});h.deps.wait=async()=>{throw Error('process restart');};await assert.rejects(resolveRenderDelivery(h.job,h.deps),/process restart/);
  const persisted=h.checkpoints.at(-1), resumed=harness({job:persisted});await resolveRenderDelivery(resumed.job,resumed.deps);
  assert.equal(resumed.job.renderClipId,'render');assert.equal(resumed.job.renderJobs.length,1);assert.ok(resumed.requests.every(q=>q.method==='GET'));
});
test('transient 404 and expired render timeout never null the ID or silently duplicate',async()=>{
  const h=harness({metadata:[404],timeoutMs:15000});await assert.rejects(resolveRenderDelivery(h.job,h.deps),{kind:'render_timeout'});
  assert.equal(h.job.renderClipId,'render');assert.equal(h.job.phase,'render_timeout');assert.equal(h.job.renderJobs.length,1);assert.ok(h.logs.some(e=>e.event==='render_timeout'));
  // Even after timeout a later completed observation can resolve the SAME job.
  const resumed=harness({job:structuredClone(h.job)});await resolveRenderDelivery(resumed.job,resumed.deps);assert.equal(resumed.job.renderClipId,'render');
});
test('explicit server error is terminal FAILED; HTTP/auth errors are not render terminal failure',async()=>{
  const h=harness({metadata:sequences.terminalFailure});await assert.rejects(resolveRenderDelivery(h.job,h.deps),{kind:'render_failed'});assert.equal(h.job.renderJobs[0].terminalFailure.status,'error');assert.equal(h.requests.some(q=>q.path.includes('/download/')),false);
  const auth=harness();auth.deps.bridge.call=async()=>{throw Object.assign(Error('Unauthorized'),{status:401});};await assert.rejects(resolveRenderDelivery(auth.job,auth.deps),/Unauthorized/);assert.equal(auth.job.renderJobs[0].terminalFailure,undefined);assert.equal(auth.job.renderClipId,'render');
});
test('complete status without binding metadata continues waiting instead of becoming delivery failure',async()=>{
  const h=harness({metadata:[{id:'render',status:'complete',audio_url:''},clip()]});await resolveRenderDelivery(h.job,h.deps);assert.ok(h.logs.some(e=>e.state==='WAITING_FOR_METADATA'&&e.metadata==='pending'));
});
test('historical duplicates are deduplicated, preserved and resolved oldest first',async()=>{
  const h=harness({job:{renderClipId:'new',unavailableRenderIds:['old','old']}});restoreRenderJobs(h.job,[{clip:{...clip('queued','old'),created_at:'2026-01-01T00:00:00Z'}}]);await resolveRenderDelivery(h.job,h.deps);
  assert.equal(h.job.renderClipId,'old');assert.deepEqual(h.job.renderJobs.map(r=>r.id),['old','new']);assert.ok(h.requests.every(q=>q.path.includes('/old')));
});
test('after old timeout only an existing historical duplicate is tried, not a new render',async()=>{
  const h=harness({job:{renderClipId:'new',unavailableRenderIds:['old']},timeoutMs:1000});h.deps.bridge.call=async q=>{h.requests.push(q);assert.equal(q.method,'GET');if(q.path.startsWith('/api/clips/get_songs_by_ids'))return{result:{clips:[]}};if(q.path==='/api/clip/old')throw Object.assign(Error('Not found'),{status:404});if(q.path==='/api/clip/new')return{result:clip('complete','new')};return{result:ready};};
  await resolveRenderDelivery(h.job,h.deps);assert.equal(h.job.renderJobs[0].state,'TIMEOUT');assert.equal(h.job.renderClipId,'new');assert.equal(h.job.renderJobs.length,2);
});
test('queued transport acknowledgement recovers the crash gap; foreign or wrong-range acknowledgements do not',()=>{
  const captured={requestBinding:binding,response:{status:200,result:clip('queued')}};assert.equal(recoverRenderAcknowledgement(captured,binding).id,'render');assert.equal(recoverRenderAcknowledgement({...captured,requestBinding:{...binding,endBeats:99}},binding),null);
  const job={};rememberRenderSubmission(job,clip('queued'),binding);rememberRenderSubmission(job,clip('queued'),binding);assert.equal(job.renderJobs.length,1);assert.equal(job.renderJobs[0].state,'SUBMITTED');assert.equal(job.renderClipId,'render');
});
test('observed player fallback waits for delivery budget, never constructs a URL, and records provenance',async()=>{
  const source='https://cdn1.suno.ai/observed-render.m4a', complete={...clip(),media_urls:[{url:source}]};
  const h=harness({metadata:[complete],delivery:[{ok:false,reason:'invalid_asset'}],deliveryTimeoutMs:12000});let probeCalls=0;
  h.deps.playerProbe=async c=>{probeCalls++;assert.deepEqual(c,complete);return{url:source,field:'media_urls[0].url'};};const result=await resolveRenderDelivery(h.job,h.deps);
  assert.equal(result.deliverySource,'OBSERVED_PLAYER_STREAM');assert.equal(probeCalls,1);assert.ok(h.delays.reduce((a,b)=>a+b,0)>=12000);assert.equal(JSON.stringify(h.job).includes(source),false,'delivery URLs are not persisted in jobs');
});
test('player probe rejects encrypted/random bytes, forbidden URL, redacted signed URL and untrusted host',async()=>{
  let requests=0;const fetch=async()=>{requests++;return new Response(Buffer.alloc(64,0x87),{status:206});};
  const result=await probeObservedPlayer({...clip(),audio_url:'https://studio-api.prod.suno.com/api/forbidden',media_urls:[{url:'https://d2lwuy8qc234o3.cloudfront.net/observed.m4a',encoding:'1.0.0'},{url:'https://evil.example/file.m4a'},{url:'https://cdn1.suno.ai/file.m4a?sig=%3Credacted%3E'}]},{fetch});
  assert.equal(requests,1);assert.equal(result.unavailable,true);assert.equal(result.failures[0].reason,'NOT_DECODABLE_PLAYER_SOURCE');
  const header=Buffer.alloc(64);header.write('ftyp',4);const clear=await probeObservedPlayer({...clip(),media_urls:[{url:'https://cdn1.suno.ai/observed.m4a'}]},{fetch:async()=>new Response(header,{status:206})});assert.equal(clear.field,'media_urls[0].url');
});
test('persisted completed metadata permits delivery resolution despite eventual read invisibility',async()=>{
  const h=harness({metadata:[404]});h.deps.snapshots=[{clip:clip(),observedAt:new Date().toISOString()}];const result=await resolveRenderDelivery(h.job,h.deps);assert.equal(result.record.id,'render');assert.equal(h.job.renderLifecycle.metadataEvidence,'PERSISTED_COMPLETE_READBACK');
});
test('invalid legacy timestamp gets a stable checkpoint clock and still times out',async()=>{
  const h=harness({metadata:[404],timeoutMs:1000,job:{renderClipId:'render',renderJobs:[{id:'render',submittedAt:'invalid',state:'SUBMITTED'}]}});
  await assert.rejects(resolveRenderDelivery(h.job,h.deps),{kind:'render_timeout'});assert.ok(Number.isFinite(Date.parse(h.job.renderJobs[0].submittedAt)));
});
test('a guessed or unrelated player URL cannot satisfy delivery resolution',async()=>{
  const h=harness({delivery:[{ok:false,reason:'invalid_asset'}],deliveryTimeoutMs:1000});h.deps.playerProbe=async()=>({url:'https://cdn1.suno.ai/guessed.m4a',field:'audio_url'});
  await assert.rejects(resolveRenderDelivery(h.job,h.deps),{kind:'render_timeout'});assert.equal(h.job.renderClipId,'render');assert.equal(h.job.renderJobs[0].delivery,undefined);
});
test('unknown legacy submission clocks retain oldest-ID ordering across restarts',()=>{
  const job={unavailableRenderIds:['old'],renderClipId:'new',renderJobs:[{id:'new',submittedAt:'2026-01-01T00:00:00Z'}]};
  restoreRenderJobs(job);assert.deepEqual(job.renderJobs.map(r=>r.id),['old','new']);restoreRenderJobs(job);assert.deepEqual(job.renderJobs.map(r=>r.id),['old','new']);assert.equal(job.renderJobs[0].submissionTimeEstimated,true);
});
test('fresh explicit server failure supersedes archived complete metadata',async()=>{
  const h=harness({metadata:['error']});h.deps.snapshots=[{clip:clip(),observedAt:new Date().toISOString()}];
  await assert.rejects(resolveRenderDelivery(h.job,h.deps),{kind:'render_failed'});assert.equal(h.requests.some(q=>q.path.includes('/download/')),false);
});
test('evidence-backed songs-by-id read resolves an exact matching clip after primary 404',async()=>{
  const h=harness({metadata:[404]});h.deps.bridge.call=async q=>{
    h.requests.push(q);assert.equal(q.method,'GET');
    if(q.path==='/api/clip/render')throw Object.assign(Error('Not found'),{status:404});
    if(q.path==='/api/clips/get_songs_by_ids?ids=render')return{result:{clips:[clip('complete','unrelated'),clip()]}};
    return{result:ready};
  };
  await resolveRenderDelivery(h.job,h.deps);assert.equal(h.job.renderJobs[0].metadataEndpoint,'OBSERVED_SONGS_BY_IDS_READ');assert.equal(h.job.renderClipId,'render');
});
test('historical renders retain their own proven project/version bindings',async()=>{
  const foreign={...binding,projectId:'cached-project',versionId:'cached-version'};
  const h=harness({job:{renderClipId:'new',unavailableRenderIds:['old']}});h.deps.binding=foreign;
  h.deps.snapshots=[{clip:clip('queued','old'),binding}];await resolveRenderDelivery(h.job,h.deps);
  assert.equal(h.job.renderClipId,'old');assert.deepEqual(h.job.renderJobs[0].binding,binding);
});
