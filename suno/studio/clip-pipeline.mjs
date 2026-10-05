// Pure local construction only. Static evidence is not server write verification.
import { randomUUID, createHash } from 'node:crypto';
import { BridgeError } from '../bridge/errors.mjs';
import { NotVerifiedError } from './operations.mjs';
import { updateEditorState } from './state-boundaries.mjs';
const objects = new WeakMap();
const fail = message => { throw new BridgeError('validation_error', message); };
const record = x => x && typeof x === 'object' && !Array.isArray(x);
const number = (x, name) => { if (!Number.isFinite(x)) fail(name + ' must be finite'); return x; };
const positive = (x, name) => { number(x, name); if (x <= 0) fail(name + ' must be positive'); return x; };
const identifier = x => { if (typeof x !== 'string' || !x || x.includes('<redacted>')) fail('unmasked ID required'); return x; };
function wrap(kind, value) { const h = Object.freeze({ kind }); objects.set(h, structuredClone(value)); return h; }
function read(h, kinds) { if (!objects.has(h) || !kinds.includes(h.kind)) fail('expected ' + kinds.join(' or ')); return structuredClone(objects.get(h)); }
const clip = h => read(h, ['clip-draft', 'postprocessed-clip']);
export const sourceClipMetadata = source => {
  if (!record(source) || !record(source.metadata)) fail('source clip metadata required');
  identifier(source.id); return wrap('source-clip-metadata', source);
};
export const inspectSourceClip = h => read(h, ['source-clip-metadata']);
export const inspectClipDraft = h => read(h, ['clip-draft']);
export const inspectPostprocessedClip = h => read(h, ['postprocessed-clip']);

/** Port of the ordinary-content branch of official module 738128; special tasks remain gated. */
export function buildAudioClipDraft(source, { fallbackBPS, id = randomUUID(), name = 'New Clip', color = null, extraFields = {} } = {}) {
  const s = inspectSourceClip(source); positive(fallbackBPS, 'fallbackBPS'); identifier(id);
  if (id === s.id) fail('arrangement ID must be separate from source ID');
  if (['infill', 'cover_infill', 'artist_infill', 'infill_intro', 'infill_outro', 'stem_condition_infill', 'midi_condition_infill', 'fixed_infill', 'extend', 'upload_extend', 'artist_extend', 'artist_cover_extend'].includes(s.metadata.task))
    throw new NotVerifiedError('special source content-window construction');
  if (!record(extraFields)) fail('extraFields must be a record');
  const duration = s.metadata.duration;
  if (duration != null) positive(duration, 'source duration');
  const bps = s.metadata.avg_bpm ? positive(s.metadata.avg_bpm, 'source BPM') / 60 : fallbackBPS;
  const value = { type: 'audio', id, asset: { type: 'clip', id: s.id }, streaming: s.status !== 'complete',
    mute: false, reversed: false, name, color, startBeats: 0, endBeats: duration ? positive(duration * bps, 'clip length') : 960,
    readStartBeats: 0, fadeInBeats: 0, fadeOutBeats: 0, fadeInCurve: 1, fadeOutCurve: 1,
    transposition: 0, formantCorrection: 0, amplitude: 1,
    loop: { enabled: false, startBeats: 0, endBeats: 999 },
    warp: { enabled: true, markers: { 0: 0 }, awaitingAnalysis: true } };
  for (const key of Object.keys(extraFields)) if (Object.hasOwn(value, key)) fail('extraFields cannot replace constructor field ' + key);
  // Some observed wire clips carry a legacy alias; the current constructor does not add it.
  if (Object.hasOwn(extraFields, 'clipId') && extraFields.clipId !== s.id) fail('clipId must match source asset ID');
  return wrap('clip-draft', { ...structuredClone(extraFields), ...value });
}

/** Normal-content branch of module 934710, supplied with already resolved source-second markers. */
export function buildAnalyzedAudioClipDraft(source, { markers, downbeatPresenceConfidence = null, ...options } = {}) {
  const metadata = inspectSourceClip(source).metadata;
  if (metadata.duration == null) throw new NotVerifiedError('analyzed clip without confirmed source duration');
  const c = inspectClipDraft(buildAudioClipDraft(source, options));
  markerPairs(markers);
  if (downbeatPresenceConfidence != null) number(downbeatPresenceConfidence, 'downbeat presence confidence');
  const readStart = warpBeatsFromSeconds(markers, 0), readEnd = warpBeatsFromSeconds(markers, metadata.duration);
  c.endBeats = positive(readEnd - readStart, 'analyzed clip length'); c.readStartBeats = readStart;
  c.streaming = false;
  c.loop = { enabled: false, startBeats: readStart, endBeats: readEnd };
  c.warp = { enabled: downbeatPresenceConfidence == null || downbeatPresenceConfidence >= 0.9,
    markers: structuredClone(markers), awaitingAnalysis: false };
  return wrap('clip-draft', c);
}

