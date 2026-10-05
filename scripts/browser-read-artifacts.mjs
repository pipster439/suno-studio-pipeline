// Offline development evidence only. No HTTP transport, Suno call or browser access.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import protocol from '../shared/studio-protocol.cjs';
import {StudioValidationHarness} from '../suno/recorder/studio-validation.mjs';
import {BrowserReadSmoke} from '../suno/recorder/browser-read-smoke.mjs';
import {archiveEvidence,scanEvidenceText} from '../shared/evidence-zip.mjs';
import {validateCall} from '../suno/bridge/errors.mjs';
const taskBaseline='f5ebfedc9af6786acfc9bd95e9ca9d98a9c0307a';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const root=resolve(process.argv[2]??'captures/browser-read-development/'+stamp);
await mkdir(resolve(root,'..'),{recursive:true});
await mkdir(root,{recursive:false});
const logs=await readFile('captures/browser-read-development-tests.log','utf8');
const counts=Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,Number(logs.match(new RegExp('# '+k+' (\\d+)'))?.[1])]));
if(counts.fail!==0||counts.pass<149)throw Error('current passing development tests required');
const baseline=JSON.parse(await readFile('captures/studio_project_'+protocol.projectId+'.json','utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=hash(JSON.stringify(protocol.canonical(baseline.state)));
const h=await new StudioValidationHarness(resolve(root,'capture'),{origin:'SIMULATED_OFFLINE'}).init();
const s=await new BrowserReadSmoke({root:resolve(root,'smoke'),harness:h,baseline,output:resolve(root,'modeled-output'),origin:'SIMULATED_OFFLINE'}).init();
const auth={ready:true,nativeReadAdapter:true,userscriptVersion:protocol.versions.userscriptVersion,captureProtocolVersion:2};
await s.start({pageId:'modeled-owner',documentId:'before',versions:protocol.versions,auth,tabIdentityReliable:true,popupAvailable:true,browser:{window:true,node:false}});
async function request(step,source,documentId){
  const id='modeled-'+step,common={captureId:h.active.captureId,pageId:'modeled-owner',documentId,eventId:id,timestamp:new Date().toISOString()};
  await h.add({...common,probeId:id,eventType:'request',source,request:{method:'GET',path:protocol.versionPath,url:'https://studio-api-prod.suno.com'+protocol.versionPath,headers:{},body:null}});
  // This envelope is an offline test fixture, not an observed new version response.
  await h.add({...common,eventType:'response',response:{status:200,body:{id:protocol.versionId,project_id:protocol.projectId,state:baseline.state}},durationMs:0});
  await s.step({pageId:'modeled-owner',documentId,step,result:{requestId:id,ok:true,status:200,transport:source,statePresent:true,projectId:protocol.projectId,versionId:protocol.versionId,rawStateDigest:digest,transportStateDigest:digest,maskedStatePaths:[],losslessWithinBrowser:true}});
}
await request('FETCH','fetch','before');await request('XHR','xhr','before');
await s.step({pageId:'modeled-owner',documentId:'before',step:'RELOAD_READY'});
await h.add({captureId:h.active.captureId,pageId:'modeled-owner',documentId:'before',eventId:'modeled-pagehide',eventType:'navigation',timestamp:new Date().toISOString(),event:'pagehide',pending:0});
h.config('modeled-owner','after');
await h.add({captureId:h.active.captureId,pageId:'modeled-owner',documentId:'after',eventId:'modeled-spa',eventType:'navigation',timestamp:new Date().toISOString(),event:'spa-replaceState',pending:0});
await s.step({pageId:'modeled-owner',documentId:'after',step:'SPA',result:{supported:true}});
await request('RESUMED_FETCH','fetch','after');s.observeBlockedPage('modeled-second-tab');await s.leaseProof({pageId:'modeled-second-tab',runId:s.current.runId});
const rehearsal=await s.finish({pageId:'modeled-owner'});
if(rehearsal.captureCompleteness!=='COMPLETE'||rehearsal.harnessBrowserLiveVerified||rehearsal.realBrowser)throw Error('offline rehearsal failed or mislabeled');
const staging=resolve(root,'smoke',rehearsal.runId,'export-staging');
const names=['browser_smoke_summary.json','protocol_handshake.json','capture_completeness.json','read_request_response_summary.json','lossless_state_check.json','privacy_audit.json','write_dispatch_audit.json','panel_summary.json','sdk_status.json'];
const files=Object.fromEntries(await Promise.all(names.map(async n=>[n,await readFile(resolve(staging,n),'utf8')])));
files['REPORT.md']=await readFile('reports/STUDIO_BROWSER_READONLY_REPORT.md','utf8');
files['CODEX_LIVE_VALIDATION_HANDOFF.md']=await readFile('CODEX_LIVE_VALIDATION_HANDOFF.md','utf8');
files['TESTS.txt']=logs+'\n'+await readFile('captures/browser-read-integration-default.log','utf8');
try{files['controller_readiness.json']=await readFile('captures/browser-read-controller-readiness.json','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
files['offline_browser_rehearsal.json']=JSON.stringify({origin:'SIMULATED_OFFLINE',complete:true,actualBrowser:false,networkRequests:0,liveVerified:false,scope:'modeled read scenario; actual panel/controller VM integration separately exercised in unit tests',checks:['fetch','XHR','correlation','reload','SPA fragment','second-tab lease rejection','privacy','lossless','archive']},null,2);
const preserved=[];
for(const [path,expected]of [
 ['fixtures/studio_project_get.json','b5cc87081cda785b6d59b753908687c0487dfd23f1e3c262b7b563ba5a2ec64a'],
 ['captures/studio_project_'+protocol.projectId+'.json','a1e2213a987eaa3c3012244eed3e69c9b5e044c1ad54b9fb288f3e19d9ecc334'],
 ['deliverables/SUNO_STUDIO_LIVE_VALIDATION_READY_EVIDENCE.zip','0b53e7df6eb94faaeaf4f11f8bc2437bf2285c47f20d3de2a8a5941982056ef1'],
 ['deliverables/SUNO_STUDIO_DRY_RUN_SDK_EVIDENCE.zip','2e05b41a1371aaf86dd0f0a0d20e678e82c095a46b358e222451a52ad8ac11eb']]){
 const actual=hash(await readFile(path));if(actual!==expected)throw Error('historical evidence changed');preserved.push({artifact:basename(path).replace(protocol.projectId,'OWNED_PROJECT'),sha256:actual,unchanged:true});
}
let blockedChecks=0;for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/api/studio/save-project','/api/%2573tudio/save-project','/api/x/../studio/render-state','/api//studio/create-project']){if(protocol.dispatchBlock(path,method)!=='not_verified')throw Error('browser write guard failed');try{validateCall({method,path});throw Error('controller write guard failed');}catch(e){if(e.kind!=='not_verified')throw e;}blockedChecks++;}
files['write_dispatch_audit.json']=JSON.stringify({realStudioPOST:0,realStudioPUT:0,realStudioPATCH:0,realStudioDELETE:0,realSunoRequestsThisTask:0,writeGuard:'LOCKED',endpointUnlocks:0,entitlementChanges:0,blockedChecks,scope:'explicit guard tests plus offline no-network rehearsal; no claim of account-wide traffic monitoring'},null,2);
files['privacy_audit.json']=JSON.stringify({credentialsPackaged:false,rawBodiesPackaged:false,privateDisplayDataPackaged:false,sourceEvidencePreserved:preserved,timeSignatureChanges:'covered by lossless full-state digest and privacy regression tests',scan:'all staging members and actual archive contents checked; field names/test labels are not credential values'},null,2);
files['sdk_status.json']=JSON.stringify({versions:protocol.versions,tests:counts,implementation:'COMPLETE',harnessBrowserLiveVerified:false,realBrowser:false,priorReadEvidence:'VERIFIED + LOSSLESS; unchanged',liveWriteValidation:'BLOCKED_BY_PRODUCT_ENTITLEMENT',productEntitlement:'FREE',dispatchAllowed:false,remaining:['install v1.3.17 and run actual browser self-test','arbitrary application-router navigation not covered by supported fragment proof','native CORS/GM tab support/popup behavior require actual browser run']},null,2);
files['commit_metadata.json']=JSON.stringify({taskBaseline,currentHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commits:execFileSync('git',['log','--format=%h %s',taskBaseline+'..HEAD'],{encoding:'utf8'}).trim().split('\n'),patchProvidedSeparately:true},null,2);
const sensitive=Object.entries(files).filter(([,text])=>Object.values(scanEvidenceText(text)).some(Boolean));if(sensitive.length)throw Error('sensitive evidence '+sensitive.map(r=>r[0]).join(','));
const output=resolve('deliverables/browser-read-development',stamp);
const archive=await archiveEvidence({staging:resolve(root,'delivery-staging'),output,name:'SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip',files,metadata:{purpose:'development handoff; actual browser NOT VERIFIED',origin:'SIMULATED_OFFLINE',counts,versions:protocol.versions,taskBaseline,credentialsIncluded:false,patchSeparate:true}});
await writeFile('captures/browser-read-development-latest.json',JSON.stringify({root,...archive},null,2)+'\n');
console.log(JSON.stringify({path:archive.path,sha256:archive.sha256,entries:archive.entries.length,tests:counts,realBrowser:false,harnessBrowserLiveVerified:false,realStudioWrites:0}));
