import { semanticDiff } from './timeline.mjs';
// The StudioClient remains strict. Reconcile an observed content-cached complete
// response in orchestration only after both saved state and actual clip agree.
export async function reconcileCachedRender(client, bridge, wire, binding, captured) {
  const request=captured?.requestBinding,response=captured?.response?.result,m=response?.metadata;
  for(const key of ['projectId','versionId','startBeats','endBeats'])if(request?.[key]!==binding[key])throw Error('Cached-render reconciliation request binding mismatch');
  if(captured.response.status!==200||response.status!=='complete'||response.entity_type!=='song_schema'||typeof response.id!=='string'||! /^[A-Za-z0-9_-]+$/.test(response.id)||m?.type!=='studio_export'||m.studio_project_start_beats!==binding.startBeats||m.studio_project_end_beats!==binding.endBeats)throw Error('Cached-render reconciliation is not a complete matching Studio export');
  const foreign=await client.get_project_version(m.studio_project_id,m.studio_project_version_id);
  const diff=semanticDiff(wire,foreign.state),ids=s=>s.tracks.flatMap(t=>t.clips.map(c=>c.asset?.id??c.clipId));
  if(diff.changes.length||JSON.stringify(ids(wire))!==JSON.stringify(ids(foreign.state)))throw Error('Cached-render reconciliation playback/source state mismatch');
  const actual=(await bridge.call({method:'GET',path:`/api/clip/${response.id}`,timeoutMs:30000})).result;
  const a=actual?.metadata;
  if(actual?.id!==response.id||actual.status!=='complete'||a?.studio_project_id!==m.studio_project_id||a.studio_project_version_id!==m.studio_project_version_id||a.studio_project_start_beats!==binding.startBeats||a.studio_project_end_beats!==binding.endBeats)throw Error('Cached-render reconciliation actual asset binding mismatch');
  return {renderClipId:response.id,renderProjectId:m.studio_project_id,renderVersionId:m.studio_project_version_id,
    requestedProjectId:binding.projectId,requestedVersionId:binding.versionId,verificationKind:'saved_state_and_clip_readback',stateDiffCount:0,sourceIdsMatch:true,reason:'Observed identical-state cached complete render; strict SDK rejection preserved'};
}
