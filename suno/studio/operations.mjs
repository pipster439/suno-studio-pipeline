import { VERIFIED_ENDPOINTS } from './api.mjs';
import { BridgeError } from '../bridge/errors.mjs';
import { fullProject } from './models.mjs';
export class NotImplementedError extends Error {}
function metadata(response, expectedId) {
  const value = response?.result;
  if (!value || typeof value.id !== 'string' || typeof value.title !== 'string' ||
      typeof value.created_at !== 'string' || typeof value.updated_at !== 'string' ||
      typeof value.archived !== 'boolean' || !Number.isInteger(value.major_version) ||
      expectedId !== undefined && value.id !== expectedId) {
    throw new BridgeError('suno_api_error', 'unexpected project metadata; write outcome may already exist', response?.status);
  }
  return value; // Preserve unknown fields; this is not a timeline model.
}
export class StudioClient {
  constructor(bridge) { this.bridge = bridge; }
  async create_project({ title = 'Untitled Project', major_version = 2, timeoutMs = 30000, requestId, signal } = {}) {
    const api = VERIFIED_ENDPOINTS.create_project;
    if (title !== api.title || major_version !== api.major_version) throw new NotImplementedError('only the observed default title and major_version=2 creation flow is VERIFIED');
    const response = await this.bridge.call({ method: api.method,
      path: api.path + '?title=' + encodeURIComponent(title) + '&major_version=' + major_version,
      timeoutMs, requestId }, { signal }); // Omit body; never retry a write here.
    const value = metadata(response);
    if (value.title !== title || value.major_version !== major_version) throw new BridgeError('suno_api_error', 'created metadata differs from requested values; project may already exist', response?.status);
    return value;
  }
  async get_project_metadata(project_id, { timeoutMs = 30000, requestId, signal } = {}) {
    if (typeof project_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(project_id)) throw new BridgeError('validation_error', 'project_id must be a nonempty single path identifier');
    const api = VERIFIED_ENDPOINTS.get_project_metadata;
    return metadata(await this.bridge.call({ method: api.method, path: api.pathPrefix + encodeURIComponent(project_id), timeoutMs, requestId }, { signal }), project_id);
  }
  async get_project(project_id, { timeoutMs = 30000, requestId, signal } = {}) {
    if (typeof project_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(project_id)) throw new BridgeError('validation_error', 'project_id must be a nonempty single path identifier');
    const api = VERIFIED_ENDPOINTS.get_project;
    return fullProject(await this.bridge.call({ method: api.method, path: api.pathPrefix + encodeURIComponent(project_id), timeoutMs, requestId }, { signal }), project_id);
  }
  add_audio() { throw new NotImplementedError('UNKNOWN'); }
  add_clip() { throw new NotImplementedError('UNKNOWN'); }
  move_clip() { throw new NotImplementedError('UNKNOWN'); }
  trim_clip() { throw new NotImplementedError('UNKNOWN'); }
  update_clip() { throw new NotImplementedError('UNKNOWN'); }
  set_timeline() { throw new NotImplementedError('UNKNOWN'); }
  save_project() { throw new NotImplementedError('FOUND_STATICALLY: whole-state save and version_id response; not write-verified'); }
  save_version() { throw new NotImplementedError('FOUND_STATICALLY: official saveProjectVersion aliases project save; not write-verified'); }
  export_project() { throw new NotImplementedError('FOUND_STATICALLY: render-state; not write-verified'); }
  export_multitrack() { throw new NotImplementedError('FOUND_STATICALLY: render-state-multitrack; not write-verified'); }
}
