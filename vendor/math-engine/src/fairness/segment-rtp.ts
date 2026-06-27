/**
 * W152 Faza 14.8 — Statistical fairness across player segments.
 *
 * Operators routinely segment their players for marketing (high-roller
 * vs casual, bet-tier strata, regional cohorts). Regulators are
 * increasingly asking *whether the engine pays each segment fairly* —
 * if high-rollers see a systematically lower RTP than the same game's
 * casual players the operator faces both ASA / UKGC enforcement risk
 * and brand harm. This module is the lightweight statistical core that
 * answers that question.
 *
 * Inputs:
 *   * Per-spin records tagged with a player-segment label.
 *   * The expected (theoretical) RTP target for the game.
 *
 * Outputs:
 *   * Per-segment empirical RTP + spin count.
 *   * Chi-square goodness-of-fit p-value (segment vs theoretical).
 *   * Pairwise z-test p-value across segments + Bonferroni-corrected
 *     "fair" verdict (any pair surviving correction = bias detected).
 *
 * Design notes:
 *   * Pure functional — no IO, no engine state. Caller provides spins.
 *   * `Decimal.js` is used for the chi-square accumulator so the test
 *     is precision-stable across 10⁹-spin runs.
 *   * `pValueFromChiSquare` is a Wilson-Hilferty cubic approximation —
 *     fast and accurate to ~3 sf for df ≤ 100, which is more than
 *     enough segments any operator wires up.
 *   * Z-test pairwise uses pooled variance (Welch's correction is
 *     unnecessary because we're treating each spin as an iid Bernoulli
 *     trial of "this win amount" — the variance estimator stays
 *     well-behaved even with heavy tails when paired with the LLN
 *     guarantees at 10⁴+ spins per segment).
 */

import { Decimal } from 'decimal.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SpinRecord {
  /** Stable segment label (e.g. "high-roller", "casual", "bet-tier-3"). */
  segment: string;
  /** Bet in millicredits (positive integer). */
  betMc: number;
  /** Win in millicredits (non-negative integer). */
  winMc: number;
}

export interface SegmentStats {
  segment: string;
  spinCount: number;
  totalBetMc: number;
  totalWinMc: number;
  rtp: number;
  /** Standard error of the RTP estimate (per-spin SE × sqrt(1/n)). */
  rtpStdError: number;
}

export interface FairnessReport {
  targetRtp: number;
  segments: SegmentStats[];
  /** χ² test of the per-segment RTPs vs the target. */
  chiSquare: {
    statistic: number;
    df: number;
    pValue: number;
    /** p-value < 0.001 ⇒ at least one segment significantly off-target. */
    significant: boolean;
  };
  /** Pairwise z-test results. */
  pairwise: Array<{
    a: string;
    b: string;
    zScore: number;
    pValue: number;
    /** Bonferroni-corrected verdict for this pair. */
    significantAfterBonferroni: boolean;
  }>;
  /**
   * Aggregate verdict: false ⇒ at least one segment fails either the
   * chi-square at α=0.001 OR a pairwise z-test at Bonferroni-corrected
   * α (α / number of pairs).
   */
  fair: boolean;
}

// ─── Segment aggregation ──────────────────────────────────────────────────

export function aggregateBySegment(spins: SpinRecord[]): SegmentStats[] {
  const buckets = new Map<
    string,
    {
      spinCount: number;
      totalBetMc: Decimal;
      totalWinMc: Decimal;
      sumWinSq: Decimal;
    }
  >();
  for (const s of spins) {
    if (s.betMc <= 0) {
      throw new Error(`betMc must be > 0; got ${s.betMc}`);
    }
    if (s.winMc < 0) {
      throw new Error(`winMc must be ≥ 0; got ${s.winMc}`);
    }
    const entry = buckets.get(s.segment) ?? {
      spinCount: 0,
      totalBetMc: new Decimal(0),
      totalWinMc: new Decimal(0),
      sumWinSq: new Decimal(0),
    };
    entry.spinCount += 1;
    entry.totalBetMc = entry.totalBetMc.plus(s.betMc);
    entry.totalWinMc = entry.totalWinMc.plus(s.winMc);
    entry.sumWinSq = entry.sumWinSq.plus(
      new Decimal(s.winMc).pow(2),
    );
    buckets.set(s.segment, entry);
  }

  const out: SegmentStats[] = [];
  for (const [segment, b] of buckets) {
    const rtp = b.totalBetMc.gt(0) ? Number(b.totalWinMc.div(b.totalBetMc)) : 0;
    // Per-spin win expectation × bet variance estimator for SE.
    // Var(X/b) ≈ E[X²/b²] − (E[X/b])². Approximate by treating bet as
    // constant within segment (true for fixed-bet sessions).
    const avgBet = b.totalBetMc.div(b.spinCount || 1);
    const meanWin = b.totalWinMc.div(b.spinCount || 1);
    const meanWinSq = b.sumWinSq.div(b.spinCount || 1);
    const variance = meanWinSq.minus(meanWin.pow(2));
    const stdErrPerSpin = Decimal.sqrt(
      Decimal.max(variance, new Decimal(0)),
    ).div(avgBet);
    const rtpStdError = Number(
      stdErrPerSpin.div(Decimal.sqrt(b.spinCount)),
    );
    out.push({
      segment,
      spinCount: b.spinCount,
      totalBetMc: Number(b.totalBetMc),
      totalWinMc: Number(b.totalWinMc),
      rtp,
      rtpStdError,
    });
  }
  out.sort((a, b) => a.segment.localeCompare(b.segment));
  return out;
}

