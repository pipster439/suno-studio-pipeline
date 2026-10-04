(function (root) {
  'use strict';
  const MASK = '<redacted>';
  const sensitive = /authorization|cookie|jwt|token|captcha|secret|password|credential|device|signature|api[-_]?key|session[-_]?id|^(?:auth|session|sid)$/i;
  function url(value) {
    try {
      const relative = value.startsWith('/');
      const u = new URL(value, 'https://studio-api-prod.suno.com');
      u.username = ''; u.password = ''; u.hash = '';
      for (const key of [...u.searchParams.keys()]) u.searchParams.set(key, MASK);
      return relative ? u.pathname + u.search : u.href;
    } catch { return '<invalid-url>'; }
  }
  function string(value) {
    if (value.startsWith('/') && value.includes('?')) return url(value);
    return value.replace(/https?:\/\/[^\s"<>]+/gi, (v) => url(v))
      .replace(/\bBearer\s+[^\s,;"<>]+/gi, 'Bearer <redacted>')
      .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MASK)
      .replace(/(?:authorization|cookie|token|secret|password|device[-_]?id)\s*[:=]\s*[^\s,;]+/gi, MASK);
  }
  function redact(value, depth = 0) {
    if (depth > 30) return { omitted: 'depth-limit' };
    if (typeof value === 'string') return string(value);
    if (Array.isArray(value)) return value.slice(0, 10000).map((v) => redact(v, depth + 1));
    if (value && typeof value === 'object') {
      const output = Object.create(null);
      for (const [key, v] of Object.entries(value).slice(0, 10000)) {
        output[string(key)] = sensitive.test(key) ? MASK : redact(v, depth + 1);
      }
      return output;
    }
    return value;
  }
  function body(value, max = 1024 * 1024) {
    if (value == null) return null;
    if (typeof value !== 'string') {
      try { value = JSON.stringify(value); } catch { return { omitted: 'unserializable' }; }
    }
    if (value.length > max) return { omitted: 'size-limit', chars: value.length };
    try { return redact(JSON.parse(value)); }
    catch { return { omitted: 'non-json-body', chars: value.length }; }
  }
  function headers(value) {
    const output = Object.create(null);
    for (const [key, v] of Object.entries(value)) output[key] = /^(?:content-type|content-length|accept|cache-control|date|server)$/i.test(key) ? string(String(v)) : MASK;
    return output;
  }
  const api = { redact, url, body, headers, MASK };
  if (typeof module !== 'undefined') module.exports = api;
  else root.SunoPrivacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
