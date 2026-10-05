# Stop ACK protocol 3 — 2026-10-06

Versions: controller 0.2.1, combined userscript 1.3.18, harness 1.1.1, protocol 3. Existing fetch/XHR/probe IDs and privacy code are unchanged.

## Failure evidence and prior chain

The immutable real run `read-1791217085056-1083c00c` has origin LIVE_CAPTURE / realBrowser=true. FETCH, XHR and RESUMED_FETCH are all captured/correlated/HTTP 200 and lossless; all state digests equal `99aa0d597aa89363847448d837d12b71f08bad730c4dad36a420bb53c2903418`. Reload, supported SPA and one-tab lease passed; counters and Studio writes are all zero. Its only completeness blocker is **stop acknowledgment unavailable**. It is not simulated evidence.

Previously Panel directly awaited POST `/api/browser-read/finish`; controller end set DRAINING, incremented controlVersion and waited up to 5 s for a periodic recorder-config/recorder-status heartbeat with equal controlVersion. There was **no explicit ACK message/requestId or persisted stop result**. GM HTTP timeout was also 5 s. The real log proves the missing confirmation, but does not identify which callback was delayed. Dependence on periodic sync/foreground scheduling and equal timeout boundaries was a control-plane race; zero pending/queue did not prove ACK. The strict check was retained and strengthened.

## Current chain / correlation

1. Panel `finishScenario()` stores GM resume phase STOP_REQUEST_SENT with runId/captureId/owner tab. Recorder `stopScenario()` disables acceptNew and sends JSON POST `/api/studio-validation/stop-request` with `{captureId, scenario, pageId}`.
2. **Controller generates** one UUID `requestId` per capture stop, increments controlVersion once, persists cutoff/STOP_ACCEPTED before replying. Duplicates return the same identity; never reopen. Config includes the same `active.stop` message plus current server event sequence.
3. Recorder explicitly syncs/drains rather than waiting for a background interval. In-flight capture rows retain their original captureId. New records stay disabled. It persists queue/control and GM stop phase STOPPED only with pending=0, queued=0, pump idle and no storage failure.
4. Recorder JSON POST `/api/studio-validation/stop-ack` sends `{captureId, scenario, pageId, documentId, requestId, phase:'STOPPED', controlVersion, pending:0, queued:0, dropped, storageFailures:0, persisted:true, acceptNew:false, finalSequence, versions}`. This is an HTTP ACK, **not a DOM CustomEvent**. Suno auth/headers are never included.
5. Controller validates capture/scenario/requestId/owner/document/protocol/controlVersion, no drop/storage failure, exact final sequence and no unmatched request. It waits for serialized ingress, fsyncs NDJSON, atomically writes/fsyncs events/control JSON. States advance FLUSHING → STOPPED → ACKNOWLEDGED; ACKNOWLEDGED means the recorder stop has been durably confirmed by controller.
6. Reply is `{ok:true, scenario, captureId, requestId, pending:0, queued:0, dropped:0, storageFailures:0, persisted:true, finalSequence, complete:true, phase:'ACKNOWLEDGED'}`. Recorder checks correlation and persists its **received** ACK result. GET `/api/studio-validation/stop-result?captureId=...&scenario=...&pageId=...&requestId=...` safely retrieves the same durable result if the reply was lost.
7. Panel calls finish with `stopRequestId` as receipt proof. Browser summary separately reports `clientStopAckReceived` and `recorderStopAcknowledged`. Controller heartbeat alone cannot satisfy either. CaptureComplete requires the explicit ACK plus all original gap/privacy/read/digest/lease/navigation checks.

## Retry, reload, ownership and timeouts

- GM control call timeout remains 5 s; stop request is retried up to 3 times or recovered from config. Flush/result loop has 15 s bound; finish reply is retried 3 times or recovered from matching run status. Timeouts remain failures, never assumed success.
- A temporarily unreachable result query is retried within the bound. If stop/finish still fails, the Panel keeps STOP_REQUEST_SENT/STOPPED and the capture identity for refresh recovery instead of automatically canceling a durably stopped capture. Explicit Stop / mark INCOMPLETE remains available.
- Stop IDs/results live on controller disk plus GM stop/resume slots, not a pre-reload Promise resolver. Reload during stopping continues only stop/finish, without rerunning SPA/GET probes. Same GM per-tab identity retains lease. A pending pagehide still makes capture incomplete.
- Stop result is owner-bound. Explicit takeover cannot consume another owner's completed result; an old ACK may be retrieved but cannot satisfy a new capture/requestId. Concurrent end calls for the same capture share one finalization. Tombstones retain completed result for 24 h, bounded to 32 captures; historical scenario evidence is not deleted.
- Protocol-2 controllers are not accepted after the update. Auto-discovery re-pairs to a compatible 3000–3002 controller even if the old scoped capability still responds. No full controller/Suno capability is persisted in a report.
- Duplicate queue ingress returns the original sequence and does not append another record. ACK retry neither opens recording nor resends Suno reads/writes.
- Simulated offline rehearsal still models a stop transaction, but its origin remains SIMULATED_OFFLINE and cannot upgrade live evidence. LIVE protocol-mode unit tests use mock browser/native responses and are explicitly not new real-browser observations.

## Four user actions

Update userscript/controller → refresh ordinary Suno → Run Read-Only Self Test → Export Evidence. New panel includes Export Evidence; no DevTools/console/JSON copying. Studio writes remain LOCKED / BLOCKED_BY_PRODUCT_ENTITLEMENT. New end-to-end ACK live verification requires this updated run; the original real result is never retroactively changed to COMPLETE.
