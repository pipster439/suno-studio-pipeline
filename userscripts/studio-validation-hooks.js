// Passive official-page instrumentation, installed at document-start; no business dispatch.
(function(){
  const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window,p=StudioPrivacy,CONFIG='studioValidation:pair',QUEUE='studioValidation:queue';
  if(location.hostname==='127.0.0.1'){
    window.addEventListener('studio-validation-pair',e=>{const d=e.detail;if(d?.base===location.origin&&/^http:\/\/127\.0\.0\.1:300[012]$/.test(d.base)&&/^[a-f0-9]{64}$/.test(d.key??''))GM_setValue(CONFIG,{base:d.base,key:d.key});});return;
  }
  if(!['suno.com','www.suno.com'].includes(location.hostname))return;
  if(page.__STUDIO_VALIDATION_HOOKS__){
    page.__STUDIO_VALIDATION_HOOKS__={version:page.__STUDIO_VALIDATION_HOOKS__.version??'legacy',multipleOwners:true};
    if(typeof mountStudioReadPanel==='function')mountStudioReadPanel({page,gm:()=>Promise.reject(Error('multiple recorder owners')),sync:async()=>{},identityReady:Promise.resolve(),status:()=>({control:{...StudioProtocol.versions,ownerConflict:true,connectionError:'multiple recorder owners; disable the old standalone harness and refresh'},auth:{ready:false},pageId:'duplicate-recorder',documentId:'duplicate-recorder',pending:0,queued:0,dropped:0,storageFailures:1})});
    return;
  }
  page.__STUDIO_VALIDATION_HOOKS__={version:'1.1.0'};
  let pageId;try{pageId=page.sessionStorage.getItem('studio-validation-page');if(!pageId){pageId=crypto.randomUUID();page.sessionStorage.setItem('studio-validation-page',pageId);}}catch{pageId=crypto.randomUUID();}
  const documentId=crypto.randomUUID();let tabIdentityReliable=false;
  const identityReady=typeof GM_getTab==='function'&&typeof GM_saveTab==='function'?new Promise(resolve=>GM_getTab(tab=>{try{tab.studioHarnessTabId??=crypto.randomUUID();GM_saveTab(tab);pageId=tab.studioHarnessTabId;tabIdentityReliable=true;}catch{}resolve();})):Promise.resolve();
  let pair=GM_getValue(CONFIG,null),control=GM_getValue('studioValidation:control',{controlVersion:0,active:null}),queue=GM_getValue(QUEUE,[]),busy=false,syncing=false,pending=0,dropped=GM_getValue('studioValidation:dropped',0),storageFailures=0,probeId=null,latestAuth={ready:false},panel;
  GM_addValueChangeListener(CONFIG,(_k,_a,v)=>{pair=v;void sync();});
  const id=()=>crypto.randomUUID(),clock=()=>new Date().toISOString();
  function context(raw){try{const u=new URL(raw,location.href),a=control.active;return control.pageId===pageId&&a?.acceptNew&&['https:','wss:'].includes(u.protocol)&&u.hostname==='studio-api-prod.suno.com'&&u.pathname.startsWith('/api/studio/')?{...a,url:u.href}:null;}catch{return null;}}
  function save(){try{GM_setValue(QUEUE,queue);GM_setValue('studioValidation:dropped',dropped);}catch{dropped++;storageFailures++;}}
  function emit(c,event){try{if(queue.length>=200){dropped++;save();return;}queue.push({base:pair.base,...p.sanitize(event),captureId:c.captureId,pageId,documentId,route:location.pathname});save();void pump();}catch{dropped++;save();}}
  function gm(path,body){return new Promise((yes,no)=>GM_xmlhttpRequest({method:body?'POST':'GET',url:pair.base+path,headers:{'X-Controller-Key':pair.key,...(body?{'Content-Type':'application/json'}:{})},...(body?{data:JSON.stringify(body)}:{}),timeout:5000,onload:r=>{if(r.status<200||r.status>=300)return no(Error('local ingress '+r.status));try{yes(JSON.parse(r.responseText));}catch{no(Error('local JSON'));}},onerror:()=>no(Error('local offline')),ontimeout:()=>no(Error('local timeout'))}));}
  async function pump(){if(busy||!pair||!queue.length)return;busy=true;let delivered=false;try{if(queue[0].base!==pair.base){dropped++;queue.shift();save();delivered=true;return;}const row=queue[0],{base,...event}=row;const result=await gm('/api/studio-validation/events',event);if(result.accepted===false)dropped++;queue.shift();save();delivered=true;}catch{}finally{busy=false;if(delivered&&queue.length)setTimeout(()=>{void pump();},0);}}
  async function bootstrap(){
    for(const base of [...new Set([pair?.base,'http://127.0.0.1:3000','http://127.0.0.1:3001','http://127.0.0.1:3002'].filter(base=>/^http:\/\/127\.0\.0\.1:300[012]$/.test(base??'')))]){
      try{const result=await new Promise((yes,no)=>GM_xmlhttpRequest({method:'POST',url:base+'/api/browser-read/handshake',headers:{'Content-Type':'application/json','X-Studio-Harness':'2'},data:'{}',timeout:1500,onload:r=>{try{if(r.status!==200)return no(Error('Controller update required'));yes(JSON.parse(r.responseText));}catch{no(Error('Protocol unavailable'));}},onerror:no,ontimeout:no}));
        if(!/^[a-f0-9]{64}$/.test(result.key??''))continue;pair={base,key:result.key};GM_setValue(CONFIG,pair);return true;
      }catch{}
    }return false;
  }
  async function sync(){if(syncing)return control;syncing=true;try{await identityReady;if(!pair&&!await bootstrap())return control;
    try{control=await gm('/api/studio-validation/recorder-config?page='+pageId+'&document='+documentId);}catch{if(!await bootstrap())throw Error('Controller restart/update required');control=await gm('/api/studio-validation/recorder-config?page='+pageId+'&document='+documentId);}
    if(control.ownerConflict){panel?.update();return control;}control.connectionError=null;GM_setValue('studioValidation:control',control);await pump();
    page.dispatchEvent(new CustomEvent('suno-studio-read-status-request'));
    await gm('/api/studio-validation/recorder-status',{pageId,documentId,controlVersion:control.controlVersion,pending,queued:queue.length,dropped,storageFailures,multipleOwners:page.__STUDIO_VALIDATION_HOOKS__?.multipleOwners===true,versions:{controllerVersion:control.controllerVersion,userscriptVersion:latestAuth.userscriptVersion,harnessVersion:'1.1.0',captureProtocolVersion:2}});
    return control;
  }catch{control.active=null;control.connectionError='Controller restart/update required';return control;}finally{syncing=false;panel?.update();}}
  page.addEventListener('suno-studio-read-status',e=>{latestAuth=e.detail??{ready:false};panel?.update();});
  page.addEventListener('suno-studio-read-probe-start',e=>{probeId=e.detail?.requestId??null;});
  page.addEventListener('suno-studio-read-probe-end',()=>{probeId=null;});
  setInterval(()=>{void sync();},1000);void sync();
  function headers(h){try{return p.headers(Object.fromEntries(new page.Headers(h??{})));}catch{return {};}}
  async function body(message){try{const clone=message.clone();if(Number(clone.headers.get('content-length'))>1048576)return {omitted:'size-limit'};
    if(!clone.body)return null;const reader=clone.body.getReader(),chunks=[];let size=0,timer;
    try{return await Promise.race([(async()=>{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1048576)return {omitted:'size-limit'};chunks.push(r.value);}const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}return p.body(new TextDecoder().decode(bytes));})(),new Promise(r=>{timer=setTimeout(()=>r({omitted:'observation-timeout'}),10000);})]);}
    finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}}catch{return {omitted:'unreadable-body'};}}
  const fetch=page.fetch;
  page.fetch=function(input,init){const raw=typeof input==='string'||input instanceof URL?String(input):input?.url,c=context(raw);if(!c)return fetch.apply(this,arguments);
    const eventId=id(),observedProbe=probeId,timestamp=clock(),start=performance.now(),request={method:String(init?.method??input?.method??'GET').toUpperCase(),url:p.url(c.url),path:p.url(new URL(c.url).pathname+new URL(c.url).search),headers:headers(init?.headers??input?.headers),body:typeof init?.body==='string'?p.body(init.body):init?.body!=null?{omitted:'non-json-request-body'}:null};
    pending++;const finish=()=>pending=Math.max(0,pending-1);
    const observed=init?.body===undefined&&input?.clone?body(input).then(b=>{request.body=b;emit(c,{eventType:'request',eventId,probeId:observedProbe,timestamp,source:'fetch',request,initiator:p.sanitize(new Error().stack)});}):Promise.resolve(emit(c,{eventType:'request',eventId,probeId:observedProbe,timestamp,source:'fetch',request,initiator:p.sanitize(new Error().stack)}));
    let promise;try{promise=fetch.apply(this,arguments);}catch(e){void observed.then(()=>{emit(c,{eventType:'response',eventId,timestamp:clock(),response:{status:null,body:null,error:'synchronous-fetch-error'},durationMs:performance.now()-start});finish();});throw e;}
    void promise.then(async response=>{const observedBody=body(response);await observed;emit(c,{eventType:'response',eventId,timestamp:clock(),response:{status:response.status,headers:headers(response.headers),body:await observedBody},durationMs:performance.now()-start});finish();},async()=>{await observed;emit(c,{eventType:'response',eventId,timestamp:clock(),response:{status:null,body:null,error:'fetch-network-error'},durationMs:performance.now()-start});finish();}).catch(()=>{finish();dropped++;});return promise;
  };
  const proto=page.XMLHttpRequest?.prototype;
  if(proto){const open=proto.open,send=proto.send,set=proto.setRequestHeader,states=new WeakMap();
    proto.open=function(method,url){const r=open.apply(this,arguments);states.set(this,{method,url,headers:{}});return r;};
    proto.setRequestHeader=function(k,v){const r=set.apply(this,arguments);const s=states.get(this);if(s)s.headers[k]=v;return r;};
    proto.send=function(data){const s=states.get(this),c=s&&context(s.url);if(!c)return send.apply(this,arguments);const eventId=id(),start=performance.now();pending++;
      const request={method:String(s.method).toUpperCase(),url:p.url(c.url),path:p.url(new URL(c.url).pathname+new URL(c.url).search),headers:p.headers(s.headers),body:typeof data==='string'?p.body(data):data==null?null:{omitted:'non-json-request-body'}};
      emit(c,{eventType:'request',eventId,probeId,timestamp:clock(),source:'xhr',request});let done=false;const finish=()=>{if(done)return;done=true;let b;try{b=this.responseType==='json'?p.body(this.response):!this.responseType||this.responseType==='text'?p.body(this.responseText):{omitted:'binary-response'};}catch{b={omitted:'unreadable-response'};}
        emit(c,{eventType:'response',eventId,timestamp:clock(),response:{status:this.status||null,body:b},durationMs:performance.now()-start});pending=Math.max(0,pending-1);};this.addEventListener('loadend',finish,{once:true});try{return send.apply(this,arguments);}catch(e){finish();throw e;}};
  }
  if(page.navigator?.sendBeacon){const beacon=page.navigator.sendBeacon;page.navigator.sendBeacon=function(url,data){const c=context(url);const accepted=beacon.apply(this,arguments);if(c)emit(c,{eventType:'beacon',eventId:id(),timestamp:clock(),url:p.url(c.url),accepted,status:null,durationMs:null,body:typeof data==='string'?p.body(data):{omitted:'beacon-non-json-body'},response:{omitted:'beacon-has-no-response-access'}});return accepted;};}
  const NativeWS=page.WebSocket;
  if(NativeWS){function CapturedSocket(...args){const socket=Reflect.construct(NativeWS,args,new.target===CapturedSocket?NativeWS:new.target),url=String(args[0]);
      const observe=(direction,data,event)=>{const c=context(url);if(c)emit(c,{eventType:'ws',eventId:id(),timestamp:clock(),url:p.url(c.url),direction,event,body:typeof data==='string'?p.body(data):data==null?null:{omitted:'binary-websocket-frame'},status:null,durationMs:null});};
      const send=socket.send;socket.send=function(data){const r=send.apply(this,arguments);observe('outgoing',data,'frame');return r;};
      socket.addEventListener('message',e=>observe('incoming',e.data,'frame'));for(const event of ['open','close','error'])socket.addEventListener(event,()=>observe('metadata',null,event));return socket;}
    CapturedSocket.prototype=NativeWS.prototype;Object.setPrototypeOf(CapturedSocket,NativeWS);page.WebSocket=CapturedSocket;
  }
  for(const method of ['pushState','replaceState'])if(page.history?.[method]){const native=page.history[method];page.history[method]=function(){const r=native.apply(this,arguments),c=control.active;if(c&&control.pageId===pageId)emit(c,{eventType:'navigation',eventId:id(),timestamp:clock(),event:'spa-'+method,route:location.pathname,pending});return r;};}
  page.addEventListener('pagehide',()=>{const c=control.active;if(c&&control.pageId===pageId)emit(c,{eventType:'navigation',eventId:id(),timestamp:clock(),route:location.pathname,event:'pagehide',pending});if(control.pageId===pageId)save();});
  if(typeof mountStudioReadPanel==='function')panel=mountStudioReadPanel({page,gm,sync,identityReady,status:()=>({control,pageId,documentId,tabIdentityReliable,pending,queued:queue.length,dropped,storageFailures,auth:latestAuth})});
  // No page-exposed credential/config object. Server-owned scenario control survives navigation.
})();
