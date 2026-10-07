import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import privacy from '../../shared/studio-privacy.cjs';
import {durableJson} from '../../shared/durable-json.mjs';
import {resolveRenderDelivery,resolveOptionalDelivery} from './render-lifecycle.mjs';
import {resolveLibraryExport} from './library-export.mjs';
import {exportCompletionStatus,requireExportReady} from './studio-export.mjs';
import {probeSongPage,songPageURL,openSongPage} from './final-result.mjs';
import {unavailableQuality} from './quality.mjs';
import {writeAnalysis} from './boundaries.mjs';

const readJSON=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};

export function verifiedResumeCompletion(job,binding,clip) {
  const record=job.renderJobs?.find(r=>r.id===job.renderClipId),metadata=clip?.metadata;
  const keys=['projectId','versionId','startBeats','endBeats'];
  return !!record&&!record.terminalFailure&&clip?.id===record.id&&clip.status==='complete'&&
    record.materialization?.status==='complete'&&keys.every(k=>record.binding?.[k]===binding[k]&&record.materialization.binding?.[k]===binding[k])&&
    metadata?.studio_project_id===binding.projectId&&metadata.studio_project_version_id===binding.versionId&&
    metadata.studio_project_start_beats===binding.startBeats&&metadata.studio_project_end_beats===binding.endBeats;
}

