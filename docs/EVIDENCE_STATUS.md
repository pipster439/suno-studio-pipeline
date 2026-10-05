# Unified evidence schema

`status` for endpoints and rules is one of **UNKNOWN, OBSERVED, CORRELATED,
FOUND_STATICALLY, VERIFIED**. High confidence does not upgrade static evidence.

Detailed verification uses `verification.kind`: `create_readback`, `save_readback`,
`request_acceptance`, `lossless_read`, `browser_live`. Terms such as
VERIFIED_BY_SAVE_READBACK and VERIFIED_BY_REQUEST_ACCEPTANCE are display descriptions,
not additional enum members. Scope, source refs and limitations are required.

Dispatch is a separate policy. `status=VERIFIED` never grants default write access.
Endpoint registry default `dispatchAllowed=false` for writes means local permission
is closed; runtime gate requires VERIFIED metadata and explicit local configuration.
Unknown and static writes stay denied even with configuration enabled.

Provenance source labels DEFAULT/USER_SUPPLIED describe field origin, not endpoint
evidence. LOCAL_ONLY/OFFLINE_FIXTURE_REPLAY describe execution origin, not verification.
UI availability is independent: the tested account's official UI was entitlement
blocked, while three backend endpoints returned 200. Neither implies general policy.
