# Codex live validation handoff — browser read-only

Browser Harness: **REAL DATA PLANE VERIFIED; new stop ACK live retest pending**. Actual run origin=LIVE_CAPTURE, realBrowser=true; three GETs captured/correlated/lossless/200, reload/SPA/lease passed. Its only completeness failure was stop acknowledgment unavailable. Preserve it as real evidence, not simulated.

Read Transport: **LOSSLESS in actual v1.3.17 fetch/XHR/resumed-fetch evidence**. Every digest equals 99aa0d597aa89363847448d837d12b71f08bad730c4dad36a420bb53c2903418; maskedStatePaths=[]. New v1.3.18 changes stop control only; do not upgrade full harnessBrowserLiveVerified until its real ACK succeeds.

Studio Write Validation: **BLOCKED_BY_PRODUCT_ENTITLEMENT** (user-confirmed FREE)

Write Dispatch: **LOCKED** (browser adapter/generic transport, SDK and controller)

Next action requiring entitlement: **CREATE → ADD → SAVE → MOVE → SAVE → TRANSPOSE → SAVE → EXPORT**. All unavailable now.

Known owned IDs are pinned in shared/studio-protocol.cjs; no enumeration. Three reads remain VERIFIED. Four write candidates remain FOUND_STATICALLY with separate PRODUCT_ENTITLEMENT availability reason.

Versions: controller 0.2.1, protocol 3, userscript 1.3.18, harness 1.1.1. See docs/STUDIO_STOP_ACK_PROTOCOL.md. Update script/controller, refresh Suno, Run Read-Only Self Test, Export Evidence. No DevTools or token copying.

Compatible controller discovery covers 3000–3002. Old protocol-2 instances cannot satisfy the new handshake; normal update or the compatible controller is required. No user process is killed by this fix.

Original real ZIP and captures remain immutable. This fix's tests are local regressions, distinct from the real input. A new self-test automatically creates a distinct ZIP/handoff; it cannot retroactively remove the old failure. Writes remain zero and PRODUCT_ENTITLEMENT blocked.
