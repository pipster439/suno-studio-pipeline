import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportModeFor, classifyRenderComparison } from '../suno/audio/export-strategy.mjs';
import { parseConfig } from '../suno/audio/config.mjs';
import { prepareFullSongExport, describeExportRequest, exportCompletionStatus } from '../suno/audio/studio-export.mjs';
import { buildRenderProjectRequest } from '../suno/studio/request-builders.mjs';
import {selectAcknowledgedRender} from '../suno/audio/render-lifecycle.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json',import.meta.url)));
const sequences=JSON.parse(await readFile(new URL('../fixtures/render_materialization_sequences.json',import.meta.url)));
test('page-result default, strict Library default and explicit overrides choose their observed modes',()=>{
  assert.equal(exportModeFor(parseConfig(['input.wav'])['export-strategy']),'rendered_context_window');
  assert.equal(exportModeFor(parseConfig(['input.wav','--require-library'])['export-strategy']),'fullsong_export');
  assert.equal(exportModeFor(parseConfig(['input.wav','--require-library','--export-strategy','verified_legacy_render'])['export-strategy']),'rendered_context_window');
  assert.equal(exportModeFor(parseConfig(['input.wav','--export-strategy','verified_studio_export'])['export-strategy']),'fullsong_export');
  assert.equal(exportModeFor(parseConfig(['input.wav','--export-strategy','experimental_fullsong_export'])['export-strategy']),'fullsong_export');
  assert.throws(()=>parseConfig(['input.wav','--export-strategy','unknown']),/Invalid export/);
  assert.throws(()=>parseConfig(['input.wav','--resume-render-id','known']),/requires --resume/);
});
test('full context request differs only in mode and statically observed source-project field; no guessed identifiers',()=>{
  const saved={id:'version',project_id:'project',state:fixture.state};
  const opts={projectId:'project',versionId:'version',title:'Comparison'};
  const a=prepareFullSongExport(saved,{...opts,exportMode:'fullsong_export'}),b=prepareFullSongExport(saved,{...opts,exportMode:'rendered_context_window'});
  assert.equal(b.preview.body.from_studio_project_id,'project');
  const {export_mode,from_studio_project_id,...rest}=b.preview.body;
  assert.deepEqual({...rest,export_mode:'fullsong_export'},a.preview.body);
  assert.equal(describeExportRequest(a.preview).stateSha256,describeExportRequest(b.preview).stateSha256);
  assert.throws(()=>buildRenderProjectRequest({...b.input,from_studio_project_id:undefined}),/from_studio_project_id/);
});
test('mode/range classifications do not call a timeout permanent disappearance',()=>{
  const context={exportMode:'rendered_context_window',duration:182,fullRange:true,materialized:true};
  const full={exportMode:'fullsong_export',duration:182,fullRange:true,materialized:false};
  assert.equal(classifyRenderComparison([context,full]),'MODE_DEPENDENT_MATERIALIZATION_OBSERVED');
  assert.equal(classifyRenderComparison([context,{...full,terminalFailure:true}]),'EXPORT_MODE_MISMATCH');
  assert.equal(classifyRenderComparison([{...context,duration:90,fullRange:false},{...context,duration:120,materialized:false,terminalFailure:true}]),'DURATION_DEPENDENT_CANDIDATE');
  assert.equal(classifyRenderComparison([{...full}]),'INCONCLUSIVE');
  assert.equal(classifyRenderComparison(sequences.bothLongModesHaveCompletionEvidence),'INCONCLUSIVE');
});
test('materialized account clip without QA delivery is not RUN SUCCESS',()=>{
  const binding={projectId:'project',versionId:'version',startBeats:0,endBeats:356};
  const job={projectId:'project',versionId:'version',renderClipId:'render',renderJobs:[{id:'render',state:'DELIVERY_RESTRICTED',materialization:{status:'complete',binding}}]};
  const status=exportCompletionStatus(job,binding);
  assert.equal(status.renderReady,true);assert.equal(status.deliveryResolved,false);assert.equal(status.runSuccess,false);
  job.renderJobs[0].terminalFailure={status:'error'};
  assert.equal(exportCompletionStatus(job,binding).renderReady,false);
});

test('explicit full-range context recovery retains timeout history and rejects unrelated replacements',()=>{
  assert.equal(classifyRenderComparison(sequences.sameFullRangeRecovery),'MODE_DEPENDENT_MATERIALIZATION_OBSERVED');
  assert.equal(sequences.sameFullRangeRecovery[0].terminalFailure,undefined);
  const binding={projectId:'project',versionId:'version',startBeats:0,endBeats:475.5644081632653};
  const original={id:'timedout-full',state:'TIMEOUT',binding,exportMode:'fullsong_export',submittedAt:'2026-10-07T00:00:00Z'};
  const candidate={id:'ready-context',state:'RENDER_READY',binding,exportMode:'rendered_context_window',submittedAt:'2026-10-07T00:15:00Z'};
  const job={renderClipId:original.id,renderJobs:[original]},experiment={renderJobs:[candidate]};
  selectAcknowledgedRender(job,[job,experiment],candidate.id,binding);
  assert.equal(job.renderClipId,candidate.id);assert.equal(job.exportMode,'rendered_context_window');assert.equal(job.renderJobs[0].state,'TIMEOUT');assert.equal(job.renderJobs.length,2);
  assert.throws(()=>selectAcknowledgedRender(job,[job,experiment],candidate.id,{...binding,endBeats:24}),/not acknowledged/);
  assert.throws(()=>selectAcknowledgedRender(job,[job,experiment],'invented-id',binding),/not acknowledged/);
});
