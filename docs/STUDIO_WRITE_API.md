# Studio write API — final verified scope

The three endpoints below are VERIFIED from real authenticated Free-account backend
validation; their default local write permission remains closed. Other candidates,
including multitrack, keep their original static level. Official Web UI availability
is separately entitlement blocked for that tested account.

## Create

POST /api/studio/create-project?title=...&major_version=2
No JSON body was sent in the tested create. Response metadata includes id/title,
created_at/updated_at/archived/major_version. ID is bound from response then read back.
Additional static query options remain implemented previews, not dynamically covered.
SDK dispatch rejects create variants beyond title/major_version=2 and render enum
branches beyond V2 fullsong_export, even under explicit local write configuration.

## Save

POST /api/studio/save-project
Body: {project_id, state, title}. state is SaveSerializedState, not raw wire or editor
memory. Response contains id plus version_id and project metadata. version_id is a
new response binding; missing ID raises an error, never falls back to a prior version.
Initial one audio clip/track with registry and second explicit transposition=-5 save
were confirmed by readback. This does not verify automatic uploader pitch restoration.

## Render submission

POST /api/studio/render-state
Tested body: title, project_id, studio_project_id, studio_project_version_id,
web_client_pathname, lyrics, tags, negative_tags, style_summary, caption, state,
start_beats, end_beats, downbeats, export_mode=fullsong_export, render_engine=v2.
State uses separate render transforms and serializer. Tested range 0–32 and manual
bps=1.95. Response is queued song_schema with id and metadata.type=studio_export,
project/version/range relation. Completion was not validated in this run.

No independent saveVersion/createVersion endpoint was established; save_project
returns version_id. SDK save_version remains an unsupported legacy stub.

## Policy

Endpoint evidence schema and detailed verification kinds: EVIDENCE_STATUS.md.
Registry VERIFIED is necessary, never sufficient. Client/controller/privileged browser
configuration is default false. A body flag, page global or old validation environment
cannot grant access. Even explicit configuration cannot grant unknown/static writes.
Request previews remain permanently nondispatchable as previews.

Raw requests were retained as summaries, not full wire states; offline reconstructed
states test serializer safety and binding, not proof of every server transform.
Static function/source offsets remain in endpoint-inventory.json and historical
static reports. No new bundle scan or live write occurs during this consolidation.
