import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareFullSongExport, describeExportRequest, exportCompletionStatus, requireExportReady } from '../suno/audio/studio-export.mjs';
import { runPipeline } from '../scripts/studio-pipeline.mjs';
import { parseConfig } from '../suno/audio/config.mjs';
import { buildTimeline } from '../suno/audio/timeline.mjs';
import { wav, slicePlan } from '../suno/audio/pcm.mjs';
import { syntheticReference } from '../suno/audio/transform-verification.mjs';
import { resolveStudioProfile } from '../suno/audio/postprocessing-profile.mjs';
import { analyzeBoundaries, writeAnalysis } from '../suno/audio/boundaries.mjs';
import { QUALITY_THRESHOLDS } from '../suno/audio/quality.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json',import.meta.url),'utf8'));
const saved = state => ({ id:'latest-save-version',project_id:'project',state });
function stateFor(chunks=1) {
  const pcm=syntheticReference(12),slices=slicePlan(pcm,{chunkSeconds:12/chunks}).map((s,i)=>({...s,clipId:'source-'+i}));
  return buildTimeline(fixture,slices,{title:'Export',profile:resolveStudioProfile(parseConfig(['source.wav'])),bps:1.95,transpose:-8});
}
test('backend full-song export covers restored timeline for one or multiple clips, not uploaded duration',()=>{
  for(const n of [1,2]){
    const state=stateFor(n),out=prepareFullSongExport(saved(state),{projectId:'project',versionId:'latest-save-version',title:'Export'});
    assert.equal(out.endBeats,24*1.95);assert.equal(out.preview.body.start_beats,0);
    assert.equal(out.preview.body.studio_project_version_id,'latest-save-version');
    assert.equal(out.preview.body.export_mode,'fullsong_export');assert.equal(out.preview.body.render_engine,'v2');
    assert.equal(out.preview.body.state.tracks[0].clips[0].transposition,-8);
    assert.equal(describeExportRequest(out.preview).arrangementCount,n);
  }
});
test('export rejects stale readback identity and empty/invalid timeline',()=>{
  const options={projectId:'project',versionId:'latest-save-version',title:'Export'};
  assert.throws(()=>prepareFullSongExport({...saved(stateFor()),id:'old-version'},options),/mismatch/);
  assert.throws(()=>prepareFullSongExport({...saved(stateFor()),project_id:'another-project'},options),/mismatch/);
  assert.throws(()=>prepareFullSongExport(saved({...stateFor(),tracks:[]}),options),/timeline/);
  const state=stateFor();state.tracks[0].clips[0].endBeats=NaN;
  assert.throws(()=>prepareFullSongExport(saved(state),options),/finite/);
});
test('audit describes actual request and rejects selection/range/engine/version errors',()=>{
  const {preview}=prepareFullSongExport(saved(stateFor()),{projectId:'project',versionId:'latest-save-version',title:'Export'});
  assert.equal(describeExportRequest(preview).endpoint,'/api/studio/render-state');
  for(const change of [{export_mode:'selected_time_range_export'},{render_engine:'v1'},{start_beats:1},{studio_project_version_id:null},{studio_project_id:'foreign'}])
    assert.throws(()=>describeExportRequest({...preview,body:{...preview.body,...change}}),/Invalid backend/);
});
test('saved or queued projects cannot be RUN SUCCESS; ready delivery needs exact latest binding',()=>{
  const binding={projectId:'project',versionId:'latest-save-version',startBeats:0,endBeats:46.8},job={projectId:'project',versionId:'latest-save-version'};
  assert.throws(()=>requireExportReady(exportCompletionStatus(job,binding)),/RUN INCOMPLETE/);
  job.renderClipId='render';job.renderJobs=[{id:'render',state:'QUEUED'}];
  assert.equal(exportCompletionStatus(job,binding).renderSubmitted,true);
  assert.throws(()=>requireExportReady(exportCompletionStatus(job,binding)),/RUN INCOMPLETE/);
  const complete={id:'render',status:'complete',metadata:{studio_project_id:'project',studio_project_version_id:'latest-save-version',studio_project_start_beats:0,studio_project_end_beats:46.8}};
  assert.equal(exportCompletionStatus(job,binding,complete).renderReady,true);
  assert.equal(exportCompletionStatus(job,binding,complete).runSuccess,false);
  job.renderJobs[0]={id:'render',state:'READY',delivery:{source:'OFFICIAL_DELIVERY'}};job.renderLifecycle={state:'READY',selectedId:'render'};
  assert.equal(requireExportReady(exportCompletionStatus(job,binding,complete)).runSuccess,true);
  complete.metadata.studio_project_version_id='old-version';assert.throws(()=>requireExportReady(exportCompletionStatus(job,binding,complete)),/RUN INCOMPLETE/);
  assert.throws(()=>requireExportReady(exportCompletionStatus(job,{...binding,versionId:'old-version'},complete)),/RUN INCOMPLETE/);
});

