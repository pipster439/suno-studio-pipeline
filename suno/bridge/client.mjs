import { randomUUID } from 'node:crypto';
import { BridgeError, validateCall } from './errors.mjs';
export class SunoBridge {
  constructor({ base = 'http://127.0.0.1:3000', key = process.env.SUNO_CONTROLLER_KEY } = {}) {
    const url = new URL(base);
    if (url.origin !== 'http://127.0.0.1:3000' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(url.origin)) throw new Error('controller must be loopback HTTP');
    if (!key) throw new Error('set SUNO_CONTROLLER_KEY to the ephemeral local pairing key');
    this.base = url.origin; this.key = key;
  }
  async request(path, body, signal) {
    const r = await fetch(this.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Controller-Key': this.key }, body: JSON.stringify(body), signal });
    const data = await r.json();
    if (!r.ok || data.ok === false) throw new BridgeError(data.error?.kind || 'unknown_error', data.error?.message || 'controller error', data.error?.status, data.error?.details);
    return data;
  }
  async call(options, { signal } = {}) {
    if (options?.dispatchAllowed === false) throw new BridgeError('not_verified', 'request preview forbids dispatch');
    const valid = validateCall(options);
    const requestId = options.requestId || randomUUID();
    const abort = () => { void this.cancel(requestId).catch(() => {}); };
    if (signal?.aborted) throw new BridgeError('cancelled', 'cancelled before dispatch');
    signal?.addEventListener('abort', abort, { once: true });
    const deadline = AbortSignal.timeout(valid.timeoutMs + 2000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try { return await this.request('/api/call', { ...options, requestId }, combined); }
    catch (e) {
      if (combined.aborted) throw new BridgeError(signal?.aborted ? 'cancelled' : 'timeout', 'local wait ended; remote outcome may be unknown');
      if (e instanceof BridgeError) throw e;
      throw new BridgeError('network_error', 'controller connection failed');
    }
    finally { signal?.removeEventListener('abort', abort); }
  }
  cancel(requestId) { return this.request('/api/cancel', { requestId }); }
}
