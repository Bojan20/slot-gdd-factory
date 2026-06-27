/**
 * W152 Wave 24 — TS Micro-Bench Harness (closes "vitest bench + CI graph
 * reporter" tehnički dug from Faza 0.1).
 *
 * A criterion-style bench harness for TypeScript hot paths. Where the
 * Rust side has full criterion.rs benches (`rust-sim/benches/`), the TS
 * side previously had no equivalent — perf regressions could land
 * silently. This module fills that gap.
 *
 * Design:
 *   * Pure TypeScript — no Vitest dependency at runtime (although tests
 *     CAN consume it via vitest test files for assertion-based perf gates).
 *   * Calibration phase — discovers iteration count to hit a target
 *     wall-clock budget (default 100 ms).
 *   * Measurement phase — runs N batches × M iters, computes mean / σ /
 *     min / max / p95 / p99.
 *   * Reporter — emits machine-readable JSON for CI graph ingest.
 *
 * Naming policy: `microBench` engine-generic.
 */

export interface BenchOptions {
  /** Target wall-clock per iter measurement (ms). Default 100. */
  targetBudgetMs?: number;
  /** Number of measurement batches. Default 5. */
  batches?: number;
  /** Force a specific iteration count (skip calibration). */
  iterations?: number;
  /** Warm-up iterations before measurement (JIT priming). Default 100. */
  warmupIters?: number;
}

export interface BenchResult {
  name: string;
  iterations: number;
  batches: number;
  totalIters: number;
  /** Per-iter wall-clock timings (ms). */
  perIterMs: {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  };
  /** Operations per second. */
  opsPerSec: number;
  /** Total wall-clock for the benchmark. */
  totalWallMs: number;
}

/** Median value of a sorted array. */
function median(sorted: ReadonlyArray<number>): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function stdDev(arr: ReadonlyArray<number>, mean: number): number {
  if (arr.length < 2) return 0;
  let s = 0;
  for (const x of arr) s += (x - mean) ** 2;
  return Math.sqrt(s / (arr.length - 1));
}

/**
 * Calibrate iteration count to land near `targetBudgetMs`.
 * Returns the iteration count for one batch.
 */
function calibrate(fn: () => void, targetBudgetMs: number): number {
  // Start with 1 iter, exponentially grow until per-batch wall ≥ targetBudget/10.
  let iters = 1;
  const calibrationBudget = targetBudgetMs / 10;
  while (true) {
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) fn();
    const elapsed = performance.now() - t0;
    if (elapsed >= calibrationBudget || iters > 1_000_000_000) break;
    if (elapsed === 0) {
      iters *= 16;
    } else {
      iters = Math.max(iters * 2, Math.floor((iters * targetBudgetMs) / Math.max(elapsed, 0.01)));
    }
  }
  return iters;
}

/**
 * Run a micro-benchmark. Returns structured `BenchResult`.
 *
 * Throws on:
 *   * empty name
 *   * non-positive batches / iterations / warmupIters
 *   * fn that throws (caller responsibility — wrap in try if needed)
 */
export function bench(name: string, fn: () => void, opts: BenchOptions = {}): BenchResult {
  if (!name || name.length === 0) throw new Error('bench: name required');
  const batches = opts.batches ?? 5;
  const targetBudgetMs = opts.targetBudgetMs ?? 100;
  const warmupIters = opts.warmupIters ?? 100;
  if (!Number.isInteger(batches) || batches <= 0) {
    throw new RangeError(`bench: batches must be positive integer (got ${batches})`);
  }
  if (warmupIters < 0) throw new RangeError(`bench: warmupIters must be >= 0`);
  if (targetBudgetMs <= 0) throw new RangeError(`bench: targetBudgetMs must be > 0`);

  // Warm-up phase
  for (let i = 0; i < warmupIters; i++) fn();

  const iters = opts.iterations ?? calibrate(fn, targetBudgetMs);
  if (!Number.isInteger(iters) || iters <= 0) {
    throw new RangeError(`bench: iterations must be positive integer (got ${iters})`);
  }

  const perIterTimes: number[] = [];
  const t0total = performance.now();
  for (let b = 0; b < batches; b++) {
    const tBatchStart = performance.now();
    for (let i = 0; i < iters; i++) fn();
    const batchMs = performance.now() - tBatchStart;
    perIterTimes.push(batchMs / iters);
  }
  const totalWallMs = performance.now() - t0total;

  const sorted = [...perIterTimes].sort((a, b) => a - b);
  const mean = perIterTimes.reduce((s, x) => s + x, 0) / perIterTimes.length;
  const sd = stdDev(perIterTimes, mean);
  const opsPerSec = mean > 0 ? 1000 / mean : Infinity;

  return {
    name,
    iterations: iters,
    batches,
    totalIters: iters * batches,
    perIterMs: {
      mean,
      stdDev: sd,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: median(sorted),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    },
    opsPerSec,
    totalWallMs,
  };
}

/** Bench multiple named functions in a suite. */
export interface BenchSuite {
  suiteName: string;
  results: BenchResult[];
  totalWallMs: number;
}

export function benchSuite(
  suiteName: string,
  fns: Array<{ name: string; fn: () => void; opts?: BenchOptions }>,
): BenchSuite {
  const t0 = performance.now();
  const results = fns.map((entry) => bench(entry.name, entry.fn, entry.opts));
  const totalWallMs = performance.now() - t0;
  return { suiteName, results, totalWallMs };
}

/** Render bench result as a one-line summary. */
export function formatBenchLine(r: BenchResult): string {
  const ns = r.perIterMs.mean * 1_000_000; // ms → ns
  return `${r.name.padEnd(40)} ${ns.toFixed(2).padStart(12)} ns/op  ${r.opsPerSec.toExponential(2)} op/s  ±${(r.perIterMs.stdDev * 1_000_000).toFixed(2)} ns`;
}

/** JSON serialisation suitable for CI graph ingest. */
export function toJSON(suite: BenchSuite): string {
  return JSON.stringify(
    {
      suiteName: suite.suiteName,
      generatedAtUtc: new Date().toISOString(),
      totalWallMs: suite.totalWallMs,
      results: suite.results,
    },
    null,
    2,
  );
}
