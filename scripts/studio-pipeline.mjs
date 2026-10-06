#!/usr/bin/env node
// One public orchestration entry; authentication, state and render remain SDK-owned.
import { readFile, writeFile, mkdir, rm, copyFile, open, unlink } from 'node:fs/promises';
import { resolve, join, dirname, extname } from 'node:path';
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
import { analyzeBoundaries, writeAnalysis, qualityGate, silentGaps, classifyABC, windowMetrics } from '../suno/audio/boundaries.mjs';
import { buildTimeline, timelineReport, semanticDiff, chooseHandleStrategy } from '../suno/audio/timeline.mjs';
import { boundedMap, uploadSlice, resumableSlice, retry429 } from '../suno/audio/upload.mjs';
import { rawWireState, deserializeEditorState, serializeProjectState, prepareRenderTransformedState, inspectEditorState } from '../suno/studio/state-boundaries.mjs';
import { serializeAudioProjectState, deserializeAudioProjectState } from '../suno/studio/clip-pipeline.mjs';
import { transformRenderState, deriveDownbeats } from '../suno/studio/render-pipeline.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(r => setTimeout(r, ms));
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; } };
const help = `Usage: node scripts/studio-pipeline.mjs input.wav [options]
--output PATH --chunk-seconds 6 --pitch-up 8 --studio-transpose -8
--minimum-slice-seconds 6 (merge a shorter final slice into its predecessor)
--upload-concurrency 4 --strategy auto|exact|preroll|crossfade
--preroll-ms 300 --postroll-ms 200 --crossfade-ms 10
--diagnose --abc-test [--abc-seconds 18] [--abc-test-only] --handle-test --gain-test
--handle-clip-count 4 (2..10; choose a prefix including measured problem seams)
--strategy-evidence runs/CALIBRATION (auto: reuse matching-source measured handles)
--dry-run --keep-workdir --verbose --json-log --resume runs/RUN
--good-project ID [--good-version ID] --bad-project ID [--bad-version ID]
--reuse-uploads PATH --preprocessed WAV --bridge-timeout-seconds 90 --bps 1.95
Crossfade fails explicitly until an equal-power Studio model is verified.
Use SUNO_CONTROLLER_BASE + SUNO_CONTROLLER_KEY for an existing controller;
otherwise this command starts the existing controller on SUNO_PORT (3000).
`;
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
  const work = requested.resume ? resolve(requested.resume) : resolve(root, 'runs', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(work, { recursive: true });
  const lockPath = join(work, '.pipeline.lock'); const lock = await open(lockPath, 'wx').catch(() => { throw Error('Run is already locked; do not run two resumes concurrently. Remove a stale lock only after checking its owning process.'); });
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.close();
  let app, logQueue = Promise.resolve();
  const log = async data => { const entry = privacy.sanitize({ time: new Date().toISOString(), ...data });
    logQueue = logQueue.then(() => writeFile(join(work, 'run.log'), JSON.stringify(entry) + '\n', { flag: 'a' })); await logQueue;
    if (requested['json-log'] || ['arrangement','timeline_gap','QUALITY WARNING'].includes(entry.event)) console.log(JSON.stringify(entry)); else console.log(`[${entry.event}] ${entry.mode ?? ''} ${entry.message ?? ''}${entry.stage ? `slice=${entry.index} ${entry.stage} ${Math.round(entry.milliseconds)}ms` : ''}`);
  };
  try {
    const old = requested.resume ? await readJson(join(work, 'config.json')) : null;
    const config = old ? { ...old, ...Object.fromEntries(['resume','verbose','json-log','keep-workdir','output','gain-test','handle-test',...(requested.provided?.includes('handle-clip-count')?['handle-clip-count']:[])].filter(k => requested[k] !== undefined).map(k => [k, requested[k]])) } : requested;
    if (requested['dry-run']) config['dry-run'] = true;
    // Legacy runs with saved projects must retain their original experiment cuts.
    // Upload-only legacy checkpoints can safely adopt the observed service minimum.
    const legacyBoundJobs = old && old['minimum-slice-seconds'] === undefined ? await readJson(join(work,'jobs.json'),{}) : {};
    config['minimum-slice-seconds'] ??= Object.keys(legacyBoundJobs).length ? 0 : 6;
    if (old && requested.input && requested.input !== old.input) throw Error('Resume input does not match original run');
    for (const k of ['chunk-seconds','minimum-slice-seconds','pitch-up','studio-transpose','strategy','strategy-evidence','preroll-ms','postroll-ms','bps','abc-seconds','preprocessed','reuse-uploads']) if (old && requested.provided?.includes(k) && requested[k] !== config[k]) throw Error(`Resume cannot change --${k}`);
    if (!old) await durableJson(join(work, 'config.json'), privacy.sanitize(config));
    await log({ event: 'run_start', message: work });
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
      else ({ pcm, sourceInfo, conversion } = await preprocess(config.input, processed, config['pitch-up']));
    }
    const preprocessedHash = sha256(await readFile(processed));
    await durableJson(join(work, 'source-info.json'), { inputHash, preprocessedHash, sourceInfo, conversion, frames: pcm.frames, duration: pcm.frames / pcm.sampleRate });
    await log({event:'phase_timing',message:'local preprocessing',milliseconds:performance.now()-preprocessStarted});
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
    const planOptions = {chunkSeconds:config['chunk-seconds'],minimumSliceSeconds:config['minimum-slice-seconds']};
    let strategy = config.strategy === 'auto' ? 'exact' : config.strategy;
    if(config['strategy-evidence']) {
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
    const commonPlan = slicePlan(pcm, planOptions);
    await durableJson(join(work,'slice-plan.json'),commonPlan);
    const previewPlan = strategy === 'preroll' ? slicePlan(pcm, { ...planOptions, prerollMs: config['preroll-ms'], postrollMs: config['postroll-ms'] }) : commonPlan;
    const dryState = buildTimeline(template, previewPlan.map(s => ({ ...s, clipId: `offline-slice-${s.index}` })), { transpose: config['studio-transpose'], title: 'Dry run', bps: config.bps });
    await durableJson(join(work, 'diagnostics-local-timeline.json'), privacy.sanitize(timelineReport(dryState, commonPlan, pcm.sampleRate)));
    if (config['dry-run']) {
      await writeAnalysis(join(work, 'diagnostics'), analyzeBoundaries(pcm, commonPlan.slice(1).map(s => s.startSec)), pcm, false);
      await log({ event: 'dry_run_complete', message: 'zero network reads/writes; sample plan and timeline validated', slices: commonPlan.length });
      return { work, dryRun: true, networkWrites: 0 };
    }
    let bridge = deps.bridge, client = deps.client;
    if (!bridge) {
      if (process.env.SUNO_CONTROLLER_BASE) bridge = new SunoBridge({ base: process.env.SUNO_CONTROLLER_BASE, allow_verified_studio_writes: true });
      else {
        app = await createController({ port: Number(process.env.SUNO_PORT || 3000), allow_verified_studio_writes: true });
        // Pairing secret goes only to the interactive terminal, never the run log/config.
        console.log(`Connect the existing browser bridge at ${app.origin}/#${app.key}`);
        await log({ event: 'bridge_wait', message: 'Waiting for existing authenticated browser transport' });
        for (let i = 0; i < config['bridge-timeout-seconds']; i++) { if (app.hub.peer && app.hub.auth.ready) break; await pause(1000); }
        if (!app.hub.peer || !app.hub.auth.ready) throw Error('Browser bridge/auth not ready; workspace retained. Resume after pairing the browser.');
        bridge = new SunoBridge({ base: app.origin, key: app.key, allow_verified_studio_writes: true });
      }
    }
    const observedBridge = { call: async (...args) => {
      const response = await bridge.call(...args);
      if(args[0]?.method === 'POST' && args[0]?.path === '/api/studio/render-state') await durableJson(join(work,'last-render-transport-response.json'),privacy.sanitize({requestBinding:{projectId:args[0].body?.studio_project_id,versionId:args[0].body?.studio_project_version_id,startBeats:args[0].body?.start_beats,endBeats:args[0].body?.end_beats},response}));
      return response;
    }};
    client ??= new StudioClient(observedBridge, { allow_verified_studio_writes: true });
    await collectProjectDiff(client, config, join(work, 'diagnostics'));
    const cachedUploads = config['reuse-uploads'] ? await readJson(resolve(config['reuse-uploads'])) : [];
    async function uploads(group, plan) {
      const dir = join(work, 'slices', group); await mkdir(dir, { recursive: true });
      return boundedMap(plan, config['upload-concurrency'], async s => {
        let record = uploadStore[group]?.[s.index];
        if (resumableSlice(record, s) && record.status === 'complete') { await log({ event: 'upload_reused', index: s.index, mode: group }); return record; }
        if (record && !resumableSlice(record,s)) await log({event:'slice_mapping_changed',mode:group,index:s.index,oldHash:record.localHash,newHash:s.localHash,oldClipId:record.clipId ?? null});
        const cache = cachedUploads.find(c => c.clipId && (c.localHash === undefined || c.localHash === s.localHash) && (resumableSlice(c,s) || c.index === s.index && c.startSec === s.startSec && c.durSec === s.durSec && s.readOffsetSeconds === 0));
        if (cache?.file) {
          const bytes = await readFile(cache.file).catch(() => null);
          if (bytes && sha256(bytes) === s.localHash) { record = { ...s, clipId: cache.clipId, uploadId: cache.uploadId, status: 'complete', reusedFromHashVerifiedEvidence: true, stages: {} }; await checkpoint(group, record); await log({ event: 'upload_reused', index: s.index, mode: group }); return record; }
        }
        const file = join(dir, `slice_${String(s.index).padStart(3, '0')}.wav`); await writeSlice(pcm, s, file);
        return uploadSlice(bridge, s, file, record, r => checkpoint(group, r), log);
      });
    }
    async function render(mode, slices, transpose, probeTimes, strategy = 'exact') {
      const dir = join(work, mode); await mkdir(dir, { recursive: true }); jobs[mode] ??= {};
      const job = jobs[mode], title = `Studio ${mode} ${work.split(/[\\/]/).pop()}`;
      if (['create_submitting','save_submitting','render_submitting'].includes(job.phase)) throw Error(`${mode}: remote outcome unknown at ${job.phase}; reconcile jobs.json binding before resume`);
      const plannedWire=buildTimeline(template,slices,{transpose,title,bps:config.bps,strategy});
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
      const readbackDiff = semanticDiff(wire, readback.state);
      await durableJson(join(dir, 'diagnostics-readback-diff.json'), privacy.sanitize(readbackDiff));
      const sourceIds=w=>w.tracks.flatMap(t=>t.clips.map(c=>c.asset?.id ?? c.clipId));
      if (readbackDiff.changes.length || JSON.stringify(sourceIds(wire))!==JSON.stringify(sourceIds(readback.state))) throw Error('Save readback changed playback semantics/source ids; inspect readback diff');
      const endBeats = timeline.expectedTimelineSeconds * config.bps; // Never ceil: that adds an audible tail.
      const renderTiming = transformRenderState(inspectEditorState(editor)).timing;
      if (!job.renderClipId) {
        const submitted = await submit(job, 'render_submitting', 'saved', () => client.render_project({ title, project_id: job.projectId, studio_project_id: job.projectId, studio_project_version_id: job.versionId,
          web_client_pathname: '/studio', lyrics: '', state: prepareRenderTransformedState(editor, transformRenderState, serializeAudioProjectState),
          start_beats: 0, end_beats: endBeats, downbeats: deriveDownbeats(renderTiming, 0, endBeats), export_mode: 'fullsong_export' }));
        job.renderClipId = submitted.id; job.phase = 'render_queued'; await persistJobs();
        await durableJson(join(dir, 'render-response.json'), privacy.sanitize(submitted));
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
              return render(mode,slices,transpose,probeTimes,strategy);
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
      const metadata = complete.metadata;
      if (metadata?.studio_project_id !== job.projectId || metadata.studio_project_version_id !== job.versionId || metadata.studio_project_start_beats !== 0 || metadata.studio_project_end_beats !== endBeats) throw Error('Completed render binding/range mismatch');
      await durableJson(join(dir, 'render-complete.json'), privacy.sanitize(complete));
      const downloaded = join(dir, 'downloaded.audio'), final = join(dir, 'final.wav');
      if (job.downloadHash) {
        try { await probe(downloaded); } catch {
          await log({ event: 'invalid_download_retired', mode, hash: job.downloadHash }); job.downloadHash = null; job.phase = 'render_queued'; await persistJobs();
        }
      }
      if (!job.downloadHash) {
        let downloadURL;
        for (let i = 0; i < 90; i++) {
          const response = await retry429(() => bridge.call({ method: 'GET', path: `/api/download/clip/${job.renderClipId}?format=m4a`, timeoutMs: 30000 }), { log });
          await durableJson(join(dir, 'download-response.json'), privacy.sanitize(response));
          const d = response.result;
          if (d?.status === 'ready' && d.download_url && !d.download_url.includes('<redacted>')) { downloadURL = d.download_url; break; }
          if (d?.status !== 'processing') throw Error('Official unlocked-song download unavailable or response invalid; no player stream interception fallback');
          if (i % 5 === 0) await log({ event: 'download_preparing', mode }); await pause(2000);
        }
        if (!downloadURL) throw Error('Official download preparation timed out; resume retains render id');
        let downloadedOK = false;
        for (let attempt=0;attempt<3;attempt++) {
          try { const u = new URL(downloadURL); if (u.protocol !== 'https:' || !/(?:\.amazonaws\.com|\.suno\.ai|\.suno\.com|\.cloudfront\.net)$/.test(u.hostname)) throw Error('Unexpected download destination');
            const res = await retry429(async () => { const r = await fetch(u, { signal: AbortSignal.timeout(120000) }); if (!r.ok) { const e = Error(`Download HTTP ${r.status}`); e.status = r.status; e.retryAfter = r.headers.get('retry-after'); throw e; } return r; }, { log });
            const bytes = Buffer.from(await res.arrayBuffer()); if (bytes.length < 128) throw Error('Empty render'); await writeFile(downloaded, bytes); await probe(downloaded); job.downloadHash = sha256(bytes); downloadedOK = true; break;
          } catch (e) { await log({ event: 'download_candidate_failed', mode, attempt, message: e.message }); if ([401,403,404].includes(e.status)) break; if(attempt<2)await pause(500*2**attempt); }
        }
        if (!downloadedOK) throw Error('No valid render download candidate; resume will not recreate project');
        job.phase = 'downloaded'; await persistJobs();
      }
      const downloadedBytes = await readFile(downloaded); if (sha256(downloadedBytes) !== job.downloadHash) throw Error('Downloaded audio changed');
      const finalPCM = await decode(downloaded, final);
      const analysis = analyzeBoundaries(finalPCM, probeTimes ?? timeline.boundariesSeconds); analysis.responseValidated = true;
      const gate = qualityGate(analysis, timeline.expectedTimelineSeconds, metadata.duration);
      gate.silentGaps = silentGaps(finalPCM);
      // Long interior absolute silences are reported separately from music-relative dips.
      gate.silenceCandidates = gate.silentGaps.map(g => {
        const center = Math.round((g.start + g.end) / 2 * pcm.sampleRate);
        const sourceRms = Math.max(...windowMetrics(pcm, center, Math.round((g.end - g.start) / 2 * pcm.sampleRate)).channels.map(c => c.rms));
        return { ...g, sourceRms, unexpected: sourceRms >= .001 };
      });
      for (const gap of gate.silenceCandidates.filter(g => g.unexpected && g.start > .1 && g.end < analysis.duration - .1 && g.end - g.start > .05)) gate.warnings.push({ metric: 'unexpected_silent_gap', severity: 'warning', timestamp: gap.start, duration: gap.end - gap.start });
      if (gate.warnings.length) gate.status = 'QUALITY WARNING';
      await writeAnalysis(join(dir, 'diagnostics'), analysis, finalPCM, !!config.diagnose);
      await durableJson(join(dir, 'diagnostics', 'quality-gate.json'), gate);
      for (const warning of gate.warnings) await log({ event: 'QUALITY WARNING', mode, ...warning });
      const summary = { mode, projectId: job.projectId, versionId: job.versionId, renderClipId: job.renderClipId, outputFile: final,
        boundaryCount: timeline.boundariesSeconds.length, analysisProbeCount: analysis.boundaryCount, detectedAnomalyCount: analysis.detectedAnomalyCount,
        averageBoundaryScore: analysis.averageBoundaryScore, maxBoundaryScore: analysis.maxBoundaryScore, duration: analysis.duration, expectedDuration: timeline.expectedTimelineSeconds,
        classification: gate.status, strategy, transpose, endBeats, outputHash: sha256(await readFile(final)) };
      job.phase = 'complete'; job.summary = summary; await persistJobs(); await log({ event: 'render_complete', mode, message: gate.status });
      return { summary, analysis, wire, gate };
    }
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
    const finalPlan = slicePlan(pcm, { ...planOptions, ...(strategy === 'preroll' ? { prerollMs: config['preroll-ms'], postrollMs: config['postroll-ms'] } : {}) });
    const uploaded = await uploads(strategy === 'exact' ? 'exact' : `handles-${config['preroll-ms']}`, finalPlan);
    const productionMode = strategy === 'exact' ? 'PRODUCTION' : 'PRODUCTION_PREROLL';
    // A completed controlled experiment can already be the exact production render.
    // Reuse its verified project/version binding instead of requesting identical DSP twice.
    const matchingMode = strategy === 'exact' ? 'SLICED_NEG8_TRANSPOSE' : `HANDLE_ALIGNED_${config['preroll-ms']}`;
    const matching = jobs[matchingMode];
    if (!jobs[productionMode] && matching?.phase === 'complete') {
      const planned = buildTimeline(template,uploaded,{transpose:config['studio-transpose'],title:'Production',bps:config.bps,strategy});
      const ids = w => w.tracks.flatMap(t=>t.clips.map(c=>c.asset?.id));
      if (JSON.stringify(ids(matching.wire)) === JSON.stringify(ids(planned)) && semanticDiff(matching.wire,planned).changes.length===0) {
        jobs[productionMode]=structuredClone(matching); await persistJobs();
        await mkdir(join(work,productionMode),{recursive:true});
        await copyFile(join(work,matchingMode,'downloaded.audio'),join(work,productionMode,'downloaded.audio'));
        await log({event:'production_reused_verified_experiment',mode:matchingMode});
      }
    }
    const production = await render(productionMode, uploaded, config['studio-transpose'], undefined, strategy);
    await mkdir(join(work, 'diagnostics'), { recursive: true });
    await copyFile(join(work, productionMode, 'diagnostics', 'boundaries.json'), join(work, 'diagnostics', 'boundaries.json'));
    await copyFile(join(work, productionMode, 'diagnostics', 'boundaries.csv'), join(work, 'diagnostics', 'boundaries.csv'));
    const output = resolve(config.output ?? join(work, 'final.wav'));
    if (extname(output).toLowerCase() !== '.wav') throw Error('--output must end in .wav; final decode is PCM WAV (original delivery format remains in downloaded.audio)');
    await mkdir(dirname(output), { recursive: true }); if (output !== production.summary.outputFile) await copyFile(production.summary.outputFile, output);
    const result = { work, output, strategy, abc: abc?.classification ?? 'NOT_RUN', ...production.summary, quality: production.gate.status };
    await durableJson(join(work, 'summary.json'), result);
    if (!config['keep-workdir'] && !config.diagnose) {
      // Only task-owned large intermediates; checkpoint hashes/IDs remain for resume.
      const sliceDir = resolve(work, 'slices'); if (!sliceDir.startsWith(work + '\\') && !sliceDir.startsWith(work + '/')) throw Error('Cleanup path escaped run');
      await rm(sliceDir, { recursive: true, force: true }); await unlink(processed);
    }
    await log({ event: 'run_complete', message: output, strategy, quality: result.quality }); return result;
  } catch (e) { await log({ event: 'run_failed', message: e.message, kind: e.kind, status: e.status, workspaceRetained: true }); throw e; }
  finally { await app?.close(); await logQueue; await unlink(lockPath); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const config = parseConfig(process.argv.slice(2)); if (config.help) console.log(help); else console.log(JSON.stringify(await runPipeline(config), null, 2)); }
  catch (e) { console.error(privacy.sanitize({ error: e.message, kind: e.kind, status: e.status })); process.exitCode = 1; }
}
