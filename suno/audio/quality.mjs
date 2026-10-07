// Fixed policy: candidate flags use the existing detector, scores are a further
// conservative guard. Historical clean music controls max<2, failed seams >30.
export const QUALITY_THRESHOLDS=Object.freeze({version:'seam-quality-v1-20261006',detectorVersion:1,baselineCount:128,minimumActiveBaseline:16,maxScore:6,averageScore:3,codecTailToleranceMs:50,endpointExclusionSeconds:.1});
export function unavailableQuality({boundaryCount,expectedDuration,metadataDuration=null,reason}) {
  const analysis={version:QUALITY_THRESHOLDS.detectorVersion,unavailable:true,reason,duration:metadataDuration,
    boundaryCount,detectedAnomalyCount:null,averageBoundaryScore:null,maxBoundaryScore:null,baselineCount:0,boundaries:[]};
  return {analysis,gate:{status:'UNAVAILABLE',warnings:[],reason,expectedDuration},
    qualitySummary:{quality:'UNAVAILABLE',qualityResult:'UNAVAILABLE',qualityReason:reason,boundaryCount,
      anomalyCount:null,averageScore:null,maxScore:null,remoteProbeMode:'UNAVAILABLE',qualityProbeMs:0}};
}
export function calibrationPass(summary,policy=QUALITY_THRESHOLDS) {
  return summary.quality==='PASS'&&summary.anomalyCount===0&&summary.internalSilentGapCount===0&&summary.clippingCandidateCount===0&&summary.timelineGapSamples===0&&Math.abs(summary.durationErrorMs)<=policy.codecTailToleranceMs&&summary.baselineCount>=policy.minimumActiveBaseline&&Number.isFinite(summary.averageScore)&&Number.isFinite(summary.maxScore)&&summary.averageScore<=policy.averageScore&&summary.maxScore<=policy.maxScore;
}
export function classifyGaps(gaps,duration,sourceRmsAt,policy=QUALITY_THRESHOLDS) {
  return gaps.map(g=>({...g,sourceRms:sourceRmsAt(g),kind:g.start<=policy.endpointExclusionSeconds||g.end>=duration-policy.endpointExclusionSeconds?'ENDPOINT_PADDING_OR_SILENCE':'INTERNAL',unexpected:sourceRmsAt(g)>=.001}));
}
export function summarizeQuality(analysis,gate,timelineGapSamples=0,gaps=[]) {
  return {label:'AUTOMATED QUALITY RESULT',quality:gate.status,qualityThresholdVersion:QUALITY_THRESHOLDS.version,detectorVersion:analysis.version,boundaryCount:analysis.boundaryCount,anomalyCount:analysis.detectedAnomalyCount,averageScore:analysis.averageBoundaryScore,maxScore:analysis.maxBoundaryScore,baselineCount:analysis.baselineCount,internalSilentGapCount:gaps.filter(g=>g.kind==='INTERNAL'&&g.unexpected&&g.end-g.start>.05).length,clippingCandidateCount:analysis.boundaries.filter(b=>b.findings.some(f=>f.metric==='clipping')).length,timelineGapSamples,durationErrorMs:(analysis.duration-gate.expectedDuration)*1000,endpointPadding:gaps.filter(g=>g.kind!=='INTERNAL'),silenceCoverage:'ALL_PCM'};
}
