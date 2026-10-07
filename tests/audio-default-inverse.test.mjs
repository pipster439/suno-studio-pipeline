import {libraryExportFixture} from './helpers/library-export-fixture.mjs';
const runPipeline=(config,deps={})=>productionPipeline(config,libraryExportFixture(deps));
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../suno/audio/config.mjs';
import { runPipeline as productionPipeline } from '../scripts/studio-pipeline.mjs';
import { syntheticReference } from '../suno/audio/transform-verification.mjs';
import { wav } from '../suno/audio/pcm.mjs';
import { inspectSaveSerializedState } from '../suno/studio/state-boundaries.mjs';
import { deserializeAudioProjectState } from '../suno/studio/clip-pipeline.mjs';
import { analyzeBoundaries, writeAnalysis } from '../suno/audio/boundaries.mjs';
import { QUALITY_THRESHOLDS } from '../suno/audio/quality.mjs';
import { estimateSpectralPitchShift } from '../suno/audio/spectral-pitch.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'default-inverse-'));
  const input = join(dir, 'source.wav'), run = join(dir, 'run');
  await mkdir(run);
  await writeFile(input, wav(syntheticReference(24)));
  await writeFile(join(run, 'config.json'), JSON.stringify(parseConfig([input])));
  return { dir, input, run };
}

