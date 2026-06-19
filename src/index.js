/**
 * Public API surface for programmatic use.
 * Only export the pure, stable interfaces — not internal I/O.
 */
export { claudoroPaths } from './platform/paths.js';
export { IDLE_STATE, SCHEMA_VERSION } from './store.js';
export {
  remaining,
  formatMMSS,
  foldRecords,
  parseJsonl,
  progressFraction,
} from './derive.js';
export { renderSegment } from './render/segment.js';
export { renderPassthrough } from './render/passthrough.js';
export { foldStats } from './stats.js';
export { renderStatsHtml } from './render/dashboard.js';
