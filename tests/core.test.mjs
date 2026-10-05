import test from 'node:test';
import assert from 'node:assert/strict';
import privacy from '../shared/privacy.cjs';
import { BridgeHub } from '../suno/bridge/hub.mjs';
import { apiError, validateCall } from '../suno/bridge/errors.mjs';
import { StudioClient, NotImplementedError } from '../suno/studio/operations.mjs';
function ready() {
  const hub = new BridgeHub(), messages = [], peer = { send(v) { messages.push(JSON.parse(v)); } };
  hub.attach(peer); hub.auth = { ready: true, state: 'ready' }; return { hub, peer, messages };
}
test('request correlation supports concurrent out-of-order replies and ignores duplicates/foreign peers', async () => {
  const { hub, peer, messages } = ready();
  const one = hub.call({ path: '/transport-fixture', requestId: 'one' });
  const two = hub.call({ path: '/transport-fixture', requestId: 'two' });
  assert.equal(messages.length, 2);
  assert.equal(hub.response({}, { requestId: 'one', ok: true }), false);
  hub.response(peer, { requestId: 'two', ok: true, status: 200, result: 2 });
  hub.response(peer, { requestId: 'one', ok: true, status: 201, result: 1 });
  assert.equal((await one).result, 1); assert.equal((await two).result, 2);
  assert.equal(hub.response(peer, { requestId: 'one', ok: true }), false);
  assert.equal(hub.pending.size, 0);
});
test('timeout sends a correlated cancel and cleans pending state', async () => {
  const { hub, messages } = ready();
  await assert.rejects(hub.call({ path: '/transport-fixture', requestId: 'timed', timeoutMs: 10 }), { kind: 'timeout' });
  assert.equal(messages[1].type, 'suno_api_cancel'); assert.equal(messages[1].id, 'timed'); assert.equal(hub.pending.size, 0);
});
test('explicit cancellation and AbortSignal never leave pending requests', async () => {
  const { hub } = ready(); const pending = hub.call({ path: '/transport-fixture', requestId: 'cancel-me' });
  hub.cancel('cancel-me'); await assert.rejects(pending, { kind: 'cancelled' });
  const abort = new AbortController(); const p = hub.call({ path: '/transport-fixture' }, { signal: abort.signal });
  abort.abort(); await assert.rejects(p, { kind: 'cancelled' }); assert.equal(hub.pending.size, 0);
});
test('disconnect fails in-flight writes; reconnect requires auth and never replays', async () => {
  const { hub, peer } = ready(); const p = hub.call({ method: 'PATCH', path: '/transport-fixture' });
  hub.detach(peer); await assert.rejects(p, { kind: 'network_error' });
  const messages = [], second = { send(v) { messages.push(v); } }; hub.attach(second);
  assert.throws(() => hub.call({ path: '/transport-fixture' }), { kind: 'auth_error' });
  assert.equal(messages.length, 0);
  hub.auth.ready = true; const q = hub.call({ path: '/transport-fixture', requestId: 'new' });
  hub.response(peer, { requestId: 'new', ok: true }); assert.equal(hub.pending.size, 1);
  hub.response(second, { requestId: 'new', ok: true, result: 7 }); assert.equal((await q).result, 7);
});
test('error parsing distinguishes API, auth, permission, validation, rate limit and transport failures', () => {
  for (const [status, kind] of [[401, 'auth_error'], [403, 'permission_error'], [400, 'validation_error'], [422, 'validation_error'], [429, 'rate_limit'], [503, 'suno_api_error'], [undefined, 'unknown_error']]) assert.equal(apiError({ status }).kind, kind);
  for (const kind of ['network_error', 'timeout', 'cancelled']) assert.equal(apiError({ kind }).kind, kind);
});
test('paths cannot escape the origin and only supported methods/timeouts pass', () => {
  for (const path of ['https://other.example/x', '//other.example/x', '/x\\y', '/x#secret', '/x%0Afoo', '/x y']) assert.throws(() => validateCall({ path }));
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(validateCall({ path: '/api/session/', method }).method, method);
  assert.throws(() => validateCall({ path: '/x', method: 'CONNECT' })); assert.throws(() => validateCall({ path: '/x', timeoutMs: 0 }));
});
test('redaction handles nested secrets, headers, JWT, signed URL query, non-JSON and size limits', () => {
  const marker = 'PRIVACY_TEST_SECRET_ONLY';
  const input = { authorization: marker, cookie: marker, 'set-cookie': marker, jwt: marker, sessionToken: marker, captcha_token: marker,
    'device-id': marker, nested: [{ createSessionToken: marker, data: 'Bearer ' + marker, url: 'https://cdn.example/audio?X-Amz-Signature=' + marker + '&other=' + marker }],
    relative: '/audio?ticket=' + marker, message: 'abcdefghijk.abcdefghijk.abcdefghijk', value: 42 };
  const text = JSON.stringify(privacy.redact(input)); assert.ok(!text.includes(marker)); assert.ok(!text.includes('abcdefghijk')); assert.ok(text.includes('42'));
  assert.ok(!JSON.stringify(privacy.headers({ 'x-unknown-credential': marker })).includes(marker));
  assert.equal(privacy.body(marker).omitted, 'non-json-body'); assert.equal(privacy.body('x'.repeat(200), 100).omitted, 'size-limit');
  assert.equal(privacy.redact({ '__proto__': null, constructor: { token: marker } }).constructor.token, '<redacted>');
});
test('unverified Studio operations remain unimplemented', () => {
  const client = new StudioClient({});
  for (const key of Object.getOwnPropertyNames(StudioClient.prototype).filter((k) => !['constructor', 'create_project', 'get_project_metadata', 'get_project', 'get_project_version', 'get_project_versions', 'save_project', 'render_project'].includes(k))) assert.throws(() => client[key](), NotImplementedError);
});

