import test from 'node:test';
import assert from 'node:assert/strict';
import { traceStudioSource } from '../scripts/analyze-studio-write.mjs';
test('write tracing keeps actual imports/call expressions and dynamic references without evaluating them',()=>{
  const source='globalThis.staticExecuted=true; bundle.push([759985,e=>{var api=e.i(140764); function save(){return api.saveProject(client,id,state,title)}; e.s(["saveProjectVersion",0,save],759985); api.POST(`/api/studio/${id}/future`,{body:{state}});}]);';
  const r=traceStudioSource(source);assert.equal(globalThis.staticExecuted,undefined);
  assert.equal(r.modules[0].moduleId,759985);assert.equal(r.modules[0].invocations[0].targetModule,140764);
  assert.equal(r.modules[0].invocations[0].expression,'api.saveProject(client,id,state,title)');
  assert.equal(r.modules[0].exports[0].name,'saveProjectVersion');assert.equal(r.pathReferences[0].recognizedMethod,'POST');
  assert.equal(r.pathReferences[0].expression,'`/api/studio/${id}/future`');
});
test('import aliases do not cross registration modules or function parameter shadows',()=>{
  const r=traceStudioSource('bundle.push([759985,e=>{var m=e.i(140764);function shadow(m){return m.saveProject(x)}m.saveProject(x)},2,e=>{m.saveProject(x)}]);');
  assert.equal(r.modules.length,1);assert.equal(r.modules[0].invocations.length,1);
  assert.equal(r.modules[0].invocations[0].expression,'m.saveProject(x)');
});
