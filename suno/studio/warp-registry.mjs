import { hashWarpMarkers, warpBeatsFromSeconds } from './clip-pipeline.mjs';
import { NotVerifiedError } from './operations.mjs';
import { BridgeError } from '../bridge/errors.mjs';
export const WarpHashStrategy = Object.freeze({ PRESERVE_EXISTING: 'PRESERVE_EXISTING', CURRENT_STATIC_ALGORITHM: 'CURRENT_STATIC_ALGORITHM' });
export const WARP_SERIALIZATION_EVIDENCE=Object.freeze({status:'VERIFIED',verification:{kind:'save_readback',strategy:WarpHashStrategy.CURRENT_STATIC_ALGORITHM,markerSignature:'0:0,1:1.95',hash:'MD5'},otherMarkerMapsStatus:'FOUND_STATICALLY',preserveExistingServerVerified:false});
const fail = m => { throw new BridgeError('validation_error', m); };
export function markersSignature(markers) {
  warpBeatsFromSeconds(markers, 0); // Finite numbers, record and duplicate numeric keys checked.
  return Object.entries(markers).sort(([a], [b]) => Number(a) - Number(b)).map(([s, b]) => `${s}:${b}`).join(',');
}
export function resolveWarpMarkers(registry, hash) {
  if (!registry || !Object.hasOwn(registry, hash)) fail('unresolved warp markersHash');
  markersSignature(registry[hash]); return structuredClone(registry[hash]);
}
export function registerWarpMarkers(registry, markers, { strategy, preferredHash } = {}) {
  if (!Object.values(WarpHashStrategy).includes(strategy)) fail('explicit WarpHashStrategy required');
  const signature = markersSignature(markers), next = structuredClone(registry);
  if (strategy === WarpHashStrategy.PRESERVE_EXISTING) {
    const candidates = [...new Set([preferredHash, ...Object.keys(next)].filter(Boolean))];
    for (const hash of candidates) {
      let candidate; try { candidate = markersSignature(next[hash]); } catch { continue; }
      if (candidate === signature) return { registry: next, hash, status: 'OBSERVED', reused: true };
    }
    throw new NotVerifiedError('new warp map under PRESERVE_EXISTING; select CURRENT_STATIC_ALGORITHM explicitly');
  }
  const hash = hashWarpMarkers(markers);
  if (Object.hasOwn(next, hash) && markersSignature(next[hash]) !== signature) fail('warp hash collision');
  const reused = Object.hasOwn(next, hash); next[hash] = structuredClone(markers);
  return { registry: next, hash, status: 'FOUND_STATICALLY', reused };
}
/** Shared marker storage primitive, not a render transform or an implicit state adapter. */
export function serializeWarpState(memory, { strategy, originalWire } = {}) {
  if (Object.hasOwn(memory, 'markersRegistry')) fail('expected decoded editor state without registry');
  const state = structuredClone(memory), existing = originalWire?.markersRegistry ?? {};
  let registry = structuredClone(existing);
  const originalHashes = new Map();
  for (const t of originalWire?.tracks ?? []) for (const c of [...t.clips, ...(t.takeLanes ?? []).flatMap(l => l.clips)]) originalHashes.set(c.id, c.warp?.markersHash);
  const provenance = [];
  for (const [ti, t] of state.tracks.entries()) {
    for (const [container, clips] of [['clips', t.clips], ...(t.takeLanes ?? []).map((l, i) => [`takeLanes/${i}/clips`, l.clips])]) {
      for (const [ci, c] of clips.entries()) {
        if (!c.warp) continue;
        if (Object.hasOwn(c.warp, 'markersHash') || !c.warp.markers) fail('editor warp requires inline markers');
        const { markers, ...rest } = c.warp;
        const registered = registerWarpMarkers(registry, markers, { strategy, preferredHash: originalHashes.get(c.id) });
        registry = registered.registry; c.warp = { ...rest, markersHash: registered.hash };
        provenance.push({ path: `/state/tracks/${ti}/${container}/${ci}/warp/markersHash`, status: registered.status, strategy, reused: registered.reused, serverVerified: false });
      }
    }
  }
  return { state: { ...state, markersRegistry: registry }, provenance };
}