test('StudioClient blocks all creation variants and rejects unsafe ids before transport; read failures are never retried', async () => {
  let calls = 0; const error = new Error('transport failed');
  const client = new StudioClient({ async call() { calls++; throw error; } });
  await assert.rejects(client.create_project({ title: 'unverified title' }), NotImplementedError);
  await assert.rejects(client.create_project({ major_version: 1 }), NotImplementedError);
  for (const id of ['', '../other', 'a/b', 'a?token=x', undefined]) await assert.rejects(client.get_project_metadata(id), { kind: 'validation_error' });
  assert.equal(calls, 0);
  await assert.rejects(client.create_project(), NotImplementedError); assert.equal(calls, 0);
  await assert.rejects(client.get_project_metadata('safe-id'), error); assert.equal(calls, 1);
});

test('StudioClient treats wrong-id metadata as a contract failure and preserves unknown fields', async () => {
  const value = { id: 'transport-fixture', title: 'Untitled Project', major_version: 2, created_at: 'fixture', updated_at: 'fixture', archived: false, future_field: { value: 42 } };
  const client = new StudioClient({ async call() { return { status: 200, result: value }; } });
  await assert.rejects(client.get_project_metadata('other-id'), { kind: 'suno_api_error' });
  assert.deepEqual(await client.get_project_metadata(value.id), value);
});

test('business query allowlist survives both redaction passes while signed and foreign URLs stay masked', () => {
  const fields = { title: 'Untitled Project', major_version: '2', project_id: 'project-example', clip_id: 'clip-example', offset: '0.25', duration: '3.5', position: '-1' };
  const params = new URLSearchParams(fields);
  params.append('unknown', 'PRIVATE_UNKNOWN'); params.append('cookie', 'PRIVATE_COOKIE');
  params.append('position', '2');
  const raw = 'https://studio-api-prod.suno.com/transport-fixture?' + params;
  const once = privacy.url(raw), twice = privacy.url(once);
  assert.equal(twice, once);
  const query = new URL(once).searchParams;
  for (const [key, v] of Object.entries(fields)) assert.equal(query.get(key), v);
  assert.deepEqual(query.getAll('position'), ['-1', '2']);
  for (const key of ['unknown', 'cookie']) assert.equal(query.get(key), privacy.MASK);
  assert.equal(new URL(privacy.url(raw.replace('studio-api-prod.suno.com', 'cdn.example'))).searchParams.get('title'), privacy.MASK);
  for (const key of ['X-Amz-Signature', 'X-Goog-Credential', 'Signature', 'sig', 'token', 'Policy', 'Key-Pair-Id']) {
    const signed = new URL(privacy.url(raw + '&' + key + '=PRIVATE_SIGNATURE'));
    for (const v of signed.searchParams.values()) assert.equal(v, privacy.MASK);
  }
  const relative = privacy.url('/transport-fixture?title=hello%20world&major_version=2&TITLE=private');
  const rq = new URL(relative, 'https://studio-api-prod.suno.com').searchParams;
  assert.equal(rq.get('title'), 'hello world'); assert.equal(rq.get('TITLE'), privacy.MASK);
  const nested = privacy.body(JSON.stringify({ ...fields, authorization: 'PRIVATE_AUTH', url: raw }));
  for (const [key, v] of Object.entries(fields)) assert.equal(nested[key], v);
  assert.equal(nested.authorization, privacy.MASK);
  assert.equal(new URL(nested.url).searchParams.get('project_id'), fields.project_id);
  assert.equal(privacy.headers({ title: fields.title }).title, privacy.MASK);
});

test('allowlisted query values still scrub recognizable credentials and nested signed URLs', () => {
  const jwt = 'abcdefghijk.abcdefghijk.abcdefghijk';
  const nested = 'https://cdn.example/audio?Signature=PRIVATE_SIGNED';
  const params = new URLSearchParams({ title: 'Bearer PRIVATE_TOKEN', project_id: jwt, clip_id: nested, duration: 'authorization=PRIVATE_AUTH' });
  const redacted = privacy.url('/transport-fixture?' + params);
  assert.ok(!redacted.includes('PRIVATE_')); assert.ok(!redacted.includes('abcdefghijk'));
  assert.ok(!JSON.stringify(privacy.redact({ title: jwt, position: 'Bearer PRIVATE_TOKEN' })).includes('PRIVATE_'));
});
