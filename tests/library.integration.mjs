import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SunoBridge } from '../suno/bridge/client.mjs';
import { LibraryClient } from '../suno/library/client.mjs';
import { ownLibraryBody } from '../suno/library/api.mjs';
test('explicit real own-library query matches an observed official capture', {
  skip: process.env.RUN_SUNO_INTEGRATION_TESTS !== '1' || !process.env.SUNO_LIBRARY_CAPTURE
}, async () => {
  const dir = process.env.SUNO_LIBRARY_CAPTURE;
  const request = JSON.parse(await readFile(join(dir, '001-request.json'), 'utf8'));
  const response = JSON.parse(await readFile(join(dir, '001-response.json'), 'utf8'));
  assert.equal(request.method, 'POST'); assert.equal(request.path, '/api/feed/v3'); assert.equal(response.status, 200);
  const ownerId = request.body?.filters?.user?.userId;
  assert.deepEqual(request.body, ownLibraryBody(ownerId));
  assert.ok(Array.isArray(response.body.clips)); assert.ok(response.body.clips.every(c => c.user_id === ownerId));
  const data = await new LibraryClient(new SunoBridge()).get_own_library_page(ownerId);
  assert.deepEqual(data.clips.map(c => c.id).sort(), response.body.clips.map(c => c.id).sort());
  assert.equal(data.has_more, response.body.has_more);
});
