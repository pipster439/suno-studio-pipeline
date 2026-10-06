import { sha256 } from './pcm.mjs';
import { applySpeedAction, WARP_STRATEGY_VERSION } from './warp-derivation.mjs';
import { deserializeAudioProjectState } from '../studio/clip-pipeline.mjs';
export const PROFILE_VERSION = 'studio-postprocessing-v1';
export const UI_MAPPING = Object.freeze({
  loop: { paths:['loop.enabled'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED' },
  reverse: { paths:['reversed','warp.markers','readStartBeats','loop'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED' },
  stretch: { paths:['warp.enabled'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED' },
  quantize: { paths:['warp.markers'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED', operation:'transient marker quantization action; menu label is React state, not a persistent audio parameter' },
  pitch: { paths:['transposition'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED' },
  speed: { paths:['warp.markers','readStartBeats','endBeats','loop.startBeats','loop.endBeats'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED', operation:'relative 0.5/2 action; both buttons visible simultaneously' },
  formant: { paths:['formantCorrection'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED', range:[0,1], operation:'correction blend, not formant semitones' },
  volume: { paths:['amplitude'], status:'FOUND_STATICALLY', uiVerification:'NOT VERIFIED', operation:'linear multiplier; display uses dB conversion' }
});
export function resolveStudioProfile(config) {
  const provided = config.provided ?? [], has = k => provided.includes(k);
  if (config['studio-profile'] && config['studio-profile'] !== 'default') throw Error('Unknown Studio profile');
  if (has('studio-pitch') && has('studio-transpose') && config['studio-pitch'] !== config['studio-transpose']) throw Error('Conflicting pitch aliases');
  // Half speed is an ACTION button. The observed UI cannot establish a prior
  // speed action. Default retains the verified identity timing; explicit .5 applies it.
  const profile = { schemaVersion:1, version:PROFILE_VERSION, loop:false, reverse:false,
    stretch:(config['studio-stretch'] ?? 'on') === 'on', quantize:config['studio-quantize'] ?? '1/2',
    pitchSemitones:has('studio-pitch') ? config['studio-pitch'] : config['studio-transpose'] ?? -8,
    speedRatio:config['studio-speed'] ?? 1, formant:config['studio-formant'] ?? 0, volume:config['studio-volume'] ?? 1,
    evidence:Object.fromEntries(Object.entries(UI_MAPPING).map(([k,v])=>[k,{...v,schemaVerification:k==='quantize'?'NOT VERIFIED':'VERIFIED_SAVE_READBACK',renderVerification:['pitch','speed','volume','formant'].includes(k)?'render_ab':'NOT VERIFIED',verificationKind:['static_callback',...(k==='quantize'?[]:['save_readback'])]}])), warpStrategyVersion:WARP_STRATEGY_VERSION,
    limitations:['UI mapping NOT VERIFIED: official edit was subscription-blocked', 'Quantize label does not imply quantization was applied; no marker quantization is synthesized', 'Speed half/double controls are actions, not a current value'] };
  if (!profile.stretch && profile.speedRatio !== 1) throw Error('Speed + Stretch Off inverse NOT VERIFIED');
  if (!profile.stretch && profile.pitchSemitones !== 0) throw Error('Pitch + Stretch Off timing inverse NOT VERIFIED');
  if (!['on','off'].includes(config['studio-stretch'] ?? 'on')) throw Error('Stretch requires on/off');
  if (profile.quantize !== '1/2') throw Error('Quantize execution NOT VERIFIED; only observed label 1/2 supported');

  profile.hash = sha256(JSON.stringify({version:profile.version, loop:profile.loop, reverse:profile.reverse, stretch:profile.stretch, quantize:profile.quantize, pitch:profile.pitchSemitones, speed:profile.speedRatio, formant:profile.formant, volume:profile.volume, warp:profile.warpStrategyVersion}));
  return profile;
}
export function applyStudioProfile(clip, profile, { preservePlacement = true } = {}) {
  if (profile.reverse || profile.loop) throw Error('Only current Loop Off / Reverse Off profile is supported');
  let result = { ...clip, transposition:profile.pitchSemitones, reversed:false, formantCorrection:profile.formant,
    amplitude:profile.volume, fadeInBeats:0, fadeOutBeats:0, loop:{...clip.loop,enabled:false}, warp:{...clip.warp,enabled:profile.stretch} };
  result = applySpeedAction(result, profile.speedRatio);
  // Official action leaves a selected clip's start fixed. Production additionally
  // places ALL clips on scaled absolute logical positions to keep joins contiguous.
  if (!preservePlacement) {
    result.startBeats = clip.startBeats / profile.speedRatio;
    result.endBeats = clip.endBeats / profile.speedRatio;
  }
  return result;
}
export function compareProfileReadback(expected, actual) {
  const a = deserializeAudioProjectState(expected), b = deserializeAudioProjectState(actual), changes=[];
  const clips = s => s.tracks.flatMap(t => t.clips);
  const left=clips(a), right=clips(b);
  if(left.length!==right.length)changes.push({path:'clipCount',expected:left.length,actual:right.length});
  for(let i=0;i<left.length;i++)for(const key of ['transposition','reversed','formantCorrection','amplitude','fadeInBeats','fadeOutBeats','startBeats','endBeats','readStartBeats','loop','warp']) {
    // Old servers omit neutral formant. Default 0 has identical playback semantics.
    const x=key==='formantCorrection' ? left[i][key]??0 : left[i][key],y=key==='formantCorrection' ? right[i]?.[key]??0 : right[i]?.[key];
    const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;const stable=v=>JSON.stringify(canonical(v));
    if(stable(x)!==stable(y))changes.push({path:`clips[${i}].${key}`,expected:x,actual:y});
  }
  return {passed:changes.length===0,verificationKind:'save_readback',uiVerification:'NOT VERIFIED',changes};
}
