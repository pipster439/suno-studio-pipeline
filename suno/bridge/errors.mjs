import privacy from '../../shared/privacy.cjs';
export class BridgeError extends Error {
  constructor(kind, message, status = null, details = null) {
    super(message); this.kind = kind; this.status = status; this.details = privacy.redact(details);
  }
  toJSON() { return { kind: this.kind, message: privacy.redact(this.message), status: this.status, details: this.details }; }
}
export function apiError(response) {
  const s = response.status;
  const kind = s === 401 ? 'auth_error' : s === 403 ? 'permission_error' : s === 429 ? 'rate_limit'
    : [400, 409, 422].includes(s) ? 'validation_error' : s >= 400 ? 'suno_api_error'
    : ['cancelled', 'timeout', 'network_error', 'auth_error', 'validation_error'].includes(response.kind) ? response.kind : 'unknown_error';
  return new BridgeError(kind, response.error || 'Suno request failed', s, response.details);
}
export function validateCall({ path, method = 'GET', timeoutMs = 30000 }) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\s#]/.test(path)
    || /%(?:0[0-9a-f]|1[0-9a-f]|5c)/i.test(path) || path.length > 8192) {
    throw new BridgeError('validation_error', 'path must be a relative Suno API path');
  }
  method = String(method).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new BridgeError('validation_error', 'unsupported method');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new BridgeError('validation_error', 'timeoutMs must be 1..120000');
  return { path, method, timeoutMs };
}
