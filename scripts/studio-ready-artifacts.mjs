import {readFile,writeFile,mkdir}from'node:fs/promises';
import {resolve}from'node:path';import{createHash}from'node:crypto';
import privacy from'../shared/studio-privacy.cjs';
import {auditSaveRoundTrip}from'../suno/studio/serializer-audit.mjs';
import {RENDER_EVIDENCE,ExportMode,RenderEngine}from'../suno/studio/render-pipeline.mjs';
import {validateCall}from'../suno/bridge/errors.mjs';
import {endpointGate}from'../suno/studio/endpoint-registry.mjs';
const output=resolve(process.argv[2]??'captures/live-ready/20261005');await mkdir(output,{recursive:true});
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const fixture=await read('fixtures/studio_project_get.json'),rehearsal=await read(resolve(output,'offline_validation_rehearsal.json'));
const inventory=await read('suno/studio/endpoint-inventory.json'),source=await read('captures/official-write/20261005/manifest.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const unit=await readFile(resolve(output,'unit-tests.log'),'utf8'),integration=await readFile(resolve(output,'integration-default.log'),'utf8');
const counts=Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,Number(unit.match(new RegExp('# '+k+' (\\d+)'))?.[1])]));
if(counts.fail!==0||counts.pass<120||!rehearsal.success||rehearsal.networkRequestCount!==0||!integration.includes('# skipped 3'))throw Error('current successful tests/rehearsal required');
const modules=['0kfolb-xhy_j4.js','3g9-3c-u44c0o.js'];
const sources=[];for(const name of modules){const row=source.rows.find(r=>r.name===name);const bytes=await readFile(resolve('captures/official-write/20261005',name));if(sha(bytes)!==row.sha256)throw Error('source snapshot changed');sources.push({bundle:name,sha256:row.sha256});}
const render={...RENDER_EVIDENCE,sources,scope:'manual constant-BPS audio main lanes; no plugins/takes; static port only',
  transforms:[
    {order:1,name:'filterEffectivelyMutedTracks',changes:'if any solo tracks keep solo, otherwise remove muted tracks',mutating:false},
    {order:2,name:'normalizeRenderStateStage1',...RENDER_EVIDENCE.stage1,changes:'main clips: audio requires asset.type clip; video requires asset.type video; other kinds untouched by this stage',takeLanes:'untouched',mutating:false},
    {order:3,name:'normalizeRenderStateStage2',...RENDER_EVIDENCE.stage2,changes:'main clips: remove muted clips',takeLanes:'untouched',mutating:false,copyPolicy:'official no-mute fast path may return same input; local always copies'},
    {order:4,name:'deriveManualRenderTiming / metronome overlay',...RENDER_EVIDENCE.derivedTiming,changes:'timing manual / bps / bpsAutomation [] / firstBeatSeconds 0; metronome disabled amplitude 1',mutating:false},
    {order:5,name:'serializeAudioProjectState',module:634782,changes:'inline markers removed from clip.warp; markersHash generated; fresh registry referenced-only',mutating:false,status:'FOUND_STATICALLY'}],
  range:{source:'audible native state BEFORE muted-clip normalization',selection:'min/max anchor/focus; equal selection or full-song flag uses heard range',offset:'no derived downbeat offset applied to start_beats/end_beats',emptyFallback:[0,240]},
  downbeats:{...RENDER_EVIDENCE.downbeat,formula:'beat=ceil(start); beat<floor(end); [seconds(beat)-seconds(start), positiveModulo(beat,4)+1]',serverVerified:false},
  enums:{export_mode:Object.values(ExportMode),render_engine:Object.values(RenderEngine),v1:'legacy cache-key fallback only; not established wire enum/default',studio_export:'clip_type only, not export_mode'},
  decisionTree:{v2Export:'full-song flag ? fullsong_export : selected_time_range_export',equalSelectionFallback:'changes range, does not change selected_time_range_export enum',multitrack:'wav / v2 / studio_v2; track mute/solo reset before normalization; download_url response distinct'},
  response:{consumed:['moderation_error_message','id','title'],openSchema:true,next:'V2 onRenderedClip state drives toast link /song/${id}',polling:'no polling in recovered export consumer; no verified polling endpoint; RenderJob.poll blocked'},
  legacy:{modules:[180172,831290],mainLanePort:true,takePreviewSplitPort:false,separateFromV2:true},
  blockers:['nonempty aligned source lyrics / range mapping not fully ported; captured aligned lyrics unavailable','follow-track/tempo automation/take lanes deliberately outside current MVP','full response body and successful output require legitimate live write access'],
  renderTransformComplete:true,meaning:'scoped manual audio MVP; not a claim of complete Studio/lyrics implementation',writeDispatchAllowed:false};