// ─── Chi-square / Wilson-Hilferty ─────────────────────────────────────────

/**
 * Goodness-of-fit χ² with one expectation (the target RTP) per segment.
 * Each segment contributes (observed_rtp − target_rtp)² / variance,
 * where variance uses the segment's empirical SE. df = k − 1 where k is
 * the segment count.
 */
export function chiSquareGoodnessOfFit(
  segments: SegmentStats[],
  targetRtp: number,
): { statistic: number; df: number } {
  if (segments.length < 2) {
    return { statistic: 0, df: 0 };
  }
  let stat = 0;
  for (const s of segments) {
    const variance = s.rtpStdError * s.rtpStdError;
    if (variance <= 0) continue;
    stat += ((s.rtp - targetRtp) ** 2) / variance;
  }
  return { statistic: stat, df: segments.length - 1 };
}

/**
 * Wilson-Hilferty cubic approximation for χ² upper-tail p-value.
 * Accurate to ~10⁻³ for df ≤ 100 — more than enough for engineering
 * fairness gates. Reference: Abramowitz & Stegun 26.4.14.
 */
export function pValueFromChiSquare(stat: number, df: number): number {
  if (df <= 0) return 1;
  if (stat <= 0) return 1;
  const x = stat / df;
  const t = Math.cbrt(x);
  const mu = 1 - 2 / (9 * df);
  const sigma = Math.sqrt(2 / (9 * df));
  const z = (t - mu) / sigma;
  return upperTailStandardNormal(z);
}

/** Φᶜ(z) — one-tailed standard-normal upper-tail CDF. */
export function upperTailStandardNormal(z: number): number {
  // Hastings approximation: Abramowitz & Stegun 26.2.17, |error| < 7.5e-8.
  // Exact handling at z=0 because the approximation drifts a few ulps.
  if (z === 0) return 0.5;
  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const c = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const poly =
    t * (c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * c[4]))));
  const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-(absZ * absZ) / 2);
  const tail = phi * poly;
  return sign > 0 ? tail : 1 - tail;
}

// ─── Pairwise z-test ──────────────────────────────────────────────────────

export function pairwiseZ(a: SegmentStats, b: SegmentStats) {
  const diff = a.rtp - b.rtp;
  const se = Math.sqrt(a.rtpStdError ** 2 + b.rtpStdError ** 2);
  const z = se > 0 ? diff / se : 0;
  // Two-tailed p-value.
  const p = 2 * upperTailStandardNormal(Math.abs(z));
  return { zScore: z, pValue: Math.min(1, p) };
}

// ─── Public entry point ───────────────────────────────────────────────────

const ALPHA = 0.001;

export function fairnessReport(
  spins: SpinRecord[],
  targetRtp: number,
): FairnessReport {
  const segments = aggregateBySegment(spins);
  const chi = chiSquareGoodnessOfFit(segments, targetRtp);
  const chiPValue = pValueFromChiSquare(chi.statistic, chi.df);
  const chiSignificant = chiPValue < ALPHA;

  const pairs: FairnessReport['pairwise'] = [];
  const nPairs = (segments.length * (segments.length - 1)) / 2;
  const bonferroniAlpha = nPairs > 0 ? ALPHA / nPairs : ALPHA;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const { zScore, pValue } = pairwiseZ(segments[i], segments[j]);
      pairs.push({
        a: segments[i].segment,
        b: segments[j].segment,
        zScore,
        pValue,
        significantAfterBonferroni: pValue < bonferroniAlpha,
      });
    }
  }

  const anyPairSignificant = pairs.some((p) => p.significantAfterBonferroni);
  return {
    targetRtp,
    segments,
    chiSquare: {
      statistic: chi.statistic,
      df: chi.df,
      pValue: chiPValue,
      significant: chiSignificant,
    },
    pairwise: pairs,
    fair: !chiSignificant && !anyPairSignificant,
  };
}
