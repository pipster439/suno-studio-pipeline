# Suno Studio final release candidate — 2026-10-06

## FINAL STATUS

The validated core workflow is consolidated: create → add existing clip → save →
explicit transposition → save → render submission. **No further reverse engineering
is required for the validated core workflow.** Version 0.3.0-rc.1 is a local candidate;
no stable release, tag or push is created.

## VERIFIED CAPABILITIES

Three existing reads remain VERIFIED; specific version remains LOSSLESS with
maskedStatePaths=[]. Three POST endpoints are upgraded from the supplied real
authenticated Free-account validation, not from fixture tests: create-project,
save-project and render-state submission/queued parsing. ADD is client state mutation
verified via save/readback, not an independent HTTP endpoint. Explicit -5 transposition
and the tested current MD5 identity warp serialization persisted through save/readback.

Browser Harness has independent real LIVE_CAPTURE / COMPLETE evidence including
fetch, XHR, reload, scoped SPA, lease, privacy and stop ACK. Recorder, panel, native read
adapter and privacy module source bytes were frozen during this consolidation. RC
script 1.3.19 only changes audited transport write policy/build metadata; protocol3 and
harness1.1.1 remain unchanged in semantics. Existing live harness proof came from v1.3.18;
no new live run is claimed for this final RC build.

Official Web UI showed Upgrade / Preview for the tested Free account; the authenticated
backend accepted these three endpoints with 200. This is a run-scoped observation,
not a conclusion about every Free user, endpoint, future price or product policy.

## Main changes

- Central registry, evidence enum and verification kinds now distinguish evidence,
  default dispatch permission and official Web UI availability.
- Existing StudioClient now implements create_project/save_project/render_project;
  read interfaces remain stable. Response IDs bind project/version lifecycle directly;
  missing version never falls back to an old UUID. Response parsers keep unknown fields.
- Local state, serializer and render boundaries remain branded and copy-on-write.
  Preview is always nondispatchable even when endpoint evidence is VERIFIED.
- Default-deny client/controller/browser policy replaces the prior broad temporary
  flags, page globals and validation environment switch. Explicit configuration can
  permit only reviewed VERIFIED POST entries. Unknown/static writes still fail.
- Final full lifecycle example and tests use real-derived response fixtures plus
  clearly labeled reconstructed local readback state. Production fetch is trapped in
  the lifecycle regression test and the production call count is zero.
- One-off write validator and untracked source input are archived privately, not run
  or committed. The original raw report is byte-preserved privately; the public report
  and new fixtures are deidentified. README is now normal project documentation;
  old reports are retained with superseded-stage labels and evidence history.

## STILL UNVERIFIED / risks

Render was queued; this validation does not prove completion or final audio. Prior
third-party completion is historical OBSERVED evidence, not current polling support.
Multitrack, tempo automation, MIDI, take lanes and plugins are not live verified in the
MVP. Uploader inverse pitch remains CORRELATED and opt-in; automatic loudness UNKNOWN.
Only the actual accepted marker serialization/profile is upgraded, not arbitrary maps.

The write capture retained response bodies and request summaries, not full save/render
wire state or version readback bodies. The user/report provide readback confirmation;
local reconstructed readback fixtures are not disguised as captured responses. Internal
endpoints may change; queued parser failures do not trigger automatic write retries.

## SECURITY / PRIVACY

No feature-gate patch, subscription spoof, official UI unlock or entitlement override
was added. No real Suno request or Studio write was issued by this final task. Historical
input contains four successful Studio POSTs; this is kept separate from the task count.
Default policy is closed at every production transport boundary. Read-only Panel's
Free/UI-blocked presentation remains unchanged; it does not negate backend evidence.

Original private report/one-off source are under ignored captures/private/final-rc/.
Original captures and evidence ZIPs are not rewritten. Public response fixtures replace
business UUIDs/account identity and keep response structure. Final evidence exports only
small deidentified summaries; no raw state, credentials, session identities or signed
secrets. The code patch is separate and excludes pre-existing working-tree changes.

## TEST RESULT

187 unit/fixture/protocol tests passed, zero failures. All previous tests are retained;
obsolete assertions were changed to reflect async interfaces/current evidence while
preserving default-deny behavior. Three real integration tests skipped under default
gate. Full offline lifecycle: fixture transport only, explicit -5 readback, queued render,
production network=0. Build scripts completed; privacy/secret scan, immutable evidence
hashes, patch apply check and ZIP/manifest inspection are required for final delivery.

## RELEASE ARTIFACT / COMMIT

- docs/STUDIO_SDK_STATUS.md, STUDIO_API_MAP.md, STUDIO_WRITE_API.md,
  STUDIO_CLIP_PIPELINE.md, STUDIO_RENDER_PIPELINE.md, EVIDENCE_STATUS.md,
  EVIDENCE_HISTORY.md and KNOWN_LIMITATIONS.md.
- fixtures/write-validation/, examples/studio-fixture-lifecycle.mjs and tests/studio-final-rc.test.mjs.
- deliverables/SUNO_STUDIO_FINAL_RC.patch (task delta from saved dirty working baseline).
- deliverables/final-rc/<timestamp>/SUNO_STUDIO_FINAL_RC_EVIDENCE.zip and external SHA-256.
- Commit IDs, source hashes and patch hash are in delivery metadata. Audit baseline
  commit is 3a50d81543a7ef1e943d222b59a30de032ee7b58, with seven tracked files already
  modified plus raw untracked inputs at task start. The final commit also consolidates
  reviewed pre-existing transport forwarding/local-key configuration; the separate
  patch contains only changes made after the task snapshot.

Known limitations are explicit; optional capabilities can require future evidence,
but this task is complete and sends no further production experiments.
