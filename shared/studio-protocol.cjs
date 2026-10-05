(function(root){
  const versions=Object.freeze({controllerVersion:'0.2.0',captureProtocolVersion:2,userscriptVersion:'1.3.17',harnessVersion:'1.1.0'});
  const projectId='3ebbb451-08a7-4599-9885-788f0b8f5def',versionId='e491cbde-9266-4884-997c-3a9789877a56';
  const versionPath=`/api/studio/${projectId}/version/${versionId}`;
  function compatible(v){return !!v&&Object.entries(versions).every(([k,value])=>v[k]===value);}
  function dispatchBlock(path,method){
    let decoded=path.split('?')[0];try{for(let i=0;i<8&&/%[0-9a-f]{2}/i.test(decoded);i++)decoded=decodeURIComponent(decoded);}catch{return 'validation_error';}
    if(/%[0-9a-f]{2}/i.test(decoded)||decoded.startsWith('//')||/[\\\s#]/.test(decoded))return 'validation_error';
    decoded=new URL(decoded,'https://studio-api-prod.suno.com').pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'');
    return /^\/api\/studio/i.test(decoded)&&(method!=='GET'||/^\/api\/studio\/(?:create-project|save-project|render-state|render-state-multitrack)$/i.test(decoded))?'not_verified':null;
  }
  function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
  function maskedPaths(v,path=''){const found=[];if(v==='<redacted>'||v==='<invalid-url>'||v&&typeof v==='object'&&Object.hasOwn(v,'omitted'))found.push(path);else if(v&&typeof v==='object')for(const[k,a]of Object.entries(v))found.push(...maskedPaths(a,path+'/'+k.replaceAll('~','~0').replaceAll('/','~1')));return found;}
  const api={versions,projectId,versionId,versionPath,canonical,maskedPaths,compatible,dispatchBlock,productEntitlement:'FREE',liveValidationBlockedReason:'PRODUCT_ENTITLEMENT'};
  if(typeof module!=='undefined')module.exports=api;else root.StudioProtocol=api;
})(globalThis);
