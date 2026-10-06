# Local Suno Studio Controller / Recorder — 0.3.0-rc.1

A small local Node SDK and authenticated browser transport for owned Suno projects.
It builds audio timelines, preserves full state, previews requests and records evidence.
This is an internal/unofficial API client, not a supported public Suno API.

## Current capabilities

Three reads are VERIFIED: project, specific version (LOSSLESS), versions list.
Create project, whole-state save and V2 single-track render submission are VERIFIED
for the tested account/run. Add existing audio and explicit transposition -5 persisted
through save/readback. The unified pipeline additionally verifies complete render
bindings, official unlocked-song M4A download, decoding and boundary metrics.
Multitrack and automatic uploader pitch/loudness rules are not promoted.
Browser capture (fetch/XHR, supported reload/SPA scope, lease, privacy, stop ACK)
is LIVE VERIFIED / COMPLETE and frozen. See docs/STUDIO_SDK_STATUS.md.

## Architecture

`StudioClient → SunoBridge → loopback HTTP/WebSocket → Browser page → CustomEvent
→ Tampermonkey authenticated request → Suno`.
The recorder observes official browser traffic separately and sanitizes both ingress
and export. Auth remains in the privileged browser transport; SDK does not store JWTs.
Modules are under suno/studio, suno/bridge, suno/recorder and shared.

## Install and run

Node >=22, then:

```powershell
npm install
npm run build:userscript
npm run build:studio-harness
npm start
```

Open http://127.0.0.1:3000/ and install combined local-transport.user.js v1.3.19.
Enable only one combined recorder, refresh a logged-in Suno page, and confirm the
Panel handshake. Controller 0.3.0-rc.1 / protocol 3 / harness 1.1.1 are compatible.
Run Read-Only Self Test and Export Evidence from the folded page panel; no DevTools.
The read-only harness source/protocol semantics are frozen; new script build changes
only the audited write guard and embeds the central endpoint policy snapshot.

## SDK and offline use

`StudioClient.get_project`, `get_project_version`, `get_project_versions`,
`create_project`, `save_project`, `render_project` form the single supported client.
Source/arrangement IDs differ. Create response supplies project ID; save response
supplies version ID. No UUID is inferred or reused when a response omits a binding.
Pure builders remain preview-only even for VERIFIED endpoints.

```powershell
node examples/studio-fixture-lifecycle.mjs
npm run dry-run:studio
npm run offline-validation-rehearsal
npm test
node --test tests/*.integration.mjs
```

The full fixture lifecycle consumes no production network. Real integration tests
remain disabled unless explicitly enabled; final consolidation never enables them.

## Security and write policy

Studio writes are **closed by default** at SDK, local transport/controller and
privileged browser boundaries. Explicit `allow_verified_studio_writes=true` is a
local configuration, not a request-level override; controller options and private
Tampermonkey GM setting must independently permit it. Only exact VERIFIED POST
entries may pass. Unknown writes, alternate methods, multitrack and previews fail.
Old allowWriteValidation flags, page globals and ALLOW_STUDIO_WRITE_VALIDATION
cannot bypass the policy. See docs/EVIDENCE_STATUS.md and endpoint-registry.mjs.

The tested Free account's official Web UI showed Upgrade / Preview; authenticated
backend create/save/render returned 200. This says nothing about other accounts or
future product policy. No UI unlock, entitlement override or subscription spoof exists.
The official A-H UI wizard remains unavailable; backend capability is separate.

## Studio state model

Keep distinct source metadata → clip draft → editor memory → save serialized state
and render transformed state. Decode raw wire exactly once; serializers require
branded handles. Copy-on-write preserves unknown fields. Manual timing and one audio
track are the validated MVP. Explicit processing is separate from uploader-derived
rules. Warp strategy must be selected explicitly; tested current MD5 identity-map
serialization does not prove every warp map or historical hash spelling.

## Evidence and privacy

See docs/EVIDENCE_HISTORY.md, docs/STUDIO_API_MAP.md and docs/KNOWN_LIMITATIONS.md.
New response fixtures are deidentified, with source provenance. Reconstructed test
readback states are labeled; no local test is presented as a new real browser run.
Raw reports/account data stay under ignored captures/private. Historical captures
and packages are preserved, not rewritten. Public/final exports use sanitized small
summaries and omit credentials, account identity, business UUIDs and signed secrets.
Credential audit checks values rather than banning harmless header field names.
Task-only patch is separate from the evidence ZIP and excludes pre-existing changes.

