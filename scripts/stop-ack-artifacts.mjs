// Task-scoped delivery: immutable real input evidence + separate local regressions.
// No browser/network/Studio dispatch. Never regenerate or rewrite the historical run.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import protocol from '../shared/studio-protocol.cjs';
import {archiveEvidence,scanEvidenceText} from '../shared/evidence-zip.mjs';
import {validateCall} from '../suno/bridge/errors.mjs';

const taskBaseline='17151a8a09bf69458cd6d9136830d4330f6e6fb3';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const stagingRoot=resolve('captures/stop-ack-delivery');
await mkdir(stagingRoot,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const logs=await readFile('captures/stop-ack-development-tests.log','utf8');
const integration=await readFile('captures/stop-ack-integration-default.log','utf8');
const counts=Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,Number(logs.match(new RegExp('# '+k+' (\\d+)'))?.[1])]));
if(counts.tests<175||counts.pass!==counts.tests||counts.fail!==0)throw Error('current passing tests required');
const files={
  'REPORT.md':await readFile('reports/STUDIO_STOP_ACK_FIX_REPORT.md','utf8'),
  'TESTS.txt':logs+'\nDEFAULT INTEGRATION GATE (NO SUNO CALLS)\n'+integration,
  'CODEX_LIVE_VALIDATION_HANDOFF.md':await readFile('CODEX_LIVE_VALIDATION_HANDOFF.md','utf8'),
  'STOP_ACK_PROTOCOL.md':await readFile('docs/STUDIO_STOP_ACK_PROTOCOL.md','utf8')
};
const inputDir='captures/browser-read/read-1791217085056-1083c00c/export-staging/';
for(const name of ['browser_smoke_summary.json','capture_completeness.json','protocol_handshake.json','read_request_response_summary.json','lossless_state_check.json'])files['input_live_'+name]=await readFile(inputDir+name,'utf8');
const live=JSON.parse(files['input_live_browser_smoke_summary.json']);
if(live.origin!=='LIVE_CAPTURE'||live.realBrowser!==true||live.captureCompleteness!=='INCOMPLETE'||live.blockers.join('|')!=='stop acknowledgment unavailable')throw Error('unexpected historical evidence; do not relabel or overwrite');
const preserved=[];
for(const [label,path,expected] of [
  ['original_real_browser_zip','deliverables/browser-read/read-1791217085056-1083c00c/SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip','508a606a8a1bee051f3fb254b4ebacd84b8b7ceace74e7d24858ecff99014ad4'],
  ['original_real_browser_ndjson','captures/live/read-1791217085056-1083c00c/READ_SMOKE/events.ndjson','90b25d4196295bbba09d01af1885bdd0b82b4ca83ffe8edd3266f3114a379187'],
  ['project_fixture','fixtures/studio_project_get.json','b5cc87081cda785b6d59b753908687c0487dfd23f1e3c262b7b563ba5a2ec64a'],
  ['raw_project_capture','captures/studio_project_'+protocol.projectId+'.json','a1e2213a987eaa3c3012244eed3e69c9b5e044c1ad54b9fb288f3e19d9ecc334'],
  ['prior_sdk_evidence','deliverables/SUNO_STUDIO_DRY_RUN_SDK_EVIDENCE.zip','2e05b41a1371aaf86dd0f0a0d20e678e82c095a46b358e222451a52ad8ac11eb'],
  ['prior_readiness_evidence','deliverables/SUNO_STUDIO_LIVE_VALIDATION_READY_EVIDENCE.zip','0b53e7df6eb94faaeaf4f11f8bc2437bf2285c47f20d3de2a8a5941982056ef1']
]){const actual=sha(await readFile(path));if(actual!==expected)throw Error('original evidence changed: '+label);preserved.push({artifact:label,sha256:actual,unchanged:true});}
const unchanged=[];
for(const path of ['shared/privacy.cjs','shared/studio-privacy.cjs','userscripts/studio-read-adapter.js','suno/bridge/errors.mjs','suno/studio/endpoint-registry.mjs']){
  const original=execFileSync('git',['show',taskBaseline+':'+path]),current=await readFile(path);
  // Git stores LF, Windows checkout may use CRLF; compare canonical source bytes.
  const normalize=b=>Buffer.from(b.toString('utf8').replaceAll('\r\n','\n'));
  if(!normalize(original).equals(normalize(current)))throw Error('out-of-scope source changed: '+path);
  unchanged.push({path,sha256:sha(current),semanticallyUnchanged:true});
}
let checks=0;
for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/api/studio/save-project','/api/%2573tudio/save-project','/api/x/../studio/render-state','/api//studio/create-project']){
  if(protocol.dispatchBlock(path,method)!=='not_verified')throw Error('browser guard failed');
  try{validateCall({method,path});throw Error('controller guard failed');}catch(e){if(e.kind!=='not_verified')throw e;}checks++;
}
files['preservation_hashes.json']={preserved,unchanged,originalEvidenceModified:false};
files['stop_protocol_summary.json']={versions:protocol.versions,requestIdGeneratedBy:'controller',ackTransport:'local HTTP /api/studio-validation/stop-ack',resultQuery:'/api/studio-validation/stop-result',states:['STOP_REQUEST_SENT','STOP_ACCEPTED','FLUSHING','STOPPED','ACKNOWLEDGED'],correlation:['captureId','scenario','requestId','ownerPage','documentId','controlVersion','finalSequence'],stopRequires:['no new records','pending=0','queued=0','browser persistence','controller fsync/state commit','storageFailures=0'],idempotent:true,retryReopensRecorder:false,retryRepeatsRecords:false,tombstoneHours:24,tombstoneMax:32,gmTimeoutMs:5000,stopResultBoundMs:15000,strictAckCompletenessCondition:true,newRealBrowserAckVerified:false};
files['regression_summary.json']={origin:'LOCAL_REGRESSION_TESTS',counts,newRealBrowser:false,preservedInputOrigin:'LIVE_CAPTURE',cases:['normal ACK','lost ACK/result retry','double stop','reload before stop','reload during stop','controller reconnect','query reconnect','pending/queue flush','pending request blocks','storage failure blocks','wrong captureId','old ACK isolation','takeover ownership','no post-ACK append'],newRealBrowserAckPending:true};
files['write_dispatch_audit.json']={realStudioPOST:0,realStudioPUT:0,realStudioPATCH:0,realStudioDELETE:0,actualSunoRequestsThisTask:0,writeGuard:'LOCKED',endpointUnlocks:0,entitlementChanges:0,entitlementBypass:0,blockedChecks:checks,productEntitlement:'FREE',writeValidation:'BLOCKED_BY_PRODUCT_ENTITLEMENT',scope:'task actions and local guard tests; not account-wide monitoring'};
files['sdk_status.json']={versions:protocol.versions,existingRealDataPlaneVerified:true,existingRealOrigin:'LIVE_CAPTURE',newStopAckImplementation:'DONE',newStopAckLocallyTested:true,newStopAckBrowserLiveVerified:false,expectedNextRun:'LIVE_CAPTURE / explicit ACK / COMPLETE only if every check succeeds',studioWriteValidation:'BLOCKED_BY_PRODUCT_ENTITLEMENT',dispatchAllowed:false};
files['controller_readiness.json']=JSON.parse(await readFile('captures/stop-ack-controller-readiness.json','utf8'));
files['build_hashes.json']=await Promise.all(['userscripts/local-transport.user.js','userscripts/studio-validation.user.js'].map(async path=>({path,sha256:sha(await readFile(path)),versions:protocol.versions})));
const patchPath=resolve('deliverables/SUNO_STUDIO_STOP_ACK_FIX.patch');
files['commit_metadata.json']={taskBaseline,currentHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commits:execFileSync('git',['log','--format=%h %s',taskBaseline+'..HEAD'],{encoding:'utf8'}).trim().split('\n'),patchProvidedSeparately:true,patchName:'SUNO_STUDIO_STOP_ACK_FIX.patch',patchSha256:sha(await readFile(patchPath)),taskBeganClean:true,pushPerformed:false};
files['privacy_audit.json']={credentialsPackaged:false,rawBodiesPackaged:false,privateAccountDataPackaged:false,realSessionIdsPackaged:false,signedUrlSecretsPackaged:false,originalPrivacyModulesUnchanged:true,allStateDigestsFromRealInputUnchanged:true,maskedStatePaths:[],sourceEvidencePreserved:true,scan:'secret value patterns, member allowlist, no raw bodies; keywords are not credential values'};
for(const [name,value] of Object.entries(files)){const text=typeof value==='string'?value:JSON.stringify(value);if(Object.values(scanEvidenceText(text)).some(Boolean))throw Error('sensitive value in '+name);}
const result=await archiveEvidence({staging:resolve(stagingRoot,stamp),output:resolve('deliverables/stop-ack',stamp),name:'SUNO_STUDIO_STOP_ACK_FIX_EVIDENCE.zip',files,metadata:{purpose:'stop ACK repair; immutable real input plus explicitly separate local regression tests',inputOrigin:'LIVE_CAPTURE',newControlPlaneLiveVerified:false,versions:protocol.versions,counts,taskBaseline,patchSeparate:true}});
await writeFile('captures/stop-ack-delivery-latest.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({path:result.path,sha256:result.sha256,members:result.entries.length,bytes:result.bytes,counts,newLiveAckVerified:false,realStudioWrites:0}));