test('production dispatches real SDK POST after readback, uses latest version/full range, waits through 404, and resumes without exports',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-backend-export-'));let state,renderBody,metadata,reads=0,deliveries=0,clock=Date.now();const calls=[];
  try{
    const source=syntheticReference(24),input=join(dir,'input.wav');await writeFile(input,wav(source));
    await writeFile(join(dir,'config.json'),JSON.stringify(parseConfig([input,'--keep-workdir'])));
    const bridge={call:async q=>{
      calls.push({method:q.method,path:q.path});
      if(q.path.startsWith('/api/studio/create-project'))return{status:200,result:{id:'project',title:'Export',created_at:'2026-10-07T00:00:00Z',updated_at:'2026-10-07T00:00:00Z',archived:false,major_version:2}};
      if(q.path==='/api/studio/save-project'){state=q.body.state;return{status:200,result:{id:'project',version_id:'latest-save-version'}};}
      if(q.path==='/api/studio/project/version/latest-save-version')return{status:200,result:saved(state)};
      if(q.path==='/api/studio/render-state'){
        assert.ok(calls.some(c=>c.path==='/api/studio/project/version/latest-save-version'));
        renderBody=q.body;assert.equal(renderBody.end_beats,24*1.95);assert.equal(renderBody.start_beats,0);
        metadata={studio_project_id:'project',studio_project_version_id:'latest-save-version',studio_project_start_beats:0,studio_project_end_beats:renderBody.end_beats,duration:24};
        return{status:200,result:{id:'render',status:'queued',entity_type:'song_schema',audio_url:'',metadata}};
      }
      if(q.path==='/api/clip/render'){reads++;if(reads===2||reads===3)throw Object.assign(Error('temporarily not visible'),{status:404});return{status:200,result:{id:'render',status:reads===1?'queued':'complete',audio_url:'',metadata}};}
      if(q.path.startsWith('/api/clips/get_songs_by_ids'))return{status:200,result:{clips:[]}};
      if(q.path==='/api/download/clip/render?format=m4a')return{status:200,result:++deliveries===1?{status:'processing'}:{status:'ready',download_url:'https://downloads.s3.amazonaws.com/test.m4a'}};
      throw Error('Unexpected endpoint '+q.path);
    }};
    const deps={bridge,uploadConstraints:{min:6,max:180},renderLifecycle:{now:()=>clock,wait:async ms=>{clock+=ms;}},uploadSlice:async(_b,s,_p,_r,checkpoint)=>{const r={...s,clipId:'source',status:'complete',stages:{}};await checkpoint(r);return r;},qa:async q=>{
      await mkdir(join(q.directory,'diagnostics'),{recursive:true});const analysis=analyzeBoundaries(source,[]);await writeAnalysis(join(q.directory,'diagnostics'),analysis,source,false);
      return{analysis,gate:{status:'PASS',warnings:[]},qualitySummary:{quality:'PASS',remoteProbeMode:'RANGE',qualityThresholdVersion:QUALITY_THRESHOLDS.version,detectorVersion:QUALITY_THRESHOLDS.detectorVersion}};
    }};
    const result=await runPipeline(parseConfig(['--resume',dir]),deps);
    assert.equal(result.exportStatus.runSuccess,true);assert.equal(result.preprocessedDuration,12);assert.equal(result.clipCount,1);assert.equal(result.downloaded,false);
    const audit=JSON.parse(await readFile(join(dir,'last-render-transport-response.json')));
    assert.equal(audit.response.status,200);assert.equal(audit.response.result.id,'render');assert.equal(audit.requestSummary.export_mode,'fullsong_export');assert.equal(audit.requestSummary.render_engine,'v2');
    assert.equal(JSON.parse(await readFile(join(dir,'run-status.json'))).status,'RUN SUCCESS');
    await runPipeline(parseConfig(['--resume',dir]),deps);
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path==='/api/studio/render-state').length,1);
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path==='/api/studio/save-project').length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