## Known limitations

Multitrack, tempo automation, MIDI, take lanes and plugins are not part of the
verified core. Uploader inverse pitch is CORRELATED and opt-in;
automatic loudness repair is not implemented. Internal endpoints can change.
No further reverse engineering is required for the validated core workflow:
create → add existing clip → save → explicit transposition → save → render submission.

## Unified audio pipeline

```powershell
node scripts/studio-pipeline.mjs song.mp3
```

The command defaults to `--chunk-seconds auto`. It reads the Studio profile and
applies the supported local inverse once. **AUTO_CHUNK minimizes clip count** from
the resulting PCM duration, sample format, WAV upload bytes and verified upload
constraints: one clip is preferred to two, two to three, and so on. It uploads with
four bounded workers, saves/reads back the Studio state, renders and runs remote QA.
The result
stays on Suno by default: no final full-song file is saved locally.

Observed formant is neutral (0%) and volume is 0 dB. The half/double speed buttons
are actions; default retains verified identity timing. `--studio-speed 0.5` applies
half speed with a local pitch-preserving tempo inverse. UI before/after mapping is
NOT VERIFIED because official edits were subscription-blocked; Quantize is not
faked as a persistent audio scalar. See [post-processing evidence and limitations](docs/STUDIO_POST_PROCESSING.md).

Node 22+, ffmpeg with Rubber Band and ffprobe are required on PATH (or FFMPEG /
FFPROBE). Keep the existing authenticated Tampermonkey Browser Bridge connected.
The command starts the existing loopback controller and displays pairing credentials
only on an interactive stderr terminal. Redirected logs omit the key; use the
existing controller environment or pair interactively once.
It uses the existing verified write guard and does not change authentication or
permissions. Use only audio you have permission to upload.

```powershell
node scripts/studio-pipeline.mjs song.mp3 --download
node scripts/studio-pipeline.mjs song.mp3 --diagnose --keep-workdir
node scripts/studio-pipeline.mjs song.mp3 --recalibrate
node scripts/studio-pipeline.mjs --resume runs/<run-id>
node scripts/studio-pipeline.mjs --resume runs/<run-id> --download
node scripts/studio-pipeline.mjs song.mp3 --dry-run
```

`--download` saves the official native M4A delivery as
`runs/<run-id>/song-studio-render.m4a`. `--output PATH` requires `--download`.
An explicit .wav/.mp3/.flac output is a conversion; delivery-summary.json records
both formats, transcoded=true and the file hash. Decoding compressed delivery to WAV does not
establish a lossless source. An unavailable official delivery fails explicitly;
there is no player-stream interception or entitlement workaround.

### AUTO_CHUNK and conditional seam calibration

The observed server upload window is 6–480 seconds; actual runs refresh only
`audio_upload_limits` from the existing read endpoint. This does not modify account
permissions. A service file-size maximum is used only when established by a signed
upload policy or a definite size rejection; unknown size limits are not invented.
WAV bytes are calculated from the actual sample rate/channels/PCM format, including
header and padding. Planning happens **after local inverse preprocessing**.

One clip: EXACT_CUT, zero internal boundaries, no pre/post handles, fades or
crossfade, and **no seam calibration**. General duration/quality checks still run.

Multiple clips: approximately equal sample-accurate chunks with the minimum feasible
count. The default first renders the full EXACT timeline and checks its real internal
boundaries. A passing render is reused as production; it is not rendered twice.
Only measured internal seam warnings trigger mitigation calibration. Unrelated
endpoint codec padding or duration warnings do not trigger handle search.

After an exact seam failure, test PRE_ROLL_HANDLE at 50, 100, 200, 300 and finally
500ms, stopping at the **first passing** candidate, with 200ms post-roll. Short local
context around a measured real cut is used; large chunks may supply only one actual
boundary in that test. The tool does not invent six-second boundaries for calibration.
Numeric chunk duration retains the legacy short-region calibration path for research.

