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
