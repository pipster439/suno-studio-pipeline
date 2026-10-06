import { sample, ffmpeg, probe, readPCM } from './pcm.mjs';
import { readFile } from 'node:fs/promises';
export const INVERSE_PROFILE_VERSION='local-inverse-v2';
export function deriveLocalInverse(profile, config={}) {

  const provided=config.provided??[],explicit=provided.includes('local-pitch')||provided.includes('pitch-up');
  if(provided.includes('local-pitch')&&provided.includes('pitch-up')&&config['local-pitch']!==config['pitch-up'])throw Error('Conflicting local pitch aliases');
  const pitch=provided.includes('local-pitch')?config['local-pitch']:provided.includes('pitch-up')?config['pitch-up']:-profile.pitchSemitones;
  // Synthetic controlled candidates: atempo restored pitch/alignment better for
  // speed-only; joint Rubber Band was better aligned for the -8 + half-speed case.
  // These narrow measured cases are not generalized as a perceptual guarantee.
  const tempoEngine=profile.speedRatio===.5&&profile.pitchSemitones===0&&pitch===-profile.pitchSemitones?'ffmpeg_atempo':'rubberband';
  const timeVerified=profile.speedRatio===1||profile.speedRatio===.5&&[0,-8].includes(profile.pitchSemitones)&&pitch===-profile.pitchSemitones;
  return {version:INVERSE_PROFILE_VERSION,pitchShiftSemitones:pitch,tempoEngine,timeTransformStatus:timeVerified?'MEASURED_SYNTHETIC_OR_IDENTITY':'NOT VERIFIED',speedRatio:1,timeStretchRatio:profile.speedRatio,
    tempoMultiplier:1/profile.speedRatio,formantMode:profile.formant===0?'NEUTRAL_NO_OP':'UNSUPPORTED_NO_LOCAL_PROCESSING',formantInverse:profile.formant===0?'EXACT_NO_OP':'NOT_SUPPORTED',warnings:[...(profile.volume===1?[]:['Reciprocal gain is not an end-to-end loudness inverse: upload level changes were observed']),...(pitch===-profile.pitchSemitones?[]:['Explicit local pitch differs from the derived inverse; pitch recovery NOT VERIFIED']),...(profile.formant===0?[]:['Non-neutral formant inverse NOT_SUPPORTED; source recovery is not claimed']),...(timeVerified?[]:['This pitch/speed inverse combination is NOT VERIFIED; using derived linear duration mapping only'])],requestedGain:1/profile.volume,gain:1/profile.volume,
    sourceOfDerivation:explicit?'EXPLICIT_CLI':'semitone inverse + populated linear warp duration inverse + linear amplitude reciprocal',
    confidence:timeVerified?'PITCH_AND_LINEAR_WARP_TIMING_MEASURED; END_TO_END_LEVEL_RESTORATION_NOT_VERIFIED':'DERIVED_ONLY; THIS_INVERSE_COMBINATION_NOT_VERIFIED',verifiedBy:['controlled API save_readback','synthetic pitch/speed render matrix'],componentConfidence:{pitch:'MEASURED_-8; other semitones derived from static semitone behavior',timing:timeVerified?'MEASURED_LINEAR_STRETCH_ON_OR_IDENTITY':'NOT VERIFIED',gain:'THEORETICAL_RECIPROCAL; upload level changes prevent end-to-end guarantee',formant:profile.formant===0?'NEUTRAL_NO_OP':'NOT_SUPPORTED'},pitchOverridden:explicit,
    headroomPolicy:'cap gain at peak-safe value, warn; no limiter/compressor/normalization'};
}
export function safeInverseGain(requestedGain,peak) {
  if(!Number.isFinite(requestedGain)||requestedGain<=0||!Number.isFinite(peak)||peak<0)throw Error('Invalid inverse gain/peak');
  const gain=peak>0?Math.min(requestedGain,0.998999/peak):requestedGain;
  return {gain,requestedGain,headroomLimited:gain<requestedGain,restorationLimitDb:20*Math.log10(gain/requestedGain)};
}
export async function preprocessInverse(input,output,inverse) {
  const sourceInfo=await probe(input),filters=[];
  const atempo=inverse.tempoEngine==='ffmpeg_atempo';
  if(inverse.pitchShiftSemitones!==0||inverse.tempoMultiplier!==1&&!atempo)filters.push(`rubberband=pitch=${2**(inverse.pitchShiftSemitones/12)}:tempo=${atempo?1:inverse.tempoMultiplier}:pitchq=quality`);
  if(atempo){let ratio=inverse.tempoMultiplier;while(ratio>2){filters.push('atempo=2');ratio/=2;}while(ratio<.5){filters.push('atempo=0.5');ratio*=2;}if(ratio!==1)filters.push(`atempo=${ratio}`);}
  await ffmpeg(['-y','-i',input,'-map','0:a:0','-vn',...(filters.length?['-af',filters.join(',')]:[]),'-c:a','pcm_f32le',output]);
  let pcm=readPCM(await readFile(output)),peak=0;
  for(let i=0;i<pcm.frames;i++)for(let c=0;c<pcm.channels;c++)peak=Math.max(peak,Math.abs(sample(pcm,i,c)));
  // No auto gain when volume=1. Headroom policy only protects a requested inverse gain boost.
  const safe=inverse.requestedGain>1?safeInverseGain(inverse.requestedGain,peak):{gain:inverse.requestedGain,requestedGain:inverse.requestedGain,headroomLimited:false,restorationLimitDb:0};
  Object.assign(inverse,safe,{preGainPeak:peak});
  if(safe.gain!==1){const {writeFile}=await import('node:fs/promises');for(let i=0;i<pcm.frames;i++)for(let c=0;c<pcm.channels;c++)pcm.data.writeFloatLE(sample(pcm,i,c)*safe.gain,i*pcm.blockAlign+c*4);const {wav}=await import('./pcm.mjs');await writeFile(output,wav(pcm));}
  if(pcm.sampleRate!==sourceInfo.sampleRate||pcm.channels!==sourceInfo.channels)throw Error('Unexpected sample normalization');
  return {pcm,sourceInfo,conversion:{codec:'pcm_f32le',sampleRate:pcm.sampleRate,channels:pcm.channels,pitchUp:inverse.pitchShiftSemitones,tempoMultiplier:inverse.tempoMultiplier,tempoEngine:inverse.tempoEngine??'legacy_rubberband',gain:safe.gain,headroomLimited:safe.headroomLimited,inverseProfileVersion:inverse.version}};
}
