import test from 'node:test';
import assert from 'node:assert/strict';
import {LibraryClient} from '../suno/library/client.mjs';
import {verifyLibraryExport,resolveLibraryExport,studioBadgeName} from '../suno/audio/library-export.mjs';
import {exportCompletionStatus} from '../suno/audio/studio-export.mjs';
const owner='11111111-2222-3333-4444-555555555555';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const binding={projectId:'project',versionId:'version',startBeats:0,endBeats:356};
const good={id,title:'same title',status:'complete',entity_type:'song_schema',user_id:owner,
  metadata:{type:'studio_export',model_badges:{songrow:{display_name:'STUDIO'}},studio_project_id:'project',studio_project_version_id:'version',studio_project_start_beats:0,studio_project_end_beats:356}};
test('Library membership uses observed paginated own feed, exact id, never a title or clip GET',async()=>{
  const calls=[];
  const client=new LibraryClient({call:async q=>{calls.push(q);return {result:q.body.cursor===null?
    {has_more:true,clips:[{...good,id:owner}]}:{has_more:false,clips:[good]}};}});
  const result=await client.is_song_in_library(owner,id);
  assert.equal(result.visible,true);assert.equal(result.pagesRead,2);
  assert.equal(calls[1].body.cursor,owner);assert.ok(calls.every(c=>c.method==='POST'&&c.path==='/api/feed/v3'));
});
test('pagination exhaustion proves absence; page cap and repeating cursor remain indeterminate',async()=>{
  let more=false;
  const client=new LibraryClient({call:async()=>({result:{has_more:more,clips:[{...good,id:owner}]}})});
  assert.equal((await client.is_song_in_library(owner,id)).visible,false);
  more=true;assert.equal((await client.is_song_in_library(owner,id,{maxPages:1})).visible,null);
  assert.equal((await client.is_song_in_library(owner,id)).reason,'PAGINATION_INCOMPLETE');
});
test('Studio badge is server metadata; full provenance and membership are separately required',()=>{
  const membership={visible:true,pagesRead:1,song:good};
  assert.equal(studioBadgeName(good),'STUDIO');assert.equal(verifyLibraryExport(membership,binding,id).status,'COMPLETE');
  for(const song of [{...good,id:owner},{...good,status:'queued'},{...good,is_trashed:true},
    {...good,metadata:{...good.metadata,type:'rendered_context_window'}},
    {...good,metadata:{...good.metadata,model_badges:undefined}},
    {...good,metadata:{...good.metadata,studio_project_end_beats:46.8}},
    {...good,metadata:{...good.metadata,studio_project_version_id:'stale'}}])
    assert.equal(verifyLibraryExport({...membership,song},binding,id).status,'INCOMPLETE');
  assert.equal(verifyLibraryExport({visible:false,pagesRead:1},binding,id).reason,'FINAL_LIBRARY_ASSET_NOT_CREATED');
});
test('Library propagation waits without render submission and persists final identity',async()=>{
  let clock=0,reads=0;const saved=[];
  const result=await resolveLibraryExport(null,good,binding,{client:{is_song_in_library:async()=>++reads<3?{visible:false,pagesRead:1}:{visible:true,pagesRead:1,song:good}},now:()=>clock,wait:async ms=>{clock+=ms;},persist:async r=>saved.push(r)});
  assert.equal(result.status,'COMPLETE');assert.equal(reads,3);assert.equal(saved.length,3);
});
test('context assets stop incomplete; formal Library timeout never guesses registration writes',async()=>{
  let clock=0,reads=0;const options={client:{is_song_in_library:async()=>{reads++;return{visible:false,pagesRead:1};}},now:()=>clock,wait:async ms=>{clock+=ms;},timeoutMs:100};
  assert.equal((await resolveLibraryExport(null,{...good,metadata:{...good.metadata,type:'rendered_context_window'}},binding,options)).status,'INCOMPLETE');
  assert.equal(reads,1);
  assert.equal((await resolveLibraryExport(null,good,binding,options)).reason,'FINAL_LIBRARY_ASSET_NOT_CREATED');
});
test('sanitized archived owner cannot select a guessed account or authorize Library completion',async()=>{
  let reads=0;
  const result=await resolveLibraryExport(null,{...good,user_id:'<redacted>'},binding,{client:{is_song_in_library:async()=>{reads++;throw Error('unexpected query');}}});
  assert.equal(reads,0);assert.equal(result.status,'INCOMPLETE');assert.equal(result.membershipDeterminate,false);assert.equal(result.membershipReason,'CURRENT_ACCOUNT_ID_UNAVAILABLE');
});
test('player ready and render id never suffice; verified Library export does not require download authorization',()=>{
  const job={projectId:'project',versionId:'version',renderClipId:id,renderJobs:[{id,state:'READY',delivery:{source:'PLAYER'},materialization:{status:'complete',binding}}],renderLifecycle:{state:'READY',selectedId:id}};
  assert.equal(exportCompletionStatus(job,binding,good).runSuccess,false);
  job.songPage={renderId:id,url:'https://suno.com/song/'+id,accessible:true};
  job.libraryExport=verifyLibraryExport({visible:true,pagesRead:1,song:good},binding,id);
  delete job.renderJobs[0].delivery;job.renderLifecycle.state='RENDER_READY';
  assert.equal(exportCompletionStatus(job,binding,good).runSuccess,true);
  job.renderClipId='another';assert.equal(exportCompletionStatus(job,binding,good).runSuccess,false);
});
