# Studio Validation Capture Harness

This is passive document-start instrumentation. It does not dispatch authenticated Suno API calls or change feature gates. It supplements the existing Auth/Transport v1.3.16 script, which is unchanged. The new harness is VM/local-controller tested, **not yet installed or tested in a real browser in this task**.

## Once, before legal live validation

```powershell
npm run build:studio-harness
npm start
```

Use the freshly printed loopback pairing URL. Open its `/studio-validation` path, retaining the `#` pairing capability. Click “安装被动 Capture Harness” and install the separately named v1.0.0 userscript. Keep existing v1.3.16 transport enabled. Refresh a single official Suno tab and the local validation page. The validation page links to the paired Auth Bridge in a separate tab; keep that tab open and wait for bridgeOnline/auth ready. Local key is an ephemeral controller capability, not a Suno JWT; never publish it. Port matches are 3000–3002.

Existing running controllers have no hot reload; restart normally to load the new routes/guard. This task did not replace existing processes or ask the user to install anything.

## A–H operation

Select a scenario and **Begin**. Wait until the page says the recorder is armed, then perform exactly the indicated official UI action. **End** stops new capture, drains outstanding records, reads the known project/latest version using verified GETs, creates the scenario report and automatically analyzes the run. No DevTools, request copying or JSON export is needed. A derives project ID from the successful captured create response. If A yields no valid ID, later reads cannot be fabricated; supply a real ID from actual evidence or leave the report blocked.

Each action has a separate folder under `captures/live/<run>/<scenario>/`. Begin uses exclusive file creation and rejects an existing scenario or overlapping lifecycle transition. A failed/incomplete capture is retained; use a new run ID to repeat.

```powershell
# Use controller's local capability in SUNO_CONTROLLER_KEY (see original bridge setup).
npm run studio-validation -- status
npm run studio-validation -- begin B_ADD --run-id RUN --project-id REAL_PROJECT_ID
npm run studio-validation -- end
npm run studio-validation -- report B_ADD --run-id RUN
npm run studio-validation -- analyze-run --run-id RUN
npm run studio-validation -- export B_ADD --run-id RUN
```

CLI outputs JSON. The page Export downloads pseudonymized evidence. An optional prediction JSON file can supply a independently prepared predicted state/request (including explicit arrangement-ID dynamic paths). Without source metadata/profile, automatic ADD analysis reports structural invariants rather than claiming exact constructor equality.

## Captured data and persistence

| Transport | Observation | Preserved page behavior |
|---|---|---|
| fetch | Method/path, sanitized request headers/body, status/headers/response clone, duration, available stack | Original native Promise returned; original Request/response untouched |
| XMLHttpRequest | open/send method/path/header/body, loadend status/body | Native returns and data unchanged |
| sendBeacon | Sanitized payload and native accepted boolean | No fabricated HTTP status or response; native boolean returned |
| WebSocket | Matching URL metadata and incoming/outgoing JSON frames | Constructor prototype/static constants and native send return retained |

Only HTTPS/WSS `studio-api-prod.suno.com` paths beginning `/api/studio/` are included; unrelated telemetry is ignored. Response bodies cannot manufacture unrelated endpoints. All events, including beacon/WS/navigation, remain in exported evidence; request/response pairs additionally carry requestId, sequence, source and initiator.

Privacy is applied before the GM persistent queue and again before backend append. Authorization/Cookie headers are removed, tokens/JWT/session/account/email fields and signed-query values are redacted; musical timeSignatureChanges and non-sensitive state fields remain intact. Private local captures retain business UUIDs; exported evidence aliases UUIDs and suppresses display labels/lyrics. Do not distribute private capture folders as evidence packages.

Server-owned scenario control persists across refresh, GM stores a bounded redacted queue, and server NDJSON append is the authoritative event log. SPA route is recorded per event; reload retains page identity; pagehide writes a marker. A single official tab lease prevents multiple tabs from sharing a scenario. Records retain their original capture identity and cannot migrate to the next scenario after timeout/reconnect.

## Completeness and editor-memory boundary

End requires stop acknowledgment, no pending/queued records, no dropped/omitted bodies and complete request/response correlation. Body observation is capped at 1 MiB / 10 s; binary or inaccessible bodies are explicitly omitted. The GM queue has 200-event capacity. Large uploads/long streams/storage failures can produce incomplete capture and must be repeated or investigated; no successful verification recommendation follows a gap. Beacon response is inaccessible, so beacon observations cannot establish HTTP success. WS metadata has null HTTP status by design.

GET may expose only saved state. The tool does **not** fabricate access to closed-over native CRDT/editor memory. B/D/F are automatically paired with subsequent C/E/G persisted snapshots. MOVE/TRANSPOSE comparisons that derive the intended action value from after-state are marked conditional, not independent predictions. If autosave occurs inside an edit scenario it is captured; a subsequent manual Save can have zero new requests. Read failures remain report errors while captured events stay intact.

Report comparisons classify MATCH / EXTRA_REAL_FIELD / MISSING_PREDICTED_FIELD / DIFFERENT_VALUE / UNKNOWN_TRANSFORM. Recommendations always require human review and separate controlled reproduction/readback; neither registry nor docs are automatically upgraded. Default production Studio write guard remains physically closed even if an offline test supplies a synthetic VERIFIED registry entry.
