import {studioStateDiff}from'./state-diff.mjs';
import {deserializeAudioProjectState,serializeAudioProjectState}from'./clip-pipeline.mjs';
import {serializeWarpState,WarpHashStrategy}from'./warp-registry.mjs';
import {isDeepStrictEqual}from'node:util';
export function auditSaveRoundTrip(wire){
  const editor=deserializeAudioProjectState(wire),preserved=serializeWarpState(editor,{strategy:WarpHashStrategy.PRESERVE_EXISTING,originalWire:wire}).state,official=serializeAudioProjectState(editor);
  const preserveDiff=studioStateDiff(wire,preserved),diff=studioStateDiff(wire,official),semantic=isDeepStrictEqual(deserializeAudioProjectState(official),editor);
  const classified=diff.changes.map(c=>({...c,category:semantic&&(/\/warp\/markersHash$/.test(c.path)||c.path.startsWith('/markersRegistry/'))?'EXPECTED_SERIALIZER_TRANSFORM':'BLOCKER'}));
  const counts={IDENTICAL:preserveDiff.changes.length===0?1:0,EXPECTED_SERIALIZER_TRANSFORM:classified.filter(c=>c.category==='EXPECTED_SERIALIZER_TRANSFORM').length,RUNTIME_ONLY:0,UI_ONLY:0,UNKNOWN:0,BLOCKER:classified.filter(c=>c.category==='BLOCKER').length+preserveDiff.changes.length};
  return {status:'LOCAL_ROUND_TRIP',counts,preserveExisting:{identical:isDeepStrictEqual(wire,preserved),diff:preserveDiff},officialCurrentSerializer:{semanticEquivalent:semantic,fullDiff:classified},
    specialHandling:{markers:'inline → registry/hash; current official rebuilds registry',selection:'spread-preserved',UIFields:'spread-preserved, not removed by serializer',runtimeOnlyFields:'no extra deletion found in this serializer',undefined:'local SDK rejects; official object spread followed by JSON body encoding may omit undefined',null:'preserved',MapSet:'internal dedup only; SDK wire rejects non-JSON classes',clipCreationIntents:'spread-preserved',signalChain:'spread-preserved',automation:'spread-preserved; unsupported timing rejected by SDK',timing:'spread-preserved',routing:'spread-preserved'},serverVerified:false};
}
