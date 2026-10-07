// Official module 130800 context branch; full-range live materialization and
// authorized official-player decoding observed on 2026-10-07. Download/QA
// authorization remains a separate gate, never implied by this strategy.
export const EXPORT_STRATEGIES = Object.freeze({
  verified_legacy_render: 'rendered_context_window',
  experimental_fullsong_export: 'fullsong_export'
});
export const DEFAULT_EXPORT_STRATEGY = 'verified_legacy_render';
export function exportModeFor(strategy = DEFAULT_EXPORT_STRATEGY) {
  const mode = EXPORT_STRATEGIES[strategy];
  if (!mode) throw Error(`Invalid export strategy: ${strategy}`);
  return mode;
}

// Classify only observed results; timeout is not proof of a permanent failure.
export function classifyRenderComparison(rows) {
  const context = rows.find(r => r.exportMode === EXPORT_STRATEGIES.verified_legacy_render && r.fullRange);
  const fullsong = rows.find(r => r.exportMode === EXPORT_STRATEGIES.experimental_fullsong_export && r.fullRange);
  if (context?.materialized && fullsong?.terminalFailure) return 'EXPORT_MODE_MISMATCH';
  if (context?.materialized && fullsong && !fullsong.materialized) return 'MODE_DEPENDENT_MATERIALIZATION_OBSERVED';
  const ready = rows.filter(r => r.materialized), failed = rows.filter(r => r.terminalFailure);
  if (ready.some(a => failed.some(b => a.exportMode === b.exportMode && b.duration > a.duration))) return 'DURATION_DEPENDENT_CANDIDATE';
  return 'INCONCLUSIVE';
}
