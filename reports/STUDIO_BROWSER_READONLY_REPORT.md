# Browser Harness read-only delivery — 2026-10-05

## Conclusion

Implementation complete; **new Browser Harness NOT LIVE VERIFIED**. Account is user-confirmed **FREE**. All real Studio CREATE/ADD/SAVE/MOVE/TRANSPOSE/EXPORT are **BLOCKED_BY_PRODUCT_ENTITLEMENT**. No Studio POST/PUT/PATCH/DELETE, endpoint unlock, entitlement/feature-gate change, bundle scan or new real Suno request was performed in this task.

Controller 0.2.0 / protocol 2 / combined script 1.3.17 / harness 1.1.0 are implemented. Local one-click panel rehearsal runs actual adapter/hook/panel code against a loopback controller and mocked native Suno reads. This is **SIMULATED_OFFLINE**, not a live browser or a new API observation. The browser connector twice returned `Unable to load browser request-header policy`; v1.3.17 installation and actual self-test are still pending. Existing read/lossless evidence stays intact and does not verify the new harness.

## Main changes

- Default-collapsed, isolated Shadow DOM Suno panel: controller/harness/auth/script/protocol/scenario/captures/pending/queued/dropped/privacy, explicit STUDIO WRITES LOCKED and WRITE VALIDATION BLOCKED BY PRODUCT ENTITLEMENT. A-H live prompts/Begin disabled in page and backend; offline tooling retained.
- Scoped loopback read-capability bootstrap removes manual pairing/extra Auth Bridge tab from read smoke. Four-way version checks block mismatch and restart/update needs. It does not expose Suno credentials or full controller capability.
- Exact pinned owned-version native GET adapter inside the existing auth closure, exercised by fetch/XHR/after-reload fetch. Other methods/paths/IDs rejected before network. GM transport is not substituted for native capture.
- Browser generic transport now independently blocks Studio writes, including encoded/dot/slash path aliases; existing controller/SDK locks remain. Registry availability PRODUCT_ENTITLEMENT is separate from unchanged evidence statuses.
- Stable per-tab GM identity, persistent server control/redacted GM queue, single-use expected reload, supported history fragment SPA proof, no automatic takeover. Test-owned second tab only reports lease rejection; explicit takeover cancels/archives first. Duplicate recorder and offline controller disable self-test.
- Strict completeness/correlation/native-source/digest/project-version checks, sticky storage/drop gaps, stop drain/ack. Missing response/body, pending pagehide, document mismatch, protocol/owner/reload gaps cannot verify.
- Per-run automatic small ZIP + external SHA-256 + actual status handoff, fresh staging, exclusive writes, value-sensitive credential scan and member hashes. Development export is explicitly offline/NOT VERIFIED, with patch separately delivered.

## Verification executed

- `npm run build:userscript`, `npm run build:studio-harness`: passed; generated assets are outside source patch.
- `npm test`: **156 passed, 0 failed**. Prior 124 tests retained; 32 new browser-read cases include whole one-click mocked-browser/controller flow. Existing version and Free Begin assertions were adjusted to intended new behavior, not deleted.
- Default integration suite: three tests skipped, zero real network tests executed. Integration remains opt-in; no environment gate enabled here.
- A-H offline rehearsal: 8 completed scenarios, zero network requests, Studio POST/PUT/PATCH/DELETE each zero; previous prediction/diff/SDK tools preserved.
- Full state digest check includes labels/unknown values/timeSignatureChanges; fixtures untouched. Masked state, wrong proof relation/document, missing response, HTTP failure, omissions/drop/storage, extra reload, missing lease and mismatched versions all fail closed.
- Native read adapter tests reject unpinned IDs, unexpected query/method/transport. Generic browser write guard tests assert zero GM dispatch even for encoded paths. Server scoped capability cannot call raw API/probe/A-H Begin. One-tab stale heartbeat/restart cannot steal ownership.
- ZIP export tests check required members, manifest hashes, external hash, no business UUIDs/credential values, safe names/duplicates/nested archives. Final package is additionally inspected with Python ZipFile CRC/member/privacy/hash validation.
- `git diff --check`: passed. Task baseline: `f5ebfedc9af6786acfc9bd95e9ca9d98a9c0307a`; working tree was clean. Only task changes enter patch/commits. No push.

## Preserved evidence

