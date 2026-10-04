import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import privacy from '../../shared/privacy.cjs';
export class CaptureStore {
  sessions = new Map(); active = null; queue = Promise.resolve();
  constructor(root) { this.root = root; }
  state() { return this.active ? { id: this.active.id, count: this.active.count, active: true } : null; }
  async start(label = 'operation') {
    if (this.active) throw new Error('stop the current capture first');
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    const s = { id, label: privacy.redact(String(label).slice(0, 80)), count: 0, seen: new Set(), dir: join(this.root, id), startedAt: new Date().toISOString(), stoppedAt: null };
    await mkdir(s.dir, { recursive: true }); await this.summary(s);
    this.sessions.set(id, s); this.active = s; return this.state();
  }
  async stop() {
    const s = this.active; if (!s) return null;
    this.active = null; s.stoppedAt = new Date().toISOString(); await this.queue; await this.summary(s);
    return { id: s.id, count: s.count, active: false };
  }
  summary(s) {
    return writeFile(join(s.dir, 'summary.md'), `# Capture ${s.id}\n\nOperation: ${s.label}\n\nStarted: ${s.startedAt}\nStopped: ${s.stoppedAt || 'active'}\nCompleted records: ${s.count}\n\nBrowser + server redaction. Only official /studio fetch/XHR in the paired tab scope.\nNo endpoint has been verified by recording alone. Late responses retain their start session.\nRecorder queue/drop status must be checked before accepting capture completeness.\n`, 'utf8');
  }
  add(record) {
    const result = this.queue.then(() => this.write(record));
    this.queue = result.catch(() => {}); return result;
  }
  async write(r) {
    const s = this.sessions.get(r.sessionId);
    if (!s || (s.stoppedAt && Date.now() - Date.parse(s.stoppedAt) > 120000)) throw new Error('capture session is inactive or expired');
    if (!/^[\w-]{1,100}$/.test(r.eventId || '')) throw new Error('invalid event id');
    if (s.seen.has(r.eventId)) return { duplicate: true, count: s.count };
    if (s.count >= 10000) throw new Error('capture record limit reached');
    const u = new URL(r.request?.url);
    if (u.origin !== 'https://studio-api-prod.suno.com') throw new Error('capture origin rejected');
    if (!['fetch', 'xhr'].includes(r.source)) throw new Error('unknown capture source');
    const safe = privacy.redact(r);
    const n = String(s.count + 1).padStart(3, '0');
    const request = { eventId: safe.eventId, timestamp: safe.timestamp, source: safe.source,
      method: String(safe.request.method), url: privacy.url(r.request.url), path: privacy.url(u.pathname + u.search),
      headers: privacy.headers(safe.request.headers || {}), body: privacy.body(safe.request.body), headersScope: 'JavaScript-visible; browser cookie/set-cookie may be unavailable' };
    const response = { eventId: safe.eventId, timestamp: safe.response?.timestamp, status: safe.response?.status ?? null,
      headers: privacy.headers(safe.response?.headers || {}), body: privacy.body(safe.response?.body), error: safe.response?.error ?? null,
      durationMs: Number.isFinite(safe.durationMs) ? safe.durationMs : null, bodyObservationMs: safe.bodyObservationMs ?? null };
    await writeFile(join(s.dir, n + '-request.json'), JSON.stringify(request, null, 2) + '\n');
    await writeFile(join(s.dir, n + '-response.json'), JSON.stringify(response, null, 2) + '\n');
    s.seen.add(r.eventId); s.count += 1; await this.summary(s);
    return { count: s.count };
  }
}
