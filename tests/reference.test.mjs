import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import privacy from '../shared/reference-privacy.cjs';
import { ReferenceStore } from '../suno/recorder/reference-store.mjs';
import { planReferenceReplay, replayReference } from '../suno/recorder/reference-replay.mjs';
import { analyze } from '../scripts/analyze-reference.mjs';
class CE extends Event { constructor(name, options) { super(name); this.detail=options.detail; } }
const turn=()=>new Promise(r=>setImmediate(r));
async function waitFor(predicate) { const deadline=performance.now()+1000; while(!predicate()&&performance.now()<deadline) await new Promise(r=>setTimeout(r,1)); assert.ok(predicate(),'observer delivery completed'); }
async function harness(native) {
  const w=new EventTarget(), records=[], intervals=[], changes=[];
  let lastPromise;
  w.Headers=Headers;w.Request=Request;w.FormData=FormData;
  w.fetch=native||function(){ lastPromise=Promise.resolve(new Response(JSON.stringify({project_id:'fixture',token:'PRIVATE_MARKER'}),{headers:{'content-type':'application/json'}}));return lastPromise; };
  class XHR extends EventTarget {
    open() {return 'native-open';} setRequestHeader() {return 'native-header';}
    send() {this.status=200;this.responseText='{"clip_id":"fixture"}';queueMicrotask(()=>this.dispatchEvent(new Event('loadend')));return 'native-send';}
  }
  w.XMLHttpRequest=XHR;
  const sandbox={window:w,unsafeWindow:w,location:{hostname:'sunouploader.site',origin:'https://sunouploader.site',href:'https://sunouploader.site/'},
    document:{documentElement:null,querySelectorAll:()=>[],addEventListener:()=>{}},
    CustomEvent:CE,crypto:webcrypto,performance,URL,URLSearchParams,TextDecoder,Uint8Array,Blob,ArrayBuffer,
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,setInterval:fn=>intervals.push(fn),
    GM_getValue:()=>({base:'http://127.0.0.1:3000',key:'a'.repeat(64),sessionId:'capture-fixture',at:Date.now()}),
    GM_addValueChangeListener:(_k,fn)=>changes.push(fn),GM_xmlhttpRequest:opts=>{records.push({url:opts.url,value:JSON.parse(opts.data)});queueMicrotask(()=>opts.onload({status:200}));}};
  const source=(await Promise.all(['shared/privacy.cjs','shared/reference-privacy.cjs','userscripts/reference-recorder.js'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')))).join('\n');
  vm.runInNewContext(source,sandbox);
  return {w,records,intervals,changes,getLastPromise:()=>lastPromise,events:()=>records.filter(r=>r.url.endsWith('/events')).map(r=>r.value)};
}
test('reference events are passive, correlate out of order, retain duplicates/orphans/cancel and missing status',async()=>{
  const h=await harness(),detail={requestId:'a',path:'/transport-fixture',method:'PATCH',body:{position:3,token:'PRIVATE_MARKER'}};
  const fire=(kind,d)=>h.w.dispatchEvent(new CE('suno-console-upload-'+kind,{detail:d}));
  fire('request',detail);fire('request',{requestId:'b',path:'/transport-fixture',method:'GET'});
  fire('response',{requestId:'b',ok:true,result:{clip_id:'fixture'}});fire('cancel',{requestId:'a'});
  fire('response',{requestId:'a',ok:false,status:499});fire('response',{requestId:'a',ok:false,status:499});
  fire('response',{requestId:'unknown',ok:true,result:{}});
  await waitFor(()=>h.events().length===7);
  assert.equal(detail.body.token,'PRIVATE_MARKER');assert.equal(detail.body.position,3);
  assert.ok(!JSON.stringify(h.events()).includes('PRIVATE_MARKER'));
  const rows=h.events(),b=rows.find(r=>r.kind==='console_response'&&r.requestId==='b');
  assert.equal(b.data.status,null);assert.equal(b.data.statusSupplied,false);assert.equal(b.data.orphan,false);
  const responses=rows.filter(r=>r.kind==='console_response'&&r.requestId==='a');
  assert.equal(responses[0].data.duplicateResponse,false);assert.equal(responses[1].data.duplicateResponse,true);
  assert.equal(rows.at(-1).data.orphan,true);assert.equal(rows[1].data.bodySource,'absent');
  h.changes[0]('',null,{at:Date.now(),sessionId:null});fire('request',{requestId:'stopped'});await turn();assert.equal(h.events().length,7);
});
test('fetch/XHR observation preserves native promise, body, return values and synchronous errors',async()=>{
  const h=await harness();
  const result=h.w.fetch('/api/projects',{method:'POST',body:JSON.stringify({project_id:'fixture',cookie:'PRIVATE_MARKER'}),headers:{authorization:'PRIVATE_MARKER'}});
  assert.equal(result,h.getLastPromise());assert.equal((await (await result).json()).token,'PRIVATE_MARKER');
  const xhr=new h.w.XMLHttpRequest();assert.equal(xhr.open('PUT','/api/projects'),'native-open');
  assert.equal(xhr.setRequestHeader('device-id','PRIVATE_MARKER'),'native-header');assert.equal(xhr.send('{"duration":3}'),'native-send');
  await waitFor(()=>h.events().length===4);assert.ok(!JSON.stringify(h.events()).includes('PRIVATE_MARKER'));
  const error=new Error('native synchronous failure'),f=await harness(()=>{throw error;});
  assert.throws(()=>f.w.fetch('/api/projects'),e=>e===error);
  const blocked=await h.w.fetch('/api/me');await blocked.json();await waitFor(()=>h.events().length===6);
  assert.equal(h.events().at(-1).data.body.omitted,'authentication-account-payment-body');
  await waitFor(()=>{h.intervals[0]();return h.records.at(-1)?.value.pending===0;});
});
test('reference producer -> disk contract keeps business structure and never retains sensitive values',async()=>{
  const h=await harness();h.w.dispatchEvent(new CE('suno-console-upload-request',{detail:{requestId:'contract',path:'/transport-fixture',method:'POST',bodyJson:JSON.stringify({title:'title',major_version:2,project_id:'p',clip_id:'c',offset:0,duration:2,position:3,headers:{'x-opaque':'PRIVATE_MARKER'},url:'https://cdn.example/a?Signature=PRIVATE_MARKER'})}}));
  h.w.dispatchEvent(new CE('suno-console-upload-response',{detail:{requestId:'contract',ok:true,result:{id:'p'}}}));await waitFor(()=>h.events().length===2);
  const dir=await mkdtemp(join(tmpdir(),'suno-reference-contract-'));
  try{
    const store=new ReferenceStore(dir),session=await store.start('contract');
    for(const r of h.events())await store.add({...r,sessionId:session.id});
    assert.equal((await store.add({...h.events()[0],sessionId:session.id})).duplicate,true);
    await store.stop();const names=await readdir(join(dir,session.id,'events'));assert.equal(names.length,2);
    const rows=await Promise.all(names.map(async n=>JSON.parse(await readFile(join(dir,session.id,'events',n),'utf8'))));
    assert.ok(!JSON.stringify(rows).includes('PRIVATE_MARKER'));assert.equal(rows[0].sessionId,undefined);
    assert.equal(rows[0].data.body.position,3);assert.equal(rows[0].data.body.major_version,2);
    assert.equal(rows[0].data.body.headers['x-opaque'],'<redacted>');assert.equal(rows[1].data.status,null);
    assert.equal(privacy.clean({rows:Array.from({length:10001},()=>1)}).omitted,'structure-limit');
    assert.equal(privacy.jsonBody('unstructured secret').omitted,'non-json-body');
  }finally{await rm(dir,{recursive:true,force:true});}
});
const request={kind:'console_request',pageId:'page-fixture',requestId:'id-fixture',data:{method:'POST',path:'/transport-fixture',bodySource:'bodyJson',body:{position:2}}};
const response={kind:'console_response',pageId:request.pageId,requestId:request.requestId,data:{ok:true,status:null,responseStructure:{type:'object'}}};
test('replay plans require unambiguous successful observed Suno intent and exclude missing/sensitive/permission bodies',()=>{
  const plan=planReferenceReplay(request,[request,response]);assert.equal(plan.referenceStatus,null);assert.equal(plan.automaticRetry,false);
  for(const change of [{kind:'backend_request'},{data:{...request.data,method:null}},{data:{...request.data,path:'/api/%62illing/info/'}},{data:{...request.data,path:'/transport-fixture?title=%3Credacted%3E'}},{data:{...request.data,body:{omitted:'size-limit'}}},{data:{...request.data,body:{entitlements:{write:true}}}}]){
    const r={...request,...change};assert.throws(()=>planReferenceReplay(r,[r,response]));
  }
  assert.throws(()=>planReferenceReplay(request,[request,request,response]));
  assert.throws(()=>planReferenceReplay(request,[request,{...response,data:{ok:false,status:403}}]));
  assert.throws(()=>planReferenceReplay(request,[request,response,{...response,kind:'console_cancel'}]));
  for(const body of ['{"permissionLevel":"admin"}', {accountPlan:'paid'}, '{"omitted":"size-limit"}']) {
    const r={...request,data:{...request.data,body}};assert.throws(()=>planReferenceReplay(r,[r,response]));
  }
});
test('replay executes once with fresh id, no credential headers, preserves failures and never marks VERIFIED',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'suno-reference-replay-'));
  try{
    const store=new ReferenceStore(dir),s=await store.start();let seq=0;
    for(const r of [request,response])await store.add({...r,recordId:'rec-'+(++seq),sessionId:s.id,sequence:seq,timestamp:new Date().toISOString(),pageUrl:'https://sunouploader.site/'});
    await store.stop();let calls=0;const bridge={async call(options){calls++;assert.notEqual(options.requestId,request.requestId);assert.equal(options.headers,undefined);return {ok:true,status:200,result:{id:'fixture'}};}};
    assert.equal((await replayReference({root:dir,sessionId:s.id,record:'000001'})).mode,'plan');assert.equal(calls,0);
    const r=await replayReference({root:dir,sessionId:s.id,record:'000001',execute:true,bridge});assert.equal(calls,1);assert.equal(r.stateVerificationPending,true);
    await assert.rejects(replayReference({root:dir,sessionId:s.id,record:'000001',execute:true,bridge:{async call(){calls++;throw new Error('fixture failure');}}}),/fixture failure/);assert.equal(calls,2);
    const receipts=await readdir(join(dir,s.id,'replays'));assert.equal(receipts.length,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('AST anchor analysis resolves lexical shadowing and extracts literal expressions without executing source',()=>{
  const source=`function ex(path,method,body){window.dispatchEvent(new CustomEvent('suno-console-upload-request',{detail:{path,method,body}}));} function upload(id){return ex('/api/uploads/audio/'+id,'POST',{extension:'wav'});} function ui(){const ex=(v)=>v;return ex('/ui-only');}`;
  const r=analyze(source);assert.equal(r.bridgeCalls.length,1);assert.equal(r.bridgeCalls[0].caller,'upload');assert.equal(r.studioLiteralCount,0);assert.equal(r.replayed,false);assert.equal(r.wasmReferences.length,0);
  assert.equal(analyze('throw new Error("MUST_NOT_EXECUTE")').anchorFound,false);
});