A definite ordinary duration/size constraint or exhausted safe S3 transfer failure
can reduce the candidate from one clip to two, then three, always seeking the smallest
successful count. Previously uploaded identical WAV hashes are reused. Catalog/content
matching, permissions, authentication, exhausted rate limits, unknown processing
errors and writes with uncertain outcomes stop; changing cuts is never used to retry
those rejections. `chunk-selection.json` records constraints, cuts, actual upload byte
sizes and attempts. The final summary reports PREPROCESSED DURATION, CHUNK STRATEGY,
CLIP COUNT and INTERNAL BOUNDARY COUNT.

Each candidate uses the same PCM, timeline cuts, warp, transpose, gain=1 and
fade=0. Independent calibration projects carry distinct run IDs. Unknown deletion
endpoints are not used; their project/version/render relationships remain recorded.
Identical slice content hashes reuse completed uploads within the run. Different
handle bytes cannot reuse the same upload by logical slice index alone.

The centralized policy in suno/audio/quality.mjs has a versioned detector and
threshold version. Passing requires zero anomaly, internal unexpected silent gap,
clipping candidate and timeline gap; at least 16 active normal controls; mean score
<=3, maximum <=6; and absolute duration error <=50ms. The fixed score guard is based
on historical clean music scores below 2 versus failed scores above 30, and is not
adjusted for an individual candidate. The existing detector still compares
boundaries with 128 deterministic random ordinary windows; large derivatives alone
are not classified as clicks. Results are **AUTOMATED QUALITY RESULT**, not a
perceptual perfection claim. Full production QA can still warn after calibration.

Successful profiles are cached at runs/cache/calibration/<fingerprint>.json.
The fingerprint includes source and PCM content, processing implementation,
pitch/transpose, chunk mode, actual auto cuts/count, post-roll, bps, sample format and service minimum.
Schema/detector/threshold mismatches invalidate it; --recalibrate forces new tests.
For multiple clips: explicit CLI handles/strategy > compatible mitigation cache > calibration.
The ordinary AUTO_CHUNK path always checks EXACT first, even when a mitigation cache exists.
One clip always forces EXACT without handles, including with an explicit handle override.
--skip-calibration without explicit handles selects the verified 50ms pre/200ms
post default. --preroll-ms 100 cannot be overridden by a 50ms cache.
If all mitigation candidates fail, CALIBRATION_FAILED stops before a mitigated production render;
the acknowledged EXACT diagnostic render remains recorded. Only an explicit
--allow-quality-warning permits proceeding with the last tested 500ms candidate,
while retaining the failed status and diagnostics. No fade/crossfade is substituted.

### Remote quality and workspaces

Quality checks obtain the official delivery URL, probe metadata and test HTTP Range.
Expanded FFmpeg windows expose original PTS and are cropped locally around the exact
theoretical boundary. Two independent seeks must align within one sample with
correlation >=.9999. Modes are RANGE, SEEK and FULL_TEMP_FALLBACK. Range support alone
is insufficient: request/decode coverage is estimated including normal controls.
If seek is unreliable or probes cost more than one temporary decode, delivery is
downloaded into a QA workspace, decoded, analyzed and removed after successful QA.
This temporary artifact is not a requested final download. Signed URL parameters
are redacted in durable logs; resume obtains a fresh official URL.

Every boundary has +/-500ms, +/-50ms and +/-10ms metrics: peak/RMS, RMS on each side,
DC, derivative, adjacent jump and zero crossings, with normal-window baselines.
Internal silence is compared against the corresponding local source; endpoint
silence/padding is reported separately. Delivery tail tolerance is 50ms. Remote-only
silence coverage is explicitly limited to boundary/control windows; fallback covers
all PCM. JSON/CSV diagnostics and sanitized state snapshots are retained.

Each run includes config.json, source-info.json, calibration.json, chunk-selection.json (auto),
upload-results.json, jobs.json, studio-summary.json, render-summary.json,
quality-summary.json, summary.json and run.log. Summary lists selected handles,
project/version/render identifiers, a sanitized delivery URL, quality metrics,
phase timings and candidates actually tested this run (cache history separately).
Default success removes preprocessed WAV, slices and temporary full QA assets.
Failure, --diagnose or --keep-workdir retains debugging artifacts; --diagnose also
writes boundary snippets. --verbose shows individual upload stages; --json-log
prints structured diagnostics. Logs do not retain browser credentials.

