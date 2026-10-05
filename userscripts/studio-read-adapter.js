// Injected inside the existing official-page auth closure. Never exports credentials.
function studioReadHeaders(){
  if(pageWindow.__STUDIO_VALIDATION_HOOKS__?.multipleOwners)throw Error('multiple recorder owners; self test blocked');
  const cached=GM_getValue(AUTH_KEY,null),liveCookie=cookieAuthorization(document.cookie);
  const hasSessionCookie=/(?:^|;)\s*__session=/.test(document.cookie);
  const loggedOut=pageWindow.Clerk?.loaded&&!pageWindow.Clerk.session;
  const authorization=liveCookie??(!hasSessionCookie&&!loggedOut?cached?.headers?.authorization:null);
  if(!usableAuthorization(authorization,10))throw Error('Auth transport is not ready');
  return {...cached?.headers,...currentHeaders(),authorization,'browser-token':JSON.stringify({token:btoa(JSON.stringify({timestamp:Date.now()}))})};
}
let studioReadBusy=false;
function studioReadStatus(){let ready=false;try{studioReadHeaders();ready=true;}catch{}
  return {ready,userscriptVersion:VERSION,captureProtocolVersion:StudioProtocol.versions.captureProtocolVersion,nativeReadAdapter:true};}
pageWindow.addEventListener('suno-studio-read-status-request',()=>pageWindow.dispatchEvent(new CustomEvent('suno-studio-read-status',{detail:studioReadStatus()})));
pageWindow.addEventListener('suno-studio-read-request',async event=>{
  const d=event.detail??{},reply=v=>pageWindow.dispatchEvent(new CustomEvent('suno-studio-read-response',{detail:{requestId:d.requestId,...v}}));
  if(!/^[\w-]{1,120}$/.test(d.requestId??'')||d.method!=='GET'||d.path!==StudioProtocol.versionPath||!['fetch','xhr'].includes(d.transport))return reply({ok:false,error:'READ_SMOKE only accepts the pinned owned-version GET'});
  if(studioReadBusy)return reply({ok:false,error:'read probe already pending'});studioReadBusy=true;
  pageWindow.dispatchEvent(new CustomEvent('suno-studio-read-probe-start',{detail:{requestId:d.requestId}}));
  try{
    const requestHeaders=studioReadHeaders(),url='https://studio-api-prod.suno.com'+d.path;
    let status,text,responseURL;
    if(d.transport==='fetch'){
      const r=await pageWindow.fetch(url,{method:'GET',headers:requestHeaders,signal:AbortSignal.timeout(30000),redirect:'error'});
      status=r.status;responseURL=r.url;text=await r.text();
    }else{
      const r=await new Promise((yes,no)=>{const x=new pageWindow.XMLHttpRequest();x.open('GET',url,true);x.timeout=30000;for(const[k,v]of Object.entries(requestHeaders))if(v!=null)x.setRequestHeader(k,String(v));x.onload=()=>yes(x);x.onerror=x.ontimeout=x.onabort=()=>no(Error('native XHR read unavailable'));x.send();});
      status=r.status;responseURL=r.responseURL;text=r.responseText;
    }
    if(responseURL&&new URL(responseURL).origin!=='https://studio-api-prod.suno.com')throw Error('unexpected read redirect');
    if(text.length>1048576)throw Error('native read exceeds observation limit');
    const raw=JSON.parse(text),clean=StudioPrivacy.sanitize(raw);
    const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(StudioProtocol.canonical(value)))))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const rawStateDigest=raw.state?await digest(raw.state):null,transportStateDigest=clean.state?await digest(clean.state):null;
    reply({ok:status===200,status,transport:d.transport,statePresent:!!raw.state,projectId:raw.project_id,versionId:raw.id,rawStateDigest,transportStateDigest,
      maskedStatePaths:StudioProtocol.maskedPaths(clean.state),losslessWithinBrowser:rawStateDigest!==null&&rawStateDigest===transportStateDigest});
  }catch{reply({ok:false,error:'Read unavailable; capture retained as incomplete. Check login/CORS/network, never retry writes.'});}
  finally{studioReadBusy=false;pageWindow.dispatchEvent(new CustomEvent('suno-studio-read-probe-end'));}
});
