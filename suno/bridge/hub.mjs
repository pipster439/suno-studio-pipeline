import { randomUUID } from 'node:crypto';
import { BridgeError, apiError, validateCall } from './errors.mjs';
export class BridgeHub {
  constructor({allow_verified_studio_writes=false}={}){this.policy=Object.freeze({allow_verified_studio_writes:allow_verified_studio_writes===true});}
  pending = new Map();
  peer = null;
  auth = { ready: false, state: 'unknown' };
  attach(peer) {
    if (this.peer) throw new BridgeError('permission_error', 'a browser bridge is already connected');
    this.peer = peer; this.auth = { ready: false, state: 'unknown' };
  }
  detach(peer) {
    if (this.peer !== peer) return;
    this.peer = null; this.auth = { ready: false, state: 'unknown' };
    for (const id of [...this.pending.keys()]) this.finish(id, new BridgeError('network_error', 'browser disconnected; remote outcome may be unknown'));
  }
  finish(id, error, result) {
    const p = this.pending.get(id); if (!p) return false;
    this.pending.delete(id); clearTimeout(p.timer); p.cleanup();
    error ? p.reject(error) : p.resolve(result); return true;
  }
  response(peer, data) {
    if (peer !== this.peer || typeof data.requestId !== 'string') return false;
    return this.finish(data.requestId, data.ok ? null : apiError(data), data);
  }
  cancel(id, kind = 'cancelled') {
    if (!this.pending.has(id)) return false;
    try { this.peer?.send(JSON.stringify({ type: 'suno_api_cancel', id })); } catch { /* finish anyway */ }
    return this.finish(id, new BridgeError(kind, `${kind}; remote outcome may be unknown`));
  }
  call(options, { signal } = {}) {
    if (options?.dispatchAllowed === false) throw new BridgeError('not_verified', 'request preview forbids dispatch');
    const valid = validateCall(options,this.policy);
    const id = options.requestId || randomUUID();
    if (!/^[\w-]{1,100}$/.test(id) || this.pending.has(id)) throw new BridgeError('validation_error', 'invalid or duplicate requestId');
    if (!this.peer) throw new BridgeError('network_error', 'browser bridge offline');
    if (!this.auth.ready) throw new BridgeError('auth_error', 'Tampermonkey auth is not ready');
    if (signal?.aborted) throw new BridgeError('cancelled', 'cancelled before dispatch');
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(id);
      const timer = setTimeout(() => this.cancel(id, 'timeout'), valid.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, cleanup: () => signal?.removeEventListener('abort', abort) });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.peer.send(JSON.stringify({ type: 'suno_api_request', id, ...valid, body: options.body })); }
      catch { this.finish(id, new BridgeError('network_error', 'failed to dispatch')); }
    });
  }
}
