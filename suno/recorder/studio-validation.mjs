import {mkdir,readFile,writeFile,appendFile,open}from'node:fs/promises';
import {resolve}from'node:path';
import {randomUUID}from'node:crypto';
import privacy from'../../shared/studio-privacy.cjs';
import protocol from'../../shared/studio-protocol.cjs';
import {durableJson}from'../../shared/durable-json.mjs';
import {studioStateDiff}from'../studio/state-diff.mjs';
import {comparePredictionToCapture}from'../studio/predictions.mjs';
export const SCENARIOS=Object.freeze({A_CREATE:'创建一个空工程',B_ADD:'添加一段已有 Suno clip',C_SAVE:'保存一次',D_MOVE:'仅移动该 clip',E_SAVE:'保存一次',F_TRANSPOSE:'仅修改 transposition',G_SAVE:'保存一次',H_EXPORT:'单轨导出一次'});
const scenarioKnown=s=>s==='READ_SMOKE'||Object.hasOwn(SCENARIOS,s);
export class StudioValidationHarness{
  constructor(root,{reader,origin='LIVE_CAPTURE'}={}){this.root=resolve(root);this.reader=reader;this.origin=origin;this.active=null;this.controlVersion=0;this.recorder={at:0,pending:0,queued:0,dropped:0,controlVersion:0};this.chain=Promise.resolve();this.persistChain=Promise.resolve();this.completedStops={};}
  async init(){await mkdir(this.root,{recursive:true});try{const v=JSON.parse(await readFile(resolve(this.root,'control.json'),'utf8'));this.controlVersion=v.controlVersion??0;this.ownerPage=v.ownerPage??null;this.ownerDocument=v.ownerDocument??null;this.completedStops=v.completedStops??{};
    if(v.active){this.active=v.active;const dir=this.safeDirectory(this.active);try{this.events=(await readFile(resolve(dir,'events.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
      catch(e){if(e.code!=='ENOENT')throw e;try{this.events=JSON.parse(await readFile(resolve(dir,'events.json'),'utf8'));}catch{throw Error('active capture evidence missing; preserve directory and investigate');}}}}
    catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  safeDirectory(a){if(!/^[\w-]+$/.test(a.runId)||!scenarioKnown(a.scenario))throw Error('invalid scenario identity');const dir=resolve(this.root,a.runId,a.scenario);if(!dir.startsWith(this.root+'/')&&!dir.startsWith(this.root+'\\'))throw Error('capture escapes root');return dir;}
  persist(){const task=this.persistChain.then(()=>durableJson(resolve(this.root,'control.json'),{controlVersion:this.controlVersion,active:this.active,ownerPage:this.ownerPage,ownerDocument:this.ownerDocument,completedStops:this.completedStops}));this.persistChain=task.catch(()=>{});return task;}
  config(pageId,documentId){
    if(pageId){if(!/^[\w-]{1,100}$/.test(pageId)||documentId&&!/^[\w-]{1,100}$/.test(documentId))throw Error('invalid recorder page');
      if(this.ownerPage&&this.ownerPage!==pageId)return {controlVersion:this.controlVersion,active:null,pageId,ownerConflict:true,message:'Recorder is owned by another Studio tab'};
      if(this.ownerDocument&&documentId&&this.ownerDocument!==documentId&&this.active&&!this.active.expectedReload&&!this.active.stop){
        this.active.incompleteReasons??=[];this.active.incompleteReasons.push('reload interruption');
      }
      if(this.ownerDocument&&documentId&&this.ownerDocument!==documentId&&this.active?.expectedReload){this.active.expectedReload=false;this.active.resumedDocument=documentId;}
      const changed=this.ownerPage!==pageId||documentId&&this.ownerDocument!==documentId;
      this.ownerPage=pageId;if(documentId)this.ownerDocument=documentId;
      if(changed)this.chain=this.chain.then(()=>this.persist());
    }
    return {controlVersion:this.controlVersion,pageId:this.ownerPage,documentId:this.ownerDocument,active:this.active?{captureId:this.active.captureId,scenario:this.active.scenario,startedAt:this.active.startedAt,acceptNew:this.active.phase==='CAPTURING',stop:this.active.stop?{...this.active.stop,lastSequence:this.events.length}:null}:null};
  }
  async takeOver(pageId,documentId){if(this.active)throw Error('finish or abort the active scenario before explicit Take Over');this.ownerPage=null;this.ownerDocument=null;const c=this.config(pageId,documentId);await this.chain;return c;}
  status(){return {active:this.active,recorder:{...this.recorder,online:Date.now()-this.recorder.at<6000},armed:!!this.active&&this.recorder.controlVersion===this.controlVersion&&Date.now()-this.recorder.at<6000,scenarios:SCENARIOS,writeDispatches:0};}
  heartbeat(data){if(this.ownerPage&&data.pageId!==this.ownerPage||data.documentId&&this.ownerDocument!==data.documentId)return {ownerConflict:true};if(this.active){for(const [condition,reason] of [[data.multipleOwners,'multiple recorder owners'],[Number(data.storageFailures)>(this.active.initialStorageFailures??0),'storage failure'],[Number(data.dropped)>(this.active.initialDropped??0),'dropped queue item']])if(condition&&!this.active.incompleteReasons.includes(reason))this.active.incompleteReasons.push(reason);}if(this.active&&data.versions&&!protocol.compatible(data.versions))this.active.incompleteReasons.push('protocol mismatch');this.recorder={at:Date.now(),pending:Math.max(0,Number(data.pending)||0),queued:Math.max(0,Number(data.queued)||0),dropped:Math.max(0,Number(data.dropped)||0),storageFailures:Math.max(0,Number(data.storageFailures)||0),controlVersion:Number(data.controlVersion)||0,pageCount:1,...(data.versions?{versions:data.versions}:{})};return this.status();}
  async begin(scenario,options={}){if(this.transition)throw Error('capture lifecycle transition already running');this.transition=true;try{return await this.beginInternal(scenario,options);}finally{this.transition=false;}}
  async beginInternal(scenario,{projectId=null,runId, prediction=null}={}){
    if(!scenarioKnown(scenario))throw Error('unknown capture scenario');if(this.active)throw Error('finish current scenario first');
    if(projectId!==null&&!/^[A-Za-z0-9_-]+$/.test(projectId))throw Error('real project ID required');
    let before=null,baselineError=null;try{before=projectId?await this.reader.get_project(projectId):null;}catch(e){baselineError={kind:e.kind??'unknown_error',status:e.status??null,message:privacy.sanitize(e.message)};}
    const active={scenario,runId:runId??new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),captureId:randomUUID(),projectId,startedAt:new Date().toISOString(),phase:'CAPTURING',origin:this.origin,initialDropped:this.recorder.dropped,initialStorageFailures:this.recorder.storageFailures??0,incompleteReasons:[],baselineError};
    const dir=this.safeDirectory(active);await mkdir(dir,{recursive:true});
    // Never replace an existing experiment/evidence directory.
    await writeFile(resolve(dir,'before.json'),JSON.stringify(privacy.sanitize(before),null,2)+'\n',{flag:'wx'});
    await writeFile(resolve(dir,'prediction.json'),JSON.stringify(privacy.sanitize(prediction),null,2)+'\n',{flag:'wx'});
    await writeFile(resolve(dir,'events.json'),'[]\n',{flag:'wx'});
    this.active=active;this.events=[];this.controlVersion++;await this.persist();return {...this.status(),instruction:SCENARIOS[scenario]};
  }
  add(event){const task=this.chain.then(()=>this.accept(event));this.chain=task.catch(()=>{});return task;}
  async accept(event){
    const a=this.active;if(!a||event.captureId!==a.captureId)return {accepted:false,reason:'stale or inactive capture'};
    if(this.origin==='LIVE_CAPTURE'&&(!this.ownerPage||event.pageId!==this.ownerPage)){a.incompleteReasons.push('multiple recorder owners');return {accepted:false,reason:'unclaimed recorder page'};}
    if(!['request','response','beacon','ws','navigation'].includes(event.eventType))throw Error('invalid capture event');
    if(typeof event.eventId!=='string'||!/^[\w-]{1,120}$/.test(event.eventId))throw Error('invalid event correlation');
    if(event.eventType==='navigation'&&event.event==='pagehide'&&event.pending)a.incompleteReasons.push('reload interruption');
    const existing=this.events.find(e=>e.eventId===event.eventId&&e.eventType===event.eventType);if(existing)return {accepted:true,duplicate:true,sequence:existing.sequence};
    if(a.stop?.result?.complete)return event.eventType==='navigation'?{accepted:true,ignored:true,reason:'recorder already stopped'}:{accepted:false,reason:'recorder already stopped'};
    const started=Date.parse(event.timestamp);if(!Number.isFinite(started))throw Error('timestamp required');
    if(!['response','navigation'].includes(event.eventType)&&a.cutoff&&started>Date.parse(a.cutoff))return {accepted:false,reason:'capture stopped'};
    if(event.eventType==='response'&&!this.events.some(e=>e.eventId===event.eventId&&e.eventType==='request'))return {accepted:false,reason:'missing request; response cannot move to another scenario'};
    if(event.eventType==='response'){const req=this.events.find(e=>e.eventId===event.eventId&&e.eventType==='request');if(req.documentId&&event.documentId!==req.documentId){a.incompleteReasons.push('request/response document mismatch');return {accepted:false,reason:'response document mismatch'};}}
    if(event.eventType!=='navigation'){
      const u=new URL(event.request?.url??event.url??this.events.find(r=>r.eventId===event.eventId&&r.eventType==='request')?.request?.url);if(!['https:','wss:'].includes(u.protocol)||u.hostname!=='studio-api-prod.suno.com'||!u.pathname.startsWith('/api/studio/'))throw Error('unrelated host/path rejected');
    }
    const clean=privacy.sanitize(event);if(clean.request?.headers)clean.request.headers=privacy.headers(clean.request.headers);if(clean.response?.headers)clean.response.headers=privacy.headers(clean.response.headers);
    const row={...clean,captureId:a.captureId,scenario:a.scenario,sequence:this.events.length+1,origin:this.origin};
    const dir=this.safeDirectory(a);await appendFile(resolve(dir,'events.ndjson'),JSON.stringify(row)+'\n');this.events.push(row);await writeFile(resolve(dir,'events.json'),JSON.stringify(this.events,null,2)+'\n');return {accepted:true,sequence:row.sequence};
  }
  stopIdentity({captureId,scenario,pageId,requestId}={}){
    const cached=this.completedStops[captureId];const entry=this.active?.captureId===captureId?this.active:cached&&Date.now()-cached.completedAt<86400000?cached:null;
    if(!entry||entry.scenario!==scenario)throw Error('wrong captureId/scenario');
    const owner=entry===this.active?this.ownerPage:entry.stop?.ownerPage??entry.ownerPage;
    if(this.origin==='LIVE_CAPTURE'&&pageId!==owner)throw Error('stop belongs to another recorder owner');
    if(requestId&&requestId!==entry.stop?.requestId)throw Error('wrong stop requestId');return entry;
  }
  async prepareStop(args){
    await this.chain;const entry=this.stopIdentity(args);if(entry.stop){await this.persistChain;return {...entry.stop};}
    if(entry!==this.active)throw Error('completed stop unavailable');
    entry.phase='DRAINING';entry.cutoff??=new Date().toISOString();this.controlVersion++;
    entry.stop={requestId:randomUUID(),captureId:entry.captureId,scenario:entry.scenario,ownerPage:this.ownerPage,controlVersion:this.controlVersion,phase:'STOP_ACCEPTED',acceptedAt:new Date().toISOString()};
    try{await this.persist();return {...entry.stop};}catch(e){entry.incompleteReasons.push('storage failure');throw e;}
  }
  async acknowledgeStop(args){
    const task=this.chain.then(()=>this.acknowledgeStopInternal(args));this.chain=task.catch(()=>{});return task;
  }
  async acknowledgeStopInternal(args){
    const entry=this.stopIdentity(args),stop=entry.stop;if(!stop)throw Error('stop request required');
    if(args.requestId!==stop.requestId)throw Error('wrong stop requestId');
    if(stop.result)return stop.result;
    if(args.phase!=='STOPPED'||args.controlVersion!==stop.controlVersion)throw Error('stop phase/control version mismatch');
    if(this.origin==='LIVE_CAPTURE'&&(args.documentId!==this.ownerDocument||!protocol.compatible(args.versions)))throw Error('stop document/protocol mismatch');
    if(args.pending!==0||args.queued!==0||args.persisted!==true||args.acceptNew!==false||args.finalSequence!==this.events.length)throw Error('stop flush not complete');
    if(args.storageFailures!==0||args.dropped!==(entry.initialDropped??0)||entry.incompleteReasons.some(r=>/storage|dropped|protocol|multiple recorder/.test(r)))throw Error('stop storage/privacy/control failure');
    if(this.records().some(r=>!r.response))throw Error('pending request blocks stop ACK');
    stop.phase='FLUSHING';await this.persist();
    try{const file=await open(resolve(this.safeDirectory(entry),'events.ndjson'),'a');try{await file.sync();}finally{await file.close();}await durableJson(resolve(this.safeDirectory(entry),'events.json'),this.events);
      entry.phase='STOPPED';stop.phase='STOPPED';await this.persist();
      stop.phase='ACKNOWLEDGED';stop.result={ok:true,scenario:entry.scenario,captureId:entry.captureId,requestId:stop.requestId,pending:0,queued:0,dropped:0,storageFailures:0,persisted:true,finalSequence:this.events.length,complete:true,phase:'ACKNOWLEDGED'};
      await this.persist();this.recorder={...this.recorder,pending:0,queued:0};return stop.result;
    }catch(e){stop.result=null;entry.incompleteReasons.push('storage failure');stop.phase='FLUSH_FAILED';throw e;}
  }
  stopResult(args){const entry=this.stopIdentity(args);return entry.stop?.result??{ok:false,scenario:entry.scenario,captureId:entry.captureId,requestId:entry.stop?.requestId,phase:entry.stop?.phase??'STOP_REQUEST_SENT',complete:false};}
  end(options={}){
    const captureId=options.captureId??this.active?.captureId,scenario=options.scenario??this.active?.scenario;
    if(captureId&&this.completedStops[captureId]?.endResult){this.stopIdentity({...options,captureId,scenario,pageId:options.pageId??this.ownerPage});return Promise.resolve(this.completedStops[captureId].endResult);}
    if(this.endFlight){if(this.endFlight.captureId!==captureId)throw Error('capture lifecycle transition already running');return this.endFlight.promise;}
    if(this.transition)throw Error('capture lifecycle transition already running');this.transition=true;
    const promise=this.endInternal({...options,captureId,scenario}).finally(()=>{this.transition=false;this.endFlight=null;});this.endFlight={captureId,promise};return promise;
  }
  async endInternal({projectId,drainMs=3000,captureId,scenario}={}){
    if(!this.active)throw Error('no active scenario');const a=this.active;if(captureId!==a.captureId||scenario!==a.scenario)throw Error('wrong captureId/scenario');await this.prepareStop({captureId:a.captureId,scenario:a.scenario,pageId:this.ownerPage});
    if(this.origin!=='LIVE_CAPTURE'&&!a.stop.result){try{await this.acknowledgeStop({captureId:a.captureId,scenario:a.scenario,pageId:this.ownerPage,requestId:a.stop.requestId,phase:'STOPPED',controlVersion:a.stop.controlVersion,pending:0,queued:0,persisted:true,acceptNew:false,finalSequence:this.events.length,storageFailures:this.recorder.storageFailures??0,dropped:this.recorder.dropped});}catch{ /* Offline gaps still fail completeness. */ }}
    const deadline=Date.now()+Math.min(10000,Math.max(0,drainMs));
    do{await this.chain;const waiting=this.events.filter(e=>e.eventType==='request'&&!this.events.some(r=>r.eventId===e.eventId&&r.eventType==='response')).length;
      if(waiting===0&&a.stop.result?.complete===true)break;
      if(Date.now()>=deadline)break;await new Promise(r=>setTimeout(r,50));}while(true);
    await this.chain;
    const records=this.records(),newId=records.find(r=>r.request.method==='POST'&&r.request.path.split('?')[0]==='/api/studio/create-project'&&r.response?.status>=200&&r.response.status<300)?.response?.body?.id;
    const id=projectId??a.projectId??newId;
    if(id!==undefined&&id!==null&&!/^[A-Za-z0-9_-]+$/.test(id))throw Error('real captured project ID required');
    let after=null,version=null;const readErrors=[];
    try{after=id&&a.scenario!=='READ_SMOKE'?await this.reader.get_project(id):null;}catch(e){readErrors.push({stage:'project',kind:e.kind??'unknown_error',status:e.status??null,message:privacy.sanitize(e.message)});}
    try{if(after?.latest_version_id)version=await this.reader.get_project_version(after.id,after.latest_version_id);}catch(e){readErrors.push({stage:'version',kind:e.kind??'unknown_error',status:e.status??null,message:privacy.sanitize(e.message)});}
    const dir=this.safeDirectory(a),before=JSON.parse(await readFile(resolve(dir,'before.json'),'utf8')),prediction=JSON.parse(await readFile(resolve(dir,'prediction.json'),'utf8'));
    const observedDiff=before?.state&&after?.state?studioStateDiff(before.state,after.state):{changes:[],notComparable:'project creation or missing baseline'};
    const comparisons={state:prediction?.state&&after?.state?comparePredictionToCapture(prediction.state,after.state,{dynamicPaths:prediction.dynamicPaths??[],captureOrigin:this.origin,readbackConfirmed:!!version}):null,
      request:prediction?.request?comparePredictionToCapture(prediction.request,(()=>{const r=records.find(r=>r.request.method===prediction.request.method&&r.request.path===prediction.request.path)?.request;return r?{method:r.method,path:r.path,body:r.body??null}:{};})(), {captureOrigin:this.origin}):null};
    const incomplete=records.filter(r=>!r.response).length,ack=a.stop.result?.complete===true&&a.stop.result.phase==='ACKNOWLEDGED';
    function omissions(v){if(!v||typeof v!=='object')return 0;return (Object.hasOwn(v,'omitted')?1:0)+Object.values(v).reduce((n,a)=>n+omissions(a),0);}
    const omittedBodies=omissions(this.events),dropped=Math.max(0,this.recorder.dropped-(a.initialDropped??0));
    const pendingAtStop=this.origin==='LIVE_CAPTURE'?this.recorder.pending:0,queuedAtStop=this.origin==='LIVE_CAPTURE'?this.recorder.queued:0;
    const responseUnavailable=records.filter(r=>r.response&&(!r.response.status||r.response.error)).length,storageFailures=Math.max(0,(this.recorder.storageFailures??0)-(a.initialStorageFailures??0));
    const incompleteReasons=[...new Set([...(a.incompleteReasons??[]),...(incomplete?['response unavailable']:[]),...(responseUnavailable?['response unavailable']:[]),...(!ack?['stop acknowledgment unavailable']:[]),...(pendingAtStop?['pending request']:[]),...(queuedAtStop?['queued item']:[]),...(dropped?['dropped queue item']:[]),...(omittedBodies?['body timeout/omission']:[]),...(storageFailures?['storage failure']:[])])];
    const report={scenario:a.scenario,origin:this.origin,captureId:a.captureId,projectId:after?.id??id??null,baselineError:a.baselineError,readErrors,requestCount:records.length,incompleteRequests:incomplete,recorderStopAcknowledged:ack,pendingAtStop,queuedAtStop,dropped,omittedBodies,
      transportCounts:Object.fromEntries(['fetch','xhr','beacon','ws','navigation'].map(k=>[k,this.events.filter(e=>e.source===k||e.eventType===k).length])),
      completeness:incompleteReasons.length?'INCOMPLETE':'COMPLETE',incompleteReasons,responseUnavailable,storageFailures,
      captureComplete:ack&&incompleteReasons.length===0,stopRequestId:a.stop.requestId,stopPhase:a.stop.phase,projectReadback:!!after,versionReadback:!!version,projectVersionRelation:version?version.project_id===after.id&&version.id===after.latest_version_id:null,
      stateDiff:observedDiff,comparisons,confidenceUpgradeRecommendation:{humanReviewRequired:true,documentsChanged:false,eligibleForVerified:false,reason:'UI observation and readback do not replace separate controlled reproduction'},writeDispatches:0};
    for(const[name,value]of Object.entries({'after.json':after,'version.json':version,'records.json':records,'report.json':report}))await writeFile(resolve(dir,name),JSON.stringify(privacy.sanitize(value),null,2)+'\n',{flag:'wx'});
    a.phase='FINISHED';await writeFile(resolve(dir,'scenario.json'),JSON.stringify(a,null,2)+'\n',{flag:'wx'});const result={runId:a.runId,scenario:a.scenario,report};this.completedStops[a.captureId]={captureId:a.captureId,scenario:a.scenario,ownerPage:a.stop.ownerPage,stop:a.stop,endResult:result,completedAt:Date.now()};
    this.completedStops=Object.fromEntries(Object.entries(this.completedStops).filter(([,v])=>Date.now()-v.completedAt<86400000).slice(-32));this.active=null;await this.persist();return result;
  }
  records(events=this.events){return events.filter(e=>e.eventType==='request').map(e=>({requestId:e.eventId,probeId:e.probeId??null,documentId:e.documentId??null,sequence:e.sequence,timestamp:e.timestamp,scenario:e.scenario,origin:e.origin,source:e.source??null,initiator:e.initiator??null,request:e.request,
    response:events.find(r=>r.eventId===e.eventId&&r.eventType==='response')?.response??null,durationMs:events.find(r=>r.eventId===e.eventId&&r.eventType==='response')?.durationMs??null}));}
  async report(runId,scenario){return JSON.parse(await readFile(resolve(this.safeDirectory({runId,scenario}),'report.json'),'utf8'));}
  async exportScenario(runId,scenario){const dir=this.safeDirectory({runId,scenario}),report=await this.report(runId,scenario),records=JSON.parse(await readFile(resolve(dir,'records.json'),'utf8')),events=JSON.parse(await readFile(resolve(dir,'events.json'),'utf8'));return privacy.evidence({report,records,events});}
}
