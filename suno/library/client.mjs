import { LIBRARY_ENDPOINTS, ownLibraryBody } from './api.mjs';
import { BridgeError } from '../bridge/errors.mjs';
export class LibraryClient {
  constructor(bridge) { this.bridge = bridge; }
  async get_own_library_page(ownerId, { cursor = null, timeoutMs = 30000, requestId, signal } = {}) {
    if (typeof ownerId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ownerId)) {
      throw new BridgeError('validation_error', 'ownerId must be the current account id from the observed own-library request');
    }
    if (cursor !== null && (typeof cursor !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cursor)))
      throw new BridgeError('validation_error', 'Invalid observed Library cursor');
    const api = LIBRARY_ENDPOINTS.own_library;
    const response = await this.bridge.call({ method: api.method, path: api.path,
      body: ownLibraryBody(ownerId, cursor), timeoutMs, requestId }, { signal });
    const value = response?.result;
    if (!Array.isArray(value?.clips) || typeof value.has_more !== 'boolean' ||
      value.clips.some(c => !c || typeof c.id !== 'string' || typeof c.title !== 'string' ||
        typeof c.status !== 'string' || c.entity_type !== 'song_schema' || c.user_id !== ownerId)) {
      throw new BridgeError('suno_api_error', 'unexpected own-library response or owner mismatch', response?.status);
    }
    return value; // Preserve resource metadata; never assume timeline clip identity or pagination.
  }
  async is_song_in_library(ownerId, songId, {maxPages = 100, pageDelayMs = 250,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), ...options} = {}) {
    let cursor = null;
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.get_own_library_page(ownerId, {...options, cursor});
      const song = data.clips.find(c => c.id === songId);
      if (song) return {visible: true, pagesRead: page, song};
      if (!data.has_more) return {visible: false, pagesRead: page, exhausted: true};
      const next = data.clips.at(-1)?.id;
      if (!next || seen.has(next)) return {visible: null, pagesRead: page, reason: 'PAGINATION_INCOMPLETE'};
      seen.add(next); cursor = next;
      if (page < maxPages) await wait(pageDelayMs);
    }
    return {visible: null, pagesRead: maxPages, reason: 'PAGE_LIMIT'};
  }
}
