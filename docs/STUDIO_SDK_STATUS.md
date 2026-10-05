# Studio SDK final release candidate status

Version 0.3.0-rc.1. Evidence is account/run scoped. Endpoint status, default write policy,
and official UI availability are independent. Browser Harness sources are frozen.

| Capability | Implemented | Tested | Live verified | Default dispatch | Scope / limitation |
|---|---|---|---|---|---|
| Read project | yes | yes | yes | read allowed | complete wire state |
| Read specific version | yes | yes | yes, LOSSLESS | read allowed | masks=[] |
| List versions | yes | yes | yes | read allowed | observed list schema |
| Lossless transport | yes | yes | yes | read allowed | state digest consistent |
| Create project | yes | yes | yes | closed | major_version=2 query path |
| Add existing clip | yes | yes | yes via save/readback | local mutation | no add HTTP endpoint |
| Save project | yes | yes | yes | closed | one audio track, whole-state save |
| Explicit transposition | yes | yes | yes | local mutation | -5 + save/readback |
| Warp serialization | yes | yes | tested path | local mutation | current MD5 identity map 0:0,1:1.95 |
| Render submission | yes | yes | yes | closed | V2 fullsong_export, queued |
| Render completion tracking | reference/queued model | yes offline | no current-run completion | polling closed | previous third-party observation only |
| Multitrack | preview | yes offline | no | refused | static only |
| Browser Harness | yes | yes | yes COMPLETE | read-only | frozen, scoped SPA/reload/lease/ACK/privacy |
| Uploader inverse pitch | explicit opt-in | yes local | CORRELATED | automatic false | no official inverse-rule proof |
| Automatic loudness | refusal stub | yes | no | refused | unknown |

Read and browser evidence remain real, never relabeled simulated. Final fixture
lifecycle tests are offline; response shapes are real-derived, readback state is
reconstructed and explicitly labeled. No new production request was sent here.
Unknown/unverified writes cannot pass policy; VERIFIED writes also need explicit
configuration at each transport boundary. Official tested Free UI remains blocked.
No further reverse engineering is required for the validated core workflow.
