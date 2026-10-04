// ==UserScript==
// @name         Suno Console 登录同步助手
// @namespace    https://suno-console.local/
// @version      1.3.11
// @description  同步 Suno 登录、直传音频；作品库和作品状态在本机直连查询，并动态获取 Cover 验证信息。
// @updateURL    https://localhost:3000/suno-console-cover-bridge.user.js
// @downloadURL  https://localhost:3000/suno-console-cover-bridge.user.js
// @match        https://suno.com/*
// @match        https://www.suno.com/*
// @match        https://sunouploader.site/*
// @match        https://www.sunouploader.site/*
// @match        http://156.239.230.79/*
// @match        http://127.0.0.1:3000/*
// @match        http://127.0.0.1:3001/*
// @match        http://127.0.0.1:3002/*
// @match        http://localhost:3000/*
// @match        http://localhost:3001/*
// @match        http://localhost:3002/*
// @run-at       document-start
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect       studio-api-prod.suno.com
// @connect       sunouploader.site
// @connect       www.sunouploader.site
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.3.11';
  const AUTO_REFRESH_INTERVAL = 15_000;
  const SCRIPT_URL = 'https://localhost:3000/suno-console-cover-bridge.user.js';
  const UPDATE_CHECK_KEY = 'sunoConsoleAuthSync:updateCheck';
  const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
  const AUTH_KEY = 'sunoConsoleAuthSync:payload';
  const HEARTBEAT_KEY = 'sunoConsoleAuthSync:heartbeat';
  const SYNC_REQUEST_KEY = 'sunoConsoleAuthSync:request';
  const COVER_VERIFICATION_REQUEST_KEY = 'sunoConsoleCoverVerification:request';
  const COVER_VERIFICATION_RESPONSE_KEY = 'sunoConsoleCoverVerification:response';
  const AUDIO_DOWNLOAD_REQUEST_KEY = 'sunoConsoleAudioDownload:request';
  const AUDIO_DOWNLOAD_RESPONSE_KEY = 'sunoConsoleAudioDownload:response';
  const AUDIO_DOWNLOAD_PROGRESS_KEY = 'sunoConsoleAudioDownload:progress';
  const AUDIO_CAPTURE_REQUEST_KEY = 'sunoConsoleAudioCapture:request';
  const AUDIO_CAPTURE_RESPONSE_KEY = 'sunoConsoleAudioCapture:response';
  // Decode only for freshness/visitor checks, never as proof of authenticity.
  // A new credential is checked against Suno's read-only session endpoint below.
  function sessionClaims(authorization) {
    try {
      const token = String(authorization || '').replace(/^Bearer\s+/i, '');
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
      if (!Number.isFinite(claims?.exp) || claims['suno.com/claims/visitor'] === true) return null;
      if (!claims.sub && !claims['suno.com/claims/user_id']) return null;
      return claims;
    } catch { return null; }
  }

  function usableAuthorization(authorization, marginSeconds = 5) {
    const claims = sessionClaims(authorization);
    return Boolean(claims && claims.exp * 1000 > Date.now() + marginSeconds * 1000);
  }

  function cookieAuthorization(cookie) {
    // Match SunoAuthProvider: __session cookies, newest iat then exp, no visitors.
    const candidates = [];
    for (const part of String(cookie || '').split(';')) {
      const separator = part.indexOf('=');
      if (part.slice(0, separator).trim() !== '__session') continue;
      try {
        const authorization = `Bearer ${decodeURIComponent(part.slice(separator + 1))}`;
        const claims = sessionClaims(authorization);
        if (claims && usableAuthorization(authorization)) candidates.push({ authorization, claims });
      } catch { /* Ignore malformed cookies, never publish their contents. */ }
    }
    candidates.sort((a, b) => (b.claims.iat ?? b.claims.exp) - (a.claims.iat ?? a.claims.exp) || b.claims.exp - a.claims.exp);
    return candidates[0]?.authorization || null;
  }

  const isSuno = location.hostname === 'suno.com' || location.hostname === 'www.suno.com';
  if (isSuno) startSunoSync();
  else startConsoleSync();

  function startConsoleSync() {
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    // 认证头只留在 Tampermonkey。本地页面可通过此桥接读取作品库和作品状态，
    // 但不会把这些只读 Suno 请求转发到我们的服务器。
    pageWindow.__SUNO_CONSOLE_BRIDGE__ = { version: VERSION, type: 'auth-sync-upload', upload: true, localSunoRead: true };
    const panel = mountPanel('工作台');
    void checkForScriptUpdate(panel);
    let syncing = false;
    let queuedSync = null;
    let syncFailed = false;
    let authInvalidated = false;
    const pendingCoverVerifications = new Map();
    const pendingUploadRequests = new Map();
    const pendingAudioDownloads = new Map();
    const pendingAudioCaptures = new Map();

    async function refreshAccount() {
      try {
        const session = await fetch('/api/session', { credentials: 'include', cache: 'no-store' }).then((response) => response.json());
        const accountLabel = session?.user?.displayName || session?.user?.email || session?.user?.id;
        panel.setAccount(accountLabel ? `账号：${accountLabel}` : '工作台尚未登录', Boolean(accountLabel));
        return session?.user?.id || null;
      } catch {
        panel.setAccount('无法读取工作台账号', false);
        return null;
      }
    }

    async function sync(payload) {
      if (!payload?.headers) return;
      if (!usableAuthorization(payload.headers.authorization)) {
        panel.update('warning', '等待最新 Suno 登录', '缓存凭据已过期，请保持 Suno 标签页打开');
        return;
      }
      if (syncing) { queuedSync = payload; return; }
      syncing = true;
      try {
        const userId = await refreshAccount();
        if (!userId) throw new Error('请先登录工作台');
        panel.update('working', '正在同步 Suno 登录', '正在更新当前账号');
        const response = await fetch('/api/auth', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ headers: payload.headers }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || '同步失败');
        syncFailed = false;
        authInvalidated = false;
        panel.update('ready', 'Suno 登录已同步', `账号 ${userId} 的线上功能已更新`);
        panel.setRefresh(payload.capturedAt || Date.now(), AUTO_REFRESH_INTERVAL);
        window.dispatchEvent(new CustomEvent('suno-auth-synced', { detail: data.auth }));
        // 保留最近一次认证数据供本地上传桥接器使用；数据只存在用户自己的油猴存储中。
      } catch (error) {
        syncFailed = true;
        panel.update('error', '同步失败', error instanceof Error ? error.message : String(error));
      } finally {
        syncing = false;
        const next = queuedSync;
        queuedSync = null;
        if (next) void sync(next);
      }
    }

    function requestSync() {
      panel.update('working', '正在请求最新登录', '请保持 Suno 标签页打开');
      GM_setValue(SYNC_REQUEST_KEY, { at: Date.now() });
    }

    function refreshHeartbeat(heartbeat) {
      // Do not overwrite an in-flight sync or a rejected workbench request with
      // a green "ready" badge merely because Tampermonkey still has a cache.
      if (syncing || syncFailed) return;
      const cachedAuth = GM_getValue(AUTH_KEY, null);
      if (usableAuthorization(cachedAuth?.headers?.authorization) && !authInvalidated) {
        panel.update('ready', '本地直传已就绪', '已缓存 Suno 登录，可直接从浏览器上传');
        panel.setRefresh(cachedAuth.capturedAt, AUTO_REFRESH_INTERVAL);
      }
      else if (!heartbeat || Date.now() - Number(heartbeat.at) > 15_000) panel.update('warning', '需要初始化本地直传', '网站已有登录不等于本地桥接；打开 Suno 后点击一次同步即可');
      else if (heartbeat.authenticated) panel.update('ready', '同步助手已就绪', 'Suno 登录信息可随时同步');
      else panel.update('warning', '等待 Suno 登录', '请登录或刷新 Suno 页面');
    }

    panel.onSync(requestSync);
    window.addEventListener('suno-auth-sync-request', requestSync);
    // 网站只传递 API 路径与业务数据；认证头始终留在油猴脚本中，音频则由网页直传 Suno 分配的 S3 地址。
    function handleUploadRequest(request) {
      if (!request.requestId || !request.path) return;
      if (pendingUploadRequests.has(request.requestId)) return;
      let requestBody = request.body;
      if (typeof request.bodyJson === 'string') {
        try { requestBody = JSON.parse(request.bodyJson); }
        catch {
          window.dispatchEvent(new CustomEvent('suno-console-upload-response', { detail: { requestId: request.requestId, ok: false, error: '上传桥接请求数据无效' } }));
          return;
        }
      }
      const pending = callSunoApi(request.path, request.method, requestBody);
      pendingUploadRequests.set(request.requestId, pending);
      void pending.promise
        .then((result) => window.dispatchEvent(new CustomEvent('suno-console-upload-response', { detail: { requestId: request.requestId, ok: true, result } })) )
        .catch((error) => window.dispatchEvent(new CustomEvent('suno-console-upload-response', { detail: { requestId: request.requestId, ok: false, error: error.message || String(error), status: error.status } })) )
        .finally(() => pendingUploadRequests.delete(request.requestId));
    }
    window.addEventListener('suno-console-upload-request', (event) => handleUploadRequest(event.detail || {}));
    window.addEventListener('suno-console-upload-cancel', (event) => {
      const requestId = event.detail?.requestId;
      if (!requestId) return;
      pendingUploadRequests.get(requestId)?.abort();
    });
    window.addEventListener('suno-audio-download-request', (event) => {
      const request = event.detail || {};
      if (!request.requestId || !request.clipId) return;
      pendingAudioDownloads.set(request.requestId, true);
      GM_setValue(AUDIO_DOWNLOAD_REQUEST_KEY, { requestId: request.requestId, clipId: String(request.clipId), title: String(request.title || ''), format: 'wav', at: Date.now() });
      GM_setValue(AUDIO_DOWNLOAD_PROGRESS_KEY, { requestId: request.requestId, phase: 'resolving', message: '正在打开 Suno 歌曲页…', at: Date.now() });
      // The page-side reader must be installed before Suno starts its normal
      // playback request, so open the exact song page after the task is saved.
      try {
        GM_openInTab(`https://suno.com/song/${encodeURIComponent(String(request.clipId))}?suno_fast_export=1`, { active: false, insert: true, setParent: true });
      } catch { /* An already-open matching song page can process the task. */ }
    });
    window.addEventListener('suno-audio-request', (event) => {
      const request = event.detail || {};
      if (!request.requestId || !request.clipId) return;
      pendingAudioCaptures.set(request.requestId, true);
      GM_setValue(AUDIO_CAPTURE_REQUEST_KEY, { requestId: request.requestId, clipId: String(request.clipId), at: Date.now(), mode: 'bridge' });
      // Open the exact song page in a background tab so the Suno player has
      // the clip context needed to issue /api/mango/rights and start playback.
      try {
        GM_openInTab(`https://suno.com/song/${encodeURIComponent(String(request.clipId))}?suno_fast_export=1`, { active: false, insert: true, setParent: true });
      } catch {
        // If the manager blocks background tabs, the user can keep an already
        // open matching Suno song page and the request will still work there.
      }
    });
    window.addEventListener('suno-cover-verification-request', (event) => {
      const request = event.detail || {};
      if (!request.requestId) return;
      pendingCoverVerifications.set(request.requestId, true);
      panel.update('working', '正在获取 Cover 验证', '请保持已登录的 Suno Create 标签页打开');
      GM_setValue(COVER_VERIFICATION_REQUEST_KEY, { requestId: request.requestId, at: Date.now() });
    });
    GM_addValueChangeListener(AUTH_KEY, (key, oldValue, payload, remote) => { if (remote) void sync(payload); });
    GM_addValueChangeListener(HEARTBEAT_KEY, (key, oldValue, heartbeat) => refreshHeartbeat(heartbeat));
    GM_addValueChangeListener(COVER_VERIFICATION_RESPONSE_KEY, (key, oldValue, response, remote) => {
      if (!remote || !response?.requestId || !pendingCoverVerifications.has(response.requestId)) return;
      pendingCoverVerifications.delete(response.requestId);
      panel.update(response.ok ? 'ready' : 'error', response.ok ? 'Cover 验证已就绪' : 'Cover 验证获取失败', response.ok ? '正在安全转交本次请求使用' : (response.error || '请刷新 Suno Create 页面后重试'));
      window.dispatchEvent(new CustomEvent('suno-cover-verification-response', { detail: response }));
    });
    GM_addValueChangeListener(AUDIO_DOWNLOAD_RESPONSE_KEY, (key, oldValue, response, remote) => {
      if (!remote || !response?.requestId || !pendingAudioDownloads.has(response.requestId)) return;
      pendingAudioDownloads.delete(response.requestId);
      window.dispatchEvent(new CustomEvent('suno-audio-download-response', { detail: response }));
    });
    GM_addValueChangeListener(AUDIO_DOWNLOAD_PROGRESS_KEY, (key, oldValue, progress, remote) => {
      if (!remote || !progress?.requestId || !pendingAudioDownloads.has(progress.requestId)) return;
      window.dispatchEvent(new CustomEvent('suno-audio-download-progress', { detail: progress }));
    });
    GM_addValueChangeListener(AUDIO_CAPTURE_RESPONSE_KEY, (key, oldValue, response, remote) => {
      if (!remote || !response?.requestId || !pendingAudioCaptures.has(response.requestId)) return;
      pendingAudioCaptures.delete(response.requestId);
      window.dispatchEvent(new CustomEvent('suno-audio-response', { detail: response }));
    });
    window.setInterval(() => refreshHeartbeat(GM_getValue(HEARTBEAT_KEY, null)), 5_000);
    window.setInterval(() => void refreshAccount(), 15_000);
    void refreshAccount();
    refreshHeartbeat(GM_getValue(HEARTBEAT_KEY, null));
    const pending = GM_getValue(AUTH_KEY, null);
    if (pending) void sync(pending);
    if (!usableAuthorization(pending?.headers?.authorization)) requestSync();
    window.dispatchEvent(new CustomEvent('suno-extension-ready', { detail: { type: 'auth-sync-upload', version: VERSION, upload: true, localSunoRead: true } }));

    function callSunoApi(path, method = 'GET', body) {
      let cancelled = false;
      let cancelWait = () => {};
      let transport = null;
      async function freshHeaders() {
        const cached = GM_getValue(AUTH_KEY, null);
        if (usableAuthorization(cached?.headers?.authorization, 15)) return cached.headers;
        GM_setValue(SYNC_REQUEST_KEY, { at: Date.now() });
        return new Promise((resolve, reject) => {
          const finish = (error, value) => { window.clearInterval(timer); error ? reject(error) : resolve(value); };
          cancelWait = () => finish(new Error('上传请求已取消'));
          const deadline = Date.now() + 15_000;
          const timer = window.setInterval(() => {
            const latest = GM_getValue(AUTH_KEY, null);
            if (usableAuthorization(latest?.headers?.authorization, 10)) finish(null, latest.headers);
            else if (Date.now() >= deadline) finish(new Error('Suno 登录未续期，请打开已登录的 Suno 页面后重试'));
          }, 200);
          if (cancelled) cancelWait();
        });
      }
      const promise = freshHeaders().then((headers) => {
      if (cancelled) throw new Error('上传请求已取消');
      const browserToken = btoa(JSON.stringify({ timestamp: Date.now() }));
      const requestHeaders = { ...headers, 'browser-token': JSON.stringify({ token: browserToken }) };
      Object.keys(requestHeaders).forEach((key) => {
        if (key.toLowerCase() === 'content-type') delete requestHeaders[key];
      });
      requestHeaders['Content-Type'] = 'application/json';
      const requestData = body === undefined ? undefined : JSON.stringify(body);
      return new Promise((resolve, reject) => { transport = GM_xmlhttpRequest({
        method: String(method || 'GET').toUpperCase(),
        url: `https://studio-api-prod.suno.com${path}`,
        headers: requestHeaders,
        data: requestData,
        onload: (response) => {
          let result = null;
          try { result = response.responseText ? JSON.parse(response.responseText) : null; } catch { result = response.responseText; }
          if (response.status >= 200 && response.status < 300) resolve(result);
          else {
            const detail = typeof result === 'string' ? result : result?.detail || result?.error || result?.message || response.statusText;
            const error = new Error(`Suno 接口失败 ${response.status}：${detail}`);
            error.status = response.status;
            if (response.status === 401 && !authInvalidated && GM_getValue(AUTH_KEY, null)?.headers?.authorization === headers.authorization) {
              authInvalidated = true;
              GM_deleteValue(AUTH_KEY);
              panel.update('error', 'Suno 登录已失效', '上传队列已停止，请重新登录 Suno 后一键重试');
              panel.setAccount('Suno 登录已过期', false);
              void fetch('/api/auth?expired=1', { method: 'DELETE', credentials: 'include' }).catch(() => undefined);
              window.dispatchEvent(new CustomEvent('suno-auth-expired', { detail: { source: 'userscript' } }));
              GM_setValue(SYNC_REQUEST_KEY, { at: Date.now() });
            }
            reject(error);
          }
        },
        onerror: () => reject(new Error('无法连接 Suno，请检查网络或登录状态')),
        onabort: () => reject(new Error('上传请求已取消')),
        ontimeout: () => reject(new Error('请求 Suno 超时')),
        timeout: 30_000,
      }); });
      });
      return { promise, abort: () => { cancelled = true; cancelWait(); transport?.abort?.(); } };
    }
  }

  function startSunoSync() {
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    // Tampermonkey may briefly keep an older execution alive during an update.
    // Only one instance may patch Suno's page APIs and mount the status panel.
    if (pageWindow.__SUNO_CONSOLE_AUTH_SYNC_ACTIVE__) return;
    pageWindow.__SUNO_CONSOLE_AUTH_SYNC_ACTIVE__ = { version: VERSION };
    const panel = mountPanel('SUNO');
    void checkForScriptUpdate(panel);
    const headers = {};
    const allowed = ['authorization', 'device-id', 'browser-token', 'referring-pathname', 'referring-url-params', 'referring-origin', 'referring-external-referrer'];
    let lastFingerprint = '';
    let publishing = false;
    let publishAgain = false;
    let forcePublishAgain = false;
    let cachedRootStore = null;

    function currentHeaders() {
      const plusHeaders = pageWindow.__SUNO_BATCH_API_HEADERS__ && typeof pageWindow.__SUNO_BATCH_API_HEADERS__ === 'object' ? pageWindow.__SUNO_BATCH_API_HEADERS__ : {};
      return { ...headers, ...plusHeaders };
    }

    async function publish(force = false) {
      if (publishing) { publishAgain = true; forcePublishAgain ||= force; return; }
      publishing = true;
      try {
      const latest = currentHeaders();
      const cookieAuth = cookieAuthorization(document.cookie);
      if (cookieAuth) latest.authorization = cookieAuth;
      // If the page has an explicit session cookie but no valid signed-in
      // candidate (logout/visitor/expired), never resurrect captured headers.
      else if (/(?:^|;)\s*__session=/.test(document.cookie)) delete latest.authorization;
      // New SunoAuthProvider reads __session; older pages still expose Clerk.
      // Never force a different account's cached headers over the active session.
      if (pageWindow.Clerk?.loaded && !pageWindow.Clerk.session && !cookieAuth) delete latest.authorization;
      if (pageWindow.Clerk?.session) {
        try {
          let token = null;
          try { token = await pageWindow.Clerk?.session?.getToken?.({ skipCache: force || !usableAuthorization(latest.authorization, 45) }); }
          catch { token = await pageWindow.Clerk?.session?.getToken?.(); }
          if (token) latest.authorization = `Bearer ${token}`;
        } catch { /* Only an unexpired credential may survive a refresh failure. */ }
      }
      if (!usableAuthorization(latest.authorization)) {
        lastFingerprint = '';
        panel.update('warning', '等待有效 Suno 登录', '请保持已登录的 Suno 页面打开，正在等待会话续期');
        panel.setAccount('Suno 登录尚未就绪', false);
        return;
      }
      // Browser/referrer headers change on every request; only credential/device
      // changes need a new synchronization and validation request.
      const fingerprint = `${latest.authorization}|${latest['device-id'] || ''}`;
      if (!force && fingerprint === lastFingerprint) return;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      let response;
      try {
        response = await originalFetch('https://studio-api-prod.suno.com/api/session/', {
          headers: { ...latest, 'browser-token': JSON.stringify({ token: btoa(JSON.stringify({ timestamp: Date.now() })) }) },
          signal: controller.signal,
        });
      } finally { window.clearTimeout(timeout); }
      if (!response.ok) throw new Error(`Suno 会话验证失败（${response.status}），请刷新 Suno 页面后重试`);
      if (!usableAuthorization(latest.authorization)) throw new Error('Suno 凭据已过期，等待重新同步');
      lastFingerprint = fingerprint;
      GM_setValue(AUTH_KEY, { headers: latest, capturedAt: Date.now(), version: VERSION });
      panel.update('ready', '登录信息已发送', '工作台会自动更新状态');
      panel.setAccount('Suno 已登录', true);
      panel.setRefresh(Date.now(), AUTO_REFRESH_INTERVAL);
      } catch (error) {
        panel.update('warning', 'Suno 登录尚未验证', error?.message || '请检查网络后重试');
      } finally {
        publishing = false;
        if (publishAgain) {
          const forceNext = forcePublishAgain;
          publishAgain = false;
          forcePublishAgain = false;
          void publish(forceNext);
        }
      }
    }

    function remember(source) {
      try {
        const normalized = new pageWindow.Headers(source || {});
        allowed.forEach((key) => {
          const value = normalized.get(key);
          if (value) headers[key] = value;
        });
        if (usableAuthorization(headers.authorization)) void publish();
      } catch { /* 忽略无法解析的请求头 */ }
    }

    const originalFetch = pageWindow.fetch;
    function patchedFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url || String(input || '');
      let isApi = false;
      try { isApi = new URL(url, location.href).origin === 'https://studio-api-prod.suno.com'; } catch { /* Invalid URL. */ }
      if (isApi) {
        if (input instanceof pageWindow.Request) remember(input.headers);
        remember(init.headers);
      }
      return originalFetch.apply(this, arguments);
    }
    pageWindow.fetch = patchedFetch;
    // Keep this lightweight observer for rotated credentials, including Suno's
    // new auth provider. It never changes the request or consumes its response.

    // Suno now feeds encrypted CDN responses into its own decryptor and only
    // appends clear fMP4/WebM segments to MSE. Capture those clear segments
    // without touching the ciphertext or the player's decryption keys.
    // Keep one capture source per clip. V1 mixed the raw stream with the
    // already-clear MSE segments, producing repeated ftyp/moov boxes.
    const sharedCapture = pageWindow.__SUNO_MSE_CAPTURE_V2__ || { captures: new Map(), pending: new Map(), owner: 'userscript' };
    pageWindow.__SUNO_MSE_CAPTURE_V2__ = sharedCapture;
    const audioCaptures = sharedCapture.captures;
    const pendingAudioDownloads = sharedCapture.pending;
    const completeDownloadRequests = new Map();
    const completeDownloadSessions = new Map();
    // Retain non-sensitive runtime state for troubleshooting the exact stream
    // selected by Suno's player; it contains no account credentials or media bytes.
    sharedCapture.completeDownloadRequests = completeDownloadRequests;
    sharedCapture.completeDownloadSessions = completeDownloadSessions;
    const publishCompleteDownloadProgress = (session, phase, loadedBytes, totalBytes, message) => {
      const request = session?.request || session;
      if (!request?.requestId) return;
      const now = Date.now();
      if (phase === 'downloading' && session.lastProgressAt && now - session.lastProgressAt < 250 && loadedBytes !== totalBytes) return;
      if (session) session.lastProgressAt = now;
      GM_setValue(AUDIO_DOWNLOAD_PROGRESS_KEY, { requestId: request.requestId, phase, loadedBytes, totalBytes, message, at: now });
    };
    const currentClipId = () => (location.pathname.match(/\/song\/([0-9a-f-]{36})/i) || [])[1] || '';
    const COMPLETE_STREAM_MEDIA_ORIGIN = 'https://d2lwuy8qc234o3.cloudfront.net';
    const COMPLETE_STREAM_MAX_BYTES = 256 * 1024 * 1024;
    const captureFor = (clipId, mime, source = 'stream') => {
      if (!clipId) return null;
      let capture = audioCaptures.get(clipId);
      if (!capture) {
        capture = { clipId, mime: mime || 'audio/mp4', source, chunks: [], timer: null, settled: false, updatedAt: Date.now() };
        audioCaptures.set(clipId, capture);
      }
      // MSE is the authoritative clear-media order. If it appears after a
      // stream capture, discard the stream bytes instead of concatenating the
      // two representations.
      if (source === 'mse' && capture.source !== 'mse') {
        window.clearTimeout(capture.timer);
        capture.source = 'mse';
        capture.chunks = [];
        capture.settled = false;
      } else if (source === 'stream' && capture.source === 'mse') {
        return null;
      }
      if (mime && !capture.mime) capture.mime = mime;
      capture.updatedAt = Date.now();
      return capture;
    };
    const scheduleFinish = (capture, delay = 1_800) => {
      if (!capture) return;
      window.clearTimeout(capture.timer);
      capture.timer = window.setTimeout(() => finishCapture(capture), delay);
    };
    const saveCapture = (capture, request) => {
      const blob = new Blob(capture.chunks, { type: capture.mime || 'audio/mp4' });
      const extension = /webm|opus/i.test(capture.mime || '') ? 'webm' : 'm4a';
      const base = String(request.title || capture.clipId).replace(/[\\/:*?"<>|]/g, '_').trim() || capture.clipId;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${base}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    };
    const safeDownloadName = (request, clipId) => String(request.title || clipId).replace(/[\\/:*?"<>|]/g, '_').trim() || clipId;
    const emitCompleteDownloadFailure = (session, error) => {
      if (!session || session.finished) return;
      session.finished = true;
      if (session.timeout) window.clearTimeout(session.timeout);
      completeDownloadSessions.delete(session.clipId);
      completeDownloadRequests.delete(session.clipId);
      GM_setValue(AUDIO_DOWNLOAD_RESPONSE_KEY, {
        requestId: session.request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    };
    const encodeWav = async (audioBuffer, onProgress) => {
      const channels = Math.max(1, Math.min(2, audioBuffer.numberOfChannels || 1));
      const frames = audioBuffer.length;
      const bytesPerFrame = channels * 2;
      const output = new ArrayBuffer(44 + frames * bytesPerFrame);
      const view = new DataView(output);
      const writeText = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      writeText(0, 'RIFF'); view.setUint32(4, output.byteLength - 8, true); writeText(8, 'WAVE');
      writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, channels, true); view.setUint32(24, audioBuffer.sampleRate, true);
      view.setUint32(28, audioBuffer.sampleRate * bytesPerFrame, true); view.setUint16(32, bytesPerFrame, true);
      view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, frames * bytesPerFrame, true);
      const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index));
      let offset = 44;
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const sample = Math.max(-1, Math.min(1, channelData[channel][frame] || 0));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          offset += 2;
        }
        if (frame > 0 && frame % 131072 === 0) {
          onProgress?.(offset - 44, output.byteLength - 44);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }
      onProgress?.(output.byteLength - 44, output.byteLength - 44);
      return new Blob([output], { type: 'audio/wav' });
    };
    const joinCompleteStream = (session) => {
      if (session.receivedBytes !== session.expectedBytes) throw Error('Suno 音频未完整接收，已取消保存');
      const bytes = new Uint8Array(session.expectedBytes);
      let offset = 0;
      for (const chunk of session.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (offset !== session.expectedBytes) throw Error('Suno 音频分片长度不连续，已取消保存');
      return bytes;
    };
    const finishCompleteDownload = async (session) => {
      if (!session || session.finished || session.finalizing) return;
      session.finalizing = true;
      try {
        publishCompleteDownloadProgress(session, 'saving', undefined, undefined, '正在解码完整音频…');
        const bytes = joinCompleteStream(session);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        session.sha256 = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
        const Context = pageWindow.AudioContext || pageWindow.webkitAudioContext;
        if (!Context) throw Error('当前浏览器不支持 WAV 解码');
        const context = new Context();
        let audioBuffer;
        try { audioBuffer = await context.decodeAudioData(bytes.buffer.slice(0)); }
        finally { void context.close().catch(() => undefined); }
        publishCompleteDownloadProgress(session, 'saving', undefined, undefined, '正在生成 WAV 文件…');
        const wav = await encodeWav(audioBuffer, (loadedBytes, totalBytes) => {
          publishCompleteDownloadProgress(session, 'saving', loadedBytes, totalBytes, '正在生成 WAV 文件…');
        });
        const url = URL.createObjectURL(wav);
        const link = document.createElement('a');
        link.href = url; link.download = `${safeDownloadName(session.request, session.clipId)}.wav`;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        session.finished = true;
        if (session.timeout) window.clearTimeout(session.timeout);
        completeDownloadSessions.delete(session.clipId);
        completeDownloadRequests.delete(session.clipId);
        publishCompleteDownloadProgress(session, 'done', session.receivedBytes, session.receivedBytes, '下载已完成');
        GM_setValue(AUDIO_DOWNLOAD_RESPONSE_KEY, { requestId: session.request.requestId, ok: true, format: 'wav', bytes: session.receivedBytes, sha256: session.sha256 });
      } catch (error) {
        emitCompleteDownloadFailure(session, error);
      }
    };
    const finishCapture = (capture) => {
      if (!capture?.chunks.length) return;
      capture.settled = true;
      const request = pendingAudioDownloads.get(capture.clipId);
      if (!request) return;
      pendingAudioDownloads.delete(capture.clipId);
      if (request.mode === 'bridge') {
        try {
          GM_setValue(AUDIO_CAPTURE_RESPONSE_KEY, { requestId: request.requestId, ok: true, result: { clipId: capture.clipId, mime: capture.mime || 'audio/mp4', encoding: 'base64', chunks: capture.chunks.map((chunk) => { const bytes = new Uint8Array(chunk); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length))); return btoa(binary); }) } });
        } catch (error) {
          GM_setValue(AUDIO_CAPTURE_RESPONSE_KEY, { requestId: request.requestId, ok: false, error: error?.message || String(error) });
        }
        return;
      }
      try {
        saveCapture(capture, request);
        GM_setValue(AUDIO_DOWNLOAD_RESPONSE_KEY, { requestId: request.requestId, ok: true });
      } catch (error) {
        GM_setValue(AUDIO_DOWNLOAD_RESPONSE_KEY, { requestId: request.requestId, ok: false, error: error?.message || String(error) });
      }
    };
    const sniffAudioChunk = (value) => {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'audio/mp4';
      if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
      return '';
    };
    const completeStreamReader = pageWindow.ReadableStreamDefaultReader?.prototype;
    if (completeStreamReader?.read && !sharedCapture.completeReaderInstalled) {
      sharedCapture.completeReaderInstalled = true;
      const originalRead = completeStreamReader.read;
      completeStreamReader.read = function patchedCompleteStreamRead() {
        const clipId = currentClipId();
        const session = completeDownloadSessions.get(clipId);
        return originalRead.apply(this, arguments).then((result) => {
          try {
            if (!session || session.finished || session.reader && session.reader !== this) return result;
            if (!session.reader) {
              const first = result.value;
              // Several unrelated readers are active while the page starts.
              // Bind only to the first clear fMP4 reader; initial Range and
              // encrypted CDN readers never carry this marker.
              if (result.done || !(first instanceof Uint8Array) || first.byteLength < 8 || String.fromCharCode(...first.subarray(4, 8)) !== 'ftyp') return result;
              session.reader = this;
              panel.update('working', '正在读取 Suno 解密音频', '已进入官方明文播放流');
              publishCompleteDownloadProgress(session, 'downloading', 0, session.expectedBytes, '正在接收 Suno 解密音频…');
            }
            if (session.reader !== this) return result;
            if (result.done) {
              if (session.receivedBytes !== session.expectedBytes) emitCompleteDownloadFailure(session, Error('Suno 音频在 EOF 前中断，已取消保存'));
              else void finishCompleteDownload(session);
              return result;
            }
            const value = result.value;
            if (!(value instanceof Uint8Array)) throw Error('Suno 解密流返回了非字节分片');
            if (session.receivedBytes + value.byteLength > session.expectedBytes) throw Error('Suno 解密流长度超出声明长度');
            const copy = new Uint8Array(value.byteLength); copy.set(value);
            session.chunks.push(copy); session.receivedBytes += copy.byteLength;
            session.updatedAt = Date.now();
            publishCompleteDownloadProgress(session, 'downloading', session.receivedBytes, session.expectedBytes, '正在接收 Suno 解密音频…');
            if (session.receivedBytes === session.expectedBytes) {
              panel.update('working', '已接收完整音频', '正在浏览器内解码 WAV');
              // Suno's progressive reader can remain open after delivering
              // Content-Length bytes. The byte count is the completion signal;
              // waiting for EOF leaves the workbench in an endless "parsing" state.
              void finishCompleteDownload(session);
            }
          } catch (error) {
            emitCompleteDownloadFailure(session, error);
          }
          return result;
        }, (error) => {
          if (session?.reader === this) emitCompleteDownloadFailure(session, Error('Suno 官方播放流读取失败'));
          throw error;
        });
      };
    }
    if (!sharedCapture.completeFetchInstalled) {
      sharedCapture.completeFetchInstalled = true;
      const originalMediaFetch = pageWindow.fetch;
      pageWindow.fetch = async function patchedCompleteMediaFetch(input, init) {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
        let url;
        try { url = new URL(raw, location.href); } catch { return originalMediaFetch.apply(this, arguments); }
        const match = url.origin === COMPLETE_STREAM_MEDIA_ORIGIN && url.pathname.match(/^\/1\/clip\/([0-9a-f-]{36})\.m4a$/i);
        const request = match ? completeDownloadRequests.get(String(match[1]).toLowerCase()) : null;
        const response = await originalMediaFetch.apply(this, arguments);
        if (!request || !match || completeDownloadSessions.has(request.clipId)) return response;
        const expectedBytes = Number(response.headers.get('content-length'));
        const contentType = response.headers.get('content-type') || '';
        const isCompleteProgressiveResponse = response.status === 200
          && Number.isSafeInteger(expectedBytes)
          && expectedBytes > 0;
        // A player starts with one or more 206 Range probes. They are not a
        // failed download and must not complete the pending bridge request.
        if (!isCompleteProgressiveResponse) return response;
        if (expectedBytes > COMPLETE_STREAM_MAX_BYTES) {
          emitCompleteDownloadFailure({ clipId: request.clipId, request, finished: false }, Error('Suno 音频超过浏览器内处理上限，已取消保存'));
          return response;
        }
        const clipId = String(match[1]).toLowerCase();
        // The current CDN labels its encrypted m4a payload as
        // application/octet-stream. The URL, status and declared full length
        // are the stable contract; requiring audio/mp4 drops the valid stream.
        sharedCapture.lastCompleteMedia = { clipId, status: response.status, contentType, expectedBytes, at: Date.now() };
        completeDownloadSessions.set(clipId, {
          clipId, request, expectedBytes, receivedBytes: 0, chunks: [], reader: null,
          finished: false, finalizing: false, updatedAt: Date.now(), timeout: request.timeout,
        });
        panel.update('working', '正在等待 Suno 解密流', '播放器初始化完成后会自动开始读取');
        publishCompleteDownloadProgress(completeDownloadSessions.get(clipId), 'decrypting', 0, expectedBytes, '已获得完整播放流，正在解密…');
        return response;
      };
    }
    if (!sharedCapture.streamInstalled && pageWindow.ReadableStream?.prototype?.getReader) {
      sharedCapture.streamInstalled = true;
      const originalGetReader = pageWindow.ReadableStream.prototype.getReader;
      pageWindow.ReadableStream.prototype.getReader = function patchedGetReader() {
        const reader = originalGetReader.apply(this, arguments);
        let capture = null;
        const originalRead = reader.read.bind(reader);
        reader.read = async function patchedRead() {
          const result = await originalRead.apply(this, arguments);
          try {
            if (result.done) {
              if (capture) scheduleFinish(capture, 3_000);
              return result;
            }
            const value = result.value;
            if (!value || (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer))) return result;
            const mime = sniffAudioChunk(value);
            if (!capture && mime) capture = captureFor(currentClipId(), mime, 'stream');
            if (capture && capture.source !== 'stream') capture = null;
            if (capture) {
              const copy = value instanceof ArrayBuffer ? value.slice(0) : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
              capture.chunks.push(copy);
              capture.settled = false;
              capture.updatedAt = Date.now();
            }
          } catch { /* 捕获失败不能影响 Suno 播放 */ }
          return result;
        };
        return reader;
      };
    }
    const originalAddSourceBuffer = sharedCapture.owner === 'userscript' ? pageWindow.MediaSource?.prototype?.addSourceBuffer : null;
    if (originalAddSourceBuffer) {
      pageWindow.MediaSource.prototype.addSourceBuffer = function patchedAddSourceBuffer(mime) {
        const sourceBuffer = originalAddSourceBuffer.call(this, mime);
        const originalAppendBuffer = sourceBuffer.appendBuffer;
        sourceBuffer.appendBuffer = function patchedAppendBuffer(data) {
          try {
            if (String(mime || '').toLowerCase().startsWith('audio/')) {
              const capture = captureFor(currentClipId(), mime, 'mse');
              if (capture && data) {
                const copy = data instanceof ArrayBuffer ? data.slice(0) : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                capture.chunks.push(copy);
                capture.settled = false;
                capture.updatedAt = Date.now();
                scheduleFinish(capture);
              }
            }
          } catch { /* capture must not change Suno playback */ }
          return originalAppendBuffer.apply(this, arguments);
        };
        return sourceBuffer;
      };
    }
    const triggerCompleteDownloadPlayback = (request) => {
      const clipId = String(request?.clipId || '').toLowerCase();
      if (!clipId || clipId !== currentClipId().toLowerCase()) return;
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const playButton = [...document.querySelectorAll('button')].find((button) => {
          const label = String(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim();
          return /^(play|播放)$/i.test(label) || label === 'Playbar: Play button';
        });
        if (playButton) {
          window.clearInterval(timer);
          panel.update('working', '正在启动 Suno 播放', '将自动接收完整解密音频流');
          publishCompleteDownloadProgress(request, 'decrypting', undefined, undefined, '正在启动 Suno 播放器…');
          playButton.click();
          return;
        }
        if (attempts >= 120) {
          window.clearInterval(timer);
          emitCompleteDownloadFailure({ clipId, request, finished: false }, Error('没有找到 Suno 播放按钮，已取消完整音频下载'));
        }
      }, 500);
    };
    const handleCompleteDownloadRequest = (request, remote) => {
      if (!remote || !request?.requestId || !request?.clipId) return;
      if (Date.now() - Number(request.at || 0) > 600_000) return;
      const clipId = String(request.clipId).toLowerCase();
      if (clipId !== currentClipId().toLowerCase()) return;
      const previous = completeDownloadRequests.get(clipId);
      if (previous?.timeout) window.clearTimeout(previous.timeout);
      const pending = { ...request, clipId, format: 'wav' };
      pending.timeout = window.setTimeout(() => {
        if (completeDownloadRequests.get(clipId) === pending) {
          emitCompleteDownloadFailure({ clipId, request: pending, finished: false }, Error('等待 Suno 完整解密音频超时，请确认 Suno 已登录且歌曲可播放'));
        }
      }, 180_000);
      completeDownloadRequests.set(clipId, pending);
      publishCompleteDownloadProgress(pending, 'resolving', undefined, undefined, '正在等待 Suno 页面加载…');
      triggerCompleteDownloadPlayback(request);
    };
    GM_addValueChangeListener(AUDIO_DOWNLOAD_REQUEST_KEY, (key, oldValue, request, remote) => handleCompleteDownloadRequest(request, remote));
    const initialAudioDownloadRequest = GM_getValue(AUDIO_DOWNLOAD_REQUEST_KEY, null);
    if (initialAudioDownloadRequest) handleCompleteDownloadRequest(initialAudioDownloadRequest, true);
    const triggerPlaybackForRequest = (request) => {
      if (!request?.clipId || String(request.clipId).toLowerCase() !== currentClipId().toLowerCase()) return;
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const playButton = [...document.querySelectorAll('button')].find((button) => {
          const label = String(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim();
          return /^(play|播放)$/i.test(label);
        });
        if (playButton) {
          window.clearInterval(timer);
          playButton.click();
        } else if (attempts >= 40) {
          window.clearInterval(timer);
        }
      }, 500);
    };
    const handleAudioCaptureRequest = (request, remote) => {
      if (!remote || !request?.requestId || !request?.clipId) return;
      if (Date.now() - Number(request.at || 0) > 180_000) return;
      const clipId = String(request.clipId);
      const capture = audioCaptures.get(clipId);
      if (capture?.chunks.length && capture.settled) {
        pendingAudioDownloads.set(clipId, request);
        finishCapture(capture);
        return;
      }
      pendingAudioDownloads.set(clipId, request);
      if (!capture) triggerPlaybackForRequest(request);
    };
    GM_addValueChangeListener(AUDIO_CAPTURE_REQUEST_KEY, (key, oldValue, request, remote) => handleAudioCaptureRequest(request, remote));
    const initialCaptureRequest = GM_getValue(AUDIO_CAPTURE_REQUEST_KEY, null);
    if (initialCaptureRequest) handleAudioCaptureRequest(initialCaptureRequest, true);

    function heartbeat() {
      GM_setValue(HEARTBEAT_KEY, { at: Date.now(), authenticated: usableAuthorization(cookieAuthorization(document.cookie) || currentHeaders().authorization), version: VERSION });
    }
    GM_addValueChangeListener(SYNC_REQUEST_KEY, (key, oldValue, request, remote) => { if (remote && request?.at) void publish(true); });
    GM_addValueChangeListener(COVER_VERIFICATION_REQUEST_KEY, (key, oldValue, request, remote) => {
      if (!remote || !request?.requestId) return;
      void getCoverVerification()
        .then((result) => GM_setValue(COVER_VERIFICATION_RESPONSE_KEY, { requestId: request.requestId, ok: true, result }))
        .catch((error) => GM_setValue(COVER_VERIFICATION_RESPONSE_KEY, { requestId: request.requestId, ok: false, error: error?.message || String(error) }));
    });
    window.setInterval(heartbeat, 10_000);
    window.setInterval(() => void publish(), AUTO_REFRESH_INTERVAL);
    panel.onSync(() => void publish(true));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { heartbeat(); void publish(); }
    });
    heartbeat();
    window.setTimeout(() => void publish(true), 2_000);
    panel.update('warning', '正在读取 Suno 登录', '页面加载后会自动同步');

    async function getCoverVerification() {
      const rootStore = findSunoRootStore();
      if (!rootStore?.session) throw new Error('没有找到 Suno Create 官方验证状态，请打开并刷新 suno.com/create 后重试');
      let token = null;
      let tokenProvider = null;
      if (typeof rootStore.session.getCaptchaTokenIfRequired === 'function') {
        token = await rootStore.session.getCaptchaTokenIfRequired('generation');
        tokenProvider = token != null ? rootStore.session.generationCaptchaVersion ?? null : null;
      }
      return {
        token: token == null ? null : String(token),
        tokenProvider,
        createSessionToken: rootStore.genForm?.createSessionToken || null,
        userTier: rootStore.session?.sub?.plan?.id || rootStore.session?.sub?.plans?.find?.((plan) => plan?.plan_key === 'free')?.id || null,
        pathname: location.pathname || '/create',
      };
    }

    function findSunoRootStore() {
      if (cachedRootStore?.session) return cachedRootStore;
      const seen = new WeakSet();
      const isObject = (value) => value && (typeof value === 'object' || typeof value === 'function');
      const directRoot = (value) => {
        if (value?.genForm?.setCoverClip) return value;
        if (value?.root?.genForm?.setCoverClip) return value.root;
        if (value?.value?.genForm?.setCoverClip) return value.value;
        if (value?.value?.root?.genForm?.setCoverClip) return value.value.root;
        return null;
      };
      const scan = (value, depth = 0) => {
        if (!isObject(value) || seen.has(value) || depth > 6) return null;
        seen.add(value);
        const direct = directRoot(value);
        if (direct) return direct;
        let keys = [];
        try { keys = Object.keys(value); } catch { return null; }
        for (const key of keys) {
          if (key === 'return' || key === 'alternate' || key === 'stateNode' || key === '_debugOwner') continue;
          try {
            const found = scan(value[key], depth + 1);
            if (found) return found;
          } catch { /* 忽略不可读取的 React 内部字段 */ }
        }
        return null;
      };
      for (const node of document.querySelectorAll('body, body *')) {
        for (const key of Object.keys(node).filter((name) => /^__react(?:Fiber|Props|Container)\$/.test(name))) {
          const found = scan(node[key]);
          if (found) {
            cachedRootStore = found;
            return found;
          }
        }
      }
      return null;
    }
  }

  function compareVersions(left, right) {
    const leftParts = String(left).split('.').map((part) => Number(part) || 0);
    const rightParts = String(right).split('.').map((part) => Number(part) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (difference) return difference;
    }
    return 0;
  }

  function checkForScriptUpdate(panel) {
    const applyRemoteVersion = (remoteVersion) => {
      panel.setUpdateNotice(compareVersions(remoteVersion, VERSION) > 0 ? remoteVersion : null);
    };
    const cached = GM_getValue(UPDATE_CHECK_KEY, null);
    if (cached?.version && cached?.checkedAt && Date.now() - Number(cached.checkedAt) < UPDATE_CHECK_INTERVAL) {
      applyRemoteVersion(cached.version);
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url: SCRIPT_URL,
      onload: (response) => {
        const match = String(response.responseText || '').match(/@version\s+([0-9]+(?:\.[0-9]+)*)/);
        if (!match) return;
        GM_setValue(UPDATE_CHECK_KEY, { checkedAt: Date.now(), version: match[1] });
        applyRemoteVersion(match[1]);
      },
    });
  }

  function makePanelDraggable(card, head, context) {
    const key = `sunoConsoleAuthSync:panelPosition:${context}`;
    let position = null;
    try {
      const saved = GM_getValue(key, null);
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = saved;
    } catch { /* Dragging still works if storage is unavailable. */ }
    card.style.maxWidth = 'calc(100vw - 16px)';
    card.style.maxHeight = 'calc(100vh - 16px)';
    card.style.overflowY = 'auto';
    card.style.boxSizing = 'border-box';
    head.style.cursor = 'grab';
    head.style.touchAction = 'none';
    head.style.userSelect = 'none';
    head.title = '拖动标题栏可移动，位置会自动保存';
    let drag = null;
    let suppressClick = false;
    function place(x, y) {
      const rect = card.getBoundingClientRect();
      const next = {
        x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
      };
      card.style.left = `${next.x}px`;
      card.style.top = `${next.y}px`;
      card.style.right = 'auto';
      position = next;
    }
    function fit() {
      if (!card.isConnected || drag) return;
      const rect = card.getBoundingClientRect();
      place(position?.x ?? rect.left, position?.y ?? rect.top);
    }
    head.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      if (event.target.closest('button, a, input')) return;
      const rect = card.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      head.style.cursor = 'grabbing';
      place(drag.left + dx, drag.top + dy);
      event.preventDefault();
    });
    function finish(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const { moved, id } = drag;
      drag = null;
      head.style.cursor = 'grab';
      if (head.hasPointerCapture(id)) head.releasePointerCapture(id);
      if (moved) {
        suppressClick = true;
        try { GM_setValue(key, position); } catch { /* Keep this session's position. */ }
      }
      fit();
    }
    head.addEventListener('pointerup', finish);
    head.addEventListener('pointercancel', finish);
    head.addEventListener('lostpointercapture', finish);
    card.addEventListener('click', (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    window.addEventListener('resize', fit);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(card);
    document.addEventListener('DOMContentLoaded', fit, { once: true });
    window.requestAnimationFrame(fit);
  }

  function mountPanel(context) {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>:host{all:initial}.card{position:fixed;z-index:2147483647;right:18px;top:72px;width:280px;color:#f8f5f8;background:#151318f2;border:1px solid #ffffff1f;border-radius:16px;box-shadow:0 18px 50px #0007;font-family:Inter,"PingFang SC",system-ui,sans-serif;overflow:hidden}.head{height:48px;padding:0 13px;display:flex;align-items:center;gap:9px}.mark{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#8b5cf6,#ec4899);display:grid;place-items:center;font-weight:800}.head div{flex:1}.head b,.head small{display:block}.head b{font-size:11px}.head small{margin-top:2px;color:#8f8794;font-size:8px}.toggle{border:0;background:transparent;color:#8f8794;cursor:pointer}.body{padding:0 13px 13px}.status,.account{padding:10px;border-radius:11px;background:#ffffff0b}.status b{display:block;font-size:10px}.status p{margin:4px 0 0;color:#aaa2ae;font-size:9px}.status.ready{box-shadow:inset 3px 0 #34d399}.status.warning{box-shadow:inset 3px 0 #fbbf24}.status.error{box-shadow:inset 3px 0 #fb7185}.status.working{box-shadow:inset 3px 0 #c084fc}.account{margin-top:8px;color:#938b98;font-size:9px;display:flex;justify-content:space-between}.account i{width:6px;height:6px;border-radius:50%;background:#777}.account.online i{background:#34d399}.refresh{margin-top:7px;padding:0 2px;color:#756e7a;font-size:8px;display:flex;justify-content:space-between}.refresh b{color:#aaa2ae;font-weight:500}.update-notice{margin-top:8px;padding:9px 10px;border:1px solid #fbbf244d;border-radius:11px;background:#fbbf2414;display:flex;align-items:center;gap:8px}.update-notice[hidden]{display:none}.update-copy{flex:1;min-width:0}.update-copy b,.update-copy small{display:block}.update-copy b{color:#fde68a;font-size:9px}.update-copy small{margin-top:2px;color:#d6c58a;font-size:8px}.update-button{height:27px;padding:0 9px;border:1px solid #fbbf2473;border-radius:8px;background:#fbbf2422;color:#fef3c7;font-size:9px;cursor:pointer;white-space:nowrap}.sync{width:100%;height:32px;margin-top:8px;border:1px solid #c084fc44;border-radius:10px;background:#c084fc17;color:#e9d5ff;font-size:9px;cursor:pointer}.sync[hidden]{display:none}.card.mini{width:48px;height:48px;cursor:pointer}.card.mini .body,.card.mini .head div,.card.mini .toggle{display:none}.card.mini .head{padding:0 10px}</style><section class="card"><header class="head"><span class="mark">S</span><div><b>登录同步助手</b><small>${context} · v${VERSION}</small></div><button class="toggle">—</button></header><div class="body"><div class="status warning"><b>正在启动</b><p>正在读取状态</p></div><div class="account"><span>等待账号信息</span><i></i></div><div class="refresh"><span>上次更新 <b>尚未更新</b></span><span>每 3 分钟自动刷新</span></div><div class="update-notice" hidden><div class="update-copy"><b>发现脚本新版本</b><small></small></div><button class="update-button" type="button">立即更新</button></div><button class="sync" ${context === '工作台' ? '' : 'hidden'}>立即同步 Suno 登录</button></div></section>`;
    let observer = null;
    let retries = 0;
    let retryTimer = null;
    const attach = () => {
      if (!document.body) return false;
      if (!document.documentElement.contains(host)) document.body.appendChild(host);
      if (!observer) {
        // Watch only direct body children. This catches an SPA body replacement
        // without observing Suno's high-frequency application subtree.
        observer = new MutationObserver(() => {
          if (!document.documentElement.contains(host)) scheduleAttach(250);
        });
        observer.observe(document.body, { childList: true });
      }
      return true;
    };
    const scheduleAttach = (delay = 0) => {
      if (retryTimer) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (attach()) return;
        if (retries < 12) {
          retries += 1;
          scheduleAttach(500);
        }
      }, delay);
    };
    // Suno Create is an SPA and may replace its initial DOM after DOMContentLoaded.
    // Re-attempt after load, matching the proven Plus-script startup sequence.
    if (!attach()) {
      document.addEventListener('DOMContentLoaded', () => scheduleAttach(0), { once: true });
      window.addEventListener('load', () => scheduleAttach(500), { once: true });
      scheduleAttach(1_000);
    }
    const card = shadow.querySelector('.card');
    makePanelDraggable(card, shadow.querySelector('.head'), context);
    const status = shadow.querySelector('.status');
    const title = shadow.querySelector('.status b');
    const detail = shadow.querySelector('.status p');
    const account = shadow.querySelector('.account');
    const accountText = shadow.querySelector('.account span');
    const syncButton = shadow.querySelector('.sync');
    syncButton.hidden = false;
    shadow.querySelector('.refresh > span:last-child').textContent = '自动跟随 Suno 会话续期';
    const refreshText = shadow.querySelector('.refresh b');
    const updateNotice = shadow.querySelector('.update-notice');
    const updateVersion = shadow.querySelector('.update-copy small');
    const updateButton = shadow.querySelector('.update-button');
    updateButton.addEventListener('click', () => window.open(SCRIPT_URL, '_blank', 'noopener,noreferrer'));
    shadow.querySelector('.toggle').addEventListener('click', (event) => { event.stopPropagation(); card.classList.add('mini'); });
    card.addEventListener('click', () => card.classList.remove('mini'));
    return {
      update(tone, text, description) { status.className = `status ${tone}`; title.textContent = text; detail.textContent = description; },
      setAccount(text, online) { accountText.textContent = text; account.classList.toggle('online', online); },
      setRefresh(at) { const time = Number(at); refreshText.textContent = Number.isFinite(time) && time > 0 ? new Date(time).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未更新'; },
      setUpdateNotice(version) { updateNotice.hidden = !version; updateVersion.textContent = version ? `当前 v${VERSION}，可更新至 v${version}` : ''; },
      onSync(handler) { if (!syncButton.hidden) syncButton.addEventListener('click', handler); },
    };
  }
})();
