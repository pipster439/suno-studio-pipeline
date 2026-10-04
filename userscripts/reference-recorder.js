// Independent observer: no Suno transport, auth sync, fetch result replacement or app mutations.
(function () {
  'use strict';
  const CONFIG = 'sunoReferenceRecorder:config', VERSION = '1.0.0', BUILD = '__REFERENCE_BUILD_HASH__';
  if (location.hostname === '127.0.0.1') {
    window.addEventListener('suno-reference-recorder-config', (e) => {
      const d = e.detail;
      if (d?.base !== location.origin || !/^http:\/\/127\.0\.0\.1:300[012]$/.test(d.base) || !/^[a-f0-9]{64}$/.test(d.key || '')) return;
      GM_setValue(CONFIG, { base: d.base, key: d.key, sessionId: d.sessionId, at: Date.now() });
    });
    return;
  }
  if (!['sunouploader.site', 'www.sunouploader.site'].includes(location.hostname)) return;
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const p = SunoPrivacy, rp = SunoReferencePrivacy, pageId = crypto.randomUUID();
  let config = GM_getValue(CONFIG, null), marker = null, sequence = 0, queue = [], busy = false, dropped = 0, omissions = 0, observing = 0, lastError = '', controls;
  const pending = new Map();
  GM_addValueChangeListener(CONFIG, (_k, _old, next) => { if (next?.sessionId !== config?.sessionId) marker = null; config = next; });
  const paired = () => config && Date.now() - config.at < 15000;
  const context = () => paired() && config.sessionId ? { ...config, marker } : null;
  function post(c, path, data) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ method: 'POST', url: c.base + path, timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'X-Controller-Key': c.key }, data: JSON.stringify(data),
      onload: (r) => r.status >= 200 && r.status < 300 ? resolve() : reject(new Error('local ingress rejected ' + r.status)),
      onerror: () => reject(new Error('local recorder offline')), ontimeout: () => reject(new Error('local ingress timeout')) }));
  }
  async function pump() {
    if (busy || !queue.length) return; busy = true; const item = queue[0];
    try { await post(item.c, '/api/reference/events', item.record); queue.shift(); lastError = ''; }
    catch (e) { lastError = e.message; if (++item.attempts >= 10) { queue.shift(); dropped++; } }
    finally { busy = false; if (queue.length) setTimeout(pump, lastError ? 1500 : 0); }
  }
  function snapshot() {
    try {
      const all = [...document.querySelectorAll('input,select,textarea')];
      const fields = all.filter((e) => !e.closest('[data-suno-reference-recorder]') && !/^(?:hidden|password|email|tel)$/i.test(e.type || '') &&
        !/authorization|cookie|jwt|token|captcha|secret|password|credential|device|session|username|email|subscription|entitlement|payment|card|one-time-code/i.test([e.name,e.id,e.autocomplete,e.getAttribute('aria-label')].join(' ')));
      return rp.clean({ fields: fields.slice(0, 100).map((e) => ({ tag: e.tagName, name: e.name, id: e.id, type: e.type,
        label: e.getAttribute('aria-label'), value: e.type === 'file' ? [...(e.files || [])].map((f) => ({ name: f.name, bytes: f.size, mime: f.type })) : e.value,
        checked: e.type === 'checkbox' || e.type === 'radio' ? e.checked : undefined, disabled: !!e.disabled })),
        excludedFields: all.length - fields.length, omittedFields: Math.max(0, fields.length - 100) });
    } catch { return { omitted: 'ui-snapshot-unavailable' }; }
  }
  const stamp = () => ({ timestamp: new Date().toISOString(), monotonicMs: performance.now(), sequence: ++sequence });
  function emit(c, kind, data, requestId = null, before = null, at = null) {
    if (!c) return;
    try {
      const safe = rp.clean(data, 2 * 1024 * 1024);
      if (JSON.stringify(safe).includes('"omitted"')) omissions++;
      const record = { recordId: crypto.randomUUID(), sessionId: c.sessionId, pageId, ...(at || stamp()), pageUrl: p.url(location.href), kind,
        requestId: typeof requestId === 'string' ? p.redact(requestId) : null, marker: c.marker, observedMarker: marker,
        data: safe, uiSnapshot: before || snapshot() };
      if (queue.length >= 200) { dropped++; lastError = 'reference queue full'; return; }
      queue.push({ c, record, attempts: 0 }); void pump();
    } catch { dropped++; lastError = 'reference serialization failed'; }
  }
  function consoleEvent(name, kind) {
    page.addEventListener(name, (event) => {
      try {
        const d = event.detail || {}, id = typeof d.requestId === 'string' ? d.requestId : null;
        const old = id && pending.get(id), c = kind === 'console_request' ? context() : old?.c || context();
        if (!c) return;
        const detail = rp.clean(d), before = snapshot();
        if (kind === 'console_request') {
          let body, bodySource = 'absent';
          if (typeof d.bodyJson === 'string') { body = rp.jsonBody(d.bodyJson); bodySource = 'bodyJson'; }
          else if (Object.prototype.hasOwnProperty.call(d, 'body')) { body = rp.clean(d.body); bodySource = 'body'; }
          emit(c, kind, { path: typeof d.path === 'string' ? p.redact(d.path) : null,
            method: typeof d.method === 'string' ? d.method : null, body, bodySource, detail, duplicateRequestId: !!old }, id, before);
          if (id) {
            if (pending.size >= 5000 && !old) { dropped++; lastError = 'reference correlation limit'; }
            else pending.set(id, { c, completed: false, at: performance.now(), duplicate: !!old });
          }
        } else {
          emit(c, kind, { status: typeof d.status === 'number' ? d.status : null, statusSupplied: typeof d.status === 'number',
            ok: typeof d.ok === 'boolean' ? d.ok : null, detail, responseStructure: rp.shape(detail.result ?? detail),
            orphan: !old, duplicateResponse: old?.responseSeen === true, correlationAmbiguous: !!old?.duplicate,
            durationMs: old ? performance.now() - old.at : null }, id, before);
          if (old) { old.completed = true; if (kind === 'console_response') old.responseSeen = true; setTimeout(() => { if (pending.get(id) === old) pending.delete(id); }, 120000); }
        }
      } catch { dropped++; lastError = 'console event observation failed'; }
    }, { capture: true, passive: true });
  }
  consoleEvent('suno-console-upload-request', 'console_request');
  consoleEvent('suno-console-upload-response', 'console_response');
  consoleEvent('suno-console-upload-cancel', 'console_cancel');
  function target(raw) {
    const c = context(); if (!c) return null;
    try {
      const u = new URL(raw, location.href);
      const prefix = u.origin === location.origin && /^\/api(?:\/|$)/.test(u.pathname) ? 'backend' : u.origin === 'https://studio-api-prod.suno.com' ? 'suno_fetch' : null;
      return prefix ? { c, u, prefix } : null;
    } catch { return null; }
  }
  function blockedBody(u) { return /\/(?:auth|login|logout|session|captcha|billing|subscriptions?|entitlements?|payments?|accounts?|profile|me|membership)(?:\/|$)/i.test(u.pathname); }
  function body(value, u) {
    if (blockedBody(u)) return { omitted: 'authentication-account-payment-body' };
    if (value == null) return null;
    if (typeof value === 'string') return rp.jsonBody(value);
    if (typeof page.FormData !== 'undefined' && value instanceof page.FormData) return rp.clean({ formData: [...value.entries()] });
    return rp.clean(value);
  }
  async function responseBody(response, u) {
    if (blockedBody(u)) return { omitted: 'authentication-account-payment-body' };
    if (Number(response.headers.get('content-length')) > 1024 * 1024 || !/json|text\//i.test(response.headers.get('content-type') || '')) return { omitted: 'non-json-or-size-limit' };
    let reader, timer;
    try {
      reader = response.clone().body?.getReader(); if (!reader) return null;
      const read = async () => {
        let size = 0, chunks = [];
        while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 1024 * 1024) return { omitted: 'size-limit' }; chunks.push(chunk.value); }
        const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        return rp.jsonBody(new TextDecoder().decode(data));
      };
      return await Promise.race([read(), new Promise((resolve) => { timer = setTimeout(() => resolve({ omitted: 'body-observation-timeout' }), 10000); })]);
    } catch { return { omitted: 'body-observation-failed' }; }
    finally { clearTimeout(timer); if (reader) void reader.cancel().catch(() => {}); }
  }
  const nativeFetch = page.fetch;
  page.fetch = function (input, init) {
    let t; try { t = target(typeof input === 'string' ? input : input?.url); } catch { /* observation failure */ }
    if (!t) return nativeFetch.apply(this, arguments);
    const id = crypto.randomUUID(), start = performance.now(), requestAt = stamp(); let requestBody; observing++;
    try {
      requestBody = init && Object.prototype.hasOwnProperty.call(init, 'body') ? Promise.resolve(body(init.body, t.u)) :
        input instanceof page.Request && input.body ? responseBody(input, t.u) : Promise.resolve(null);
    } catch { requestBody = Promise.resolve({ omitted: 'request-observation-failed' }); }
    const before = snapshot(); let method, url, path;
    try { method = String(init?.method || input?.method || 'GET').toUpperCase(); url = p.url(t.u.href); path = p.url(t.u.pathname + t.u.search); }
    catch { observing--; return nativeFetch.apply(this, arguments); }
    let headers; try { headers = p.headers(Object.fromEntries(new page.Headers(init?.headers !== undefined ? init.headers : input?.headers))); } catch { headers = { omitted: 'unreadable-headers' }; }
    let result;
    try { result = nativeFetch.apply(this, arguments); }
    catch (e) { observing--; emit(t.c, t.prefix + '_request', { url, path, method, body: { omitted: 'sync-fetch-error' } }, id, before, requestAt); emit(t.c, t.prefix + '_response', { url, path, status: null, error: 'sync-fetch-error' }, id); throw e; }
    observing++;
    void requestBody.then((b) => emit(t.c, t.prefix + '_request', { url, path, method, headers, body: b }, id, before, requestAt)).finally(() => { observing--; }).catch(() => {});
    void result.then((r) => {
      const durationMs = performance.now() - start, responseAt = stamp(), after = snapshot();
      void responseBody(r, t.u).then((b) => emit(t.c, t.prefix + '_response', { url, path, status: r.status, body: b,
        headers: p.headers(Object.fromEntries(r.headers)), responseStructure: rp.shape(b), durationMs }, id, after, responseAt)).finally(() => { observing--; }).catch(() => {});
    }, () => { observing--; emit(t.c, t.prefix + '_response', { url, path, status: null, error: 'network-or-abort', durationMs: performance.now() - start }, id); }).catch(() => {});
    return result; // Exact original promise; no delay/retry/cancel of application traffic.
  };
  const xhr = page.XMLHttpRequest?.prototype, states = new WeakMap();
  if (xhr) {
    const open = xhr.open, send = xhr.send, setHeader = xhr.setRequestHeader;
    xhr.open = function (method, url) { const result = open.apply(this, arguments); states.set(this, { method, raw: String(url), headers: {} }); return result; };
    if (setHeader) xhr.setRequestHeader = function (key, value) { const result = setHeader.apply(this, arguments); const state = states.get(this); if (state) state.headers[key] = value; return result; };
    xhr.send = function (value) {
      const state = states.get(this), t = state && target(state.raw); if (!t) return send.apply(this, arguments);
      let id, start, url, path;
      try {
        id = crypto.randomUUID(); start = performance.now(); url = p.url(t.u.href); path = p.url(t.u.pathname + t.u.search);
        emit(t.c, t.prefix + '_request', { url, path, method: String(state.method).toUpperCase(), headers: p.headers(state.headers), body: body(value, t.u), networkSource: 'xhr' }, id);
      } catch { return send.apply(this, arguments); }
      observing++;
      let done = false; const finish = () => {
        if (done) return; done = true; observing--;
        let b; try { b = this.responseType === 'json' ? body(this.response, t.u) : !this.responseType || this.responseType === 'text' ? body(this.responseText, t.u) : { omitted: 'binary' }; } catch { b = { omitted: 'xhr-unreadable' }; }
        emit(t.c, t.prefix + '_response', { url, path, status: this.status || null, body: b, responseStructure: rp.shape(b), durationMs: performance.now() - start, networkSource: 'xhr' }, id);
      };
      this.addEventListener('loadend', finish, { once: true });
      try { return send.apply(this, arguments); } catch (e) { finish(); throw e; }
    };
  }
  function addPanel() {
    if (!document.documentElement) return;
    const host = document.createElement('div'); host.setAttribute('data-suno-reference-recorder', '');
    host.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483646';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<style>:host{font:12px system-ui;color:#eee}details{background:#17212e;border:1px solid #79899d;border-radius:8px;padding:8px;max-width:290px}input{width:250px;margin:6px 0}button{margin:3px}p{margin:5px 0;white-space:normal}</style><details open><summary>参考 Recorder · 仅观察</summary><p id="status"></p><input id="label" placeholder="本次动作，例如：创建 project"><br><button id="begin">动作开始</button><button id="end">动作完成</button><p>每次只执行一个动作。等待队列归零后标记完成。</p></details>';
    controls = Object.fromEntries(['status','label','begin','end'].map((id) => [id,shadow.getElementById(id)]));
    controls.begin.onclick = () => { const c = context(), label = controls.label.value.trim(); if (!c || !label || marker) return; marker = { id: crypto.randomUUID(), label: p.redact(label) }; emit({ ...c, marker }, 'marker', { phase: 'begin', label: marker.label }); };
    controls.end.onclick = () => { const c = context(); if (!c || !marker) return; emit(c, 'marker', { phase: 'end', label: marker.label }); marker = null; };
    document.documentElement.appendChild(host); updatePanel();
  }
  function updatePanel() {
    if (!controls) return;
    controls.status.textContent = `${context() ? '采集中' : '未开启 capture'} · 待响应 ${[...pending.values()].filter((v) => !v.completed).length + observing} · 队列 ${queue.length} · 丢失 ${dropped} · 省略 ${omissions}${lastError ? ' · ' + lastError : ''}`;
    controls.begin.disabled = !context() || !!marker; controls.end.disabled = !context() || !marker;
  }
  setInterval(() => {
    updatePanel(); if (!paired()) return;
    void post(config, '/api/reference/status', { version: VERSION, buildId: BUILD, pageId, activeSession: config.sessionId,
      pending: [...pending.values()].filter((v) => !v.completed).length + observing, queued: queue.length, dropped, omissions, lastError }).catch(() => {});
  }, 3000);
  if (document.documentElement) addPanel(); else document.addEventListener('DOMContentLoaded', addPanel, { once: true });
})();
