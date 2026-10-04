import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createController } from '../suno/server.mjs';
test('localhost server uses real WebSocket, pairing, raw-call, capture dedup/redaction, cancel and reconnect', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'suno-tests-')); const app = await createController({ port: 0, captureRoot: dir });
  const post = async (path, value, extra = {}) => {
    const r = await fetch(app.origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Controller-Key': app.key, ...extra }, body: JSON.stringify(value) });
    return { status: r.status, body: await r.json() };
  };
  async function connect() {
    const ws = new WebSocket(app.origin.replace('http:', 'ws:') + '/ws', { origin: app.origin });
    await once(ws, 'open'); const ack = once(ws, 'message'); ws.send(JSON.stringify({ type: 'hello', key: app.key })); await ack;
    ws.send(JSON.stringify({ type: 'auth_status', ready: true, state: 'ready' }));
    await once(ws, 'message'); return ws;
  }
  let ws;
  try {
    assert.equal((await post('/api/capture/start', {}, { 'X-Controller-Key': 'wrong' })).status, 403);
    assert.equal((await post('/api/capture/start', {}, { Origin: 'https://evil.example' })).status, 403);
    const invalid = new WebSocket(app.origin.replace('http:', 'ws:') + '/ws', { origin: app.origin });
    await once(invalid, 'open'); invalid.send(JSON.stringify({ type: 'hello', key: '界'.repeat(64) }));
    const [code] = await once(invalid, 'close'); assert.equal(code, 1008);
    ws = await connect();
    const received = once(ws, 'message'); const call = post('/api/call', { path: '/transport-fixture', requestId: 'ws-test' });
    const [message] = await received; const request = JSON.parse(message); assert.equal(request.id, 'ws-test');
    ws.send(JSON.stringify({ type: 'suno_api_response', requestId: request.id, ok: true, result: { value: 1 }, status: 200 }));
    assert.equal((await call).body.result.value, 1);
    const next = once(ws, 'message'); const p = post('/api/call', { path: '/transport-fixture', requestId: 'stop' }); await next;
    assert.equal((await post('/api/cancel', { requestId: 'stop' })).body.cancelled, true);
    assert.equal((await p).body.error.kind, 'cancelled');
    const session = (await post('/api/capture/start', { label: 'one-action' })).body;
    const record = { sessionId: session.id, eventId: 'event-one', source: 'fetch', timestamp: new Date().toISOString(), request: { method: 'POST', url: 'https://studio-api-prod.suno.com/transport-fixture?signature=PRIVACY_TEST_SECRET_ONLY', headers: { authorization: 'PRIVACY_TEST_SECRET_ONLY' }, body: { clip_id: 'example-id', token: 'PRIVACY_TEST_SECRET_ONLY' } }, response: { status: 200, headers: { 'set-cookie': 'PRIVACY_TEST_SECRET_ONLY' }, body: { id: 'example-id' } }, durationMs: 42 };
    assert.equal((await post('/api/captures', record)).body.count, 1);
    assert.equal((await post('/api/captures', record)).body.duplicate, true);
    assert.equal((await post('/api/capture/stop', {})).body.count, 1);
    const names = await readdir(join(dir, session.id)); assert.deepEqual(names.sort(), ['001-request.json', '001-response.json', 'summary.md']);
    const disk = (await Promise.all(names.map((n) => readFile(join(dir, session.id, n), 'utf8')))).join('');
    assert.ok(!disk.includes('PRIVACY_TEST_SECRET_ONLY')); assert.ok(disk.includes('example-id'));
    // Reference origins get recorder ingress only, never controller calls or capture control.
    for (const path of ['/api/call','/api/reference/start']) assert.equal((await post(path,{path:'/transport-fixture'},{Origin:'https://sunouploader.site'})).status,403);
    const reference=(await post('/api/reference/start',{label:'reference-test'})).body;
    const event={sessionId:reference.id,recordId:'ref-event',pageId:'ref-page',kind:'backend_response',sequence:1,timestamp:new Date().toISOString(),pageUrl:'https://sunouploader.site/',data:{url:'https://sunouploader.site/api/me',status:200,body:{opaque:'PRIVACY_TEST_SECRET_ONLY'}}};
    assert.equal((await post('/api/reference/events',event,{Origin:'https://sunouploader.site'})).body.count,1);
    assert.equal((await post('/api/reference/events',event,{Origin:'https://sunouploader.site'})).body.duplicate,true);
    assert.equal((await post('/api/reference/events',{...event,recordId:'wrong-origin',pageUrl:'https://evil.example/'})).status,502);
    assert.equal((await post('/api/reference/status',{pageId:'ref-page',version:'1.0.0',buildId:'a'.repeat(64)},{Origin:'https://sunouploader.site'})).status,200);
    assert.equal(app.state().reference.recorder.online,true);
    assert.equal((await post('/api/reference/stop',{})).body.count,1);
    const refDisk=await readFile(join(dir,'reference',reference.id,'events','000001.json'),'utf8');
    assert.ok(!refDisk.includes('PRIVACY_TEST_SECRET_ONLY'));assert.ok(refDisk.includes('authentication-account-payment-body'));
    const disconnected = post('/api/call', { path: '/transport-fixture', requestId: 'disconnect' });
    await new Promise((r) => ws.once('message', (raw) => { if (JSON.parse(raw).type === 'suno_api_request') r(); else r(); }));
    const closed = once(ws, 'close'); ws.close(); await closed;
    assert.equal((await disconnected).body.error.kind, 'network_error');
    ws = await connect(); assert.equal(app.hub.pending.size, 0);
  } finally { ws?.terminate(); await app.close(); await rm(dir, { recursive: true, force: true }); }
});
