import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import privacy from '../../shared/privacy.cjs';
import { validateCall } from '../bridge/errors.mjs';
const forbiddenPath = /\/(?:auth|login|session|billing|subscription|subscriptions|entitlement|entitlements|permission|permissions|account|payment|payments)(?:\/|$)/i;
const forbiddenField = /subscription|entitlement|permission|^(?:account_?plan|pricing_?plan|plan_?id|tier)$/i;
function incomplete(value, depth = 0) {
  if (depth > 30) return true;
  if (typeof value === 'string') {
    if (value.includes('<redacted>')) return true;
    if (/^\s*[\[{]/.test(value)) { try { return incomplete(JSON.parse(value), depth + 1); } catch { /* ordinary string */ } }
    return false;
  }
  if (value && typeof value === 'object') return !!value.omitted || Object.values(value).some(v=>incomplete(v,depth+1));
  return false;
}
function changesPermissions(value, depth = 0) {
  if (depth > 30) return true;
  if (typeof value === 'string' && /^\s*[\[{]/.test(value)) { try { return changesPermissions(JSON.parse(value),depth+1); } catch { return false; } }
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, v]) => forbiddenField.test(key) || changesPermissions(v,depth+1));
}
export function planReferenceReplay(request, events) {
  if (request.kind !== 'console_request') throw new Error('only observed console request intent can be replayed to Suno; site backend URLs are not Suno endpoints');
  if (!request.requestId || !request.pageId) throw new Error('missing observed correlation identity');
  const group = events.filter((e) => e.pageId === request.pageId && e.requestId === request.requestId);
  if (group.filter((e) => e.kind === 'console_request').length !== 1) throw new Error('duplicate requestId is ambiguous; repeat the observation');
  const responses = group.filter((e) => e.kind === 'console_response');
  if (responses.length !== 1 || responses[0].data?.ok !== true || group.some((e) => e.kind === 'console_cancel')) throw new Error('need one successful reference response and no cancellation');
  const data = request.data;
  if (!data || typeof data.method !== 'string') throw new Error('method not explicitly recorded; confirm transport default before replay');
  const options = { method: data.method.toUpperCase(), path: data.path, timeoutMs: 30000 };
  validateCall(options);
  const u = new URL(options.path, 'https://studio-api-prod.suno.com');
  if (forbiddenPath.test(decodeURIComponent(u.pathname))) throw new Error('account/auth/subscription/entitlement/permission requests are excluded from replay');
  if (incomplete(options.path) || [...u.searchParams.values()].some(v=>incomplete(v))) throw new Error('redacted query is not replayable');
  if (!['absent','body','bodyJson'].includes(data.bodySource)) throw new Error('body provenance not recorded');
  if (data.bodySource !== 'absent') {
    if (!Object.prototype.hasOwnProperty.call(data, 'body')) throw new Error('recorded body missing');
    if (incomplete(data.body)) throw new Error('omitted/redacted body is not replayable');
    if (options.method !== 'GET' && changesPermissions(data.body)) throw new Error('permission/subscription/entitlement fields are excluded from writes');
    options.body = data.body;
  }
  return { options, originalRequestId: request.requestId, originalPageId: request.pageId,
    marker: request.marker, referenceStatus: responses[0].data.status ?? null,
    expectedResponseStructure: responses[0].data.responseStructure, automaticRetry: false, stateVerificationRequired: true };
}
export async function replayReference({ sessionId, record, execute = false, bridge, root = resolve('captures/reference') }) {
  if (!/^[\w-]{1,100}$/.test(sessionId || '') || !/^\d{6}$/.test(record || '')) throw new Error('use the exact reference session id and six-digit console request record');
  const dir = join(root, sessionId), names = (await readdir(join(dir, 'events'))).filter((n) => /^\d{6}\.json$/.test(n));
  const events = await Promise.all(names.map(async (n) => JSON.parse(await readFile(join(dir, 'events', n), 'utf8'))));
  const request = JSON.parse(await readFile(join(dir, 'events', record + '.json'), 'utf8'));
  const plan = planReferenceReplay(request, events);
  if (!execute) return { mode: 'plan', ...plan };
  if (!bridge) throw new Error('execution requires the existing localhost browser bridge');
  const requestId = randomUUID(), receipt = join(dir, 'replays', record + '-' + requestId + '.json');
  await mkdir(join(dir, 'replays'), { recursive: true });
  const audit = { source: 'explicit localhost replay; not reference observation', startedAt: new Date().toISOString(), plan, requestId, stateVerificationPending: true };
  await writeFile(receipt, JSON.stringify(privacy.redact(audit), null, 2) + '\n', { flag: 'wx' });
  try {
    const result = await bridge.call({ ...plan.options, requestId });
    await writeFile(receipt, JSON.stringify(privacy.redact({ ...audit, finishedAt: new Date().toISOString(), result }), null, 2) + '\n');
    return { mode: 'executed_once', receipt, result, stateVerificationPending: true }; // No automatic promotion to VERIFIED.
  } catch (error) {
    await writeFile(receipt, JSON.stringify(privacy.redact({ ...audit, error: error.toJSON?.() || { message: error.message }, remoteOutcomeMayBeUnknown: true }), null, 2) + '\n');
    throw error;
  }
}
