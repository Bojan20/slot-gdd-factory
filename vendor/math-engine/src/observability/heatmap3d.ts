/**
 * W152 Wave 16 — 3D RTP heatmap (position × symbol × time-bucket).
 *
 * The 2D heatmap in `src/observability/` aggregates symbol-position
 * payouts into a flat matrix:
 *
 *     symbol \ position    p0   p1   p2   p3   p4
 *     S_HIGH_1             ...
 *     S_HIGH_2             ...
 *
 * This is fine for static audits but loses the *temporal* dimension —
 * an auditor investigating drift wants to see "did symbol X's RTP at
 * position Y shift in the last 24 hours?". The 3D extension adds a
 * time axis bucketed in fixed-size windows (default 1 hour). The result
 * is a sparse 3D structure:
 *
 *     bucket (hour) \ symbol \ position → { spins, totalPayoutUnits, rtp }
 *
 * Sparse representation: a 7-day×11-symbol×30-position cube has
 * 55 440 cells, most empty. We use nested `Map`s keyed by
 * `bucketStart` → `symbol` → `position` so memory grows only with
 * touched cells. For dense workloads, a flat typed-array backend is
 * available via `toDenseTensor()`.
 *
 * Design notes:
 *   * **Determinism**: bucket boundaries are computed from a caller-
 *     supplied `clock()` so tests can pin time. Default is `Date.now`.
 *   * **Bucket math**: `floor(timestampMs / bucketWidthMs) * bucketWidthMs`
 *     so two callers with the same start time get the same bucket key.
 *   * **Aggregation invariant**: `Σ totalPayoutUnits / Σ totalBetUnits = rtp`
 *     per cell. Cells are mutated in-place; the accessor `cellAt()`
 *     returns a structural copy.
 *   * **Drift detection**: `compareBuckets(bucketA, bucketB)` returns
 *     a per-cell delta with `absDelta` and `relDelta` so an alert can
 *     fire on `relDelta > 0.10` (10 % shift symbol-by-symbol).
 *   * **Export**: `toJSON()` produces a flat array suitable for
 *     piping into a frontend renderer (Three.js voxel grid) or for
 *     storing as a daily artifact.
 */

export interface Heatmap3dCell {
  /** ISO start of the time bucket. */
  bucketStartIso: string;
  /** Bucket start in epoch ms. */
  bucketStartMs: number;
  /** Symbol id this cell belongs to. */
  symbol: string;
  /** Reel position (0-indexed). */
  position: number;
  /** Number of spins that landed this symbol at this position in the bucket. */
  spins: number;
  /** Σ payout in monetary units (caller's choice — minor units recommended). */
  totalPayoutUnits: number;
  /** Σ bet in same units as `totalPayoutUnits`. */
  totalBetUnits: number;
  /** Realised RTP for this cell — `totalPayout / totalBet`, or 0 if no bet. */
  rtp: number;
}

export interface Heatmap3dRecordOpts {
  /** Time-bucket width in ms. Default 1 hour (3 600 000). */
  bucketWidthMs?: number;
  /** Clock provider for deterministic tests. */
  clock?: () => number;
}

export interface Heatmap3dRecordInput {
  symbol: string;
  position: number;
  /** In whatever unit the caller uses (cents, minor units, picayunes…). */
  payoutUnits: number;
  betUnits: number;
  /** Optional override timestamp; default uses `clock()`. */
  timestampMs?: number;
}

export interface Heatmap3dCompareResult {
  symbol: string;
  position: number;
  rtpA: number;
  rtpB: number;
  /** `rtpB - rtpA`. */
  absDelta: number;
  /** `(rtpB - rtpA) / rtpA` if rtpA !== 0; else `null`. */
  relDelta: number | null;
}

const DEFAULT_BUCKET_WIDTH_MS = 60 * 60 * 1000; // 1 hour

export class Heatmap3d {
  private readonly bucketWidthMs: number;
  private readonly clock: () => number;
  /** bucketStartMs → symbol → position → cell */
  private readonly grid: Map<number, Map<string, Map<number, Heatmap3dCell>>> = new Map();

  constructor(opts: Heatmap3dRecordOpts = {}) {
    this.bucketWidthMs = opts.bucketWidthMs ?? DEFAULT_BUCKET_WIDTH_MS;
    if (this.bucketWidthMs <= 0 || !Number.isFinite(this.bucketWidthMs)) {
      throw new RangeError(
        `Heatmap3d: bucketWidthMs must be a positive finite number (got ${this.bucketWidthMs})`,
      );
    }
    this.clock = opts.clock ?? Date.now;
  }

  /** Compute the inclusive lower bound of the bucket containing `tsMs`. */
  bucketStartFor(tsMs: number): number {
    return Math.floor(tsMs / this.bucketWidthMs) * this.bucketWidthMs;
  }

  /** Record one observation. Mutates the touched cell in-place. */
  record(input: Heatmap3dRecordInput): void {
    if (!Number.isFinite(input.payoutUnits) || !Number.isFinite(input.betUnits)) {
      throw new TypeError(`Heatmap3d.record: payout/bet must be finite numbers`);
    }
    if (input.betUnits < 0 || input.payoutUnits < 0) {
      throw new RangeError(`Heatmap3d.record: payout/bet must be non-negative`);
    }
    if (!Number.isInteger(input.position) || input.position < 0) {
      throw new RangeError(
        `Heatmap3d.record: position must be a non-negative integer (got ${input.position})`,
      );
    }
    const ts = input.timestampMs ?? this.clock();
    const bucketStart = this.bucketStartFor(ts);

