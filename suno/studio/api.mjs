// Evidence and limits: docs/STUDIO_API_MAP.md, controller-create-replay-01 (2026-10-05).
export const VERIFIED_ENDPOINTS = Object.freeze({
  create_project: Object.freeze({ method: 'POST', path: '/api/studio/create-project', title: 'Untitled Project', major_version: 2 }),
  get_project_metadata: Object.freeze({ method: 'GET', pathPrefix: '/api/studio/project/' }),
  // Real full GET body supplied by the user, fixtures/studio_project_get.provenance.json.
  get_project: Object.freeze({ method: 'GET', pathPrefix: '/api/studio/project/' }),
});

// Static findings are inert metadata, never a dispatch registry. See STUDIO_WRITE_API.md.
export const STATIC_WRITE_CANDIDATES = Object.freeze({
  save_version: Object.freeze({ method: 'POST', path: '/api/studio/save-project', status: 'FOUND_STATICALLY' }),
  export_project: Object.freeze({ method: 'POST', path: '/api/studio/render-state', status: 'FOUND_STATICALLY' }),
  export_multitrack: Object.freeze({ method: 'POST', path: '/api/studio/render-state-multitrack', status: 'FOUND_STATICALLY' }),
});
