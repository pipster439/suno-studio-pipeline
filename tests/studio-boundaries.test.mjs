import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StudioClient, NotVerifiedError } from '../suno/studio/operations.mjs';
import { projectVersion, projectVersions } from '../suno/studio/models.mjs';
import * as states from '../suno/studio/state-boundaries.mjs';
import * as builders from '../suno/studio/request-builders.mjs';
import { compareState, compareExactState, verifyVersion } from '../scripts/verify-studio-version.mjs';
import { verifyVersions } from '../scripts/verify-studio-versions.mjs';
import privacy from '../shared/privacy.cjs';
import { SunoBridge } from '../suno/bridge/client.mjs';
import { BridgeHub } from '../suno/bridge/hub.mjs';
const project = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json', import.meta.url), 'utf8'));
// Unit transport double: observed response shape, NOT a newly claimed live fixture.
const version = () => ({ id: project.latest_version_id, project_id: project.id, state: structuredClone(project.state), future: { keep: true } });
test('verified version getter preserves open response, correlation options and both identities', async () => {
  let call, control; const body = version(), signal = new AbortController().signal;
  const client = new StudioClient({ call: async (o, c) => { call = o; control = c; return { status: 200, result: body }; } });
  assert.equal(await client.get_project_version(project.id, project.latest_version_id, { timeoutMs: 1200, requestId: 'version-unit', signal }), body);
  assert.deepEqual(call, { method: 'GET', path: `/api/studio/${project.id}/version/${project.latest_version_id}`, timeoutMs: 1200, requestId: 'version-unit' });
  assert.equal(control.signal, signal);
  for (const bad of ['', '../x', 'x/y', 'x?token=y', undefined]) await assert.rejects(client.get_project_version(project.id, bad), { kind: 'validation_error' });
});
test('version/list readers reject wrong identity, missing state or list instead of inventing data', () => {
  for (const v of [{ ...version(), id: 'wrong' }, { ...version(), project_id: 'wrong' }, { id: project.latest_version_id, project_id: project.id }])
    assert.throws(() => projectVersion({ status: 200, result: v }, project.id, project.latest_version_id), { kind: 'suno_api_error' });
  assert.throws(() => projectVersions({ result: { id: project.id, versions: [] } }, project.id), { kind: 'suno_api_error' });
});
test('verified versions getter keeps grouped history and extra fields, with no retries', async () => {
  const body = { id: project.id, aggregated_versions: [{ hour: 'unit', versions: [{ version_id: project.latest_version_id, version: 1, extra: 7 }] }], unknown: 1 };
  let calls = 0; const client = new StudioClient({ call: async o => { calls++; assert.equal(o.method, 'GET'); assert.equal(o.path, `/api/studio/${project.id}/versions?return_days_only=false`); return { result: body }; } });
  assert.equal(await client.get_project_versions(project.id), body); assert.equal(calls, 1);
});
test('every write entry and alias rejects without dispatch even when passed integration/gate flags', async () => {
  let calls = 0; const client = new StudioClient({ call: () => { calls++; } });
  const input = { title: 'Untitled Project', major_version: 2, state: project.state, integration: true, allowWrite: true };
  for (const name of ['create_project', 'save_project', 'save_version', 'render_project', 'render_multitrack', 'export_project', 'export_multitrack']) {
    await assert.rejects(async () => client[name](input), NotVerifiedError);
  }
  assert.equal(calls, 0);
});
test('save serializer requires editor state, runs once, and preserves source and unknown fields', () => {
  const input = structuredClone(project.state); input.future = { nested: [42] };
  const before = structuredClone(input), wire = states.rawWireState(input); let count = 0;
  assert.throws(() => states.serializeProjectState(wire, x => x), { kind: 'validation_error' });
  assert.throws(() => states.serializeProjectState({ kind: 'editor-memory' }, x => x), { kind: 'validation_error' });
  assert.throws(() => states.deserializeEditorState(wire), { kind: 'validation_error' });
  const editor = states.deserializeEditorState(wire, x => x); // Explicit unit adapter, not official serializer implementation.
  const serialized = states.serializeProjectState(editor, x => { count++; x.future.nested.push(43); return x; });
  const request = builders.buildSaveProjectRequest({ project_id: project.id, title: 'unit', state: serialized });
  assert.equal(count, 1); assert.deepEqual(input, before); assert.equal(request.dispatchAllowed, false);
  assert.deepEqual(Object.keys(request.body).sort(), ['project_id', 'state', 'title']);
  assert.deepEqual(request.body.state.future, { nested: [42, 43] });
  assert.equal(request.body.state.tracks[0].clips[0].transposition, -8);
  assert.equal(request.body.state.tracks[0].clips[0].warp.enabled, true);
  assert.throws(() => builders.buildSaveProjectRequest({ project_id: project.id, title: 'unit', state: wire }), { kind: 'validation_error' });
  assert.throws(() => states.serializeProjectState(serialized, x => x), { kind: 'validation_error' });
});
test('render transform is isolated from save state, IDs are explicit, and multitrack fields never leak into clip render', () => {
  const wire = states.rawWireState(project.state), editor = states.deserializeEditorState(wire, x => x);
  const save = states.serializeProjectState(editor, x => x);
  const render = states.prepareRenderTransformedState(editor, x => ({ ...x, metronome: { enabled: false, amplitude: 1 } }), x => x);
  const args = { title: 'unit', lyrics: '', project_id: 'separate-render-project', studio_project_id: project.id, studio_project_version_id: project.latest_version_id,
    from_studio_project_id: project.id, web_client_pathname: '/studio', state: render, start_beats: 0, end_beats: 10, downbeats: [], export_mode: 'fullsong_export' };
  const clip = builders.buildRenderProjectRequest(args), multi = builders.buildRenderMultitrackRequest(args);
  assert.equal(clip.body.project_id, 'separate-render-project'); assert.equal(clip.body.studio_project_id, project.id);
  assert.equal(clip.path, '/api/studio/render-state'); assert.equal(multi.path, '/api/studio/render-state-multitrack');
  for (const key of ['format', 'export_surface', 'from_studio_project_id']) assert.equal(Object.hasOwn(clip.body, key), false);
  assert.equal(multi.body.format, 'wav'); assert.equal(multi.body.export_surface, 'studio_v2'); assert.equal(Object.hasOwn(multi.body, 'export_mode'), false);
  assert.deepEqual(states.inspectSaveSerializedState(save), project.state);
  assert.throws(() => builders.buildRenderProjectRequest({ ...args, state: save }), { kind: 'validation_error' });
  assert.throws(() => builders.buildSaveProjectRequest({ project_id: project.id, title: 'unit', state: render }), { kind: 'validation_error' });
  assert.throws(() => builders.buildRenderProjectRequest({ ...args, project_id: undefined }), { kind: 'validation_error' });
});
test('redacted/omitted payloads are inspectable reads but never enter save/render preparation', () => {
  const state = structuredClone(project.state); state.timeSignatureChanges = '<redacted>'; // Actual legacy payload; not current privacy output.
  assert.throws(() => states.deserializeEditorState(states.rawWireState(state), x => x), { kind: 'validation_error' });
  const editor = states.deserializeEditorState(states.rawWireState(project.state), x => x);
  assert.throws(() => states.serializeProjectState(editor, x => ({ ...x, future: { omitted: 'size-limit' } })), { kind: 'validation_error' });
  assert.throws(() => states.prepareRenderTransformedState(editor, x => x, x => ({ ...x, secret: '<redacted>' })), { kind: 'validation_error' });
});
test('create preview uses observed query only, omits body, and cannot dispatch', () => {
  const preview = builders.buildCreateProjectRequest({ title: 'A & B', major_version: 2, entry_source: 'unit' });
  assert.equal(preview.path, '/api/studio/create-project?title=A+%26+B&major_version=2&entry_source=unit');
  assert.equal(Object.hasOwn(preview, 'body'), false); assert.equal(preview.dispatchAllowed, false);
});
test('preview dispatch refusal is enforced by client and controller hub before any transport', async () => {
  const preview = builders.buildCreateProjectRequest({ title: 'unit' });
  const bridge = new SunoBridge({ key: 'unit-only-local-key' });
  bridge.request = () => { throw Error('must not reach HTTP transport'); };
  await assert.rejects(bridge.call(preview), { kind: 'not_verified' });
  assert.throws(() => new BridgeHub().call(preview), { kind: 'not_verified' });
});
test('read verifier compares intact state, records legacy masks, identity mismatch and failures', async () => {
  const response = version(); response.state = privacy.redact(response.state);
  const result = await verifyVersion({ bridge: { call: async () => ({ status: 200, result: response }) }, project });
  assert.equal(result.verified, true); assert.equal(result.stateComparison.equalExceptDisplayLabels, true);
  assert.deepEqual(result.maskedStatePaths, []);
  const legacy = version(); legacy.state.timeSignatureChanges = '<redacted>';
  const old = await verifyVersion({ bridge: { call: async () => ({ status: 200, result: legacy }) }, project });
  assert.equal(old.verified, false); assert.deepEqual(old.maskedStatePaths, ['$.timeSignatureChanges']);
  const changed = structuredClone(project.state); changed.tracks[0].clips[0].startBeats += 1;
  assert.equal(compareState(changed, project.state).equalExceptDisplayLabels, false);
  assert.equal((await verifyVersion({ bridge: { call: async () => ({ status: 200, result: { ...response, id: 'wrong' } }) }, project })).verified, false);
  assert.equal((await verifyVersion({ bridge: { call: async () => { throw Object.assign(new Error('auth not ready'), { kind: 'auth_error' }); } }, project })).status, null);
});
test('versions experiment never equates version IDs with revision IDs or verifies unrelated lists', async () => {
  const result = await verifyVersions({ project, bridge: { call: async () => ({ status: 200, result: { id: project.id, aggregated_versions: [{ versions: [{ version_id: 'unrelated' }] }] } }) } });
  assert.equal(result.verified, false); assert.equal(result.ids.some(x => x.path.endsWith('revision_id')), false);
});
test('lossless read verification compares every real baseline state value including display labels and refuses projection-only success', async () => {
  const response = version();
  const valid = await verifyVersion({ project, rawProject: project, requireLossless: true,
    transportEvidence: { userscriptVersion: '1.3.16', authReady: true, token: 'DO_NOT_LOG_TOKEN', authorization: 'DO_NOT_LOG_AUTH' },
    bridge: { call: async () => ({ status: 200, result: response }) } });
  assert.equal(valid.verified, true); assert.equal(valid.losslessState, true);
  assert.equal(valid.timeSignatureChangesComparison.equal, true);
  assert.ok(!JSON.stringify(valid).includes('DO_NOT_LOG_'));
  response.state.tracks[0].name = 'different label';
  assert.equal(compareState(response.state, project.state).equalExceptDisplayLabels, true);
  assert.equal(compareExactState(response.state, project.state).equal, false);
  assert.equal((await verifyVersion({ project, rawProject: project, requireLossless: true, bridge: { call: async () => ({ status: 200, result: response }) } })).verified, false);
  let calls = 0;
  await assert.rejects(verifyVersion({ project, requireLossless: true, bridge: { call: () => { calls++; } } }), /explicit real raw/);
  await assert.rejects(verifyVersion({ project, rawProject: { ...project, id: 'wrong' }, bridge: { call: () => { calls++; } } }), /relation must match/);
  assert.equal(calls, 0);
});
