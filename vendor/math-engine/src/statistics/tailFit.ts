/**
 * W152 P2-15 — Max-win cap math + EVT tail fitting.
 *
 * Slot-game RTP distributions are heavy-tailed: a long sequence of small wins
 * sets the mode of the empirical distribution near zero, but the regulator
 * cares about the *tail* — what fraction of mass sits above a max-win cap,
 * what conditional payout would the cap clip away, and what does the EVT fit
 * suggest about the unobserved upper tail (max-win events too rare to land
 * in any reasonable MC sample).
 *
 * This module is the analytical layer above `src/statistics/variance.ts` and
 * provides two regulator-facing primitives:
 *
 *   1. `clipDistribution(wins, cap)`
 *      For an empirical win distribution (PMF over discrete payouts), return:
 *        - `rtpCapped`           — RTP after clipping payouts ≥ cap down to `cap`
 *        - `probabilityMassAbove` — Σ probabilities over wins ≥ cap
 *        - `conditionalMeanAbove` — E[win | win ≥ cap] (the *uncapped* mean)
 *      These are the three numbers regulators require on a PAR sheet to prove
 *      a max-win cap is not silently destroying RTP truth (KIMI W152 §3.16).
 *
 *   2. `fitParetoTail(samples, threshold)`
 *      Peaks-over-threshold (POT) MLE Pareto fit. Returns `(alpha, xm)` for
 *      the tail distribution `P(X > x | X > xm) = (xm/x)^alpha`. Lower
 *      `alpha` ⇒ heavier tail. Includes a Kolmogorov–Smirnov goodness-of-fit
 *      p-value (Monte-Carlo bootstrap, default 200 reps).
 *
 *   3. `evtTailQuantile(alpha, xm, q)`
 *      Inverse Pareto CDF: returns `x` such that `P(X > x) = q`. Used to
 *      project max-win cap pressure from a finite MC sample to the full
 *      distribution.
 *
 * Both primitives are pure functions over numeric arrays — no Decimal.js
 * dependency to keep them embeddable in MC inner loops.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** One entry in an empirical win distribution. */
export interface TailWinEntry {
  /** Payout value (bet multiples). */
  value: number;
  /** Probability mass at this value (or count — `clipDistribution` normalises). */
  probability: number;
}

export interface ClipResult {
  /** RTP after clipping payouts above `cap` down to `cap`. */
  rtpCapped: number;
  /** Σ probability for entries with `value > cap`. */
  probabilityMassAbove: number;
  /** E[win | win > cap]. NaN if no mass above the cap. */
  conditionalMeanAbove: number;
  /** RTP before clipping (Σ p_i × v_i across all entries). */
  rtpUncapped: number;
  /** RTP destroyed by the cap: rtpUncapped − rtpCapped. */
  rtpLost: number;
  /** Whether the cap was the binding constraint (probabilityMassAbove > 0). */
  capActive: boolean;
}

export interface ParetoFit {
  /** Tail index — lower means heavier tail. Always > 0. */
  alpha: number;
  /** Lower threshold (scale parameter, same as `threshold` arg). */
  xm: number;
  /** Sample count above the threshold. */
  tailCount: number;
  /** Goodness-of-fit Kolmogorov–Smirnov statistic. */
  ksStatistic: number;
  /** Bootstrap p-value for KS test (higher = better fit). */
  ksPValue: number;
}

// ─── clipDistribution ────────────────────────────────────────────────────────

/**
 * Clip an empirical win distribution at a max-win cap.
 *
 * Probabilities are normalised internally (so callers may pass un-normalised
 * counts or weights). The cap is applied as a strict inequality
 * (`value > cap` clipped, `value === cap` left untouched) to match the
 * "max-win = inclusive cap" wording used in UKGC SI 2025/215 and equivalent
 * regulator notices.
 */
export function clipDistribution(
  wins: ReadonlyArray<TailWinEntry>,
  cap: number,
): ClipResult {
  if (!Number.isFinite(cap) || cap < 0) {
    throw new Error(`clipDistribution: cap must be a non-negative finite number, got ${cap}`);
  }
  if (wins.length === 0) {
    return {
      rtpCapped: 0,
      rtpUncapped: 0,
      rtpLost: 0,
      probabilityMassAbove: 0,
      conditionalMeanAbove: Number.NaN,
      capActive: false,
    };
  }

  let totalP = 0;
  for (const w of wins) {
    if (!(w.probability >= 0)) {
      throw new Error(`clipDistribution: negative or NaN probability for value ${w.value}`);
    }
    totalP += w.probability;
  }
  if (totalP <= 0) {
    return {
      rtpCapped: 0,
      rtpUncapped: 0,
      rtpLost: 0,
      probabilityMassAbove: 0,
      conditionalMeanAbove: Number.NaN,
      capActive: false,
    };
  }

  let rtpUncapped = 0;
  let rtpCapped = 0;
  let massAbove = 0;
  let sumAbove = 0;
  for (const w of wins) {
    const p = w.probability / totalP;
    rtpUncapped += p * w.value;
    if (w.value > cap) {
      rtpCapped += p * cap;
      massAbove += p;
      sumAbove += p * w.value;
    } else {
      rtpCapped += p * w.value;
    }
  }
  const conditional = massAbove > 0 ? sumAbove / massAbove : Number.NaN;

  return {
    rtpUncapped,
    rtpCapped,
    rtpLost: rtpUncapped - rtpCapped,
    probabilityMassAbove: massAbove,
    conditionalMeanAbove: conditional,
    capActive: massAbove > 0,
  };
}

