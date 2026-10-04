// VERIFIED only for the observed current-owner first-page library query.
// This is a song resource API, not a Studio track/timeline endpoint.
export const LIBRARY_ENDPOINTS = Object.freeze({
  own_library: Object.freeze({ method: 'POST', path: '/api/feed/v3', limit: 20 })
});
export function ownLibraryBody(ownerId) {
  return { cursor: null, limit: LIBRARY_ENDPOINTS.own_library.limit,
    filters: { disliked: 'False', trashed: 'False', fromStudioProject: { presence: 'False' },
      stem: { presence: 'False' }, stemComplement: 'False', user: { presence: 'True', userId: ownerId } } };
}
