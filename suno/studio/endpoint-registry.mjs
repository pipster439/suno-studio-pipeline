import {readFileSync}from'node:fs';
import {BridgeError}from'../bridge/errors.mjs';
function deepFreeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v;}
export const EVIDENCE_STATUSES=Object.freeze(['UNKNOWN','OBSERVED','CORRELATED','FOUND_STATICALLY','VERIFIED']);
export const STUDIO_ENDPOINT_REGISTRY=deepFreeze(JSON.parse(readFileSync(new URL('./endpoint-inventory.json',import.meta.url),'utf8')).endpoints);
function normalized(path){let p=path.split('?')[0];for(let i=0;i<8&&/%[\da-f]{2}/i.test(p);i++)p=decodeURIComponent(p);if(/[%\\\s#]/.test(p)||!p.startsWith('/')||p.startsWith('//'))throw Error('ambiguous path');return new URL(p,'https://studio-api-prod.suno.com').pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'');}
export function findEndpoint(method,path,registry=STUDIO_ENDPOINT_REGISTRY){const p=normalized(path);return registry.find(e=>e.method===method.toUpperCase()&&new RegExp('^'+e.path.replace(/[.*+?^$()|[\]\\]/g,'\\$&').replace(/\{[^}]+\}/g,'[A-Za-z0-9_-]+')+'$').test(p));}
export function endpointGate(method,path,{registry=STUDIO_ENDPOINT_REGISTRY,allow_verified_studio_writes=false}={}){
  const e=findEndpoint(method,path,registry),write=method.toUpperCase()!=='GET';
  const eligible=!!e&&e.status==='VERIFIED'&&(!write||allow_verified_studio_writes===true)&&(!write||e.humanReview===true&&e.evidenceRefs?.length>0&&!!e.verifiedRequestSchema&&!!e.verifiedResponseSchema&&!!e.lastVerifiedAgainst);
  return {endpoint:e?.path??null,status:e?.status??'UNKNOWN',eligible,dispatchAllowed:eligible,writeImplementationLocked:write&&!eligible,humanReviewRequired:write&&!e?.humanReview,
    reason:eligible?'verified endpoint with explicit policy':e?.status==='VERIFIED'?'verified endpoint; local write policy locked':'unverified endpoint'};
}
export function assertStudioWriteAllowed(method,path,options){const gate=endpointGate(method,path,options);if(!gate.dispatchAllowed)throw new BridgeError('not_verified',gate.reason);return gate;}
