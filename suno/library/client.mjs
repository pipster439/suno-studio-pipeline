import { LIBRARY_ENDPOINTS, ownLibraryBody } from './api.mjs';
import { BridgeError } from '../bridge/errors.mjs';
export class LibraryClient {
  constructor(bridge) { this.bridge = bridge; }
  async get_own_library_page(ownerId, { timeoutMs = 30000, requestId, signal } = {}) {
    if (typeof ownerId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ownerId)) {
      throw new BridgeError('validation_error', 'ownerId must be the current account id from the observed own-library request');
    }
    const api = LIBRARY_ENDPOINTS.own_library;
    const response = await this.bridge.call({ method: api.method, path: api.path,
      body: ownLibraryBody(ownerId), timeoutMs, requestId }, { signal });
    const value = response?.result;
    if (!Array.isArray(value?.clips) || typeof value.has_more !== 'boolean' ||
      value.clips.some(c => !c || typeof c.id !== 'string' || typeof c.title !== 'string' ||
        typeof c.status !== 'string' || c.entity_type !== 'song_schema' || c.user_id !== ownerId)) {
      throw new BridgeError('suno_api_error', 'unexpected own-library response or owner mismatch', response?.status);
    }
    return value; // Preserve resource metadata; never assume timeline clip identity or pagination.
  }
}
