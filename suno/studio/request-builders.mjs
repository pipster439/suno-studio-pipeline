// Pure previews from already observed constructions. No bridge, fetch, or dispatch.
import { STATIC_WRITE_CANDIDATES } from './api.mjs';
import { BridgeError } from '../bridge/errors.mjs';
import { inspectSaveSerializedState, inspectRenderTransformedState } from './state-boundaries.mjs';
const invalid = message => { throw new BridgeError('validation_error', message); };
export function pathIdentifier(v, name = 'identifier') {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v)) invalid(name + ' must be a nonempty single path identifier');
  return encodeURIComponent(v);
}
function text(v, name) { if (typeof v !== 'string') invalid(name + ' must be a string'); return v; }
function plan(operation, body, query) {
  const api = STATIC_WRITE_CANDIDATES[operation];
  return Object.freeze({ operation, status: 'FOUND_STATICALLY', dispatchAllowed: false,
    method: api.method, path: api.path + (query ? '?' + query : ''), ...(body === undefined ? {} : { body }) });
}
export function buildCreateProjectRequest({ title, major_version, trigger, extract_mode, num_stems_sent, entry_source }) {
  const query = new URLSearchParams({ title: text(title, 'title') });
  if (major_version !== undefined && !Number.isInteger(major_version)) invalid('major_version must be an integer');
  if (num_stems_sent !== undefined && !Number.isInteger(num_stems_sent)) invalid('num_stems_sent must be an integer');
  for (const [key, v] of Object.entries({ major_version, trigger, extract_mode, num_stems_sent, entry_source })) {
    if (v !== undefined) { if (!['string', 'number', 'boolean'].includes(typeof v)) invalid(key + ' must be scalar'); query.set(key, String(v)); }
  }
  return plan('create_project', undefined, query.toString());
}
export function buildSaveProjectRequest({ project_id, title, state }) {
  pathIdentifier(project_id, 'project_id');
  return plan('save_version', { project_id, state: inspectSaveSerializedState(state), title: text(title, 'title') });
}
function renderBody(input, multitrack) {
  const keys = ['title', 'project_id', 'studio_project_id', 'web_client_pathname', 'lyrics', 'start_beats', 'end_beats', 'downbeats'];
  for (const key of keys) if (!Object.hasOwn(input, key)) invalid('explicit render input required: ' + key);
  for (const key of ['project_id', 'studio_project_id']) pathIdentifier(input[key], key);
  for (const key of ['title', 'web_client_pathname', 'lyrics']) text(input[key], key);
  for (const key of ['start_beats', 'end_beats']) if (!Number.isFinite(input[key])) invalid(key + ' must be finite');
  if (input.end_beats <= input.start_beats) invalid('render range must have positive length');
  // No inference of project_id from studio_project_id. They have distinct source expressions.
  const body = { title: input.title, project_id: input.project_id, studio_project_id: input.studio_project_id,
    web_client_pathname: input.web_client_pathname, lyrics: input.lyrics,
    tags: '', negative_tags: '', style_summary: '', caption: '',
    state: inspectRenderTransformedState(input.state), start_beats: input.start_beats,
    end_beats: input.end_beats, downbeats: structuredClone(input.downbeats), render_engine: 'v2' };
  if (input.studio_project_version_id != null) { pathIdentifier(input.studio_project_version_id, 'studio_project_version_id'); body.studio_project_version_id = input.studio_project_version_id; }
  if (multitrack) {
    pathIdentifier(input.from_studio_project_id, 'from_studio_project_id');
    Object.assign(body, { from_studio_project_id: input.from_studio_project_id, format: 'wav', export_surface: 'studio_v2' });
  } else {
    if (!['fullsong_export', 'selected_time_range_export'].includes(input.export_mode)) invalid('only observed V2 export modes are previewed');
    body.export_mode = input.export_mode;
  }
  return body;
}
/** Limited to the observed V2 caller; context-window render is intentionally not synthesized. */
export const buildRenderProjectRequest = input => plan('export_project', renderBody(input, false));
export const buildRenderMultitrackRequest = input => plan('export_multitrack', renderBody(input, true));
