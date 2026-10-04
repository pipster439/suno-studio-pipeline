import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeStudio,analyzeManifest } from '../scripts/analyze-studio.mjs';
test('official source extraction never evaluates code, keeps exact construction and UTF-8 offsets',()=>{
  const source='globalThis.executed=true; const 标题="中文"; async function save(c,id,state,title){return c.POST("/api/studio/save-project",{body:{project_id:id,state,title}})}; const unused="/api/studio/render-state"; c.GET("/transport-fixture");';
  const result=analyzeStudio(source);assert.equal(globalThis.executed,undefined);
  assert.equal(result.calls.length,1);const c=result.calls[0];assert.equal(c.path,'/api/studio/save-project');
  assert.equal(c.bodyExpression,'{project_id:id,state,title}');assert.equal(c.caller,'save');
  assert.equal(c.byteOffset,Buffer.byteLength(source.slice(0,c.offset)));assert.ok(c.byteOffset>c.offset);
  assert.equal(c.verified,false);assert.equal(c.evidence,'STATIC_CLIENT');
});
test('manifest acquisition identity rejects changed bytes and escaping/foreign assets',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-static-'));
  try {
    const source='api.GET("/api/studio/project/{project_id}",{params:{path:{project_id:id}}});';
    await writeFile(join(dir,'chunk.js'),source);const row={name:'chunk.js',url:'https://suno.com/_next/static/immutable/chunks/chunk.js',sha256:createHash('sha256').update(source).digest('hex')};
    const path=join(dir,'manifest.json');await writeFile(path,JSON.stringify({rows:[row]}));
    assert.equal((await analyzeManifest(path)).calls.length,1);
    await writeFile(join(dir,'chunk.js'),source+' ');await assert.rejects(analyzeManifest(path),/hash mismatch/);
    for(const value of [{...row,name:'../chunk.js'},{...row,url:'https://example.com/chunk.js'},{...row,url:row.url+'?token=PRIVATE_MARKER'},{...row,url:row.url.replace('/chunk.js','/different.js')}]){await writeFile(path,JSON.stringify({rows:[value]}));await assert.rejects(analyzeManifest(path),/observed public chunk/);}
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('export aliases remain inside their module and never label nested shadowed helpers',()=>{
  const source='bundle.push([1,e=>{function a(c){return c.POST("/api/studio/save-project",{body:{state}})}function other(){function a(c){return c.GET("/api/studio/project/{project_id}")}return a}e.s(["saveProject",0,a]);},2,e=>{function a(c){return c.GET("/api/studio/project/{project_id}")}e.s(["fetchProjectById",0,a]);}]);';
  const calls=analyzeStudio(source).calls;assert.equal(calls.length,3);
  assert.deepEqual(calls.map(c=>c.exportNames),[['saveProject'],[],['fetchProjectById']]);
  assert.deepEqual(calls.map(c=>c.moduleId),[1,1,2]);
});
test('mixed getter and constant export records do not shift later names',()=>{
  const source='bundle.push([1,e=>{function a(c){return c.POST("/api/studio/save-project",{body:{state}})} e.s(["ArrangementType",()=>type,"saveProject",0,a,"createAudioTrack",()=>track],99);}]);';
  const result=analyzeStudio(source);assert.deepEqual(result.calls[0].exportNames,['saveProject']);
  const track=result.exports.find(e=>e.name==='createAudioTrack');assert.equal(track.binding,'track');assert.equal(track.moduleId,99);
});
