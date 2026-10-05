import {readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';
import {studioStateDiff}from'./state-diff.mjs';
import {predictMoveClipDiff,predictTranspositionDiff,comparePredictionToCapture}from'./predictions.mjs';
import {deserializeAudioProjectState,serializeAudioProjectState}from'./clip-pipeline.mjs';
import {transformRenderState,deriveDownbeats,renderRange}from'./render-pipeline.mjs';
export async function analyzeValidationRun(root,runId){
  if(!/^[\w-]+$/.test(runId))throw Error('known run ID required');const run=resolve(root,runId),scenarios={};
  for(const key of ['A_CREATE','B_ADD','C_SAVE','D_MOVE','E_SAVE','F_TRANSPOSE','G_SAVE','H_EXPORT']){try{const dir=resolve(run,key);scenarios[key]={before:JSON.parse(await readFile(resolve(dir,'before.json'),'utf8')),after:JSON.parse(await readFile(resolve(dir,'after.json'),'utf8')),records:JSON.parse(await readFile(resolve(dir,'records.json'),'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}}
  const analysis=[];
  for(const [edit,save,rule]of [['B_ADD','C_SAVE','ADD'],['D_MOVE','E_SAVE','MOVE'],['F_TRANSPOSE','G_SAVE','TRANSPOSE']]){
    const before=scenarios[edit]?.before?.state,after=scenarios[save]?.after?.state;
    if(!before||!after){analysis.push({edit,save,rule,status:'WAITING_FOR_NEXT_SAVE',reason:'GET may not expose unsaved editor state; no invented local snapshot'});continue;}
    const d=studioStateDiff(before,after),old=before.tracks.flatMap(t=>t.clips),next=after.tracks.flatMap(t=>t.clips);
    if(rule==='ADD'){const added=next.filter(c=>!old.some(o=>o.id===c.id));const existingPreserved=old.every(c=>JSON.stringify(c)===JSON.stringify(next.find(a=>a.id===c.id)));
      analysis.push({edit,save,rule,status:'STRUCTURAL_COMPARISON',singleAddition:added.length===1&&next.length===old.length+1,existingClipsPreserved:existingPreserved,
        identitySeparation:added.every(c=>c.id!==c.asset?.id),sourceReferences:added.map(c=>c.asset?.id),markerReferencesResolve:added.every(c=>!!after.markersRegistry[c.warp?.markersHash]),stateDiff:d,
        exactConstructorPrediction:'NEEDS_SOURCE_METADATA / explicit profile; marker range alone is not full source metadata'});continue;}
    const field=rule==='MOVE'?'startBeats':'transposition',changed=next.filter(c=>old.find(o=>o.id===c.id)?.[field]!==c[field]);
    if(changed.length!==1){analysis.push({edit,save,rule,status:'UNKNOWN_TRANSFORM',reason:'cannot isolate exactly one target',stateDiff:d});continue;}
    try{const predicted=rule==='MOVE'?predictMoveClipDiff(before,changed[0].id,changed[0].startBeats):predictTranspositionDiff(before,changed[0].id,changed[0].transposition);
      analysis.push({edit,save,rule,status:'CONDITIONAL_RULE_COMPARISON',actionParameterSource:'OBSERVED after state; not independently predicted input',comparison:comparePredictionToCapture(predicted.state,after)});
    }catch(e){analysis.push({edit,save,rule,status:'BLOCKER',reason:e.message});}
  }
  for(const [key,data]of Object.entries(scenarios))for(const record of data.records){
    const path=record.request.path.split('?')[0],wire=record.request.body?.state;if(!wire)continue;
    if(path==='/api/studio/save-project'&&data.after?.state){try{const normalized=serializeAudioProjectState(deserializeAudioProjectState(data.after.state));analysis.push({scenario:key,rule:'SAVE_SERIALIZED_STATE_READBACK',comparison:comparePredictionToCapture(normalized,wire),scope:'wire request vs canonical reserialized after state, not unsaved editor identity'});}catch(e){analysis.push({scenario:key,rule:'SAVE',status:'BLOCKER',reason:e.message});}}
    if(path==='/api/studio/render-state'&&data.before?.state){try{const before=data.before.state,transformed=transformRenderState(deserializeAudioProjectState(before)),serialized=serializeAudioProjectState(transformed),range=renderRange(before,{fullSong:record.request.body.export_mode==='fullsong_export'});
      analysis.push({scenario:key,rule:'EXPORT_STATE_RANGE_DOWNBEATS',comparison:comparePredictionToCapture({state:serialized,start_beats:range.startBeats,end_beats:range.endBeats,downbeats:deriveDownbeats(transformed.timing,range.startBeats,range.endBeats)},
        {state:wire,start_beats:record.request.body.start_beats,end_beats:record.request.body.end_beats,downbeats:record.request.body.downbeats}),uncompared:['lyrics alignment unavailable unless captured/provided','workspace project binding observed, not inferred']});}
      catch(e){analysis.push({scenario:key,rule:'EXPORT',status:'BLOCKER',reason:e.message});}}
  }
  const result={runId,analysis,humanReviewRequired:true,documentsChanged:false,writeDispatches:0};
  await writeFile(resolve(run,'derived-analysis-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
