> Current post-processing integration: API save/readback and real synthetic/music
> renders are recorded separately from UI mapping, which remains NOT VERIFIED.
> See [STUDIO_POST_PROCESSING.md](STUDIO_POST_PROCESSING.md). Profile-derived local
> inverse runs once; zero-fade handles, exact timeline continuity and default
> no-download behavior are preserved. Historical statuses below retain their
> original scope and are not a current completion claim.

# Studio render pipeline — final RC

Endpoint POST /api/studio/render-state: VERIFIED, verification.kind=request_acceptance.
Response parsing: VERIFIED for queued song_schema and project/version/range metadata.
Render completion: not VERIFIED by this validation. Original third-party completion
observation is historical; it does not enable current network polling.

## Tested path

Editor memory → audible main audio tracks → normalizeRenderStateStage1 (17660)
→ normalizeRenderStateStage2 (950155) → manual derived timing + metronome
→ serializeAudioProjectState → render-state.
Downbeats are derived from transformed timing; timeline range is explicit start/end.
Observed validation used one unmuted audio track, manual bps=1.95, first beat zero,
range 0–32, export_mode=fullsong_export, render_engine=v2.

These portions are status VERIFIED, verification.kind=request_acceptance for this
bounded profile. Individual alternative branches are not upgraded: solo/mute mixes,
fractional/negative ranges, nonzero first beat, selected range mode, context-window,
legacy paths, tempo automation, take lanes/plugins and multitrack remain static or
unsupported. A successful simple profile does not establish their semantics.

Source offsets for retained pure functions: stage1 module17660 @73412, stage2 950155
@103608, downbeat714981 @1216430, timing265449 @101050 in 0kfolb-xhy_j4.js;
caller748387 @825347 in 3g9-3c-u44c0o.js. These are existing evidence, not a new scan.

## Request/response boundary

Save state and render state are distinct branded handles. Never run save serialization
blindly on serialized GET state. request-builders preserves required fields and only
known enum values. Observed export modes other than fullsong_export stay static.
render-state returns a full queued entity, not a multitrack download_url object.
The real queued metadata.type is studio_export; do not rewrite it to the historical
rendered_context_window value. Parsers preserve unknown response fields.

RenderJob records QUEUED; it cannot infer COMPLETE or start unverified polling.
Multitrack render remains FOUND_STATICALLY with its separate download_url consumption.


## Current production inverse profile

The unified pipeline defaults to joint Rubber Band pitch +8 / pitch-preserving
tempo ×2 before AUTO_CHUNK. Studio uses transposition -8, relative speed ×0.5
(populated linear warp marker output beats divided by 0.5), and Stretch On.
Save/readback compares playback state before render; the range uses restored
timeline duration. Single-clip selection removes internal seams and handles, while
preserving both inverse and Studio transforms. Historical validation statuses above
refer to their individual captures, not the current end-to-end orchestration.

`--validate-transform` temporarily decodes the delivery for source comparison.
Known synthetic tones use a measured spectral peak. Polyphonic material uses a
confidence-gated relative spectral translation estimate; low confidence remains
NOT VERIFIED. Duration, envelope timing, levels, clipping candidates and spectral
distribution are separately reported. These metrics do not claim perceptual identity.
The original delivery stays on Suno unless `--download` is explicit.


## Durable render lifecycle

Production export uses authenticated `StudioClient.render_project`, which actually
dispatches POST `/api/studio/render-state` after save/version readback verification.
No frontend Export button is involved. The full-song contract uses the latest
save-returned version ID and a render transform/serialization of that readback,
with `start_beats=0`, `end_beats=max(saved arrangement.endBeats)`,
`export_mode=fullsong_export`, and `render_engine=v2`. End is never derived from
uploaded PCM duration or just one clip. At the default inverse, 91.363628 seconds
uploaded restores a 182.727256-second timeline, ending at 356.31814965986393 beats.

