// Offline data-only SDK: no bridge, fetch, socket, account auth or dispatch dependency.
import { randomUUID } from 'node:crypto';
import { BridgeError } from '../bridge/errors.mjs';
import { NotVerifiedError } from './operations.mjs';
import { sourceClipMetadata, buildAnalyzedAudioClipDraft, inspectClipDraft, deserializeAudioProjectState,
  durationSecondsToBeats, warpBeatsFromSeconds, serializeAudioProjectState } from './clip-pipeline.mjs';
import { rawWireState, deserializeEditorState, inspectEditorState, serializeProjectState, inspectSaveSerializedState,
  prepareRenderTransformedState, inspectRenderTransformedState } from './state-boundaries.mjs';
import { buildSaveProjectRequest, buildRenderProjectRequest } from './request-builders.mjs';
import { WarpHashStrategy, serializeWarpState, markersSignature } from './warp-registry.mjs';
import { validId, validateJsonData, validateProjectForSave, changedPaths } from './validation.mjs';
import { transformRenderState, deriveDownbeats, deriveManualRenderTiming } from './render-pipeline.mjs';
export { WarpHashStrategy };
const fail = m => { throw new BridgeError('validation_error', m); };
const finite = (v, name) => { if (!Number.isFinite(v)) fail(name + ' must be finite'); return v; };
const copy = v => structuredClone(v);
export function deepFreeze(v) { if(v && typeof v==='object' && !Object.isFrozen(v)){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v; }

/** duration_seconds is underlying source duration, not automatically timeline playback duration. */
export function makeSourceClip(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('SourceClip record required');
  validateJsonData(input); validId(input.clip_id);
  if (finite(input.duration_seconds,'source duration') <= 0) fail('source duration must be positive');
  if (input.title !== undefined && typeof input.title !== 'string') fail('source title must be a string');
  // Uploader import fields are inert opaque metadata. They are never spread into Studio wire.
  for (const field of ['source_start_second','source_end_second','pitch_shift_semitones','restore_pitch_in_studio','gain_reference','silence_pad_seconds'])
    if(Object.hasOwn(input,field)) fail('import-specific ' + field + ' belongs in uploader_metadata');
  return deepFreeze(copy(input));
}
export function makePostProcessProfile(input = {}) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('post-processing profile record required');
  validateJsonData(input);
  for(const key of ['explicit','derived','unverified','warp','display'])if(input[key]!==undefined&&(!input[key]||typeof input[key]!=='object'||Array.isArray(input[key])))fail(key+' must be a record');
  for(const key of Object.keys(input)) if(!['explicit','derived','unverified','warp','display'].includes(key))throw new NotVerifiedError('unsupported profile property '+key);
  if(input.unverified && Object.keys(input.unverified).length)throw new NotVerifiedError('unverified post-processing profile');
  if(input.derived && Object.keys(input.derived).some(k=>k!=='restore_uploaded_pitch'))throw new NotVerifiedError('derived post-processing rule');
  return deepFreeze(copy(input));
}
export function derivePitchRestoration(metadata, { allow_observed_uploader_pitch_rule = false } = {}) {
  if(allow_observed_uploader_pitch_rule!==true)throw new NotVerifiedError('observed uploader inverse pitch rule');
  if(metadata?.restore_pitch_in_studio !== true)fail('explicit uploader restoration flag required');
  const pitch=finite(metadata.pitch_shift_semitones,'uploader pitch');
  return { value: Math.max(-24,Math.min(24,-pitch)), status:'CORRELATED', rule:'observed-uploader-inverse-pitch', serverVerified:false,
    inputPitch:pitch, unclampedValue:-pitch, optIn:true };
}
export function applyLoudnessRepair() { throw new NotVerifiedError('third-party loudness repair'); }
const processingFields = {transposition:'transposition',amplitude:'amplitude',read_start_beats:'readStartBeats',fade_in_beats:'fadeInBeats',fade_out_beats:'fadeOutBeats',fade_in_curve:'fadeInCurve',fade_out_curve:'fadeOutCurve'};
export function applyPostProcessProfile(existingClip, profileInput = {}, uploader = {}) {
  const profile=makePostProcessProfile(profileInput), clip=copy(existingClip), provenance=[];
  for(const [input,value] of Object.entries(profile.explicit??{})) {
    const field=processingFields[input]; if(!field)throw new NotVerifiedError('explicit processing '+input);
    finite(value,input); let applied=value;
    if(field==='transposition')applied=Math.max(-24,Math.min(24,value));
    if(field==='fadeInBeats'||field==='fadeOutBeats')applied=Math.max(0,value);
    if((field==='amplitude'||field.endsWith('Curve'))&&value<0)fail(input+' must be nonnegative');
    clip[field]=applied; provenance.push({field,status:'USER_SUPPLIED',rule:applied===value?'explicit overlay':'static clamp',value:applied});
  }
  if(profile.derived?.restore_uploaded_pitch) {
    if(Object.hasOwn(profile.explicit??{},'transposition'))fail('explicit and derived pitch modes conflict');
    const derived=derivePitchRestoration(uploader,profile.derived.restore_uploaded_pitch);clip.transposition=derived.value;
    provenance.push({field:'transposition',...derived});
  }
  if(profile.warp){
    if(profile.warp.identity_project_bps)throw new NotVerifiedError('identity warp requires draft timing context');
    for(const[key,value]of Object.entries(profile.warp)){
      if(key==='markers'){markersSignature(value);clip.warp={...clip.warp,markers:copy(value)};delete clip.warp.markersHash;provenance.push({field:'warp/markers',status:'USER_SUPPLIED',rule:'explicit marker map'});}
      else if(key==='enabled'||key==='awaiting_analysis'){if(typeof value!=='boolean')fail('warp boolean required');const field=key==='enabled'?'enabled':'awaitingAnalysis';clip.warp={...clip.warp,[field]:value};provenance.push({field:'warp/'+field,status:'USER_SUPPLIED',rule:'explicit warp overlay'});}
      else throw new NotVerifiedError('warp processing '+key);
    }
  }
  return {clip,provenance}; // Defaults never overlay an existing clip.
}
export function buildSequentialTimeline(durationSeconds, timing, { startBeats=0 }={}) {
  finite(startBeats,'timeline start'); let cursor=startBeats, totalSeconds=0;
  const placements=durationSeconds.map(seconds=>{
    const length=durationSecondsToBeats(seconds,timing),start=cursor;cursor=finite(cursor+length,'timeline end');totalSeconds=finite(totalSeconds+seconds,'total duration');
    return {startBeats:start,endBeats:cursor,durationSeconds:seconds};
  });
  return {placements,totalDurationSeconds:totalSeconds,totalDurationBeats:cursor-startBeats,startBeats,endBeats:cursor};
}
export function buildStudioClipDraft(sourceInput,timing,profileInput,compatibility={}) {
  const source=makeSourceClip(sourceInput),profile=makePostProcessProfile(profileInput);
  durationSecondsToBeats(source.duration_seconds,timing);
  let markers=profile.warp?.markers, warpSource='USER_SUPPLIED';
  if(!markers && profile.warp?.identity_project_bps===true){markers={0:0,1:timing.bps};warpSource='FOUND_STATICALLY';}
  if(!markers)throw new NotVerifiedError('explicit resolved warp markers or identity_project_bps policy required');
  markersSignature(markers);
  const extraFields={};
  if(compatibility.preserve_observed_clip_id_alias===true){
    if(source.uploader_metadata?.observed_clip_id_alias!==source.clip_id)fail('compatibility alias requires matching observed alias');
    extraFields.clipId=source.clip_id;
  }
  const h=buildAnalyzedAudioClipDraft(sourceClipMetadata({id:source.clip_id,status:'complete',metadata:{duration:source.duration_seconds}}),{
    fallbackBPS:timing.bps,markers,name:source.title??'New Clip',color:profile.display?.color??null,extraFields });
  const {identity_project_bps,...warpOverlay}=profile.warp;
  const built=inspectClipDraft(h),processed=applyPostProcessProfile(built,{...profile,warp:warpOverlay},source.uploader_metadata);
  if(profile.warp?.enabled!==undefined){if(typeof profile.warp.enabled!=='boolean')fail('explicit warp enabled must be boolean');processed.clip.warp.enabled=profile.warp.enabled;}
  if(profile.warp?.awaiting_analysis!==undefined){if(typeof profile.warp.awaiting_analysis!=='boolean')fail('explicit awaiting_analysis must be boolean');processed.clip.warp.awaitingAnalysis=profile.warp.awaiting_analysis;}
  return {clip:processed.clip,source,provenance:processed.provenance,warpSource};
}
function templateIdentities(template) {return new Set([template.id,template.latest_version_id,...template.state.tracks.flatMap(t=>[t.id,...t.clips.flatMap(c=>[c.id,c.asset?.id,c.clipId])])].filter(Boolean));}
function clearUiReferences(value,ids){if(typeof value==='string'&&ids.has(value))return null;if(Array.isArray(value))return value.map(v=>clearUiReferences(v,ids)).filter(v=>v!==null);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>{if(ids.has(k))throw new NotVerifiedError('history-keyed unknown UI template field');return[k,clearUiReferences(v,ids)]}));return value;}
function rejectHistoricalReferences(value,ids,path='') {if(typeof value==='string'&&ids.has(value))fail('stale template identity at '+path);if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){if(ids.has(k))fail('stale template identity key');rejectHistoricalReferences(v,ids,path+'/'+k)}}
export function buildProjectDraft(template,timing,{title='Local Studio Draft',trackName='Audio Track'}={}) {
  validateProjectForSave(template.state); durationSecondsToBeats(1,timing);
  if(template.state.tracks.length!==1 || template.state.tracks[0].takeLanes.length || template.state.masterSignalChain.length || template.state.tracks[0].signalChain?.length)
    throw new NotVerifiedError('single audio track template without plugin/take-lane chains required');
  const state=deserializeAudioProjectState(template.state),track=copy(state.tracks[0]),ids=templateIdentities(template);
  track.id=randomUUID();track.name=trackName;track.clips=[];track.takeLanes=[];track.clipCreationIntents=[];track.faderAutomation={};track.arm=false;track.solo=false;track.mute=false;
  state.tracks=[track];state.timing=copy(timing);
  for(const field of ['selection','layout','contextualWindowConfig'])if(state[field])state[field]=clearUiReferences(state[field],ids);
  Object.assign(state.selection,{trackIds:[],focusedTrackId:null,focusedArea:null,anchorBeats:0,focusBeats:0,noteIds:[],automationPointIndices:[],warpMarkerSeconds:{}});
  for(const key of ['focusedTakeLaneId','arrangementAnchorBeats','arrangementFocusBeats'])if(Object.hasOwn(state.selection,key))state.selection[key]=null;
  state.sections={};state.routing={};state.lyricsCorrectionsByClipId={};state.midiCcMappings={};state.loop={...state.loop,enabled:false,startBeats:0,endBeats:0};
  rejectHistoricalReferences(state,ids);
  return {id:randomUUID(),title,identity:{kind:'LOCAL_DRAFT',serverProjectId:null},state};
}
function safeRenderMemory(memory) {
  return transformRenderState(memory);
}
export function buildSaveProjectRequestPreview(input,{provenance={},validation={}}={}) {
  validateJsonData(provenance);validateJsonData(validation);
  const preview=buildSaveProjectRequest(input),checked=validateProjectForSave(preview.body.state);
  return deepFreeze({...preview,endpointStatus:preview.status,provenance:{...provenance,endpointStatus:preview.status,serverWriteVerified:preview.status==='VERIFIED',currentDraftLiveVerified:false},validation:{...validation,...checked}});
}
export function buildRenderStateRequestPreview(input,{provenance={},validation={}}={}) {
  if(input.render_engine!=='v2')throw new NotVerifiedError('explicit observed V2 render_engine required');
  if(!['fullsong_export','selected_time_range_export'].includes(input.export_mode))throw new NotVerifiedError('explicit observed export_mode required');
  validateJsonData(input.downbeats);
  validateJsonData(provenance);validateJsonData(validation);
  const preview=buildRenderProjectRequest(input),checked=validateProjectForSave(preview.body.state);
  return deepFreeze({...preview,endpointStatus:preview.status,provenance:{...provenance,endpointStatus:preview.status,serverWriteVerified:preview.status==='VERIFIED',currentDraftLiveVerified:false},validation:{...validation,...checked}});
}
function leaves(value,path='',out=[]) {if(value&&typeof value==='object'&&Object.keys(value).length)for(const[k,v]of Object.entries(value))leaves(v,path+'/'+k.replaceAll('~','~0').replaceAll('/','~1'),out);else out.push(path);return out;}
function provenanceForState(state,clips,hashProvenance){
  const fields={};
  for(const path of leaves(state,'/state'))fields[path]={status:'OBSERVED',source:'structural template',serverWriteVerified:false};
  for(const path of Object.keys(fields))if(/^\/state\/(selection|layout|contextualWindowConfig|sections|routing|lyricsCorrectionsByClipId|midiCcMappings|loop)(\/|$)/.test(path))fields[path]={status:'DEFAULT',source:'new-draft convenience/history reset'};
  for(const path of Object.keys(fields))if(path.startsWith('/state/timing/'))fields[path]={status:'USER_SUPPLIED',source:'explicit manual timing'};
  fields['/state/tracks/0/id']={status:'DEFAULT',source:'new local track UUID'};
  for(const key of ['name','takeLanes','clipCreationIntents','faderAutomation','arm','solo','mute'])fields['/state/tracks/0/'+key]={status:'DEFAULT',source:'explicit new audio-track draft reset'};
  for(const[i,c]of clips.entries()){
    const prefix=`/state/tracks/0/clips/${i}`;
    for(const path of leaves(state.tracks[0].clips[i],prefix))fields[path]={status:'FOUND_STATICALLY',source:'audio constructor'};
    for(const name of ['id','name','color'])fields[prefix+'/'+name]={status:name==='id'?'DEFAULT':'USER_SUPPLIED',source:name==='id'?'new arrangement UUID':'source/profile display value'};
    fields[prefix+'/asset/id']={status:'USER_SUPPLIED',ruleStatus:'FOUND_STATICALLY',source:'SourceClip.clip_id'};
    if(Object.hasOwn(state.tracks[0].clips[i],'clipId'))fields[prefix+'/clipId']={status:'OBSERVED',source:'explicit observed-alias compatibility policy'};
    for(const field of ['startBeats','endBeats'])fields[prefix+'/'+field]={status:'FOUND_STATICALLY',source:'manual duration conversion / sequential placement',inputDurationStatus:c.durationStatus};
    for(const p of c.provenance)fields[prefix+'/'+p.field]={...p,serverWriteVerified:false};
    fields[prefix+'/warp/markersHash']={...hashProvenance[i],source:'explicit WarpHashStrategy'};
    for(const field of ['enabled','awaitingAnalysis'])if(Object.hasOwn(c.profile.warp??{},field==='enabled'?'enabled':'awaiting_analysis'))fields[prefix+'/warp/'+field]={status:'USER_SUPPLIED',source:'explicit warp profile'};
  }
  for(const path of Object.keys(fields))if(path.startsWith('/state/markersRegistry/')){
    const hash=path.split('/')[3].replaceAll('~1','/').replaceAll('~0','~'),clipIndex=state.tracks[0].clips.findIndex(c=>c.warp.markersHash===hash);
    const status=clips[clipIndex]?.warpSource??'USER_SUPPLIED';
    fields[path]={status,source:status==='FOUND_STATICALLY'?'explicit identity_project_bps policy':'explicit marker map',encodingStatus:'FOUND_STATICALLY'};
  }
  return fields;
}
/** Full offline flow. Request bindings are explicit, potentially unresolved local placeholders. */
export function buildMergeDryRun({sources,timing,profile={},perClipProfiles=[],template,compatibility={},placementMode='SOURCE_DURATION',hashStrategy=WarpHashStrategy.CURRENT_STATIC_ALGORITHM,title,requestContext,render}) {
  if(!Array.isArray(sources)||!sources.length)fail('nonempty SourceClip[] required');
  if(!Array.isArray(perClipProfiles)||perClipProfiles.length&&perClipProfiles.length!==sources.length)fail('perClipProfiles must match SourceClip count');
  if(!['SOURCE_DURATION','RESOLVED_WARP'].includes(placementMode))fail('explicit supported placement mode required');
  if(!requestContext||!render)throw new NotVerifiedError('explicit future request bindings and render parameters required');
  for(const key of ['save_project_id','project_id','studio_project_id','studio_project_version_id'])validId(requestContext[key]);
  validateJsonData(requestContext);validateJsonData(render);
  const draft=buildProjectDraft(template,timing,{title});
  const clips=sources.map((s,i)=>{const p=perClipProfiles[i]??profile,c=buildStudioClipDraft(s,timing,p,compatibility);return{...c,profile:p,durationStatus:placementMode==='RESOLVED_WARP'?'FOUND_STATICALLY':'USER_SUPPLIED'};});
  if(placementMode==='RESOLVED_WARP'&&clips.some(c=>c.clip.warp.enabled!==true))throw new NotVerifiedError('resolved warp placement requires enabled warp; disabled-warp timing not reproduced');
  const durations=clips.map(c=>placementMode==='SOURCE_DURATION'?c.source.duration_seconds:(warpBeatsFromSeconds(c.clip.warp.markers,c.source.duration_seconds)-warpBeatsFromSeconds(c.clip.warp.markers,0))/timing.bps);
  const timeline=buildSequentialTimeline(durations,timing);
  for(const[c,i]of clips.map((c,i)=>[c,i]))draft.state.tracks[0].clips.push({...c.clip,startBeats:timeline.placements[i].startBeats,endBeats:timeline.placements[i].endBeats});
  const storage=serializeWarpState(draft.state,{strategy:hashStrategy});
  const validation=validateProjectForSave(storage.state);
  const editor=deserializeEditorState(rawWireState(storage.state),deserializeAudioProjectState);
  const save=serializeProjectState(editor,m=>serializeWarpState(m,{strategy:hashStrategy,originalWire:storage.state}).state);
  const wire=inspectSaveSerializedState(save);
  // Render uses the current static serializer's fresh referenced-only registry.
  // Editing preservation policy must not leak dropped clips' registry entries here.
  const renderHandle=prepareRenderTransformedState(editor,safeRenderMemory,serializeAudioProjectState);
  const renderWire=inspectRenderTransformedState(renderHandle);validateProjectForSave(renderWire);
  const provenanceReport={schemaVersion:1,status:'LOCAL_ONLY',endpointStatus:'VERIFIED',serverWriteVerified:true,currentDraftLiveVerified:false,
    fields:provenanceForState(wire,clips,storage.provenance),
    sourceInputs:clips.map((c,i)=>({clipIndex:i,clip_id:{status:'USER_SUPPLIED',source:'existing source resource reference'},
      duration_seconds:{status:'USER_SUPPLIED',units:'underlying source range seconds',basis:c.source.duration_basis??'caller supplied; metadata not fetched'},
      uploader_metadata:{status:'USER_SUPPLIED',appliedToWire:false,retained:true}})),
    bindings:Object.fromEntries(Object.entries(requestContext).map(([k])=>[k,{status:'USER_SUPPLIED',bindingStatus:requestContext.binding_status??'UNVERIFIED_BINDING',noIdentityInference:true}])),
    aliases:{'/saveRequestPreview/body/state':'/state','/projectDraft/state':'/state','/editorState/payload':'explicit decode of /state'},
    render:{endpointStatus:'VERIFIED',render_engine:{status:'USER_SUPPLIED',staticValue:'v2'},export_mode:{status:'USER_SUPPLIED'},
      statePolicy:'manual audio MVP: audible tracks / supported assets / unmuted clips',timingAndMetronome:'FOUND_STATICALLY',markerStorage:'rebuild referenced-only registry; FOUND_STATICALLY',
      hashStrategy:{strategy:WarpHashStrategy.CURRENT_STATIC_ALGORITHM,status:'FOUND_STATICALLY',serverVerified:false},
      normalizationTransforms:'17660 then 950155; FOUND_STATICALLY',downbeats:render.downbeats===undefined?'FOUND_STATICALLY derived':'USER_SUPPLIED override',serverVerified:false},
    hashStrategy:{strategy:hashStrategy,status:hashStrategy===WarpHashStrategy.CURRENT_STATIC_ALGORITHM?'FOUND_STATICALLY':'OBSERVED',serverVerified:false},
    uploaderMetadataAppliedOnlyByOptIn:true,placementMode,sourceDurationUnits:'underlying source seconds',timelineDurationUnits:'project playback seconds',
    rules:clips.flatMap((c,i)=>c.provenance.map(p=>({clipIndex:i,...p}))),
    readiness:{readyForLocalValidation:true,serverSubmissionReady:false,requires:['explicit local write policy','real create/save response bindings','supported tested profile']}};
  const saveRequestPreview=buildSaveProjectRequestPreview({project_id:requestContext.save_project_id,title:draft.title,state:save},{validation,provenance:{state:'/state',endpointStatus:'VERIFIED',binding:'explicit save_project_id; no render/workspace ID substitution'}});
  const renderRequestPreview=buildRenderStateRequestPreview({...render,downbeats:render.downbeats??deriveDownbeats({type:'manual',...deriveManualRenderTiming(timing)},timeline.startBeats,timeline.endBeats),...requestContext,title:draft.title,state:renderHandle,start_beats:timeline.startBeats,end_beats:timeline.endBeats},
    {validation,provenance:provenanceReport.render});
  draft.state=wire;
  const summary={clipCount:clips.length,trackCount:1,sourceTotalDurationSeconds:clips.reduce((a,c)=>a+c.source.duration_seconds,0),timelineTotalDurationSeconds:timeline.totalDurationSeconds,
    timelineTotalBeats:timeline.totalDurationBeats,warpRegistryEntries:Object.keys(wire.markersRegistry).length,writeDispatches:0,hashStrategy,placementMode,
    renderTransformComplete:true,renderTransformScope:'manual audio MVP / static port',serverWriteVerified:false,bindingsReady:requestContext.binding_status==='REAL_OBSERVED'};
  return deepFreeze({sourceClips:clips.map(c=>c.source),projectDraft:draft,editorState:{kind:'editor-memory',payload:inspectEditorState(editor)},saveSerializedState:{kind:'save-serialized',payload:wire},
    renderTransformedState:{kind:'render-transformed',payload:renderWire},saveRequestPreview,renderRequestPreview,
    validationReport:{...validation,networkWriteCount:0,serverSubmissionReady:false},provenanceReport,summary});
}
/** Copy-on-write overlay, including unknown/orphan registry fields and historic hash spellings. */
export function modifyExistingProject(project,{clipId,profile,hashStrategy=WarpHashStrategy.PRESERVE_EXISTING}={}) {
  validateProjectForSave(project.state);
  const editor=deserializeEditorState(rawWireState(project.state),deserializeAudioProjectState),memory=inspectEditorState(editor);
  let found=false;const allowedChanges=[];
  for(const[ti,t]of memory.tracks.entries())for(const[ci,c]of t.clips.entries())if(c.id===clipId){
    const changed=applyPostProcessProfile(c,profile);t.clips[ci]=changed.clip;found=true;
    for(const p of changed.provenance)allowedChanges.push(`/tracks/${ti}/clips/${ci}/${p.field}`);
  }
  if(clipId&&!found)fail('target arrangement not found');
  const serialized=serializeWarpState(memory,{strategy:hashStrategy,originalWire:project.state});
  if(hashStrategy===WarpHashStrategy.CURRENT_STATIC_ALGORITHM){
    for(const p of changedPaths(project.state,serialized.state))if(p.startsWith('/markersRegistry/')||p.endsWith('/warp/markersHash'))allowedChanges.push(p);
  }
  const validation=validateProjectForSave(serialized.state,{originalState:project.state,allowedChanges});
  return deepFreeze({project:{...copy(project),state:serialized.state},validation,provenance:serialized.provenance});
}
export function historicalProjectDiff(historical,result) {
  const a=deserializeAudioProjectState(historical.state),b=deserializeAudioProjectState(result.projectDraft.state),differences=[];
  let matched=0;
  for(const path of new Set([...leaves(a),...leaves(b)])){
    const get=(o,p)=>p.split('/').slice(1).reduce((v,k)=>v?.[k.replaceAll('~1','/').replaceAll('~0','~')],o),before=get(a,path),after=get(b,path);
    if(Object.is(before,after)||typeof before==='number'&&typeof after==='number'&&Math.abs(before-after)<1e-9 ||
      before&&after&&typeof before==='object'&&typeof after==='object'&&JSON.stringify(before)===JSON.stringify(after)){matched++;continue;}
    const expected=/^\/(selection|layout|contextualWindowConfig|loop|sections|routing|lyricsCorrectionsByClipId|midiCcMappings)(\/|$)/.test(path)||
      /^\/tracks\/0(?:\/clips\/\d+)?\/(id|name|color)$/.test(path)||/^\/tracks\/0\/clips\/\d+\/formantCorrection$/.test(path)&&before===undefined&&after===0;
    const critical=/\/(asset|clipId|startBeats|endBeats|readStartBeats|transposition|amplitude|warp|timing)(\/|$)/.test(path);
    differences.push({path,classification:expected?'EXPECTED_DYNAMIC':critical?'BLOCKER':'UNKNOWN_DIFFERENCE',reason:expected?'new identity/UI/display or static constructor field':critical?'unexpected semantic mismatch':'unexplained structural difference',
      beforeType:before===undefined?'missing':typeof before,afterType:after===undefined?'missing':typeof after});
  }
  const counts={MATCH:matched,EXPECTED_DYNAMIC:0,UNKNOWN_DIFFERENCE:0,BLOCKER:0};differences.forEach(d=>counts[d.classification]++);
  const maskHashDifference=JSON.stringify(historical.state.markersRegistry)!==JSON.stringify(result.projectDraft.state.markersRegistry);
  if(maskHashDifference){differences.push({path:'/markersRegistry (wire spelling)',classification:'EXPECTED_DYNAMIC',reason:'explicit hash strategy; decoded marker values compared above'});counts.EXPECTED_DYNAMIC++;}
  return {scope:'LOCAL_SEMANTIC_COMPARISON',counts,differences,serverWriteVerified:false,complete:counts.BLOCKER===0&&counts.UNKNOWN_DIFFERENCE===0};
}
export class StudioDryRunSDK { buildMerge(input){return buildMergeDryRun(input);} dispatch(){throw new NotVerifiedError('dry-run SDK has no dispatch capability');} }
