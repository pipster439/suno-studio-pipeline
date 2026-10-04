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
    validateCall(options);
    const requestId = options.requestId || randomUUID();
    const abort = () => { void this.cancel(requestId).catch(() => {}); };
    if (signal?.aborted) throw new BridgeError('cancelled', 'cancelled before dispatch');
    signal?.addEventListener('abort', abort, { once: true });
    try { return await this.request('/api/call', { ...options, requestId }); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  cancel(requestId) { return this.request('/api/cancel', { requestId }); }
}