Resume checks source hashes and reuses upload mappings and bound project/version/
render IDs, including interruptions after calibration or render before QA.
Completed QA is reused; a subsequent --download need not recreate or rerender the
project. Uncertain writes stop for binding reconciliation rather than duplication.
Do not concurrently resume a run. Remove a stale lock only after checking its PID.
--dry-run, including production resume, performs zero network reads/writes.

### Advanced parameters and existing experiments

--chunk-seconds auto, --studio-pitch -8, --studio-speed 1, --studio-stretch on,
--studio-formant 0, --studio-volume 1, --upload-concurrency 4,
--strategy auto|exact|preroll, --preroll-ms N, --postroll-ms N and --bps 1.95
are supported. Source sample rate and channels are retained through WAV processing.
There is no MP3 intermediate, normalization, auto gain, limiter, compression or EQ.
Pre-roll changes source context/read offset; logical duration remains unchanged,
with zero audible overlap/gap, zero fades and amplitude=1. The observed six-second
upload minimum is a lower compatibility bound, not the normal chunk size. Explicit
`--chunk-seconds 6` remains for diagnosis/legacy research only; its short tail is merged
into the preceding slice. Historical `--abc-test`, `--gain-test` and
`--strategy-evidence` require an explicit numeric chunk size.

Historical --abc-test / --handle-test / --gain-test, --preprocessed WAV,
--reuse-uploads JSON and --strategy-evidence runs/<calibration> remain advanced
research compatibility options, not requirements for ordinary use. Evidence
profiles are source/config checked; gain-test remains an explicit independent
experiment and never enables gain compensation in production. Crossfade is rejected
until an equal-power Studio model is verified. --good-project / --bad-project and
optional version IDs retain sanitized semantic diff diagnostics. Historical evidence
and one-off archives under captures/seam-task-baseline/ are preserved. All new
production/calibration runs use this one entry; offline tests never call real Suno.

### Historical six-second production verification (2026-10-06)

VERIFIED_BY_E2E on the supplied music: automatic selection chose 90–132s;
EXACT had three candidates and 50ms pre/200ms post had zero, so search stopped
after two candidates. Full production had 28 boundaries, zero candidates and
zero timeline gap. Real CDN Range returned 206 and independent seeks aligned at
zero samples with correlation 1. The fixed baseline-window cost rule selected
FULL_TEMP_FALLBACK; default success left no audio or QA intermediates. A new
--download run hit the calibration cache, tested zero new candidates and saved
native M4A with measured Opus codec, without transcoding. Resume reused the same
project/version/render and completed QA. Detailed evidence is in
deliverables/SUNO_AUTO_CALIBRATION_20261006/REPORT.md.

### Music source verification (2026-10-06)

VERIFIED_BY_E2E on the supplied 174.96s source: controlled first-42s A/B/C
had 2/3/0 candidate seams. All 50/100/200/300/500ms handles had zero candidates;
zero-transpose handled trim aligned at 0 samples (correlation .9976..9999).
The shortest qualifying 50ms pre-roll +200ms post-roll was then verified on all
29 clips/28 boundaries: zero candidates, mean/max score .6407/1.3121, zero timeline
gaps and fades, gain=1, final duration 174.9735s (13.5ms delivery padding).
The full-source original B returned missing assets twice; the complete 42s ABC
and full handled production are distinct evidence. Gain compensation did not fix
the zero-transpose seams and remains an independent opt-in experiment.

```powershell
node scripts/studio-pipeline.mjs "C:\Users\ROG\Downloads\music.mp3"
```

OBSERVED_IN_GOOD_PROJECT: live historical good state still has bps=1.95 and warp
slope 3.0954320513379887, matching bps × 2^(8/12). Its sources/timeline differ
from this experiment. This correlation has not been promoted to a playback algorithm.
The results support a source-edge processing artifact; the exact server encoding/
playback stage and hidden DSP pre-roll remain unproven. Automated candidate scores
and alignment checks do not establish absolute listening perfection or a universal fix.

`--local-pitch` overrides the derived local semitone value.
`--validate-transform` adds temporary full reference comparison; only `--download`
saves a final delivery. `--postprocess-test` runs the short synthetic API/render
matrix (and accepts `--resume`); non-neutral formant inversion stays unsupported.
