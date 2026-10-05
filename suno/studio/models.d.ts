/** Observed GET JSON, open records for future/unknown fields. Beats are not seconds. */
export interface StudioTiming {
  [key: string]: unknown;
  type: string;
  bps?: number;
  firstBeatSeconds?: number;
  lockBPS?: boolean;
  bpsAutomation?: unknown[];
}
/** Fields observed on audio arrangements; id and clipId/asset.id have distinct roles. */
export interface StudioClip {
  [key: string]: unknown;
  id: string;
  type: string;
  clipId?: string;
  asset?: { id: string; type: string; [key: string]: unknown };
  startBeats: number;
  endBeats: number;
  readStartBeats?: number;
  transposition?: number;
  amplitude?: number;
  mute?: boolean;
  warp?: { enabled?: boolean; markersHash?: string; [key: string]: unknown };
  loop?: { enabled?: boolean; startBeats?: number; endBeats?: number; [key: string]: unknown };
  fadeInBeats?: number;
  fadeOutBeats?: number;
  fadeInCurve?: number;
  fadeOutCurve?: number;
  reversed?: boolean;
  streaming?: boolean;
  name?: string;
  color?: string;
}
export interface StudioTrack {
  [key: string]: unknown;
  id: string;
  type: string;
  clips: StudioClip[];
  name?: string;
  takeLanes?: unknown[];
  signalChain?: unknown[];
}
export interface StudioState {
  [key: string]: unknown;
  tracks: StudioTrack[];
  timing: StudioTiming;
  selection: Record<string, unknown>;
  markersRegistry?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  loop?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  contextualWindowConfig?: Record<string, unknown>;
}
export interface StudioProject {
  [key: string]: unknown;
  id: string;
  title?: string;
  state: StudioState;
  latest_version_id?: string | null;
  created_at?: string;
  updated_at?: string;
  archived?: boolean;
}
export function fullProject(response: { result: unknown; status?: number }, expectedId: string): StudioProject;