`<mode>/export-request.json` describes the prepared request. Only
`last-render-transport-request.json` (DISPATCH_STARTED) and the request summary in
`last-render-transport-response.json` audit actual SDK dispatch and its HTTP
status/result.id. Logs distinguish studio_export_binding, studio_export_request,
and studio_export_ack. Older journals without request summaries prove their
recorded acknowledgement/binding, not an independently captured full body.
No POST is repeated just to fill an older audit gap.

`jobs.json` and `<mode>/export-status.json` expose studioProjectSaved,
renderSubmitted, renderId, renderReady and deliveryResolved. `run-status.json` is
the current attempt's status: INCOMPLETE on failure, EXPORT_READY once delivery
is resolved, RUN SUCCESS only after the existing QA/download flow also completes.
Saved and queued do not count as success. A resolved asset must match this run's
actual project/latest saved version/range; an older identical-state cache bound
to another project/version cannot be declared a successful export for this run.
Summary output and render-summary retain exportStatus. Default delivery remains
on Suno; `--download` is still required to persist a final product.

On 2026-10-07, a live read-only resume verified the failed run's project latest
version and full timeline, made zero writes, and retained its two IDs. It still
ended INCOMPLETE/TIMEOUT with unavailable metadata/delivery. Separately, the known
24-second `77340a65-9eb7-4ae6-8ffd-a9c63c575641` export was freshly verified complete,
correctly bound, present in the account Library, and resolved by official delivery
without UI Export. That short control does not prove the failed 182-second run ready.

The production orchestrator records an acknowledged render ID before further
polling. States are SUBMITTED → QUEUED → WAITING_FOR_METADATA →
WAITING_FOR_DELIVERY → READY, or TIMEOUT / FAILED. HTTP 404 is eventual
visibility, not permanent disappearance; empty audio_url while queued is normal.
GET metadata and delivery calls retry with 1/2/3/5/8/10-second intervals, capped at
10 seconds. Rate-limit Retry-After remains respected. Default metadata budget is
900 seconds from acknowledgement; delivery budget is 180 seconds from observed
completion. Both are CLI adjustable and preserved across restart. An aged job is
queried once on resume even if its budget has elapsed, so late readiness can resolve.

TIMEOUT retains the render ID. FAILED requires an explicit server error state;
auth/binding validation errors keep the checkpoint without a replacement render.
The old three-404 + invalid_asset "confirmed_missing_render_retry" path is removed.
No resolver has render submission capability. After a primary 404/405, the
already documented reference-client `iD/338609` GET template
`/api/clips/get_songs_by_ids?ids=<id>` may resolve metadata. Empty `clips` arrays
remain temporary visibility, not missing proof; the exact returned ID/binding
must match. The live failed IDs returned HTTP 200 with empty arrays. Queued acknowledgements captured in
the transport journal can recover the submission/checkpoint crash gap only when
project, version and range match. Existing cached-complete reconciliation still
requires saved-state/source binding evidence; strict StudioClient behavior remains.

Legacy unavailableRenderIds are migrated into ordered, deduplicated renderJobs.
The oldest job is resolved first; only timeout or explicit terminal failure allows
trying another already acknowledged historical ID. No new render is submitted.
Completed metadata persisted for an exact matching ID/project/version/range may
be used when a later GET is temporarily 404; its provenance is labelled separately.

Official delivery remains preferred. Processing, ready-with-empty-url and
invalid_asset responses remain WAITING_FOR_DELIVERY until its budget is exhausted.
Only then inspect this exact clip's observed media_urls/audio_url. Trusted URLs
must pass a clear-container HTTP probe; /api/forbidden, masked signed URLs, unknown
hosts and encrypted bytes are rejected. No hidden endpoints, constructed media
URLs, decryption keys or entitlement changes are used. Full QA still validates
codec/duration. TIMEOUT reports whether fallback was absent or not decodable.

The 2026-10-07 failed run has two archived acknowledgements. Live resume made zero
network writes, retained both IDs and correctly ended TIMEOUT: both reads returned
404, official delivery remained invalid_asset, and the observed player CDN returned
ciphertext (encoding 1.0.0), not a usable delivery. Official song UI also returned
404. This is unresolved service-side availability, not a successful final delivery.
