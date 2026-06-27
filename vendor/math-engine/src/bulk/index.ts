/**
 * Faza 9.8 — public TypeScript bulk API.
 *
 * Scope: dispatcher, progress, checkpoint, parse helpers. The
 * production 1T path is the Rust binary; this side targets developer
 * tooling, in-browser previews (compiled via tsc), and tests that
 * exercise the TS↔Rust contract.
 */

export type {
  BulkCheckpoint,
  BulkStatsSnapshot,
  ProgressEvent,
  ProgressReporter,
} from './types.js';
export {
  EMPTY_STATS,
  JsonLineProgress,
  NoOpProgress,
  ParseSpinCountError,
  parseSpinCount,
} from './types.js';

export {
  BulkDispatcher,
  type BulkConfig,
  type BulkResult,
} from './dispatcher.js';

export {
  loadCheckpoint,
  saveCheckpoint,
  CHECKPOINT_SCHEMA_VERSION,
} from './checkpoint.js';
