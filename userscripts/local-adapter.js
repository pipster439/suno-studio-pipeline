// Runs inside startConsoleSync's existing closure; only the localhost branch uses it.
function emitLocalAuthState() {
  const cached = GM_getValue(AUTH_KEY, null);
  const ready = !authInvalidated && usableAuthorization(cached?.headers?.authorization, 10);
  window.dispatchEvent(new CustomEvent('suno-local-auth-state', { detail: { ready, state: ready ? 'ready' : authInvalidated ? 'expired' : 'waiting', version: VERSION, buildId: '__LOCAL_BUILD_HASH__' } }));
}
window.addEventListener('suno-local-auth-state-request', emitLocalAuthState);
window.setInterval(emitLocalAuthState, 3000);
emitLocalAuthState();
