import test from 'node:test';
import assert from 'node:assert/strict';
import { SunoBridge } from '../suno/bridge/client.mjs';
test('explicit real Suno browser/Tampermonkey round-trip, read-only session probe', { skip: process.env.RUN_SUNO_INTEGRATION_TESTS !== '1' }, async () => {
  const bridge = new SunoBridge(); const result = await bridge.request('/api/probe', {});
  assert.equal(result.ok, true); assert.ok(result.status >= 200 && result.status < 300);
});
