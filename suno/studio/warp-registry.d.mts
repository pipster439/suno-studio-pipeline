import type { StudioState } from './models.js';
export const WarpHashStrategy: { readonly PRESERVE_EXISTING: 'PRESERVE_EXISTING'; readonly CURRENT_STATIC_ALGORITHM: 'CURRENT_STATIC_ALGORITHM' };
export type WarpHashStrategyValue = typeof WarpHashStrategy[keyof typeof WarpHashStrategy];
export function markersSignature(markers: Record<string, number>): string;
export function resolveWarpMarkers(registry: Record<string, unknown>, hash: string): Record<string, number>;
export function registerWarpMarkers(registry: Record<string, unknown>, markers: Record<string, number>, options: { strategy: WarpHashStrategyValue; preferredHash?: string }): { registry: Record<string, unknown>; hash: string; status: 'OBSERVED' | 'FOUND_STATICALLY'; reused: boolean };
export function serializeWarpState(memory: StudioState, options: { strategy: WarpHashStrategyValue; originalWire?: StudioState }): { state: StudioState; provenance: Record<string, unknown>[] };
