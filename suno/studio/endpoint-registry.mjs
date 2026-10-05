import {readFileSync}from'node:fs';
import {NotVerifiedError}from'./operations.mjs';
import {deepFreeze}from'./dry-run-sdk.mjs';
export const STUDIO_ENDPOINT_REGISTRY=deepFreeze(JSON.parse(readFileSync(new URL('./endpoint-inventory.json',import.meta.url),'utf8')).endpoints.map(e=>({...e,liveValidationBlockedReason:e.method==='GET'?null:'PRODUCT_ENTITLEMENT'})));
function normalized(path){let p=path.split('?')[0];for(let i=0;i<8&&/%[\da-f]{2}/i.test(p);i++)p=decodeURIComponent(p);if(/[%\\\s#]/.test(p)||!p.startsWith('/')||p.startsWith('//'))throw Error('ambiguous path');return new URL(p,'https://studio-api-prod.suno.com').pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'');}
export function findEndpoint(method,path,registry=STUDIO_ENDPOINT_REGISTRY){const p=normalized(path);return registry.find(e=>e.method===method.toUpperCase()&&new RegExp('^'+e.path.replace(/[.*+?^$()|[\]\\]/g,'\\$&').replace(/\{[^}]+\}/g,'[A-Za-z0-9_-]+')+'$').test(p));}
export function endpointGate(method,path,{registry=STUDIO_ENDPOINT_REGISTRY,allow_verified_studio_writes=false}={}){
  const e=findEndpoint(method,path,registry),write=method.toUpperCase()!=='GET';
  const eligible=!!e&&e.status==='VERIFIED'&&(!write||allow_verified_studio_writes===true)&&(!write||e.humanReview===true&&e.evidenceRefs?.length>0&&!!e.verifiedRequestSchema&&!!e.verifiedResponseSchema&&!!e.lastVerifiedAgainst);
  return {endpoint:e?.path??null,status:e?.status??'UNKNOWN',eligible,dispatchAllowed:eligible&&!write,writeImplementationLocked:write,humanReviewRequired:write,
    reason:write?'per-endpoint eligibility prepared; production Studio transport remains physically locked':eligible?'verified read':'unverified endpoint'};
}
export function assertStudioWriteAllowed(method,path,options){const gate=endpointGate(method,path,options);throw new NotVerifiedError('Studio production write is locked; '+gate.reason);}
