// Full offline lifecycle. Response shapes are LIVE_CAPTURE-derived; readback state
// is locally reconstructed, explicitly not a newly captured production response.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {ReplayTransport} from '../suno/studio/replay.mjs';
import {buildProjectDraft,buildStudioClipDraft} from '../suno/studio/dry-run-sdk.mjs';
import {serializeAudioProjectState,deserializeAudioProjectState} from '../suno/studio/clip-pipeline.mjs';
import {rawWireState,deserializeEditorState,inspectEditorState,serializeProjectState,prepareRenderTransformedState,updateEditorState} from '../suno/studio/state-boundaries.mjs';
import {buildCreateProjectRequest,buildSaveProjectRequest,buildRenderProjectRequest} from '../suno/studio/request-builders.mjs';
import {transformRenderState,deriveDownbeats} from '../suno/studio/render-pipeline.mjs';
const fixture=async name=>JSON.parse(await readFile(new URL('../fixtures/write-validation/'+name,import.meta.url),'utf8'));
export async function lifecycleFixture(){
  const responses=await Promise.all(['create_project_response.json','save_project_response.json','save_project_transposed_response.json','render_state_queued_response.json'].map(fixture));
  const [created,saved,transposed,rendered]=responses;
  const template=JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json',import.meta.url),'utf8'));
  const draft=buildProjectDraft(template,template.state.timing,{title:created.title});
  draft.state.tracks[0].id='track_fixture';
  const clip=buildStudioClipDraft({clip_id:'source_fixture',duration_seconds:32/template.state.timing.bps,title:'Fixture audio'},template.state.timing,{warp:{identity_project_bps:true}}).clip;
  clip.id='arrangement_fixture';clip.startBeats=0;clip.endBeats=32;draft.state.tracks[0].clips.push(clip);
  const wire=serializeAudioProjectState(draft.state);
  const editor=deserializeEditorState(rawWireState(wire),deserializeAudioProjectState);
  const initial=serializeProjectState(editor,serializeAudioProjectState);
  const changed=updateEditorState(editor,m=>{m.tracks[0].clips[0].transposition=-5;return m;});
  const second=serializeProjectState(changed,serializeAudioProjectState);
  const renderState=prepareRenderTransformedState(changed,transformRenderState,serializeAudioProjectState);
  const renderInput={title:rendered.title,project_id:created.id,studio_project_id:created.id,studio_project_version_id:transposed.version_id,web_client_pathname:'/studio',lyrics:'',state:renderState,start_beats:0,end_beats:32,downbeats:deriveDownbeats(transformRenderState(inspectEditorState(changed)).timing,0,32),export_mode:'fullsong_export'};
  const createInput={title:created.title,major_version:2},saveInput={project_id:created.id,title:saved.title,state:initial},secondInput={project_id:created.id,title:transposed.title,state:second};
  const previews=[buildCreateProjectRequest(createInput),buildSaveProjectRequest(saveInput),buildSaveProjectRequest(secondInput),buildRenderProjectRequest(renderInput)];
  const request=p=>({method:p.method,path:p.path,...(p.body===undefined?{}:{body:p.body})});
  const readback=(response,state)=>({id:response.version_id,project_id:created.id,state:structuredClone(state),fixture_origin:'RECONSTRUCTED_LOCAL_NOT_CAPTURED'});
  const record=(req,body)=>({request:req,response:{status:200,body}});
  const read1=readback(saved,previews[1].body.state),read2=readback(transposed,previews[2].body.state);
  const records=[record(request(previews[0]),created),record(request(previews[1]),saved),record({method:'GET',path:`/api/studio/${created.id}/version/${saved.version_id}`},read1),record(request(previews[2]),transposed),record({method:'GET',path:`/api/studio/${created.id}/version/${transposed.version_id}`},read2),record(request(previews[3]),rendered)];
  return {createInput,saveInput,secondInput,renderInput,editor,changed,previews,responses,records,read1,read2};
}
export async function runFixtureLifecycle(){
  const f=await lifecycleFixture(),transport=new ReplayTransport(f.records),client=transport.client({allow_verified_studio_writes:true});
  const project=await client.create_project(f.createInput);
  const save=await client.save_project({...f.saveInput,project_id:project.id});
  const version1=await client.get_project_version(project.id,save.version_id);
  const save2=await client.save_project({...f.secondInput,project_id:project.id});
  const version2=await client.get_project_version(project.id,save2.version_id);
  const render=await client.render_project({...f.renderInput,studio_project_id:project.id,studio_project_version_id:save2.version_id});
  transport.assertConsumed();
  return {origin:'OFFLINE_FIXTURE_REPLAY',responseFixturesOrigin:'LIVE_CAPTURE_DERIVED',readbackStateOrigin:'RECONSTRUCTED_LOCAL_NOT_CAPTURED',project,save,version1,save2,version2,render,productionNetworkCount:0,networkWriteCount:transport.networkWriteCount,renderCompletionVerified:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await runFixtureLifecycle();console.log(JSON.stringify({origin:r.origin,steps:6,transposition:r.version2.state.tracks[0].clips[0].transposition,renderStatus:r.render.status,productionNetworkCount:r.productionNetworkCount,renderCompletionVerified:false}));}
