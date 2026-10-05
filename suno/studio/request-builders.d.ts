import type { SaveSerializedState, RenderTransformedState } from './state-boundaries.js';
export interface RequestPreview { readonly operation: string; readonly status: 'FOUND_STATICALLY'; readonly dispatchAllowed: false; readonly method: 'POST'; readonly path: string; readonly body?: Record<string, unknown>; }
/** Scalar hints reflect static query expressions; server domains remain unverified. */
export interface CreateProjectParams { title: string; major_version?: number; trigger?: string; extract_mode?: string; num_stems_sent?: number; entry_source?: string; }
export interface SaveProjectParams { project_id: string; title: string; state: SaveSerializedState; }
export interface RenderBaseParams {
  title: string; lyrics: string; project_id: string; studio_project_id: string;
  studio_project_version_id?: string | null; web_client_pathname: string;
  state: RenderTransformedState; start_beats: number; end_beats: number; downbeats: unknown;
}
export interface RenderProjectParams extends RenderBaseParams { export_mode: 'fullsong_export' | 'selected_time_range_export'; }
export interface RenderMultitrackParams extends RenderBaseParams { from_studio_project_id: string; }
/** Response fragments are independent and open: they do not claim the complete server response. */
export interface RenderClipResponseFragment { [key: string]: unknown; id?: string; title?: string; moderation_error_message?: string; }
export interface MultitrackDownloadResponseFragment { [key: string]: unknown; download_url?: string; }
export function pathIdentifier(value: string, name?: string): string;
export function buildCreateProjectRequest(params: CreateProjectParams): RequestPreview;
export function buildSaveProjectRequest(params: SaveProjectParams): RequestPreview;
export function buildRenderProjectRequest(params: RenderProjectParams): RequestPreview;
export function buildRenderMultitrackRequest(params: RenderMultitrackParams): RequestPreview;
