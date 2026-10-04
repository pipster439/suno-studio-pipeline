import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import privacy from '../../shared/privacy.cjs';
import referencePrivacy from '../../shared/reference-privacy.cjs';
export const REFERENCE_ORIGINS = ['https://sunouploader.site', 'https://www.sunouploader.site'];
const kinds = new Set(['console_request', 'console_response', 'console_cancel', 'backend_request', 'backend_response', 'suno_fetch_request', 'suno_fetch_response', 'marker']);
export class ReferenceStore {
  sessions = new Map(); active = null; queue = Promise.resolve();
  constructor(root) { this.root = root; }
  state() { return this.active ? { id: this.active.id, label: this.active.label, count: this.active.rows.length, active: true } : null; }
  async start(label = 'reference-workflow') {
    if (this.active) throw new Error('stop current reference capture first');
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    const s = { id, dir: join(this.root, id), label: privacy.redact(String(label).slice(0, 100)), startedAt: new Date().toISOString(), stoppedAt: null, seen: new Set(), rows: [] };
    await mkdir(join(s.dir, 'events'), { recursive: true }); this.sessions.set(id, s); this.active = s;
    await this.summary(s); return this.state();
  }
  async stop() {
    const s = this.active; if (!s) return null; this.active = null;
    s.stoppedAt = new Date().toISOString(); await this.queue; await this.summary(s);
    return { id: s.id, count: s.rows.length, active: false };
  }
  add(record) { const result = this.queue.then(() => this.write(record)); this.queue = result.catch(() => {}); return result; }
  async write(r) {
    const s = this.sessions.get(r.sessionId);
    if (!s || s.stoppedAt && Date.now() - Date.parse(s.stoppedAt) > 120000) throw new Error('reference capture inactive/expired');
    if (!/^[\w-]{1,100}$/.test(r.recordId || '') || !/^[\w-]{1,100}$/.test(r.pageId || '') || !kinds.has(r.kind)) throw new Error('invalid reference envelope');
    if (!Number.isInteger(r.sequence) || r.sequence < 1 || !Number.isFinite(Date.parse(r.timestamp))) throw new Error('invalid reference time/sequence');
    const page = new URL(r.pageUrl);
    if (!REFERENCE_ORIGINS.includes(page.origin)) throw new Error('reference page origin rejected');
    if (r.kind.startsWith('backend_') || r.kind.startsWith('suno_fetch_')) {
      const u = new URL(r.data?.url);
      if (r.kind.startsWith('backend_') ? !REFERENCE_ORIGINS.includes(u.origin) || !/^\/api(?:\/|$)/.test(u.pathname) : u.origin !== 'https://studio-api-prod.suno.com') throw new Error('reference network target rejected');
    }
    if (s.seen.has(r.recordId)) return { duplicate: true, count: s.rows.length };
    if (s.rows.length >= 20000) throw new Error('reference record limit reached');
    if (JSON.stringify(r).length > 3 * 1024 * 1024) throw new Error('reference record too large');
    const safe = referencePrivacy.clean(r, 3 * 1024 * 1024);
    if (safe.omitted) throw new Error('reference record could not be retained');
    if (r.kind.startsWith('backend_') && /\/(?:auth|login|logout|session|captcha|billing|subscriptions?|entitlements?|payments?|accounts?|profile|me|membership)(?:\/|$)/i.test(new URL(r.data.url).pathname)) {
      safe.data.body = { omitted: 'authentication-account-payment-body' };
      if (safe.data.responseStructure) safe.data.responseStructure = { type: 'omitted' };
    }
    delete safe.sessionId; // Capture session is local metadata, never an auth session.
    if (safe.data?.headers) safe.data.headers = privacy.headers(safe.data.headers);
    const n = String(s.rows.length + 1).padStart(6, '0');
    const row = { record: n, timestamp: safe.timestamp, pageId: safe.pageId, sequence: safe.sequence, kind: safe.kind,
      requestId: safe.requestId ?? null, marker: safe.marker ?? null, observedMarker: safe.observedMarker ?? null,
      method: safe.data?.method ?? null, path: safe.data?.path ?? null, status: safe.data?.status ?? null, ok: safe.data?.ok ?? null };
    await writeFile(join(s.dir, 'events', n + '.json'), JSON.stringify(safe, null, 2) + '\n');
    await appendFile(join(s.dir, 'timeline.jsonl'), JSON.stringify(row) + '\n');
    s.rows.push(row); s.seen.add(r.recordId); if (s.stoppedAt || s.rows.length % 25 === 0) await this.summary(s);
    return { count: s.rows.length };
  }
  async summary(s) {
    const rows = [...s.rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.pageId.localeCompare(b.pageId) || a.sequence - b.sequence);
    const cell = (v) => String(v ?? '').replace(/[|\r\n]/g, ' ');
    const table = rows.map((r) => `| ${r.record} | ${cell(r.timestamp)} | ${cell(r.kind)} | ${cell(r.marker?.label)} | ${cell(r.requestId)} | ${cell(r.method)} ${cell(r.path)} | ${r.status ?? 'not supplied'} |`).join('\n');
    const warning = 'Console events describe transport intent/results; website /api calls are reference backend evidence. No hidden Suno endpoint is inferred. Arrival file order may differ from browser sequence. Missing status is not HTTP 200. Correlate within pageId/requestId and retain duplicate/orphan responses. Only replay proves a candidate.\n';
    await writeFile(join(s.dir, 'summary.md'), `# Reference capture ${s.id}\n\nLabel: ${s.label}\nStarted: ${s.startedAt}\nStopped: ${s.stoppedAt || 'active'}\nEvents: ${rows.length}\n\n${warning}\n| Record | UTC | Kind | Marker | RequestId | Method / path | Status |\n|---|---|---|---|---|---|---|\n${table}\n`);
  }
}
