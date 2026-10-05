# Suno Studio live-validation readiness report

Date: 2026-10-05. Baseline: `22b498663c73588e9c16fe2070d555ec09105955`, working tree clean. Delivered patch contains only this task. No push, deployment, browser installation or running-process replacement.

## Conclusion

**LIVE_VALIDATION_READY=true for offline/capture tooling**, scoped to manual constant-BPS single-audio-track merge. This is not write permission, server create/save/render success or a complete DAW port. This task made **zero real Suno requests**, zero bundle downloads, zero entitlement changes. Real Studio POST/PUT/PATCH/DELETE were all zero. Existing read/privacy/lossless live evidence was not repeated.

### COMPLETE OFFLINE

- 20-clip dry-run, explicit processing, arrangement/source identity separation, short tail, warp dedup, template sanitization, unknown preservation, save/render domain boundaries, provenance.
- Static V2 render audible-track filter, two normalizations, manual timing/metronome, referenced-only current warp serializer and downbeats ported. Distinct multitrack/legacy main-lane behavior, real enums and source offsets recorded.
- Path-aware diff, ADD/MOVE/TRANSPOSE/FADE predictors, request comparisons, offline ReplayTransport using read parsers, typed error boundary, ExpectedProjectVersion local check, RenderJob reference with polling rejected.
- Persistent passive fetch/XHR/beacon/WS recorder, scenario archive, one-tab lease, stop/queue completeness checks, privacy, local UI/CLI, deferred edit→save analysis and A–H offline rehearsal.
- Per-endpoint registry eligibility and physically closed production write guard. Encoded paths/flags cannot bypass it.

### READY FOR LIVE VALIDATION

- A_CREATE/B_ADD/C_SAVE/D_MOVE/E_SAVE/F_TRANSPOSE/G_SAVE/H_EXPORT each support Begin/End, marker, archive, verified GET baseline/readback and report. End analyzes the run automatically. No DevTools or manual request JSON copying.
- Official UI observation requires no controller write activation. The new passive harness needs its first normal browser install/refresh/live trial; current evidence is VM/local server, not real-browser proof.
- Independent prediction files can supply source/profile/state/request. Without them ADD checks structural invariants; MOVE/TRANSPOSE observed-action checks are labeled conditional. Unsaved B/D/F are associated with C/E/G saved states; no invented editor snapshot.
- Human-review recommendations/schema evidence prepared; documents are never automatically upgraded.

### STILL NEEDS STATIC WORK / MISSING INPUTS

- Nonempty aligned lyric mapping/crop/merge code recovered but not fully ported. Plain token join is implemented; captures lack aligned source lyric inputs. Explicit empty lyrics work locally; nonempty equivalence unclaimed.
- Follow-track/tempo automation/take-preview splitting/MIDI/plugins remain explicitly unsupported outside the current MVP. Static source exists; a future workflow needing them requires a wider port and evidence.
- A bounded search of **236 existing real response files** recovered no full source clip duration metadata. Marker extents are not full metadata. Exact ADD constructor prediction still needs actual metadata/profile.
- gainReference/repairLoudness/silence/implicit trim effects UNKNOWN, third-party orchestration concerns. No invented loudness algorithm. +8 upload→-8 Studio remains CORRELATED strict opt-in.
- Full render response/polling schema unknown. V2 export consumer uses id in a song link, with no polling loop; no guessed polling endpoint.

### BLOCKED BY WRITE ACCESS

- Real create/add/save/postprocess/export, official payload equivalence, server MD5 acceptance, version persistence and audio/output quality require normal legitimate Studio write access.
- Reads do not imply write rights. Four primary POST candidates remain FOUND_STATICALLY / High.
- Future reviewed VERIFIED + explicit config only yields endpoint eligibility today. Production transport remains physically locked; a separately reviewed activation adapter is required after legal capture and specifically authorized reproduction. This conservative boundary does not block official-UI validation.

## Main changes and evidence

Bounded inventory: **25 literal calls / 17 templates / 116 existing assets**. No independent Add Clip/createVersion API or namespace PUT/PATCH/DELETE literals within that snapshot. Source-linked create-or-load differs from query create; revision is not guessed from version ID. Save body contains no base-version/If-Match, so the local precondition adds none.

Render source: `0kfolb-xhy_j4.js` 17660 @73412,950155 @103608,derived265449 @101050,downbeats714981 @1216430; `3g9-3c-u44c0o.js` V2 export748387 @825347,POST825864. Range uses native audible state/selection before mute-clip normalization, without downbeat offset; equal-selection fallback does not change export_mode. Render rebuilds referenced registry after filtering; editing preservation keeps historical/orphan entries. Package includes source hashes/compact evidence, not full bundles.

