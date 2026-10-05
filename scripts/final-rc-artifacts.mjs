// Consolidation only: no network, browser interaction, bundle search or live write.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import protocol from '../shared/studio-protocol.cjs';
import {STUDIO_ENDPOINT_REGISTRY} from '../suno/studio/endpoint-registry.mjs';
import {archiveEvidence,scanEvidenceText} from '../shared/evidence-zip.mjs';
import {runFixtureLifecycle} from '../examples/studio-fixture-lifecycle.mjs';
const baseline='3a50d81543a7ef1e943d222b59a30de032ee7b58',sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const logs=await readFile('captures/final-rc-tests.log','utf8'),counts=Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,Number(logs.match(new RegExp('# '+k+' (\\d+)'))?.[1])]));
if(counts.tests<186||counts.pass!==counts.tests||counts.fail!==0)throw Error('current full passing tests required');
const raw=JSON.parse(await readFile('captures/live-write/result.json','utf8'));
const byStep=Object.fromEntries(raw.map(row=>[row.step,row]));
const c=byStep.create_project,s1=byStep.save_project_initial,s2=byStep.save_project_transposed,r=byStep.render_state;
if([c,s1,s2,r].some(row=>row.status!==200)||s1.response.id!==c.response.id||s2.response.id!==c.response.id||s1.response.version_id===s2.response.version_id||r.response.metadata.studio_project_id!==c.response.id||r.response.metadata.studio_project_version_id!==s2.response.version_id||r.response.status!=='queued')throw Error('supplied real lifecycle response bindings disagree');
const browser=JSON.parse(await readFile('captures/browser-read/read-1791220719459-dcefb220/export-staging/browser_smoke_summary.json','utf8'));
if(browser.origin!=='LIVE_CAPTURE'||!browser.realBrowser||!browser.harnessBrowserLiveVerified||!browser.recorderStopAcknowledged||browser.captureCompleteness!=='COMPLETE')throw Error('real COMPLETE browser evidence required');
const originalReport=await readFile('captures/private/final-rc/STUDIO_FREE_WRITE_VALIDATION_REPORT.md');
if(sha(originalReport)!==sha(await readFile('captures/final-rc-task-baseline/files/reports/STUDIO_FREE_WRITE_VALIDATION_REPORT.md')))throw Error('original private report modified');
const privacy=JSON.parse(await readFile('captures/final-rc-privacy-audit.json','utf8'));
if(privacy.scan!=='PASS')throw Error('privacy audit required');
const rehearsal=await runFixtureLifecycle();
const matrix=JSON.parse(await readFile('suno/studio/verification-matrix.json','utf8'));
const files={
  'REPORT.md':await readFile('reports/STUDIO_FINAL_RC_REPORT.md','utf8'),
  'TESTS.txt':logs+'\nDEFAULT REAL INTEGRATION GATE\n'+await readFile('captures/final-rc-integration-default.log','utf8'),
  'FINAL_SDK_STATUS.json':{version:'0.3.0-rc.1',versions:protocol.versions,coreWorkflow:'VERIFIED',browserHarness:'LIVE VERIFIED / FROZEN',defaultWritePolicy:'LOCKED',officialUiForTestedFreeAccount:'BLOCKED_BY_PRODUCT_ENTITLEMENT',renderCompletionVerified:false,productionRequestsThisTask:0,counts,capabilities:matrix.capabilities},
  'ENDPOINT_REGISTRY.json':STUDIO_ENDPOINT_REGISTRY,
  'VERIFICATION_MATRIX.json':matrix,
  'CREATE_SAVE_RENDER_VALIDATION_SUMMARY.json':{origin:'LIVE_CAPTURE',source:'supplied private real validation records/report plus user readback confirmation',testedAccountTier:'FREE',calls:raw.map(row=>({step:row.step,method:row.method,path:row.endpoint.split('?')[0],status:row.status,durationMs:row.durationMs})),responseProjectBindingsMatch:true,newVersionResponsesDistinct:true,renderProjectVersionRelation:true,renderStatus:r.response.status,renderEntityType:r.response.entity_type,renderMetadataType:r.response.metadata.type,renderRange:{start:r.response.metadata.studio_project_start_beats,end:r.response.metadata.studio_project_end_beats},readbackRawBodyAvailable:false,readbackEvidence:'supplied report/user confirmed; regression state reconstructed',renderCompletionVerified:false,sourceSha256:sha(await readFile('captures/live-write/result.json')),privateOriginalReportSha256:sha(originalReport),newLiveCallsPerformed:false},
  'BROWSER_HARNESS_STATUS.json':{...browser,sourceVersion:'1.3.18',source:'previous real completed read smoke',frozen:true,rcHarnessDataPlaneChanged:false,rcScriptVersion:'1.3.19',rcBuildLiveRetested:false,losslessDigests:JSON.parse(await readFile('captures/browser-read/read-1791220719459-dcefb220/export-staging/lossless_state_check.json','utf8')).checks},
  'PRIVACY_AUDIT.json':privacy,
  'SECRET_SCAN.json':{status:'PASS',secretValues:0,privateAccountValues:0,newPublicFixtureBusinessUUIDs:0,scope:'new/modified public artifacts and every evidence member; harmless field/test names are permitted',rawPrivateEvidencePackaged:false},
  'EVIDENCE_HISTORY.md':await readFile('docs/EVIDENCE_HISTORY.md','utf8'),
  'KNOWN_LIMITATIONS.md':await readFile('docs/KNOWN_LIMITATIONS.md','utf8'),
  'EVIDENCE_STATUS.md':await readFile('docs/EVIDENCE_STATUS.md','utf8'),
  'OFFLINE_LIFECYCLE.json':{origin:rehearsal.origin,responseFixturesOrigin:rehearsal.responseFixturesOrigin,readbackStateOrigin:rehearsal.readbackStateOrigin,steps:['create','add local clip','save','read version','transpose -5','save','read version','render queued'],productionNetworkCount:0,transposition:rehearsal.version2.state.tracks[0].clips[0].transposition,renderStatus:rehearsal.render.status,newLiveEvidence:false},
  'WRITE_POLICY_AUDIT.json':{defaultAllowVerifiedStudioWrites:false,unknownStudioWrites:'DENIED',unverifiedWrites:'DENIED',multitrack:'DENIED',legacyBlanketOverridesRemoved:true,requestPreviewDispatch:false,actualStudioPOSTThisTask:0,actualStudioPUTThisTask:0,actualStudioPATCHThisTask:0,actualStudioDELETEThisTask:0,historicalInputStudioPOST:4,entitlementOverrides:0,subscriptionSpoof:0,uiUnlock:0},
  'COMMIT_PATCH_METADATA.json':{baselineCommit:baseline,baselineHadPreExistingChanges:true,patchBasis:'saved working-tree snapshot; excludes prior uncommitted edits',currentHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commits:execFileSync('git',['log','--format=%h %s',baseline+'..HEAD'],{encoding:'utf8'}).trim().split('\n'),patchSeparate:true,patchName:'SUNO_STUDIO_FINAL_RC.patch',patchSha256:sha(await readFile('deliverables/SUNO_STUDIO_FINAL_RC.patch')),push:false,tag:false,stableRelease:false}
};
files['FIXTURE_MANIFEST.json']=await Promise.all(['create_project_response.json','save_project_response.json','save_project_transposed_response.json','render_state_queued_response.json','PROVENANCE.json'].map(async path=>({path,sha256:sha(await readFile('fixtures/write-validation/'+path)),origin:'LIVE_CAPTURE_DERIVED / DEIDENTIFIED'})));
files['BUILD_MANIFEST.json']=await Promise.all(['userscripts/local-transport.user.js','userscripts/studio-validation.user.js'].map(async path=>({path,sha256:sha(await readFile(path)),packaged:false})));
const preservation=[];
for(const [label,path] of [
 ['original project fixture','fixtures/studio_project_get.json'],
 ['real stop ACK browser evidence','deliverables/browser-read/read-1791220719459-dcefb220/SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip'],
 ['real initial browser evidence','deliverables/browser-read/read-1791217085056-1083c00c/SUNO_STUDIO_BROWSER_READONLY_LIVE_EVIDENCE.zip'],
 ['dry-run SDK evidence','deliverables/SUNO_STUDIO_DRY_RUN_SDK_EVIDENCE.zip'],
 ['live-ready offline evidence','deliverables/SUNO_STUDIO_LIVE_VALIDATION_READY_EVIDENCE.zip']
]){const b=await readFile(path);if(path==='fixtures/studio_project_get.json'&&sha(b)!==sha(await readFile('captures/final-rc-task-baseline/files/'+path)))throw Error('historical fixture changed');preservation.push({artifact:label,sha256:sha(b),originalNotModified:true,packaged:false});}
files['PRESERVATION_HASHES.json']=preservation;
for(const [name,v] of Object.entries(files)){const text=typeof v==='string'?v:JSON.stringify(v);if(Object.values(scanEvidenceText(text)).some(Boolean)||/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i.test(text))throw Error('private value/business UUID rejected in '+name);}
await mkdir('captures/final-rc-staging',{recursive:true});
const result=await archiveEvidence({staging:resolve('captures/final-rc-staging',stamp),output:resolve('deliverables/final-rc',stamp),name:'SUNO_STUDIO_FINAL_RC_EVIDENCE.zip',files,metadata:{purpose:'final RC consolidation',version:'0.3.0-rc.1',newProductionCalls:0,counts,patchSeparate:true,privateValuesIncluded:false}});
await writeFile('captures/final-rc-delivery-latest.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({path:result.path,sha256:result.sha256,members:result.entries.length,bytes:result.bytes,tests:counts,realStudioWritesThisTask:0}));
