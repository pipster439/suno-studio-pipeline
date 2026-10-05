import { BridgeError } from '../bridge/errors.mjs';
export class StudioApiError extends BridgeError{constructor(...args){super(...args);this.name=new.target.name;}}
export class StudioAuthError extends StudioApiError{}
export class StudioPermissionError extends StudioApiError{}
export class StudioNotFoundError extends StudioApiError{}
export class StudioValidationError extends StudioApiError{}
export class StudioRateLimitError extends StudioApiError{}
export class StudioConflictError extends StudioApiError{}
export class StudioUnverifiedWriteError extends StudioApiError{}
export class StudioStateLossError extends StudioApiError{}
// Only existing transport kinds are mapped. Unknown HTTP/body codes remain generic.
export function studioError(error){const value=error&&typeof error==='object'?error:{};const cls={auth_error:StudioAuthError,permission_error:StudioPermissionError,validation_error:StudioValidationError,rate_limit:StudioRateLimitError,not_verified:StudioUnverifiedWriteError,state_loss:StudioStateLossError}[value.kind]??StudioApiError;return new cls(value.kind??'unknown_error',value.message??'unknown Studio error',value.status,value.details);}
