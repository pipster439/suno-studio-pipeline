import { BridgeError } from '../bridge/errors.mjs';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @returns {import('./models.js').StudioProject} */
export function fullProject(response, expectedId) {
  const value = response?.result;
  if (!object(value) || value.id !== expectedId || !object(value.state) ||
    !Array.isArray(value.state.tracks) || !object(value.state.timing) || !object(value.state.selection) ||
    value.latest_version_id !== undefined && value.latest_version_id !== null && typeof value.latest_version_id !== 'string') {
    throw new BridgeError('suno_api_error', 'project response does not contain the expected full Studio state', response?.status);
  }
  // No reconstruction, deserialization, clipping, defaulting or filtering of server state.
  return value;
}

/** Version identity is distinct from project identity. Return the entire response, not a narrowed schema. */
export function projectVersion(response, projectId, versionId) {
  const value = response?.result;
  if (!object(value) || value.id !== versionId || value.project_id !== projectId ||
      !object(value.state) || !Array.isArray(value.state.tracks) ||
      !object(value.state.timing) || !object(value.state.selection)) {
    throw new BridgeError('suno_api_error', 'version response does not match project/version identifiers and Studio state', response?.status);
  }
  return value;
}
export function projectVersions(response, projectId) {
  const value = response?.result;
  if (!object(value) || value.id !== projectId || !Array.isArray(value.aggregated_versions) ||
      !value.aggregated_versions.every(group => object(group) && Array.isArray(group.versions) &&
        group.versions.every(v => object(v) && typeof v.version_id === 'string'))) {
    throw new BridgeError('suno_api_error', 'versions response does not match observed project/list schema', response?.status);
  }
  return value;
}
