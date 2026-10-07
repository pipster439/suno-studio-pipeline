# Studio post-processing and local inverse

The official session exposes clip controls in Preview, but editing Loop produced
the Premier prompt. The user explicitly deferred controlled UI editing. **All
eight UI before/after mappings remain NOT VERIFIED.** This implementation neither
changes entitlement nor bypasses that prompt.

Evidence layers are separate: official static callback, API save/readback, render
A/B, and actual UI save/diff. A successful API save does not certify a UI mapping.
Fixtures record source hashes, the neutral UI observation and individual API tests.

| Control | Real representation found statically | API persistence | Render / inverse |
|---|---|---|---|
| Loop | `loop.enabled` | Verified Off/On readback | Current Off is no-op; On render/inverse not verified |
| Reverse | `reversed`, plus placement/warp edits in the official action | Boolean readback verified | Current Off is no-op; On is not implemented as a guessed boolean-only inverse |
| Stretch | `warp.enabled` and populated markers | Verified | Populated linear warp measured; unwarped nonzero pitch/speed inverse is rejected |
| Quantize | transient-dependent marker quantization action | NOT VERIFIED | Audio callback changes warp markers; menu value is React state. Neither EDITOR_ONLY nor a persisted `quantize=1/2` field is claimed |
| Pitch | `transposition` | Verified | Local pitch = negative Studio pitch; measured -8/+8, other semitones use the static semitone contract |
| Speed | divide output marker beats, trim, clip duration and loop bounds by action ratio | Verified 0.5 | Local pitch-preserving tempo ×2 cancels half-speed linear warp duration; a rate ×2 candidate is separately tested |
| Formant | `formantCorrection` blend 0..1 | Verified | Observed UI is 0%; neutral inverse no-op. Correction 0.5 with pitch -8 changed rendered spectral/energy metrics; human formant recovery remains unmeasured. Non-neutral inverse NOT_SUPPORTED: applies requested Studio value, emits warning, does no hidden local DSP |
| Volume | linear `amplitude`, UI displays dB | Verified | Local reciprocal gain is theoretical; positive boosts are peak capped with a restoration warning. Upload level changes can invalidate end-to-end restoration |

Both speed buttons (`½` and `×2`) are visible together. They are **relative actions**,
not evidence that current speed is 0.5. The user explicitly specifies the production
target: Loop/Reverse Off, Stretch On, pitch -8, relative speed 0.5, formant 0,
volume 1 and quantize menu label 1/2. This is the default, independently of the
unverified UI mapping:

```powershell
node scripts/studio-pipeline.mjs song.mp3
```

Its local inverse is pitch +8 and joint Rubber Band tempo ×2 (pitch preserving), followed
by AUTO_CHUNK on the actual compressed PCM, sample-accurate slicing and Studio
half-speed warp. A single clip skips seam mitigation, not inverse processing: its
preprocessed duration is half the source and its Studio timeline restores that duration. Speed-only (pitch 0, ratio
0.5) instead uses the measured atempo ×2 candidate: it restored pitch/alignment
better than Rubber Band tempo in that synthetic test. The combined -8/0.5 case
keeps joint Rubber Band because its transient correlation was better than sequential
pitch + atempo. These are narrow measured cases; other speed combinations warn
NOT VERIFIED. Local inverse version v2 includes the tempo engine in cache identity. Uploads must still satisfy
the service's six-second minimum: a compressed source shorter than that is rejected
explicitly. Handles are measured in preprocessed source milliseconds; absolute
timeline starts/ends and read trims are scaled together, with zero fades/overlap.

`--studio-pitch -5` derives +5 once. `--local-pitch` overrides the derivation.
Legacy `--pitch-up` / `--studio-transpose` remain explicit aliases; contradictory
aliases fail. `--studio-volume`, `--studio-formant`, `--studio-stretch on|off` and
`--studio-profile default` are supported with the limitations above. Preprocessed
PCM supplied explicitly bypasses local transforms and is labelled unverified reuse.

Every save is read back before render. Profile, trim, warp, amplitude, fades and
source IDs must agree; server normalization is reported rather than silently
rendering a different state. Calibration fingerprints include profile hash, inverse
version, tempo/gain and warp version. Previous pitch-only calibration caches are
incompatible with this schema. Profile version v2 changes the production default
and invalidates previous calibration profiles. Existing bound runs keep their saved
profiles on resume; start a new run to use the new default.

