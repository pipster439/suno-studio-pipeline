import {sha256, wav} from './pcm.mjs';
import {QUALITY_THRESHOLDS} from './quality.mjs';

export const AUTO_CHUNK_VERSION = 'minimum-clip-count-v2';
export function normalizeUploadConstraints(value, minimum = 6) {
  const limits=value.audio_upload_limits??value;
  const min=Math.max(minimum, Number(limits.minDurationSeconds??limits.min));
  const max=Number(limits.maxDurationSeconds??limits.max);
  const bytes=limits.maxUploadBytes??null;
  if(!Number.isFinite(min)||min<0||!Number.isFinite(max)||max<=0||max<min||bytes!==null&&(!Number.isSafeInteger(bytes)||bytes<45))throw Error('Invalid verified upload constraints');
  return {minDurationSeconds:min,maxDurationSeconds:max,maxUploadBytes:bytes,evidence:value.evidence??{status:'LIVE_SERVER_RESPONSE',path:'audio_upload_limits'}};
}
export function encodedWavBytes(pcm, frames) {const size=frames*pcm.blockAlign;return 44+size+(size&1);}
function capacity(pcm, limits) {
  // RIFF is a local encoding ceiling, not an invented Suno service size limit.
  const bytes=Math.min(limits.maxUploadBytes??Infinity,0xffffffff+8);
  let frames=Math.min(Math.floor(limits.maxDurationSeconds*pcm.sampleRate),Math.floor((bytes-44)/pcm.blockAlign));
  while(encodedWavBytes(pcm,frames)>bytes)frames--;
  return frames;
}
export function planForCuts(pcm, cuts, {prerollMs=0,postrollMs=0}={}) {
  if(!Array.isArray(cuts)||cuts.length<2)throw Error('Invalid sample cuts');
  const pre=Math.round(prerollMs*pcm.sampleRate/1000),post=Math.round(postrollMs*pcm.sampleRate/1000);
  if(pre<0||post<0||!Number.isFinite(pre)||!Number.isFinite(post))throw Error('Invalid handle length');
  return cuts.slice(0,-1).map((start,index)=>{
    const end=cuts[index+1];if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>pcm.frames)throw Error('Invalid sample cuts');
    const sourceStart=Math.max(0,start-pre),sourceEnd=Math.min(pcm.frames,end+post);
    return {index,start,end,sourceStart,sourceEnd,startSec:start/pcm.sampleRate,endSec:end/pcm.sampleRate,durSec:(end-start)/pcm.sampleRate,sourceDurationSeconds:(sourceEnd-sourceStart)/pcm.sampleRate,readOffsetSeconds:(start-sourceStart)/pcm.sampleRate,localHash:sha256(wav(pcm,sourceStart,sourceEnd))};
  });
}
export function autoChunkPlan(pcm, limits, {minimumClipCount=1,prerollMs=0,postrollMs=0}={}) {
  if(!Number.isSafeInteger(minimumClipCount)||minimumClipCount<1)throw Error('Invalid minimum clip count');
  const min=Math.max(1,Math.ceil(limits.minDurationSeconds*pcm.sampleRate)),cap=capacity(pcm,limits);
  if(pcm.frames<min)throw Error('Source is shorter than minimum upload duration');
  const pre=Math.round(prerollMs*pcm.sampleRate/1000),post=Math.round(postrollMs*pcm.sampleRate/1000);
  let count=Math.max(minimumClipCount,Math.ceil(pcm.frames/cap));
  for(;count<=Math.floor(pcm.frames/min);count++) {
    const caps=Array.from({length:count},(_,i)=>cap-(i?pre:0)-(i<count-1?post:0));
    if(caps.some(c=>c<min)||caps.reduce((a,c)=>a+c,0)<pcm.frames)continue;
    const cuts=[0];let remaining=pcm.frames,totalCaps=caps.reduce((a,c)=>a+c,0);
    for(let i=0;i<count;i++) {
      totalCaps-=caps[i];const left=count-i-1;
      const frames=Math.min(caps[i],remaining-left*min,Math.max(min,Math.ceil(remaining/(left+1)),remaining-totalCaps));
      cuts.push(cuts.at(-1)+frames);remaining-=frames;
    }
    const plan=planForCuts(pcm,cuts,count===1?{}:{prerollMs,postrollMs});
    assertUploadPlan(pcm,plan,limits);return plan;
  }
  throw Error('No allowed chunk partition satisfies minimum duration and upload capacity');
}
export function assertUploadPlan(pcm, plan, limits) {
  for(const s of plan) {
    const duration=(s.sourceEnd-s.sourceStart)/pcm.sampleRate,bytes=encodedWavBytes(pcm,s.sourceEnd-s.sourceStart);
    if(duration<limits.minDurationSeconds||duration>limits.maxDurationSeconds||limits.maxUploadBytes!==null&&bytes>limits.maxUploadBytes)throw Error(`Chunk ${s.index} exceeds verified upload duration/size constraints`);
  }
}
export function chunkSummary(pcm, plan, limits, attempts=[]) {
  const distinct=[...new Map(attempts.map(a=>[`${a.planHash??a.clipCount}:${a.preRollMs??0}:${a.status}:${a.reason??''}`,a])).values()];
  return {version:AUTO_CHUNK_VERSION,strategy:'AUTO_CHUNK',objective:'MINIMIZE_CLIP_COUNT',preprocessedDuration:pcm.frames/pcm.sampleRate,clipCount:plan.length,internalBoundaryCount:Math.max(0,plan.length-1),cuts:[plan[0].start,...plan.map(s=>s.end)],planHash:sha256(JSON.stringify(plan.map(s=>[s.start,s.end]))),uploadPlanHash:sha256(JSON.stringify(plan.map(s=>[s.start,s.end,s.sourceStart,s.sourceEnd]))),sampleFormat:{sampleRate:pcm.sampleRate,channels:pcm.channels,bits:pcm.bits,tag:pcm.tag},uploadBytes:plan.map(s=>encodedWavBytes(pcm,s.sourceEnd-s.sourceStart)),constraints:limits,attempts:distinct};
}
export function technicalChunkFailure(error) {
  // Unknown processing failures are terminal, especially content/permission errors.
  if(/copyright|catalog|match|moderation|content.?policy|entitlement|subscription|permission/i.test(`${error.message??''} ${error.uploadErrorType??''}`))return null;
  if(error.kind==='technical_upload_constraint'&&['size','duration','transfer'].includes(error.constraintReason))return {reason:error.constraintReason,maxUploadBytes:error.maxUploadBytes??null};
  if(error.status===413&&(!error.uploadStage||['create_upload_slot','S3_upload','upload_finish'].includes(error.uploadStage)))return {reason:'size',maxUploadBytes:null};
  return null;
}
export function needsSeamMitigation(quality) {
  if(!quality.boundaryCount)return false;
  return quality.anomalyCount>0||quality.internalSilentGapCount>0||quality.clippingCandidateCount>0||quality.maxScore>QUALITY_THRESHOLDS.maxScore||quality.averageScore>QUALITY_THRESHOLDS.averageScore;
}
export function actualBoundaryRegion(pcm,plan,analysis,limits=null) {
  const rows=analysis?.boundaries??[];
  const choices=plan.slice(1).map((s,i)=>({cut:s.start,left:plan[i],right:s,score:rows.find(b=>Math.abs(b.timestamp-s.startSec)<.001)?.score??0}));
  if(!choices.length)throw Error('No internal boundary to calibrate');
  const chosen=choices.sort((a,b)=>b.score-a.score||a.cut-b.cut)[0];
  const span=Math.min(Math.round(12*pcm.sampleRate),limits?capacity(pcm,limits)-Math.ceil(.7*pcm.sampleRate):Infinity);
  if(span<Math.ceil((limits?.minDurationSeconds??6)*pcm.sampleRate))throw Error('Upload capacity cannot accommodate the verified handle calibration context');
  const start=Math.max(chosen.left.start,chosen.cut-span),end=Math.min(chosen.right.end,chosen.cut+span);
  return {startFrame:start,endFrame:end,sourceStart:start/pcm.sampleRate,sourceEnd:end/pcm.sampleRate,duration:(end-start)/pcm.sampleRate,cuts:[start,chosen.cut,end],logicalBoundaryCount:1,actualProductionBoundarySeconds:chosen.cut/pcm.sampleRate,methodVersion:2,whySelected:'Short context around an actual production cut; prioritize highest measured boundary score. No invented six-second seams.'};
}
