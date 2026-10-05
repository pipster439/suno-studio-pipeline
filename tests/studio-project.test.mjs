import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StudioClient, NotImplementedError } from '../suno/studio/operations.mjs';
import { fullProject } from '../suno/studio/models.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json',import.meta.url),'utf8'));

test('real redacted GET fixture retains full beat timeline, warp registry and version relation through client', async () => {
  const input=structuredClone(fixture); input.state.future_field={nested:['preserve',42]};
  const before=structuredClone(input); let invocation;
  const signal=new AbortController().signal;
  const studio=new StudioClient({call:async(opts,control)=>{invocation={opts,control};return {status:200,result:input};}});
  const value=await studio.get_project(input.id,{requestId:'full-read-fixture',timeoutMs:4000,signal});
  assert.equal(value,input); assert.deepEqual(value,before);
  assert.equal(value.latest_version_id,'e491cbde-9266-4884-997c-3a9789877a56');
  assert.equal(value.state.tracks.length,1);const clips=value.state.tracks[0].clips;assert.equal(clips.length,20);
  for(const clip of clips){assert.equal(clip.transposition,-8);assert.equal(clip.warp.enabled,true);
    assert.equal(clip.asset.type,'clip');assert.equal(clip.asset.id,clip.clipId);assert.ok(clip.endBeats>clip.startBeats);
    assert.ok(Object.hasOwn(value.state.markersRegistry,clip.warp.markersHash));}
  assert.deepEqual(invocation.opts,{method:'GET',path:'/api/studio/project/'+input.id,timeoutMs:4000,requestId:'full-read-fixture'});
  assert.equal(invocation.control.signal,signal);
});
test('full project reader rejects metadata-only/wrong-id state instead of constructing a fake default', async () => {
  for(const value of [{id:fixture.id},{...fixture,id:'wrong'}, {...fixture,state:{tracks:[]}},
    {...fixture,latest_version_id:42}]) assert.throws(()=>fullProject({status:200,result:value},fixture.id),e=>e.kind==='suno_api_error');
  let calls=0;const studio=new StudioClient({call:async()=>{calls++;throw Error('unreachable');}});
  await assert.rejects(studio.get_project('../project'),e=>e.kind==='validation_error');assert.equal(calls,0);
});
test('static save/version/render skeletons never dispatch or mutate supplied timeline',()=>{
  let calls=0;const studio=new StudioClient({call:()=>{calls++;}}),state=structuredClone(fixture.state),before=structuredClone(state);
  for(const method of ['save_project','save_version','export_project','export_multitrack'])assert.throws(()=>studio[method](fixture.id,state),NotImplementedError);
  assert.equal(calls,0);assert.deepEqual(state,before);
});
