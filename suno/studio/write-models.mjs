import {BridgeError} from '../bridge/errors.mjs';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]+$/.test(v);
function fail(response,message){throw new BridgeError('suno_api_error',message+'; write outcome may already exist',response?.status);}
export function savedProject(response,projectId){
  const v=response?.result;
  if(!record(v)||v.id!==projectId||!id(v.version_id))fail(response,'save response lacks matching project/new version binding');
  return v; // Keep complete observed metadata and unknown fields.
}
export function queuedRender(response,input){
  const v=response?.result,m=v?.metadata;
  if(!record(v)||!id(v.id)||v.status!=='queued'||v.entity_type!=='song_schema'||!record(m)||
    m.studio_project_id!==input.studio_project_id||m.studio_project_version_id!==input.studio_project_version_id||
    m.studio_project_start_beats!==input.start_beats||m.studio_project_end_beats!==input.end_beats)
    fail(response,'queued render response/range/project/version relation mismatch');
  return v; // Submission only. No completion, download URL or polling inference.
}
