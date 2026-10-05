import { buildStudioClipDraft, applyPostProcessProfile, WarpHashStrategy } from './dry-run-sdk.mjs';
import { deserializeAudioProjectState } from './clip-pipeline.mjs';
import { serializeWarpState } from './warp-registry.mjs';
import { validateProjectForSave } from './validation.mjs';
import { studioStateDiff } from './state-diff.mjs';
const result=(before,after,rule)=>({state:after,diff:studioStateDiff(before,after),status:'FOUND_STATICALLY',rule,serverVerified:false});
export function predictAddClipDiff(before,source,{trackId=before.tracks[0]?.id,profile,timelineStart,compatibility={},hashStrategy=WarpHashStrategy.CURRENT_STATIC_ALGORITHM}={}){
  validateProjectForSave(before);const memory=deserializeAudioProjectState(before),track=memory.tracks.find(t=>t.id===trackId);
  if(!track)throw Error('known target track required');const {clip}=buildStudioClipDraft(source,before.timing,profile,compatibility);
  const start=timelineStart??Math.max(0,...track.clips.map(c=>c.endBeats));const length=clip.endBeats-clip.startBeats;
  track.clips.push({...clip,startBeats:start,endBeats:start+length});
  const wire=serializeWarpState(memory,{strategy:hashStrategy,originalWire:before}).state;validateProjectForSave(wire);
  return {...result(before,wire,'append audio arrangement; selection/focus are optional UI effects'),arrangementId:clip.id,dynamicPaths:[`/tracks/${memory.tracks.indexOf(track)}/clips/${track.clips.length-1}/id`]};
}
function overlay(before,id,fn,rule){validateProjectForSave(before);const after=structuredClone(before);let found=false;
  for(const t of after.tracks)for(const c of t.clips)if(c.id===id){fn(c);found=true;}if(!found)throw Error('known arrangement ID required');
  validateProjectForSave(after);return result(before,after,rule);}
export function predictMoveClipDiff(before,id,start){if(!Number.isFinite(start))throw Error('finite start required');return overlay(before,id,c=>{const duration=c.endBeats-c.startBeats;c.startBeats=start;c.endBeats=start+duration;},'timeline start/end only; read/asset/warp unchanged');}
export function predictTranspositionDiff(before,id,value){return overlay(before,id,c=>Object.assign(c,applyPostProcessProfile(c,{explicit:{transposition:value}}).clip),'explicit transposition clamp [-24,24]');}
export function predictFadeDiff(before,id,explicit){if(Object.keys(explicit).some(k=>!/^fade_(in|out)_(beats|curve)$/.test(k)))throw Error('fade-only predictor');return overlay(before,id,c=>Object.assign(c,applyPostProcessProfile(c,{explicit}).clip),'explicit fade overlay, no default replacement');}
export function comparePredictionToCapture(predicted,actual,{dynamicPaths=[],captureOrigin='LIVE_CAPTURE',readbackConfirmed=false,reproductionConfirmed=false}={}){
  const reality=structuredClone(actual);
  for(const path of dynamicPaths.filter(p=>p.endsWith('/id'))){const keys=path.split('/').slice(1).map(k=>k.replaceAll('~1','/').replaceAll('~0','~'));let p=predicted,r=reality;for(const k of keys.slice(0,-1)){p=p?.[k];r=r?.[k];}
    if(p&&r&&p.asset?.id&&p.asset.id===r.asset?.id&&typeof p.id==='string'&&typeof r.id==='string')r.id=p.id;}
  const rows=studioStateDiff(predicted,reality).changes.map(c=>({...c,classification:dynamicPaths.some(p=>c.path===p||c.path.startsWith(p+'/'))?'MATCH':c.kind==='added'?'EXTRA_REAL_FIELD':c.kind==='removed'?'MISSING_PREDICTED_FIELD':c.kind==='array_reordered'?'UNKNOWN_TRANSFORM':'DIFFERENT_VALUE'}));
  const matched=rows.every(r=>r.classification==='MATCH');
  return {matched,rows,counts:Object.fromEntries(['MATCH','EXTRA_REAL_FIELD','MISSING_PREDICTED_FIELD','DIFFERENT_VALUE','UNKNOWN_TRANSFORM'].map(k=>[k,rows.filter(r=>r.classification===k).length])),
    confidenceUpgradeRecommendation:{eligibleForVerified:matched&&captureOrigin==='LIVE_CAPTURE'&&readbackConfirmed&&reproductionConfirmed,humanReviewRequired:true,documentsChanged:false,reason:captureOrigin!=='LIVE_CAPTURE'?'offline replay is not live evidence':!reproductionConfirmed?'separate authorized reproduction required':'review matching request/readback evidence'},status:'LOCAL_COMPARISON'};
}
