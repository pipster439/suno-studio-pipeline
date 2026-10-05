import type { StudioProject, StudioState, StudioClip } from './models.js';
import type { RequestPreview, SaveProjectParams, RenderProjectParams } from './request-builders.js';
export type EvidenceStatus = 'VERIFIED' | 'OBSERVED' | 'FOUND_STATICALLY' | 'CORRELATED' | 'DEFAULT' | 'USER_SUPPLIED';
export interface UploaderClipMetadata {
  source_start_second?: number; source_end_second?: number; pitch_shift_semitones?: number;
  restore_pitch_in_studio?: boolean; gain_reference?: unknown; silence_pad_seconds?: number;
  observed_clip_id_alias?: string; repair_loudness?: boolean; repair_loudness_on_merge?: boolean;
  [key: string]: unknown;
}
export interface SourceClip {
  clip_id: string; duration_seconds: number; title?: string; duration_basis?: string;
  uploader_metadata?: UploaderClipMetadata; [key: string]: unknown;
}
export interface ProjectTiming { type: 'manual'; bps: number; firstBeatSeconds: number; bpsAutomation: unknown[]; lockBPS?: boolean; [key: string]: unknown; }
export interface StudioPostProcessProfile {
  explicit?: { transposition?: number; amplitude?: number; read_start_beats?: number; fade_in_beats?: number; fade_out_beats?: number; fade_in_curve?: number; fade_out_curve?: number };
  derived?: { restore_uploaded_pitch?: { allow_observed_uploader_pitch_rule: boolean } };
  unverified?: Record<string, unknown>;
  warp?: { markers?: Record<string, number>; enabled?: boolean; awaiting_analysis?: boolean; identity_project_bps?: boolean };
  display?: { color?: string | null };
}
export interface UploaderCompatibilityProfile { preserve_observed_clip_id_alias?: boolean; }
export const WarpHashStrategy: { readonly PRESERVE_EXISTING: 'PRESERVE_EXISTING'; readonly CURRENT_STATIC_ALGORITHM: 'CURRENT_STATIC_ALGORITHM' };
export type WarpHashStrategyValue = typeof WarpHashStrategy[keyof typeof WarpHashStrategy];
export interface FutureRequestBindings { save_project_id: string; project_id: string; studio_project_id: string; studio_project_version_id: string; binding_status: 'LOCAL_PLACEHOLDER' | 'REAL_OBSERVED' | 'UNVERIFIED_BINDING'; }
export interface DryRunInput {
  sources: SourceClip[]; timing: ProjectTiming; template: StudioProject; profile?: StudioPostProcessProfile;
  perClipProfiles?: StudioPostProcessProfile[]; compatibility?: UploaderCompatibilityProfile;
  placementMode?: 'SOURCE_DURATION' | 'RESOLVED_WARP'; hashStrategy?: WarpHashStrategyValue; title?: string;
  requestContext: FutureRequestBindings;
  render: { render_engine: 'v2'; export_mode: 'fullsong_export' | 'selected_time_range_export'; web_client_pathname: string; lyrics: string; downbeats?: unknown };
}
export interface StudioProjectDraft { id: string; title: string; identity: { kind: 'LOCAL_DRAFT'; serverProjectId: null }; state: StudioState; }
export interface DryRunRequestPreview extends RequestPreview { readonly endpointStatus: 'FOUND_STATICALLY'; readonly provenance: Record<string, unknown>; readonly validation: Record<string, unknown>; }
export interface DryRunResult {
  sourceClips: Readonly<SourceClip>[]; projectDraft: StudioProjectDraft;
  editorState: { kind: 'editor-memory'; payload: StudioState };
  saveSerializedState: { kind: 'save-serialized'; payload: StudioState };
  renderTransformedState: { kind: 'render-transformed'; payload: StudioState };
  saveRequestPreview: DryRunRequestPreview; renderRequestPreview: DryRunRequestPreview;
  validationReport: Record<string, unknown>; provenanceReport: Record<string, unknown>; summary: Record<string, unknown>;
}
export function makeSourceClip(input: SourceClip): Readonly<SourceClip>;
export function makePostProcessProfile(input?: StudioPostProcessProfile): Readonly<StudioPostProcessProfile>;
export function derivePitchRestoration(metadata: UploaderClipMetadata, options?: { allow_observed_uploader_pitch_rule?: boolean }): { value: number; status: 'CORRELATED'; serverVerified: false; [key: string]: unknown };
export function applyLoudnessRepair(...args: unknown[]): never;
export function applyPostProcessProfile(clip: StudioClip, profile?: StudioPostProcessProfile, uploader?: UploaderClipMetadata): { clip: StudioClip; provenance: Record<string, unknown>[] };
export function buildSequentialTimeline(durationsSeconds: number[], timing: ProjectTiming, options?: { startBeats?: number }): { placements: Array<{ startBeats: number; endBeats: number; durationSeconds: number }>; totalDurationSeconds: number; totalDurationBeats: number; startBeats: number; endBeats: number };
export function buildStudioClipDraft(source: SourceClip, timing: ProjectTiming, profile: StudioPostProcessProfile, compatibility?: UploaderCompatibilityProfile): { clip: StudioClip; source: SourceClip; provenance: Record<string, unknown>[]; warpSource: string };
export function buildProjectDraft(template: StudioProject, timing: ProjectTiming, options?: { title?: string; trackName?: string }): StudioProjectDraft;
export function buildSaveProjectRequestPreview(input: SaveProjectParams, metadata?: { provenance?: Record<string, unknown>; validation?: Record<string, unknown> }): DryRunRequestPreview;
export function buildRenderStateRequestPreview(input: RenderProjectParams & { render_engine: 'v2' }, metadata?: { provenance?: Record<string, unknown>; validation?: Record<string, unknown> }): DryRunRequestPreview;
export function buildMergeDryRun(input: DryRunInput): Readonly<DryRunResult>;
export function modifyExistingProject(project: StudioProject, options?: { clipId?: string; profile?: StudioPostProcessProfile; hashStrategy?: WarpHashStrategyValue }): { project: StudioProject; validation: Record<string, unknown>; provenance: Record<string, unknown>[] };
export function historicalProjectDiff(historical: StudioProject, result: DryRunResult): { scope: string; counts: Record<'MATCH'|'EXPECTED_DYNAMIC'|'UNKNOWN_DIFFERENCE'|'BLOCKER', number>; differences: unknown[]; complete: boolean; serverWriteVerified: false };
export function deepFreeze<T>(value: T): Readonly<T>;
export class StudioDryRunSDK { buildMerge(input: DryRunInput): Readonly<DryRunResult>; dispatch(): never; }
