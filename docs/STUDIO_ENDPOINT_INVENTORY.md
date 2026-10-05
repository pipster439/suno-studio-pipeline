# Studio endpoint inventory — final RC

Existing acquired inventory only; no new bundle search. Three writes upgraded by
actual validation, all other evidence unchanged. Default write permission is closed.

| Category | Method | Path | Status | Default dispatch |
|---|---|---|---|---|
| READ | GET | /api/studio/clip/{clip_id}/download | FOUND_STATICALLY | false |
| EXPORT | POST | /api/studio/render-state-multitrack | FOUND_STATICALLY | false |
| READ | GET | /api/studio/project/{project_id} | VERIFIED | read allowed |
| READ | GET | /api/studio/clips/{clip_id}/projects | FOUND_STATICALLY | false |
| RENDER | POST | /api/studio/render-state | VERIFIED | false |
| READ | GET | /api/studio/project_revision/{revision_id} | FOUND_STATICALLY | false |
| READ | GET | /api/studio/{project_id}/version/{version_id} | VERIFIED | read allowed |
| PROJECT | POST | /api/studio/create-project | VERIFIED | false |
| SAVE | POST | /api/studio/save-project | VERIFIED | false |
| CLIP | POST | /api/studio/create-or-load-project-for-clip/{clip_id} | FOUND_STATICALLY | false |
| PROJECT | POST | /api/studio/project_revision/{revision_id}/clone | FOUND_STATICALLY | false |
| PROJECT | POST | /api/studio/project/{project_id}/bookmark | FOUND_STATICALLY | false |
| READ | GET | /api/studio/list-projects | FOUND_STATICALLY | false |
| PROJECT | POST | /api/studio/project/{project_id}/archive | FOUND_STATICALLY | false |
| PROJECT | POST | /api/studio/project/{project_id}/metadata | FOUND_STATICALLY | false |
| PROJECT | POST | /api/studio/project/{project_id}/unarchive | FOUND_STATICALLY | false |
| READ | GET | /api/studio/{project_id}/versions | VERIFIED | read allowed |

Full schema/source offsets/evidence refs: suno/studio/endpoint-inventory.json.
Official UI availability is distinct from backend endpoint evidence.
