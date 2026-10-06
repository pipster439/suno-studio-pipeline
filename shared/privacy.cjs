(function (root) {
  'use strict';
  const MASK = '<redacted>';
  const sensitive = /authorization|cookie|jwt|token|captcha|secret|password|credential|device|signature|api[-_]?key|session[-_]?id|^(?:auth|session|sid)$/i;
  // Exact JSON field exception for musical meter. Its contents still recurse through
  // normal filtering; this never exempts headers, query values, or similar names.
  const musicalJsonKey = key => key === 'timeSignatureChanges';
  const businessQueryKeys = new Set(['title', 'major_version', 'project_id', 'clip_id', 'offset', 'duration', 'position']);
  const signedQueryKey = /signature|^sig$|^x-amz-|^x-goog-|^policy$|^key-pair-id$|token|credential/i;
  function url(value) {
    try {
      const relative = value.startsWith('/');
      const u = new URL(value, 'https://studio-api-prod.suno.com');
      u.username = ''; u.password = ''; u.hash = '';
      const allowBusiness = u.origin === 'https://studio-api-prod.suno.com' &&
        ![...u.searchParams.keys()].some((key) => signedQueryKey.test(key));
      const query = new URLSearchParams();
      for (const [key, v] of u.searchParams) {
        query.append(key, allowBusiness && businessQueryKeys.has(key) ? string(v) : MASK);
      }
      u.search = query.toString();
      return relative ? u.pathname + u.search : u.href;
    } catch { return '<invalid-url>'; }
  }
  function string(value) {
    if (/^\s*[\[{]/.test(value)) {
      try { return JSON.stringify(redact(JSON.parse(value))); } catch { /* not nested JSON */ }
    }
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
        output[string(key)] = sensitive.test(key) && !musicalJsonKey(key) ? MASK : redact(v, depth + 1);
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
  // Operational upload credentials may cross the authenticated loopback transport
  // only for the exact create-slot response. Evidence/log paths still use redact.
  function transportResponse(value, { method, path } = {}) {
    const clean = redact(value);
    if (method === 'GET' && /^\/api\/download\/clip\/[A-Za-z0-9_-]+\?format=(?:m4a|mp3)$/.test(path ?? '') && value?.ok === true && value.status === 200 && value.result?.status === 'ready') {
      try { const u = new URL(value.result.download_url);
        if (u.protocol === 'https:' && /(?:\.amazonaws\.com|\.cloudfront\.net|\.suno\.ai|\.suno\.com)$/.test(u.hostname)) clean.result.download_url = value.result.download_url;
      } catch { /* Fail closed on unknown signed download destination. */ }
      return clean;
    }
    if (method !== 'POST' || path !== '/api/uploads/audio/' || value?.ok !== true || value.status !== 200 || !value.result?.id) return clean;
    const slot = value.result;
    try {
      const destination = new URL(slot.url);
      if (destination.protocol !== 'https:' || !/\.amazonaws\.com$/.test(destination.hostname) || !slot.fields || typeof slot.fields !== 'object') return clean;
      const allowed = /^(?:key|policy|signature|AWSAccessKeyId|acl|success_action_status|Content-Type|x-amz-(?:algorithm|credential|date|signature|security-token))$/i;
      if (Object.entries(slot.fields).some(([k, v]) => !allowed.test(k) || typeof v !== 'string')) return clean;
      clean.result.url = slot.url; clean.result.fields = { ...slot.fields };
    } catch { /* Keep normal sanitization on unexpected response shapes. */ }
    return clean;
  }
  const api = { redact, url, body, headers, transportResponse, MASK };
  if (typeof module !== 'undefined') module.exports = api;
  else root.SunoPrivacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
