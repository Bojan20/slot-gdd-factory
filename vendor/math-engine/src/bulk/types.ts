/**
 * Faza 9.8 — TypeScript bulk dispatcher types (mirror of
 * `rust-sim/src/bulk`).
 *
 * The TS dispatcher exists for the preview / developer-tools side of
 * the engine. For production 1T runs the Rust binary is the path —
 * Node single-thread is too slow to project under 60s even with worker
 * threads. The TS dispatcher's job is to drive small-to-medium runs
 * (≤ 1B spins) inside a worker-pool with the same UX surface (progress,
 * checkpoint) as the Rust side.
 */

export type ProgressEvent =
  | { kind: 'tick'; completed: number; total: number; fraction: number; spinsPerSec: number; elapsedMs: number; etaMs: number | null; chunkIndex: number; chunksTotal: number }
  | { kind: 'done'; completed: number; total: number; elapsedMs: number; spinsPerSec: number };

export interface ProgressReporter {
  report(event: ProgressEvent): void;
}

export class NoOpProgress implements ProgressReporter {
  report(_event: ProgressEvent): void {
    /* intentional */
  }
}

/** NDJSON-line reporter — writes one event per call to stderr. */
export class JsonLineProgress implements ProgressReporter {
  report(event: ProgressEvent): void {
    process.stderr.write(JSON.stringify(event) + '\n');
  }
}

export interface BulkCheckpoint {
  schemaVersion: '1.0.0';
  runId: string;
  configHash: string;
  totalSpinsTarget: number;
  completedSpins: number;
  baseSeed: number;
  chunkSpins: number;
  chunksCompleted: number;
  elapsedMs: number;
  startedAtEpochMs: number;
  lastCheckpointEpochMs: number;
  /** Plain stat counters; HDR buckets travel alongside. */
  stats: BulkStatsSnapshot;
  hdrBuckets: number[];
}

/** Mirrors `rust-sim::bulk::checkpoint::AtomicStatsSnapshot`. Same
 *  field names so a TS checkpoint can be replayed by the Rust runner. */
export interface BulkStatsSnapshot {
  total_spins: number;
  total_wagered: number;
  total_won: number;
  total_base_won: number;
  total_fs_won: number;
  total_hnw_won: number;
  total_cascade_won: number;
  total_jackpot_won: number;
  total_lightning_uplift: number;
  winning_spins: number;
  fs_triggers: number;
  hnw_triggers: number;
  lightning_triggers: number;
  cascade_triggers: number;
  max_win: number;
  max_mult_seen: number;
  total_fs_spins: number;
  total_hnw_respins: number;
  fs_retriggers: number;
  hnw_full_grids: number;
  jackpots_mini: number;
  jackpots_minor: number;
  jackpots_major: number;
  jackpots_grand: number;
}

export const EMPTY_STATS: BulkStatsSnapshot = Object.freeze({
  total_spins: 0,
  total_wagered: 0,
  total_won: 0,
  total_base_won: 0,
  total_fs_won: 0,
  total_hnw_won: 0,
  total_cascade_won: 0,
  total_jackpot_won: 0,
  total_lightning_uplift: 0,
  winning_spins: 0,
  fs_triggers: 0,
  hnw_triggers: 0,
  lightning_triggers: 0,
  cascade_triggers: 0,
  max_win: 0,
  max_mult_seen: 0,
  total_fs_spins: 0,
  total_hnw_respins: 0,
  fs_retriggers: 0,
  hnw_full_grids: 0,
  jackpots_mini: 0,
  jackpots_minor: 0,
  jackpots_major: 0,
  jackpots_grand: 0,
});

/**
 * Parser for the `--bulk` value string: `"1T"`, `"100B"`, `"1.5B"`,
 * `"2_500_000"`. Mirrors `rust-sim::bulk::parse_spin_count`.
 */
export class ParseSpinCountError extends Error {
  constructor(public readonly kind: 'empty' | 'invalid' | 'unknown_suffix' | 'overflow' | 'negative', message: string) {
    super(message);
    this.name = 'ParseSpinCountError';
  }
}

export function parseSpinCount(input: string): number {
  const trimmed = input.trim().replace(/[_\s]/g, '');
  if (trimmed.length === 0) throw new ParseSpinCountError('empty', 'empty string');
  const last = trimmed[trimmed.length - 1];
  let multiplier = 1;
  let numberPart = trimmed;
  if (last && /[a-zA-Z]/.test(last)) {
    switch (last.toUpperCase()) {
      case 'K': multiplier = 1_000; break;
      case 'M': multiplier = 1_000_000; break;
      case 'B': multiplier = 1_000_000_000; break;
      case 'T': multiplier = 1_000_000_000_000; break;
      default: throw new ParseSpinCountError('unknown_suffix', `unknown suffix '${last}' (expected K/M/B/T)`);
    }
    numberPart = trimmed.slice(0, -1);
  }
  if (numberPart.length === 0) throw new ParseSpinCountError('invalid', `invalid number '${input}'`);
  if (numberPart.startsWith('-')) throw new ParseSpinCountError('negative', `spin count must be non-negative`);
  const value = Number(numberPart);
  if (!Number.isFinite(value) || value < 0) {
    throw new ParseSpinCountError('invalid', `invalid number '${input}'`);
  }
  const scaled = value * multiplier;
  if (!Number.isFinite(scaled) || scaled > Number.MAX_SAFE_INTEGER) {
    throw new ParseSpinCountError('overflow', `spin count overflows safe integer range`);
  }
  return Math.round(scaled);
}
