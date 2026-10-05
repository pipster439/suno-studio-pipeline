import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SunoBridge } from '../suno/bridge/client.mjs';
import { StudioClient } from '../suno/studio/operations.mjs';
test('explicit read-only known project/version correlation', { skip: process.env.RUN_SUNO_INTEGRATION_TESTS !== '1' }, async () => {
  const project = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json', import.meta.url), 'utf8'));
  const client = new StudioClient(new SunoBridge({ base: process.env.SUNO_CONTROLLER_BASE || 'http://127.0.0.1:3000' }));
  const version = await client.get_project_version(project.id, project.latest_version_id);
  assert.equal(version.id, project.latest_version_id); assert.equal(version.project_id, project.id);
  assert.equal(version.state.tracks.length, 1); assert.equal(version.state.tracks[0].clips.length, 20);
});
