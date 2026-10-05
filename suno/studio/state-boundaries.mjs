import { BridgeError } from '../bridge/errors.mjs';
const states = new WeakMap();
const fail = message => { throw new BridgeError('validation_error', message); };
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function check(v) {
  if (!isRecord(v) || !Array.isArray(v.tracks) || !isRecord(v.timing)) fail('state requires tracks and timing');
}
function containsOmission(v) {
  if (typeof v === 'string') return v.includes('<redacted>');
  if (!v || typeof v !== 'object') return false;
  return Object.hasOwn(v, 'omitted') || Object.values(v).some(containsOmission);
}
function wrap(kind, value, requireComplete = false) {
  check(value);
  if (requireComplete && containsOmission(value)) fail('redacted/omitted state cannot be prepared for writing');
  const handle = Object.freeze({ kind }); states.set(handle, structuredClone(value)); return handle;
}
function value(handle, kind) {
  if (!states.has(handle) || handle.kind !== kind) fail('expected ' + kind + ' handle from the explicit state adapter');
  return structuredClone(states.get(handle));
}
/** Tag received JSON without applying an editor serializer. Payload may still be transport-redacted. */
export const rawWireState = state => wrap('raw-wire', state);
export const inspectRawWireState = handle => value(handle, 'raw-wire');
/** Caller must provide a separately verified deserializer; there is no identity/default adapter. */
export function deserializeEditorState(raw, deserialize) {
  const wire = value(raw, 'raw-wire');
  if (containsOmission(wire)) fail('redacted/omitted wire state cannot be deserialized for writing');
  if (typeof deserialize !== 'function') fail('explicit editor deserializer required');
  return wrap('editor-memory', deserialize(wire), true);
}
/** Adapter interface only; does not port or evaluate official bundle code. */
export function serializeProjectState(editor, serialize) {
  const memory = value(editor, 'editor-memory');
  if (typeof serialize !== 'function') fail('explicit project serializer required');
  return wrap('save-serialized', serialize(memory), true);
}
/** Render transformation and serializer are distinct required adapters, never project-save defaults. */
export function prepareRenderTransformedState(editor, transform, serializeRender) {
  const memory = value(editor, 'editor-memory');
  if (typeof transform !== 'function' || typeof serializeRender !== 'function') fail('explicit render transform and render serializer required');
  return wrap('render-transformed', serializeRender(transform(memory)), true);
}
export const inspectSaveSerializedState = handle => value(handle, 'save-serialized');
export const inspectRenderTransformedState = handle => value(handle, 'render-transformed');
