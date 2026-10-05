import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as p from '../suno/studio/clip-pipeline.mjs';
import { rawWireState, deserializeEditorState, inspectEditorState, inspectSaveSerializedState, serializeProjectState } from '../suno/studio/state-boundaries.mjs';
import { buildSaveProjectRequest } from '../suno/studio/request-builders.mjs';
import { StudioClient, NotVerifiedError } from '../suno/studio/operations.mjs';
import { inspectModules } from '../scripts/analyze-studio-clips.mjs';
const fixtureBytes = readFileSync(new URL('../fixtures/studio_project_get.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const normal = (id = 'source-id', duration = 6) => p.sourceClipMetadata({ id, status: 'complete', metadata: { duration }, futureMetadata: { keep: true } });
const draft = (id = 'arrangement-id', duration = 6, extraFields = {}) => p.buildAudioClipDraft(normal('source-id', duration), { id, fallbackBPS: 1.95, extraFields });

test('clip domains preserve extensions and source identity without inventing a clipId alias', () => {
  const input = { nested: { keep: [1, 2] }, clipId: 'source-id' };
  const h = draft('arrangement-id', 6, input); input.nested.keep[0] = 100;
  const c = p.inspectClipDraft(h);
  assert.deepEqual(c.nested, { keep: [1, 2] }); assert.equal(c.asset.id, c.clipId); assert.equal(c.clipId, 'source-id');
  assert.notEqual(c.id, c.asset.id); assert.equal(Object.hasOwn(p.inspectClipDraft(draft()), 'clipId'), false);
  c.nested.keep.push(3); assert.deepEqual(p.inspectClipDraft(h).nested, { keep: [1, 2] });
  assert.equal(p.inspectSourceClip(normal()).futureMetadata.keep, true);
  assert.throws(() => draft('source-id'), /separate/);
  assert.throws(() => draft('a', 6, { clipId: 'wrong' }), /match/);
  assert.throws(() => draft('a', 6, { warp: {} }), /replace/);
  assert.throws(() => p.placeClip({ kind: 'clip-draft' }, 0), /expected/);
});

test('ordinary constructor branches and fade defaults follow static code; special content windows gated', () => {
  const c = p.inspectClipDraft(draft()); assert.equal(c.endBeats, 6 * 1.95);
  assert.deepEqual([c.fadeInBeats, c.fadeOutBeats, c.fadeInCurve, c.fadeOutCurve, c.transposition, c.amplitude], [0, 0, 1, 1, 0, 1]);
  assert.deepEqual(c.warp, { enabled: true, markers: { 0: 0 }, awaitingAnalysis: true });
  assert.deepEqual(c.loop, { enabled: false, startBeats: 0, endBeats: 999 });
  const source = p.sourceClipMetadata({ id: 's', metadata: { duration: 3, avg_bpm: 120 }, status: 'streaming' });
  const v = p.inspectClipDraft(p.buildAudioClipDraft(source, { fallbackBPS: 1.95 }));
  assert.equal(v.endBeats, 6); assert.equal(v.streaming, true);
  const unavailable = p.sourceClipMetadata({ id: 's', metadata: {} });
  assert.equal(p.inspectClipDraft(p.buildAudioClipDraft(unavailable, { fallbackBPS: 1.95 })).endBeats, 960);
  for (const task of ['extend', 'fixed_infill', 'cover_infill'])
    assert.throws(() => p.buildAudioClipDraft(p.sourceClipMetadata({ id: 's', metadata: { task, duration: 10 } }), { fallbackBPS: 2 }), NotVerifiedError);
});

test('deterministic sequential placement keeps tail length and source-read offset independent', () => {
  const tailDuration = 1.1109791666666666;
  const clips = [draft('first'), draft('second'), draft('tail', tailDuration)];
  const first = p.placeSequentialClips(clips, 5).map(p.inspectPostprocessedClip);
  assert.deepEqual(first, p.placeSequentialClips(clips, 5).map(p.inspectPostprocessedClip));
  assert.equal(first[1].startBeats, first[0].endBeats); assert.equal(first[2].startBeats, first[1].endBeats);
  assert.ok(Math.abs(first[2].endBeats - first[2].startBeats - tailDuration * 1.95) < 1e-12);
  const trimmed = p.postprocessClip(clips[0], { readStartBeats: 3 });
  const moved = p.inspectPostprocessedClip(p.placeClip(trimmed, 20));
  assert.equal(moved.readStartBeats, 3); assert.equal(moved.endBeats, 20 + 6 * 1.95);
  assert.equal(p.inspectClipDraft(clips[0]).startBeats, 0);
});

test('constant manual timing uses first-beat origin; automated timing explicitly unsupported', () => {
  const t = { ...fixture.state.timing, firstBeatSeconds: 1.5 };
  assert.equal(p.secondsToProjectBeats(4, t), 2.5 * 1.95);
  assert.equal(p.projectBeatsToSeconds(2.5 * 1.95, t), 4);
  assert.equal(p.durationSecondsToBeats(4, t), 4 * 1.95);
  assert.throws(() => p.secondsToProjectBeats(1, { ...t, bpsAutomation: [{ beats: 0, value: 2 }] }), NotVerifiedError);
  assert.throws(() => p.secondsToProjectBeats(1, { ...t, bps: 0 }), /positive/);
});

test('observed warp maps source seconds to arrangement read beats, including the shorter tail', () => {
  assert.equal(p.assertWarpReferencesResolve(fixture.state), true);
  const clips = fixture.state.tracks[0].clips;
  for (const c of clips) {
    const markers = fixture.state.markersRegistry[c.warp.markersHash], endSeconds = Math.max(...Object.keys(markers).map(Number));
    assert.ok(Math.abs(p.warpBeatsFromSeconds(markers, endSeconds) - (c.endBeats - c.startBeats)) < 1e-12);
  }
  assert.equal(new Set(clips.slice(0, 19).map(c => c.warp.markersHash)).size, 1);
  assert.notEqual(clips.at(-1).warp.markersHash, clips[0].warp.markersHash);
  assert.equal(p.warpBeatsFromSeconds({}, 3), 6); assert.equal(p.warpBeatsFromSeconds({ 1: 5 }, 2), 7);
  assert.equal(p.warpBeatsFromSeconds({ 0: 0, 1: 2, 3: 8 }, 2), 5);
  assert.equal(p.warpBeatsFromSeconds({ 0: 0, 1: 2, 3: 8 }, 4), 11);
  assert.equal(p.warpBeatsFromSeconds({ 1: 2, 3: 8 }, 0), -1);
  const bad = structuredClone(fixture.state); bad.tracks[0].clips[0].warp.markersHash = 'missing';
  assert.throws(() => p.assertWarpReferencesResolve(bad), /unresolved/);
});

test('analyzed constructor uses supplied warp extent for length and source offset, not nominal project BPS', () => {
  const markers = fixture.state.markersRegistry[fixture.state.tracks[0].clips[0].warp.markersHash];
  const c = p.inspectClipDraft(p.buildAnalyzedAudioClipDraft(normal(), { markers, fallbackBPS: 1.95 }));
  assert.equal(c.endBeats, markers['6']); assert.equal(c.readStartBeats, 0); assert.equal(c.loop.endBeats, markers['6']);
  assert.equal(c.warp.awaitingAnalysis, false); assert.equal(c.warp.enabled, true);
  const tail = fixture.state.tracks[0].clips.at(-1), tailMarkers = fixture.state.markersRegistry[tail.warp.markersHash];
  const tailSeconds = Math.max(...Object.keys(tailMarkers).map(Number));
  const t = p.inspectClipDraft(p.buildAnalyzedAudioClipDraft(normal('tail-source', tailSeconds), { markers: tailMarkers, fallbackBPS: 1.95, downbeatPresenceConfidence: 0.8 }));
  assert.ok(Math.abs(t.endBeats - (tail.endBeats - tail.startBeats)) < 1e-12); assert.equal(t.warp.enabled, false);
  const offset = p.inspectClipDraft(p.buildAnalyzedAudioClipDraft(normal(), { markers: { 0: 3, 6: 21 }, fallbackBPS: 2 }));
  assert.equal(offset.readStartBeats, 3); assert.equal(offset.endBeats, 18);
  assert.throws(() => p.buildAnalyzedAudioClipDraft(p.sourceClipMetadata({ id: 's', metadata: {} }), { markers, fallbackBPS: 2 }), NotVerifiedError);
});

test('explicit processing never infers inverse upload pitch or loudness repair', () => {
  const h = draft('a', 6, { future: { keep: 1 } });
  const c = p.inspectPostprocessedClip(p.postprocessClip(h, { transposition: -8, amplitude: 0.75, fadeInBeats: -2, fadeOutBeats: 2, markers: { 0: 0, 6: 18 } }));
  assert.equal(c.transposition, -8); assert.equal(c.amplitude, 0.75); assert.equal(c.fadeInBeats, 0); assert.equal(c.fadeOutBeats, 2);
  assert.equal(c.warp.awaitingAnalysis, false); assert.deepEqual(c.future, { keep: 1 });
  assert.equal(p.inspectClipDraft(h).transposition, 0);
  assert.equal(p.inspectPostprocessedClip(p.postprocessClip(h, { transposition: 30 })).transposition, 24);
  assert.throws(() => p.restoreUploadedPitch({ pitchShiftSemitones: 8, restorePitchInStudio: true }), NotVerifiedError);
  for (const key of ['gainReference', 'repairLoudness', 'repairLoudnessOnMerge', 'pitchShiftSemitones', 'restorePitchInStudio', 'fadeInCurve'])
    assert.throws(() => p.postprocessClip(h, { [key]: 1 }), NotVerifiedError);
  assert.throws(() => p.postprocessClip(h, { amplitude: -1 }), /nonnegative/);
});

test('explicit deserialize, postprocess, append and save preview preserve every unrelated fixture field', () => {
  const before = JSON.stringify(fixture);
  const raw = rawWireState(fixture.state), editor = deserializeEditorState(raw, p.deserializeAudioProjectState);
  const c = p.postprocessClip(draft('new-arrangement', 6, { future: { keep: true } }), { transposition: -8, markers: { 0: 0, 6: 18 } });
  const placed = p.placeClip(c, fixture.state.tracks[0].clips.at(-1).endBeats, { lengthBeats: 18 });
  const next = p.appendClipToEditor(editor, fixture.state.tracks[0].id, placed);
  assert.equal(inspectEditorState(editor).tracks[0].clips.length, 20);
  assert.equal(inspectEditorState(next).tracks[0].clips.length, 21);
  const save = serializeProjectState(next, p.serializeAudioProjectState), wire = inspectSaveSerializedState(save);
  assert.equal(p.assertWarpReferencesResolve(wire), true);
  assert.deepEqual(p.deserializeAudioProjectState(wire), inspectEditorState(next));
  const preview = buildSaveProjectRequest({ project_id: fixture.id, title: fixture.title, state: save });
  assert.equal(preview.dispatchAllowed, false);
  assert.equal(JSON.stringify(fixture), before);
  assert.throws(() => p.appendClipToEditor(next, fixture.state.tracks[0].id, placed), /duplicate/);
  assert.throws(() => p.appendClipToEditor(editor, fixture.state.tracks[0].id, p.placeClip(c, 0)), /overlap/);
  assert.throws(() => p.appendClipToEditor(raw, fixture.state.tracks[0].id, placed), /editor-memory/);
  // New snapshot uses current static hash algorithm; original legacy hash strings remain untouched.
  assert.equal(Object.keys(wire.markersRegistry).length, 3);
  assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), 'b5cc87081cda785b6d59b753908687c0487dfd23f1e3c262b7b563ba5a2ec64a');
});

