# Local Suno Studio Controller / Recorder — 0.3.0-rc.1

A small local Node SDK and authenticated browser transport for owned Suno projects.
It builds audio timelines, preserves full state, previews requests and records evidence.
This is an internal/unofficial API client, not a supported public Suno API.

## Current capabilities

Three reads are VERIFIED: project, specific version (LOSSLESS), versions list.
Create project, whole-state save and V2 single-track render submission are VERIFIED
for the tested account/run. Add existing audio and explicit transposition -5 persisted
through save/readback. Render returned queued; final audio completion is not verified.
Multitrack and automatic uploader pitch/loudness rules are not promoted.
Browser capture (fetch/XHR, supported reload/SPA scope, lease, privacy, stop ACK)
is LIVE VERIFIED / COMPLETE and frozen. See docs/STUDIO_SDK_STATUS.md.

## Architecture

`StudioClient → SunoBridge → loopback HTTP/WebSocket → Browser page → CustomEvent
→ Tampermonkey authenticated request → Suno`.
The recorder observes official browser traffic separately and sanitizes both ingress
and export. Auth remains in the privileged browser transport; SDK does not store JWTs.
Modules are under suno/studio, suno/bridge, suno/recorder and shared.

## Install and run

Node >=22, then:

```powershell
npm install
npm run build:userscript
npm run build:studio-harness
npm start
```

Open http://127.0.0.1:3000/ and install combined local-transport.user.js v1.3.19.
Enable only one combined recorder, refresh a logged-in Suno page, and confirm the
Panel handshake. Controller 0.3.0-rc.1 / protocol 3 / harness 1.1.1 are compatible.
Run Read-Only Self Test and Export Evidence from the folded page panel; no DevTools.
The read-only harness source/protocol semantics are frozen; new script build changes
only the audited write guard and embeds the central endpoint policy snapshot.

## SDK and offline use

`StudioClient.get_project`, `get_project_version`, `get_project_versions`,
`create_project`, `save_project`, `render_project` form the single supported client.
Source/arrangement IDs differ. Create response supplies project ID; save response
supplies version ID. No UUID is inferred or reused when a response omits a binding.
Pure builders remain preview-only even for VERIFIED endpoints.

```powershell
node examples/studio-fixture-lifecycle.mjs
npm run dry-run:studio
npm run offline-validation-rehearsal
npm test
node --test tests/*.integration.mjs
```

The full fixture lifecycle consumes no production network. Real integration tests
remain disabled unless explicitly enabled; final consolidation never enables them.

## Security and write policy

Studio writes are **closed by default** at SDK, local transport/controller and
privileged browser boundaries. Explicit `allow_verified_studio_writes=true` is a
local configuration, not a request-level override; controller options and private
Tampermonkey GM setting must independently permit it. Only exact VERIFIED POST
entries may pass. Unknown writes, alternate methods, multitrack and previews fail.
Old allowWriteValidation flags, page globals and ALLOW_STUDIO_WRITE_VALIDATION
cannot bypass the policy. See docs/EVIDENCE_STATUS.md and endpoint-registry.mjs.

The tested Free account's official Web UI showed Upgrade / Preview; authenticated
backend create/save/render returned 200. This says nothing about other accounts or
future product policy. No UI unlock, entitlement override or subscription spoof exists.
The official A-H UI wizard remains unavailable; backend capability is separate.

## Studio state model

Keep distinct source metadata → clip draft → editor memory → save serialized state
and render transformed state. Decode raw wire exactly once; serializers require
branded handles. Copy-on-write preserves unknown fields. Manual timing and one audio
track are the validated MVP. Explicit processing is separate from uploader-derived
rules. Warp strategy must be selected explicitly; tested current MD5 identity-map
serialization does not prove every warp map or historical hash spelling.

## Evidence and privacy

See docs/EVIDENCE_HISTORY.md, docs/STUDIO_API_MAP.md and docs/KNOWN_LIMITATIONS.md.
New response fixtures are deidentified, with source provenance. Reconstructed test
readback states are labeled; no local test is presented as a new real browser run.
Raw reports/account data stay under ignored captures/private. Historical captures
and packages are preserved, not rewritten. Public/final exports use sanitized small
summaries and omit credentials, account identity, business UUIDs and signed secrets.
Credential audit checks values rather than banning harmless header field names.
Task-only patch is separate from the evidence ZIP and excludes pre-existing changes.

## Known limitations

Render completion/polling, multitrack, tempo automation, MIDI, take lanes and plugins
are not part of the verified core. Uploader inverse pitch is CORRELATED and opt-in;
automatic loudness repair is not implemented. Internal endpoints can change.
No further reverse engineering is required for the validated core workflow:
create → add existing clip → save → explicit transposition → save → render submission.
