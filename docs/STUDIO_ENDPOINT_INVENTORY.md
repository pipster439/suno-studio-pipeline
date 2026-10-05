# Studio endpoint inventory

Only literal calls in the existing 116-asset snapshot are included. No Studio write was executed. Source offsets are UTF-16 zero-based; byte offsets and hashes are in `suno/studio/endpoint-inventory.json`. Full response schemas not consumed by client remain UNKNOWN.

| Category | Method | Path | Status | Support / dispatch |
|---|---|---|---|---|
| READ | GET | /api/studio/clip/{clip_id}/download | FOUND_STATICALLY | inventory/preview only / false |
| EXPORT | POST | /api/studio/render-state-multitrack | FOUND_STATICALLY | inventory/preview only / false |
| READ | GET | /api/studio/project/{project_id} | VERIFIED | READ client / true |
| READ | GET | /api/studio/clips/{clip_id}/projects | FOUND_STATICALLY | inventory/preview only / false |
| RENDER | POST | /api/studio/render-state | FOUND_STATICALLY | inventory/preview only / false |
| READ | GET | /api/studio/project_revision/{revision_id} | FOUND_STATICALLY | inventory/preview only / false |
| READ | GET | /api/studio/{project_id}/version/{version_id} | VERIFIED | READ client / true |
| PROJECT | POST | /api/studio/create-project | FOUND_STATICALLY | inventory/preview only / false |
| SAVE | POST | /api/studio/save-project | FOUND_STATICALLY | inventory/preview only / false |
| CLIP | POST | /api/studio/create-or-load-project-for-clip/{clip_id} | FOUND_STATICALLY | inventory/preview only / false |
| PROJECT | POST | /api/studio/project_revision/{revision_id}/clone | FOUND_STATICALLY | inventory/preview only / false |
| PROJECT | POST | /api/studio/project/{project_id}/bookmark | FOUND_STATICALLY | inventory/preview only / false |
| READ | GET | /api/studio/list-projects | FOUND_STATICALLY | inventory/preview only / false |
| PROJECT | POST | /api/studio/project/{project_id}/archive | FOUND_STATICALLY | inventory/preview only / false |
| PROJECT | POST | /api/studio/project/{project_id}/metadata | FOUND_STATICALLY | inventory/preview only / false |
| PROJECT | POST | /api/studio/project/{project_id}/unarchive | FOUND_STATICALLY | inventory/preview only / false |
| READ | GET | /api/studio/{project_id}/versions | VERIFIED | READ client / true |

See JSON for exact request construction, partial response use, callsites, confidence and evidence refs. create-or-load is source-linked and consumes id; create-project is query-title based. clips/projects lists associations, not a timeline insert API. Revision read supplies project_id/is_owner; do not substitute a version ID without real evidence. No independent Add Clip or standalone createVersion route was found within this bounded inventory. No PUT/PATCH/DELETE literal calls occur in this namespace in the snapshot. No base_version, If-Match or optimistic-concurrency field appears in the actual save body; ExpectedProjectVersion is only a local precondition, not a wire extension.
