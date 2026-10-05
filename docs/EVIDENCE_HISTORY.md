# Evidence history

Historical packages stay immutable. Superseded applies only to then-current conclusions, not to their authenticity. Raw private evidence is not included in final exports.

| Phase | Evidence artifact | Then-known result | Final upgrade / superseded |
|---|---|---|---|
| Static write recovery | SUNO_STUDIO_WRITE_STATIC_EVIDENCE.zip; SHA256 a2e7438d76ec5935a4c9b9b9d77c94ff0920b5ebd6df386bb57d4349c30d88e9 | writes only static; three later accepted | backend evidence supersedes static-only availability; browser COMPLETE supersedes missing ACK |
| Clip recovery | SUNO_STUDIO_CLIP_PIPELINE_EVIDENCE.zip; SHA256 2b8576422b63dfb6d3a13710bfc8e55f37f969902fa5f36fedab3479234d4c26 | client state mutation model; add/transpose later read back | backend evidence supersedes static-only availability; browser COMPLETE supersedes missing ACK |
| Dry-run SDK | SUNO_STUDIO_DRY_RUN_SDK_EVIDENCE.zip; SHA256 2e05b41a1371aaf86dd0f0a0d20e678e82c095a46b358e222451a52ad8ac11eb | 20 clips offline; network writes zero | backend evidence supersedes static-only availability; browser COMPLETE supersedes missing ACK |
| Offline live-ready tools | SUNO_STUDIO_LIVE_VALIDATION_READY_EVIDENCE.zip; SHA256 0b53e7df6eb94faaeaf4f11f8bc2437bf2285c47f20d3de2a8a5941982056ef1 | local rehearsals; no backend acceptance yet | backend evidence supersedes static-only availability; browser COMPLETE supersedes missing ACK |
| Browser read initial | SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip; SHA256 508a606a8a1bee051f3fb254b4ebacd84b8b7ceace74e7d24858ecff99014ad4 | real lossless data plane; missing stop ACK | backend evidence supersedes static-only availability; browser COMPLETE supersedes missing ACK |
| Stop ACK repair | SUNO_STUDIO_STOP_ACK_FIX_EVIDENCE.zip; SHA256 c8e28fb8887bffc98bcb949dcd239474910368afccdb9f60e3580d2d70253da1 | local recovery regressions; later real ACK succeeded | backend evidence supersedes static-only availability; browser COMPLETE supersedes missing ACK |
| Browser read complete | SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip; SHA256 b070d25ee0f5f359c5cdbfc2eeddb58ce15067829b0be28d91574b37596b02ec | real LIVE_CAPTURE COMPLETE incl stop ACK | backend evidence supersedes static-only availability; browser COMPLETE supersedes missing ACK |
| Authenticated Free write validation (2026-10-05) | private original report + response records; public STUDIO_FREE_WRITE_VALIDATION_SANITIZED.md | create, two saves, render HTTP 200, queued | create/save/render submission VERIFIED; no completion upgrade |
| Final RC consolidation (2026-10-06) | SUNO_STUDIO_FINAL_RC_EVIDENCE.zip | six verified endpoints + frozen browser harness, offline fixture lifecycle | no new production experiment; limitations remain explicit |

Write-validation request records are summaries; offline state/readback fixtures are reconstructed and labeled. No history entry upgrades multitrack, uploader pitch derivation, loudness or current render completion.
