# Tested Free-account Studio backend validation — sanitized

Observed on 2026-10-05 via real authenticated Browser Bridge transport (LIVE_CAPTURE).
The tested account's official Web UI requested Upgrade / Preview. Its authenticated
backend create, two saves and render submission each returned HTTP 200. This is an
observation for this account/run, not a claim about all Free accounts or product policy.

| Call | Status | Verification scope |
|---|---|---|
| GET /api/session/ | 200 | login/session probe |
| POST /api/studio/create-project | 200 | real response project ID + project GET readback |
| POST /api/studio/save-project (initial) | 200 | one audio track, source clip, serialized warp registry; version response + readback |
| POST /api/studio/save-project (transposed) | 200 | explicit transposition -5; new version + user-confirmed readback |
| POST /api/studio/render-state | 200 | submission and queued song_schema parsing; completion not tested |

ADD_CLIP is a client state mutation persisted by save, without a separate HTTP endpoint.
Tested serializer: serializeAudioProjectState, current static MD5 marker signature/hash,
identity markers {0:0,1:1.95}. This accepted path does not prove all possible marker maps.
Tested render profile: manual timing, one ordinary audio track, V2, fullsong_export,
range 0–32, transformRenderState + deriveDownbeats. Other branches remain static.
Render response metadata.type was **studio_export**; do not replace it with the
historical third-party rendered_context_window type.

Provenance: real response records exist privately in captures/live-write/result.json.
The report and original one-off validator are byte-preserved under captures/private/final-rc/.
Saved request records contain summaries, not full state/readback response bodies.
Regression state/readback fixtures are explicitly reconstructed locally; only response
fixtures are derived directly from real captured bodies. User confirmation provides
readback/transposition evidence in addition to the report; no new live test was run here.

The previous validator used broad temporary write overrides, printed a local pairing
key, and included private account fields in its generated report. It is archived and
removed from executable SDK entry points. Those mechanisms are not the final policy.
Uploader inverse pitch restoration remains CORRELATED. Automatic loudness repair and
multitrack render remain unverified. Backend evidence never enables the official UI.