// ─── Pareto tail fit (POT MLE) ───────────────────────────────────────────────

/**
 * Maximum likelihood Pareto fit on samples above a threshold.
 *
 * Model: `P(X > x | X > xm) = (xm / x)^alpha` for `x ≥ xm`.
 * MLE estimator:
 *   `alpha_hat = n / Σ ln(x_i / xm)` for the n samples above the threshold.
 *
 * KS p-value is estimated by a small bootstrap (default 200 reps) — enough
 * to reject obviously-wrong fits without burning sim budget. Heavier-duty
 * goodness-of-fit (Anderson–Darling, Cramer–von Mises) is left to the
 * `stats.rs` Rust mirror where compute is cheaper.
 *
 * Throws if `threshold` is above the data maximum or fewer than 5 tail
 * samples survive (MLE on tiny tails is meaningless).
 */
export function fitParetoTail(
  samples: ReadonlyArray<number>,
  threshold: number,
  opts: { bootstrapReps?: number; bootstrapSeed?: number } = {},
): ParetoFit {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error(`fitParetoTail: threshold must be > 0, got ${threshold}`);
  }
  const tail: number[] = [];
  for (const s of samples) {
    if (Number.isFinite(s) && s > threshold) tail.push(s);
  }
  if (tail.length < 5) {
    throw new Error(
      `fitParetoTail: need at least 5 samples above threshold ${threshold}, got ${tail.length}`,
    );
  }

  let sumLog = 0;
  for (const v of tail) sumLog += Math.log(v / threshold);
  const alpha = tail.length / sumLog;
  if (!Number.isFinite(alpha) || alpha <= 0) {
    throw new Error(`fitParetoTail: degenerate MLE alpha=${alpha}`);
  }

  const ks = ksParetoStatistic(tail, alpha, threshold);

  const reps = opts.bootstrapReps ?? 200;
  const seed = opts.bootstrapSeed ?? 0xc0ffee;
  const pValue = bootstrapKsPValue(tail.length, alpha, threshold, ks, reps, seed);

  return {
    alpha,
    xm: threshold,
    tailCount: tail.length,
    ksStatistic: ks,
    ksPValue: pValue,
  };
}

// ─── EVT quantile inverse ────────────────────────────────────────────────────

/**
 * Inverse Pareto CDF — returns the win level `x` such that `P(X > x) = q`
 * under a fitted tail `(alpha, xm)`. For `q > 1` returns `xm`.
 */
export function evtTailQuantile(alpha: number, xm: number, q: number): number {
  if (!(alpha > 0)) throw new Error(`evtTailQuantile: alpha must be > 0, got ${alpha}`);
  if (!(xm > 0)) throw new Error(`evtTailQuantile: xm must be > 0, got ${xm}`);
  if (!(q > 0) || q > 1) return xm;
  return xm * Math.pow(q, -1 / alpha);
}

// ─── Internals ───────────────────────────────────────────────────────────────

/** KS statistic between empirical tail and fitted Pareto CDF. */
function ksParetoStatistic(
  tail: ReadonlyArray<number>,
  alpha: number,
  xm: number,
): number {
  const sorted = [...tail].sort((a, b) => a - b);
  const n = sorted.length;
  let dMax = 0;
  for (let i = 0; i < n; i++) {
    const x = sorted[i];
    const cdf = 1 - Math.pow(xm / x, alpha);
    const empLow = i / n;
    const empHigh = (i + 1) / n;
    const dLow = Math.abs(cdf - empLow);
    const dHigh = Math.abs(empHigh - cdf);
    if (dLow > dMax) dMax = dLow;
    if (dHigh > dMax) dMax = dHigh;
  }
  return dMax;
}

/**
 * Bootstrap KS p-value: draw `reps` synthetic samples from the fitted Pareto,
 * compute their KS statistics, and return the fraction ≥ observed `ks`.
 * Uses a Mulberry32-style PRNG for determinism.
 */
function bootstrapKsPValue(
  n: number,
  alpha: number,
  xm: number,
  observedKs: number,
  reps: number,
  seed: number,
): number {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let geCount = 0;
  for (let r = 0; r < reps; r++) {
    const synth: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.max(1e-12, 1 - next());
      synth[i] = xm * Math.pow(u, -1 / alpha);
    }
    const ksR = ksParetoStatistic(synth, alpha, xm);
    if (ksR >= observedKs) geCount += 1;
  }
  return geCount / reps;
}

// ─── Exposed internals (tests only) ──────────────────────────────────────────

export const __tailFitInternals = {
  ksParetoStatistic,
  bootstrapKsPValue,
};
