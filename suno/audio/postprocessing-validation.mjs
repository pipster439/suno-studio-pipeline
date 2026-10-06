import { deserializeAudioProjectState, serializeAudioProjectState } from '../studio/clip-pipeline.mjs';
import { rawWireState, deserializeEditorState, serializeProjectState } from '../studio/state-boundaries.mjs';
import { semanticDiff } from './timeline.mjs';
import { applySpeedAction } from './warp-derivation.mjs';
import { durableJson } from '../../shared/durable-json.mjs';
import privacy from '../../shared/studio-privacy.cjs';
// API field-isolation evidence only. It deliberately cannot certify UI identity.
export async function controlledStateReadback(client, wire, file) {
  const base=deserializeAudioProjectState(wire);base.tracks=base.tracks.slice(0,1);base.tracks[0].clips=base.tracks[0].clips.slice(0,1);
  const clip=base.tracks[0].clips[0];clip.startBeats=0;clip.readStartBeats=0;clip.transposition=0;clip.amplitude=1;clip.formantCorrection=0;clip.reversed=false;clip.loop.enabled=false;clip.warp.enabled=true;
  const project=await client.create_project({title:'Controlled post-processing API fields (UI unverified)',major_version:2});
  const report={projectId:project.id,uiVerification:'NOT VERIFIED',verificationKind:'save_readback',controls:[]};
  const mutations=[['Loop',c=>{c.loop.enabled=true}],['Reverse',c=>{c.reversed=true}],['Stretch',c=>{c.warp.enabled=false}],['Pitch',c=>{c.transposition=-8}],['Speed',c=>Object.assign(c,applySpeedAction(c,.5))],['Formant',c=>{c.formantCorrection=.5}],['Volume',c=>{c.amplitude=.5}]];
  async function save(state){const w=serializeAudioProjectState(state),editor=deserializeEditorState(rawWireState(w),deserializeAudioProjectState);const saved=await client.save_project({project_id:project.id,title:project.title,state:serializeProjectState(editor,serializeAudioProjectState)});const readback=await client.get_project_version(project.id,saved.version_id);const diff=semanticDiff(w,readback.state);if(diff.changes.length)throw Error('Controlled API field normalized: '+JSON.stringify(diff.changes));return{versionId:saved.version_id,wire:readback.state};}
  const baseline=await save(base);report.baselineVersionId=baseline.versionId;
  for(const [control,mutate] of mutations){const candidate=structuredClone(base);mutate(candidate.tracks[0].clips[0]);const saved=await save(candidate);report.controls.push({control,versionId:saved.versionId,status:'VERIFIED_SAVE_READBACK',uiVerification:'NOT VERIFIED',renderEffect:'NOT VERIFIED by this save-only experiment',changes:semanticDiff(baseline.wire,saved.wire).changes});await durableJson(file,privacy.sanitize(report));}
  report.controls.push({control:'Quantize',status:'NOT VERIFIED',reason:'Transient-dependent warp action; UI edit blocked. No fabricated marker quantization or serialized quantize scalar.'});
  await durableJson(file,privacy.sanitize(report));return report;
}