function constantTiming(t) {
  if (!record(t) || t.type !== 'manual' || !Array.isArray(t.bpsAutomation)) fail('manual timing with explicit bpsAutomation required');
  if (t.bpsAutomation.length) throw new NotVerifiedError('tempo automation conversion');
  positive(t.bps, 'bps'); number(t.firstBeatSeconds, 'firstBeatSeconds'); return t;
}
export function secondsToProjectBeats(seconds, timing) { const t = constantTiming(timing); return (number(seconds, 'seconds') - t.firstBeatSeconds) * t.bps; }
export function projectBeatsToSeconds(beats, timing) { const t = constantTiming(timing); return number(beats, 'beats') / t.bps + t.firstBeatSeconds; }
/** Duration is a difference, not an absolute time; firstBeatSeconds does not affect it. */
export function durationSecondsToBeats(seconds, timing) { return positive(seconds, 'duration seconds') * constantTiming(timing).bps; }

function markerPairs(markers) {
  if (!record(markers)) fail('inline warp markers required');
  const pairs = Object.entries(markers).map(([s, b]) => [number(Number(s), 'marker seconds'), number(b, 'marker beats')]).sort((a, b) => a[0] - b[0]);
  if (pairs.some((p, i) => i && p[0] === pairs[i - 1][0])) fail('duplicate numeric marker seconds');
  return pairs;
}
/** Official 981734 interpolation/extrapolation, including the 2 BPS sparse-marker fallback. */
export function warpBeatsFromSeconds(markers, seconds) {
  const entries = markerPairs(markers); number(seconds, 'source seconds');
  let prev = null, left = null, right = null, next = null;
  for (const entry of entries) { if (entry[0] <= seconds) { prev = left; left = entry; } else if (right) { next = entry; break; } else right = entry; }
  if (left && right) return left[1] + (seconds - left[0]) * (right[1] - left[1]) / (right[0] - left[0]);
  if (left) return left[1] + (seconds - left[0]) * (prev ? (left[1] - prev[1]) / (left[0] - prev[0]) : 2);
  if (!right) return 2 * seconds;
  return right[1] + (seconds - right[0]) * (next ? (next[1] - right[1]) / (next[0] - right[0]) : 2);
}
export function placeClip(h, startBeats, { lengthBeats } = {}) {
  const c = clip(h); number(startBeats, 'timeline start');
  const length = positive(lengthBeats ?? c.endBeats - c.startBeats, 'timeline length');
  return wrap('postprocessed-clip', { ...c, startBeats, endBeats: number(startBeats + length, 'timeline end') });
}
export function placeSequentialClips(handles, startBeats = 0) {
  let cursor = number(startBeats, 'timeline start');
  return handles.map(h => { const placed = placeClip(h, cursor); cursor = inspectPostprocessedClip(placed).endBeats; return placed; });
}
/** Explicit fields only; no inferred inverse pitch, loudness repair, analysis or render transform. */
export function postprocessClip(h, changes = {}) {
  if (!record(changes)) fail('post-processing changes must be a record');
  const c = clip(h);
  for (const [key, value] of Object.entries(changes)) {
    switch (key) {
      case 'transposition': c.transposition = Math.max(-24, Math.min(24, number(value, key))); break;
      case 'amplitude': number(value, key); if (value < 0) fail('amplitude must be nonnegative'); c.amplitude = value; break;
      case 'fadeInBeats': case 'fadeOutBeats': c[key] = Math.max(0, number(value, key)); break;
      case 'readStartBeats': c[key] = number(value, key); break;
      case 'markers': markerPairs(value); c.warp = { ...c.warp, markers: structuredClone(value), awaitingAnalysis: false }; delete c.warp.markersHash; break;
      default: throw new NotVerifiedError('post-processing ' + key);
    }
  }
  return wrap('postprocessed-clip', c);
}
export function restoreUploadedPitch() { throw new NotVerifiedError('upload pitch restoration correlation'); }

