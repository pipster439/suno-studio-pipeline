import { applyStudioProfile } from './postprocessing-profile.mjs';
import { buildProjectDraft, buildStudioClipDraft } from '../studio/dry-run-sdk.mjs';
import { serializeAudioProjectState, deserializeAudioProjectState, warpBeatsFromSeconds } from '../studio/clip-pipeline.mjs';
import { validateProjectForSave } from '../studio/validation.mjs';
import { studioStateDiff } from '../studio/state-diff.mjs';
import { sha256 } from './pcm.mjs';
export function chooseHandleStrategy(baseline, tests, alignmentValidated) {
  if(!alignmentValidated)return null;
  const eligible=tests.filter(t=>Number.isFinite(t.averageBoundaryScore)&&Number.isFinite(t.maxBoundaryScore)&&t.averageBoundaryScore<baseline.averageBoundaryScore*.7&&t.maxBoundaryScore<baseline.maxBoundaryScore*.7&&t.detectedAnomalyCount<=baseline.detectedAnomalyCount&&Math.abs(t.duration-baseline.duration)<.05);
  return eligible.sort((a,b)=>a.detectedAnomalyCount-b.detectedAnomalyCount||a.prerollMs-b.prerollMs)[0]??null;
}
export function buildTimeline(template, slices, { transpose, title, bps = template.state.timing.bps, strategy = 'exact', profile }) {
  if (strategy === 'crossfade') throw Error('Crossfade is not verified: Studio curve=1 does not prove equal-power; no independent fades will be substituted');
  const timing = { ...template.state.timing, type: 'manual', bps, bpsAutomation: [], firstBeatSeconds: 0 };
  const draft = buildProjectDraft(template, timing, { title });
  for (const slice of [...slices].sort((a, b) => a.index - b.index)) {
    const c = buildStudioClipDraft({ clip_id: slice.clipId, duration_seconds: slice.sourceDurationSeconds, title: `Slice ${slice.index}` }, timing,
      { explicit: { transposition: transpose }, warp: { identity_project_bps: true } }).clip;
    // Absolute source sample positions, not a floating point accumulated cursor.
    c.startBeats = slice.startSec * bps; c.endBeats = slice.endSec * bps;
    c.readStartBeats = warpBeatsFromSeconds(c.warp.markers, slice.readOffsetSeconds);
    c.fadeInBeats = 0; c.fadeOutBeats = 0; c.amplitude = slice.amplitude ?? 1;
    if(!Number.isFinite(c.amplitude)||c.amplitude<=0||c.amplitude>10)throw Error('Invalid explicit slice amplitude');
    draft.state.tracks[0].clips.push(profile ? applyStudioProfile(c, {...profile,pitchSemitones:transpose,volume:slice.amplitude??profile.volume}, {preservePlacement:false}) : c);
  }
  const wire = serializeAudioProjectState(draft.state); validateProjectForSave(wire);
  return wire;
}
export function timelineReport(wire, slices, sampleRate) {
  const memory = deserializeAudioProjectState(wire), bps = memory.timing.bps, source = new Map(slices.map(s => [s.clipId, s]));
  const arrangements = memory.tracks.flatMap((track, trackIndex) => track.clips.map(c => ({ trackIndex, c }))).sort((a, b) => a.c.startBeats - b.c.startBeats);
  const rows = arrangements.map(({ c, trackIndex }, index) => ({ index, trackIndex, sourceClipId: c.asset?.id, assetType: c.asset?.type, arrangementId: c.id,
    startBeats: c.startBeats, endBeats: c.endBeats, readStartBeats: c.readStartBeats, durationBeats: c.endBeats - c.startBeats,
    sourceDurationSeconds: source.get(c.asset?.id)?.sourceDurationSeconds ?? null, transposition: c.transposition, amplitude: c.amplitude,
    fadeIn: c.fadeInBeats, fadeOut: c.fadeOutBeats, warp: c.warp, warpHash: wire.tracks[trackIndex].clips.find(w => w.id === c.id)?.warp?.markersHash }));
  const gaps = rows.slice(1).map((c, i) => {
    const beats = c.startBeats - rows[i].endBeats, seconds = beats / bps;
    return { previousIndex: i, nextIndex: i + 1, previousEndBeats: rows[i].endBeats, nextStartBeats: c.startBeats,
      gapBeats: beats, gapSeconds: seconds, estimatedSourceSamples: seconds * sampleRate, precision: 'IEEE754 double, no display rounding', status: beats === 0 ? 'EXACT_CONTINUITY' : 'GAP_OR_OVERLAP' };
  });
  return { timing: memory.timing, sampleRate, arrangements: rows, markersRegistry: wire.markersRegistry, gaps,
    expectedTimelineSeconds: Math.max(0, ...rows.map(c => c.endBeats)) / bps,
    exactContinuous: gaps.every(g => g.gapBeats === 0), boundariesSeconds: rows.slice(1).map(c => c.startBeats / bps) };
}
function canonical(wire) {
  const state = deserializeAudioProjectState(wire), ids = new Map();
  const identity = v => { if (!ids.has(v)) ids.set(v, `identity-${ids.size}`); return ids.get(v); };
  // JSON object key order changes on server readback. Register identities by
  // topology first so asset-before-id and id-before-asset mean the same thing.
  for (const t of state.tracks) { identity(t.id); for (const c of t.clips) { identity(c.id); if (c.asset?.id) identity(c.asset.id); } }
  // Preserve playback fields including unknown future audio fields. Remove only known UI.
  for (const k of ['selection', 'layout', 'contextualWindowConfig', 'viewState']) delete state[k];
  const clean = (v, key = '') => {
    if (['name', 'title', 'color', 'createdAt', 'updatedAt'].includes(key)) return undefined;
    if (typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]+){4}$/i.test(v)) return identity(v);
    if (Array.isArray(v)) return v.map(x => clean(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, clean(x, k)]).filter(([, x]) => x !== undefined));
    return v;
  };
  return clean(state);
}
export function semanticDiff(good, bad) {
  const normalizedGood = canonical(good), normalizedBad = canonical(bad), diff = studioStateDiff(normalizedGood, normalizedBad);
  const state = deserializeAudioProjectState(good), bps = state.timing.bps, predicted = bps * 2 ** (8 / 12);
  const slopes = state.tracks.flatMap(t => t.clips.map(c => {
    const markers = Object.entries(c.warp?.markers ?? {}).map(([s, b]) => [Number(s), b]).sort((a, b) => a[0] - b[0]);
    const segments = markers.slice(1).map((m, i) => (m[1] - markers[i][1]) / (m[0] - markers[i][0]));
    return { transposition: c.transposition, segments, matchesPredicted: segments.length > 0 && segments.every(s => Math.abs(s - predicted) < 1e-6) };
  }));
  return { ...diff, normalizedGood, normalizedBad, historicalWarpCorrelation: { status: 'CORRELATION_ONLY', bps, predictedSlope: predicted, slopes,
    allMatch: slopes.length > 0 && slopes.every(s => s.matchesPredicted), automaticAlgorithmEnabled: false }, canonicalHash: { good: sha256(JSON.stringify(normalizedGood)), bad: sha256(JSON.stringify(normalizedBad)) } };
}
