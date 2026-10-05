# Studio render pipeline — current bounded static evidence

All write findings below are **FOUND_STATICALLY / High**, never server VERIFIED. This pass used the existing 116-asset snapshot only; no new downloads, real read repeats or Suno writes. Full source hashes and zero-based UTF-16/byte offsets are retained in `suno/studio/endpoint-inventory.json` and the evidence artifacts. No source map was present in the snapshot.

## V2 single-track export

`3g9-3c-u44c0o.js`, module 748387, export function at 825347, POST call at 825864:

```text
native document.toProjectState()
 → filter effectively muted tracks
 → normalizeRenderStateStage1 (17660)
 → normalizeRenderStateStage2 (950155)
 → timing/manual derived timing + metronome overlay
 → project serializer (634782)
 → POST /api/studio/render-state (preview only)
```

| Stage | Input/output | Exact modification | Source | Local behavior |
|---|---|---|---|---|
| Audible track filter | Editor project → editor project | When any track is solo, keep solo tracks; otherwise keep unmuted tracks | V2 caller | Copy, preserve unknown fields |
| Stage 1 | Editor project → editor project | Main audio clips require `asset.type="clip"`; main video clips require `asset.type="video"`; other arrangement kinds remain at this stage | `0kfolb-xhy_j4.js`, 17660 @73412 | Copy; takeLanes untouched |
| Stage 2 | Editor project → editor project | Remove muted main clips | Same bundle, 950155 @103608 | Copy; official no-mute fast path can return original input |
| Timing | Editor timing → derived timing | Manual uses bps/bpsAutomation and firstBeatSeconds=0; lockBPS clears automation | 265449 @101050 (export alias within registered module 877073) | Port accepts manual constant BPS only; follow-track/automation rejected |
| Overlay | Normalized editor → render editor | `timing={type:"manual",...derived}`, `metronome={enabled:false,amplitude:1}` | V2 caller | No input mutation |
| Serializer | Inline warp maps → wire | Remove inline markers, generate MD5 marker hash, build fresh registry containing referenced maps only | 634782 / 879379 | Independent of editing PRESERVE_EXISTING policy; unused tail entries removed |

The local full transform intentionally rejects MIDI/video/takes/plugins rather than pretending this table is a complete DAW port. Generic Stage 1/2 behavior is separately tested. Unknown fields outside the actual transformations remain preserved. Save state is never re-used as render state through a forged domain handle.

## Range and downbeats

**FOUND_STATICALLY.** Range is computed from the audible native state **before muted-clip filtering**. Full-song flag or equal anchor/focus uses min main-clip start and max end; empty fallback is 0/240. Otherwise use min/max selection beats. Muted clips can still affect this pre-normalization range. No downbeat offset is added to start_beats/end_beats.

714981 @1216430 derives pairs for `beat = ceil(start); beat < floor(end); beat++`:

```text
[seconds(beat) - seconds(start), (beat % 4 + 4) % 4 + 1]
```

The recovered manual seconds helper is `beat / bps + firstBeatSeconds`; duration uses seconds*bps. Export's derived manual timing resets firstBeatSeconds to zero. Fractional boundaries, negative beats and floating-point behavior have local tests. Automation/follow-track need the wider official timing machinery and are explicitly unsupported in this MVP.

## Observed enums and branches

| Literal | Actual use | Status |
|---|---|---|
| fullsong_export | V2 full-song export flag true | FOUND_STATICALLY |
| selected_time_range_export | V2 flag false, including equal-selection range fallback | FOUND_STATICALLY |
| rendered_context_window | Context-window branch, not synthesized by V2 preview builder | FOUND_STATICALLY |
| selection_download_export | Separate selection-download branch | FOUND_STATICALLY |
| v2 | Explicit render engine in recovered V2 calls | FOUND_STATICALLY |
| studio_export | Clip type; not export_mode | FOUND_STATICALLY |

Legacy `v1` is a cache-key fallback string in the recovered code, not an established wire default or an added RenderEngine enum. Preview builders allow the two observed V2 export modes only; caller supplies workspace/Studio/version bindings explicitly. They do not infer one ID from another.

## Lyrics and response chain

**FOUND_STATICALLY.** 402294 @1216663 joins token text without separators. The V2 caller also uses 757416 @1323564, source lyric mapping 801426, range crop 746546 and token merge. These nonempty aligned-source/range branches were recovered as code, but are **not fully ported**. The current historical captures do not provide aligned source lyrics; empty explicit lyrics work locally. The SDK must not claim complete nonempty lyric equivalence or invent alignment.

The response is open. The caller checks moderation/error conditions and consumes `data.id`; id/title are passed to onRenderedClip. In the same component that callback is a state setter (792341), and the stored reference drives a toast link `/song/${id}` (817637–817907). **No polling loop occurs in this recovered export consumer.** We do not infer a generation/job API or invent `/api/clip/...`. RenderJob models only a received clip reference and observed matching metadata; polling remains blocked until an actual polling READ endpoint is observed and verified. Full response and successful audio/render output still need legal live access.

## Distinct branches

**FOUND_STATICALLY.** Multitrack module 371498 @40867 resets track mute/solo before 17660/950155 and timing/metronome serialization. Its request uses wav/v2/studio_v2 and consumes download_url. It is a separate download flow; its response schema never replaces render-state's clip response. Signed URL signatures remain redacted.

Legacy module 130800/588758 uses 17660 →180172 →serializer 371089. 180172 @103339 calls heard-state helper 831290 @103789 before mute filtering. That helper includes take preview/split mapping; local legacy support is explicitly limited to main audio lanes without active take previews. This legacy chain is not substituted into V2.

`renderTransformComplete=true` now means **the manual constant-BPS audio MVP state chain is statically ported and locally tested**. It does not certify nonempty lyrics, wider editor timing/take machinery, server compatibility, permissions or output quality.
