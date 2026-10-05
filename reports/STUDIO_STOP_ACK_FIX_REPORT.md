# Browser stop ACK fix — 2026-10-06

## Conclusion

Stop control plane is repaired and locally validated. **Existing real LIVE_CAPTURE data-plane evidence is confirmed and preserved**; it is not relabeled offline. The new protocol's end-to-end live ACK is pending the user's next v1.3.18 self-test. No real Suno request, Studio write, entitlement change, endpoint unlock or static API analysis was performed.

The old completeness failure remains intact: stop acknowledgment unavailable. Three actual GETs are lossless/correlated/200, state digest `99aa0d597aa89363847448d837d12b71f08bad730c4dad36a420bb53c2903418`, no masked paths, reload/SPA/lease passed, all gap/write counters zero. Historical evidence is not altered to make the fix appear verified.

## Changes and diagnosis

Prior finish depended on equal controlVersion heartbeat within a 5 s drain, while GM finish itself had a 5 s timeout; no explicit durable stop request/ACK existed. Actual logs establish absence of ACK, not a uniquely proven delayed callback. We replaced the implicit acknowledgment with explicit, owner/capture/scenario/requestId-bound local HTTP stop/ACK/result messages and an independently confirmed Panel receipt.

Queue flush, pending counts, persisted browser state, controller fsync and atomic state commit are required before ACK. Stored stop result plus completed-capture tombstone supports duplicate calls, lost responses, reload and reconnect. Counter/identity/storage failure still blocks completeness. Versions/builds bumped together to controller 0.2.1 / script 1.3.18 / harness 1.1.1 / protocol 3. Browser data-plane hooks/native read payloads/privacy/write guard were preserved; only their control metadata/persistence changed. Panel gained Export Evidence.

Full payload/state/timeout/owner documentation: `docs/STUDIO_STOP_ACK_PROTOCOL.md`. A-H live writes remain PRODUCT_ENTITLEMENT blocked; endpoint evidence remains unchanged.

## Validation

All existing tests retained: **175 tests passed; 0 failed**, plus 3 real integration tests skipped by the default explicit opt-in gate. Stop cases cover normal ACK, lost ACK/query/retry, double stop/end, reload before/during stop, controller reconnect, pending/queue zero flush, pending unmatched request, storage/drop/commit failure, wrong identity/protocol/document, old scenario ACK isolation and takeover ownership. Panel/controller protocol-mode tests cover normal, lost ACK, stop-reload and result-query reconnect, with exactly three synthetic GET probes each and no repeated capture records. New local tests are not claimed as new real-browser evidence.

Final test log, totals, default integration skips, build IDs, preservation hashes and ZIP checks are in the delivery MANIFEST/TESTS/evidence summaries. Original privacy/lossless/fetch/XHR/reload/write-guard tests remain active. Task-only patch is checked against baseline `17151a8a09bf69458cd6d9136830d4330f6e6fb3`, which began clean; no push.

## Risks / remaining items

- New stop ACK must still be rerun in the real browser after updating both controller and script. Prior data-plane evidence remains LIVE_CAPTURE; it cannot prove newly added control protocol.
- If pending request, storage failure, missing response, mismatched final sequence or protocol gap occurs, ACK is refused and completeness remains INCOMPLETE. Fixed timeout bounds are not a success fallback.
- GM state and persisted controller results provide recovery; arbitrary terminated tabs/failed storage cannot be represented as success. Tombstones are local 24 h/32 capture caches, not a database or credential store.
- Scoped local ingress trusts a privileged local caller; it is not cryptographic browser attestation. Production Suno Studio writes stay physically locked.
- Original real ZIP, report, JSON and NDJSON are only read/hash-checked. Evidence export contains sanitized summaries, not raw state/auth/account data. New package stages independently and excludes old ZIPs/source/build/dependency/cache files; patch is separate.

## Artifacts

- Original real evidence: `deliverables/browser-read/read-1791217085056-1083c00c/SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip` (immutable).
- Original real run: `captures/live/read-1791217085056-1083c00c/READ_SMOKE/`; export summaries under matching `captures/browser-read/`.
- Protocol doc and this report; task-only `deliverables/SUNO_STUDIO_STOP_ACK_FIX.patch`.
- New delivery `SUNO_STUDIO_STOP_ACK_FIX_EVIDENCE.zip` and external SHA-256; small summaries distinguish actual input LIVE_CAPTURE from local regression tests.
- Userscript installation: regenerated `userscripts/local-transport.user.js`; Panel's four actions: update → refresh Suno → Run Read-Only Self Test → Export Evidence.
- Compatible controller started at `http://127.0.0.1:3002`; local handshake confirmed protocol 3 / FREE / LOCKED without a Suno call. Existing controller processes were not terminated.
