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

Node 22+, ffmpeg with the Rubber Band filter, and ffprobe must be on PATH
(or set FFMPEG / FFPROBE). Keep the existing authenticated Tampermonkey browser
transport connected. This command starts the existing loopback controller and
prints its pairing URL; open it in that browser. It enables verified Studio writes
locally for this explicitly requested workflow; the privileged browser write guard
must already allow them. It never changes that guard or stores Suno authentication.

```powershell
node scripts/studio-pipeline.mjs input.wav --output final.wav
node scripts/studio-pipeline.mjs input.wav --abc-test --diagnose --keep-workdir
node scripts/studio-pipeline.mjs --resume runs/<run-id>
node scripts/studio-pipeline.mjs input.wav --dry-run
```

The single entry decodes PCM, applies Rubber Band +8 semitones, slices by source
sample index, uploads with four bounded workers, creates/saves/reads back a Studio
project, applies -8 transposition, renders, downloads, decodes WAV and checks quality.
Sample rate and channel count are retained. There is no intermediate MP3, loudness
normalization, limiter, compression, independent fade-in/out or automatic gain.
Final delivery uses the account's official unlocked-song M4A endpoint; final.wav is
decoded PCM from that compressed delivery, not a claim of lossless Studio export.
An unavailable download entitlement fails explicitly. Player streams are not intercepted.

Options include `--chunk-seconds 6`, `--pitch-up 8`, `--studio-transpose -8`,
`--upload-concurrency 4`, `--strategy auto|exact|preroll|crossfade`, `--preroll-ms 300`,
`--postroll-ms 200`, `--crossfade-ms 10`, `--verbose`, `--json-log`,
`--good-project ID --bad-project ID` (optional corresponding version IDs),
`--abc-seconds 18` (explicit shortened *shared* experiment interval),
`--abc-test-only` (requires `--abc-test`, omits the subsequent production render),
`--preprocessed FILE.wav` and `--reuse-uploads JSON` (explicit hash-verified reuse).
The default ABC interval is the entire preprocessed source. Rejected uploads fail
without replacement attempts; use only audio you have permission to upload.

The observed upload service minimum is six seconds. `--minimum-slice-seconds 6`
merges a shorter final remainder into its preceding slice, preserving every sample,
the total duration and zero fades; actual boundaries come from that arrangement.
For example 174.96s becomes 28 × 6s plus one 6.96s slice. Sources shorter than the
minimum fail locally. Already-saved legacy runs keep their original cuts; upload-only
legacy resumes adopt this minimum and reuse only hash/mapping-identical clips.

`auto` starts with EXACT_CUT. A/B/C reports candidate anomaly distributions
against deterministic random ordinary windows, never an absolute listening verdict.
No result establishes a universal DSP reset root cause. `preroll` is experimental:
the serializer proves read-offset math, but hidden DSP processing before audible
start require separate evidence. When A/B/C supports per-clip reset, the tool first
checks zero-transpose handled trim alignment against A (correlation ≥.95, lag ≤2ms).
It measures 50/100/200/300/500 ms sequentially on a short prefix (four clips by
default; `--handle-clip-count 2..10` can include an observed problem seam), then promotes
only a measured ≥30% reduction in both mean and maximum scores, no extra anomalies,
and matching duration. Among qualifying candidates it prefers fewer anomalies,
then the shortest handle. `--abc-test --handle-test` explicitly runs these experiments.
Without ABC or matching calibration evidence, auto retains exact cuts.
To reuse a completed calibration on the same PCM source, pass
`--strategy auto --strategy-evidence runs/<calibration>`; source hash, playback
settings, alignment checks and qualifying measured improvement must match.
It selects the recorded shortest qualifying handle and still analyzes every boundary
of the full production output. Evidence for another source fails before network writes.
This never claims that hidden DSP pre-roll
has been observed. `crossfade` fails before network writes because the available curve
model has not proved equal-power overlap. It does not substitute independent fades.

Every run has `runs/<id>/config.json`, source format/hashes, upload checkpoints,
`jobs.json`, `run.log`, and per-mode saved/readback states (privacy sanitized),
render responses, decoded final.wav, downloaded.audio and diagnostics. ABC summary
retains all completed A/B/C modes and failed-mode bindings, including when C fails.
A failed render read does not
prevent the independent continuous experiment. Acknowledged render IDs retry
temporary 404 visibility three times using GET only, then obtain official download
confirmation of the asset status.
If the official download endpoint additionally confirms `invalid_asset`, the tool
retries render once against the same saved project/version, retaining the missing
clip ID. It does not retry an uncertain write, a processing asset or a permission
denial; a second missing result remains a failed experiment.
Full double precision timeline reports include
sample-equivalent gaps; ±500/50/10 ms windows include peak/RMS/DC/derivative/zero
crossing metrics and normal-window baselines. JSON/CSV are always produced;
`--diagnose` additionally creates one-second boundary WAVs. Quality warnings identify
candidate seams, duration errors, clipping, relative dips and unexpected source-relative
silent gaps. Quiet source outros are retained as silence candidates without calling
them newly introduced gaps. Successful default runs remove source/slice intermediates;
failures and `--keep-workdir` / `--diagnose` retain them.

Resume checks source and slice hashes plus sample mappings, reuses initialized clips,
project/version/render IDs and valid downloads. A definite save rejection can retry
against the same project. An interrupted write with an unknown remote outcome stops
for binding reconciliation in jobs.json instead of duplicating a project/clip/render.
Transient S3 byte transfers retry twice against the same signed object. That replay
never applies to slot creation, initialization or Studio writes.
Do not concurrently resume a run; remove a stale lock only after checking its PID.
`--dry-run`, including on a production resume, performs zero network reads/writes.
Use SUNO_CONTROLLER_BASE / SUNO_CONTROLLER_KEY to reuse an existing controller.

Historical one-off pipeline scripts are archived under ignored
`captures/seam-task-baseline/`; evidence is preserved. New experiments, uploads,
rendering and analysis should use this entry. Offline tests never call real Suno.

`--gain-test` is an explicit, independent experiment (also usable on resume).
It first renders/reuses A at gain=1, resamples the local PCM reference to the
delivery sample rate, and measures fifteen aligned interior windows per slice.
Compensation proceeds only if at least three active windows correlate ≥.9 and
their RMS ratios agree within 5%. Separate zero/-8 modes set arrangement amplitude
to the inverse median ratio, with zero fades; original A/B/C and production retain
gain=1. Results/failures are checkpointed in `diagnostics/gain-experiment.json`.
No default gain correction or strategy promotion follows this experiment.

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
node scripts/studio-pipeline.mjs "C:\Users\ROG\Downloads\music.mp3" --strategy-evidence runs/2026-10-06T12-46-45-307Z-d5e68650 --output runs/music-final.wav
```

OBSERVED_IN_GOOD_PROJECT: live historical good state still has bps=1.95 and warp
slope 3.0954320513379887, matching bps × 2^(8/12). Its sources/timeline differ
from this experiment. This correlation has not been promoted to a playback algorithm.
The results support a source-edge processing artifact; the exact server encoding/
playback stage and hidden DSP pre-roll remain unproven. Automated candidate scores
and alignment checks do not establish absolute listening perfection or a universal fix.
