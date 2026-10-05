import { BridgeError } from '../bridge/errors.mjs';
import { secondsToProjectBeats } from './clip-pipeline.mjs';
import { resolveWarpMarkers } from './warp-registry.mjs';
const fail = m => { throw new BridgeError('validation_error', m); };
const record = v => v && typeof v === 'object' && !Array.isArray(v);
export function validateJsonData(value, path = '', seen = new Set()) {
  if (typeof value === 'number' && !Number.isFinite(value)) fail('nonfinite number at ' + path);
  if (typeof value === 'string' && (value.includes('<redacted>') || /\bBearer\s+\S+|\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/i.test(value))) fail('redacted/credential data at ' + path);
  if(typeof value==='string' && /https?:\/\/\S+[?&](?:[^\s]*&)?(?:sig|signature|token|x-amz-signature|x-goog-signature)=/i.test(value))fail('signed credential URL at '+path);
  if (value && typeof value === 'object') {
    if (seen.has(value)) fail('cyclic data'); seen.add(value);
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('JSON record required');
    if(Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>d.get||d.set))fail('plain JSON data only; no accessors or symbol fields');
    if (Object.hasOwn(value, 'omitted')) fail('omitted data at ' + path);
    for (const [k, v] of Object.entries(value)) {
      if (/^(authorization|cookie|set-cookie|jwt|session[_-]?(token|secret)|captcha[_-]?token|device[_-]?(id|token))$/i.test(k)) fail('credential field at ' + path);
      if (['undefined','function','symbol','bigint'].includes(typeof v)) fail('non-JSON value at ' + path + '/' + k);
      validateJsonData(v, path + '/' + k, seen);
    }
    seen.delete(value);
  } else if (value !== null && !['string','number','boolean'].includes(typeof value)) fail('non-JSON root value');
  return true;
}
export function validId(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) fail('valid resource identifier required'); return id; }
export function changedPaths(a, b, path = '') {
  if (Object.is(a,b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [path];
  const out = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const p = path + '/' + key.replaceAll('~','~0').replaceAll('/','~1');
    if (!Object.hasOwn(a,key) || !Object.hasOwn(b,key)) out.push(p); else out.push(...changedPaths(a[key],b[key],p));
  }
  return out;
}
export function validateProjectForSave(state, { sequential = true, originalState, allowedChanges = [] } = {}) {
  validateJsonData(state);
  for (const key of ['tracks','timing','amplitude','sections','metronome','timeSignatureChanges','selection','loop','songFadeInBeats','songFadeOutBeats','layout','editorPointerModes','masterSignalChain','masterRoutingMode','routing','markersRegistry'])
    if (!Object.hasOwn(state,key)) fail('missing structural field ' + key);
  if (!record(state.timing) || !Array.isArray(state.tracks) || !record(state.markersRegistry)) fail('invalid state structure');
  for (const key of ['sections','metronome','selection','loop','layout','editorPointerModes','routing']) if (!record(state[key])) fail('invalid structure ' + key);
  if (!Array.isArray(state.timeSignatureChanges) || !Array.isArray(state.masterSignalChain)) fail('structural arrays required');
  secondsToProjectBeats(0,state.timing); // Reject unsupported tempo models, never fall back.
  const ids = new Set(); let clipCount = 0;
  for (const t of state.tracks) {
    validId(t.id); if (ids.has(t.id)) fail('duplicate track/arrangement ID'); ids.add(t.id);
    if (t.type !== 'audio' || !Array.isArray(t.clips) || !Array.isArray(t.takeLanes)) fail('audio track structure required');
    const containers = [t.clips, ...t.takeLanes.map(l => { validId(l.id); if(ids.has(l.id))fail('duplicate container ID'); ids.add(l.id); if(!Array.isArray(l.clips))fail('take lane clips required'); return l.clips; })];
    for (const clips of containers) {
      let lastEnd = -Infinity;
      for (const c of clips) {
        validId(c.id); if (ids.has(c.id)) fail('duplicate arrangement ID'); ids.add(c.id);
        if (c.type !== 'audio' || !record(c.asset) || c.asset.type !== 'clip') fail('source clip asset required');
        validId(c.asset.id); if (c.id === c.asset.id || Object.hasOwn(c,'clipId') && c.clipId !== c.asset.id) fail('source/arrangement identity mismatch');
        for (const key of ['startBeats','endBeats','readStartBeats','transposition','amplitude','fadeInBeats','fadeOutBeats','fadeInCurve','fadeOutCurve']) if(!Number.isFinite(c[key]))fail('missing/invalid clip field ' + key);
        if (c.startBeats >= c.endBeats) fail('clip range must be positive');
        if (c.transposition < -24 || c.transposition > 24 || c.amplitude < 0 || c.fadeInBeats < 0 || c.fadeOutBeats < 0 || c.fadeInCurve < 0 || c.fadeOutCurve < 0) fail('invalid post-processing range');
        if (sequential && c.startBeats < lastEnd - 1e-9) fail('sequential overlap or incorrect ordering'); lastEnd = c.endBeats;
        if (!record(c.warp) || typeof c.warp.markersHash !== 'string' || Object.hasOwn(c.warp,'markers')) fail('serialized warp reference required');
        resolveWarpMarkers(state.markersRegistry,c.warp.markersHash); clipCount++;
      }
    }
  }
  if (originalState) for (const path of changedPaths(originalState,state))
    if(!allowedChanges.some(p=>path===p || path.startsWith(p+'/'))) fail('unexpected mutation/unknown-field loss at ' + path);
  return { valid: true, scope: 'LOCAL_ONLY', sequential, clipCount, arrangementIdsUnique: true, warpReferencesResolve: true,
    unknownFieldsPreserved: originalState ? true : 'template-copy', serverWriteVerified: false };
}
