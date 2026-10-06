import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { sha256 } from './pcm.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function retryDelay(error, attempt, random = Math.random, now = Date.now()) {
  const retry = error.retryAfter ?? error.details?.retryAfter;
  if (retry != null) { const seconds = Number(retry); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000); const date = Date.parse(retry); if (Number.isFinite(date)) return Math.max(0, date - now); }
  return Math.min(60000, 1000 * 2 ** attempt) * (.75 + random() * .5);
}
export async function retry429(fn, { retries = 5, wait = sleep, log = () => {} } = {}) {
  for (let attempt = 0;; attempt++) {
    try { return await fn(); } catch (e) { if (e.status !== 429 || attempt >= retries) throw e; const delayMs = retryDelay(e, attempt); await log({ event: 'rate_limit', attempt, delayMs }); await wait(delayMs); }
  }
}
export async function retryS3Transfer(fn,{retries=2,wait=sleep,log=()=>{}}={}) {
  for(let attempt=0;;attempt++) {
    try{return await fn();}catch(e){
      const transient=e instanceof TypeError&&/fetch failed/i.test(e.message)||['ECONNRESET','ETIMEDOUT','EPIPE'].includes(e.cause?.code)||e.status>=500&&e.status<=599;
      if(!transient||attempt>=retries)throw e;
      const delayMs=500*2**attempt;await log({event:'s3_transfer_retry',attempt,delayMs,message:e.message});await wait(delayMs);
    }
  }
}
export async function boundedMap(items, concurrency, fn) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw Error('Positive worker count required');
  const output = new Array(items.length); let cursor = 0, failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && cursor < items.length) { const i = cursor++; try { output[i] = await fn(items[i], i); } catch (e) { failure ??= e; } }
  }));
  if (failure) throw failure;
  return output;
}
export function resumableSlice(record, slice) { return record?.localHash === slice.localHash && record.index === slice.index && record.start === slice.start && record.end === slice.end && record.sourceStart === slice.sourceStart && record.sourceEnd === slice.sourceEnd; }
export async function uploadSlice(bridge, slice, file, record, checkpoint, log) {
  const bytes = await readFile(file); if (sha256(bytes) !== slice.localHash) throw Error('Slice hash changed before upload');
  if (!resumableSlice(record, slice)) record = { ...slice, status: 'pending', stages: {} };
  const stage = async (name, fn) => { const t = performance.now();let result;try{result=await retry429(fn,{log});}catch(error){error.uploadStage=name;throw error;}record.stages[name] = (record.stages[name] ?? 0) + performance.now() - t; await log({ event: 'upload_stage', index: slice.index, stage: name, milliseconds: record.stages[name] }); return result; };
  const call = async (method, path, body) => (await bridge.call({ method, path, ...(body === undefined ? {} : { body }), timeoutMs: 30000 })).result;
  if (record.status === 'complete' && record.clipId) return record;
  if (record.status === 'rejected' || record.processingError) { record.status='rejected'; await checkpoint(record); throw Error(`Previously rejected upload: ${record.processingError?.errorType ?? 'unknown'}; no replacement upload attempted`); }
  if (record.status === 'slot_created') {
    // A slot is not an initialized clip. Lost signed fields are deliberately not
    // persisted; retire the uncommitted slot and retry bytes in a new one.
    record.supersededUploadIds = [...(record.supersededUploadIds ?? []), record.uploadId];
    record.uploadId = null; record.status = 'pending'; await checkpoint(record);
  }
  if (!record.uploadId) {
    const slot = await stage('create_upload_slot', () => call('POST', '/api/uploads/audio/', { extension: 'wav', is_stem_mix: false, upload_type: 'file_upload' }));
    if (!slot?.id || !slot.url || !slot.fields || Object.values(slot.fields).some(v => String(v).includes('<redacted>'))) {
      await log({ event: 'upload_slot_shape', keys: Object.keys(slot ?? {}), fieldKeys: Object.keys(slot?.fields ?? {}), destinationHost: slot?.url ? new URL(slot.url).hostname : null, maskedFields: Object.keys(slot?.fields ?? {}).filter(k => String(slot.fields[k]).includes('<redacted>')) });
      throw Error('Upload parameters unavailable: bridge must preserve scoped presigned upload data in transit');
    }
    record.uploadId = slot.id; record.status = 'slot_created'; await checkpoint(record);
    const policyText=slot.fields.policy??slot.fields.Policy;
    let policy;try{policy=JSON.parse(Buffer.from(policyText??'', 'base64').toString('utf8'));}catch{}
    const range=policy?.conditions?.find(c=>Array.isArray(c)&&c[0]==='content-length-range');
    if(range&&Number.isSafeInteger(range[2])){record.uploadSizeConstraint={maxUploadBytes:range[2],source:'SIGNED_S3_CONTENT_LENGTH_RANGE'};await checkpoint(record);}
    if(range&&Number.isSafeInteger(range[2])&&bytes.length>range[2]) {
      const error=Error('WAV exceeds the signed upload size constraint');error.kind='technical_upload_constraint';error.constraintReason='size';error.maxUploadBytes=range[2];throw error;
    }
    // Signed credentials are ephemeral and must never enter checkpoint/log/evidence.
    await stage('S3_upload', async () => {
      const u = new URL(slot.url); if (u.protocol !== 'https:' || !/\.amazonaws\.com$/.test(u.hostname)) throw Error('Unexpected S3 upload destination');
      const form = new FormData(); for (const [k, v] of Object.entries(slot.fields)) form.append(k, v); form.append('file', new Blob([bytes], { type: 'audio/wav' }), basename(file));
      // Bytes to the same signed object can be replayed safely. Slot creation,
      // finish, initialize and Studio writes do not inherit this network retry.
      try {await retryS3Transfer(async()=>{
        const res = await fetch(u, { method: 'POST', body: form, signal: AbortSignal.timeout(600000) });
        if (!res.ok) { const e = Error(`S3 HTTP ${res.status}`); e.status = res.status; e.retryAfter = res.headers.get('retry-after'); throw e; }
      },{log:e=>log({...e,index:slice.index})});}catch(error){
        if(error instanceof TypeError&&/fetch failed/i.test(error.message)||['ECONNRESET','ETIMEDOUT','EPIPE'].includes(error.cause?.code)||error.status>=500&&error.status<=599){error.kind='technical_upload_constraint';error.constraintReason='transfer';}
        throw error;
      }
    });
    record.status = 's3_complete'; await checkpoint(record);
  }
  if (record.status === 's3_complete') {
    await stage('upload_finish', () => call('POST', `/api/uploads/audio/${record.uploadId}/upload-finish/`, { upload_type: 'file_upload', upload_filename: basename(file) }));
    record.status = 'processing'; await checkpoint(record);
  }
  if (!record.clipId) {
    let processed;
    await stage('processing_poll', async () => {
      for (let i = 0; i < 120; i++) { processed = await call('GET', `/api/uploads/audio/${record.uploadId}/`); if (processed.status === 'complete') return;
        if (processed.status === 'error') {
          record.status = 'rejected';
          record.processingError = { errorType: processed.error_type ?? null, errorMessage: processed.error_message ?? null };
          await checkpoint(record); await log({ event: 'upload_processing_failed', index: slice.index, ...record.processingError });
          const error=Error(`Suno upload processing failed (${processed.error_type ?? 'unknown'}): ${processed.error_message ?? 'no detail'}`);
          error.uploadErrorType=processed.error_type??null;
          const reason=`${processed.error_type??''} ${processed.error_message??''}`;
          if(/duration.*(?:exceed|too.long|maximum)|too.long.*duration/i.test(reason)){error.kind='technical_upload_constraint';error.constraintReason='duration';}
          if(/(?:file|upload).*(?:too.large|size.limit)|size.*(?:exceed|maximum)/i.test(reason)){error.kind='technical_upload_constraint';error.constraintReason='size';}
          throw error;
        } await sleep(2000); }
      throw Error('Upload processing timed out; resume reuses upload id');
    });
    if (record.status === 'initialize_submitting') throw Error('Initialize outcome unknown; reconcile clip id before resume');
    record.status = 'initialize_submitting'; await checkpoint(record);
    let clip;
    try { clip = await stage('initialize_clip', () => call('POST', `/api/uploads/audio/${record.uploadId}/initialize-clip/`, {})); }
    catch (e) { if ([400,401,403,404,409,422,429].includes(e.status)) { record.status='processing'; await checkpoint(record); } throw e; }
    record.clipId = clip?.clip_id ?? clip?.id; if (!record.clipId) throw Error('Initialize response lacks clip id');
    record.status = 'initialized'; await checkpoint(record);
  }
  await stage('metadata', () => call('POST', `/api/gen/${record.clipId}/set_metadata/`, { title: `Studio slice ${slice.index}`, is_audio_upload_tos_accepted: true, skip_notification: true, show_success_toast: false }));
  record.status = 'complete'; await checkpoint(record); return record;
}
