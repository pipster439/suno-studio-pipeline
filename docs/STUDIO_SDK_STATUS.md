# Studio SDK status — 2026-10-05

> 2026-10-06 correction: actual v1.3.17 data-plane run is LIVE_CAPTURE and passed all read/digest/reload/SPA/lease checks. Only stop ACK was missing; original end-to-end completeness remains INCOMPLETE. Controller 0.2.1/script 1.3.18/harness 1.1.1/protocol 3 fixes the control plane, with explicit flush/ACK/tombstone/receipt tests. New full live pass remains pending. See reports/STUDIO_STOP_ACK_FIX_REPORT.md; earlier tables are historical, not a reclassification of the real capture.

## Current Free availability and browser-only task

Account is **FREE**, confirmed by user. All real Studio CREATE/ADD/SAVE/MOVE/TRANSPOSE/EXPORT are **BLOCKED_BY_PRODUCT_ENTITLEMENT**. This is independent of unchanged endpoint evidence levels. Current A–H live wizard/controller Begin is blocked; offline rehearsal/report/export remains available.

| Current feature | Implemented / tested | Browser live status | Dispatch / limitation |
|---|---|---|---|
| Combined transport 1.3.17 / passive harness 1.1.0 | Yes; native adapter + panel tests | NOT VERIFIED | Studio writes locked in browser and controller |
| Protocol 2 / controller 0.2.0 scoped read bootstrap | Yes | Pending installed script | No raw-call/full controller capability |
| Fetch/XHR/correlation/privacy + one-click self-test | Yes; whole mocked-browser/controller flow | NOT VERIFIED | Exact pinned owned-version GET only |
| Reload + supported fragment SPA persistence | Yes; actual new VM document and restored scenario | NOT VERIFIED | Single expected reload; arbitrary router transitions unproven |
| One-tab lease / explicit takeover / duplicate recorder block | Yes | NOT VERIFIED | Never automatic takeover |
| Capture completeness / evidence ZIP / handoff | Yes | Pending real self-test | INCOMPLETE always verificationPassed=false |
| A–H write validation | Offline tools retained | BLOCKED_BY_PRODUCT_ENTITLEMENT | No endpoint unlock; no write dispatch |

Development evidence is SIMULATED_OFFLINE, not a real GET. Earlier read/lossless/static/20-clip evidence below is retained history. Current report: reports/STUDIO_BROWSER_READONLY_REPORT.md; current handoff: CODEX_LIVE_VALIDATION_HANDOFF.md. New package generation runs without Suno access.

**LIVE_VALIDATION_READY=true** for capture/diff/replay/offline tooling. This is not write access, server submission readiness or new dynamic verification. This task used existing local evidence; real Studio POST/PUT/PATCH/DELETE were all zero. Existing three read verifications and lossless transport evidence were not repeated.

| Feature | Evidence status / confidence | Implemented | Tested | Live verified | Dispatch allowed | Remaining blocker |
|---|---|---|---|---|---|---|
| Project/version/version-list reads | VERIFIED / High | Yes | Yes | Prior evidence | GET only | None for observed schema |
| 20-clip sequential builder / short tail / explicit processing | FOUND_STATICALLY / High | Yes | Yes | No | No | Official constructor comparison |
| Template/UI/history sanitization, unknown fields | FOUND_STATICALLY / High | Yes | Yes | No | No | Official empty-project defaults |
| Save serializer and no-op audit | FOUND_STATICALLY / High | Yes | Yes | No | No | Server persistence/hash acceptance |
| V2 render main audio state transforms/range/downbeats | FOUND_STATICALLY / High | Scoped MVP | Yes | No | No | Official request/output comparison |
| Nonempty aligned lyric crop/merge | FOUND_STATICALLY / Partial | Plain text only | Partial | No | No | Remaining port and aligned data |
| Follow-track/automation/take preview | FOUND_STATICALLY / outside MVP | Rejects | Rejection tested | No | No | Wider helper port if workflow needs it |
| Uploader inverse pitch | CORRELATED / single historical workflow | Strict opt-in | Yes | No | No | Causal evidence |
| Loudness/gainReference repair | UNKNOWN | Opaque metadata; rejects repair | Yes | No | No | Third-party worker mapping/data |
| Passive fetch/XHR/beacon/WS harness | Local VM/server evidence | Yes | Yes | No | No Suno dispatch | First normal browser install/live trial |
| A–H lifecycle/baselines/deferred pairs/report UI and CLI | Local offline evidence | Yes | Yes | No | Verified GET baselines only | Legal UI actions |
| Path-aware diff/predictions/preview comparisons | Local evidence | Yes | Yes | No | No | Real independently prepared inputs |
| Replay/A–H rehearsal | OBSERVED offline only | Yes | Yes | No | No | None offline |
| Registry per-endpoint double eligibility gate | Local evidence | Yes | Yes | No | All writes physically locked | Reviewed future activation adapter |
| Render polling | UNKNOWN | RenderJob reference model; poll rejects | Yes | No | No | Observed + verified polling read route |

Current results: **124 tests passed**, three real integration tests skipped by default. Eight offline scenarios completed start/capture/diff/compare/finish, with zero network requests. Historical 20 clips: 1 track, end 356.3182143734 beats, 563 MATCH / 69 EXPECTED_DYNAMIC / 0 UNKNOWN_DIFFERENCE / 0 BLOCKER. This uses observed marker extents, not recovered complete source metadata. A bounded search of 236 archived response files recovered no full source duration metadata.

Save no-op: PRESERVE_EXISTING is byte-value equivalent locally; current static serializer has 24 explicit registry/hash path changes, semantic inline state equivalent, UNKNOWN=0/BLOCKER=0. The current serializer rebuilds registry; editing policy deliberately preserves historical/orphan entries. Neither is server VERIFIED. Template reports separately list preserved/regenerated/removed/reset paths.

Endpoint inventory is limited to 25 literal callsites / 17 templates in the existing 116-asset snapshot. No standalone Add Clip or createVersion API was found there. All write endpoints stay FOUND_STATICALLY. `ExpectedProjectVersion` is only a local check; no guessed base-version/etag is sent.

The registry requires endpoint VERIFIED + explicit local config + reviewed schema/evidence for future eligibility. **Eligibility still cannot dispatch today**: transport and StudioClient retain physical rejection. After legal live observation and separate authorized reproduction, an audited production activation change is still required; this conservative boundary is intentional. No global unlock, auto-upgrade or entitlement change exists.

See [render pipeline](STUDIO_RENDER_PIPELINE.md), [capture harness](STUDIO_CAPTURE_HARNESS.md), [A–H plan](STUDIO_WRITE_VALIDATION_PLAN.md), [endpoint inventory](STUDIO_ENDPOINT_INVENTORY.md), and the latest report. Earlier reports/packages are retained as dated history; later scoped render implementation supersedes their pending-transform descriptions without rewriting those evidence files.