const features=[
 ['READ / lossless','VERIFIED','High',true,true,true,true,null],
 ['20-clip dry-run / tail / explicit processing','FOUND_STATICALLY','High',true,true,false,false,null],
 ['template sanitization / unknown preservation','FOUND_STATICALLY','High',true,true,false,false,null],
 ['save serialization / no-op audit','FOUND_STATICALLY','High',true,true,false,false,'server hash compatibility/persistence'],
 ['V2 render manual audio transforms / downbeats','FOUND_STATICALLY','High',true,true,false,false,'official payload comparison/output'],
 ['aligned nonempty lyric range mapping','FOUND_STATICALLY','Partial',false,false,false,false,'remaining port + source aligned metadata'],
 ['uploader pitch restoration opt-in','CORRELATED','historical workflow only',true,true,false,false,'causal dynamic verification'],
 ['gain/loudness repair derivation','UNKNOWN','insufficient',false,true,false,false,'third-party worker inputs/effect'],
 ['passive capture fetch/XHR/beacon/WS + durable scenarios','FOUND_STATICALLY','VM/local server tested',true,true,false,false,'first normal browser installation/live recording'],
 ['path-aware diff / predictions / deferred save comparisons','FOUND_STATICALLY','local tested',true,true,false,false,'real official action/readback evidence'],
 ['offline replay / A-H rehearsal','OBSERVED','offline test only',true,true,false,false,null],
 ['per-endpoint eligibility registry + physical write guard','FOUND_STATICALLY','local tested',true,true,false,false,'reviewed activation adapter after permission + VERIFIED reproduction'],
 ['render polling','UNKNOWN','none',false,true,false,false,'observed and read-verified polling endpoint'],
 ['real create/add/save/postprocess/export','FOUND_STATICALLY','static only',false,false,false,false,'normal Studio write access'],
];
const sdk={LIVE_VALIDATION_READY:true,meaning:'capture/diff/replay/offline tools ready; does not grant write access or dispatch',scope:render.scope,
  tests:counts,realStudioWrites:rehearsal.realStudioWrites,harnessBrowserLiveVerified:false,productionWriteActivationLocked:true,
  features:features.map(([feature,status,confidence,implemented,tested,liveVerified,dispatchAllowed,remainingBlocker])=>({feature,status,confidence,implemented,tested,liveVerified,dispatchAllowed,remainingBlocker})),
  remainingStaticWork:render.blockers.slice(0,2),missingInputs:['full source duration metadata, not inferred from warp extents','aligned lyric data','real workspace/project/version write bindings'],
  evidenceUpgrade:'manual review plus separate controlled reproduction/readback; no automatic document upgrade'};
const capture={implemented:true,liveVerified:false,passive:true,doesNotDispatchToSuno:true,
  transports:{fetch:'original promise/inputs/response preserved; immediate clone',XMLHttpRequest:'native calls/returns preserved; loadend response',beacon:'accepted boolean metadata; no invented HTTP response',WebSocket:'constructor/prototype/static constants preserved; JSON frames/metadata, binary omitted'},
  scope:'HTTPS/WSS studio-api-prod.suno.com /api/studio/ only; telemetry ignored',redaction:'browser before GM queue and backend before durable append; privacy reused',
  lifecycle:'document-start + GM redacted queue + persistent server control + NDJSON append + stop acknowledgment + pending/queued/dropped/omitted checks',
  navigation:'reload retains page identity; SPA route recorded per event; single official tab lease; pagehide marker',
  scenarios:['A_CREATE','B_ADD','C_SAVE','D_MOVE','E_SAVE','F_TRANSPOSE','G_SAVE','H_EXPORT'],
  operation:'paired /studio-validation page or npm run studio-validation -- begin/end/report/export; no DevTools/JSON copy',
  limits:{bodyBytes:1048576,bodyReadTimeoutMs:10000,stopDrainMsMax:10000,binary:'omitted with gap flagged',extensionStorageFailure:'best effort; dropped flags; do not accept incomplete capture',beacon:'no response access means observation cannot prove HTTP success'},
  unsavedEditorBoundary:'GET may see saved state only; B/D/F automatically correlate to C/E/G, no fabricated native editor snapshot',
  installationsChangedThisTask:false,currentTransportVersion:'1.3.16 unchanged',generatedPassiveHarnessVersion:'1.0.0',
  harnessSha256:sha(await readFile('userscripts/studio-validation.user.js'))};
