# Known limitations — final release candidate

- Studio endpoints are unofficial/internal/unstable. Dynamic evidence belongs to one tested Free account/run, not all accounts or a permanent product policy.
- The official Web UI remained product-entitlement blocked for that account. The SDK does not unlock the UI or spoof subscriptions. A-H official UI wizard stays blocked and read-only harness stays frozen.
- Core backend create/add/save/explicit transposition/save/render submission is VERIFIED. Default write policy is closed; enabling a VERIFIED endpoint needs explicit local configuration at SDK, transport/controller and privileged browser transport boundaries. Unknown writes and multitrack stay refused.
- Render was accepted with `status=queued`, `entity_type=song_schema`, `metadata.type=studio_export`. Completion/audio download/polling is not verified by this run. Historical third-party completion observations do not establish current SDK polling.
- Tested warp serialization is current MD5 marker-signature hashing for `{0:0,1:1.95}` on the single-track save/readback path. Historical base64 hash preservation and arbitrary other marker maps are not generally server-verified.
- Tempo automation/follow-track timing, MIDI, take lanes and plugin chains are outside the validated audio MVP. Manual timing remains an explicit boundary.
- Uploader `+8 → -8` automatic pitch restoration remains CORRELATED and opt-in; explicit `-5` transposition is VERIFIED independently. Automatic loudness repair is UNKNOWN; explicit gain/fade/trim helpers being implemented does not prove their server effects.
- The write recorder retained response bodies and request summaries, not full save/render wire payloads or version readback bodies. Real response fixtures preserve shapes; offline lifecycle readback states are clearly reconstructed locally. User confirmation and the supplied report provide readback evidence; reconstructed fixtures are not new live evidence.
- Unknown fields are copy-on-write preserved. Save and render require distinct branded state handles; raw serialized GET state is never blindly serialized again.
- Source/original historical fixtures and evidence are retained privately or as the pre-existing historical local evidence chain. Final RC packaging uses deidentified fixtures/summaries and never includes their raw private bodies.
- This is a local release candidate, not a published stable release. No push, tag or production write occurs during consolidation.
