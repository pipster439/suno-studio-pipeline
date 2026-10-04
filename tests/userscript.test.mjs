import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureStore } from '../suno/recorder/store.mjs';
class CE extends Event { constructor(name, options) { super(name); this.detail = options?.detail; } }
test('adapted real userscript keeps auth out of workbench, returns status and cancels GM transport', async () => {
  let source = await readFile(new URL('../userscripts/local-transport.user.js', import.meta.url), 'utf8');
  const at = source.indexOf('  function mountPanel(context)');
  source = source.slice(0, at) + 'function mountPanel() { return { update(){},setAccount(){},setRefresh(){},onSync(){},setUpdateNotice(){} }; }\n})();';
  const w = new EventTarget(); w.setInterval = () => 1; w.setTimeout = setTimeout; w.clearTimeout = clearTimeout; w.clearInterval = () => {};
  const payload = Buffer.from(JSON.stringify({ sub: 'fixture-user', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const credential = `Bearer fixture.${payload}.fixture`;
  const values = new Map([['sunoConsoleAuthSync:payload', { headers: { authorization: credential, 'device-id': 'fixture-device' } }]]);
  const gmCalls = [], backendCalls = []; let status = 200, hold = false, aborted = false;
  const sandbox = { window: w, unsafeWindow: w, location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:3000' }, document: {},
    CustomEvent: CE, atob, btoa, URL, URLSearchParams, Headers, performance, setInterval: () => 1, setTimeout, clearTimeout, crypto: webcrypto,
    fetch: (...args) => { backendCalls.push(args); return Promise.reject(new Error('unexpected backend auth call')); },
    GM_getValue: (k, d) => values.get(k) ?? d, GM_setValue: (k, v) => values.set(k, v), GM_deleteValue: (k) => values.delete(k), GM_addValueChangeListener: () => {}, GM_openInTab: () => {},
    GM_xmlhttpRequest: (opts) => { gmCalls.push(opts); if (!hold) queueMicrotask(() => opts.onload({ status, responseText: JSON.stringify({ id: 'fixture', token: 'fixture-secret' }), statusText: 'fixture' })); return { abort() { aborted = true; opts.onabort(); } }; } };
  vm.runInNewContext(source, sandbox);
  async function call(detail) { const done = new Promise((r) => w.addEventListener('suno-console-upload-response', (e) => r(e.detail), { once: true })); w.dispatchEvent(new CE('suno-console-upload-request', { detail })); return done; }
  const response = await call({ requestId: 'test1', path: '/api/session/', method: 'GET' });
  assert.equal(response.ok, true); assert.equal(response.status, 200);
  assert.equal(gmCalls[0].headers.authorization, credential); assert.equal(backendCalls.length, 0);
  assert.equal((await call({ requestId: 'bad', path: '//evil.example/' })).kind, 'validation_error');
  hold = true; const p = call({ requestId: 'abort', path: '/api/session/' });
  await new Promise((r) => setImmediate(r)); w.dispatchEvent(new CE('suno-console-upload-cancel', { detail: { requestId: 'abort' } }));
  assert.equal((await p).kind, 'cancelled'); assert.equal(aborted, true);
  hold = false; status = 401;
  assert.equal((await call({ requestId: 'expired', path: '/api/session/' })).status, 401);
  assert.equal(values.has('sunoConsoleAuthSync:payload'), false); assert.equal(backendCalls.length, 0);
});
test('official recorder observes fetch and XHR without consuming responses and sends only redacted records', { timeout: 3000 }, async () => {
  const privacy = await readFile(new URL('../shared/privacy.cjs', import.meta.url), 'utf8');
  const recorder = await readFile(new URL('../userscripts/recorder.js', import.meta.url), 'utf8');
  const records = [], intervals = [], listeners = []; const marker = 'PRIVACY_TEST_SECRET_ONLY';
  const delivery = Promise.withResolvers();
  class XHR extends EventTarget {
    open() {} setRequestHeader() {} getAllResponseHeaders() { return 'Content-Type: application/json\r\nSet-Cookie: ' + marker; }
    send() { this.status = 200; this.responseText = JSON.stringify({ clip_id: 'fixture', token: marker }); queueMicrotask(() => this.dispatchEvent(new Event('loadend'))); }
  }
  const native = async () => new Response(JSON.stringify({ id: 'fixture', cookie: marker }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const w = { fetch: native, Headers, Request, XMLHttpRequest: XHR };
  const sandbox = { window: w, unsafeWindow: w, location: { hostname: 'suno.com', pathname: '/studio', href: 'https://suno.com/studio' },
    Headers, Request, Response, URL, URLSearchParams, TextDecoder, Uint8Array, crypto: webcrypto, performance, setTimeout, clearTimeout,
    setInterval: (f) => intervals.push(f), GM_getValue: () => ({ base: 'http://127.0.0.1:3000', key: 'fixture', sessionId: 'session-one', at: Date.now() }),
    GM_addValueChangeListener: (_k, f) => listeners.push(f), GM_xmlhttpRequest: (opts) => { records.push({ url: opts.url, value: JSON.parse(opts.data) }); queueMicrotask(() => { opts.onload({ status: 200 }); if (records.filter((x) => x.url.endsWith('/api/captures')).length === 2) delivery.resolve(); }); } };
  vm.runInNewContext(privacy + '\n' + recorder, sandbox);
  const r = await w.fetch('https://studio-api-prod.suno.com/transport-fixture?signature=' + marker, { method: 'POST', headers: { authorization: marker }, body: JSON.stringify({ id: 'fixture', captcha_token: marker }) });
  assert.equal((await r.json()).id, 'fixture');
  const xhr = new XHR(); xhr.open('PATCH', 'https://studio-api-prod.suno.com/transport-fixture?title=Untitled%20Project&major_version=2&project_id=fixture&clip_id=fixture-clip&offset=0.5&duration=2&position=3&unknown=' + marker); xhr.setRequestHeader('device-id', marker); xhr.send(JSON.stringify({ token: marker, position: 2 }));
  await delivery.promise;
  const captured = records.filter((x) => x.url.endsWith('/api/captures'));
  assert.equal(captured.length, 2); assert.ok(!JSON.stringify(captured).includes(marker));
  assert.ok(captured.every((x) => x.value.sessionId === 'session-one'));
  const xhrCapture = captured.find((x) => x.value.source === 'xhr').value;
  const query = new URL(xhrCapture.request.url).searchParams;
  for (const [key, v] of Object.entries({ title: 'Untitled Project', major_version: '2', project_id: 'fixture', clip_id: 'fixture-clip', offset: '0.5', duration: '2', position: '3' })) assert.equal(query.get(key), v);
  // Exercise the actual producer -> ingestion/store contract, including metadata redaction.
  const dir = await mkdtemp(join(tmpdir(), 'suno-recorder-contract-'));
  try {
    const store = new CaptureStore(dir); const session = await store.start('contract');
    for (const item of captured) {
      const value = { ...item.value, sessionId: session.id };
      assert.equal((await store.add(value)).count, store.active.count);
    }
    await store.stop(); const names = await readdir(join(dir, session.id)); assert.equal(names.length, 5);
    const disk = (await Promise.all(names.map((n) => readFile(join(dir, session.id, n), 'utf8')))).join('');
    assert.ok(!disk.includes(marker)); assert.ok(disk.includes('fixture'));
    const storedRequests = await Promise.all(names.filter((n) => n.endsWith('-request.json')).map(async (n) => JSON.parse(await readFile(join(dir, session.id, n), 'utf8'))));
    const stored = storedRequests.find((r) => r.source === 'xhr');
    assert.equal(new URL(stored.url).searchParams.get('title'), 'Untitled Project');
    assert.equal(new URL(stored.url).searchParams.get('position'), '3');
  } finally { await rm(dir, { recursive: true, force: true }); }
  assert.deepEqual(new Set(captured.map((x) => x.value.source)), new Set(['fetch', 'xhr']));
  listeners[0]('', null, { sessionId: null, at: Date.now() });
  await w.fetch('https://studio-api-prod.suno.com/transport-fixture'); await new Promise((r) => setImmediate(r));
  assert.equal(records.filter((x) => x.url.endsWith('/api/captures')).length, 2);
});