const prediction={implemented:['ADD','MOVE','TRANSPOSE','FADE','SAVE serialization comparison','EXPORT state/range/downbeats'],
  classification:['MATCH','EXTRA_REAL_FIELD','MISSING_PREDICTED_FIELD','DIFFERENT_VALUE','UNKNOWN_TRANSFORM'],
  diffKinds:['added','removed','changed','type_changed','array_reordered'],
  dynamicIds:'only explicit arrangement ID paths; aligned using matching source asset; different source never masked',
  automaticRunAnalysis:'B→C, D→E, F→G; MOVE/TRANSPOSE observed action parameter conditional rule check, not an independent action prediction',
  exactAddPrediction:'optional source/profile prediction file; without full metadata remains NEEDS_SOURCE_METADATA',
  fullExportComparison:'state/range/downbeats supported; nonempty lyrics/workspace binding not invented',
  humanReviewRequired:true,documentsChanged:false,offlineUpgradeEligible:false};
let blocked=0;for(const method of ['POST','PUT','PATCH','DELETE'])for(const name of ['create-project','save-project','render-state','render-state-multitrack','unknown-future-write'])for(const path of ['/api/studio/'+name,'/api/%73tudio/'+name,'/api/%2573tudio/'+name,'/api//studio/'+name,'/api/x/../studio/'+name]){
  try{validateCall({method,path});throw Error('unblocked write');}catch(e){if(e.kind!=='not_verified')throw e;blocked++;}}
const writes={realStudioWrites:rehearsal.realStudioWrites,fullRehearsalNetworkRequests:rehearsal.networkRequestCount,blockedGuardChecks:blocked,
  allInventoryWritesDenied:inventory.endpoints.filter(e=>e.method!=='GET').every(e=>!endpointGate(e.method,e.path.replace(/\{[^}]+\}/g,'fixture-id')).dispatchAllowed),
  guards:['StudioClient write methods throw','dry-run SDK has no transport','controller / SunoBridge / BridgeHub validateCall blocks namespace non-GET and known write routes even GET'],
  futureEligibility:'VERIFIED + explicit local config + per-endpoint schema/evidence/manual review; still no production activation',
  runningOldControllersRestarted:false,officialBrowserUsed:false,bundleAcquisitionsThisTask:0,entitlementChanges:0};
const artifacts={'sdk_status.json':sdk,'endpoint_inventory.json':inventory,'render_pipeline.json':render,'capture_harness_summary.json':capture,'prediction_engine_summary.json':prediction,
  'serializer_round_trip.json':auditSaveRoundTrip(fixture.state),'write_dispatch_audit.json':writes,'source_duration_evidence.json':await read(resolve(output,'source-duration-evidence.json')),
  'static_source_hashes.json':sources};
// Export evidence values, never private source fixture or raw capture bodies.
for(const[name,v]of Object.entries(artifacts))await writeFile(resolve(output,name),JSON.stringify(privacy.evidence(v),null,2)+'\n');
const scans=[];for(const name of [...Object.keys(artifacts),'dry_run_summary.json','dry_run_provenance.json','historical_project_diff.json','template_sanitization_report.json','offline_validation_rehearsal.json']){
  const raw=await read(resolve(output,name)),clean=JSON.stringify(privacy.evidence(raw));
  const patterns={jwt:/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,bearerCredential:/\bBearer\s+[A-Za-z0-9_.-]{16,}/i,email:/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,signedQuery:/(?:x-amz-signature|x-goog-signature|signature)=[A-Za-z0-9%+/]{16,}/i};
  const findings=Object.entries(patterns).filter(([,p])=>p.test(clean)).map(([name])=>name);scans.push({file:name,findings});
  if(findings.length)throw Error('sensitive evidence output: '+name);
}
await writeFile(resolve(output,'privacy_audit.json'),JSON.stringify({scope:'prospective sanitized small evidence JSON; final ZIP scan repeated separately',passed:true,authHeadersPersisted:false,originalFixturesModified:false,
  keywordPolicy:'schema names/test labels such as Authorization are allowed; actual credential/email/signature values are not',files:scans,privateRawCapturesIncluded:false},null,2)+'\n');
console.log(JSON.stringify({LIVE_VALIDATION_READY:true,tests:counts,inventoryEndpoints:inventory.endpoints.length,guardChecks:blocked,privacyPassed:true,realStudioWrites:rehearsal.realStudioWrites}));