    let bySymbol = this.grid.get(bucketStart);
    if (bySymbol === undefined) {
      bySymbol = new Map();
      this.grid.set(bucketStart, bySymbol);
    }
    let byPosition = bySymbol.get(input.symbol);
    if (byPosition === undefined) {
      byPosition = new Map();
      bySymbol.set(input.symbol, byPosition);
    }
    let cell = byPosition.get(input.position);
    if (cell === undefined) {
      cell = {
        bucketStartIso: new Date(bucketStart).toISOString(),
        bucketStartMs: bucketStart,
        symbol: input.symbol,
        position: input.position,
        spins: 0,
        totalPayoutUnits: 0,
        totalBetUnits: 0,
        rtp: 0,
      };
      byPosition.set(input.position, cell);
    }
    cell.spins += 1;
    cell.totalPayoutUnits += input.payoutUnits;
    cell.totalBetUnits += input.betUnits;
    cell.rtp = cell.totalBetUnits > 0 ? cell.totalPayoutUnits / cell.totalBetUnits : 0;
  }

  /** Snapshot of one cell, or `null` if untouched. */
  cellAt(bucketStartMs: number, symbol: string, position: number): Heatmap3dCell | null {
    const c = this.grid.get(bucketStartMs)?.get(symbol)?.get(position);
    return c === undefined ? null : { ...c };
  }

  /** All buckets in ascending order. */
  buckets(): number[] {
    return Array.from(this.grid.keys()).sort((a, b) => a - b);
  }

  /** Total cells materialised (proof of sparsity). */
  cellCount(): number {
    let n = 0;
    for (const symMap of this.grid.values()) {
      for (const posMap of symMap.values()) n += posMap.size;
    }
    return n;
  }

  /** Flatten into an array for export / dashboard rendering. */
  toJSON(): Heatmap3dCell[] {
    const out: Heatmap3dCell[] = [];
    for (const symMap of this.grid.values()) {
      for (const posMap of symMap.values()) {
        for (const cell of posMap.values()) out.push({ ...cell });
      }
    }
    out.sort(
      (a, b) =>
        a.bucketStartMs - b.bucketStartMs ||
        a.symbol.localeCompare(b.symbol) ||
        a.position - b.position,
    );
    return out;
  }

  /**
   * Per-cell delta between two buckets — used to surface drift alerts.
   *
   * Returns a row for every (symbol, position) seen in either bucket.
   * Cells unique to one side report the other side's `rtp` as 0.
   * Sorted by `|absDelta|` descending so the largest mover is first.
   */
  compareBuckets(bucketA: number, bucketB: number): Heatmap3dCompareResult[] {
    const flatten = (b: number): Map<string, Heatmap3dCell> => {
      const out = new Map<string, Heatmap3dCell>();
      const symMap = this.grid.get(b);
      if (symMap === undefined) return out;
      for (const [sym, posMap] of symMap.entries()) {
        for (const [pos, cell] of posMap.entries()) {
          out.set(`${sym}|${pos}`, cell);
        }
      }
      return out;
    };
    const a = flatten(bucketA);
    const b = flatten(bucketB);
    const keys = new Set<string>([...a.keys(), ...b.keys()]);
    const rows: Heatmap3dCompareResult[] = [];
    for (const k of keys) {
      const [sym, posStr] = k.split('|');
      const pos = Number(posStr);
      const cellA = a.get(k);
      const cellB = b.get(k);
      const rtpA = cellA?.rtp ?? 0;
      const rtpB = cellB?.rtp ?? 0;
      const absDelta = rtpB - rtpA;
      const relDelta = rtpA !== 0 ? absDelta / rtpA : null;
      rows.push({ symbol: sym, position: pos, rtpA, rtpB, absDelta, relDelta });
    }
    rows.sort((x, y) => Math.abs(y.absDelta) - Math.abs(x.absDelta));
    return rows;
  }

  /**
   * Dense tensor view of the cube. Useful for ML pipelines or bulk
   * statistical reductions. Returns shape `[bucketCount, symbols, positions]`
   * filled with `rtp` values; missing cells are `0`.
   *
   * `symbols` is the sorted union of touched symbols; `positions` is
   * `[0..maxTouchedPosition]`.
   */
  toDenseTensor(): {
    buckets: number[];
    symbols: string[];
    positions: number[];
    rtpTensor: number[][][];
  } {
    const buckets = this.buckets();
    const symbolSet = new Set<string>();
    let maxPos = -1;
    for (const symMap of this.grid.values()) {
      for (const [sym, posMap] of symMap.entries()) {
        symbolSet.add(sym);
        for (const pos of posMap.keys()) if (pos > maxPos) maxPos = pos;
      }
    }
    const symbols = Array.from(symbolSet).sort();
    const positions = maxPos < 0 ? [] : Array.from({ length: maxPos + 1 }, (_, i) => i);
    const rtpTensor: number[][][] = buckets.map((b) =>
      symbols.map((s) =>
        positions.map((p) => this.grid.get(b)?.get(s)?.get(p)?.rtp ?? 0),
      ),
    );
    return { buckets, symbols, positions, rtpTensor };
  }
}
