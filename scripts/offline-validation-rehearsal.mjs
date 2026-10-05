// Explicitly synthetic A-H rehearsal seeded by the real read fixture. No server writes or fake live evidence.
import {readFile,mkdir,writeFile}from'node:fs/promises';
import {resolve}from'node:path';
import {pathToFileURL}from'node:url';
import {StudioValidationHarness,SCENARIOS}from'../suno/recorder/studio-validation.mjs';
import {ReplayTransport}from'../suno/studio/replay.mjs';
import {sanitizeProjectTemplate}from'../suno/studio/project-template.mjs';
import {historicalMergeInput}from'../examples/studio-20-clip-dry-run.mjs';
import {buildMergeDryRun,historicalProjectDiff,WarpHashStrategy}from'../suno/studio/dry-run-sdk.mjs';
import {predictAddClipDiff,predictMoveClipDiff,predictTranspositionDiff}from'../suno/studio/predictions.mjs';
import {rawWireState,deserializeEditorState,serializeProjectState,prepareRenderTransformedState}from'../suno/studio/state-boundaries.mjs';
import {deserializeAudioProjectState,serializeAudioProjectState}from'../suno/studio/clip-pipeline.mjs';
import {serializeWarpState}from'../suno/studio/warp-registry.mjs';
import {buildSaveProjectRequest,buildRenderProjectRequest}from'../suno/studio/request-builders.mjs';
import {transformRenderState,deriveDownbeats,renderRange}from'../suno/studio/render-pipeline.mjs';
export async function runOfflineRehearsal(output){
  const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw Error('offline rehearsal attempted network');};
  try{
    const fixture=JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json',import.meta.url),'utf8')),historical=historicalMergeInput(fixture);
    delete historical.render.downbeats;const dry=buildMergeDryRun(historical),diff=historicalProjectDiff(fixture,dry);
    const template=sanitizeProjectTemplate(fixture),syntheticProject={...structuredClone(fixture),id:'offline-project',title:'Offline fixture project',latest_version_id:'offline-version-0',state:template.draft.state};
    let current=structuredClone(syntheticProject),versionIndex=0,readCount=0;
    async function replayRead(method,path,body){const transport=new ReplayTransport([{request:{method,path},response:{status:200,body}}]);readCount++;return transport;}
    const reader={async get_project(id){const t=await replayRead('GET','/api/studio/project/'+id,current);return t.client().get_project(id);},async get_project_version(id,v){const t=await replayRead('GET',`/api/studio/${id}/version/${v}`,{id:v,project_id:id,state:current.state});return t.client().get_project_version(id,v);}};
    const runId='offline-'+Date.now();await mkdir(output,{recursive:true});const store=await new StudioValidationHarness(resolve(output,'rehearsal-captures-'+runId),{reader,origin:'SIMULATED_OFFLINE'}).init(),scenarios=[];
    let arrangementId;
    for(const scenario of Object.keys(SCENARIOS)){
      let prediction={state:structuredClone(current.state)},preview=null,response=null;
      if(scenario==='B_ADD'){prediction=predictAddClipDiff(current.state,historical.sources[0],{profile:historical.perClipProfiles[0],compatibility:historical.compatibility});arrangementId=prediction.arrangementId;}
      if(scenario==='D_MOVE')prediction=predictMoveClipDiff(current.state,arrangementId,1);
      if(scenario==='F_TRANSPOSE')prediction=predictTranspositionDiff(current.state,arrangementId,-5);
      if(scenario==='A_CREATE'){preview={method:'POST',path:'/api/studio/create-project?title=Offline&major_version=2',body:null};response={id:current.id,title:current.title};}
      if(['C_SAVE','E_SAVE','G_SAVE'].includes(scenario)){
        const editor=deserializeEditorState(rawWireState(current.state),deserializeAudioProjectState),save=serializeProjectState(editor,m=>serializeWarpState(m,{strategy:WarpHashStrategy.PRESERVE_EXISTING,originalWire:current.state}).state);
        preview=buildSaveProjectRequest({project_id:current.id,title:current.title,state:save});response={version_id:'offline-version-'+(++versionIndex)};}
      if(scenario==='H_EXPORT'){
        const editor=deserializeEditorState(rawWireState(current.state),deserializeAudioProjectState),state=prepareRenderTransformedState(editor,transformRenderState,serializeAudioProjectState),range=renderRange(current.state);
        preview=buildRenderProjectRequest({title:current.title,lyrics:'',project_id:'offline-workspace',studio_project_id:current.id,studio_project_version_id:current.latest_version_id,web_client_pathname:'/studio',state,start_beats:range.startBeats,end_beats:range.endBeats,downbeats:deriveDownbeats(current.state.timing,range.startBeats,range.endBeats),export_mode:'fullsong_export'});response={id:'offline-rendered-clip',title:'Offline render reference'};
      }
      if(preview)prediction.request={method:preview.method,path:preview.path,body:preview.body??null};
      const begun=await store.begin(scenario,{runId,projectId:scenario==='A_CREATE'?null:current.id,prediction});
      const stamp=new Date().toISOString(),eventId='offline-'+scenario;
      if(preview){
        const request={method:preview.method,path:preview.path,body:preview.body??null,url:'https://studio-api-prod.suno.com'+preview.path};
        await store.add({captureId:begun.active.captureId,eventId,eventType:'request',timestamp:stamp,request,synthetic:true});
        const transport=new ReplayTransport([{request:{method:request.method,path:request.path,body:request.body},response:{status:200,body:response}}]);const result=await transport.call(request);transport.assertConsumed();
        await store.add({captureId:begun.active.captureId,eventId,eventType:'response',timestamp:stamp,response:{status:result.status,body:result.result},durationMs:0,synthetic:true});
      }else await store.add({captureId:begun.active.captureId,eventId,eventType:'navigation',timestamp:stamp,event:'offline-state-mutation-marker',synthetic:true});
      current.state=structuredClone(prediction.state);if(response?.version_id)current.latest_version_id=response.version_id;
      const finished=await store.end({drainMs:0});scenarios.push({scenario,start:true,capture:true,diff:true,compare:true,finish:true,report:finished.report});
    }
    const success=scenarios.every(s=>s.report.captureComplete&&s.report.comparisons.state?.matched&&(!s.report.comparisons.request||s.report.comparisons.request.matched));
    const result={origin:'SIMULATED_OFFLINE',seed:'real GET fixture; responses and A-H state evolution synthetic, never live evidence',success,scenarios,fixtureReplayReadCount:readCount,
      networkRequestCount:network,realStudioWrites:{POST:0,PUT:0,PATCH:0,DELETE:0},humanReviewRequired:true,documentsUpgraded:false,LIVE_VALIDATION_READY:success};
    const artifacts={'offline_validation_rehearsal.json':result,'dry_run_summary.json':dry.summary,'historical_project_diff.json':diff,
      'dry_run_provenance.json':dry.provenanceReport,'template_sanitization_report.json':template.report};
    for(const[name,v]of Object.entries(artifacts))await writeFile(resolve(output,name),JSON.stringify(v,null,2)+'\n');
    if(!success)throw Error('offline scenario comparison failed; see rehearsal artifact');return result;
  }finally{globalThis.fetch=originalFetch;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=await runOfflineRehearsal(resolve(process.argv[2]??'captures/live-ready/20261005'));console.log(JSON.stringify({success:r.success,scenarios:r.scenarios.length,networkRequestCount:r.networkRequestCount,realStudioWrites:r.realStudioWrites,LIVE_VALIDATION_READY:r.LIVE_VALIDATION_READY}));}