| Artifact | SHA-256 unchanged |
|---|---|
| Tracked sanitized project fixture | b5cc87081cda785b6d59b753908687c0487dfd23f1e3c262b7b563ba5a2ec64a |
| Original local project response | a1e2213a987eaa3c3012244eed3e69c9b5e044c1ad54b9fb288f3e19d9ecc334 |
| Prior LIVE_VALIDATION_READY evidence ZIP | 0b53e7df6eb94faaeaf4f11f8bc2437bf2285c47f20d3de2a8a5941982056ef1 |
| Prior DRY_RUN_SDK evidence ZIP | 2e05b41a1371aaf86dd0f0a0d20e678e82c095a46b358e222451a52ad8ac11eb |

Evidence grades unchanged: GET project, pinned version and versions list VERIFIED; create-project/save-project/render-state/render-state-multitrack FOUND_STATICALLY / dispatchAllowed=false. This task created no new endpoint or observation.

## Remaining issues and risks

1. **Actual browser run pending**. Native CORS/XHR, Tampermonkey per-tab storage/grant and popup behavior need installed v1.3.17 confirmation. If inaccessible, the harness reports INCOMPLETE; it cannot switch to a mock/GM result and claim live success.
2. SPA validation scope is same-path fragment history.replaceState/restoration. Arbitrary application router navigation is not claimed. Extra unsupported reload/redirect fails completeness. Closed owner page leaves an unfinished scenario; resume/cancel is required.
3. Browser metadata and correlation checks are not cryptographic attestation. A privileged local client can fabricate ingress. Review real browser-produced evidence; the explicit offline label remains mandatory for tests.
4. Bootstrap trusts local privileged processes/userscripts; capability is narrow, not a security boundary against a malicious local administrator. Backend saves no auth credential/capability; Tampermonkey retains auth and its local read pairing. Private captures contain business state/IDs and should not be shared.
5. Missing original baseline blocks; sanitized display labels cannot serve as the exact canonical baseline. Original response read-only; no invented fields or normalization applied to it.
6. Active synchronous whole-page hooks still require real Tampermonkey sandbox confirmation. Popup blocked / duplicate old harness / controller restart/offline / storage gaps explicitly block pass.
7. Real writes remain permanently locked in current implementation even after a future registry eligibility change. Legal Studio entitlement plus observed/reproduced official UI evidence and reviewed activation change are required; read success is never write access.

## Artifacts and next action

- Report: `reports/STUDIO_BROWSER_READONLY_REPORT.md`; handoff: `CODEX_LIVE_VALIDATION_HANDOFF.md`.
- New controller is running at `http://127.0.0.1:3001`; loopback handshake returned HTTP 200 with all expected versions, FREE and LOCKED. Old controller on 3000 was left untouched. This is local readiness, not browser/Suno live evidence. Startup printed no local capability/auth token; Node process is a task-owned headless helper.
- Generated installation: `userscripts/local-transport.user.js` (v1.3.17, includes harness); standalone passive asset also rebuilt but do not enable both.
- Tests: `captures/browser-read-development-tests.log`, `captures/browser-read-integration-default.log`.
- Offline A-H: `captures/browser-read-offline-ah-20261005/offline_validation_rehearsal.json`.
- Development export pointer: `captures/browser-read-development-latest.json`; contains a fresh evidence ZIP path/hash. Its browser summary explicitly remains SIMULATED_OFFLINE / realBrowser=false / harnessBrowserLiveVerified=false.
- Task-only patch: `deliverables/SUNO_STUDIO_BROWSER_READONLY.patch` (separate from ZIP). ZIP includes report/logs/small summaries/manifests/commit metadata only, not source, raw fixtures, dependencies, caches, old archives or credentials. External `.sha256` never included inside ZIP.
- Real self-test exports to `deliverables/browser-read/<run>/SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip` with its own live/failed handoff. Four manual steps: update script (disable obsolete independent recorder if enabled), start/restart controller if needed, refresh ordinary Suno, click Run Read-Only Self Test.
- Ready installation link: `http://127.0.0.1:3001/local-transport.user.js`. If the helper is stopped later, use `SUNO_PORT=3001` with `npm start` in PowerShell (`$env:SUNO_PORT='3001'; npm start`). No token copying is required.

The computer-use skill forbids bypassing browser safety barriers and requires action-time confirmation for extension installation; neither installation nor a safety barrier bypass was automated. Skill: `C:/Users/ROG/.codex/plugins/cache/openai-bundled/computer-use/26.930.31730/skills/computer-use/SKILL.md`; associated confirmations policy says “Blocking confirmation required immediately before the action” for “install browser extensions”. The user-performed install step keeps this delivery independent of that UI boundary.
