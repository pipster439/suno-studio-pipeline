// Only the explicitly known project. Never treats version ids as revision ids.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SunoBridge } from '../suno/bridge/client.mjs';
import { schema } from './verify-studio-version.mjs';
import privacy from '../shared/privacy.cjs';
export async function verifyVersions({ bridge, project, output }) {
  if (!/^[A-Za-z0-9_-]+$/.test(project.id)) throw new Error('explicit real project id required');
  const record = { timestamp: new Date().toISOString(), method: 'GET',
    path: `/api/studio/${project.id}/versions?return_days_only=false`, status: null,
    source: 'explicit localhost/Tampermonkey replay', responseSchema: null, verified: false };
  try {
    const response = await bridge.call({ method: 'GET', path: record.path,
      requestId: 'versions-read-' + Date.now(), timeoutMs: 30000 });
    record.status = response.status; record.responseSchema = schema(response.result);
    record.responseProjectId = response.result?.id === project.id ? project.id : null;
    // Record only IDs, already safe business identifiers, never owners, titles or headers.
    record.ids = [];
    function visit(v, path = '$') {
      if (!v || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        if (['id', 'version_id', 'project_id', 'revision_id'].includes(k) && typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x)) record.ids.push({ path: path + '.' + k, value: x });
        if (x && typeof x === 'object') visit(x, path + '.' + k);
      }
    }
    visit(response.result);
    record.includesKnownLatestVersion = record.ids.some(x => x.value === project.latest_version_id);
    record.verified = response.status >= 200 && response.status < 300 && record.responseProjectId === project.id && record.includesKnownLatestVersion;
  } catch (e) { record.error = { kind: e.kind || 'local_error', status: e.status ?? null, message: privacy.redact(e.message) }; record.status = e.status ?? null; }
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(record, null, 2) + '\n'); }
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.RUN_SUNO_INTEGRATION_TESTS !== '1') throw new Error('explicit read-only live gate required');
  const project = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json', import.meta.url), 'utf8'));
  const record = await verifyVersions({ bridge: new SunoBridge({ base: process.env.SUNO_CONTROLLER_BASE || 'http://127.0.0.1:3000' }), project,
    output: resolve(process.argv[2] || 'captures/version-verification/versions-list.json') });
  console.log(JSON.stringify(record, null, 2)); if (!record.verified) process.exitCode = 1;
}
