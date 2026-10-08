import test from 'node:test';
import assert from 'node:assert/strict';
import {songPageURL,probeSongPage,openSongPage,finalOutput,sourceTitle,pipelineTitle} from '../suno/audio/final-result.mjs';
import {exportCompletionStatus,requireExportReady} from '../suno/audio/studio-export.mjs';
import {resolveOptionalDelivery} from '../suno/audio/render-lifecycle.mjs';
import {unavailableQuality} from '../suno/audio/quality.mjs';
import {parseConfig} from '../suno/audio/config.mjs';
import {verifiedResumeCompletion} from '../suno/audio/resume-result.mjs';
const binding={projectId:'p',versionId:'v',startBeats:0,endBeats:356};
const complete={id:'render',status:'complete',metadata:{studio_project_id:'p',studio_project_version_id:'v',studio_project_start_beats:0,studio_project_end_beats:356}};
const job=()=>({projectId:'p',versionId:'v',renderClipId:'render',renderJobs:[{id:'render'}],songPage:{renderId:'render',url:songPageURL('render'),accessible:true},libraryExport:{renderId:'render',membershipDeterminate:true,libraryVisible:false},deliveryRenderId:'render',deliveryStatus:'RESTRICTED'});

test('production uses original Unicode source name; diagnostics retain separate run labels',()=>{
  for(const input of ['C:\\Users\\ROG\\Downloads\\LOSER-米津玄師-BOOTLEG.mp3','/music/LOSER-米津玄師-BOOTLEG.mp3']) {
    assert.equal(sourceTitle(input),'LOSER-米津玄師-BOOTLEG');
    for(const mode of ['PRODUCTION','PRODUCTION_PREROLL'])assert.equal(pipelineTitle(input,mode,'run-123'),'LOSER-米津玄師-BOOTLEG');
    assert.equal(pipelineTitle(input,'PRODUCTION_EXACT_PROBE','run-123',{calibration:true}),'Calibration PRODUCTION_EXACT_PROBE run-123');
    assert.equal(pipelineTitle(input,'SLICED_NEG8_TRANSPOSE','run-123'),'Studio SLICED_NEG8_TRANSPOSE run-123');
  }
  assert.equal(sourceTitle('song.live.v2.wav'),'song.live.v2');
  assert.equal(sourceTitle('song'),'song');
});