Save no-op: PRESERVE_EXISTING locally identical; current static serializer **24 explicit registry/hash changes**, decoded state semantically equal, UNKNOWN=0/BLOCKER=0. No fields ignored to achieve counts. UI/runtime/unknown fields preserved; incomplete/redacted/non-JSON rejected. Original fixtures/earlier evidence untouched.

Recorder returns original fetch Promise/Request/response and native XHR/beacon/WS returns. Immediate response clone fixes body-consumer race. Serialized lifecycle/pending/queued/dropped/omitted checks avoid false completeness. GM redacted queue survives reload; NDJSON authoritative; stale events cannot migrate scenarios. Export includes beacon/WS/navigation and requestId-correlated HTTP pairs. Private capture business UUIDs become aliases in evidence export.

## Tests and verification

- `npm test`: **124 passed / 0 failed**; original tests retained. Coverage: templates,20clips/tail,warp/hash,serializer/render/downbeat/enums,request previews,predictors/diff/comparison,replay/errors,registry/per-endpoint/encoded guards,privacy,fetch/XHR/beacon/WS,reload/scenarios,local controller and zero-write rehearsal.
- `RUN_SUNO_INTEGRATION_TESTS=0 node --test tests/*.integration.mjs`: **3 skipped**, no real requests.
- `npm run offline-validation-rehearsal`: eight start/capture/diff/compare/finish cycles, success=true, networkRequestCount=0. Seed is real GET evidence, but A–H action results/responses explicitly **SIMULATED_OFFLINE**, not live verification.
- Historical20: **1 track /20clips /356.3182143734 beats;563 MATCH /69 EXPECTED_DYNAMIC /0 UNKNOWN_DIFFERENCE /0 BLOCKER**. Source-range115.11097916666667s differs from warped timeline182.7272894222562s.
- Write audit: **100 additional method/encoded-path checks rejected**, plus actual client/hub/controller regressions; all real method counts0.
- Privacy/signed-query/private-data scan and source integrity checks before packaging. Final ZIP independently checked for CRC/duplicates/nesting/hashes/secret values. Patch isolated-apply checked against baseline and result blobs.

## Issues fixed, risks and unresolved matters

Tests exposed fetch clone timing, stop ack with pending work, overlapping lifecycle transitions, and render registry leakage from editing policy; fixed with regression coverage. Error helper made private to preserve StudioClient operation contract. Read failures remain report errors without discarding events. Unsupported save-analysis state becomes a blocker instead of aborting unrelated analysis.

Recorder limits:1MiB/10s per observed stream,200 queued events,max10s stop drain. Binary/oversize/timeouts/beacon-inaccessible responses/storage failure/network gaps are explicit incomplete evidence. A single official tab is required. Reload durability cannot recover responses from requests whose original document was destroyed. Real Tampermonkey interoperability remains a live test; VM success does not prove it.

Old controller processes do not hot-reload; normal restart needed for new routes/guard. Existing Auth/Transport1.3.16 unchanged; install the additional harness once. Native editor CRDT memory is not exposed; saved state/captured payload is the actual comparison boundary. Exact ADD/source lyric predictions depend on missing input data. No permission bypass or server error-code invention.

## Delivery locations

- `deliverables/SUNO_STUDIO_LIVE_VALIDATION_READY_EVIDENCE.zip`
- Separate `deliverables/SUNO_STUDIO_LIVE_VALIDATION_READY.patch`
- External `.zip.sha256` and `SUNO_STUDIO_LIVE_VALIDATION_READY_PACKAGE_CHECK.json`
- Ignored local generated evidence: `captures/live-ready/20261005/`; private scenario archives remain under captures, not packaged wholesale.
- Docs: API_MAP,WRITE_API,CLIP_PIPELINE,WRITE_VALIDATION_PLAN,RENDER_PIPELINE,CAPTURE_HARNESS,SDK_STATUS,ENDPOINT_INVENTORY.
- Modules: `suno/studio/`, `suno/recorder/studio-validation.mjs`, `userscripts/studio-validation-hooks.js`, `web/studio-validation.*`, scripts/tests. Source delivered via repository/patch, not copied into ZIP.

ZIP uses independent staging and contains only report/logs/manifests/hashes/necessary small evidence. No old archives, full repo, dependencies/cache, raw private fixture, credentials or signed URLs. Task-only patch is external; ZIP SHA external, not embedded in itself. Commit/patch metadata are inside the package.
