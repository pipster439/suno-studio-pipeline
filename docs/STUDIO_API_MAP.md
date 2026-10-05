# Studio API map — final RC

Status is evidence, not permission. Central source: suno/studio/endpoint-inventory.json.
Only the following upgrades are applied; all other endpoint levels remain unchanged.

| Method | Path | Status | Verified scope |
|---|---|---|---|
| GET | /api/studio/project/{project_id} | VERIFIED | full project, metadata/state |
| GET | /api/studio/{project_id}/version/{version_id} | VERIFIED | project/version relation, LOSSLESS |
| GET | /api/studio/{project_id}/versions?return_days_only=false | VERIFIED | observed list schema |
| POST | /api/studio/create-project | VERIFIED | query title + major_version=2, response + readback |
| POST | /api/studio/save-project | VERIFIED | whole state, audio add/readback, explicit -5 persistence |
| POST | /api/studio/render-state | VERIFIED | V2 fullsong_export submission → queued, response relation |
| POST | /api/studio/render-state-multitrack | FOUND_STATICALLY | download schema branch; no live test |

ADD_CLIP = CLIENT_STATE_MUTATION; status VERIFIED, verification.kind=save_readback.
No independent add-clip endpoint is introduced. Explicit transposition is VERIFIED
through save/readback. Uploader +8 → -8 inverse pitch stays CORRELATED.
maskedStatePaths=[] and losslessState=true remain confirmed for specific-version read.

Latest write source: reports/STUDIO_FREE_WRITE_VALIDATION_SANITIZED.md and deidentified
fixtures/write-validation. Original raw evidence is private and unchanged.
The tested Free UI remained entitlement blocked while backend POSTs returned 200.
No all-Free-user, all-endpoint or permanent-policy conclusion follows.

Default write dispatch is false. Each permitted write needs VERIFIED evidence,
reviewed request/response metadata and explicit local configuration. UI wizard
availability is independent. No entitlement patch or Studio write ran in final RC work.
