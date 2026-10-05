// Explicit, read-only experiment. No token/header logging and no retries.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SunoBridge } from '../suno/bridge/client.mjs';
import privacy from '../shared/privacy.cjs';

export function schema(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', length: value.length,
    items: [...new Map(value.map(v => { const s = schema(v); return [JSON.stringify(s), s]; })).values()] };
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, schema(value[k])]));
  return typeof value;
}
function canonical(v, includeDisplayLabels = false) {
  if (Array.isArray(v)) return v.map(item => canonical(item, includeDisplayLabels));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort()
    .filter(k => includeDisplayLabels || k !== 'title' && k !== 'name').map(k => [k, canonical(v[k], includeDisplayLabels)]));
  return v;
}
export function compareState(actual, expected) {
  const digest = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  return { equalExceptDisplayLabels: digest(actual) === digest(expected),
    actualDigest: digest(actual), expectedDigest: digest(expected),
    tracks: actual?.tracks?.length ?? null,
    clips: actual?.tracks?.reduce((n, t) => n + (t.clips?.length || 0), 0) ?? null };
}
export function compareExactState(actual, expected) {
  const digest = v => createHash('sha256').update(JSON.stringify(canonical(v, true))).digest('hex');
  return { equal: digest(actual) === digest(expected), actualDigest: digest(actual), expectedDigest: digest(expected) };
}
export async function verifyVersion({ bridge, project, rawProject, requireLossless = false, transportEvidence, output }) {
  const projectId = project.id, versionId = project.latest_version_id;
  const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v);
  if (!id(projectId) || !id(versionId)) throw new Error('baseline must supply real project/version identifiers');
  if (rawProject && (rawProject.id !== projectId || rawProject.latest_version_id !== versionId)) throw new Error('raw baseline project/version relation must match fixture');
  if (requireLossless && !rawProject) throw new Error('lossless experiment requires an explicit real raw project baseline');
  const record = { timestamp: new Date().toISOString(), source: 'explicit localhost/Tampermonkey replay',
    method: 'GET', path: `/api/studio/${projectId}/version/${versionId}`, status: null,
    requestId: 'version-read-' + Date.now(), projectId, versionId, responseSchema: null, statePresence: false, verified: false,
    ...(transportEvidence ? { transportEvidence: {
      bridgeOnline: transportEvidence.bridgeOnline === true, authReady: transportEvidence.authReady === true,
      userscriptVersion: /^[\d.]{1,20}$/.test(transportEvidence.userscriptVersion || '') ? transportEvidence.userscriptVersion : null,
      buildId: /^[a-f0-9]{64}$/.test(transportEvidence.buildId || '') ? transportEvidence.buildId : null } } : {}) };
  try {
    const response = await bridge.call({ method: record.method, path: record.path,
      requestId: record.requestId, timeoutMs: 30000 });
    record.status = response.status; const result = response.result;
    record.responseSchema = schema(result); record.statePresence = !!result?.state;
    record.relation = { baselineProjectId: projectId, baselineLatestVersionId: versionId,
      responseId: result?.id === versionId ? result.id : null,
      responseProjectId: result?.project_id === projectId ? result.project_id : null,
      responseVersionId: result?.version_id === versionId ? result.version_id : null };
    if (record.statePresence) {
      record.stateComparison = compareState(result.state, project.state);
      record.transportProjectionComparison = compareState(result.state, privacy.redact(project.state));
      record.maskedStatePaths = maskedPaths(result.state);
      if (rawProject) record.exactRawStateComparison = compareExactState(result.state, rawProject.state);
      record.losslessState = record.maskedStatePaths.length === 0 && record.exactRawStateComparison?.equal === true;
      record.timeSignatureChangesComparison = {
        schema: schema(result.state.timeSignatureChanges),
        equal: compareExactState(result.state.timeSignatureChanges, (rawProject || project).state.timeSignatureChanges).equal };
    }
    record.verified = response.status >= 200 && response.status < 300 &&
      result?.id === versionId && result?.project_id === projectId &&
      record.transportProjectionComparison?.equalExceptDisplayLabels === true;
    if (requireLossless) record.verified = record.verified && record.losslessState === true;
  } catch (e) { record.error = { kind: e.kind || 'local_error', status: e.status ?? null,
    message: privacy.redact(e.message) }; record.status = e.status ?? null; }
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(record, null, 2) + '\n'); }
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.RUN_SUNO_INTEGRATION_TESTS !== '1') throw new Error('set RUN_SUNO_INTEGRATION_TESTS=1 for this read-only live experiment');
  const project = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json', import.meta.url), 'utf8'));
  const rawProject = process.env.SUNO_PROJECT_RAW_BASELINE ? JSON.parse(await readFile(process.env.SUNO_PROJECT_RAW_BASELINE, 'utf8')) : undefined;
  const base = process.env.SUNO_CONTROLLER_BASE || 'http://127.0.0.1:3000';
  let transportEvidence;
  if (process.env.SUNO_REQUIRE_USERSCRIPT_VERSION) {
    const r = await fetch(base + '/api/status', { headers: { 'X-Controller-Key': process.env.SUNO_CONTROLLER_KEY } });
    const status = await r.json();
    if (!r.ok || !status.bridgeOnline || !status.authStatus?.ready || status.authStatus.version !== process.env.SUNO_REQUIRE_USERSCRIPT_VERSION ||
        process.env.SUNO_REQUIRE_USERSCRIPT_BUILD_ID && status.authStatus.buildId !== process.env.SUNO_REQUIRE_USERSCRIPT_BUILD_ID) throw new Error('required authenticated userscript version/build not ready; no Suno request dispatched');
    transportEvidence = { bridgeOnline: true, authReady: true, userscriptVersion: status.authStatus.version, buildId: status.authStatus.buildId };
  }
  const record = await verifyVersion({ bridge: new SunoBridge({ base }), project, rawProject,
    requireLossless: process.env.SUNO_REQUIRE_LOSSLESS_STATE === '1', transportEvidence,
    output: resolve(process.argv[2] || 'captures/version-verification/version-read.json') });
  const { responseSchema, ...summary } = record;
  console.log(JSON.stringify(summary, null, 2)); if (!record.verified) process.exitCode = 1;
}

export function maskedPaths(value, path = '$') {
  if (value === privacy.MASK) return [path];
  return value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => maskedPaths(v, path + '.' + k)) : [];
}
