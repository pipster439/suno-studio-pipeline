import type { StudioState } from './models.js';
export function validateJsonData(value: unknown, path?: string): true;
export function validId(value: string): string;
export function changedPaths(before: unknown, after: unknown, path?: string): string[];
export function validateProjectForSave(state: StudioState, options?: { sequential?: boolean; originalState?: StudioState; allowedChanges?: string[] }): { valid: true; scope: 'LOCAL_ONLY'; sequential: boolean; clipCount: number; arrangementIdsUnique: true; warpReferencesResolve: true; unknownFieldsPreserved: true | 'template-copy'; serverWriteVerified: false };
