/**
 * Spin Recall & Replay — public entry point (Faza 8.5).
 *
 * The journal lives behind the `Journal` interface. Callers pick
 * `MemoryJournal` for tests/dev, `NdjsonFileJournal` for production.
 * Either way, every appended entry is hash-chained and verifiable
 * via `verifyChain`.
 *
 * Spec: `docs/RECALL_SPEC.md`.
 */

export type {
  Hex64,
  SchemaVersion,
  BetInput,
  BetMeta,
  PreSpinState,
  SpinResultSummary,
  ComplianceFlags,
  SpinJournalEntry,
  JournalManifest,
  ReplayResult,
} from './types.js';
export { RECALL_SCHEMA_VERSION, ZERO_HASH } from './types.js';

export type { ChainVerification } from './integrity.js';
export {
  canonicalJson,
  sha256Hex,
  computeEntryHash,
  computeManifestHash,
  sealEntry,
  sealManifest,
  verifyChain,
} from './integrity.js';

export type { Journal } from './journal.js';
export { MemoryJournal, NdjsonFileJournal, writeManifest, readManifest, getEngineVersion } from './journal.js';

export type { ReplayDriver, ReplayOptions } from './replay.js';
export { replaySpin } from './replay.js';

export type { SpinDisplay, DisputeCertificate, ChainVerificationReport } from './viewer.js';
export { SpinReplayViewer } from './viewer.js';
