// Fixture-derived source extents are OBSERVED marker ranges, not downloaded audio metadata.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMergeDryRun, historicalProjectDiff, WarpHashStrategy } from '../suno/studio/dry-run-sdk.mjs';
export function historicalMergeInput(project) {
  const clips=project.state.tracks[0].clips;
  const sources=clips.map((c,i)=>{
    const markers=project.state.markersRegistry[c.warp.markersHash],extent=Math.max(...Object.keys(markers).map(Number));
    return {clip_id:c.asset.id,duration_seconds:extent,title:`Clip ${i+1}`,duration_basis:'OBSERVED_MARKER_EXTENT; full audio metadata not available',
      uploader_metadata:{observed_clip_id_alias:c.clipId}};
  });
  const perClipProfiles=clips.map(c=>({explicit:{transposition:c.transposition,amplitude:c.amplitude,read_start_beats:c.readStartBeats,
    fade_in_beats:c.fadeInBeats,fade_out_beats:c.fadeOutBeats,fade_in_curve:c.fadeInCurve,fade_out_curve:c.fadeOutCurve},
    warp:{markers:project.state.markersRegistry[c.warp.markersHash],enabled:c.warp.enabled,awaiting_analysis:c.warp.awaitingAnalysis},display:{color:c.color}}));
  return {sources,perClipProfiles,timing:project.state.timing,template:project,title:'Local 20 Clip Dry Run',placementMode:'RESOLVED_WARP',
    hashStrategy:WarpHashStrategy.CURRENT_STATIC_ALGORITHM,compatibility:{preserve_observed_clip_id_alias:true},
    requestContext:{save_project_id:'dry-run-created-studio-project',project_id:'dry-run-workspace-project',studio_project_id:'dry-run-created-studio-project',
      studio_project_version_id:'dry-run-saved-version',binding_status:'LOCAL_PLACEHOLDER'},
    // Explicit values from the known static V2 branch. These IDs and downbeats are preview inputs.
    render:{render_engine:'v2',export_mode:'fullsong_export',web_client_pathname:'/studio',lyrics:'',downbeats:[]}};
}
export async function runHistoricalDryRun(output) {
  const project=JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json',import.meta.url),'utf8'));
  const fixture=JSON.parse(await readFile(new URL('../fixtures/studio_20_clip_dry_run.json',import.meta.url),'utf8'));
  const input={...fixture,template:project},result=buildMergeDryRun(input),diff=historicalProjectDiff(project,result);
  if(!diff.complete)throw Error('historical dry-run semantic differences require investigation');
  await mkdir(output,{recursive:true});
  const files={'dry_run_summary.json':result.summary,'dry_run_provenance.json':{...result.provenanceReport,
    exampleInputEvidence:'Source IDs / source marker extents / processing copied from observed fixture; source full media metadata unknown',
    renderPreviewInputEvidence:'empty downbeats explicitly supplied for local preview; official downbeat derivation not reproduced'},
    'historical_project_diff.json':diff,'validation_report.json':result.validationReport,
    'request_previews.json':{save:result.saveRequestPreview,render:result.renderRequestPreview},
    'project_draft.json':result.projectDraft};
  for(const[name,data]of Object.entries(files))await writeFile(resolve(output,name),JSON.stringify(data,null,2)+'\n');
  return {summary:result.summary,diff:diff.counts,files:Object.keys(files),output:resolve(output)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const output=resolve(process.argv[2]??'captures/dry-run-sdk/20261005');
  console.log(JSON.stringify(await runHistoricalDryRun(output),null,2));
}
