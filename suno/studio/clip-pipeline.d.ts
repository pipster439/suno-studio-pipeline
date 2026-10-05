import type { StudioClip, StudioState, StudioTiming } from './models.js';
import type { EditorMemoryState } from './state-boundaries.js';
declare const domain: unique symbol;
export interface SourceClip { id: string; status?: string; metadata: { duration?: number | null; avg_bpm?: number | null; task?: string; [key: string]: unknown }; [key: string]: unknown; }
export interface SourceClipMetadata { readonly kind: 'source-clip-metadata'; readonly [domain]: 'source-clip-metadata'; }
export interface StudioClipDraft { readonly kind: 'clip-draft'; readonly [domain]: 'clip-draft'; }
export interface PostprocessedClip { readonly kind: 'postprocessed-clip'; readonly [domain]: 'postprocessed-clip'; }
export type ClipHandle = StudioClipDraft | PostprocessedClip;
export type WarpMarkers = Record<string, number>;
export interface StudioPostProcess { transposition?: number; amplitude?: number; fadeInBeats?: number; fadeOutBeats?: number; readStartBeats?: number; markers?: WarpMarkers; }
export function sourceClipMetadata(source: SourceClip): SourceClipMetadata;
export function inspectSourceClip(source: SourceClipMetadata): SourceClip;
export function buildAudioClipDraft(source: SourceClipMetadata, options: { fallbackBPS: number; id?: string; name?: string; color?: string | null; extraFields?: Record<string, unknown> }): StudioClipDraft;
export function buildAnalyzedAudioClipDraft(source: SourceClipMetadata, options: { markers: WarpMarkers; downbeatPresenceConfidence?: number | null; fallbackBPS: number; id?: string; name?: string; color?: string | null; extraFields?: Record<string, unknown> }): StudioClipDraft;
export function inspectClipDraft(clip: StudioClipDraft): StudioClip;
export function inspectPostprocessedClip(clip: PostprocessedClip): StudioClip;
export function secondsToProjectBeats(seconds: number, timing: StudioTiming): number;
export function projectBeatsToSeconds(beats: number, timing: StudioTiming): number;
export function durationSecondsToBeats(seconds: number, timing: StudioTiming): number;
export function warpBeatsFromSeconds(markers: WarpMarkers, seconds: number): number;
export function placeClip(clip: ClipHandle, startBeats: number, options?: { lengthBeats?: number }): PostprocessedClip;
export function placeSequentialClips(clips: ClipHandle[], startBeats?: number): PostprocessedClip[];
export function postprocessClip(clip: ClipHandle, changes?: StudioPostProcess): PostprocessedClip;
export function restoreUploadedPitch(...args: unknown[]): never;
export function appendClipToEditor(editor: EditorMemoryState, trackId: string, clip: PostprocessedClip): EditorMemoryState;
export function assertWarpReferencesResolve(wire: StudioState): true;
export function deserializeAudioProjectState(wire: StudioState): StudioState;
export function serializeAudioProjectState(memory: StudioState): StudioState;
export function hashWarpMarkers(markers: WarpMarkers): string;
