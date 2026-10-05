import {mkdir,readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';import{randomUUID,createHash}from'node:crypto';
import protocol from'../../shared/studio-protocol.cjs';import privacy from'../../shared/studio-privacy.cjs';import{archiveEvidence,scanEvidenceText}from'../../shared/evidence-zip.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(protocol.canonical(v))).digest('hex');
export class BrowserReadSmoke{
  constructor({root,harness,baseline,output,origin='LIVE_CAPTURE'}){this.root=resolve(root);this.harness=harness;this.baseline=baseline;this.output=resolve(output);this.origin=origin;this.current=null;}
  async init(){await mkdir(this.root,{recursive:true});try{this.current=JSON.parse(await readFile(resolve(this.root,'smoke-control.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  async persist(){await writeFile(resolve(this.root,'smoke-control.json'),JSON.stringify(this.current,null,2)+'\n');}
  handshake(auth){return {...protocol.versions,productEntitlement:'FREE',writeGuard:'LOCKED',liveValidationBlockedReason:'PRODUCT_ENTITLEMENT',compatible:protocol.compatible({...protocol.versions,...auth}),authReady:auth?.ready===true};}
  async start(args){if(this.starting||this.finishing)throw Error('read smoke lifecycle transition active');this.starting=true;try{return await this.startInternal(args);}finally{this.starting=false;}}
  async startInternal({pageId,documentId,versions,auth,browser,tabIdentityReliable,popupAvailable}){
    if(this.current&&!this.current.finished)throw Error('read smoke already active; resume or cancel, do not overwrite evidence');
    const config=this.harness.config(pageId,documentId),handshake=this.handshake({controllerVersion:versions?.controllerVersion,harnessVersion:versions?.harnessVersion,userscriptVersion:auth?.userscriptVersion,captureProtocolVersion:auth?.captureProtocolVersion,ready:auth?.ready});
    const blockers=[...(config.ownerConflict?['Recorder is owned by another Studio tab']:[]),...(!handshake.compatible?['SELF TEST BLOCKED: Controller restart/update required']:[]),...(!auth?.ready||!auth?.nativeReadAdapter?['Auth bridge not ready / native read adapter unavailable']:[]),...(!tabIdentityReliable?['reliable tab identity unavailable']:[]),...(!browser?.window||browser.node?['real browser runtime unavailable']:[]),...(!this.baseline?.state?['original lossless baseline unavailable']:[])];
    if(this.baseline&&(this.baseline.id!==protocol.projectId||this.baseline.latest_version_id!==protocol.versionId))blockers.push('owned fixture relation mismatch');
    const runId='read-'+Date.now()+'-'+randomUUID().slice(0,8);
    this.current={runId,pageId,documentId,initialDocument:documentId,handshake,browser:{window:browser?.window===true,node:browser?.node===true},popupAvailable:popupAvailable===true,
      steps:{},phase:blockers.length?'BLOCKED':'CAPTURING',blockers,finished:false,origin:this.origin,leaseProof:false,createdAt:new Date().toISOString()};
    if(blockers.length){await this.persist();return await this.finish({pageId,blocked:true});}
    const b=await this.harness.begin('READ_SMOKE',{runId});this.current.captureId=b.active.captureId;await this.persist();return this.status();
  }
  status(){return this.current?{runId:this.current.runId,phase:this.current.phase,finished:this.current.finished,initialDocument:this.current.initialDocument,leaseProof:this.current.leaseProof,blockers:this.current.blockers,result:this.current.result??null}:null;}
  owned(pageId){if(!this.current||this.current.pageId!==pageId)throw Error('only the recorder owner can control its read smoke');}
  async step({pageId,documentId,step,result}){
    this.owned(pageId);const run=this.current;if(run.finished)throw Error('read smoke finished');
    if(this.finishing)throw Error('read smoke finishing');
    if(!['FETCH','XHR','RELOAD_READY','RESUMED_FETCH','SPA','LEASE'].includes(step))throw Error('unknown read-only step');
    if(step==='RELOAD_READY'){
      if(!run.steps.FETCH||!run.steps.XHR||this.harness.recorder.pending||this.harness.recorder.queued)throw Error('drain fetch/XHR before reload');
      run.phase='AWAIT_RELOAD';this.harness.active.expectedReload=true;await this.harness.persist();
    }else if(step==='SPA'){run.spaObserved=result?.supported===true;}
    else if(step==='LEASE'){run.leaseProof=result?.blocked===true&&this.harness.ownerPage===pageId&&this.blockedPage&&this.blockedPage!==pageId;}
    else{
      if(!result||!['fetch','xhr'].includes(result.transport))throw Error('native read proof required');
      if(step==='FETCH'&&(run.phase!=='CAPTURING'||run.steps.FETCH)||step==='XHR'&&(!run.steps.FETCH||run.phase!=='CAPTURING'||run.steps.XHR)||step==='RESUMED_FETCH'&&run.steps.RESUMED_FETCH)throw Error('read proof sequence mismatch');
      if(step!=='RESUMED_FETCH'&&documentId!==run.initialDocument)throw Error('initial document proof required');
      if(Object.values(run.steps).some(p=>p.requestId===result.requestId))throw Error('unique read probe ID required');
      if(step==='RESUMED_FETCH'){if(run.phase!=='AWAIT_RELOAD'||documentId===run.initialDocument)throw Error('a new document after reload is required');run.reloadObserved=true;run.documentId=documentId;run.phase='RESUMED';}
      run.steps[step]=Object.fromEntries(['requestId','ok','status','transport','statePresent','projectId','versionId','rawStateDigest','transportStateDigest','maskedStatePaths','losslessWithinBrowser'].filter(k=>Object.hasOwn(result,k)).map(k=>[k,privacy.sanitize(result[k])]));
      run.steps[step].documentId=documentId;
    }
    await this.persist();return this.status();
  }
  observeBlockedPage(pageId){if(pageId&&pageId!==this.harness.ownerPage)this.blockedPage=pageId;}
  async leaseProof({pageId,runId}){if(!this.current||this.current.finished||runId!==this.current.runId||pageId!==this.blockedPage||pageId===this.current.pageId)throw Error('second tab rejection evidence required');this.current.leaseProof=true;await this.persist();return {blocked:true,ownerChanged:false};}
  async cancel(pageId){this.owned(pageId);this.current.blockers.push('self test cancelled / reload interruption');return this.finish({pageId});}
  async finish({pageId,blocked=false}){
    if(this.starting&&!blocked)throw Error('read smoke starting; wait for capture handshake');
    this.owned(pageId);if(this.finishing)return this.finishing;
    this.finishing=this.finishInternal({pageId,blocked});try{return await this.finishing;}finally{this.finishing=null;}
  }
  async finishInternal({pageId,blocked=false}){
    this.owned(pageId);const run=this.current;if(run.finished)return run.result;
    let capture={captureComplete:false,completeness:'INCOMPLETE',incompleteReasons:run.blockers,requestCount:0},records=[],events=[];
    if(!blocked&&this.harness.active){const r=await this.harness.end({drainMs:this.origin==='LIVE_CAPTURE'?5000:0});capture=r.report;records=this.harness.records();events=this.harness.events;}
    const expected=this.baseline?.state?digest(this.baseline.state):null,checks=[];
    for(const name of ['FETCH','XHR','RESUMED_FETCH']){
      const proof=run.steps[name],matches=proof?records.filter(r=>r.probeId===proof.requestId):[],record=matches.length===1?matches[0]:null;
      const state=record?.response?.body?.state,actual=state?digest(state):null,masked=state?protocol.maskedPaths(state):['state unavailable'];
      checks.push({step:name,requestCaptured:!!record,responseCaptured:!!record?.response,requestResponseCorrelated:!!record?.requestId&&!!record?.response,
        httpStatus:record?.response?.status??null,source:record?.source??null,ownedRequest:record?.request?.method==='GET'&&record?.request?.path===protocol.versionPath,
        statePresence:!!state,actualStateDigest:actual,expectedStateDigest:expected,rawBrowserDigest:proof?.rawStateDigest??null,
        maskedStatePaths:masked,losslessState:!!state&&actual===expected&&proof?.rawStateDigest===expected&&proof?.transportStateDigest===expected&&proof?.losslessWithinBrowser===true&&masked.length===0,
        relation:record?.response?.body?.project_id===protocol.projectId&&record?.response?.body?.id===protocol.versionId,
        proofValid:proof?.ok===true&&proof?.status===200&&proof?.statePresent===true&&proof?.projectId===protocol.projectId&&proof?.versionId===protocol.versionId&&record?.documentId===proof?.documentId&&proof?.transport===record?.source&&Array.isArray(proof?.maskedStatePaths)&&proof.maskedStatePaths.length===0});
    }
    const writes=Object.fromEntries(['POST','PUT','PATCH','DELETE'].map(m=>[m,records.filter(r=>r.request.method===m).length]));
    const privacyPassed=Object.values(scanEvidenceText(JSON.stringify(records))).every(v=>!v)&&records.every(r=>Object.keys(r.request.headers??{}).every(k=>!/authorization|cookie|token|device/i.test(k)));
    const navigation=events.filter(e=>e.eventType==='navigation'),reload=run.reloadObserved===true&&navigation.some(e=>e.event==='pagehide'&&!e.pending),spa=run.spaObserved===true&&navigation.some(e=>e.event==='spa-replaceState');
    const nativeSources=checks[0].source==='fetch'&&checks[1].source==='xhr'&&checks[2].source==='fetch';
    const readPassed=checks.every(c=>c.requestCaptured&&c.responseCaptured&&c.requestResponseCorrelated&&c.httpStatus===200&&c.ownedRequest&&c.losslessState&&c.relation&&c.proofValid);
    const reasons=[...new Set([...(capture.incompleteReasons??[]),...run.blockers,...(!run.handshake.compatible?['protocol mismatch']:[]),...(!reload?['reload persistence unproven']:[]),...(!spa?['SPA persistence unproven']:[]),...(!run.leaseProof?['one-tab lease browser proof unavailable']:[]),...(!nativeSources?['fetch/XHR sources incomplete']:[]),...(!readPassed?['response/state verification unavailable']:[]),...(!privacyPassed?['privacy audit failed']:[]),...(Object.values(writes).some(Boolean)?['Studio write observed']:[])])];
    const complete=capture.captureComplete&&reasons.length===0,realBrowser=this.origin==='LIVE_CAPTURE'&&run.browser.window&&!run.browser.node;
    const summary={origin:this.origin,realBrowser,requestCaptured:checks.every(c=>c.requestCaptured),responseCaptured:checks.every(c=>c.responseCaptured),requestResponseCorrelated:checks.every(c=>c.requestResponseCorrelated),httpStatus:readPassed?200:null,
      maskedStatePaths:[...new Set(checks.flatMap(c=>c.maskedStatePaths))],losslessState:readPassed,verificationPassed:complete&&realBrowser,harnessBrowserLiveVerified:complete&&realBrowser,
      captureCompleteness:complete?'COMPLETE':'INCOMPLETE',reloadPersistence:reload,spaNavigationPersistence:spa,spaScope:'same-path fragment history.replaceState and restoration; not arbitrary application route transition',oneTabLeaseVerified:run.leaseProof,
      realStudioPOST:writes.POST,realStudioPUT:writes.PUT,realStudioPATCH:writes.PATCH,realStudioDELETE:writes.DELETE,controllerStudioWriteDispatches:0,writeGuard:'LOCKED',studioWriteValidation:'BLOCKED_BY_PRODUCT_ENTITLEMENT',productEntitlement:'FREE',endpointUnlocks:0,entitlementBypass:0,blockers:reasons};
    const handshake={...run.handshake,authBridge:run.handshake.authReady?'READY':'NOT_READY'},completeness={status:summary.captureCompleteness,verificationPassed:summary.verificationPassed,reasons,capture};
    const artifacts={'browser_smoke_summary.json':summary,'protocol_handshake.json':handshake,'capture_completeness.json':completeness,
      'read_request_response_summary.json':{checks,requestCount:records.length,rawPayloadsPackaged:false},'lossless_state_check.json':{expectedStateDigest:expected,checks:checks.map(c=>({step:c.step,statePresence:c.statePresence,actualStateDigest:c.actualStateDigest,rawBrowserDigest:c.rawBrowserDigest,maskedStatePaths:c.maskedStatePaths,losslessState:c.losslessState,relation:c.relation})),timeSignatureChangesPreserved:checks.every(c=>c.losslessState)},
      'privacy_audit.json':{passed:privacyPassed,realCredentialsPackaged:false,displayValuesPackaged:false,privateAccountDataPackaged:false},'write_dispatch_audit.json':{...writes,controllerWrites:0,dispatchAllowed:false,endpointUnlocks:0,entitlementBypass:0},
      'panel_summary.json':{defaultCollapsed:true,labels:['Controller','Harness','Auth Bridge','Userscript Version','Protocol Version','Current scenario','Captured requests','Pending','Dropped','Privacy status','STUDIO WRITES LOCKED','WRITE VALIDATION BLOCKED BY PRODUCT ENTITLEMENT'],productEntitlement:'FREE'},
      'sdk_status.json':{readEvidence:'VERIFIED (prior evidence unchanged)',writeEvidence:'FOUND_STATICALLY',dispatchAllowed:false,liveValidationBlockedReason:'PRODUCT_ENTITLEMENT',offlineRehearsal:'AVAILABLE',liveWriteValidation:'UNAVAILABLE',harnessBrowserLiveVerified:summary.harnessBrowserLiveVerified}};
    const handoff=`# Codex live validation handoff\n\nBrowser Harness: ${summary.harnessBrowserLiveVerified?'LIVE VERIFIED':'NOT VERIFIED'}\nRead Transport: ${readPassed?'LOSSLESS':'NOT LOSSLESS'}\nStudio Write Validation: BLOCKED_BY_PRODUCT_ENTITLEMENT\nWrite Dispatch: LOCKED\nProduct entitlement: FREE (user-confirmed; no entitlement query or modification)\nNext action requiring entitlement: CREATE → ADD → SAVE → MOVE → SAVE → TRANSPOSE → SAVE → EXPORT\n\nOrigin: ${this.origin}. Browser live verification is never inferred from simulated tests.\nCompleteness: ${summary.captureCompleteness}. ${reasons.join('; ')}\n`;
    artifacts['CODEX_LIVE_VALIDATION_HANDOFF.md']=handoff;
    artifacts['REPORT.md']=`# Browser readonly self-test\n\n${handoff}\n\nOwned-version GET only, three native probes (fetch/XHR/reload fetch); no guessed ID, no Studio write dispatch or endpoint unlock.\nLossless state includes all unknown fields and timeSignatureChanges, canonical digest includes display fields. No raw response or private identifiers packaged.\nSPA proof is a supported history fragment replacement/restoration, not a claim of arbitrary router transitions. Popup-blocked lease probe or interrupted reload is INCOMPLETE.\n`;
    artifacts['TESTS.txt']=`Browser self-test origin: ${this.origin}\nVerification passed: ${summary.verificationPassed}\nNative request checks: ${JSON.stringify(checks.map(c=>({step:c.step,status:c.httpStatus,source:c.source,lossless:c.losslessState})))}\nWrite counts: ${JSON.stringify(writes)}\nLocal unit-test totals are provided by the development evidence, not invented here.\n`;
    const dir=resolve(this.root,run.runId);await mkdir(dir,{recursive:true});for(const[k,v]of Object.entries(artifacts))artifacts[k]=typeof v==='string'?v:privacy.evidence(v);
    const archive=await archiveEvidence({staging:resolve(dir,'export-staging'),output:resolve(this.output,run.runId),name:'SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip',files:artifacts,metadata:{runKind:'READ_SMOKE',origin:this.origin,verificationPassed:summary.verificationPassed,baselineDigest:expected,credentialsIncluded:false}});
    run.finished=true;run.phase='FINISHED';run.result={...summary,runId:run.runId,archivePath:archive.path,archiveSha256:archive.sha256};await this.persist();await writeFile(resolve(dir,'result.json'),JSON.stringify(run.result,null,2)+'\n',{flag:'wx'});return run.result;
  }
}
