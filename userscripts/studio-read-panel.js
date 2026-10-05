// Tampermonkey sandbox helper; no credential/config object is exposed to the page.
function mountStudioReadPanel(runtime){
  if(typeof document==='undefined'||!document.createElement)return null;
  const {page,gm,sync,stopScenario,exportEvidence,status,identityReady}=runtime;let busy=false,details,output,startButton,takeButton,exportButton,lastResult=null;
  const compatibleHandshake=(control,auth)=>StudioProtocol.compatible(control)&&auth?.userscriptVersion===StudioProtocol.versions.userscriptVersion&&auth?.captureProtocolVersion===StudioProtocol.versions.captureProtocolVersion;
  const mount=()=>{if(details||!document.body)return;const host=document.createElement('div');host.id='suno-studio-validation-panel';host.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647';
    const shadow=host.attachShadow({mode:'closed'}),style=document.createElement('style');style.textContent='details{font:12px system-ui;color:#eee;background:#202124;border:1px solid #888;border-radius:8px;max-width:420px;max-height:70vh;overflow:auto;padding:8px}summary{cursor:pointer}pre{white-space:pre-wrap;word-break:break-word}button{margin:4px;padding:6px}b{color:#ffbd74}';shadow.append(style);
    details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Studio Validation · READ ONLY';details.append(summary);
    const lock=document.createElement('b');lock.textContent='STUDIO WRITES LOCKED\nWRITE VALIDATION BLOCKED BY PRODUCT ENTITLEMENT';lock.style.whiteSpace='pre-wrap';details.append(lock);
    output=document.createElement('pre');details.append(output);startButton=document.createElement('button');startButton.textContent='Run Read-Only Self Test';startButton.addEventListener('click',()=>{
      if(busy)return;const popup=page.open?.('about:blank','_blank');void run({popup});});details.append(startButton);
    takeButton=document.createElement('button');takeButton.textContent='Take Over（显式接管）';takeButton.addEventListener('click',async()=>{const s=status();try{await gm('/api/browser-read/take-over',{pageId:s.pageId,documentId:s.documentId});await sync();}catch{output.textContent+='\n无法接管：保留当前 evidence，检查 controller';}});details.append(takeButton);
    const cancel=document.createElement('button');cancel.textContent='Stop / mark INCOMPLETE';cancel.addEventListener('click',async()=>{try{const r=await gm('/api/browser-read/cancel',{pageId:status().pageId});GM_setValue('studioRead:resume',null);output.textContent=JSON.stringify(r,null,2);}catch{output.textContent+='\nCAPTURE INCOMPLETE';}});details.append(cancel);
    exportButton=document.createElement('button');exportButton.textContent='Export Evidence';exportButton.addEventListener('click',async()=>{try{await exportEvidence();}catch{output.textContent+='\nEvidence export unavailable; local archive retained';}});details.append(exportButton);shadow.append(details);document.body.append(host);update();};
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
  function update(){mount();if(!output)return;const s=status(),c=s.control,compatible=compatibleHandshake(c,s.auth);
    output.textContent=['Controller: '+(c.connectionError?'OFFLINE / UPDATE REQUIRED':c.controllerVersion??'OFFLINE / UPDATE REQUIRED'),'Harness: 1.1.1','Auth Bridge: '+(s.auth.ready?'READY':'NOT READY'),
      'Userscript Version: '+(s.auth.userscriptVersion??page.__SUNO_CONSOLE_AUTH_SYNC_ACTIVE__?.version??'UNKNOWN'),'Protocol Version: '+(c.captureProtocolVersion??'UNKNOWN'),
      'Write Guard: LOCKED','Product entitlement: FREE / STUDIO WRITE BLOCKED','A-H: BLOCKED_BY_PRODUCT_ENTITLEMENT · offline rehearsal available',
      'Current scenario: '+(c.active?.scenario??'IDLE'),'Captured requests: '+(c.capturedRequests??0),'Pending: '+s.pending,'Queued: '+s.queued,'Dropped: '+s.dropped,
      'Privacy status: '+(s.storageFailures?'CAPTURE INCOMPLETE / storage failure':'FILTER ACTIVE'),
      ...(c.ownerConflict?['Recorder is owned by another Studio tab']:[]),...(c.connectionError?[c.connectionError]:[]),...(!compatible?['SELF TEST BLOCKED · Controller restart/update required']:[]),
      ...(lastResult?[JSON.stringify(lastResult,null,2)]:[])].join('\n');
    startButton.disabled=busy||c.ownerConflict||!compatible||!s.auth.ready||!!c.connectionError||page.__STUDIO_VALIDATION_HOOKS__?.multipleOwners===true;takeButton.hidden=!c.ownerConflict||page.__STUDIO_VALIDATION_HOOKS__?.multipleOwners===true;
    exportButton.disabled=busy||(!lastResult?.archivePath&&!c.readSmoke?.finished);
  }
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function finishScenario(saved){
    const s=status();GM_setValue('studioRead:resume',{...saved,phase:'STOP_REQUEST_SENT'});
    const ack=await stopScenario({captureId:saved.captureId,scenario:'READ_SMOKE'});
    GM_setValue('studioRead:resume',{...saved,phase:'STOPPED'});
    for(let i=0;i<3;i++){try{return await gm('/api/browser-read/finish',{pageId:s.pageId,captureId:saved.captureId,scenario:'READ_SMOKE',stopRequestId:ack.requestId});}catch{await sync();const result=status().control.readSmoke;if(result?.runId===saved.runId&&result.finished)return result.result;await wait(200);}}
    throw Error('finish reply unavailable; persisted stop result retained');
  }
  async function idle(){for(let i=0;i<100;i++){await sync();const s=status();if(s.control.ownerConflict)throw Error('Recorder is owned by another Studio tab');if(!s.pending&&!s.queued&&s.control.active?.scenario==='READ_SMOKE')return;await wait(100);}throw Error('CAPTURE INCOMPLETE: recorder did not drain');}
  async function probe(transport){const requestId=crypto.randomUUID();const result=await new Promise((yes,no)=>{const timer=setTimeout(()=>{page.removeEventListener('suno-studio-read-response',handler);no(Error('response unavailable'));},35000);
    function handler(e){if(e.detail?.requestId!==requestId)return;clearTimeout(timer);page.removeEventListener('suno-studio-read-response',handler);yes(e.detail);}
    page.addEventListener('suno-studio-read-response',handler);page.dispatchEvent(new CustomEvent('suno-studio-read-request',{detail:{requestId,method:'GET',path:StudioProtocol.versionPath,transport}}));});
    await idle();const s=status();await gm('/api/browser-read/step',{pageId:s.pageId,documentId:s.documentId,step:transport==='xhr'?'XHR':GM_getValue('studioRead:resume',null)?.phase==='AFTER_RELOAD'?'RESUMED_FETCH':'FETCH',result});
    if(!result.ok)throw Error('native read unavailable; no retry or write fallback');return result;
  }
  async function run({popup,resume=false}={}){
    if(busy)return;busy=true;try{await identityReady;await sync();let s=status();
      if(!resume){const v=await gm('/api/browser-read/start',{pageId:s.pageId,documentId:s.documentId,versions:{controllerVersion:s.control.controllerVersion,captureProtocolVersion:s.control.captureProtocolVersion,harnessVersion:'1.1.1',userscriptVersion:s.auth.userscriptVersion},auth:s.auth,
        tabIdentityReliable:s.tabIdentityReliable,browser:{window:typeof page.document==='object',node:typeof process!=='undefined'&&!!process.versions?.node},popupAvailable:!!popup});
        if(v.finished||v.verificationPassed===false){lastResult=v;popup?.close();return;}
        GM_setValue('studioRead:resume',{runId:v.runId,captureId:v.captureId,pageId:s.pageId,documentId:s.documentId,phase:'BEFORE_RELOAD'});
        if(popup)popup.location.href='https://suno.com/#studio-harness-lease-probe='+v.runId;
        await sync();await idle();await probe('fetch');await probe('xhr');
        // Give the test-owned secondary tab time to report the rejected lease.
        for(let i=0;i<100;i++){const live=await gm('/api/browser-read/status');if(live.readSmoke?.leaseProof)break;await wait(100);}
        s=status();await gm('/api/browser-read/step',{pageId:s.pageId,documentId:s.documentId,step:'RELOAD_READY'});
        GM_setValue('studioRead:resume',{runId:v.runId,captureId:v.captureId,pageId:s.pageId,documentId:s.documentId,phase:'AFTER_RELOAD'});
        details.open=true;lastResult={status:'Reloading safely; scenario persisted'};update();page.location.reload();return;
      }
      const saved=GM_getValue('studioRead:resume',null);if(!saved||saved.pageId!==s.pageId||saved.documentId===s.documentId)throw Error('reload continuation unavailable');
      if(!compatibleHandshake(s.control,s.auth))throw Error('protocol mismatch after reload');
      if(['STOP_REQUEST_SENT','STOPPED'].includes(saved.phase)){lastResult=await finishScenario(saved);GM_setValue('studioRead:resume',null);details.open=true;return;}
      await idle();const previous=page.location.href,next=new URL(previous);next.hash='studio-read-smoke';page.history.replaceState(page.history.state,'',next.href);page.history.replaceState(page.history.state,'',previous);
      await idle();await gm('/api/browser-read/step',{pageId:s.pageId,documentId:s.documentId,step:'SPA',result:{supported:true}});await probe('fetch');await idle();
      lastResult=await finishScenario(saved);GM_setValue('studioRead:resume',null);details.open=true;
    }catch(e){lastResult={captureCompleteness:'INCOMPLETE',verificationPassed:false,message:StudioPrivacy.sanitize(e.message)};const saved=GM_getValue('studioRead:resume',null);if(['STOP_REQUEST_SENT','STOPPED'].includes(saved?.phase)){lastResult.recovery='Stop identity retained; refresh to retry the same capture';}else{try{lastResult=await gm('/api/browser-read/cancel',{pageId:status().pageId});GM_setValue('studioRead:resume',null);}catch{}}popup?.close();if(details)details.open=true;}
    finally{busy=false;update();}
  }
  let resuming=false,resumeDeadline=null;
  async function checkResume(){await identityReady;await sync();const s=status(),saved=GM_getValue('studioRead:resume',null),marker=page.location.hash.match(/^#studio-harness-lease-probe=(read-[\w-]+)$/);
    if(marker&&s.control.ownerConflict&&s.control.readSmoke?.runId===marker[1]){try{await gm('/api/browser-read/lease-proof',{pageId:s.pageId,runId:marker[1]});page.close();}catch{}return;}
    const recovering=['AFTER_RELOAD','STOP_REQUEST_SENT','STOPPED'].includes(saved?.phase)&&saved.pageId===s.pageId&&saved.documentId!==s.documentId;
    if(recovering&&!resuming){resumeDeadline??=Date.now()+45000;if(Date.now()>resumeDeadline){resuming=true;try{lastResult=await gm('/api/browser-read/cancel',{pageId:s.pageId});GM_setValue('studioRead:resume',null);}catch{lastResult={verificationPassed:false,captureCompleteness:'INCOMPLETE',message:'reload resume timeout / controller unavailable'};}update();return;}}
    if(recovering&&!resuming&&s.auth.ready&&!s.control.ownerConflict){resuming=true;void run({resume:true});}
  }
  setInterval(()=>{void checkResume();},1000);void checkResume();return {update};
}
