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
test('all Studio operations remain unimplemented', () => {
  const client = new StudioClient({});
  for (const key of Object.getOwnPropertyNames(StudioClient.prototype).filter((k) => k !== 'constructor')) assert.throws(() => client[key](), NotImplementedError);
});
