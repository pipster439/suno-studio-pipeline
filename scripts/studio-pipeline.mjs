#!/usr/bin/env node
// One public orchestration entry; authentication, state and render remain SDK-owned.
import { readFile, writeFile, mkdir, rm, copyFile, open, unlink } from 'node:fs/promises';
import { resolve, join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createController } from '../suno/server.mjs';
import { SunoBridge } from '../suno/bridge/client.mjs';
import { StudioClient } from '../suno/studio/operations.mjs';
import privacy from '../shared/studio-privacy.cjs';
import { durableJson } from '../shared/durable-json.mjs';
import { parseConfig } from '../suno/audio/config.mjs';
import { preprocess, probe, decode, readPCM, slicePlan, writeSlice, sha256, verifyAlignment, ffmpeg } from '../suno/audio/pcm.mjs';
import { estimateSliceGains } from '../suno/audio/gain.mjs';
import {sourceFingerprint,validCalibrationCache,strategyOverride,progressiveCalibration,selectCalibrationRegion,calibrationPlan,CALIBRATION_SCHEMA} from '../suno/audio/calibration.mjs';
import {QUALITY_THRESHOLDS} from '../suno/audio/quality.mjs';
import {AUTO_CHUNK_VERSION,normalizeUploadConstraints,autoChunkPlan,planForCuts,chunkSummary,assertUploadPlan,technicalChunkFailure,needsSeamMitigation,actualBoundaryRegion} from '../suno/audio/chunk-strategy.mjs';
import {qualityFromDelivery,saveDeliveryAsset} from '../suno/audio/remote-qa.mjs';
import { analyzeBoundaries, writeAnalysis, qualityGate, silentGaps, classifyABC, windowMetrics } from '../suno/audio/boundaries.mjs';
import { buildTimeline, timelineReport, semanticDiff, chooseHandleStrategy } from '../suno/audio/timeline.mjs';
import { boundedMap, uploadSlice, resumableSlice, retry429 } from '../suno/audio/upload.mjs';
import { rawWireState, deserializeEditorState, serializeProjectState, prepareRenderTransformedState, inspectEditorState } from '../suno/studio/state-boundaries.mjs';
import { serializeAudioProjectState, deserializeAudioProjectState } from '../suno/studio/clip-pipeline.mjs';
import { transformRenderState, deriveDownbeats } from '../suno/studio/render-pipeline.mjs';
import { resolveStudioProfile, compareProfileReadback } from '../suno/audio/postprocessing-profile.mjs';
import { deriveLocalInverse, preprocessInverse } from '../suno/audio/inverse-profile.mjs';
import { verifyTransformFile } from '../suno/audio/transform-verification.mjs';
import { reconcileCachedRender } from '../suno/audio/render-reconciliation.mjs';
import { runPostprocessMatrix } from '../suno/audio/postprocess-matrix.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(r => setTimeout(r, ms));
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; } };
const help = `Usage: node scripts/studio-pipeline.mjs song.mp3 [options]
Default: AUTO_CHUNK minimizes clip count within verified upload constraints;
EXACT render first, seam mitigation only if actual internal boundary QA fails;
the final asset stays on Suno. Only --download saves the delivery locally.
--download [--output PATH] --recalibrate --skip-calibration --allow-quality-warning
--studio-profile default --studio-pitch -8 --studio-speed 0.5 --studio-stretch on
--studio-volume 1 --studio-formant 0 --studio-quantize 1/2 --local-pitch N
Default inverse: joint Rubber Band pitch +8 / tempo x2 before AUTO_CHUNK;
Studio pitch -8 / relative speed x0.5 / Stretch On restores original timing.
--chunk-seconds auto (default); numeric seconds are diagnostic/legacy fixed cuts
(legacy --pitch-up / --studio-transpose aliases are explicit overrides)
--minimum-slice-seconds 6 (merge a shorter final slice into its predecessor)
--upload-concurrency 4 --strategy auto|exact|preroll|crossfade
--preroll-ms 50 --postroll-ms 200 --crossfade-ms 10
--dry-run --keep-workdir --verbose --json-log --resume runs/RUN
Advanced research compatibility:
--postprocess-test (synthetic API/render matrix; UI mapping remains NOT VERIFIED)
--validate-transform (temporary full QA comparison; no final download)
--diagnose --abc-test [--abc-seconds 18] [--abc-test-only] --handle-test --gain-test
--handle-clip-count 4 (2..10; choose a prefix including measured problem seams)
--strategy-evidence runs/CALIBRATION (legacy measured-handle evidence profile)
--good-project ID [--good-version ID] --bad-project ID [--bad-version ID]
--reuse-uploads PATH --preprocessed WAV --bridge-timeout-seconds 90 --bps 1.95
Crossfade fails explicitly until an equal-power Studio model is verified.
Use SUNO_CONTROLLER_BASE + SUNO_CONTROLLER_KEY for an existing controller;
otherwise this command starts the existing controller on SUNO_PORT (3000).
`;
export function announcePairing(app, stderr=process.stderr) {
  if(stderr.isTTY){stderr.write(`Connect the existing browser bridge at ${app.origin}/#${app.key}\n`);return true;}
  stderr.write('Browser bridge pairing required: run in an interactive terminal or use the existing controller environment. Pairing credentials are omitted from redirected logs.\n');return false;
}
async function connectPipelineBridge(config, log) {
  let bridge, app;
  try {
      if (process.env.SUNO_CONTROLLER_BASE) bridge = new SunoBridge({ base: process.env.SUNO_CONTROLLER_BASE, allow_verified_studio_writes: true });
      else {
        app = await createController({ port: Number(process.env.SUNO_PORT || 3000), allow_verified_studio_writes: true });
        // Pairing secret goes only to the interactive terminal, never the run log/config.
        announcePairing(app);
        await log({ event: 'bridge_wait', message: 'Waiting for existing authenticated browser transport' });
        for (let i = 0; i < config['bridge-timeout-seconds']; i++) { if (app.hub.peer && app.hub.auth.ready) break; await pause(1000); }
        if (!app.hub.peer || !app.hub.auth.ready) throw Error('Browser bridge/auth not ready; workspace retained. Resume after pairing the browser.');
        bridge = new SunoBridge({ base: app.origin, key: app.key, allow_verified_studio_writes: true });
      }
    
  return {bridge,app};
  } catch(e){await app?.close();throw e;}
}
export async function collectProjectDiff(client, config, directory) {
  if (!config['good-project'] || !config['bad-project']) return null;
  const fetchState = (p, v) => v ? client.get_project_version(p, v) : client.get_project(p);
  const good = await fetchState(config['good-project'], config['good-version']), bad = await fetchState(config['bad-project'], config['bad-version']);
  const diff = semanticDiff(good.state, bad.state);
  diff.provenance = { fetchedAt: new Date().toISOString(), goodProject: config['good-project'], goodVersion: good.latest_version_id ?? good.id,
    badProject: config['bad-project'], badVersion: bad.latest_version_id ?? bad.id, goodListeningAcceptance: 'user historical report, not reverified by listening' };
  await mkdir(directory, { recursive: true });
  await durableJson(join(directory, 'good-state.json'), privacy.sanitize(good));
  await durableJson(join(directory, 'bad-state.json'), privacy.sanitize(bad));
  await durableJson(join(directory, 'good-vs-bad-state-diff.json'), privacy.sanitize(diff));
  const safeDiff=privacy.sanitize(diff);
  await writeFile(join(directory, 'good-vs-bad-state-diff.md'), `# Good vs bad playback semantics\n\nLive GET/version state. Dynamic identities and editor selection/layout are canonicalized.\n\nWarp correlation: ${JSON.stringify(safeDiff.historicalWarpCorrelation)}\n\n${safeDiff.changes.map(d => `- ${d.path}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`).join('\n')}\n`);
  return diff;
}
export async function runPipeline(requested, deps = {}) {
  if(requested['postprocess-test']) {
    const directory=requested.resume?resolve(requested.resume):resolve(root,'runs',new Date().toISOString().replace(/[:.]/g,'-')+'-postprocess-matrix');
    let sharedApp, sharedBridge=deps.bridge;
    try {
      if(!requested['dry-run']&&!sharedBridge){const connected=await connectPipelineBridge(requested,async e=>console.log(requested['json-log']?JSON.stringify(privacy.sanitize(e)):`[${e.event}] ${e.message??''}`));sharedApp=connected.app;sharedBridge=connected.bridge;}
      return await runPostprocessMatrix(directory,c=>runPipeline(c,{...deps,...(sharedBridge?{bridge:sharedBridge}:{}),sharedUploadCache:!!sharedBridge}),{keep:!!requested['keep-workdir'],diagnose:!!requested.diagnose,dryRun:!!requested['dry-run'],jsonLog:!!requested['json-log'],bridge:sharedBridge});
    } finally {await sharedApp?.close();}
  }

  const totalStarted=performance.now(),timings={};let candidatesTestedThisRun=0;
  const work = requested.resume ? resolve(requested.resume) : resolve(root, 'runs', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(work, { recursive: true });
  const lockPath = join(work, '.pipeline.lock'); const lock = await open(lockPath, 'wx').catch(() => { throw Error('Run is already locked; do not run two resumes concurrently. Remove a stale lock only after checking its owning process.'); });
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.close();
  let app, logQueue = Promise.resolve();
  const log = async data => { const entry = privacy.sanitize({ time: new Date().toISOString(), ...data });
    logQueue = logQueue.then(() => writeFile(join(work, 'run.log'), JSON.stringify(entry) + '\n', { flag: 'a' })); await logQueue;
    if (requested['json-log'] || entry.event==='QUALITY WARNING') console.log(JSON.stringify(entry));
    else if(requested.verbose||!['arrangement','timeline_gap','upload_stage'].includes(entry.event)) console.log(`[${entry.event}] ${entry.mode ?? ''} ${entry.message ?? ''}${entry.stage ? `slice=${entry.index} ${entry.stage} ${Math.round(entry.milliseconds)}ms` : ''}`);
  };
  try {
    const old = requested.resume ? await readJson(join(work, 'config.json')) : null;
    const config = old ? { ...old, ...Object.fromEntries(['resume','verbose','json-log','keep-workdir','output','download','recalibrate','skip-calibration','allow-quality-warning','validate-transform','synthetic-reference','gain-test','handle-test',...(requested.provided?.includes('handle-clip-count')?['handle-clip-count']:[])].filter(k => requested[k] !== undefined).map(k => [k, requested[k]])) } : requested;
    if (requested['dry-run']) config['dry-run'] = true;
    if(requested.provided?.includes('output')&&!config.download)throw Error('--output requires explicit --download');
    config.pipelineSchemaVersion=3;
    // Legacy runs with saved projects must retain their original experiment cuts.
    // Upload-only legacy checkpoints can safely adopt the observed service minimum.
    const legacyBoundJobs = old && old['minimum-slice-seconds'] === undefined ? await readJson(join(work,'jobs.json'),{}) : {};
    config['minimum-slice-seconds'] ??= Object.keys(legacyBoundJobs).length ? 0 : 6;
    if (old && requested.input && requested.input !== old.input) throw Error('Resume input does not match original run');
    for (const k of ['chunk-seconds','minimum-slice-seconds','pitch-up','studio-transpose','strategy','strategy-evidence','preroll-ms','postroll-ms','bps','abc-seconds','preprocessed','reuse-uploads','studio-profile','studio-pitch','studio-speed','studio-stretch','studio-quantize','studio-formant','studio-volume','local-pitch']) if (old && requested.provided?.includes(k) && requested[k] !== config[k]) throw Error(`Resume cannot change --${k}`);
    if (!old) await durableJson(join(work, 'config.json'), privacy.sanitize(config));
    await log({ event: 'run_start', message: work });
    const studioProfile = config.studioProfile ?? resolveStudioProfile(config);
    const localInverse = config.localInverse ?? deriveLocalInverse(studioProfile,config);
    config.studioProfile=studioProfile;config.localInverse=localInverse;
    for(const message of localInverse.warnings??[])await log({event:'QUALITY WARNING',metric:'inverse_unsupported',message});
    config['studio-transpose']=studioProfile.pitchSemitones;config['pitch-up']=localInverse.pitchShiftSemitones;
    await durableJson(join(work,'postprocessing-profile.json'),privacy.sanitize({studio:studioProfile,localInverse}));
    await log({event:'STUDIO PROFILE',message:`pitch=${studioProfile.pitchSemitones} speed action=${studioProfile.speedRatio} stretch=${studioProfile.stretch} formant=${studioProfile.formant} gain=${studioProfile.volume}; UI NOT VERIFIED`,...studioProfile});await log({event:'LOCAL INVERSE PROFILE',message:`pitch=${localInverse.pitchShiftSemitones} tempo=${localInverse.tempoMultiplier} gain=${localInverse.requestedGain}; ${localInverse.confidence}`,...localInverse});
    const preprocessStarted = performance.now();
    const inputBytes = await readFile(config.input), inputHash = sha256(inputBytes), oldSource = await readJson(join(work, 'source-info.json'), {});
    if (oldSource.inputHash && oldSource.inputHash !== inputHash) throw Error('Source changed since checkpoint');
    if(old) await durableJson(join(work,'config.json'),privacy.sanitize(config));
    const processed = join(work, 'preprocessed.wav'); let pcm, sourceInfo, conversion;
    if (config.preprocessed) {
      const bytes = await readFile(resolve(config.preprocessed)); pcm = readPCM(bytes); sourceInfo = await probe(config.input);
      if (oldSource.preprocessedHash && oldSource.preprocessedHash !== sha256(bytes)) throw Error('Preprocessed source changed');
      await writeFile(processed, bytes); conversion = { reusedExplicitPCM: true, suppliedFile: resolve(config.preprocessed), sampleRate: pcm.sampleRate, channels: pcm.channels, bits: pcm.bits, pitchUp: config['pitch-up'], pitchProcessingVerifiedThisRun: false, gainProcessing: 'none' };
    } else {
      const reusable = await readFile(processed).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (reusable) { if (sha256(reusable) !== oldSource.preprocessedHash) throw Error('Preprocessed hash mismatch'); pcm = readPCM(reusable); sourceInfo = oldSource.sourceInfo; conversion = oldSource.conversion; }
      else ({ pcm, sourceInfo, conversion } = await preprocessInverse(config.input, processed, localInverse));
    }
    if(localInverse.headroomLimited)await log({event:'QUALITY WARNING',metric:'inverse_gain_headroom',restorationLimitDb:localInverse.restorationLimitDb});
    await durableJson(join(work,'postprocessing-profile.json'),privacy.sanitize({studio:studioProfile,localInverse}));
    const preprocessedHash = sha256(await readFile(processed));
    if(oldSource.preprocessedHash&&preprocessedHash!==oldSource.preprocessedHash)throw Error('Regenerated PCM changed since checkpoint; start a new run instead of reusing bound sources');
    await durableJson(join(work, 'source-info.json'), { inputHash, preprocessedHash, sourceInfo, conversion, frames: pcm.frames, duration: pcm.frames / pcm.sampleRate });
    timings.localPreprocessMs=performance.now()-preprocessStarted;
    await log({event:'phase_timing',message:'local preprocessing',milliseconds:timings.localPreprocessMs});
    const template = await readJson(join(root, 'fixtures/studio_project_get.json'));
    let uploadStore = await readJson(join(work, 'upload-results.json'), {}), jobs = await readJson(join(work, 'jobs.json'), {}), persistQueue = Promise.resolve();
    const checkpoint = (group, record) => { uploadStore[group] ??= {}; uploadStore[group][record.index] = record;
      const snapshot = structuredClone(uploadStore); persistQueue = persistQueue.then(() => durableJson(join(work, 'upload-results.json'), privacy.sanitize(snapshot))); return persistQueue; };
    const persistJobs = () => durableJson(join(work, 'jobs.json'), privacy.sanitize(jobs));
    async function submit(job, phase, previous, fn) {
      job.phase = phase; await persistJobs();
      try { return await fn(); } catch (e) {
        // Definite rejection may safely retry on resume. A timeout has an unknown
        // remote outcome and retains its submitting phase to prevent duplicates.
        if ([400,401,403,404,409,422,429].includes(e.status)) { job.phase = previous; await persistJobs(); }
        throw e;
      }
    }
    if (config.strategy === 'crossfade') throw Error('Equal-power overlap crossfade has not been verified; no substitute fades applied');
    const autoChunk=config['chunk-seconds']==='auto';
    if(autoChunk&&(config['abc-test']||config['gain-test']||config['strategy-evidence']))throw Error('Legacy seam experiments require explicit numeric --chunk-seconds (e.g. 6)');
    const observedLimits=await readJson(join(root,'fixtures/audio_upload_constraints.json'));
    let uploadLimits=normalizeUploadConstraints(deps.uploadConstraints??observedLimits,config['minimum-slice-seconds']);
    let chunkSelection=autoChunk?await readJson(join(work,'chunk-selection.json'),null):null;
    const planOptions = {chunkSeconds:config['chunk-seconds'],minimumSliceSeconds:config['minimum-slice-seconds']};
    let strategy = config.strategy === 'auto' ? 'exact' : config.strategy;
    const override=strategyOverride(config);
    if(override){strategy=override.strategy;config['preroll-ms']=override.preRollMs;}
    if(config['strategy-evidence']&&!override) {
      const evidenceRoot=resolve(config['strategy-evidence']);
      const evidenceSource=await readJson(join(evidenceRoot,'source-info.json'));
      const evidenceConfig=await readJson(join(evidenceRoot,'config.json'));
      const handles=await readJson(join(evidenceRoot,'diagnostics','handle-experiment.json'));
      const alignment=await readJson(join(evidenceRoot,'diagnostics','handle-alignment.json'));
      if(evidenceSource.preprocessedHash!==preprocessedHash)throw Error('Strategy evidence source hash mismatch');
      for(const k of ['chunk-seconds','minimum-slice-seconds','bps','studio-transpose','postroll-ms'])if(evidenceConfig[k]!==config[k])throw Error(`Strategy evidence playback config mismatch: ${k}`);
      const alignmentValid=alignment.passed&&alignment.checks?.length>0&&alignment.checks.every(c=>c.passed&&c.correlation>=.95&&Math.abs(c.lagMs)<=2);
      const selected=chooseHandleStrategy(handles.baseline,handles.tests,alignmentValid);
      if(handles.status!=='E2E_MEASURED_READ_OFFSETS'||!selected||handles.selected!==selected.prerollMs)throw Error('Strategy evidence has no validated qualifying handle');
      strategy='preroll';config['preroll-ms']=selected.prerollMs;
      await durableJson(join(work,'config.json'),privacy.sanitize(config));
      await durableJson(join(work,'diagnostics-strategy-selection.json'),{strategy,prerollMs:selected.prerollMs,postrollMs:config['postroll-ms'],sourceHash:preprocessedHash,evidenceRun:evidenceRoot,calibrationDuration:handles.baseline.duration,scope:'matching source and playback settings; full output still requires quality gate'});
    }
    let commonPlan=autoChunk?(chunkSelection?.cuts?planForCuts(pcm,chunkSelection.cuts):autoChunkPlan(pcm,uploadLimits)):slicePlan(pcm,planOptions);
    if(autoChunk&&(commonPlan[0].start!==0||commonPlan.at(-1).end!==pcm.frames))throw Error('Auto chunk checkpoint does not cover the complete preprocessed source');
    if(autoChunk){strategy=commonPlan.length===1?'exact':strategy;chunkSelection=chunkSummary(pcm,commonPlan,uploadLimits,chunkSelection?.attempts??[]);config.chunkSelection=chunkSelection;await durableJson(join(work,'chunk-selection.json'),chunkSelection);}
    const productionPlan=options=>autoChunk?planForCuts(pcm,[commonPlan[0].start,...commonPlan.map(c=>c.end)],commonPlan.length===1?{}:options):slicePlan(pcm,{...planOptions,...options});
    await durableJson(join(work,'slice-plan.json'),commonPlan);
    const previewPlan = strategy === 'preroll' ? productionPlan({prerollMs:config['preroll-ms'],postrollMs:config['postroll-ms']}) : commonPlan;
    const dryState = buildTimeline(template, previewPlan.map(s => ({ ...s, clipId: `offline-slice-${s.index}` })), { transpose: config['studio-transpose'], title: 'Dry run', bps: config.bps, profile:studioProfile });
    await durableJson(join(work, 'diagnostics-local-timeline.json'), privacy.sanitize(timelineReport(dryState, commonPlan, pcm.sampleRate)));
    if (config['dry-run']) {
      await writeAnalysis(join(work, 'diagnostics'), analyzeBoundaries(pcm, commonPlan.slice(1).map(s => s.startSec)), pcm, false);
      await log({ event: 'dry_run_complete', message: 'zero network reads/writes; sample plan and timeline validated', slices: commonPlan.length });
      if(autoChunk)await log({event:'AUTO_CHUNK',...chunkSelection});
      return {work,dryRun:true,networkWrites:0,preprocessedDuration:pcm.frames/pcm.sampleRate,chunkStrategy:autoChunk?'AUTO_CHUNK':'FIXED_SECONDS',clipCount:commonPlan.length,internalBoundaryCount:commonPlan.length-1,strategy:commonPlan.length===1?'exact':strategy};
    }
    let bridge = deps.bridge, client = deps.client;
    if(!bridge){const connected=await connectPipelineBridge(config,log);bridge=connected.bridge;app=connected.app;}
    const observedBridge = { call: async (...args) => {
      const response = await bridge.call(...args);
      if(args[0]?.method === 'POST' && args[0]?.path === '/api/studio/render-state') await durableJson(join(work,'last-render-transport-response.json'),privacy.sanitize({requestBinding:{projectId:args[0].body?.studio_project_id,versionId:args[0].body?.studio_project_version_id,startBeats:args[0].body?.start_beats,endBeats:args[0].body?.end_beats},response}));
      return response;
    }};
    client ??= new StudioClient(observedBridge, { allow_verified_studio_writes: true });
    await collectProjectDiff(client, config, join(work, 'diagnostics'));
    if(autoChunk&&bridge instanceof SunoBridge&&!deps.uploadConstraints){
      const response=await retry429(()=>bridge.call({method:'GET',path:'/api/billing/info/',timeoutMs:30000}),{log});
      uploadLimits=normalizeUploadConstraints({audio_upload_limits:response.result?.audio_upload_limits,evidence:{status:'LIVE_SERVER_RESPONSE',path:'audio_upload_limits',fetchedAt:new Date().toISOString()}},config['minimum-slice-seconds']);
      if(chunkSelection.constraints?.maxUploadBytes)uploadLimits.maxUploadBytes=chunkSelection.constraints.maxUploadBytes;
      const triedMinimum=Math.max(1,...chunkSelection.attempts.filter(a=>a.status==='TECHNICAL_FAILURE').map(a=>a.clipCount+1));
      if(!Object.values(jobs).some(j=>j.projectId))commonPlan=autoChunkPlan(pcm,uploadLimits,{minimumClipCount:triedMinimum});
      else assertUploadPlan(pcm,commonPlan,uploadLimits);
      chunkSelection=chunkSummary(pcm,commonPlan,uploadLimits,chunkSelection.attempts);config.chunkSelection=chunkSelection;await durableJson(join(work,'chunk-selection.json'),chunkSelection);
    }
    const sharedUploadDir=join(root,'runs','cache','uploads');
    const sharedUploadsEnabled=deps.sharedUploadCache??(!deps.bridge||deps.bridge instanceof SunoBridge);
    if(sharedUploadsEnabled)await mkdir(sharedUploadDir,{recursive:true});
    const cachedUploads = config['reuse-uploads'] ? await readJson(resolve(config['reuse-uploads'])) : [];
    async function uploads(group, plan) {
      const dir = join(work, 'slices', group); await mkdir(dir, { recursive: true });
      const uploadStarted=performance.now();
      const failures=[];
      const results=await boundedMap(plan, config['upload-concurrency'], async s => {try {
        let record = uploadStore[group]?.[s.index];
        if (resumableSlice(record, s) && record.status === 'complete') { await log({ event: 'upload_reused', index: s.index, mode: group }); return record; }
        if (record && !resumableSlice(record,s)) await log({event:'slice_mapping_changed',mode:group,index:s.index,oldHash:record.localHash,newHash:s.localHash,oldClipId:record.clipId ?? null});
        const shared=sharedUploadsEnabled?await readJson(join(sharedUploadDir,s.localHash+'.json'),null):null;
        if(shared?.localHash===s.localHash&&shared.status==='complete'&&shared.clipId){record={...s,clipId:shared.clipId,uploadId:shared.uploadId,status:'complete',stages:{},reusedFromContentHash:true};await checkpoint(group,record);return record;}
        const identical=Object.values(uploadStore).flatMap(g=>Object.values(g)).find(r=>r.status==='complete'&&r.clipId&&r.localHash===s.localHash);
        if(identical){record={...s,clipId:identical.clipId,uploadId:identical.uploadId,status:'complete',stages:{},reusedFromContentHash:true};await checkpoint(group,record);return record;}
        const cache = cachedUploads.find(c => c.clipId && (c.localHash === undefined || c.localHash === s.localHash) && (resumableSlice(c,s) || c.index === s.index && c.startSec === s.startSec && c.durSec === s.durSec && s.readOffsetSeconds === 0));
        if (cache?.file) {
          const bytes = await readFile(cache.file).catch(() => null);
          if (bytes && sha256(bytes) === s.localHash) { record = { ...s, clipId: cache.clipId, uploadId: cache.uploadId, status: 'complete', reusedFromHashVerifiedEvidence: true, stages: {} }; await checkpoint(group, record); await log({ event: 'upload_reused', index: s.index, mode: group }); return record; }
        }
        const file = join(dir, `slice_${String(s.index).padStart(3, '0')}.wav`); await writeSlice(pcm, s, file);
        const uploaded=await (deps.uploadSlice??uploadSlice)(bridge, s, file, record, r => checkpoint(group, r), log);
        if(sharedUploadsEnabled)await durableJson(join(sharedUploadDir,s.localHash+'.json'),{localHash:s.localHash,clipId:uploaded.clipId,uploadId:uploaded.uploadId,status:'complete',createdAt:new Date().toISOString()});
        return uploaded;
      }catch(error){failures.push(error);throw error;}}).catch(error=>{error.concurrentUploadFailures=failures;throw error;});
      const ms=performance.now()-uploadStarted;timings.uploadsMs=(timings.uploadsMs??0)+ms;await log({event:'phase_timing',mode:group,message:'uploads',milliseconds:ms});return results;
    }
    async function render(mode, slices, transpose, probeTimes, strategy = 'exact', options={}) {
      const dir = join(work, mode); await mkdir(dir, { recursive: true }); jobs[mode] ??= {};
      const job = jobs[mode];job.calibration=!!options.calibration;job.timings??={};const phaseTimings={},createSaveStarted=performance.now();
      const title = `${options.calibration?'Calibration':'Studio'} ${mode} ${work.split(/[\\/]/).pop()}`;
      if (['create_submitting','save_submitting'].includes(job.phase)) throw Error(`${mode}: remote outcome unknown at ${job.phase}; reconcile jobs.json binding before resume`);
      const plannedWire=buildTimeline(template,slices,{transpose,title,bps:config.bps,strategy,profile:studioProfile});
      if(job.wire && (semanticDiff(job.wire,plannedWire).changes.length || JSON.stringify(job.wire.tracks.flatMap(t=>t.clips.map(c=>c.asset?.id)))!==JSON.stringify(plannedWire.tracks.flatMap(t=>t.clips.map(c=>c.asset?.id))))) throw Error(`${mode}: checkpoint playback/source mapping differs from requested arrangement`);
      let wire = job.wire ?? plannedWire;
      const timeline = timelineReport(wire, slices, pcm.sampleRate);
      await durableJson(join(dir, 'diagnostics-timeline.json'), privacy.sanitize(timeline));
      for (const row of timeline.arrangements) await log({ event: 'arrangement', mode, ...row });
      for (const gap of timeline.gaps) if (gap.gapBeats !== 0 || config.verbose) await log({ event: 'timeline_gap', mode, ...gap });
      if (!timeline.exactContinuous) throw Error('Timeline has nonzero sample gap/overlap');
      if (!job.projectId) { const project = await submit(job, 'create_submitting', 'pending', () => client.create_project({ title, major_version: 2 })); job.projectId = project.id; job.phase = 'created'; job.wire = wire; await persistJobs(); }
      await durableJson(join(dir, 'studio-state-before-save.json'), privacy.sanitize(wire));
      const editor = deserializeEditorState(rawWireState(wire), deserializeAudioProjectState);
      if (!job.versionId) { const saved = await submit(job, 'save_submitting', 'created', () => client.save_project({ project_id: job.projectId, title, state: serializeProjectState(editor, serializeAudioProjectState) })); job.versionId = saved.version_id; job.phase = 'saved'; await persistJobs(); }
      const readback = await client.get_project_version(job.projectId, job.versionId);
      await durableJson(join(dir, 'studio-state-readback.json'), privacy.sanitize(readback));
      const profileReadback=compareProfileReadback(wire,readback.state);
      await durableJson(join(dir,'diagnostics-profile-readback.json'),privacy.sanitize(profileReadback));
      if(!profileReadback.passed)throw Error('Post-processing readback mismatch; render stopped');
      const readbackDiff = semanticDiff(wire, readback.state);
      await durableJson(join(dir, 'diagnostics-readback-diff.json'), privacy.sanitize(readbackDiff));
      const sourceIds=w=>w.tracks.flatMap(t=>t.clips.map(c=>c.asset?.id ?? c.clipId));
      if (readbackDiff.changes.length || JSON.stringify(sourceIds(wire))!==JSON.stringify(sourceIds(readback.state))) throw Error('Save readback changed playback semantics/source ids; inspect readback diff');
      phaseTimings.createSaveMs=performance.now()-createSaveStarted;job.timings.createSaveMs=(job.timings.createSaveMs??0)+phaseTimings.createSaveMs;
      const renderWaitStarted=performance.now();
      const endBeats = timeline.expectedTimelineSeconds * config.bps; // Never ceil: that adds an audible tail.
      const renderTiming = transformRenderState(inspectEditorState(editor)).timing;
      async function reconcile(){
        const captured=await readJson(join(work,'last-render-transport-response.json'),null);
        const proven=await reconcileCachedRender(client,bridge,wire,{projectId:job.projectId,versionId:job.versionId,startBeats:0,endBeats},captured);
        job.renderBinding=proven;job.renderClipId=proven.renderClipId;job.phase='render_queued';await persistJobs();
        await durableJson(join(dir,'diagnostics-cached-render-reconciliation.json'),privacy.sanitize(proven));
        await durableJson(join(dir,'render-response.json'),privacy.sanitize(captured.response.result));
        await log({event:'cached_render_reconciled',mode,...proven});
      }
      if(job.phase==='render_submitting'&&!job.renderClipId){const captured=await readJson(join(work,'last-render-transport-response.json'),null);if(captured?.response?.status!==200||captured.response.result?.status!=='complete')throw Error(`${mode}: remote outcome unknown at render_submitting; reconcile jobs.json binding before resume`);await reconcile();}
      if (!job.renderClipId) {
        let submitted;try{submitted = await submit(job, 'render_submitting', 'saved', () => client.render_project({ title, project_id: job.projectId, studio_project_id: job.projectId, studio_project_version_id: job.versionId,
          web_client_pathname: '/studio', lyrics: '', state: prepareRenderTransformedState(editor, transformRenderState, serializeAudioProjectState),
          start_beats: 0, end_beats: endBeats, downbeats: deriveDownbeats(renderTiming, 0, endBeats), export_mode: 'fullsong_export' }));}catch(e){if(e.status===200&&/queued render response\/range\/project\/version relation mismatch/.test(e.message)){await reconcile();submitted={id:job.renderClipId,reconciled:true};}else throw e;}
        job.renderClipId = submitted.id; job.phase = 'render_queued'; await persistJobs();
        if(!submitted.reconciled)await durableJson(join(dir, 'render-response.json'), privacy.sanitize(submitted));
      }
      let complete, consecutiveNotFound=0;
      for (let i = 0; i < 180; i++) {
        let response;
        try { response = await retry429(() => bridge.call({ method: 'GET', path: `/api/clip/${job.renderClipId}`, timeoutMs: 30000 }), { log }); consecutiveNotFound=0; }
        catch(e) {
          await log({event:'render_poll_failed',mode,renderClipId:job.renderClipId,status:e.status,kind:e.kind,message:e.message});
          // Only a GET on the acknowledged render ID retries eventual visibility.
          // A retry requires the official endpoint to confirm a missing asset.
          if(e.status!==404)throw e;
          if(++consecutiveNotFound>=3) {
            const confirmation=await retry429(()=>bridge.call({method:'GET',path:`/api/download/clip/${job.renderClipId}?format=m4a`,timeoutMs:30000}),{log});
            await durableJson(join(dir,'missing-render-download-confirmation.json'),privacy.sanitize(confirmation));
            if(confirmation.result?.ok===false && confirmation.result.reason==='invalid_asset' && !job.missingRenderRetryAttempted) {
              job.missingRenderRetryAttempted=true;
              job.unavailableRenderIds=[...(job.unavailableRenderIds??[]),job.renderClipId];
              await copyFile(join(dir,'render-response.json'),join(dir,'render-response-unavailable.json'));
              await log({event:'confirmed_missing_render_retry',mode,previousRenderClipId:job.renderClipId,projectId:job.projectId,versionId:job.versionId,reason:'GET 404 and official download invalid_asset; retry once using existing saved binding'});
              job.renderClipId=null;job.phase='saved';await persistJobs();
              return render(mode,slices,transpose,probeTimes,strategy,options);
            }
            throw e;
          }
          await pause(4000);continue;
        }
        const c = response.result;
        if (c?.id !== job.renderClipId) throw Error('Render polling response id mismatch');
        if (c.status === 'error') throw Error('Remote render failed');
        if (c.status === 'complete') { complete = c; break; }
        if (i % 5 === 0) await log({ event: 'render_poll', mode, message: c.status }); await pause(4000);
      }
      if (!complete) throw Error('Render still processing; resume uses existing render id');
      phaseTimings.renderWaitMs=performance.now()-renderWaitStarted;job.timings.renderWaitMs=(job.timings.renderWaitMs??0)+phaseTimings.renderWaitMs;
      const metadata = complete.metadata;
      if (metadata?.studio_project_id !== (job.renderBinding?.renderProjectId??job.projectId) || metadata.studio_project_version_id !== (job.renderBinding?.renderVersionId??job.versionId) || metadata.studio_project_start_beats !== 0 || metadata.studio_project_end_beats !== endBeats) throw Error('Completed render binding/range mismatch');
      await durableJson(join(dir, 'render-complete.json'), privacy.sanitize(complete));
      job.phase='qa_pending';await persistJobs();
      let deliveryURL;
      for(let i=0;i<90;i++){
        const response=await retry429(()=>bridge.call({method:'GET',path:`/api/download/clip/${job.renderClipId}?format=m4a`,timeoutMs:30000}),{log});
        await durableJson(join(dir,'download-response.json'),privacy.sanitize(response));const d=response.result;
        if(d?.status==='ready'&&d.download_url&&!d.download_url.includes('<redacted>')){deliveryURL=d.download_url;break;}
        if(d?.status!=='processing')throw Error('Official delivery unavailable; no player stream fallback');
        await pause(2000);
      }
      if(!deliveryURL)throw Error('Official delivery still processing; resume retains render id');
      const previousQuality=await readJson(join(dir,'quality-summary.json'),null);
      let qa;const qualityStarted=performance.now();let qualityReused=false;
      if(previousQuality?.renderClipId===job.renderClipId&&previousQuality.qualityThresholdVersion===QUALITY_THRESHOLDS.version&&previousQuality.detectorVersion===QUALITY_THRESHOLDS.detectorVersion&&!config['gain-test']&&!config['handle-test']&&!config['validate-transform']){
        qa={analysis:await readJson(join(dir,'diagnostics','boundaries.json')),gate:await readJson(join(dir,'diagnostics','quality-gate.json')),qualitySummary:previousQuality};
        qualityReused=true;
        await log({event:'quality_reused',mode});
      }else{
        qa=await(deps.qa??qualityFromDelivery)({url:deliveryURL,directory:dir,times:probeTimes??timeline.boundariesSeconds,expectedDuration:timeline.expectedTimelineSeconds,metadataDuration:metadata.duration,sourcePCM:pcm,sourceOffsetSeconds:options.sourceOffsetSeconds??0,sourceTimeRatio:studioProfile.speedRatio,timelineGapSamples:Math.max(0,...timeline.gaps.map(g=>Math.abs(g.estimatedSourceSamples))),keep:!!config['keep-workdir'],diagnose:!!config.diagnose,localAnalysis:!!config['gain-test']||!!config['handle-test']||!!config['validate-transform']},{log});
        qa.qualitySummary.renderClipId=job.renderClipId;
        await durableJson(join(dir,'quality-summary.json'),privacy.sanitize(qa.qualitySummary));await durableJson(join(dir,'diagnostics','quality-gate.json'),qa.gate);
      }
      let transformVerification=null;
      if(config['validate-transform']&&!options.calibration){
        if(!qa.pcm)throw Error('Transform validation requires temporary decoded delivery PCM');
        transformVerification=await verifyTransformFile(config.input,qa.pcm,join(dir,'qa','reference.wav'),{synthetic:!!config['synthetic-reference']});
        await durableJson(join(dir,'diagnostics','transform-verification.json'),transformVerification);
        if(transformVerification.classification!=='PASS'){qa.gate.status='QUALITY WARNING';for(const metric of transformVerification.warnings)qa.gate.warnings.push({metric:'transform_'+metric,severity:'warning'});}

      }
      if(!options.calibration&&mode.startsWith('PRODUCTION')){
        const inverseDurationErrorMs=(timeline.expectedTimelineSeconds-sourceInfo.duration)*1000;
        qa.qualitySummary.inverseDurationErrorMs=inverseDurationErrorMs;
        if(Math.abs(inverseDurationErrorMs)>50)qa.gate.warnings.push({metric:'inverse_duration',severity:'warning',durationErrorMs:inverseDurationErrorMs});
        for(const message of localInverse.warnings??[])qa.gate.warnings.push({metric:'inverse_unsupported',severity:'warning',message});
        if(qa.gate.warnings.length)qa.gate.status='QUALITY WARNING';
        qa.qualitySummary.quality=qa.gate.status;qa.qualitySummary.transformVerification=transformVerification;
        await durableJson(join(dir,'quality-summary.json'),privacy.sanitize(qa.qualitySummary));await durableJson(join(dir,'diagnostics','quality-gate.json'),privacy.sanitize(qa.gate));
      }
      const {analysis,gate}=qa;phaseTimings.qualityProbeMs=qualityReused?0:performance.now()-qualityStarted;phaseTimings.qualityReused=qualityReused;job.timings.qualityProbeMs=qa.qualitySummary.qualityProbeMs;
      for(const warning of gate.warnings)await log({event:'QUALITY WARNING',mode,...warning});
      const summary={mode,renderBinding:job.renderBinding??{renderProjectId:job.projectId,renderVersionId:job.versionId},studioProfileHash:studioProfile.hash,transformVerification,calibration:!!options.calibration,projectId:job.projectId,versionId:job.versionId,renderClipId:job.renderClipId,renderedClipId:job.renderClipId,renderedAudioURL:privacy.sanitize(deliveryURL),outputFile:qa.decodedFile??null,boundaryCount:timeline.boundariesSeconds.length,analysisProbeCount:analysis.boundaryCount,detectedAnomalyCount:analysis.detectedAnomalyCount,averageBoundaryScore:analysis.averageBoundaryScore,maxBoundaryScore:analysis.maxBoundaryScore,duration:analysis.duration,expectedDuration:timeline.expectedTimelineSeconds,classification:gate.status,strategy,transpose,endBeats,remoteProbeMode:qa.qualitySummary.remoteProbeMode,qualitySummary:privacy.sanitize(qa.qualitySummary),timings:phaseTimings};
      if(config.download&&!options.calibration&&mode.startsWith('PRODUCTION')){
        const downloadStarted=performance.now();
        const output=resolve(config.output??join(work,basename(config.input,extname(config.input))+'-studio-render.m4a'));
        const delivered=await saveDeliveryAsset(deliveryURL,output,qa.deliveryFile,{download:deps.downloadAsset,deliveryInfo:qa.qualitySummary.deliveryInfo});summary.output=delivered.output;summary.delivery=delivered;
        await durableJson(join(work,'delivery-summary.json'),delivered);
        phaseTimings.downloadMs=performance.now()-downloadStarted;
      }
      job.phase='complete';job.summary=summary;await persistJobs();await log({event:'render_complete',mode,message:gate.status,remoteProbeMode:summary.remoteProbeMode});
      return{summary,analysis,wire,gate,qualitySummary:qa.qualitySummary};
    }
    await durableJson(join(work,'config.json'),privacy.sanitize(config));
    async function minimumSuccessfulUploads(handleOptions={}) {
      let plan=productionPlan(handleOptions);
      for(;;){
        const candidate=chunkSummary(pcm,plan,uploadLimits,chunkSelection.attempts);
        await log({event:'AUTO_CHUNK',message:`duration=${candidate.preprocessedDuration}s clips=${candidate.clipCount} internal boundaries=${candidate.internalBoundaryCount}`, ...candidate});
        const group=`AUTO_${handleOptions.prerollMs??0}_${plan.length}_${candidate.uploadPlanHash.slice(0,8)}`;
        try{assertUploadPlan(pcm,plan,uploadLimits);const clips=await uploads(group,plan);const previousSuccess=candidate.attempts.find(a=>a.status==='SUCCESS'&&(a.planHash===candidate.planHash||!a.planHash&&a.clipCount===plan.length&&a.preRollMs===(handleOptions.prerollMs??0)));if(previousSuccess)previousSuccess.planHash=candidate.planHash;else candidate.attempts.push({clipCount:plan.length,preRollMs:handleOptions.prerollMs??0,planHash:candidate.planHash,status:'SUCCESS'});chunkSelection=candidate;config.chunkSelection=chunkSelection;commonPlan=planForCuts(pcm,candidate.cuts);await durableJson(join(work,'chunk-selection.json'),chunkSelection);await durableJson(join(work,'slice-plan.json'),commonPlan);return clips;}
        catch(error){const terminal=error.concurrentUploadFailures?.find(e=>!technicalChunkFailure(e));if(terminal)throw terminal;const failure=technicalChunkFailure(error);if(!failure)throw error;
          candidate.attempts.push({clipCount:plan.length,status:'TECHNICAL_FAILURE',...failure});
          if(failure.maxUploadBytes)uploadLimits={...uploadLimits,maxUploadBytes:Math.min(uploadLimits.maxUploadBytes??Infinity,failure.maxUploadBytes)};
          chunkSelection=candidate;config.chunkSelection=chunkSelection;await durableJson(join(work,'chunk-selection.json'),chunkSelection);
          const next=autoChunkPlan(pcm,uploadLimits,{minimumClipCount:plan.length+1,...handleOptions});
          chunkSelection=chunkSummary(pcm,next,uploadLimits,candidate.attempts);config.chunkSelection=chunkSelection;commonPlan=planForCuts(pcm,chunkSelection.cuts);await durableJson(join(work,'chunk-selection.json'),chunkSelection);await log({event:'auto_chunk_downgrade',message:`${plan.length} -> ${next.length} clips: ${failure.reason}`});plan=next;
        }
      }
    }
    let autoExactResult=null;
    const boundBeforeChunk=jobs.PRODUCTION_PREROLL??jobs.PRODUCTION;
    if(autoChunk&&!boundBeforeChunk?.projectId){
      const exact=await minimumSuccessfulUploads();
      if(commonPlan.length>1&&override)strategy=override.strategy;
      if(commonPlan.length>1&&!override){const started=performance.now();autoExactResult=await render('PRODUCTION_EXACT_PROBE',exact,config['studio-transpose'],undefined,'exact',{calibration:true});timings.exactProductionProbeMs=performance.now()-started;}
    }
    await durableJson(join(work,'config.json'),privacy.sanitize(config));
    let fingerprint=sourceFingerprint(inputHash,pcm,config),cacheFile=join(deps.calibrationCacheDir??join(root,'runs','cache','calibration'),fingerprint.sourceFingerprint+'.json');
    let calibration=await readJson(join(work,'calibration.json'),null);
    const boundProduction=jobs.PRODUCTION_PREROLL??jobs.PRODUCTION;
    if(autoChunk&&commonPlan.length===1){
      strategy='exact';calibration={status:'SKIPPED_NO_INTERNAL_BOUNDARIES',chosenStrategy:'exact',preRollMs:0,postRollMs:0,testedCandidates:[],reason:'One clip has no internal seams'};
    }else if(autoExactResult&&!needsSeamMitigation(autoExactResult.qualitySummary)){
      strategy='exact';calibration={status:'EXACT_PRODUCTION_QA',chosenStrategy:'exact',preRollMs:0,postRollMs:0,testedCandidates:[],exactQuality:autoExactResult.qualitySummary};
    }else if(boundProduction?.projectId){
      if(requested.provided?.includes('recalibrate'))throw Error('Cannot recalibrate an already bound production run; start a new run');
      strategy=jobs.PRODUCTION_PREROLL?'preroll':'exact';
      calibration??={status:'BOUND_PRODUCTION_RESUME',chosenStrategy:strategy,preRollMs:config['preroll-ms'],postRollMs:strategy==='preroll'?config['postroll-ms']:0};
    }else if(override||config['strategy-evidence']){
      calibration={status:'OVERRIDE',chosenStrategy:strategy,preRollMs:strategy==='preroll'?config['preroll-ms']:0,postRollMs:strategy==='preroll'?config['postroll-ms']:0,reason:override?.reason??'ADVANCED_EVIDENCE',testedCandidates:[]};
    }else if(!config['abc-test']&&!config['gain-test']){
      const calibrationStarted=performance.now();const cache=await readJson(cacheFile,null);
      if(validCalibrationCache(calibration,fingerprint.sourceFingerprint)&&!requested.provided?.includes('recalibrate'))calibration={...calibration,resumed:true};
      else if(validCalibrationCache(cache,fingerprint.sourceFingerprint)&&!config.recalibrate){calibration={...cache,cacheHit:true};}
      else{
        const continuing=['RUNNING','CALIBRATION_FAILED'].includes(calibration?.status)&&calibration.sourceFingerprint===fingerprint.sourceFingerprint&&calibration.qualityThresholdVersion===QUALITY_THRESHOLDS.version&&!requested.provided?.includes('recalibrate');
        const region=continuing?calibration.region:autoChunk?actualBoundaryRegion(pcm,commonPlan,autoExactResult?.analysis,uploadLimits):selectCalibrationRegion(pcm,commonPlan);
        const exactEvidence=autoExactResult?{strategy:'exact',preRollMs:0,postRollMs:0,qualityPass:false,qualityThresholdVersion:QUALITY_THRESHOLDS.version,qualitySummary:autoExactResult.qualitySummary,renderId:autoExactResult.summary.renderClipId,scope:'FULL_PRODUCTION_ACTUAL_BOUNDARIES'}:null;
        calibration={schemaVersion:CALIBRATION_SCHEMA,...fingerprint,createdAt:continuing?calibration.createdAt:new Date().toISOString(),runId:continuing?calibration.runId:randomUUID(),calibration:true,region,chunkSeconds:config['chunk-seconds'],pitchUp:config['pitch-up'],studioTranspose:config['studio-transpose'],qualityThresholdVersion:QUALITY_THRESHOLDS.version,detectorVersion:QUALITY_THRESHOLDS.detectorVersion,status:'RUNNING',testedCandidates:continuing?calibration.testedCandidates:exactEvidence?[exactEvidence]:[]};
        await durableJson(join(work,'calibration.json'),privacy.sanitize(calibration));
        const selected=await progressiveCalibration(async candidate=>{
          candidatesTestedThisRun++;
          const plan=calibrationPlan(pcm,commonPlan,region,{...planOptions,prerollMs:candidate.preRollMs,postrollMs:candidate.postRollMs});
          if(autoChunk)assertUploadPlan(pcm,plan,uploadLimits);
          const mode=`CALIBRATION_${calibration.runId.slice(0,8)}_${candidate.preRollMs}`,clips=await uploads(mode,plan),result=await render(mode,clips,config['studio-transpose'],undefined,candidate.strategy,{calibration:true,sourceOffsetSeconds:region.sourceStart});
          return{boundaryCount:result.qualitySummary.boundaryCount,anomalyCount:result.qualitySummary.anomalyCount,averageScore:result.qualitySummary.averageScore,maxScore:result.qualitySummary.maxScore,renderId:result.summary.renderClipId,projectId:result.summary.projectId,versionId:result.summary.versionId,qualitySummary:result.qualitySummary};
        },{postRollMs:config['postroll-ms'],testedCandidates:calibration.testedCandidates,checkpoint:async tested=>{calibration.testedCandidates=tested;await durableJson(join(work,'calibration.json'),privacy.sanitize(calibration));}});
        Object.assign(calibration,selected);
        if(selected.status==='PASS'){await mkdir(dirname(cacheFile),{recursive:true});await durableJson(cacheFile,privacy.sanitize(calibration));}
      }
      timings.calibrationTotalMs=performance.now()-calibrationStarted;
      if(calibration.status==='CALIBRATION_FAILED'){
        await durableJson(join(work,'calibration.json'),privacy.sanitize(calibration));
        if(!config['allow-quality-warning'])throw Error('CALIBRATION_FAILED: no progressive candidate passed; production stopped');
        calibration.warningOverride=true;calibration.chosenStrategy='preroll';calibration.preRollMs=500;calibration.postRollMs=config['postroll-ms'];
      }
      strategy=calibration.chosenStrategy;config['preroll-ms']=calibration.preRollMs;
    }
    if(calibration)await durableJson(join(work,'calibration.json'),privacy.sanitize(calibration));
    await durableJson(join(work,'config.json'),privacy.sanitize(config));
    let exactUploads, abc;
    if(config['gain-test']) {
      exactUploads=await uploads('exact',commonPlan);
      const baseline=await render('SLICED_ZERO_TRANSPOSE',exactUploads,0);
      const referenceFile=join(work,'diagnostics','gain-reference.wav');
      await mkdir(dirname(referenceFile),{recursive:true});
      const baselinePCM=readPCM(await readFile(baseline.summary.outputFile));
      await ffmpeg(['-y','-i',processed,'-ar',String(baselinePCM.sampleRate),'-c:a','pcm_f32le',referenceFile]);
      const estimates=estimateSliceGains(readPCM(await readFile(referenceFile)),baselinePCM,exactUploads);
      const report={explicitOptIn:true,automaticDefaultEnabled:false,baseline:baseline.summary,estimates,experiments:[],failures:[]};
      const gainReport=join(work,'diagnostics','gain-experiment.json');
      await durableJson(gainReport,privacy.sanitize(report));
      if(!estimates.passed)throw Error('Per-slice constant gain not verified across interior windows; no compensation rendered');
      const compensated=exactUploads.map((s,i)=>({...s,amplitude:estimates.estimates[i].amplitude}));
      // Separate modes: original controlled A/B/C always retain amplitude=1.
      for(const [mode,transpose] of [['GAIN_COMPENSATED_ZERO',0],['GAIN_COMPENSATED_NEG8',-8]]) {
        try{const result=await render(mode,compensated,transpose);report.experiments.push(result.summary);}
        catch(e){report.failures.push({mode,message:e.message,status:e.status??null,projectId:jobs[mode]?.projectId,versionId:jobs[mode]?.versionId,renderClipId:jobs[mode]?.renderClipId});await log({event:'gain_experiment_failed',mode,message:e.message});}
        await durableJson(gainReport,privacy.sanitize(report));
      }
      await log({event:'gain_experiment_complete',message:'Independent opt-in experiment; no default strategy promoted'});
    }
    if (config['abc-test']) {
      const plan = config['abc-seconds'] > 0 ? commonPlan.filter(s => s.endSec <= config['abc-seconds']) : commonPlan;
      if (plan.length < 2) throw Error('A/B/C requires at least two full slices');
      const times = plan.slice(1).map(s => s.startSec);
      const partial = { classification: 'INSUFFICIENT_EVIDENCE', sourceHash: preprocessedHash, sameSourceInterval: [0, plan.at(-1).end], experiments: [], missing: ['SLICED_ZERO_TRANSPOSE','SLICED_NEG8_TRANSPOSE','CONTINUOUS_NEG8_TRANSPOSE'] };
      await mkdir(join(work,'diagnostics'),{recursive:true});
      const checkpointABC=()=>durableJson(join(work,'diagnostics','abc-summary.json'),partial);
      await checkpointABC();
      exactUploads = await uploads('exact', plan);
      // C uses the exact same underlying PCM interval as A/B.
      const end = plan.at(-1).end; const sourcePCM = { ...pcm, frames: end, data: pcm.data.subarray(0, end * pcm.blockAlign) };
      const cPlan = slicePlan(sourcePCM, { chunkSeconds: end / pcm.sampleRate });
      async function experiment(mode,fn) {
        try { const result=await fn();partial.experiments.push(result.summary);partial.missing=partial.missing.filter(m=>m!==mode);await checkpointABC();return result; }
        catch(e) {
          partial.failures??=[];partial.failures.push({mode,message:e.message,status:e.status??null,kind:e.kind??null,projectId:jobs[mode]?.projectId??null,versionId:jobs[mode]?.versionId??null,renderClipId:jobs[mode]?.renderClipId??null});
          await checkpointABC();await log({event:'abc_experiment_failed',mode,message:e.message,status:e.status});return null;
        }
      }
      const a = await experiment('SLICED_ZERO_TRANSPOSE',()=>render('SLICED_ZERO_TRANSPOSE', exactUploads, 0, times));
      const b = await experiment('SLICED_NEG8_TRANSPOSE',()=>render('SLICED_NEG8_TRANSPOSE', exactUploads, -8, times));
      const c = await experiment('CONTINUOUS_NEG8_TRANSPOSE',async()=>{const cUploads=await uploads('continuous',cPlan);return render('CONTINUOUS_NEG8_TRANSPOSE',cUploads,-8,times);});
      if(!a || !b || !c)throw Error(`A/B/C incomplete: ${partial.missing.join(', ')}. Check abc-summary.json; existing write bindings retained.`);
      const classification = classifyABC(a.analysis, b.analysis, c.analysis);
      abc = { classification, sourceHash: preprocessedHash, sameSourceInterval: [0, end], controls: { bps: config.bps, gain: 1, fades: 0, warp: 'identity_project_bps', sampleRate: pcm.sampleRate, channels: pcm.channels, renderRange: a.summary.endBeats }, experiments: [a.summary, b.summary, c.summary] };
      await mkdir(join(work, 'diagnostics'), { recursive: true }); await durableJson(join(work, 'diagnostics', 'abc-summary.json'), abc);
      await log({ event: 'abc_result', message: classification });
      if (classification === 'LIKELY_PER_CLIP_DSP_RESET' || config['handle-test']) {
        const short = plan.slice(0, Math.min(config['handle-clip-count']??4, plan.length)), tests = [];
        const alignPlan = slicePlan(pcm, { ...planOptions, prerollMs: 100, postrollMs: config['postroll-ms'] }).slice(0, short.length);
        const alignUploads = await uploads('handles-100', alignPlan);
        const align = await render('HANDLE_ALIGNMENT_ZERO', alignUploads, 0, undefined, 'preroll');
        const alignment = verifyAlignment(readPCM(await readFile(a.summary.outputFile)), readPCM(await readFile(align.summary.outputFile)), short.slice(1).map(s=>s.startSec+Math.min(1,s.durSec/2)));
        await durableJson(join(work,'diagnostics','handle-alignment.json'),alignment);
        if (!alignment.passed) throw Error('Handle read-offset alignment not verified; inspect handle-alignment.json. No strategy promoted.');
        const baseUploads = await uploads('exact', short);
        const base = short.length === plan.length ? b : await render('HANDLE_BASELINE_SHORT', baseUploads, -8);
        const handleReport={status:'RUNNING',hiddenDSPPrerollProven:false,alignmentValidated:true,alignmentExperiment:align.summary,baseline:base.summary,tests,selected:null,crossfade:'NOT_RUN_NO_VERIFIED_EQUAL_POWER_MODEL'};
        await durableJson(join(work,'diagnostics','handle-experiment.json'),handleReport);
        for (const ms of [50, 100, 200, 300, 500]) {
          const hPlan = slicePlan(pcm, { ...planOptions, prerollMs: ms, postrollMs: config['postroll-ms'] }).slice(0, short.length);
          const hUploaded = await uploads(`handles-${ms}`, hPlan), result = await render(`HANDLE_ALIGNED_${ms}`, hUploaded, -8, undefined, 'preroll');
          tests.push({ prerollMs: ms, ...result.summary, improvement: base.analysis.averageBoundaryScore - result.analysis.averageBoundaryScore });
          await durableJson(join(work,'diagnostics','handle-experiment.json'),handleReport);
        }
        const best = [...tests].sort((a, b) => a.averageBoundaryScore - b.averageBoundaryScore)[0];
        // Offset semantics are static evidence. No claim that DSP actually processed
        // hidden handles before the audible start; promote only measured improvement.
        const selected=chooseHandleStrategy(base.summary,tests,alignment.passed);
        await durableJson(join(work, 'diagnostics', 'handle-experiment.json'), {...handleReport,status:'E2E_MEASURED_READ_OFFSETS',selected:selected?.prerollMs??null,lowestScore:best?.prerollMs});
        if (config.strategy === 'auto' && selected) { strategy = 'preroll'; config['preroll-ms'] = selected.prerollMs; }
      }
    }
    if(config['abc-test-only']) {
      const result={work,diagnosticOnly:true,abc:abc.classification,experiments:abc.experiments,productionRun:false};
      await durableJson(join(work,'summary.json'),result);await log({event:'diagnosis_complete',message:abc.classification});return result;
    }
    const handleOptions=strategy==='preroll'?{prerollMs:config['preroll-ms'],postrollMs:config['postroll-ms']}:{};
    if(autoChunk&&strategy==='preroll'){
      try{assertUploadPlan(pcm,productionPlan(handleOptions),uploadLimits);}catch{commonPlan=autoChunkPlan(pcm,uploadLimits,{minimumClipCount:commonPlan.length,...handleOptions});await log({event:'auto_chunk_handle_capacity',message:'Balanced cuts/count adjusted to keep actual handle WAV uploads within verified constraints'});}
    }
    const finalPlan=productionPlan(handleOptions);
    const uploaded=autoChunk?await minimumSuccessfulUploads(handleOptions):await uploads(strategy==='exact'?'exact':`handles-${config['preroll-ms']}`,finalPlan);
    if(autoChunk){const resolved=sourceFingerprint(inputHash,pcm,config);if(resolved.sourceFingerprint!==fingerprint.sourceFingerprint){if(calibration)calibration.productionCutsChanged=true;fingerprint=resolved;}await durableJson(join(work,'config.json'),privacy.sanitize(config));if(calibration)await durableJson(join(work,'calibration.json'),privacy.sanitize(calibration));}

    const productionMode = strategy === 'exact' ? 'PRODUCTION' : 'PRODUCTION_PREROLL';
    // A completed controlled experiment can already be the exact production render.
    // Reuse its verified project/version binding instead of requesting identical DSP twice.
    const matchingMode = strategy === 'exact' ? (autoChunk?'PRODUCTION_EXACT_PROBE':'SLICED_NEG8_TRANSPOSE') : `HANDLE_ALIGNED_${config['preroll-ms']}`;
    const matching = jobs[matchingMode];
    if (!jobs[productionMode] && matching?.phase === 'complete') {
      const planned = buildTimeline(template,uploaded,{transpose:config['studio-transpose'],title:'Production',bps:config.bps,strategy,profile:studioProfile});
      const ids = w => w.tracks.flatMap(t=>t.clips.map(c=>c.asset?.id));
      if (JSON.stringify(ids(matching.wire)) === JSON.stringify(ids(planned)) && semanticDiff(matching.wire,planned).changes.length===0) {
        jobs[productionMode]=structuredClone(matching); await persistJobs();
        await mkdir(join(work,productionMode),{recursive:true});
        if(matching.summary?.qualitySummary){await copyFile(join(work,matchingMode,'quality-summary.json'),join(work,productionMode,'quality-summary.json'));await mkdir(join(work,productionMode,'diagnostics'),{recursive:true});for(const f of ['boundaries.json','boundaries.csv','quality-gate.json'])await copyFile(join(work,matchingMode,'diagnostics',f),join(work,productionMode,'diagnostics',f));}
        await log({event:'production_reused_verified_experiment',mode:matchingMode});
      }
    }
    const production = await render(productionMode, uploaded, config['studio-transpose'], undefined, strategy);
    await mkdir(join(work, 'diagnostics'), { recursive: true });
    await copyFile(join(work, productionMode, 'diagnostics', 'boundaries.json'), join(work, 'diagnostics', 'boundaries.json'));
    await copyFile(join(work, productionMode, 'diagnostics', 'boundaries.csv'), join(work, 'diagnostics', 'boundaries.csv'));
    timings.calibrationTotalMs??=0;
    Object.assign(timings,{productionCreateSaveMs:production.summary.timings?.createSaveMs,productionRenderWaitMs:production.summary.timings?.renderWaitMs,productionQualityProbeMs:production.summary.timings?.qualityProbeMs,totalElapsedMs:performance.now()-totalStarted});
    const result={work,studioProfile,localInverse,...production.summary,preprocessedDuration:pcm.frames/pcm.sampleRate,chunkStrategy:autoChunk?'AUTO_CHUNK':'FIXED_SECONDS',clipCount:uploaded.length,internalBoundaryCount:uploaded.length-1,chunkSelection:autoChunk?chunkSelection:undefined,output:production.summary.output??null,outputFile:config.download?production.summary.output:null,strategy,preRollMs:strategy==='preroll'?config['preroll-ms']:0,postRollMs:strategy==='preroll'?config['postroll-ms']:0,abc:abc?.classification??'NOT_RUN',calibration:{status:calibration?.status??'LEGACY_DIAGNOSTIC',cacheHit:!!calibration?.cacheHit,candidatesTested:candidatesTestedThisRun,historicalCandidates:calibration?.testedCandidates?.length??0,sourceFingerprint:fingerprint.sourceFingerprint,region:calibration?.region},quality:production.gate.status,performance:timings,downloaded:!!config.download};
    await durableJson(join(work,'summary.json'),privacy.sanitize(result));
    await durableJson(join(work,'studio-summary.json'),{projectId:result.projectId,versionId:result.versionId,strategy:result.strategy,preRollMs:result.preRollMs,postRollMs:result.postRollMs,preprocessedDuration:result.preprocessedDuration,chunkStrategy:result.chunkStrategy,clipCount:result.clipCount,internalBoundaryCount:result.internalBoundaryCount});
    await durableJson(join(work,'render-summary.json'),{renderedClipId:result.renderClipId,renderedAudioURL:result.renderedAudioURL,downloaded:result.downloaded,output:result.output});
    await durableJson(join(work,'quality-summary.json'),privacy.sanitize(production.qualitySummary));
    if (!config['keep-workdir'] && !config.diagnose) {
      // Only task-owned large intermediates; checkpoint hashes/IDs remain for resume.
      const sliceDir = resolve(work, 'slices'); if (!sliceDir.startsWith(work + '\\') && !sliceDir.startsWith(work + '/')) throw Error('Cleanup path escaped run');
      await rm(sliceDir, { recursive: true, force: true }); await unlink(processed);
      for(const mode of Object.keys(jobs).filter(m=>/^[A-Z0-9_a-f-]+$/.test(m))){const qaDir=resolve(work,mode,'qa');if(!qaDir.startsWith(work+'\\')&&!qaDir.startsWith(work+'/'))throw Error('QA cleanup path escaped run');await rm(qaDir,{recursive:true,force:true});}
    }
    await log({ event: 'run_complete', message: config.download?result.output:'Final asset remains on Suno; no product download', strategy, quality: result.quality }); return result;
  } catch (e) { await log({ event: 'run_failed', message: e.message, kind: e.kind, status: e.status, workspaceRetained: true }); throw e; }
  finally { await app?.close(); await logQueue; await unlink(lockPath); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const config = parseConfig(process.argv.slice(2)); if (config.help) console.log(help); else console.log(JSON.stringify(await runPipeline(config), null, config['json-log']?undefined:2)); }
  catch (e) { console.error(privacy.sanitize({ error: e.message, kind: e.kind, status: e.status })); process.exitCode = 1; }
}
