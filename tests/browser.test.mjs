import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
class CE extends Event { constructor(n, opts) { super(n); this.detail = opts?.detail; } }
test('actual browser app correlates replies, times out, cancels on disconnect and reconnects without replay', async () => {
  const w = new EventTarget(), elements = new Map(), sockets = [], tasks = new Map(); let clockId = 0;
  const get = (id) => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '' }); return elements.get(id); };
  class WS {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.messages = []; sockets.push(this); }
    send(v) { this.messages.push(JSON.parse(v)); }
    close(code = 1000) { this.readyState = 3; this.onclose({ code }); }
  }
  const sandbox = { window: w, document: { getElementById: get }, location: { hash: '#fixture-local-key', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
    history: { replaceState() {} }, sessionStorage: { getItem() { return ''; }, setItem() {} }, CustomEvent: CE, WebSocket: WS,
    setTimeout: (f, delay) => { tasks.set(++clockId, { f, delay }); return clockId; }, clearTimeout: (id) => tasks.delete(id), setInterval: () => 1,
    SunoPrivacy: { redact: (v) => v } };
  vm.runInNewContext(await readFile(new URL('../web/app.js', import.meta.url), 'utf8'), sandbox);
  const ws = sockets[0]; ws.readyState = 1; ws.onopen();
  const requests = [], cancels = [];
  w.addEventListener('suno-console-upload-request', (e) => requests.push(e.detail));
  w.addEventListener('suno-console-upload-cancel', (e) => cancels.push(e.detail.requestId));
  const message = (id, timeoutMs = 100) => ws.onmessage({ data: JSON.stringify({ type: 'suno_api_request', id, path: '/transport-fixture', method: 'PATCH', body: { position: 1 }, timeoutMs }) });
  message('first'); message('second');
  w.dispatchEvent(new CE('suno-console-upload-response', { detail: { requestId: 'second', ok: true, status: 200 } }));
  assert.equal(ws.messages.at(-1).requestId, 'second');
  const timer = [...tasks.values()].find((x) => x.delay === 100); timer.f();
  assert.equal(cancels[0], 'first'); assert.equal(ws.messages.at(-1).kind, 'timeout');
  message('inflight'); ws.close(); assert.ok(cancels.includes('inflight'));
  const reconnect = [...tasks.values()].find((x) => x.delay === 500); reconnect.f();
  assert.equal(sockets.length, 2); assert.equal(requests.length, 3);
  assert.equal(sockets[1].messages.length, 0); assert.equal(get('auth').textContent, 'Suno auth：未知');
});
