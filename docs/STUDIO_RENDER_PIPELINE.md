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
