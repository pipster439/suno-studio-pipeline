const $ = (id) => document.getElementById(id);
let socket, retry, delay = 500, reconnect = true;
let key = location.hash.slice(1) || sessionStorage.getItem('controller-key') || '';
history.replaceState(null, '', '/'); $('key').value = key;
const inflight = new Map();
const show = (value) => { $('result').textContent = JSON.stringify(SunoPrivacy.redact(value), null, 2); };
function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function dispatch(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
function cancel(id) { const p = inflight.get(id); if (!p) return; clearTimeout(p); inflight.delete(id); dispatch('suno-console-upload-cancel', { requestId: id }); }
function connect() {
  clearTimeout(retry); if (socket && socket.readyState < 2) return;
  key = $('key').value; if (!key) return show({ error: '请填写启动终端中的配对码' });
  sessionStorage.setItem('controller-key', key);
  socket = new WebSocket(`ws://${location.host}/ws`);
  socket.onopen = () => { delay = 500; send({ type: 'hello', key }); };
  socket.onmessage = ({ data }) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'status') {
      $('connection').textContent = `Browser bridge：${m.bridgeOnline ? '在线' : '离线'}`;
      $('auth').textContent = `Suno auth：${m.auth.ready ? 'ready（油猴有效会话缓存）' : m.auth.state}`;
      const r = m.recorder;
      $('recorder').textContent = `官方 recorder：${r.online ? r.activeSession ? 'active' : 'idle' : '未连接'} · 队列 ${r.queued || 0} · 丢失 ${r.dropped || 0}${r.lastError ? ' · ' + r.lastError : ''}`;
      $('capture').textContent = `Capture：${m.capture?.id || '未开启'} · 已记录 ${m.capture?.count || 0}`;
      dispatch('suno-local-recorder-config', { base: location.origin, key, sessionId: m.capture?.active ? m.capture.id : null });
      dispatch('suno-local-auth-state-request', {});
    } else if (m.type === 'suno_api_request') {
      if (inflight.has(m.id)) return;
      inflight.set(m.id, setTimeout(() => {
        cancel(m.id); send({ type: 'suno_api_response', requestId: m.id, ok: false, kind: 'timeout', error: 'browser timeout' });
      }, m.timeoutMs));
      dispatch('suno-console-upload-request', { requestId: m.id, path: m.path, method: m.method, bodyJson: m.body === undefined ? undefined : JSON.stringify(m.body) });
    } else if (m.type === 'suno_api_cancel') cancel(m.id);
  };
  socket.onclose = (e) => {
    for (const id of [...inflight.keys()]) cancel(id);
    dispatch('suno-local-recorder-config', { base: location.origin, key, sessionId: null });
    $('connection').textContent = 'Browser bridge：离线'; $('auth').textContent = 'Suno auth：未知';
    if (e.code === 1008) { reconnect = false; show({ error: '配对被拒绝或已有 bridge 连接，检查配对码并关闭重复页面' }); }
    if (reconnect) { retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 10000); }
  };
  socket.onerror = () => {};
}
window.addEventListener('suno-console-upload-response', (e) => {
  const data = e.detail || {}; if (!inflight.has(data.requestId)) return;
  clearTimeout(inflight.get(data.requestId)); inflight.delete(data.requestId);
  send({ ...SunoPrivacy.redact(data), type: 'suno_api_response' });
});
window.addEventListener('suno-local-auth-state', (e) => {
  send({ type: 'auth_status', ready: e.detail?.ready === true, state: String(e.detail?.state || 'unknown') });
});
async function action(path, body = {}) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Controller-Key': key }, body: JSON.stringify(body) });
    show(await r.json());
  } catch { show({ error: '本地 controller 连接失败' }); }
}
$('connect').onclick = () => { reconnect = true; socket?.close(); setTimeout(connect, 0); };
$('refresh').onclick = () => dispatch('suno-auth-sync-request', {});
$('probe').onclick = () => action('/api/probe');
$('start').onclick = () => action('/api/capture/start', { label: $('label').value });
$('stop').onclick = () => action('/api/capture/stop');
setInterval(() => dispatch('suno-local-auth-state-request', {}), 3000);
if (key) connect();
