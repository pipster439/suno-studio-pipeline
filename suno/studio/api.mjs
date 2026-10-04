// Evidence and limits: docs/STUDIO_API_MAP.md, controller-create-replay-01 (2026-10-05).
export const VERIFIED_ENDPOINTS = Object.freeze({
  create_project: Object.freeze({ method: 'POST', path: '/api/studio/create-project', title: 'Untitled Project', major_version: 2 }),
  get_project_metadata: Object.freeze({ method: 'GET', pathPrefix: '/api/studio/project/' }),
});
