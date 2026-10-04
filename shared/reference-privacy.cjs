(function (root) {
  'use strict';
  const p = typeof module !== 'undefined' ? require('./privacy.cjs') : SunoPrivacy;
  function clean(value, max = 1024 * 1024, nestedDepth = 0) {
    if (nestedDepth > 30) return { omitted: 'depth-limit' };
    if (value === undefined) return { omitted: 'undefined' };
    let text;
    try {
      text = JSON.stringify(value, (key, v) => {
        if (/^(?:headers|requestHeaders|responseHeaders)$/i.test(key) && v && typeof v === 'object') return p.headers(v);
        if (typeof v === 'string' && /^\s*[\[{]/.test(v)) {
          if (v.length > max) return { omitted: 'size-limit', chars: v.length };
          try { return JSON.stringify(clean(JSON.parse(v), max, nestedDepth + 1)); } catch { /* ordinary non-JSON string */ }
        }
        if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') return { omitted: 'non-json-value' };
        if (typeof Blob !== 'undefined' && v instanceof Blob) return { omitted: 'binary', bytes: v.size, mime: v.type, name: v.name };
        if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return { omitted: 'binary', bytes: v.byteLength };
        return v;
      });
      if (text.length > max) return { omitted: 'size-limit', chars: text.length };
      const parsed = JSON.parse(text), pending = [parsed]; let nodes = 0;
      while (pending.length) {
        const item = pending.pop(); if (++nodes > 50000) return { omitted: 'structure-limit' };
        if (item && typeof item === 'object') {
          const values = Object.values(item); if (values.length > 10000) return { omitted: 'structure-limit' }; pending.push(...values);
        }
      }
      return p.redact(parsed);
    } catch { return { omitted: 'unserializable' }; }
  }
  function shape(value, depth = 0) {
    if (depth > 6) return { type: 'depth-limit' };
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) return { type: 'array', length: value.length, samples: value.slice(0, 3).map((v) => shape(v, depth + 1)) };
    if (value && typeof value === 'object') return { type: 'object', fields: Object.fromEntries(Object.entries(value).slice(0, 100).map(([k, v]) => [k, shape(v, depth + 1)])) };
    return { type: typeof value };
  }
  function jsonBody(text) {
    if (text.length > 1024 * 1024) return { omitted: 'size-limit', chars: text.length };
    try { return clean(JSON.parse(text)); } catch { return { omitted: 'non-json-body', chars: text.length }; }
  }
  const api = { clean, shape, jsonBody };
  if (typeof module !== 'undefined') module.exports = api; else root.SunoReferencePrivacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
