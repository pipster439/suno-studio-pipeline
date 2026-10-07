import { trustedDeliveryURL } from './remote-qa.mjs';
import { retryDelay } from './upload.mjs';

export const RENDER_LIFECYCLE = Object.freeze({ version: 1, timeoutMs: 900000,
  deliveryTimeoutMs: 180000, pollingMs: [1000, 2000, 3000, 5000, 8000, 10000] });
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function matches(clip, binding) {
  const m = clip?.metadata;
  return m?.studio_project_id === binding.projectId && m.studio_project_version_id === binding.versionId &&
    m.studio_project_start_beats === binding.startBeats && m.studio_project_end_beats === binding.endBeats;
}
function usableURL(value) {
  if (typeof value !== 'string' || /<redacted>|%3credacted%3e/i.test(value)) return false;
  try { const url = trustedDeliveryURL(value); return !/^\/api\//i.test(url.pathname); } catch { return false; }
}
export function recoverRenderAcknowledgement(captured, binding) {
  const request = captured?.requestBinding, clip = captured?.response?.result;
  if (captured?.response?.status !== 200 || !validId(clip?.id) || !['queued', 'processing', 'complete'].includes(clip.status)) return null;
  if (['projectId', 'versionId', 'startBeats', 'endBeats'].some(key => request?.[key] !== binding[key]) || !matches(clip, binding)) return null;
  return clip;
}
export function restoreRenderJobs(job, snapshots = [], now = Date.now()) {
  const previous = new Map((job.renderJobs ?? []).map(record => [record.id, record]));
  // Old "unavailable" IDs were only 404s, not proven permanent failures.
  const ids = [...(job.unavailableRenderIds ?? []), ...previous.keys(), ...snapshots.map(s => s.clip?.id), job.renderClipId].filter(validId);
  const seen = new Set();
  job.renderJobs = ids.filter(id => !seen.has(id) && seen.add(id)).map(id => {
    const snapshot = snapshots.find(s => s.clip?.id === id);
    const raw = previous.get(id)?.submittedAt ?? snapshot?.clip?.created_at;
    const submittedAt = new Date(timestamp(raw) ?? now).toISOString();
    const submissionTimeEstimated = previous.get(id)?.submissionTimeEstimated === true || timestamp(raw) === null;
    return { state: 'SUBMITTED', ...(snapshot?.binding ? { binding: snapshot.binding } : {}), ...previous.get(id), id, submittedAt, submissionTimeEstimated };
  });
  // Preserve known chronology; unknown timestamps retain their recorded order.
  if (!job.renderJobs.some(r => r.submissionTimeEstimated)) job.renderJobs.sort((a, b) => timestamp(a.submittedAt) - timestamp(b.submittedAt));
  job.renderClipId ??= job.renderJobs[0]?.id;
  return job.renderJobs;
}
export function rememberRenderSubmission(job, clip, binding, now = Date.now()) {
  if (!validId(clip?.id)) throw Error('Render submission has no valid durable id');
  restoreRenderJobs(job, [], now);
  let record = job.renderJobs.find(r => r.id === clip.id);
  if (!record) { record = { id: clip.id, submittedAt: new Date(now).toISOString(), state: 'SUBMITTED' }; job.renderJobs.push(record); }
  record.binding = binding; job.renderClipId = clip.id; job.phase = 'render_queued';
  return record;
}

export function selectAcknowledgedRender(job, jobs, id, binding) {
  const record = jobs.flatMap(j => j.renderJobs ?? []).find(r => r.id === id &&
    ['projectId','versionId','startBeats','endBeats'].every(k => r.binding?.[k] === binding[k]));
  if (!record) throw Error('Requested resume render is not acknowledged with this project/version/range');
  restoreRenderJobs(job);
  if (!job.renderJobs.some(r => r.id === id)) job.renderJobs.push(structuredClone(record));
  job.renderClipId = id;
  job.exportMode = record.exportMode ?? job.exportMode;
  return record;
}

// Only consume URLs actually returned for this clip. An HTTP 206 alone does not
// make encrypted player bytes a decodable delivery. No URL construction/decryption.
export async function probeObservedPlayer(clip, { fetch: request = globalThis.fetch } = {}) {
  const sources = [...(clip.media_urls ?? []).map((entry, index) => ({ url: entry.url, field: `media_urls[${index}].url` })),
    { url: clip.audio_url, field: 'audio_url' }].filter(s => usableURL(s.url));
  const failures = [];
  for (const source of sources) {
    let response, reader;
    try {
      response = await request(source.url, { headers: { Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(15000) });
      if (![200, 206].includes(response.status)) { failures.push({ field: source.field, status: response.status }); continue; }
      reader = response.body?.getReader(); let head = Buffer.alloc(0);
      while (reader && head.length < 32) { const part = await reader.read(); if (part.done) break; head = Buffer.concat([head, Buffer.from(part.value).subarray(0, 4096)]); }
      const magic = head.toString('ascii', 0, 12);
      const clear = /^(OggS|fLaC|ID3|RIFF)/.test(magic) || ['ftyp', 'styp'].includes(head.toString('ascii', 4, 8)) ||
        head[0] === 0xff && (head[1] & 0xe0) === 0xe0 || head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      if (clear) return { ...source, verifiedBy: 'observed_clip_source_and_clear_container_probe', responseStatus: response.status };
      failures.push({ field: source.field, status: response.status, reason: 'NOT_DECODABLE_PLAYER_SOURCE', encoding: clip.media_urls?.find(m => m.url === source.url)?.encoding ?? null });
    } catch (error) { failures.push({ field: source.field, reason: 'PLAYER_PROBE_UNAVAILABLE', status: error.status ?? null }); }
    finally { await reader?.cancel().catch(() => {}); await response?.body?.cancel().catch(() => {}); }
  }
  return { unavailable: true, failures };
}

// Best-effort ancillary delivery status. A materialized song remains successful
// on its official page even when these existing delivery reads are restricted.
export async function resolveOptionalDelivery(job, clip, {bridge,playerProbe=probeObservedPlayer,
  persist=async()=>{},observe=async()=>{},log=async()=>{}}={}) {
  const record=job.renderJobs?.find(r=>r.id===clip.id);
  const done=async(status,deliveryURL=null,deliverySource=null)=>{
    job.deliveryStatus=status;job.deliveryRenderId=clip.id;await persist();
    if(status==='RESTRICTED')await log({event:'delivery_restricted',id:clip.id,message:'Direct media delivery unavailable; using official Suno player page.'});
    return {deliveryStatus:status,deliveryURL,deliverySource};
  };
  if(record?.deliveryRestriction?.reason==='not_authorized')return done('RESTRICTED');
  let player;
  try{player=await playerProbe(clip);}catch(error){await log({event:'player_probe_unavailable',id:clip.id,status:error.status??null});}
  if(player?.url&&usableURL(player.url))return done('AVAILABLE',player.url,'OBSERVED_PLAYER_STREAM');
  try {
    const response=await bridge.call({method:'GET',path:`/api/download/clip/${clip.id}?format=m4a`,timeoutMs:30000});
    await observe('delivery',response);
    const delivery=response.result;
    if(delivery?.reason==='not_authorized'){
      if(record)record.deliveryRestriction={reason:'not_authorized',observedAt:new Date().toISOString()};
      return done('RESTRICTED');
    }
    if(delivery?.status==='ready'&&usableURL(delivery.download_url))return done('AVAILABLE',delivery.download_url,'OFFICIAL_DELIVERY');
  } catch(error) {await log({event:'delivery_status_unknown',id:clip.id,status:error.status??null});}
  return done('UNKNOWN');
}

// This module has no submission capability. All transitions retain acknowledged
// IDs, including TIMEOUT; subsequent resolution can observe them becoming ready.
export async function resolveRenderDelivery(job, { bridge, binding, snapshots = [], persist = async () => {},
  observe = async () => {}, log = async () => {}, now = Date.now, wait = sleep,
  timeoutMs = RENDER_LIFECYCLE.timeoutMs, deliveryTimeoutMs = RENDER_LIFECYCLE.deliveryTimeoutMs,
  playerProbe = probeObservedPlayer, preferredRenderId, metadataOnly = false } = {}) {
  let records = restoreRenderJobs(job, snapshots, now());
  if (preferredRenderId) {
    const index = records.findIndex(r => r.id === preferredRenderId);
    if (index < 0) throw Error('Preferred render ID is not acknowledged');
    // Resolution preference is explicit; stored chronological history is intact.
    records = [records[index], ...records.filter((_, i) => i !== index)];
  }
  if (!records.length) throw Error('No acknowledged render job to resolve');
  await persist();
  const outcomes = [];
  for (const record of records) {
    if (record.terminalFailure) { outcomes.push({ id: record.id, state: 'FAILED' }); continue; }
    job.renderClipId = record.id;
    const actualBinding = record.binding ?? binding;
    const cached = snapshots.find(s => s.clip?.id === record.id && s.clip.status === 'complete' && matches(s.clip, actualBinding));
    let complete = cached?.clip, evidence = complete ? 'PERSISTED_COMPLETE_READBACK' : 'LIVE_CLIP_READBACK';
    if (complete) record.metadataReadyAt ??= cached.observedAt ?? new Date(now()).toISOString();
    let attempt = 0, delay = 0, transientError;
    const age = () => Math.max(0, now() - (timestamp(record.submittedAt) ?? now()));
    const transition = async (state, details = {}) => {
      record.state = state; record.lastObservedAt = new Date(now()).toISOString();
      job.renderLifecycle = { version: RENDER_LIFECYCLE.version, state, selectedId: record.id, ageMs: age(), ...details };
      await persist(); await log({ event: 'render_wait', id: record.id, state, ageMs: age(), ...details });
    };
    const get = async path => {
      try { return await bridge.call({ method: 'GET', path, timeoutMs: 30000 }); }
      catch (error) {
        if (error.status === 404 || error.status === 405 || error.status === 429 || error.status >= 500 || ['network_error', 'timeout'].includes(error.kind)) { transientError = error; return null; }
        throw error; // Auth/validation rejection preserves the job; it is not a render terminal state.
      }
    };
    const pause = async remaining => {
      delay = transientError?.status === 429 ? retryDelay(transientError, attempt) : RENDER_LIFECYCLE.pollingMs[Math.min(attempt, 5)];
      transientError = null; attempt++; await wait(Math.max(0, Math.min(delay, remaining)));
    };
    const readMetadata = async () => {
      const primary = await get(`/api/clip/${record.id}`);
      if (primary || ![404,405].includes(transientError?.status)) return primary;
      // Existing reference-client iD/338609 template, documented in
      // REFERENCE_CLIENT_ANALYSIS.md; live response shape is { clips: [...] }.
      const alternate = await get(`/api/clips/get_songs_by_ids?ids=${encodeURIComponent(record.id)}`);
      const clip = alternate?.result?.clips?.find?.(c => c.id === record.id);
      if (!clip) return null; // Empty index is also temporary visibility, never missing proof.
      record.metadataEndpoint = 'OBSERVED_SONGS_BY_IDS_READ';
      return { result: clip };
    };
    await transition('QUEUED', { resumed: true });
    if (complete) {
      // Fresh explicit failure supersedes an archived completion. A transient
      // 404 does not erase already verified completion/range metadata.
      const current = await readMetadata();
      if (!current) await transition('WAITING_FOR_METADATA', { metadata: transientError?.status ?? 'unavailable', transient: true, persistedCompletion: true });
      else {
        if (current.result?.id !== record.id) throw Error('Render polling response id mismatch');
        if (current.result.status === 'error') {
          record.terminalFailure = { status: 'error', observedAt: new Date(now()).toISOString() };
          delete record.materialization;
          complete = null; await transition('FAILED', { serverTerminalFailure: true });
        } else if (current.result.status === 'complete' && matches(current.result, actualBinding)) {
          complete = current.result; evidence = 'LIVE_CLIP_READBACK';
        } else if (current.result.status === 'complete' && current.result.metadata?.studio_project_id) throw Error('Completed render binding/range mismatch');
      }
    }
    while (!complete && !record.terminalFailure) {
      const response = await readMetadata();
      if (response) {
        const clip = response.result;
        if (clip?.id !== record.id) throw Error('Render polling response id mismatch');
        await observe('metadata', clip);
        if (clip.status === 'error') {
          record.terminalFailure = { status: clip.status, observedAt: new Date(now()).toISOString() };
          delete record.materialization;
          await transition('FAILED', { serverTerminalFailure: true }); break;
        }
        if (clip.status === 'complete') {
          if (clip.metadata?.studio_project_id && !matches(clip, actualBinding)) throw Error('Completed render binding/range mismatch');
          if (matches(clip, actualBinding)) { complete = clip; record.metadataReadyAt ??= new Date(now()).toISOString(); break; }
          await transition('WAITING_FOR_METADATA', { metadata: 'pending', transient: true });
        } else await transition(clip.status === 'queued' ? 'QUEUED' : 'WAITING_FOR_METADATA', { metadata: clip.status, transient: true });
      } else await transition('WAITING_FOR_METADATA', { metadata: transientError?.status ?? 'unavailable', transient: true });
      if (age() >= timeoutMs) { await transition('TIMEOUT', { stage: 'metadata' }); break; }
      await pause(timeoutMs - age());
    }
    if (complete) {
      await observe('complete', complete);
      record.materialization = { status: 'complete', binding: actualBinding,
        duration: complete.metadata.duration ?? null, metadataType: complete.metadata.type ?? null,
        observedAt: new Date(now()).toISOString() };
      if (metadataOnly) {
        job.phase = 'render_ready';
        await transition('RENDER_READY', {metadataEvidence:evidence});
        await log({event:'render_ready',id:record.id,state:'RENDER_READY',ageMs:age(),metadataOnly:true});
        return {complete,record};
      }
      await transition('WAITING_FOR_DELIVERY', { metadataEvidence: evidence });
      attempt = 0;
      for (;;) {
        const response = await get(`/api/download/clip/${record.id}?format=m4a`);
        if (response) await observe('delivery', response);
        const delivery = response?.result;
        if (delivery?.reason === 'not_authorized') {
          // Render completion and permission to download are different facts.
          // Do not call this propagation delay, repeat exports, or try to decode
          // access-controlled player bytes. Official UI playback can still work.
          record.deliveryRestriction = { reason: 'not_authorized', observedAt: new Date(now()).toISOString() };
          job.phase = 'delivery_restricted';
          await transition('DELIVERY_RESTRICTED', { reason: 'not_authorized', materialized: true, transient: false });
          await log({event:'render_delivery_restricted',id:record.id,state:'DELIVERY_RESTRICTED',ageMs:age(),materialized:true,durableIdRetained:true});
          throw Object.assign(Error('Render materialized; official delivery permission denied (not_authorized). QA unavailable; acknowledged ID retained.'), {kind:'render_delivery_restricted', renderId:record.id});
        }
        let url, source = 'OFFICIAL_DELIVERY', observedField = 'download_url';
        if (delivery?.status === 'ready' && usableURL(delivery.download_url)) url = delivery.download_url;
        const deliveryAge = Math.max(0, now() - (timestamp(record.metadataReadyAt) ?? now()));
        if (!url) {
          await transition('WAITING_FOR_DELIVERY', { delivery: 'pending', reason: delivery?.reason ?? delivery?.status ?? transientError?.status ?? 'empty', transient: true });
          if (deliveryAge >= deliveryTimeoutMs) {
            const player = await playerProbe(complete);
            if (player?.url && usableURL(player.url) && [...(complete.media_urls??[]).map(m=>m.url),complete.audio_url].includes(player.url)) { url = player.url; source = 'OBSERVED_PLAYER_STREAM'; observedField = player.field; }
            else { await transition('TIMEOUT', { stage: 'delivery', playerFallback: player?.unavailable ? 'UNAVAILABLE' : 'NOT_OBSERVED' }); await log({ event: 'player_source_unavailable', id: record.id, failures: player?.failures ?? [] }); break; }
          }
        }
        if (url) {
          record.state = 'READY'; job.renderLifecycle = { version: 1, state: 'READY', selectedId: record.id, source, observedField, metadataEvidence: evidence };
          record.delivery = { source, observedField, readyAt: new Date(now()).toISOString() }; job.phase = 'qa_pending'; await persist();
          await log({ event: 'render_ready', id: record.id, state: 'READY', ageMs: age(), source, observedField });
          return { complete, deliveryURL: url, deliverySource: source, record };
        }
        await pause(deliveryTimeoutMs - deliveryAge);
      }
    }
    outcomes.push({ id: record.id, state: record.state });
    if (record.state === 'TIMEOUT') await log({ event: 'render_timeout', id: record.id, ageMs: age(), stage: job.renderLifecycle.stage, durableIdRetained: true });
    // Only proceed to another ALREADY ACKNOWLEDGED historical job after timeout
    // or explicit failure. Never submit a replacement or mark 404 permanent.
  }
  const failed = records.every(r => r.terminalFailure);
  job.phase = failed ? 'render_failed' : 'render_timeout'; await persist();
  const stage=job.renderLifecycle?.stage??'metadata';
  throw Object.assign(Error(failed ? 'Render FAILED: explicit server terminal failure; acknowledged IDs retained' : `Render TIMEOUT: ${stage} unresolved; acknowledged IDs retained, resume without resubmission`), { kind: failed ? 'render_failed' : 'render_timeout', outcomes, ...(failed?{}:{stage}) });
}
