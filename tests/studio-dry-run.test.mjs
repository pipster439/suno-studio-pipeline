import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as sdk from '../suno/studio/dry-run-sdk.mjs';
import { registerWarpMarkers,resolveWarpMarkers,serializeWarpState } from '../suno/studio/warp-registry.mjs';
import { validateProjectForSave } from '../suno/studio/validation.mjs';
import { deserializeAudioProjectState } from '../suno/studio/clip-pipeline.mjs';
import { historicalMergeInput } from '../examples/studio-20-clip-dry-run.mjs';
import { NotVerifiedError } from '../suno/studio/operations.mjs';
import { SunoBridge } from '../suno/bridge/client.mjs';
import { BridgeHub } from '../suno/bridge/hub.mjs';
import { validateCall } from '../suno/bridge/errors.mjs';
const bytes=readFileSync(new URL('../fixtures/studio_project_get.json',import.meta.url)),fixture=JSON.parse(bytes);
const input=()=>historicalMergeInput(fixture);
test('20 clip merge runs every local stage with zero network calls and immutable previews',()=>{
  let network=0;const original=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('unexpected network');};
  try{
    const result=new sdk.StudioDryRunSDK().buildMerge(input());
    assert.equal(result.summary.clipCount,20);assert.equal(result.summary.trackCount,1);assert.equal(result.summary.warpRegistryEntries,2);
    assert.equal(result.summary.writeDispatches,0);assert.equal(network,0);
    assert.equal(result.saveRequestPreview.path,'/api/studio/save-project');assert.equal(result.renderRequestPreview.path,'/api/studio/render-state');
    assert.equal(result.renderRequestPreview.body.render_engine,'v2');assert.equal(result.renderRequestPreview.body.export_mode,'fullsong_export');
    for(const preview of [result.saveRequestPreview,result.renderRequestPreview]){assert.equal(preview.dispatchAllowed,false);assert.equal(preview.endpointStatus,'FOUND_STATICALLY');assert.throws(()=>{preview.dispatchAllowed=true},TypeError);}
    assert.throws(()=>new sdk.StudioDryRunSDK().dispatch(),NotVerifiedError);
    assert.equal(result.summary.renderTransformComplete,true);assert.equal(result.validationReport.serverSubmissionReady,false);
    assert.equal(result.saveRequestPreview.body.project_id,input().requestContext.save_project_id);
    const diff=sdk.historicalProjectDiff(fixture,result);assert.equal(diff.complete,true);assert.equal(diff.counts.BLOCKER,0);assert.equal(diff.counts.UNKNOWN_DIFFERENCE,0);
    const clips=result.projectDraft.state.tracks[0].clips;
    for(let i=0;i<20;i++){assert.equal(clips[i].asset.id,fixture.state.tracks[0].clips[i].asset.id);assert.notEqual(clips[i].id,clips[i].asset.id);assert.notEqual(clips[i].id,fixture.state.tracks[0].clips[i].id);}
    assert.equal(result.provenanceReport.hashStrategy.status,'FOUND_STATICALLY');
    assert.equal(result.provenanceReport.fields['/state/tracks/0/clips/0/transposition'].status,'USER_SUPPLIED');
    assert.equal(result.provenanceReport.bindings.project_id.bindingStatus,'LOCAL_PLACEHOLDER');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),'b5cc87081cda785b6d59b753908687c0487dfd23f1e3c262b7b563ba5a2ec64a');
  }finally{globalThis.fetch=original;}
});
test('manual sequential timeline deterministic, origin-independent duration and short actual tail',()=>{
  const t={...fixture.state.timing,firstBeatSeconds:11};
  const a=sdk.buildSequentialTimeline([6,6,1.11],t),b=sdk.buildSequentialTimeline([6,6,1.11],t);
  assert.deepEqual(a,b);assert.ok(Math.abs(a.totalDurationSeconds-13.11)<1e-12);
  assert.equal(a.placements[2].endBeats,a.placements[2].startBeats+1.11*t.bps);
  assert.throws(()=>sdk.buildSequentialTimeline([1],{...t,bpsAutomation:[{beats:0,value:2}]}),NotVerifiedError);
  assert.throws(()=>sdk.buildSequentialTimeline([Infinity],t),/finite/);
  const i=input();i.placementMode='SOURCE_DURATION';const r=sdk.buildMergeDryRun(i);
  assert.ok(Math.abs(r.summary.timelineTotalDurationSeconds-r.summary.sourceTotalDurationSeconds)<1e-9);
  assert.equal(sdk.historicalProjectDiff(fixture,r).complete,false); // Do not hide the known source-vs-output duration distinction.
  const disabled=input();disabled.perClipProfiles[0].warp.enabled=false;
  assert.throws(()=>sdk.buildMergeDryRun(disabled),NotVerifiedError);
});
test('clipId alias is compatibility-controlled; trim/import fields are inert separate metadata',()=>{
  const i=input(),s=i.sources[0],p=i.perClipProfiles[0];
  assert.equal(Object.hasOwn(sdk.buildStudioClipDraft(s,i.timing,p).clip,'clipId'),false);
  assert.equal(sdk.buildStudioClipDraft(s,i.timing,p,i.compatibility).clip.clipId,s.clip_id);
  assert.throws(()=>sdk.buildStudioClipDraft({...s,uploader_metadata:{}},i.timing,p,i.compatibility),/observed alias/);
  const metadata={gain_reference:{peak:0.5},silence_pad_seconds:0.2,source_start_second:10,source_end_second:16};
  const made=sdk.makeSourceClip({...s,uploader_metadata:{...s.uploader_metadata,...metadata}});
  assert.deepEqual(made.uploader_metadata.gain_reference,metadata.gain_reference);
  const built=sdk.buildStudioClipDraft(made,i.timing,p);assert.equal(Object.hasOwn(built.clip,'gain_reference'),false);
  assert.throws(()=>sdk.makeSourceClip({...s,source_start_second:1}),/uploader_metadata/);
  assert.throws(()=>sdk.makePostProcessProfile({explicit:{sourceStart:1}})&&sdk.applyPostProcessProfile(built.clip,{explicit:{sourceStart:1}}),NotVerifiedError);
  assert.throws(()=>sdk.makePostProcessProfile({trim:{sourceStart:1,sourceEnd:2}}),NotVerifiedError);
  const identity=sdk.buildMergeDryRun({...i,perClipProfiles:[],profile:{warp:{identity_project_bps:true}},placementMode:'SOURCE_DURATION'});
  assert.ok(Object.entries(identity.provenanceReport.fields).filter(([path])=>path.startsWith('/state/markersRegistry/')).every(([,p])=>p.status==='FOUND_STATICALLY'));
});
test('pitch derivation default denies, explicit opt-in remains CORRELATED and conflicts rejected',()=>{
  const metadata={pitch_shift_semitones:8,restore_pitch_in_studio:true};
  assert.throws(()=>sdk.derivePitchRestoration(metadata),NotVerifiedError);
  assert.throws(()=>sdk.derivePitchRestoration(metadata,{allow_observed_uploader_pitch_rule:'true'}),NotVerifiedError);
  const d=sdk.derivePitchRestoration(metadata,{allow_observed_uploader_pitch_rule:true});assert.equal(d.value,-8);assert.equal(d.status,'CORRELATED');assert.equal(d.serverVerified,false);
  const i=input();i.sources[0]={...i.sources[0],uploader_metadata:{...i.sources[0].uploader_metadata,...metadata}};
  i.perClipProfiles[0]={...i.perClipProfiles[0],explicit:{},derived:{restore_uploaded_pitch:{allow_observed_uploader_pitch_rule:true}}};
  const r=sdk.buildMergeDryRun(i);assert.equal(r.provenanceReport.fields['/state/tracks/0/clips/0/transposition'].status,'CORRELATED');
  assert.equal(sdk.applyPostProcessProfile({transposition:0},{explicit:{transposition:-100}}).clip.transposition,-24);
  assert.throws(()=>sdk.applyPostProcessProfile({},{explicit:{transposition:-8},derived:{restore_uploaded_pitch:{allow_observed_uploader_pitch_rule:true}}},metadata),/conflict/);
  assert.throws(()=>sdk.applyLoudnessRepair(metadata),NotVerifiedError);
});
test('hash preserve policy retains historical spelling, orphan entries, full unknown fields and no-op state',()=>{
  const project=structuredClone(fixture);project.state.future={nested:[{unfamiliar:42}]};project.state.tracks[0].clips[0].future={keep:true};
  project.state.markersRegistry.orphan_unused={0:0,8:21};project.state.markersRegistry.futureRegistryMetadata={future:{keep:true}};
  const before=structuredClone(project),noOp=sdk.modifyExistingProject(project);
  assert.deepEqual(noOp.project,before);
  const decoded=deserializeAudioProjectState(project.state),serialized=serializeWarpState(decoded,{strategy:sdk.WarpHashStrategy.PRESERVE_EXISTING,originalWire:project.state});
  assert.deepEqual(serialized.state,project.state); // Explicit wire -> decode -> no-op -> save semantic equivalence.
  const first=project.state.tracks[0].clips[0],modified=sdk.modifyExistingProject(project,{clipId:first.id,profile:{explicit:{amplitude:0.6}}});
  const expected=structuredClone(project);expected.state.tracks[0].clips[0].amplitude=0.6;
  assert.deepEqual(modified.project,expected);assert.deepEqual(project,before);
  const map=project.state.markersRegistry[first.warp.markersHash],registered=registerWarpMarkers(project.state.markersRegistry,map,{strategy:sdk.WarpHashStrategy.PRESERVE_EXISTING});
  assert.equal(registered.hash,first.warp.markersHash);assert.equal(registered.reused,true);
  assert.throws(()=>registerWarpMarkers({},map,{strategy:sdk.WarpHashStrategy.PRESERVE_EXISTING}),NotVerifiedError);
  const current=registerWarpMarkers({},map,{strategy:sdk.WarpHashStrategy.CURRENT_STATIC_ALGORITHM});
  assert.equal(current.status,'FOUND_STATICALLY');assert.deepEqual(resolveWarpMarkers(current.registry,current.hash),map);
  const again=registerWarpMarkers(current.registry,map,{strategy:sdk.WarpHashStrategy.CURRENT_STATIC_ALGORITHM});assert.equal(Object.keys(again.registry).length,1);
  assert.throws(()=>resolveWarpMarkers({},'absent'),/unresolved/);
  const lossy=structuredClone(project.state);delete lossy.future;assert.throws(()=>validateProjectForSave(lossy,{originalState:project.state}),/unknown-field loss/);
});
test('existing fades untouched by defaults, explicit fade/read/gain overlays preserve unknown values',()=>{
  const clip={fadeInBeats:2,fadeOutBeats:3,fadeInCurve:0.6,fadeOutCurve:0.7,amplitude:0.9,readStartBeats:4,future:{keep:1}};
  assert.deepEqual(sdk.applyPostProcessProfile(clip,{}).clip,clip);
  const changed=sdk.applyPostProcessProfile(clip,{explicit:{fade_in_beats:5,fade_out_curve:0.8,read_start_beats:7,amplitude:0.5}}).clip;
  assert.equal(changed.fadeInBeats,5);assert.equal(changed.fadeOutBeats,3);assert.equal(changed.fadeInCurve,0.6);assert.equal(changed.fadeOutCurve,0.8);assert.equal(changed.readStartBeats,7);
  assert.deepEqual(changed.future,clip.future);assert.equal(clip.fadeInBeats,2);
});
test('strict save validation rejects masks, omissions, nonfinite/secret values, duplicate IDs, assets and overlap',()=>{
  const checks=[s=>s.future='<redacted>',s=>s.future={omitted:'limit'},s=>s.future=NaN,s=>s.future=Infinity,
    s=>s.tracks[0].clips[1].id=s.tracks[0].clips[0].id,s=>s.tracks[0].clips[0].asset.id='',
    s=>s.tracks[0].clips[0].clipId='wrong',s=>s.tracks[0].clips[0].endBeats=s.tracks[0].clips[0].startBeats,
    s=>s.tracks[0].clips[1].startBeats=0,s=>s.tracks[0].clips[0].warp.markersHash='absent',s=>delete s.selection,
    s=>s.timing.bpsAutomation=[{beats:0,value:2}],s=>s.tracks[0].clips[0].fadeInCurve=-1,s=>s.future={cookie:'unit-secret'},s=>s.future='https://example.com/audio?sig=unit-signed-credential'];
  for(const change of checks){const s=structuredClone(fixture.state);change(s);assert.throws(()=>validateProjectForSave(s));}
  let getters=0;const s=structuredClone(fixture.state);Object.defineProperty(s,'accessor',{enumerable:true,get(){getters++;return 1;}});
  assert.throws(()=>validateProjectForSave(s),/accessors/);assert.equal(getters,0);
});
test('new template neutralizes historical IDs in UI without dropping unknown structural fields',()=>{
  const template=structuredClone(fixture);template.state.layout.futureFocusedId=template.state.tracks[0].id;template.state.future={neutral:9};
  const draft=sdk.buildProjectDraft(template,template.state.timing);
  assert.equal(draft.state.layout.futureFocusedId,null);assert.deepEqual(draft.state.future,{neutral:9});assert.deepEqual(draft.state.selection.trackIds,[]);assert.equal(draft.state.selection.focusedTrackId,null);
  assert.notEqual(draft.state.tracks[0].id,template.state.tracks[0].id);assert.equal(draft.state.tracks[0].clips.length,0);
  template.state.future.id=template.state.tracks[0].id;assert.throws(()=>sdk.buildProjectDraft(template,template.state.timing),/stale/);
});
test('render preview requires explicit static enums/context and keeps state distinct from save',()=>{
  for(const change of [i=>delete i.render.render_engine,i=>i.render.render_engine='unknown-engine',i=>delete i.render.export_mode,i=>delete i.requestContext.project_id,
    i=>delete i.requestContext.save_project_id]){const i=input();change(i);assert.throws(()=>sdk.buildMergeDryRun(i));}
  const i=input();i.template=structuredClone(fixture);i.template.state.metronome={enabled:true,amplitude:0.4};
  const r=sdk.buildMergeDryRun(i);assert.equal(r.saveRequestPreview.body.state.metronome.enabled,true);
  assert.deepEqual(r.renderRequestPreview.body.state.metronome,{enabled:false,amplitude:1});
  assert.notEqual(r.renderRequestPreview.body.project_id,r.renderRequestPreview.body.studio_project_id);
});
test('Studio writes blocked in actual bridge/hub even without preview flag or with integration flags/encoded paths',async()=>{
  let sends=0;const bridge=new SunoBridge({key:'unit-local-key'});bridge.request=()=>{sends++;};
  const hub=new BridgeHub();hub.peer={send(){sends++;}};hub.auth.ready=true;
  for(const method of ['GET','POST','PUT','PATCH','DELETE'])for(const name of ['create-project','save-project','render-state','render-state-multitrack'])for(const path of [
    '/api/studio/'+name,'/api/studio/'+name+'/?x=1','/api/%73tudio/'+name,'/api/%2573tudio/'+name,'/api//studio/'+name,'/api/x/../studio/'+name]){
    const call={method,path,body:{},integration:true,allowWrite:true};
    assert.throws(()=>validateCall(call),{kind:'not_verified'});assert.throws(()=>hub.call(call),{kind:'not_verified'});await assert.rejects(bridge.call(call),{kind:'not_verified'});
  }
  assert.equal(sends,0);assert.equal(hub.pending.size,0);
  assert.equal(validateCall({method:'GET',path:'/api/studio/project/'+fixture.id}).method,'GET');
});
