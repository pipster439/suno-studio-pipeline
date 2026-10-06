// Mirrors official makeSpeedUpdateFn (448249), scaleMarkers (981734).
// Speed is an action on an existing map, not a serialized scalar or pitch formula.
export const WARP_STRATEGY_VERSION = 'official-linear-speed-action-v1';
export function applySpeedAction(clip, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) throw Error('Invalid speed ratio');
  if (ratio === 1) return clip;
  if (!clip.warp?.enabled || Object.keys(clip.warp.markers ?? {}).length < 2) throw Error('Speed inverse requires populated stretch warp');
  return { ...clip, endBeats: clip.startBeats + (clip.endBeats - clip.startBeats) / ratio,
    readStartBeats: clip.readStartBeats / ratio,
    warp: { ...clip.warp, markers: Object.fromEntries(Object.entries(clip.warp.markers).map(([s,b]) => [s,b / ratio])) },
    loop: { ...clip.loop, startBeats: clip.loop.startBeats / ratio, endBeats: clip.loop.endBeats / ratio } };
}
