/**
 * Faza 9.8 — TypeScript bulk dispatcher.
 *
 * Single-thread Node implementation that targets developer tooling
 * (preview UI, integration tests, small ad-hoc runs). Production 1T
 * runs go through the Rust binary; this side keeps the same UX
 * surface (progress, chunked execution, checkpoint, resume) so
 * downstream tooling can target one API regardless of engine.
 *
 * `simulateChunk` is a plug-in: the caller decides which spin engine
 * the dispatcher drives. The default `mockChunkRunner` produces
 * deterministic synthetic counters and is used by unit tests; the
 * real engine drivers in `src/sim/` plug in via `BulkConfig.runner`.
 */

import { saveCheckpoint, CHECKPOINT_SCHEMA_VERSION } from './checkpoint.js';
import {
  EMPTY_STATS,
  NoOpProgress,
  type BulkCheckpoint,
  type BulkStatsSnapshot,
  type ProgressReporter,
} from './types.js';

export interface BulkConfig {
  totalSpins: number;
  chunkSpins: number;
  baseSeed: number;
  totalBetMc: number;
  runId: string;
  configHash: string;
  /** Optional checkpoint path; written every `checkpointEveryChunks`. */
  checkpointPath?: string;
  checkpointEveryChunks?: number;
  resumeCheckpoint?: BulkCheckpoint;
  /** Plug-in: runs `count` spins from `(baseSeed, chunkIndex, chunkStart)`
   *  and returns the merged stats snapshot + HDR bucket array. */
  runner?: ChunkRunner;
  progress?: ProgressReporter;
}

export interface BulkResult {
  totalSpins: number;
  durationMs: number;
  spinsPerSec: number;
  stats: BulkStatsSnapshot;
  hdrBuckets: number[];
  chunksCompleted: number;
  checkpointsWritten: number;
  resumedFromSpins: number | null;
}

/** Plug-in driver — the dispatcher hands `count` spins to this fn and
 *  expects a snapshot back. Async so the runner can shell out to a
 *  worker / process if needed. */
export type ChunkRunner = (args: {
  chunkIndex: number;
  chunkStartSpin: number;
  count: number;
  baseSeed: number;
  totalBetMc: number;
  configHash: string;
}) => Promise<{ stats: BulkStatsSnapshot; hdrBuckets: number[] }>;

const HDR_BUCKET_COUNT = 32;

export class BulkDispatcher {
  constructor(private readonly cfg: BulkConfig) {}

