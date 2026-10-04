// Browser-side recorder. Bundled into the same Tampermonkey script as transport.
(function () {
  'use strict';
  const CONFIG = 'sunoLocalRecorder:config';
  const p = SunoPrivacy;
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const local = location.hostname === '127.0.0.1';
  if (local) {
    window.addEventListener('suno-local-recorder-config', (e) => {
      const d = e.detail;
      if (d?.base !== location.origin || !/^http:\/\/127\.0\.0\.1:300[012]$/.test(d.base) || !/^[a-f0-9]{64}$/.test(d.key || '')) return;
      // Local controller capability only; no Suno credential is stored here.
      GM_setValue(CONFIG, { base: d.base, key: d.key, sessionId: d.sessionId, at: Date.now() });
    });
    return;
  }
  if (!['suno.com', 'www.suno.com'].includes(location.hostname)) return;
  if (page.__SUNO_LOCAL_RECORDER__) return;
  page.__SUNO_LOCAL_RECORDER__ = true;
  let config = GM_getValue(CONFIG, null), queued = [], busy = false, dropped = 0, pending = 0, lastError = '';
  GM_addValueChangeListener(CONFIG, (_k, _old, value) => { config = value; });
  const paired = () => config && Date.now() - config.at < 15000;
  function context(raw) {
    if (!paired() || !config.sessionId || !/^\/studio(?:\/|$)/.test(location.pathname)) return null;
    try { const u = new URL(raw, location.href); return u.origin === 'https://studio-api-prod.suno.com' ? { ...config, url: u.href } : null; } catch { return null; }
  }
  function post(c, path, value) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ method: 'POST', url: c.base + path,
      headers: { 'Content-Type': 'application/json', 'X-Controller-Key': c.key }, data: JSON.stringify(value), timeout: 5000,
      onload: (r) => r.status >= 200 && r.status < 300 ? resolve() : reject(new Error('capture ingress rejected ' + r.status)),
      onerror: () => reject(new Error('capture controller offline')), ontimeout: () => reject(new Error('capture ingress timeout')) }));
  }
  async function pump() {
    if (busy || !queued.length) return; busy = true;
    const item = queued[0];
    try { await post(item.config, '/api/captures', item.value); queued.shift(); lastError = ''; }
    catch (e) { lastError = e.message; item.attempts++; if (item.attempts >= 10) { queued.shift(); dropped++; } }
    finally { busy = false; if (queued.length) setTimeout(pump, lastError ? 1500 : 0); }
  }
  function record(c, value) {
    try {
      pending = Math.max(0, pending - 1);
      if (queued.length >= 100) { dropped++; lastError = 'capture queue full'; return; }
      // The capture envelope is our local correlation ID, not an auth session ID.
      // Restore only this trusted controller-issued field after body redaction.
      queued.push({ config: c, value: { ...p.redact(value), sessionId: c.sessionId }, attempts: 0 }); void pump();
    } catch { dropped++; lastError = 'capture serialization failed'; }
  }
  setInterval(() => {
    if (!paired()) return;
    void post(config, '/api/recorder/status', { queued: queued.length, dropped, pending,
      activeSession: /^\/studio(?:\/|$)/.test(location.pathname) ? config.sessionId : null, lastError }).catch(() => {});
  }, 3000);
  const headers = (source) => { try { return p.headers(Object.fromEntries(new page.Headers(source || {}))); } catch { return { omitted: 'unreadable-headers' }; } };
  async function limitedText(message) {
    const length = Number(message.headers.get('content-length'));
    if (length > 1024 * 1024 || !/(?:application\/(?:[\w.-]+\+)?json|text\/)/i.test(message.headers.get('content-type') || '')) return { omitted: 'non-text-or-size-limit' };
    const clone = message.clone(); if (!clone.body) return null;
    const reader = clone.body.getReader(); let size = 0, chunks = [], timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('body observation timeout')), 10000); });
      const read = async () => {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength; if (size > 1024 * 1024) return { omitted: 'size-limit' };
          chunks.push(chunk.value);
        }
        const data = new Uint8Array(size); let pos = 0; for (const chunk of chunks) { data.set(chunk, pos); pos += chunk.length; }
        return p.body(new TextDecoder().decode(data));
      };
      return await Promise.race([read(), timeout]);
    } catch { return { omitted: 'body-observation-failed' }; }
    finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
  }
  function requestBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
      return Promise.resolve(typeof init.body === 'string' ? p.body(init.body) : init.body == null ? null : { omitted: 'non-json-request-body' });
    }
    if (input instanceof page.Request && input.body) {
      try { return limitedText(input); } catch { return Promise.resolve({ omitted: 'request-clone-failed' }); }
    }
    return Promise.resolve(null);
  }
  const originalFetch = page.fetch;
  page.fetch = function (input, init) {
    const raw = typeof input === 'string' ? input : input?.url || String(input);
    const c = context(raw);
    if (!c) return originalFetch.apply(this, arguments);
    const start = performance.now(); const eventId = crypto.randomUUID(); const timestamp = new Date().toISOString();
    const request = { method: String(init?.method || input?.method || 'GET').toUpperCase(), url: p.url(c.url),
      headers: headers(init?.headers !== undefined ? init.headers : input?.headers) };
    let body;
    try { body = requestBody(input, init); } catch { body = Promise.resolve({ omitted: 'request-body-failed' }); }
    pending++;
    let result;
    try { result = originalFetch.apply(this, arguments); }
    catch (e) { record(c, { sessionId: c.sessionId, eventId, timestamp, source: 'fetch', request: { ...request, body: { omitted: 'sync-fetch-error' } }, response: { status: null, error: 'fetch synchronous failure' }, durationMs: performance.now() - start }); throw e; }
    // Return the original promise; never delay the official operation for recording.
    void result.then((response) => {
      const durationMs = performance.now() - start, observedAt = new Date().toISOString();
      void Promise.all([body, limitedText(response)]).then(([requestBody, responseBody]) => {
        record(c, { sessionId: c.sessionId, eventId, timestamp, source: 'fetch', request: { ...request, body: requestBody },
          response: { timestamp: observedAt, status: response.status, headers: headers(response.headers), body: responseBody }, durationMs, bodyObservationMs: performance.now() - start - durationMs });
      }).catch(() => { record(c, { sessionId: c.sessionId, eventId, timestamp, source: 'fetch', request, response: { status: response.status, body: { omitted: 'observer-failed' } }, durationMs }); });
    }, () => { void body.then((b) => record(c, { sessionId: c.sessionId, eventId, timestamp, source: 'fetch', request: { ...request, body: b }, response: { timestamp: new Date().toISOString(), status: null, error: 'network-or-abort' }, durationMs: performance.now() - start })); }).catch(() => {});
    return result;
  };
  const xhrState = new WeakMap();
  const proto = page.XMLHttpRequest.prototype;
  const open = proto.open, setHeader = proto.setRequestHeader, send = proto.send;
  proto.open = function (method, url) { const result = open.apply(this, arguments); xhrState.set(this, { method, raw: String(url), headers: {} }); return result; };
  proto.setRequestHeader = function (name, value) {
    const result = setHeader.apply(this, arguments); const s = xhrState.get(this); if (s) s.headers[name] = value; return result;
  };
  proto.send = function (body) {
    const s = xhrState.get(this), c = s && context(s.raw);
    if (!c) return send.apply(this, arguments);
    const start = performance.now(), timestamp = new Date().toISOString(), eventId = crypto.randomUUID();
    const request = { method: String(s.method).toUpperCase(), url: p.url(c.url), headers: p.headers(s.headers),
      body: typeof body === 'string' ? p.body(body) : body == null ? null : { omitted: 'non-json-request-body' } };
    pending++; let done = false;
    const finish = () => {
      if (done) return; done = true;
      let responseBody, responseHeaders = {};
      try {
        for (const line of this.getAllResponseHeaders().trim().split(/[\r\n]+/)) { const i = line.indexOf(':'); if (i > 0) responseHeaders[line.slice(0, i)] = line.slice(i + 1).trim(); }
        responseBody = this.responseType === 'json' ? p.body(this.response) : !this.responseType || this.responseType === 'text' ? p.body(this.responseText) : { omitted: 'binary-response' };
      } catch { responseBody = { omitted: 'unreadable-response' }; }
      record(c, { sessionId: c.sessionId, eventId, timestamp, source: 'xhr', request,
        response: { timestamp: new Date().toISOString(), status: this.status || null, headers: p.headers(responseHeaders), body: responseBody, error: this.status ? null : 'network-or-abort' }, durationMs: performance.now() - start });
    };
    this.addEventListener('loadend', finish, { once: true });
    try { return send.apply(this, arguments); } catch (e) { this.removeEventListener('loadend', finish); finish(); throw e; }
  };
})();