## Warp provenance

Official `makeSpeedUpdateFn` (448249) / `scaleMarkers` (981734) divide marker output
beats by a relative speed action. Production additionally scales absolute clip
placement so all joins remain exactly contiguous. This is not a pitch-derived warp.
The live historical good project still has bps 1.95 and slope 3.0954320513379887,
matching `1.95 * 2^(8/12)`. That remains **CORRELATION ONLY**. Its source/title differs
from the initially visible UI project; no merged provenance or invented formula.
See `fixtures/GOOD_PROJECT_PROFILE.json`, `studio_postprocessing_evidence.json` and
`studio_postprocessing_api_readback.json`.

## Verification and limitations

```powershell
node scripts/studio-pipeline.mjs --postprocess-test
node scripts/studio-pipeline.mjs --postprocess-test --resume runs/<matrix-run>
node scripts/studio-pipeline.mjs song.mp3 --validate-transform
```

The matrix uses deterministic non-catalog tones, sweep, harmonic content, noise
percussion and transients; it records isolated API field readbacks and short render
comparisons in `postprocess-matrix.json`. Some combinations necessarily keep Stretch
On as a common control. Synthetic harmonics are not human voice/formant evidence.
Transform comparison records duration, synthetic-tone pitch, RMS/peak, clipping,
10 ms envelope alignment, waveform correlation and log-band FFT spectral distribution.
Its versioned centralized limits are in `transform-verification.mjs`. Spectral
cosine and envelope lag are proxies, not a claim of perceptual equivalence.
Arbitrary polyphonic pitch/formant estimation remains NOT VERIFIED.

`--validate-transform` temporarily decodes the full delivery for reference comparison.
Ordinary production uses remote boundary QA first and reliable temporary fallback.
Only `--download` saves the native delivery. Successful runs remove large temporary
PCM/delivery files; failures retain checkpoints. Matrix source/candidate WAVs are
regenerated deterministically on resume, and removed after completed analysis.

Suno can return a complete export belonging to an earlier identical state instead
of the requested project/version. The SDK's strict guard remains unchanged.
Orchestration only reconciles this case after GET confirms identical saved playback
state, exact source IDs, matching range and actual render binding; diagnostics and
summary retain both requested and actual project/version. Otherwise it stops.

No independent fades, auto gain, limiter, compression, EQ or normalization are used.
Render restoration may be WARN even when seam QA passes, especially for synthetic
sources whose upload loudness changes. Full UI reproduction and reliable non-neutral
formant inversion remain unfinished and explicitly unverified.

Pairing credentials are displayed only on interactive stderr, never redirected
logs. `--json-log` keeps stdout as JSON records, including the final summary;
the matrix forwards this mode to every candidate.


## Default inverse correction validation (2026-10-07)

The production default is now profile v2: Studio -8 / relative speed 0.5 /
Stretch On, with local +8 / tempo ×2 in one joint Rubber Band pass. AUTO_CHUNK
uses actual preprocessed duration and never resets the transforms to identity.

Live music: source 174.96 s, preprocessed 87.48 s, render 174.9735 s; one clip,
zero internal boundaries, zero handles/fades, amplitude 1. Save/readback matched
pitch, enabled warp and marker slope 3.9 (= base 1.95 / relative speed 0.5),
with zero read trim. This slope follows the existing relative speed action, not
the historical pitch/warp correlation formula.

Known synthetic tone: 220 Hz → 221.8 Hz (+14.107 cents), duration delta +13.5 ms,
envelope alignment +10 ms. Music: relative spectral shift estimate 0 cents at
12.5-cent resolution (16 aligned windows); this is a confidence-gated spectral
estimate, not a per-voice pitch or formant claim. Detector thresholds are central
in `suno/audio/spectral-pitch.mjs`; insufficient confidence reports NOT VERIFIED.

Music RMS delta was -1.236 dB and clipping-candidate counts were 2 source /
2 rendered; the rendered peak was lower. The conservative full-transform gate
remains WARN. Synthetic RMS delta was +4.455 dB and also remains WARN. No
automatic level repair, limiter or normalization was applied. The temporary full
QA fallback was removed after analysis; no final delivery was persisted.