test('controller-independent resume requires both acknowledged binding and verified complete readback',()=>{
  const value=job(),record=value.renderJobs[0];record.binding=binding;record.materialization={status:'complete',binding};
  assert.equal(verifiedResumeCompletion(value,binding,complete),true);
  for(const clip of [{...complete,id:'other'},{...complete,status:'queued'},{...complete,metadata:{...complete.metadata,studio_project_end_beats:24}}])assert.equal(verifiedResumeCompletion(value,binding,clip),false);
  assert.equal(verifiedResumeCompletion(value,{...binding,versionId:'old'},complete),false);
  record.terminalFailure={status:'error'};assert.equal(verifiedResumeCompletion(value,binding,complete),false);delete record.terminalFailure;
  delete record.binding;assert.equal(verifiedResumeCompletion(value,binding,complete),false);record.binding=binding;
  delete record.materialization;assert.equal(verifiedResumeCompletion(value,binding,complete),false);
});
test('route reuses observed official saved-song link and rejects injection',()=>{
  assert.equal(songPageURL('render'),'https://suno.com/song/render');
  for(const id of ['',null,'../song','id?token=x','id#x','id&cmd','id/other'])assert.throws(()=>songPageURL(id));
});
test('page probe requires actual HTTP 200 HTML at the same official route and cancels the body',async()=>{
  let canceled=0;const response={status:200,url:songPageURL('render'),headers:new Headers({'content-type':'text/html'}),body:{cancel:async()=>{canceled++;}}};
  assert.equal((await probeSongPage('render',{fetch:async()=>response})).accessible,true);assert.equal(canceled,1);
  for(const changed of [{status:404},{url:'https://suno.com/login'},{headers:new Headers({'content-type':'application/json'})}])
    assert.equal((await probeSongPage('render',{fetch:async()=>({...response,...changed})})).accessible,false);
  assert.equal((await probeSongPage('render',{fetch:async()=>{throw Error('offline');}})).accessible,false);
});
test('materialized bound render plus official page succeeds without Library or media; explicit Library remains strict',()=>{
  const j=job(),status=exportCompletionStatus(j,binding,complete);
  assert.equal(requireExportReady(status).runSuccess,true);assert.equal(status.exportLifecycleState,'COMPLETE');
  assert.equal(status.libraryStatus,'NOT_VISIBLE');assert.equal(status.deliveryStatus,'RESTRICTED');
  assert.throws(()=>requireExportReady(exportCompletionStatus(j,binding,complete,{requireLibrary:true})),/require-library/);
  j.libraryExport={...j.libraryExport,libraryVisible:true,studioBadgeVerified:true,studioProvenanceVerified:true,projectId:'p',versionId:'v'};
  assert.equal(exportCompletionStatus(j,binding,complete,{requireLibrary:true}).runSuccess,true);
});
test('queued, stale bindings, wrong page, inaccessible page and terminal failure never become success',()=>{
  for(const change of [{songPage:{renderId:'other',url:songPageURL('render'),accessible:true}},
    {songPage:{renderId:'render',url:'https://evil.invalid',accessible:true}},
    {songPage:{renderId:'render',url:songPageURL('render'),accessible:false}},
    {renderJobs:[{id:'render',terminalFailure:{status:'error'}}]}])
    assert.equal(exportCompletionStatus({...job(),...change},binding,complete).runSuccess,false);
  assert.equal(exportCompletionStatus(job(),binding,{...complete,status:'queued'}).runSuccess,false);
  assert.equal(exportCompletionStatus(job(),{...binding,versionId:'stale'},complete).runSuccess,false);
  assert.equal(exportCompletionStatus({...job(),libraryExport:undefined},binding,complete).libraryStatus,'UNKNOWN');
});
test('restriction is ancillary and durable; resume never repeats a restricted delivery read',async()=>{
  const j=job();let reads=0,probes=0;const logs=[];
  const deps={bridge:{call:async q=>{assert.equal(q.method,'GET');reads++;return{result:{ok:false,reason:'not_authorized'}};}},playerProbe:async()=>{probes++;return{unavailable:true};},log:async e=>logs.push(e)};
  assert.equal((await resolveOptionalDelivery(j,complete,deps)).deliveryStatus,'RESTRICTED');
  assert.equal((await resolveOptionalDelivery(j,complete,deps)).deliveryStatus,'RESTRICTED');
  assert.equal(reads,1);assert.equal(probes,1);assert.equal(logs.at(-1).event,'delivery_restricted');
  assert.equal(exportCompletionStatus(j,binding,complete).runSuccess,true);
});
test('pending/error delivery is UNKNOWN, not a render failure; observed clear source is AVAILABLE',async()=>{
  const j=job(),deps={bridge:{call:async()=>({result:{status:'processing'}})},playerProbe:async()=>({unavailable:true})};
  assert.equal((await resolveOptionalDelivery(j,complete,deps)).deliveryStatus,'UNKNOWN');
  deps.bridge.call=async()=>{throw Object.assign(Error('temporary'),{status:429});};assert.equal((await resolveOptionalDelivery(j,complete,deps)).deliveryStatus,'UNKNOWN');
  deps.playerProbe=async()=>({url:'https://cdn1.suno.ai/observed.mp3'});assert.equal((await resolveOptionalDelivery(j,complete,deps)).deliveryStatus,'AVAILABLE');
});
test('unavailable QA reports unknown metrics, not a false PASS or zero anomalies',()=>{
  const qa=unavailableQuality({boundaryCount:2,expectedDuration:182,metadataDuration:182,reason:'DELIVERY_RESTRICTED'});
  assert.equal(qa.gate.status,'UNAVAILABLE');assert.equal(qa.qualitySummary.qualityReason,'DELIVERY_RESTRICTED');
  assert.equal(qa.analysis.detectedAnomalyCount,null);assert.equal(qa.qualitySummary.maxScore,null);
});
test('CLI flags are opt-in and final output is short, clear and page-based',async()=>{
  const defaults=parseConfig(['song.mp3']);assert.equal(defaults.open,false);assert.equal(defaults['require-library'],false);
  const config=parseConfig(['song.mp3','--open','--require-library']);assert.equal(config.open,true);assert.equal(config['require-library'],true);
  let called=0;await openSongPage(songPageURL('render'),{platform:'win32',launch:async(command,args)=>{called++;assert.equal(command,'rundll32.exe');assert.deepEqual(args,['url.dll,FileProtocolHandler',songPageURL('render')]);}});assert.equal(called,1);
  await assert.rejects(openSongPage('https://evil.invalid/song/render',{launch:async()=>{called++;}}));assert.equal(called,1);
  const output=finalOutput({projectId:'p',finalSongURL:songPageURL('render'),renderClipId:'render',libraryStatus:'NOT_VISIBLE',deliveryStatus:'RESTRICTED',qualityResult:'UNAVAILABLE'});
  for(const label of ['DONE','Studio Project:','Merged Song:','Render ID:','Library:','Direct Delivery:','Quality QA:'])assert.ok(output.includes(label));
  assert.ok(output.includes(songPageURL('render')));assert.ok(!output.includes('run_failed'));
});
