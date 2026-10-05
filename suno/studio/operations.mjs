import { VERIFIED_ENDPOINTS } from './api.mjs';
import { BridgeError } from '../bridge/errors.mjs';
import { fullProject, projectVersion, projectVersions } from './models.mjs';
import { pathIdentifier } from './request-builders.mjs';
import { studioError } from './errors.mjs';
export class NotImplementedError extends Error {}
export class NotVerifiedError extends NotImplementedError {
  constructor(operation) { super(operation + ': default write dispatch is disabled; current write flow is not VERIFIED'); this.name = 'NotVerifiedError'; this.kind = 'not_verified'; }
}
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
  async #read(call,signal,parse) {
    try { return parse(await this.bridge.call(call,{signal})); }
    catch(error) { if(error instanceof BridgeError||error?.kind)throw studioError(error);throw error; }
  }
  async create_project() { throw new NotVerifiedError('create_project'); }
  async get_project_metadata(project_id, { timeoutMs = 30000, requestId, signal } = {}) {
    if (typeof project_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(project_id)) throw new BridgeError('validation_error', 'project_id must be a nonempty single path identifier');
    const api = VERIFIED_ENDPOINTS.get_project_metadata;
    return this.#read({ method: api.method, path: api.pathPrefix + encodeURIComponent(project_id), timeoutMs, requestId },signal,r=>metadata(r,project_id));
  }
  async get_project(project_id, { timeoutMs = 30000, requestId, signal } = {}) {
    if (typeof project_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(project_id)) throw new BridgeError('validation_error', 'project_id must be a nonempty single path identifier');
    const api = VERIFIED_ENDPOINTS.get_project;
    return this.#read({ method: api.method, path: api.pathPrefix + encodeURIComponent(project_id), timeoutMs, requestId },signal,r=>fullProject(r,project_id));
  }
  async get_project_version(project_id, version_id, { timeoutMs = 30000, requestId, signal } = {}) {
    const project = pathIdentifier(project_id, 'project_id'), version = pathIdentifier(version_id, 'version_id');
    const api = VERIFIED_ENDPOINTS.get_project_version;
    const path = api.path.replace('{project_id}', project).replace('{version_id}', version);
    return this.#read({ method: api.method, path, timeoutMs, requestId },signal,r=>projectVersion(r,project_id,version_id));
  }
  async get_project_versions(project_id, { timeoutMs = 30000, requestId, signal } = {}) {
    const project = pathIdentifier(project_id, 'project_id');
    const api = VERIFIED_ENDPOINTS.get_project_versions;
    return this.#read({ method: api.method,
      path: api.path.replace('{project_id}', project), timeoutMs, requestId },signal,r=>projectVersions(r,project_id));
  }
  add_audio() { throw new NotImplementedError('UNKNOWN'); }
  add_clip() { throw new NotImplementedError('UNKNOWN'); }
  move_clip() { throw new NotImplementedError('UNKNOWN'); }
  trim_clip() { throw new NotImplementedError('UNKNOWN'); }
  update_clip() { throw new NotImplementedError('UNKNOWN'); }
  set_timeline() { throw new NotImplementedError('UNKNOWN'); }
  save_project() { throw new NotVerifiedError('save_project'); }
  save_version() { throw new NotVerifiedError('save_version'); }
  render_project() { throw new NotVerifiedError('render_project'); }
  render_multitrack() { throw new NotVerifiedError('render_multitrack'); }
  export_project() { throw new NotVerifiedError('export_project'); }
  export_multitrack() { throw new NotVerifiedError('export_multitrack'); }
}