  async run(): Promise<BulkResult> {
    const total = this.cfg.totalSpins;
    const chunkSpins = Math.max(1, this.cfg.chunkSpins);
    const runner = this.cfg.runner ?? mockChunkRunner;
    const progress = this.cfg.progress ?? new NoOpProgress();

    const startedAt = Date.now();
    const startedMonotonic = performance.now();

    const stats = cloneStats(EMPTY_STATS);
    const hdrBuckets = new Array<number>(HDR_BUCKET_COUNT).fill(0);

    let completed = 0;
    let chunksCompleted = 0;
    let checkpointsWritten = 0;
    let resumedFrom: number | null = null;

    if (this.cfg.resumeCheckpoint) {
      const chk = this.cfg.resumeCheckpoint;
      if (chk.totalSpinsTarget !== total) {
        throw new Error(
          `resume: checkpoint totalSpinsTarget ${chk.totalSpinsTarget} != totalSpins ${total}`,
        );
      }
      if (chk.baseSeed !== this.cfg.baseSeed) {
        throw new Error(
          `resume: checkpoint baseSeed ${chk.baseSeed} != current ${this.cfg.baseSeed}`,
        );
      }
      if (chk.chunkSpins !== chunkSpins) {
        throw new Error(
          `resume: checkpoint chunkSpins ${chk.chunkSpins} != current ${chunkSpins}`,
        );
      }
      if (this.cfg.configHash && chk.configHash !== this.cfg.configHash) {
        throw new Error(
          `resume: checkpoint configHash ${chk.configHash} != current ${this.cfg.configHash}`,
        );
      }
      addStatsInto(stats, chk.stats);
      addBucketsInto(hdrBuckets, chk.hdrBuckets);
      completed = chk.completedSpins;
      chunksCompleted = chk.chunksCompleted;
      resumedFrom = chk.completedSpins;
    }

    const chunksTotal = Math.ceil(total / chunkSpins);
    const checkpointEvery = Math.max(1, this.cfg.checkpointEveryChunks ?? 0);

    for (let chunkIdx = chunksCompleted; chunkIdx < chunksTotal; chunkIdx++) {
      const chunkStart = chunkIdx * chunkSpins;
      const count = Math.min(chunkSpins, total - chunkStart);
      if (count <= 0) break;
      const out = await runner({
        chunkIndex: chunkIdx,
        chunkStartSpin: chunkStart,
        count,
        baseSeed: this.cfg.baseSeed,
        totalBetMc: this.cfg.totalBetMc,
        configHash: this.cfg.configHash,
      });
      addStatsInto(stats, out.stats);
      addBucketsInto(hdrBuckets, out.hdrBuckets);
      completed += count;
      chunksCompleted = chunkIdx + 1;

      const elapsedMs = performance.now() - startedMonotonic;
      const sps = elapsedMs > 0 ? ((completed - (resumedFrom ?? 0)) / elapsedMs) * 1000 : 0;
      const remaining = total - completed;
      const etaMs = sps > 0 && remaining > 0 ? Math.round((remaining / sps) * 1000) : null;
      progress.report({
        kind: 'tick',
        completed,
        total,
        fraction: completed / total,
        spinsPerSec: sps,
        elapsedMs: Math.round(elapsedMs),
        etaMs,
        chunkIndex: chunkIdx,
        chunksTotal,
      });

      if (
        this.cfg.checkpointPath &&
        (this.cfg.checkpointEveryChunks ?? 0) > 0 &&
        chunksCompleted % checkpointEvery === 0
      ) {
        const chk: BulkCheckpoint = {
          schemaVersion: CHECKPOINT_SCHEMA_VERSION,
          runId: this.cfg.runId,
          configHash: this.cfg.configHash,
          totalSpinsTarget: total,
          completedSpins: completed,
          baseSeed: this.cfg.baseSeed,
          chunkSpins,
          chunksCompleted,
          elapsedMs: Math.round(elapsedMs),
          startedAtEpochMs: startedAt,
          lastCheckpointEpochMs: Date.now(),
          stats: { ...stats },
          hdrBuckets: hdrBuckets.slice(),
        };
        saveCheckpoint(this.cfg.checkpointPath, chk);
        checkpointsWritten++;
      }
    }

    // Always write a final checkpoint when one was requested, so resume
    // semantics work after a clean exit too (not just crash recovery).
    if (this.cfg.checkpointPath && (this.cfg.checkpointEveryChunks ?? 0) > 0) {
      const elapsedMs = performance.now() - startedMonotonic;
      const chk: BulkCheckpoint = {
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        runId: this.cfg.runId,
        configHash: this.cfg.configHash,
        totalSpinsTarget: total,
        completedSpins: completed,
        baseSeed: this.cfg.baseSeed,
        chunkSpins,
        chunksCompleted,
        elapsedMs: Math.round(elapsedMs),
        startedAtEpochMs: startedAt,
        lastCheckpointEpochMs: Date.now(),
        stats: { ...stats },
        hdrBuckets: hdrBuckets.slice(),
      };
      saveCheckpoint(this.cfg.checkpointPath, chk);
      checkpointsWritten++;
    }

    const durationMs = Math.round(performance.now() - startedMonotonic);
    const completedThisRun = completed - (resumedFrom ?? 0);
    const spinsPerSec = durationMs > 0 ? (completedThisRun / durationMs) * 1000 : 0;
    progress.report({
      kind: 'done',
      completed,
      total,
      elapsedMs: durationMs,
      spinsPerSec,
    });

    return {
      totalSpins: completed,
      durationMs,
      spinsPerSec,
      stats,
      hdrBuckets,
      chunksCompleted,
      checkpointsWritten,
      resumedFromSpins: resumedFrom,
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function cloneStats(s: BulkStatsSnapshot): BulkStatsSnapshot {
  return { ...s };
}

function addStatsInto(target: BulkStatsSnapshot, src: BulkStatsSnapshot): void {
  target.total_spins += src.total_spins;
  target.total_wagered += src.total_wagered;
  target.total_won += src.total_won;
  target.total_base_won += src.total_base_won;
  target.total_fs_won += src.total_fs_won;
  target.total_hnw_won += src.total_hnw_won;
  target.total_cascade_won += src.total_cascade_won;
  target.total_jackpot_won += src.total_jackpot_won;
  target.total_lightning_uplift += src.total_lightning_uplift;
  target.winning_spins += src.winning_spins;
  target.fs_triggers += src.fs_triggers;
  target.hnw_triggers += src.hnw_triggers;
  target.lightning_triggers += src.lightning_triggers;
  target.cascade_triggers += src.cascade_triggers;
  target.max_win = Math.max(target.max_win, src.max_win);
  target.max_mult_seen = Math.max(target.max_mult_seen, src.max_mult_seen);
  target.total_fs_spins += src.total_fs_spins;
  target.total_hnw_respins += src.total_hnw_respins;
  target.fs_retriggers += src.fs_retriggers;
  target.hnw_full_grids += src.hnw_full_grids;
  target.jackpots_mini += src.jackpots_mini;
  target.jackpots_minor += src.jackpots_minor;
  target.jackpots_major += src.jackpots_major;
  target.jackpots_grand += src.jackpots_grand;
}

function addBucketsInto(target: number[], src: number[]): void {
  const n = Math.min(target.length, src.length);
  for (let i = 0; i < n; i++) target[i] += src[i];
}

/**
 * Deterministic synthetic runner used by tests + the empty-runner path.
 * Mocks a simple win distribution so the dispatcher exercises the merge
 * code paths without needing the full evaluator. Pure function of
 * `(baseSeed, chunkIndex, count)` — same inputs always produce the same
 * synthetic counters.
 */
export const mockChunkRunner: ChunkRunner = async ({
  chunkIndex,
  count,
  baseSeed,
}) => {
  // Tiny xorshift PRNG to manufacture deterministic counters.
  let state = (baseSeed ^ (chunkIndex * 0x9E37_79B9)) >>> 0;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  const stats: BulkStatsSnapshot = cloneStats(EMPTY_STATS);
  const buckets = new Array<number>(HDR_BUCKET_COUNT).fill(0);
  stats.total_spins = count;
  stats.total_wagered = count * 1000;
  buckets[0] = count; // bucket 0 = no-win (placeholder distribution)

  for (let i = 0; i < count; i++) {
    const r = next();
    // 30% hit rate, payouts in [1, 10] millicredits worth of bet mults.
    if (r % 10 < 3) {
      stats.winning_spins += 1;
      const winMc = 100 + (r % 9_000); // 0.1× .. 9× bet
      stats.total_won += winMc;
      buckets[0] -= 1;
      buckets[1] += 1;
      if (winMc > stats.max_win) stats.max_win = winMc;
    }
  }
  return { stats, hdrBuckets: buckets };
};