test('save serializer rejects incomplete, masked, unresolved or double-serialized state', () => {
  assert.throws(() => p.serializeAudioProjectState({ tracks: [], timing: {} }), /incomplete/);
  assert.throws(() => p.serializeAudioProjectState(fixture.state), /deserialized/);
  const memory = p.deserializeAudioProjectState(fixture.state);
  for (const masked of ['<redacted>', { omitted: true }]) { const s = structuredClone(memory); s.future = masked; assert.throws(() => p.serializeAudioProjectState(s), /redacted/); }
  const unresolved = structuredClone(memory); delete unresolved.tracks[0].clips[0].warp.markers;
  assert.throws(() => p.serializeAudioProjectState(unresolved), /inline/);
  const missing = structuredClone(memory); delete missing.tracks[0].takeLanes;
  assert.throws(() => p.serializeAudioProjectState(missing), /complete track/);
  assert.throws(() => p.hashWarpMarkers({ notSeconds: 1 }), /finite/);
  assert.throws(() => p.hashWarpMarkers({ 1: 2, '01': 3 }), /duplicate/);
  const incompleteClip = structuredClone(memory); delete incompleteClip.tracks[0].clips[0].readStartBeats;
  assert.throws(() => p.serializeAudioProjectState(incompleteClip), /readStartBeats/);
  assert.equal(p.hashWarpMarkers({ 6: 12, 0: 0 }), p.hashWarpMarkers({ 0: 0, 6: 12 }));
});

test('all Studio write entry points still refuse dispatch with the new local pipeline', async () => {
  let dispatches = 0; const client = new StudioClient({ call() { dispatches++; throw Error('unexpected network'); } });
  await assert.rejects(client.create_project(), NotVerifiedError);
  for (const method of ['save_project', 'render_project']) await assert.rejects(client[method](), NotVerifiedError);
  for (const method of ['save_version', 'render_multitrack', 'export_project', 'export_multitrack']) assert.throws(() => client[method](), NotVerifiedError);
  assert.equal(dispatches, 0);
});

test('bounded AST extractor locates shared module exports without evaluating code', () => {
  const code = 'registry.push([100,e=>{function x(){throw Error("never executed")}e.s(["build",0,x],200)}]);';
  const r = inspectModules(code, [200], 'test.js');
  assert.equal(r.modules[0].id, 100); assert.deepEqual(r.modules[0].exportModuleIds, [200]);
  assert.equal(r.modules[0].definitions.find(d => d.binding === 'x').offset, code.indexOf('function x'));
  assert.equal(inspectModules(code, [], 'test.js', [code.indexOf('throw')]).modules.length, 1);
});
