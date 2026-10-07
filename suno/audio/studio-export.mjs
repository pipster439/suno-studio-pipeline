import { createHash } from 'node:crypto';
import { rawWireState, deserializeEditorState, inspectEditorState, prepareRenderTransformedState } from '../studio/state-boundaries.mjs';
import { deserializeAudioProjectState, serializeAudioProjectState } from '../studio/clip-pipeline.mjs';
import { transformRenderState, deriveDownbeats } from '../studio/render-pipeline.mjs';
import { buildRenderProjectRequest } from '../studio/request-builders.mjs';
import { exportModeFor } from './export-strategy.mjs';

export function prepareFullSongExport(readback, { projectId, versionId, title, exportMode = exportModeFor() }) {
  if (readback.id !== undefined && readback.id !== versionId || readback.project_id !== undefined && readback.project_id !== projectId)
    throw Error('Full-song export readback project/version mismatch');
  const clips = readback.state.tracks.flatMap(track => track.clips);
  if (!clips.length || clips.some(c => !Number.isFinite(c.endBeats))) throw Error('Full-song export requires a finite saved timeline');
  const endBeats = Math.max(...clips.map(c => c.endBeats));
  if (!(endBeats > 0)) throw Error('Full-song export requires a positive timeline end');
  const editor = deserializeEditorState(rawWireState(readback.state), deserializeAudioProjectState);
  const timing = transformRenderState(inspectEditorState(editor)).timing;
  const input = { title, project_id: projectId, studio_project_id: projectId, studio_project_version_id: versionId,
    web_client_pathname: '/studio', lyrics: '',
    state: prepareRenderTransformedState(editor, transformRenderState, serializeAudioProjectState),
    start_beats: 0, end_beats: endBeats, downbeats: deriveDownbeats(timing, 0, endBeats),
    export_mode: exportMode, render_engine: 'v2',
    ...(exportMode === 'rendered_context_window' ? {from_studio_project_id:projectId} : {}) };
  return { input, preview: buildRenderProjectRequest(input), endBeats };
}

// Describe the actual SDK wire request, not its log name or a UI export action.
export function describeExportRequest(call) {
  const body = call.body;
  if (call.method !== 'POST' || call.path !== '/api/studio/render-state' || !body ||
      !['fullsong_export','rendered_context_window'].includes(body.export_mode) || body.render_engine !== 'v2' || body.project_id !== body.studio_project_id ||
      !body.studio_project_version_id || body.start_beats !== 0 || !Number.isFinite(body.end_beats) || body.end_beats <= 0)
    throw Error('Invalid backend full-song export request');
  if(body.export_mode==='rendered_context_window'&&body.from_studio_project_id!==body.studio_project_id)throw Error('Context export source project mismatch');
  return { endpoint: call.path, method: call.method, export_mode: body.export_mode, render_engine: body.render_engine,
    projectId: body.studio_project_id, versionId: body.studio_project_version_id,
    start_beats: body.start_beats, end_beats: body.end_beats,
    bodyKeys: Object.keys(body).sort(), stateSha256: createHash('sha256').update(JSON.stringify(body.state)).digest('hex'),
    trackCount: body.state.tracks.length, arrangementCount: body.state.tracks.reduce((n, t) => n + t.clips.length, 0),
    downbeatCount: body.downbeats.length };
}

export function exportCompletionStatus(job, binding, complete = null) {
  const acknowledged = job.renderJobs?.find(record => record.id === job.renderClipId);
  const proof = !acknowledged?.terminalFailure && acknowledged?.materialization?.binding ? acknowledged.materialization : null;
  const observed = complete ?? (proof ? {id:acknowledged.id,status:proof.status,metadata:{studio_project_id:proof.binding.projectId,studio_project_version_id:proof.binding.versionId,studio_project_start_beats:proof.binding.startBeats,studio_project_end_beats:proof.binding.endBeats}} : null);
  const m = observed?.metadata;
  const metadataMatches = job.projectId === binding.projectId && job.versionId === binding.versionId &&
    !!observed && !!job.renderClipId && observed.id === job.renderClipId && observed.status === 'complete' &&
    m?.studio_project_id === binding.projectId && m.studio_project_version_id === binding.versionId &&
    m.studio_project_start_beats === binding.startBeats && m.studio_project_end_beats === binding.endBeats;
  const deliveryResolved = metadataMatches && acknowledged?.state === 'READY' && job.renderLifecycle?.state === 'READY' &&
    job.renderLifecycle.selectedId === job.renderClipId && !!acknowledged.delivery?.source;
  const library = job.libraryExport;
  const libraryVisible = metadataMatches && library?.renderId === job.renderClipId && library.libraryVisible === true;
  const studioBadgeVerified = libraryVisible && library.studioBadgeVerified === true && library.studioProvenanceVerified === true &&
    library.projectId === binding.projectId && library.versionId === binding.versionId;
  return { studioProjectSaved: !!job.projectId && !!job.versionId,
    renderSubmitted: !!acknowledged, renderId: job.renderClipId ?? null,
    renderReady: !!metadataMatches, deliveryResolved: !!deliveryResolved,
    libraryVisible: !!libraryVisible, studioBadgeVerified: !!studioBadgeVerified,
    exportLifecycleState: studioBadgeVerified ? 'STUDIO_BADGE_VERIFIED' : libraryVisible ? 'LIBRARY_VISIBLE' : metadataMatches ? 'RENDER_READY' : acknowledged ? 'RENDER_SUBMITTED' : 'PROJECT_SAVED',
    finalSongId: libraryVisible ? library.finalSongId : null,
    reason: studioBadgeVerified ? null : libraryVisible ? 'STUDIO_PROVENANCE_NOT_VERIFIED' : 'FINAL_LIBRARY_ASSET_NOT_CREATED',
    projectId: binding.projectId, versionId: binding.versionId, startBeats: binding.startBeats, endBeats: binding.endBeats,
    runSuccess: !!job.projectId && !!job.versionId && !!acknowledged && !!studioBadgeVerified };
}

export function requireExportReady(status) {
  if (!status.runSuccess) throw Object.assign(Error(`RUN INCOMPLETE: ${status.reason}; Library membership and Studio provenance are required`), { kind: 'export_incomplete', exportStatus: status });
  return status;
}