test('default dry run compresses source once BEFORE auto count, then restores timeline duration', async () => {
  const f = await fixture();
  try {
    const forbidden = { call: async () => { throw Error('dry run network dispatch'); } };
    // 24 seconds requires two clips before inverse under this limit, but one afterward.
    const result = await runPipeline(parseConfig(['--resume', f.run, '--dry-run']), {
      bridge: forbidden, uploadConstraints: { min: 6, max: 18 }
    });
    assert.equal(result.networkWrites, 0);
    assert.equal(result.preprocessedDuration, 12);
    assert.equal(result.clipCount, 1);
    assert.equal(result.internalBoundaryCount, 0);
    assert.equal(result.strategy, 'exact');
    const profile = await json(join(f.run, 'postprocessing-profile.json'));
    assert.equal(profile.studio.pitchSemitones, -8);
    assert.equal(profile.studio.speedRatio, .5);
    assert.equal(profile.studio.stretch, true);
    assert.equal(profile.localInverse.pitchShiftSemitones, 8);
    assert.equal(profile.localInverse.tempoMultiplier, 2);
    assert.equal(profile.localInverse.tempoEngine, 'rubberband');
    const source = await json(join(f.run, 'source-info.json'));
    assert.equal(source.conversion.pitchUp, 8);
    assert.equal(source.conversion.tempoMultiplier, 2);
    const timeline = await json(join(f.run, 'diagnostics-local-timeline.json'));
    assert.equal(timeline.expectedTimelineSeconds, 24);
    assert.equal(timeline.exactContinuous, true);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('single-clip save/readback/render keeps half speed and -8; no handles, no final download', async () => {
  const f = await fixture(); let state, request, uploads = 0, renders = 0;
  try {
    const client = {
      create_project: async () => ({ id: 'project' }),
      save_project: async q => { state = inspectSaveSerializedState(q.state); return { version_id: 'version' }; },
      get_project_version: async () => ({ state }),
      render_project: async q => { request = q; renders++; return { id: 'render' }; }
    };
    const bridge = { call: async q => {
      assert.equal(q.method, 'GET');
      if (q.path === '/api/clip/render') return { result: { id: 'render', status: 'complete', metadata: {
        studio_project_id: 'project', studio_project_version_id: 'version',
        studio_project_start_beats: 0, studio_project_end_beats: request.end_beats, duration: 24
      } } };
      if (q.path.startsWith('/api/download/clip/')) return { result: { status: 'ready', download_url: 'https://downloads.s3.amazonaws.com/test.m4a' } };
      throw Error('Unexpected API request');
    } };
    const deps = { client, bridge, uploadConstraints: { min: 6, max: 18 },
      uploadSlice: async (_bridge, slice, _path, _record, checkpoint) => {
        assert.equal(slice.sourceDurationSeconds, 12);
        assert.equal(slice.readOffsetSeconds, 0);
        assert.equal(slice.sourceStart, slice.start);
        assert.equal(slice.sourceEnd, slice.end);
        uploads++; const result = { ...slice, clipId: 'source', status: 'complete', stages: {} };
        await checkpoint(result); return result;
      },
      qa: async q => {
        assert.deepEqual(q.times, []);
        assert.equal(q.sourcePCM.frames / q.sourcePCM.sampleRate, 12);
        assert.equal(q.sourceTimeRatio, .5);
        assert.equal(q.expectedDuration, 24);
        const analysis = analyzeBoundaries(syntheticReference(24), []);
        await writeAnalysis(join(q.directory, 'diagnostics'), analysis, syntheticReference(24), false);
        return { analysis, gate: { status: 'PASS', warnings: [] }, qualitySummary: {
          quality: 'PASS', remoteProbeMode: 'RANGE', boundaryCount: 0, anomalyCount: 0,
          averageScore: 0, maxScore: 0, qualityThresholdVersion: QUALITY_THRESHOLDS.version,
          detectorVersion: QUALITY_THRESHOLDS.detectorVersion
        } };
      }
    };
    const result = await runPipeline(parseConfig(['--resume', f.run]), deps);
    assert.equal(result.clipCount, 1);
    assert.equal(result.internalBoundaryCount, 0);
    assert.equal(result.preRollMs, 0); assert.equal(result.postRollMs, 0);
    assert.equal(result.calibration.candidatesTested, 0);
    assert.equal(result.downloaded, false); assert.equal(result.output, null);
    const clip = deserializeAudioProjectState(state).tracks[0].clips[0];
    assert.equal(clip.transposition, -8); assert.equal(clip.warp.enabled, true);
    assert.equal(clip.warp.markers[1], 3.9); // base 1.95 beats/s / relative speed .5
    assert.equal(clip.endBeats - clip.startBeats, 24 * 1.95);
    assert.equal(clip.fadeInBeats, 0); assert.equal(clip.fadeOutBeats, 0);
    assert.equal(clip.amplitude, 1); assert.equal(clip.readStartBeats, 0);
    assert.equal(result.quality, 'PASS');
    // A completed run retains its profile on resume and reuses the saved render.
    await runPipeline(parseConfig(['--resume', f.run]), deps);
    assert.equal(uploads, 1); assert.equal(renders, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

function harmonicReference(cents = 0) {
  const pcm = syntheticReference(8), ratio = 2 ** (cents / 1200);
  for (let i = 0; i < pcm.frames; i++) {
    const t = i / pcm.sampleRate;
    const x = [173, 277, 419, 659, 997].reduce((s, hz, j) => s + .05 / (j + 1) * Math.sin(2 * Math.PI * hz * ratio * t), 0);
    pcm.data.writeFloatLE(x, i * 8); pcm.data.writeFloatLE(x, i * 8 + 4);
  }
  return pcm;
}
test('relative music spectral estimator distinguishes restored pitch and +/-8 semitones', () => {
  const reference = harmonicReference();
  for (const cents of [0, -800, 800]) {
    const result = estimateSpectralPitchShift(reference, harmonicReference(cents));
    assert.equal(result.status, 'ESTIMATED_RELATIVE_SPECTRAL_SHIFT', JSON.stringify(result));
    assert.ok(Math.abs(result.deltaCents - cents) <= 12.5, JSON.stringify(result));
  }
});
test('spectral estimator rejects silent comparison rather than inventing a restored pitch', () => {
  const pcm = syntheticReference(8); pcm.data.fill(0);
  const result = estimateSpectralPitchShift(pcm, pcm);
  assert.equal(result.status, 'NOT VERIFIED'); assert.equal(result.deltaCents, null);
});
