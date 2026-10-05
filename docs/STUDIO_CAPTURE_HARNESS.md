# Browser read-only validation harness

## 2026-10-06 stop ACK update

Actual v1.3.17 evidence is **LIVE_CAPTURE / realBrowser=true**, with lossless/correlated 200 fetch/XHR/resumed-fetch, matching digest, empty masks, reload/SPA/lease passed. Only stop acknowledgment failed. It is retained as real evidence. New controller 0.2.1 / script 1.3.18 / harness 1.1.1 / protocol 3 adds explicit durable stop/ACK/result and Panel receipt; see [STUDIO_STOP_ACK_PROTOCOL.md](STUDIO_STOP_ACK_PROTOCOL.md). Four actions: update script/controller, refresh Suno, Run Read-Only Self Test, Export Evidence. New ACK still needs this live retest; no Studio writes are enabled. Remaining protocol-2 description below is historical.

Current account: **FREE**, user-confirmed. Studio write validation is **BLOCKED_BY_PRODUCT_ENTITLEMENT**. Endpoint evidence levels stay unchanged; all Studio writes remain physically locked.

Combined transport **v1.3.17** includes passive harness **v1.1.0**, native read adapter and default-collapsed panel. Controller **0.2.0** / capture protocol **2** are required. Local tests include the one-click panel flow; **the new harness is NOT VERIFIED in the real browser yet**. Prior v1.3.16 lossless read evidence does not prove these new hooks.

## Minimal setup

Build after pulling changes:

```powershell
npm run build:userscript
npm run build:studio-harness
npm start
```

1. Update/install the combined script at `http://127.0.0.1:3000/local-transport.user.js`; disable an old standalone harness/sync script if enabled. Keep one recorder.
2. Start/restart controller normally if needed (`npm start` in G:/Suno). Old processes have no hot reload.
3. Refresh the ordinary logged-in Suno page.
4. Expand Studio Validation and click **Run Read-Only Self Test**.

No DevTools, console JS, copied tokens, manual JSON or extra Auth Bridge tab is required. Panel labels include **STUDIO WRITES LOCKED**, **WRITE VALIDATION BLOCKED BY PRODUCT ENTITLEMENT**, FREE, controller/harness/auth/script/protocol versions, scenario/captured/pending/queued/dropped/privacy status.

## One-click behavior

The click reserves a test-owned secondary tab for lease rejection, performs the pinned owned-version GET with native fetch then XHR, drains capture, marks an expected reload, reloads the same page, restores the scenario, changes/restores a same-path history fragment, then performs a third fetch. The second tab sends no Suno API probe and closes after reporting rejection. Popup blocking makes the result INCOMPLETE; no unrelated beacon/WS probes are sent.

Only the exact `/api/studio/3ebbb451-08a7-4599-9885-788f0b8f5def/version/e491cbde-9266-4884-997c-3a9789877a56` GET is accepted by the native adapter. It runs in the existing Tampermonkey auth closure; events never expose credentials. GM transport alone cannot prove page instrumentation, so native CORS/network/XHR failure is INCOMPLETE, with **no GM fallback**.

Raw browser-state digest, sanitized transport-state digest and original response baseline must match, including display labels, unknown fields and timeSignatureChanges. Server baseline: `captures/studio_project_3ebbb451-08a7-4599-9885-788f0b8f5def.json`. Missing/wrong original blocks the test; the tracked sanitized fixture is not substituted. Neither original is rewritten.

## Protocol and authorization

GM POSTs JSON `/api/browser-read/handshake` with `X-Studio-Harness: 2`. Exact loopback Host plus official Suno/loopback Origin checks apply; normal cross-origin pages receive no CORS grant. Ports 3000–3002 are discovered automatically. Returned random in-memory **read capability** only authorizes read-smoke/passive-ingress routes, not `/api/call`, `/api/probe`, A-H Begin or the full WebSocket bridge. It is not Suno auth/full controller capability. GM stores it for reconnect; controller restart invalidates it and triggers bootstrap. Local privileged processes/userscripts remain trusted.

All four versions are checked before reads/after reload. Mismatch blocks self-test with Controller restart/update required. Browser generic API transport independently normalizes/rejects Studio writes (including encoded/dot/slash aliases); SDK/controller guards remain locked. No entitlement query/change or endpoint unlock occurs.

## Capture, persistence and ownership

Document-start hooks preserve native fetch Promise/Request/Response, XHR returns, beacon accepted boolean and WebSocket prototype/static/send behavior. Only HTTPS/WSS `studio-api-prod.suno.com` `/api/studio/` traffic is captured. Rows include timestamp, sequence, scenario, correlation/probe ID, source/document, method/path/sanitized request, status/body/duration and available initiator. Privacy runs before GM queue and backend append; auth/cookies/tokens/JWT/device/account/email/signed query values are removed or masked, musical state retained.

GM_getTab/GM_saveTab identity survives reload and differs between tabs; cloned sessionStorage is not accepted as reliable self-test identity. Server control and a bounded redacted GM queue persist. Lease **never expires into automatic takeover**. Second tabs display Recorder is owned by another Studio tab. Explicit Take Over first cancels/archives an active test, then transfers ownership. Duplicate standalone/combined hooks block instead of silently competing.

## Completeness

Expected reload is single-use. Unexpected extra reload, request/response document mismatch, pending pagehide, dropped item, storage failure, body timeout/omission, unavailable response, protocol mismatch or actual multiple recorder owners means **INCOMPLETE / verificationPassed=false**. Stop requires acknowledgment and empty pending/queue. Storage/drop failures remain sticky across counter resets. Resume timeout is shown after 45 seconds while the page runs; closing it leaves unfinished evidence to resume/cancel, never success.

SPA proof is limited to **same-path history.replaceState fragment replacement/restoration**; arbitrary application-router redirects are not claimed. Body observation is limited to 1 MiB/10 seconds; queue capacity 200 events. Inaccessible/binary bodies are explicitly omitted. Beacon cannot prove HTTP response/status.

## Evidence and Free write state

Each finished/blocked/cancelled run independently stages in `captures/browser-read/<run>/export-staging` and generates `deliverables/browser-read/<run>/SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip` plus external SHA-256. Required summaries/handoff/report/tests/manifest are included; raw bodies/private IDs/display values/credentials are excluded. Old packages are not overwritten or nested. Panel displays archive path/hash; scoped `/api/browser-read/archive` serves the latest ZIP.

Live pass requires runtime metadata and every native-source/correlation/digest/HTTP/reload/SPA/lease/completeness check. **SIMULATED_OFFLINE never becomes LIVE VERIFIED**, even for a complete modeled scenario. These checks are not cryptographic browser attestation; inspect actual browser evidence before adopting a live claim.

A-H wizard/prediction/diff/archive tooling remains available offline. Current live Begin/End prompts and controller Begin are blocked by PRODUCT_ENTITLEMENT. A reviewed future entitlement-aware activation is required before legal UI prompts. GET does not fabricate closed-over editor memory; deferred B/D/F versus C/E/G pairing remains. Evidence is never automatically upgraded.
