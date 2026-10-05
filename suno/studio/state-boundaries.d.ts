import type { StudioState } from './models.js';
declare const domain: unique symbol;
export interface RawWireState { readonly kind: 'raw-wire'; readonly [domain]: 'raw-wire'; }
export interface EditorMemoryState { readonly kind: 'editor-memory'; readonly [domain]: 'editor-memory'; }
export interface SaveSerializedState { readonly kind: 'save-serialized'; readonly [domain]: 'save-serialized'; }
export interface RenderTransformedState { readonly kind: 'render-transformed'; readonly [domain]: 'render-transformed'; }
export type StateAdapter = (state: StudioState) => StudioState;
export function rawWireState(state: StudioState): RawWireState;
export function inspectRawWireState(state: RawWireState): StudioState;
export function deserializeEditorState(state: RawWireState, deserialize: StateAdapter): EditorMemoryState;
export function serializeProjectState(state: EditorMemoryState, serialize: StateAdapter): SaveSerializedState;
export function prepareRenderTransformedState(state: EditorMemoryState, transform: StateAdapter, serializeRender: StateAdapter): RenderTransformedState;
export function inspectSaveSerializedState(state: SaveSerializedState): StudioState;
export function inspectRenderTransformedState(state: RenderTransformedState): StudioState;
export function updateEditorState(state: EditorMemoryState, mutate: StateAdapter): EditorMemoryState;
export function inspectEditorState(state: EditorMemoryState): StudioState;
