import {mkdir,readFile,writeFile,appendFile}from'node:fs/promises';
import {resolve}from'node:path';
import {randomUUID}from'node:crypto';
import privacy from'../../shared/studio-privacy.cjs';
import {studioStateDiff}from'../studio/state-diff.mjs';
import {comparePredictionToCapture}from'../studio/predictions.mjs';
export const SCENARIOS=Object.freeze({A_CREATE:'创建一个空工程',B_ADD:'添加一段已有 Suno clip',C_SAVE:'保存一次',D_MOVE:'仅移动该 clip',E_SAVE:'保存一次',F_TRANSPOSE:'仅修改 transposition',G_SAVE:'保存一次',H_EXPORT:'单轨导出一次'});
export class StudioValidationHarness{
  constructor(root,{reader,origin='LIVE_CAPTURE'}={}){this.root=resolve(root);this.reader=reader;this.origin=origin;this.active=null;this.controlVersion=0;this.recorder={at:0,pending:0,queued:0,dropped:0,controlVersion:0};this.chain=Promise.resolve();}
  async init(){await mkdir(this.root,{recursive:true});try{const v=JSON.parse(await readFile(resolve(this.root,'control.json'),'utf8'));this.controlVersion=v.controlVersion??0;
    if(v.active){this.active=v.active;const dir=this.safeDirectory(this.active);try{this.events=(await readFile(resolve(dir,'events.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
      catch(e){if(e.code!=='ENOENT')throw e;try{this.events=JSON.parse(await readFile(resolve(dir,'events.json'),'utf8'));}catch{throw Error('active capture evidence missing; preserve directory and investigate');}}}}
    catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  safeDirectory(a){if(!/^[\w-]+$/.test(a.runId)||!SCENARIOS[a.scenario])throw Error('invalid scenario identity');const dir=resolve(this.root,a.runId,a.scenario);if(!dir.startsWith(this.root+'/')&&!dir.startsWith(this.root+'\\'))throw Error('capture escapes root');return dir;}
  async persist(){await writeFile(resolve(this.root,'control.json'),JSON.stringify({controlVersion:this.controlVersion,active:this.active},null,2)+'\n');}
  config(pageId){if(pageId){if(!/^[\w-]{1,100}$/.test(pageId))throw Error('invalid recorder page');if(this.ownerPage&&this.ownerPage!==pageId&&Date.now()-this.recorder.at<6000)return {controlVersion:this.controlVersion,active:null,pageId,ownerConflict:true};this.ownerPage=pageId;}return {controlVersion:this.controlVersion,pageId:this.ownerPage,active:this.active?{captureId:this.active.captureId,scenario:this.active.scenario,startedAt:this.active.startedAt,acceptNew:this.active.phase==='CAPTURING'}:null};}
  status(){return {active:this.active,recorder:{...this.recorder,online:Date.now()-this.recorder.at<6000},armed:!!this.active&&this.recorder.controlVersion===this.controlVersion&&Date.now()-this.recorder.at<6000,scenarios:SCENARIOS,writeDispatches:0};}
  heartbeat(data){if(this.ownerPage&&data.pageId!==this.ownerPage)return {ownerConflict:true};this.recorder={at:Date.now(),pending:Math.max(0,Number(data.pending)||0),queued:Math.max(0,Number(data.queued)||0),dropped:Math.max(0,Number(data.dropped)||0),controlVersion:Number(data.controlVersion)||0,pageCount:1};return this.status();}
  async begin(scenario,options={}){if(this.transition)throw Error('capture lifecycle transition already running');this.transition=true;try{return await this.beginInternal(scenario,options);}finally{this.transition=false;}}
  async beginInternal(scenario,{projectId=null,runId, prediction=null}={}){
    if(!SCENARIOS[scenario])throw Error('unknown A-H scenario');if(this.active)throw Error('finish current scenario first');
    if(projectId!==null&&!/^[A-Za-z0-9_-]+$/.test(projectId))throw Error('real project ID required');
    let before=null,baselineError=null;try{before=projectId?await this.reader.get_project(projectId):null;}catch(e){baselineError={kind:e.kind??'unknown_error',status:e.status??null,message:privacy.sanitize(e.message)};}
    const active={scenario,runId:runId??new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),captureId:randomUUID(),projectId,startedAt:new Date().toISOString(),phase:'CAPTURING',origin:this.origin,initialDropped:this.recorder.dropped,baselineError};
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
    if(this.origin==='LIVE_CAPTURE'&&(!this.ownerPage||event.pageId!==this.ownerPage))return {accepted:false,reason:'unclaimed recorder page'};
    if(!['request','response','beacon','ws','navigation'].includes(event.eventType))throw Error('invalid capture event');
    if(typeof event.eventId!=='string'||!/^[\w-]{1,120}$/.test(event.eventId))throw Error('invalid event correlation');
    if(this.events.some(e=>e.eventId===event.eventId&&e.eventType===event.eventType))return {accepted:true,duplicate:true};
    const started=Date.parse(event.timestamp);if(!Number.isFinite(started))throw Error('timestamp required');
    if(event.eventType!=='response'&&a.cutoff&&started>Date.parse(a.cutoff))return {accepted:false,reason:'capture stopped'};
    if(event.eventType==='response'&&!this.events.some(e=>e.eventId===event.eventId&&e.eventType==='request'))return {accepted:false,reason:'missing request; response cannot move to another scenario'};
    if(event.eventType!=='navigation'){
      const u=new URL(event.request?.url??event.url??this.events.find(r=>r.eventId===event.eventId&&r.eventType==='request')?.request?.url);if(!['https:','wss:'].includes(u.protocol)||u.hostname!=='studio-api-prod.suno.com'||!u.pathname.startsWith('/api/studio/'))throw Error('unrelated host/path rejected');
    }
    const clean=privacy.sanitize(event);if(clean.request?.headers)clean.request.headers=privacy.headers(clean.request.headers);if(clean.response?.headers)clean.response.headers=privacy.headers(clean.response.headers);
    const row={...clean,captureId:a.captureId,scenario:a.scenario,sequence:this.events.length+1,origin:this.origin};
    const dir=this.safeDirectory(a);await appendFile(resolve(dir,'events.ndjson'),JSON.stringify(row)+'\n');this.events.push(row);await writeFile(resolve(dir,'events.json'),JSON.stringify(this.events,null,2)+'\n');return {accepted:true,sequence:row.sequence};
  }
  async end(options={}){if(this.transition)throw Error('capture lifecycle transition already running');this.transition=true;try{return await this.endInternal(options);}finally{this.transition=false;}}
  async endInternal({projectId,drainMs=3000}={}){
    if(!this.active)throw Error('no active scenario');const a=this.active;a.phase='DRAINING';a.cutoff??=new Date().toISOString();this.controlVersion++;await this.persist();
    const deadline=Date.now()+Math.min(10000,Math.max(0,drainMs));
    do{await this.chain;const waiting=this.events.filter(e=>e.eventType==='request'&&!this.events.some(r=>r.eventId===e.eventId&&r.eventType==='response')).length;
      if(waiting===0&&(this.origin!=='LIVE_CAPTURE'||this.recorder.controlVersion===this.controlVersion&&this.recorder.queued===0&&this.recorder.pending===0))break;
      if(Date.now()>=deadline)break;await new Promise(r=>setTimeout(r,50));}while(true);
    await this.chain;
    const records=this.records(),newId=records.find(r=>r.request.method==='POST'&&r.request.path.split('?')[0]==='/api/studio/create-project'&&r.response?.status>=200&&r.response.status<300)?.response?.body?.id;
    const id=projectId??a.projectId??newId;
    if(id!==undefined&&id!==null&&!/^[A-Za-z0-9_-]+$/.test(id))throw Error('real captured project ID required');
    let after=null,version=null;const readErrors=[];
    try{after=id?await this.reader.get_project(id):null;}catch(e){readErrors.push({stage:'project',kind:e.kind??'unknown_error',status:e.status??null,message:privacy.sanitize(e.message)});}
    try{if(after?.latest_version_id)version=await this.reader.get_project_version(after.id,after.latest_version_id);}catch(e){readErrors.push({stage:'version',kind:e.kind??'unknown_error',status:e.status??null,message:privacy.sanitize(e.message)});}
    const dir=this.safeDirectory(a),before=JSON.parse(await readFile(resolve(dir,'before.json'),'utf8')),prediction=JSON.parse(await readFile(resolve(dir,'prediction.json'),'utf8'));
    const observedDiff=before?.state&&after?.state?studioStateDiff(before.state,after.state):{changes:[],notComparable:'project creation or missing baseline'};
    const comparisons={state:prediction?.state&&after?.state?comparePredictionToCapture(prediction.state,after.state,{dynamicPaths:prediction.dynamicPaths??[],captureOrigin:this.origin,readbackConfirmed:!!version}):null,
      request:prediction?.request?comparePredictionToCapture(prediction.request,(()=>{const r=records.find(r=>r.request.method===prediction.request.method&&r.request.path===prediction.request.path)?.request;return r?{method:r.method,path:r.path,body:r.body??null}:{};})(), {captureOrigin:this.origin}):null};
    const incomplete=records.filter(r=>!r.response).length,ack=this.origin!=='LIVE_CAPTURE'||this.recorder.controlVersion===this.controlVersion;
    function omissions(v){if(!v||typeof v!=='object')return 0;return (Object.hasOwn(v,'omitted')?1:0)+Object.values(v).reduce((n,a)=>n+omissions(a),0);}
    const omittedBodies=omissions(this.events),dropped=Math.max(0,this.recorder.dropped-(a.initialDropped??0));
    const pendingAtStop=this.origin==='LIVE_CAPTURE'?this.recorder.pending:0,queuedAtStop=this.origin==='LIVE_CAPTURE'?this.recorder.queued:0;
    const report={scenario:a.scenario,origin:this.origin,captureId:a.captureId,projectId:after?.id??id??null,baselineError:a.baselineError,readErrors,requestCount:records.length,incompleteRequests:incomplete,recorderStopAcknowledged:ack,pendingAtStop,queuedAtStop,dropped,omittedBodies,
      transportCounts:Object.fromEntries(['fetch','xhr','beacon','ws','navigation'].map(k=>[k,this.events.filter(e=>e.source===k||e.eventType===k).length])),
      captureComplete:incomplete===0&&ack&&dropped===0&&omittedBodies===0&&pendingAtStop===0&&queuedAtStop===0,projectReadback:!!after,versionReadback:!!version,projectVersionRelation:version?version.project_id===after.id&&version.id===after.latest_version_id:null,
      stateDiff:observedDiff,comparisons,confidenceUpgradeRecommendation:{humanReviewRequired:true,documentsChanged:false,eligibleForVerified:false,reason:'UI observation and readback do not replace separate controlled reproduction'},writeDispatches:0};
    for(const[name,value]of Object.entries({'after.json':after,'version.json':version,'records.json':records,'report.json':report}))await writeFile(resolve(dir,name),JSON.stringify(privacy.sanitize(value),null,2)+'\n',{flag:'wx'});
    a.phase='FINISHED';await writeFile(resolve(dir,'scenario.json'),JSON.stringify(a,null,2)+'\n',{flag:'wx'});this.active=null;await this.persist();return {runId:a.runId,scenario:a.scenario,report};
  }
  records(){return this.events.filter(e=>e.eventType==='request').map(e=>({requestId:e.eventId,sequence:e.sequence,timestamp:e.timestamp,scenario:e.scenario,origin:e.origin,source:e.source??null,initiator:e.initiator??null,request:e.request,
    response:this.events.find(r=>r.eventId===e.eventId&&r.eventType==='response')?.response??null,durationMs:this.events.find(r=>r.eventId===e.eventId&&r.eventType==='response')?.durationMs??null}));}
  async report(runId,scenario){return JSON.parse(await readFile(resolve(this.safeDirectory({runId,scenario}),'report.json'),'utf8'));}
  async exportScenario(runId,scenario){const dir=this.safeDirectory({runId,scenario}),report=await this.report(runId,scenario),records=JSON.parse(await readFile(resolve(dir,'records.json'),'utf8')),events=JSON.parse(await readFile(resolve(dir,'events.json'),'utf8'));return privacy.evidence({report,records,events});}
}
