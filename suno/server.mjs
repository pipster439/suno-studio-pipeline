import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeHub } from './bridge/hub.mjs';
import { BridgeError } from './bridge/errors.mjs';
import { CaptureStore } from './recorder/store.mjs';
import privacy from '../shared/privacy.cjs';
import { ReferenceStore, REFERENCE_ORIGINS } from './recorder/reference-store.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function createController({ port = 3000, captureRoot = resolve(root, 'captures'), key = randomBytes(32).toString('hex') } = {}) {
  const hub = new BridgeHub(); const captures = new CaptureStore(captureRoot);
  const reference = new ReferenceStore(resolve(captureRoot, 'reference'));
  let referenceRecorder = { at: 0, pending: 0, queued: 0, dropped: 0, omissions: 0, activeSession: null, version: null, buildId: null };
  let recorder = { at: 0, queued: 0, dropped: 0, pending: 0, activeSession: null }, lastAuth = 0;
  const secretMatches = (v) => typeof v === 'string' && Buffer.byteLength(v) === Buffer.byteLength(key) && timingSafeEqual(Buffer.from(v), Buffer.from(key));
  let origin;
  const state = () => ({ type: 'status', bridgeOnline: !!hub.peer, auth: hub.auth, capture: captures.state(), recorder: { ...recorder, online: Date.now() - recorder.at < 10000 },
    reference: { capture: reference.state(), recorder: { ...referenceRecorder, online: Date.now() - referenceRecorder.at < 10000 } } });
  const broadcast = () => { if (hub.peer?.readyState === WebSocket.OPEN) hub.peer.send(JSON.stringify(state())); };
  const files = { '/': ['web/index.html', 'text/html; charset=utf-8'], '/app.js': ['web/app.js', 'text/javascript'], '/style.css': ['web/style.css', 'text/css'], '/privacy.js': ['shared/privacy.cjs', 'text/javascript'], '/local-transport.user.js': ['userscripts/local-transport.user.js', 'text/javascript; charset=utf-8'], '/reference-recorder.user.js': ['userscripts/reference-recorder.user.js', 'text/javascript; charset=utf-8'] };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const reply = (status, value) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(privacy.redact(value))); };
    try {
      if (req.headers.host !== new URL(origin).host) return reply(403, { error: { kind: 'permission_error', message: 'Host rejected; use 127.0.0.1' } });
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && files[path]) {
        const [name, type] = files[path];
        const bytes = await readFile(resolve(root, name));
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        res.writeHead(200, { 'Content-Type': type }); return res.end(bytes);
      }
      if (!secretMatches(req.headers['x-controller-key'])) return reply(403, { error: { kind: 'permission_error', message: 'pairing required' } });
      const allowedOrigin = !req.headers.origin || req.headers.origin === origin ||
        (path.startsWith('/api/recorder/') || path === '/api/captures') && ['https://suno.com', 'https://www.suno.com'].includes(req.headers.origin) ||
        ['/api/reference/events', '/api/reference/status'].includes(path) && REFERENCE_ORIGINS.includes(req.headers.origin);
      if (!allowedOrigin) return reply(403, { error: { kind: 'permission_error', message: 'Origin rejected' } });
      if (req.method === 'GET' && path === '/api/status') { const { auth, ...rest } = state(); return reply(200, { ...rest, authStatus: auth }); }
      if (req.method !== 'POST') return reply(404, { error: { kind: 'validation_error', message: 'route not found' } });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: { kind: 'validation_error', message: 'JSON required' } });
      let size = 0, chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) return reply(413, { error: { kind: 'validation_error', message: 'payload too large' } }); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { error: { kind: 'validation_error', message: 'invalid JSON' } }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: { kind: 'validation_error', message: 'object required' } });
      if (path === '/api/call' || path === '/api/probe') {
        const call = path === '/api/probe' ? { method: 'GET', path: '/api/session/', timeoutMs: 30000 } : body;
        const abort = new AbortController(); res.on('close', () => { if (!res.writableEnded) abort.abort(); });
        const result = await hub.call(call, { signal: abort.signal });
        return reply(200, path === '/api/probe' ? { ok: true, status: result.status, requestId: result.requestId, evidence: 'real transport response; no Studio operation verified' } : result);
      }
      if (path === '/api/cancel') return reply(200, { cancelled: hub.cancel(body.requestId) });
      if (path === '/api/capture/start') { const result = await captures.start(body.label); broadcast(); return reply(200, result); }
      if (path === '/api/capture/stop') { const result = await captures.stop(); broadcast(); return reply(200, result); }
      if (path === '/api/reference/start') { const result = await reference.start(body.label); broadcast(); return reply(200, result); }
      if (path === '/api/reference/stop') { const result = await reference.stop(); broadcast(); return reply(200, result); }
      if (path === '/api/reference/events') { const result = await reference.add(body); broadcast(); return reply(200, result); }
      if (path === '/api/reference/status') {
        if (referenceRecorder.pageId && body.pageId !== referenceRecorder.pageId && Date.now() - referenceRecorder.at < 10000) return reply(409, { error: { kind: 'validation_error', message: 'keep one reference tab active' } });
        referenceRecorder = { at: Date.now(), pageId: typeof body.pageId === 'string' ? body.pageId.slice(0, 100) : null,
          pending: Math.max(0, Number(body.pending) || 0), queued: Math.max(0, Number(body.queued) || 0), dropped: Math.max(0, Number(body.dropped) || 0), omissions: Math.max(0, Number(body.omissions) || 0),
          activeSession: typeof body.activeSession === 'string' ? body.activeSession : null,
          version: /^[\d.]{1,20}$/.test(body.version || '') ? body.version : null, buildId: /^[a-f0-9]{64}$/.test(body.buildId || '') ? body.buildId : null,
          lastError: privacy.redact(String(body.lastError || '').slice(0, 100)) };
        broadcast(); return reply(200, { ok: true });
      }
      if (path === '/api/captures') { const result = await captures.add(body); broadcast(); return reply(200, result); }
      if (path === '/api/recorder/status') {
        recorder = { at: Date.now(), queued: Math.max(0, Number(body.queued) || 0), dropped: Math.max(0, Number(body.dropped) || 0), pending: Math.max(0, Number(body.pending) || 0), activeSession: typeof body.activeSession === 'string' ? body.activeSession : null, lastError: privacy.redact(String(body.lastError || '').slice(0, 100)) };
        broadcast(); return reply(200, { ok: true });
      }
      reply(404, { error: { kind: 'validation_error', message: 'unknown local route' } });
    } catch (error) {
      const e = error instanceof BridgeError ? error.toJSON() : { kind: 'controller_error', message: 'local action failed; check capture/connection state' };
      reply(e.kind === 'validation_error' ? 400 : 502, { ok: false, error: e });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || req.headers.host !== new URL(origin).host || req.headers.origin !== origin) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    let paired = false; ws.alive = true;
    const timer = setTimeout(() => ws.close(1008, 'pairing required'), 5000);
    ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {});
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return ws.close(1008, 'invalid message'); }
      if (!m || typeof m !== 'object') return ws.close(1008, 'invalid message');
      if (!paired) {
        if (m.type !== 'hello' || !secretMatches(m.key)) return ws.close(1008, 'pairing rejected');
        try { hub.attach(ws); } catch { return ws.close(1008, 'bridge already connected'); }
        paired = true; clearTimeout(timer); broadcast(); return;
      }
      if (m.type === 'auth_status') {
        const next = { ready: m.ready === true, state: ['ready', 'unknown', 'expired', 'waiting'].includes(m.state) ? m.state : 'unknown',
          version: /^[\d.]{1,20}$/.test(m.version || '') ? m.version : null, buildId: /^[a-f0-9]{64}$/.test(m.buildId || '') ? m.buildId : null };
        lastAuth = Date.now(); const changed = JSON.stringify(hub.auth) !== JSON.stringify(next); hub.auth = next; if (changed) broadcast();
      }
      else if (m.type === 'suno_api_response') hub.response(ws, m);
    });
    ws.on('close', () => { clearTimeout(timer); hub.detach(ws); });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
    if (Date.now() - lastAuth > 10000) hub.auth = { ready: false, state: 'unknown' };
    broadcast();
  }, 4000);
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, hub, captures, reference, key, origin, state, async close() { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); await captures.stop(); await reference.stop(); await new Promise((r) => server.close(r)); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createController({ port: Number(process.env.SUNO_PORT || 3000) });
  console.log(`Local pairing URL (ephemeral controller capability, NOT Suno credentials): ${app.origin}/#${app.key}`);
  console.log('Capture is OFF. Press Ctrl+C for a graceful shutdown.');
  process.once('SIGINT', async () => { await app.close(); process.exit(0); });
  process.once('SIGTERM', async () => { await app.close(); process.exit(0); });
}
