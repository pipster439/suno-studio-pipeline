import {sample,sha256,slicePlan,wav}from'./pcm.mjs';
import{QUALITY_THRESHOLDS,calibrationPass}from'./quality.mjs';
export const CALIBRATION_SCHEMA=1;
export function sourceFingerprint(inputHash,pcm,config) {
  const preprocessConfig={implementation:'ffmpeg-rubberband-quality-v1',inputHash,pcmContentHash:sha256(pcm.data),pitchUp:config['pitch-up'],studioTranspose:config['studio-transpose'],chunkSeconds:config['chunk-seconds'],minimumSliceSeconds:config['minimum-slice-seconds'],bps:config.bps,postRollMs:config['postroll-ms'],sampleFormat:{tag:pcm.tag,bits:pcm.bits,sampleRate:pcm.sampleRate,channels:pcm.channels}};
  return {sourceFingerprint:sha256(JSON.stringify(preprocessConfig)),preprocessConfig};
}
export function validCalibrationCache(cache,fingerprint) {
  return cache?.schemaVersion===CALIBRATION_SCHEMA&&cache.sourceFingerprint===fingerprint&&cache.qualityThresholdVersion===QUALITY_THRESHOLDS.version&&cache.detectorVersion===QUALITY_THRESHOLDS.detectorVersion&&cache.status==='PASS'&&cache.testedCandidates?.some(c=>c.qualityPass&&calibrationPass(c.qualitySummary)&&c.strategy===cache.chosenStrategy&&c.preRollMs===cache.preRollMs&&c.postRollMs===cache.postRollMs);
}
export function strategyOverride(config) {
  if(config.strategy==='exact')return{strategy:'exact',preRollMs:0,postRollMs:0,reason:'EXPLICIT_CLI'};
  if(config.strategy==='preroll'||config.provided?.some(k=>['preroll-ms','postroll-ms'].includes(k)))return{strategy:'preroll',preRollMs:config['preroll-ms'],postRollMs:config['postroll-ms'],reason:'EXPLICIT_CLI'};
  if(config['skip-calibration'])return{strategy:'preroll',preRollMs:50,postRollMs:200,reason:'VERIFIED_SKIP_DEFAULT'};
  return null;
}
export async function progressiveCalibration(evaluate,{postRollMs=200,testedCandidates=[],checkpoint=async()=>{}}={}) {
  const tested=[...testedCandidates];
  for(const preRollMs of [0,50,100,200,300,500]) {
    const strategy=preRollMs===0?'exact':'preroll',post=preRollMs===0?0:postRollMs;
    let candidate=tested.find(c=>c.strategy===strategy&&c.preRollMs===preRollMs&&c.postRollMs===post&&c.qualityThresholdVersion===QUALITY_THRESHOLDS.version);
    if(!candidate){const started=performance.now();const result=await evaluate({strategy,preRollMs,postRollMs:post});candidate={strategy,preRollMs,postRollMs:post,qualityThresholdVersion:QUALITY_THRESHOLDS.version,...result,qualityPass:calibrationPass(result.qualitySummary),elapsedMs:performance.now()-started};tested.push(candidate);await checkpoint(tested);}
    if(candidate.qualityPass)return{status:'PASS',chosenStrategy:strategy,preRollMs,postRollMs:post,testedCandidates:tested};
  }
  return{status:'CALIBRATION_FAILED',chosenStrategy:null,preRollMs:null,postRollMs:null,testedCandidates:tested};
}
export function selectCalibrationRegion(pcm,plan) {
  const hop=Math.max(1,Math.round(.02*pcm.sampleRate)),bins=[];
  for(let a=0;a<pcm.frames;a+=hop){let energy=0,derivative=0,peak=0,n=0;for(let i=a;i<Math.min(pcm.frames,a+hop);i+=8)for(let c=0;c<pcm.channels;c++){const x=sample(pcm,i,c),d=i>0?x-sample(pcm,i-1,c):0;energy+=x*x;derivative+=d*d;peak=Math.max(peak,Math.abs(x));n++;}bins.push({rms:Math.sqrt(energy/Math.max(1,n)),spectral:derivative/Math.max(1e-12,energy),crest:peak/Math.max(1e-7,Math.sqrt(energy/Math.max(1,n)))});}
  const count=Math.min(plan.length,7),candidates=[];
  for(let i=0;i+count<=plan.length;i++){const start=plan[i].start,end=plan[i+count-1].end,selected=bins.slice(Math.floor(start/hop),Math.ceil(end/hop));let transients=0,active=0,spectral=0;for(let j=0;j<selected.length;j++){const b=selected[j];if(b.rms>.001){active++;spectral+=b.spectral;if(j&&b.rms>selected[j-1].rms*1.5&&b.rms>.005)transients++;}}const duration=(end-start)/pcm.sampleRate;if(plan.length>7&&duration>42.01)continue;candidates.push({startIndex:i,count,sourceStart:start/pcm.sampleRate,sourceEnd:end/pcm.sampleRate,startFrame:start,endFrame:end,duration,activeFraction:active/Math.max(1,selected.length),transientDensity:transients/duration,spectralActivity:spectral/Math.max(1,active)});}
  if(!candidates.length)throw Error('No calibration region');const maxT=Math.max(1e-9,...candidates.map(c=>c.transientDensity)),maxS=Math.max(1e-9,...candidates.map(c=>c.spectralActivity));for(const c of candidates)c.selectionScore=.45*c.transientDensity/maxT+.35*c.spectralActivity/maxS+.2*c.activeFraction;
  const selected=[...candidates].sort((a,b)=>b.selectionScore-a.selectionScore||a.startFrame-b.startFrame)[0];
  return {...selected,whySelected:'Highest deterministic activity score among chunk-aligned short regions: envelope transients + adjacent-sample spectral-energy proxy + non-silence; no instrument inference',methodVersion:1,candidateCount:candidates.length,logicalBoundaryCount:count-1,shortSource:plan.length<7};
}
export function calibrationPlan(pcm,fullPlan,region,options) {
  return slicePlan(pcm,options).slice(region.startIndex,region.startIndex+region.count).map((s,index)=>({...s,index,originalIndex:s.index,start:s.start-region.startFrame,end:s.end-region.startFrame,startSec:(s.start-region.startFrame)/pcm.sampleRate,endSec:(s.end-region.startFrame)/pcm.sampleRate,localHash:sha256(wav(pcm,s.sourceStart,s.sourceEnd))}));
}