/** Snapshot append for the non-overlapping single-track MVP, not the destructive replace/split reducer. */
export function appendClipToEditor(editor, trackId, h) {
  const c = read(h, ['postprocessed-clip']);
  return updateEditorState(editor, state => {
    const all = state.tracks.flatMap(t => [...t.clips, ...(t.takeLanes ?? []).flatMap(l => l.clips)]);
    if (all.some(x => x.id === c.id)) fail('duplicate arrangement ID');
    const t = state.tracks.find(t => t.id === trackId);
    if (!t || t.type !== 'audio' || !Array.isArray(t.clips)) fail('existing audio track required');
    if (t.clips.some(x => c.startBeats < x.endBeats && c.endBeats > x.startBeats)) fail('overlap requires the official split/replace reducer, outside MVP');
    t.clips.push(c); return state;
  });
}

function eachAudioClip(state, visit) {
  for (const t of state.tracks) {
    if (!Array.isArray(t.clips) || !Array.isArray(t.takeLanes)) fail('complete track clips/takeLanes required');
    for (const c of [...t.clips, ...t.takeLanes.flatMap(l => { if (!Array.isArray(l.clips)) fail('complete take lane required'); return l.clips; })])
      if (!record(c)) fail('complete clip record required');
      else if (c.type === 'audio') {
        identifier(c.id);
        if (!record(c.asset)) fail('audio clip asset required');
        identifier(c.asset.id);
        for (const key of ['startBeats','endBeats','readStartBeats','transposition','amplitude','fadeInBeats','fadeOutBeats','fadeInCurve','fadeOutCurve']) number(c[key], 'clip ' + key);
        if (c.endBeats <= c.startBeats || !record(c.warp)) fail('complete audio clip placement/warp required');
        visit(c);
      }
  }
}
function completeState(state) {
  if (!record(state) || !Array.isArray(state.tracks) || !record(state.timing)) fail('complete state required');
  for (const key of ['amplitude','sections','metronome','timeSignatureChanges','selection','loop','songFadeInBeats','songFadeOutBeats','layout','editorPointerModes','masterSignalChain','masterRoutingMode','routing'])
    if (!Object.hasOwn(state, key) || state[key] == null) fail('incomplete state: missing ' + key);
  function masked(v) { return typeof v === 'string' ? v.includes('<redacted>') : v && typeof v === 'object' && (Object.hasOwn(v, 'omitted') || Object.values(v).some(masked)); }
  if (masked(state)) fail('redacted/omitted state cannot be serialized');
}
export function assertWarpReferencesResolve(wire) {
  completeState(wire);
  eachAudioClip(wire, c => { if (c.warp?.markersHash && !record(wire.markersRegistry?.[c.warp.markersHash])) fail('unresolved warp markersHash'); });
  return true;
}
/** Explicit project adapter, statically reconstructed; never pass raw wire directly to a save builder. */
export function deserializeAudioProjectState(wire) {
  assertWarpReferencesResolve(wire);
  const state = structuredClone(wire), registry = state.markersRegistry;
  eachAudioClip(state, c => {
    if (!c.warp) return;
    const { markersHash, markers, ...rest } = c.warp;
    c.warp = { ...rest, markers: structuredClone(markersHash ? registry[markersHash] : markers ?? {}) };
  });
  delete state.markersRegistry; return state;
}
/** Official 879379 uses numeric seconds sort + key:value string + MD5, not fixture's legacy hash spelling. */
export function hashWarpMarkers(markers) {
  markerPairs(markers);
  const signature = Object.entries(markers).sort(([a], [b]) => Number(a) - Number(b)).map(([s, b]) => `${s}:${b}`).join(',');
  return 'warp_' + createHash('md5').update(signature, 'utf8').digest('hex');
}
export function serializeAudioProjectState(memory) {
  completeState(memory);
  if (Object.hasOwn(memory, 'markersRegistry')) fail('raw wire/serialized registry must be explicitly deserialized first');
  const state = structuredClone(memory), registry = {};
  eachAudioClip(state, c => {
    if (!c.warp) return;
    if (Object.hasOwn(c.warp, 'markersHash') || !record(c.warp.markers)) fail('editor warp requires inline markers, not wire hashes');
    const { markers, ...rest } = c.warp, hash = hashWarpMarkers(markers);
    registry[hash] = structuredClone(markers); c.warp = { ...rest, markersHash: hash };
  });
  return { ...state, markersRegistry: registry };
}