// A previously verified delivery restriction needs no local audio to resume.
// Resolve the acknowledged job with the existing lifecycle; never submit here.
export async function resumeRestrictedResult({work,mode,job,binding,bridge,config,deps,log,persist}) {
  const started=performance.now(),directory=join(work,mode),snapshots=[];
  for(const name of ['render-response.json','render-complete.json']){
    const clip=await readJSON(join(directory,name),null);
    if(clip)snapshots.push({clip,binding});
  }
  // An already verified materialization is durable too. Default page resume
  // can use it without another run's temporary controller capability.
  const cached=!config['require-library']&&!config.diagnose&&snapshots.find(s=>verifiedResumeCompletion(job,binding,s.clip));
  let complete;
  if(cached){
    complete=cached.clip;job.renderLifecycle={version:1,state:'RENDER_READY',selectedId:job.renderClipId,metadataEvidence:'PERSISTED_COMPLETE_READBACK'};
    job.renderJobs.find(r=>r.id===job.renderClipId).state='RENDER_READY';await persist();
    await log({event:'render_ready',mode,id:job.renderClipId,message:`id=${job.renderClipId} metadata=PERSISTED_COMPLETE_READBACK`});
  }else({complete}=await resolveRenderDelivery(job,{...deps.renderLifecycle,bridge,binding,snapshots,
    metadataOnly:true,preferredRenderId:job.renderClipId,persist,
    timeoutMs:config['render-timeout-seconds']*1000,
    log:e=>log({mode,...e,message:`id=${e.id} state=${e.state??''} age=${Math.round((e.ageMs??0)/1000)}s`}),
    observe:async(kind,value)=>{if(kind==='complete')await durableJson(join(directory,'render-complete.json'),privacy.sanitize(value));}
  }));
  job.songPage=await(deps.pageProbe??probeSongPage)(job.renderClipId);
  await durableJson(join(directory,'song-page.json'),job.songPage);await persist();
  if(config['require-library']||config.diagnose){
    try{job.libraryExport=await resolveLibraryExport(bridge,complete,binding,{...deps.libraryLifecycle,
      timeoutMs:config['require-library']?180000:0,log:e=>log({mode,...e}),
      persist:async result=>{job.libraryExport=result;await persist();await durableJson(join(directory,'library-membership.json'),result);}
    });}catch(error){job.libraryExport={renderId:job.renderClipId,membershipDeterminate:false,libraryVisible:false};await log({event:'library_status_unknown',kind:error.kind,status:error.status});}
  }
  job.exportStatus=exportCompletionStatus(job,binding,complete,{requireLibrary:!!config['require-library']});
  await persist();await durableJson(join(directory,'export-status.json'),job.exportStatus);
  requireExportReady(job.exportStatus);
  await log({event:'final_song',id:job.renderClipId,message:songPageURL(job.renderClipId)});
  const delivery=await resolveOptionalDelivery(job,complete,{bridge,persist,log,playerProbe:deps.renderLifecycle?.playerProbe});
  job.exportStatus=exportCompletionStatus(job,binding,complete,{requireLibrary:!!config['require-library']});
  const previous=await readJSON(join(work,'summary.json'),job.summary??{});
  const chunk=await readJSON(join(work,'chunk-selection.json'),previous.chunkSelection??null);
  const boundaryCount=previous.boundaryCount??chunk?.internalBoundaryCount??Math.max(0,job.wire.tracks.reduce((n,t)=>n+t.clips.length,0)-1);
  const expectedDuration=previous.expectedDuration??binding.endBeats/job.wire.timing.bps;
  const qa=unavailableQuality({boundaryCount,expectedDuration,metadataDuration:complete.metadata.duration,
    reason:delivery.deliveryStatus==='RESTRICTED'?'DELIVERY_RESTRICTED':'DELIVERY_UNAVAILABLE'});
  qa.qualitySummary.renderClipId=job.renderClipId;
  for(const base of [directory,work]){
    await writeAnalysis(join(base,'diagnostics'),qa.analysis,null,false);
    await durableJson(join(base,'quality-summary.json'),qa.qualitySummary);
    await durableJson(join(base,'diagnostics','quality-gate.json'),qa.gate);
  }
  const result={...previous,work,mode,projectId:job.projectId,versionId:job.versionId,
    renderClipId:job.renderClipId,renderedClipId:job.renderClipId,finalSongURL:job.exportStatus.finalSongURL,
    libraryStatus:job.exportStatus.libraryStatus,deliveryStatus:delivery.deliveryStatus,exportStatus:job.exportStatus,
    runSuccess:true,runStatus:'COMPLETE',productionResult:'SUCCESS',quality:'UNAVAILABLE',classification:'UNAVAILABLE',
    qualityResult:'UNAVAILABLE',qualityReason:qa.qualitySummary.qualityReason,qualitySummary:qa.qualitySummary,
    boundaryCount,detectedAnomalyCount:null,averageBoundaryScore:null,maxBoundaryScore:null,
    duration:complete.metadata.duration,expectedDuration,chunkSelection:chunk,
    preprocessedDuration:previous.preprocessedDuration??chunk?.preprocessedDuration??null,
    clipCount:previous.clipCount??chunk?.clipCount??boundaryCount+1,internalBoundaryCount:boundaryCount,
    renderedAudioURL:null,deliverySource:null,remoteProbeMode:'UNAVAILABLE',output:null,outputFile:null,downloaded:false,
    resumedWithoutLocalAudioWork:true,performance:{resumeElapsedMs:performance.now()-started}};
  // Do not carry an earlier --open result into an unflagged resume.
  delete result.openStatus;
  job.phase='complete';job.summary=result;await persist();
  await durableJson(join(directory,'export-status.json'),job.exportStatus);
  await durableJson(join(work,'summary.json'),privacy.sanitize(result));
  await durableJson(join(work,'render-summary.json'),{renderedClipId:job.renderClipId,finalSongURL:result.finalSongURL,exportStatus:job.exportStatus,deliveryStatus:result.deliveryStatus,downloaded:false,output:null});
  await durableJson(join(work,'run-status.json'),{status:'COMPLETE',...job.exportStatus,quality:'UNAVAILABLE'});
  await log({event:'quality_unavailable',message:result.qualityReason});
  await log({event:'run_complete',message:'DONE: '+result.finalSongURL});
  if(config.open){try{await(deps.openSongPage??openSongPage)(result.finalSongURL);result.openStatus='OPENED';}catch(error){result.openStatus='UNAVAILABLE';await log({event:'open_unavailable',message:error.message});}await durableJson(join(work,'summary.json'),privacy.sanitize(result));}
  return result;
}
