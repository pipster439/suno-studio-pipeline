# Codex live validation handoff — browser read-only

Browser Harness: **NOT VERIFIED** (implementation/simulated one-click flow tested; v1.3.17 real-browser run pending)

Read Transport: **LOSSLESS in prior v1.3.16 evidence**; new v1.3.17 harness native-read proof is pending. Prior live evidence does not verify the new harness.

Studio Write Validation: **BLOCKED_BY_PRODUCT_ENTITLEMENT** (user-confirmed FREE)

Write Dispatch: **LOCKED** (browser adapter/generic transport, SDK and controller)

Next action requiring entitlement: **CREATE → ADD → SAVE → MOVE → SAVE → TRANSPOSE → SAVE → EXPORT**. All unavailable now.

Known owned IDs are pinned in shared/studio-protocol.cjs; no enumeration. Three reads remain VERIFIED. Four write candidates remain FOUND_STATICALLY with separate PRODUCT_ENTITLEMENT availability reason.

Versions: controller 0.2.0, protocol 2, userscript 1.3.17, harness 1.1.0. See docs/STUDIO_CAPTURE_HARNESS.md for four-step setup. Controller restart is normal/manual; old independent harness must be disabled with the combined script.

Task-owned controller is online at http://127.0.0.1:3001; its loopback handshake was checked (200 / expected versions / FREE / LOCKED), without persisting the capability. Update script from that port. Old controller on 3000 was not stopped. Local handshake is not real-browser or Suno API evidence.

Browser connector in this task returned request-header policy load failure. No installation barrier was bypassed and no new live GET was performed. Run Read-Only Self Test creates a per-run ZIP/handoff with actual COMPLETE/INCOMPLETE, LOSSLESS/NOT LOSSLESS and LIVE VERIFIED/NOT VERIFIED. Offline rehearsal never upgrades live evidence.
