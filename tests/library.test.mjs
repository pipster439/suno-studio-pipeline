import test from 'node:test';
import assert from 'node:assert/strict';
import { LibraryClient } from '../suno/library/client.mjs';
import { BridgeError } from '../suno/bridge/errors.mjs';
const owner = '11111111-2222-3333-4444-555555555555';
// Field types and entity discriminator come from the real official capture, not the array name.
const result = { has_more: false, clips: [{ id: 'resource-fixture', title: 'fixture', status: 'complete', entity_type: 'song_schema', user_id: owner, extra: { future: true } }] };
test('verified own-library contract preserves string filters, correlation options and extra resource fields', async () => {
  let call;
  const signal = new AbortController().signal;
  const client = new LibraryClient({ call: async (opts, control) => { call = { opts, control }; return { status: 200, result }; } });
  assert.equal(await client.get_own_library_page(owner, { timeoutMs: 4500, requestId: 'correlation-fixture', signal }), result);
  assert.equal(call.opts.method, 'POST'); assert.equal(call.opts.path, '/api/feed/v3');
  assert.deepEqual(call.opts.body, { cursor: null, limit: 20, filters: { disliked: 'False', trashed: 'False',
    fromStudioProject: { presence: 'False' }, stem: { presence: 'False' }, stemComplement: 'False', user: { presence: 'True', userId: owner } } });
  assert.equal(call.opts.requestId, 'correlation-fixture'); assert.equal(call.opts.timeoutMs, 4500); assert.equal(call.control.signal, signal);
});
test('invalid account ids never reach transport; malformed or foreign-owner responses never pass', async () => {
  let calls = 0, next;
  const client = new LibraryClient({ call: async () => { calls++; return { status: 200, result: next }; } });
  for (const id of [null, '', '../account', owner + '?token=PRIVATE_MARKER']) await assert.rejects(client.get_own_library_page(id), e => e.kind === 'validation_error');
  assert.equal(calls, 0);
  for (next of [{ clips: {} }, { ...result, has_more: null }, { ...result, clips: [{ ...result.clips[0], user_id: 'other-owner' }] }, { ...result, clips: [{ ...result.clips[0], entity_type: 'track' }] }, { ...result, clips: [{ ...result.clips[0], entity_type: 'clip' }] }]) {
    const before = calls; await assert.rejects(client.get_own_library_page(owner), e => e.kind === 'suno_api_error'); assert.equal(calls, before + 1);
  }
});
test('library transport failures are propagated without retry or fallback', async () => {
  let calls = 0; const error = new BridgeError('auth_error', 'expired', 401);
  const client = new LibraryClient({ call: async () => { calls++; throw error; } });
  await assert.rejects(client.get_own_library_page(owner), e => e === error); assert.equal(calls, 1);
});
