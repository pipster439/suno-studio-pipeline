import { NotVerifiedError } from './operations.mjs';
import { projectBeatsToSeconds, durationSecondsToBeats } from './clip-pipeline.mjs';
import { validateJsonData } from './validation.mjs';
// These are observed strings, not server-verified enums. V1 cache fallback is not a wire default.
export const ExportMode=Object.freeze({FULL_SONG:'fullsong_export',SELECTION:'selected_time_range_export',CONTEXT:'rendered_context_window',SELECTION_DOWNLOAD:'selection_download_export'});
export const RenderEngine=Object.freeze({V2:'v2'});
export function getPlaintextLyrics(tokens){validateJsonData(tokens);if(!Array.isArray(tokens)||tokens.some(t=>typeof t?.text!=='string'))throw new Error('explicit aligned lyric token text required');return tokens.map(t=>t.text).join('');} // module 402294 @1216663
export const RENDER_EVIDENCE=Object.freeze({status:'FOUND_STATICALLY',confidence:'High',
  acceptedProfile:{status:'VERIFIED',verification:{kind:'request_acceptance',scope:'manual bps=1.95; single unmuted audio track; range 0..32; v2/fullsong_export; queued only'},source:'reports/STUDIO_FREE_WRITE_VALIDATION_SANITIZED.md'},
  stage1:{module:17660,file:'0kfolb-xhy_j4.js',offset:73412},stage2:{module:950155,file:'0kfolb-xhy_j4.js',offset:103608},
  downbeat:{module:714981,file:'0kfolb-xhy_j4.js',offset:1216430},derivedTiming:{module:265449,file:'0kfolb-xhy_j4.js',offset:101050},
  caller:{module:748387,file:'3g9-3c-u44c0o.js',offset:825347},serverVerified:false});
export function normalizeRenderStateStage1(state){
  validateJsonData(state);
  return {...structuredClone(state),tracks:state.tracks.map(t=>({...structuredClone(t),clips:t.clips.filter(c=>c.type==='audio'?c.asset?.type==='clip':c.type!=='video'||c.asset?.type==='video').map(c=>structuredClone(c))}))};
}
export function normalizeRenderStateStage2(state){
  // Official fast path returns input when no muted clips. Our boundary always copies.
  return {...structuredClone(state),tracks:state.tracks.map(t=>({...structuredClone(t),clips:t.clips.filter(c=>!c.mute).map(c=>structuredClone(c))}))};
}
export function deriveManualRenderTiming(timing){
  durationSecondsToBeats(1,timing); // follow-track and automation remain deliberately outside MVP.
  return {bps:timing.bps,bpsAutomation:[],firstBeatSeconds:0}; // official 265449 manual branch; lockBPS clears automation.
}
export function deriveDownbeats(timing,startBeats,endBeats){
  durationSecondsToBeats(1,timing);if(!Number.isFinite(startBeats)||!Number.isFinite(endBeats)||endBeats<startBeats)throw new Error('finite render range required');
  if(endBeats-startBeats>100000)throw new Error('downbeat preview exceeds local bound');
  const output=[],origin=projectBeatsToSeconds(startBeats,timing);
  for(let beat=Math.ceil(startBeats);beat<Math.floor(endBeats);beat++)output.push([projectBeatsToSeconds(beat,timing)-origin,(beat%4+4)%4+1]);
  return output;
}
export function renderRange(state,{fullSong=true}={}){
  const solo=state.tracks.some(t=>t.solo),audible=state.tracks.filter(t=>solo?t.solo:!t.mute);
  const clips=audible.flatMap(t=>t.clips);const start=Math.min(...clips.map(c=>c.startBeats)),end=Math.max(...clips.map(c=>c.endBeats));
  const a=Math.min(state.selection.anchorBeats,state.selection.focusBeats),b=Math.max(state.selection.anchorBeats,state.selection.focusBeats);
  return {startBeats:fullSong||a===b?(Number.isFinite(start)?start:0):a,endBeats:fullSong||a===b?(Number.isFinite(end)?end:240):b};
}
export function transformRenderState(memory){
  if(memory.tracks.some(t=>t.type!=='audio'||t.takeLanes.length||t.signalChain.length)||memory.masterSignalChain.length)
    throw new NotVerifiedError('MVP render supports audio main lanes without plugins only');
  const solo=memory.tracks.some(t=>t.solo),audible={...structuredClone(memory),tracks:memory.tracks.filter(t=>solo?t.solo:!t.mute)};
  const normalized=normalizeRenderStateStage2(normalizeRenderStateStage1(audible));
  return {...normalized,timing:{type:'manual',...deriveManualRenderTiming(memory.timing)},metronome:{enabled:false,amplitude:1}};
}
export function normalizeLegacyRenderState(memory){
  if(memory.tracks.some(t=>t.takeLanes.length)||(memory.takePreviews??[]).length)throw new NotVerifiedError('legacy heard-state take-lane split/preview outside audio MVP');
  return normalizeRenderStateStage2(normalizeRenderStateStage1(memory));
}
export function transformMultitrackRenderState(memory){
  const cleared={...structuredClone(memory),tracks:memory.tracks.map(t=>({...structuredClone(t),mute:false,solo:false}))};
  return transformRenderState(cleared); // official 371498 before 17660 / 950155; no effectively-muted prefilter.
}
