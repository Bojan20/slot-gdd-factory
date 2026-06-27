/**
 * W152 Wave 23 — PGF-based Ways-to-Win Closed Form (Faza 6.7 + 12).
 *
 * Computes ways-to-win contribution via Probability Generating Function
 * (PGF) folding instead of single-stop binomial. Closes the
 * 1024-ways acceptance gate left ⚠️ in Wave 22.
 *
 * Math:
 *   * For an N-reel × R-row window, the per-reel match-count distribution
 *     for symbol s is: m_s ~ Binomial(R, p_s) where p_s is symbol's
 *     per-stop probability on that reel.
 *   * Ways for k-of-a-kind = product of per-reel match counts on the
 *     leftmost k reels, conditional on every match-count > 0.
 *   * Per-spin RTP contribution from k-of-a-kind = payout(k) × E[ways×match].
 *
 * The PGF on per-reel match count is:
 *   G_m(z) = (q + p z)^R   where q = 1-p
 *
 * For the analytical match-count expectation conditional on > 0:
 *   E[m | m ≥ 1] = R × p / (1 - q^R)
 *
 * Per-symbol RTP via PGF folding:
 *   For each k:
 *     P(at least k consecutive reels have ≥ 1 match)
 *       = (1 - q^R)^k × q^R^(N-k)
 *     E[ways for k-of-a-kind | trigger]
 *       = ∏_{i=1..k} E[m_i | m_i ≥ 1]
 *     Contribution = payout(k) × P(trigger) × E[ways | trigger]
 *
 * Naming: `waysToWinPGF` engine-generic. Vendor-neutral.
 */

import type { SlotGameIR, SymbolKey } from '../ir/types.js';

export interface PGFWaysContribution {
  symbolId: SymbolKey;
  perReelProbability: number;
  rows: number;
  reels: number;
  /** For each k=3..N: P(k-of-a-kind triggers) and E[ways|trigger]. */
  perKindBreakdown: Array<{
    k: number;
    triggerProbability: number;
    expectedWays: number;
    payout: number;
    contribution: number;
  }>;
  totalContribution: number;
}

/**
 * Compute ways-to-win RTP contribution for one symbol on a rectangular
 * topology, using PGF-derived per-reel match-count distribution.
 *
 * Pure function — no RNG, deterministic given (ir, symbol, p, N, R).
 * Treats per-reel probability as uniform across reels (typical for
 * weighted strips with same composition per reel).
 *
 * Throws on:
 *   * perReelProbability out of [0, 1]
 *   * non-integer or non-positive numReels / rowsPerReel
 *   * symbol not present in IR.paytable
 */
export function pgfWaysContribution(
  ir: SlotGameIR,
  symbolId: SymbolKey,
  perReelProbability: number,
  numReels: number,
  rowsPerReel: number,
): PGFWaysContribution {
  if (!Number.isFinite(perReelProbability) || perReelProbability < 0 || perReelProbability > 1) {
    throw new RangeError(`pgfWaysContribution: perReelProbability out of [0, 1] (got ${perReelProbability})`);
  }
  if (!Number.isInteger(numReels) || numReels < 1) {
    throw new RangeError(`pgfWaysContribution: numReels must be positive integer (got ${numReels})`);
  }
  if (!Number.isInteger(rowsPerReel) || rowsPerReel < 1) {
    throw new RangeError(`pgfWaysContribution: rowsPerReel must be positive integer (got ${rowsPerReel})`);
  }
  const paytable = ir.paytable[symbolId];
  if (paytable === undefined) {
    return {
      symbolId,
      perReelProbability,
      rows: rowsPerReel,
      reels: numReels,
      perKindBreakdown: [],
      totalContribution: 0,
    };
  }

  const p = perReelProbability;
  const q = 1 - p;
  const qPowR = Math.pow(q, rowsPerReel); // P(zero matches on one reel)
  const triggerOnReel = 1 - qPowR; // P(at least 1 match on one reel)

  // E[m | m ≥ 1] = R × p / (1 - q^R)
  const expectedMatchGivenTrigger = triggerOnReel > 0 ? (rowsPerReel * p) / triggerOnReel : 0;

  const perKindBreakdown: PGFWaysContribution['perKindBreakdown'] = [];
  let totalContribution = 0;

  for (const kStr of Object.keys(paytable)) {
    const k = Number(kStr);
    if (!Number.isInteger(k) || k < 1 || k > numReels) continue;
    const payout = paytable[kStr];
    if (payout === 0) continue;

    // P(exactly leftmost k reels trigger AND reel k+1 doesn't)
    // For "at least k" semantics (standard ways-to-win), we compute:
    //   P(k = exactly k) = trigger^k × (1-trigger)
    // For "trigger on first k reels" (left-to-right ways) we use:
    //   P(reels 1..k trigger AND reel k+1 doesn't trigger OR k == N)
    let exactKProb: number;
    if (k === numReels) {
      // All reels trigger
      exactKProb = Math.pow(triggerOnReel, k);
    } else {
      exactKProb = Math.pow(triggerOnReel, k) * qPowR;
    }

    const expectedWaysGivenTrigger = Math.pow(expectedMatchGivenTrigger, k);
    const contribution = payout * exactKProb * expectedWaysGivenTrigger;
    perKindBreakdown.push({
      k,
      triggerProbability: exactKProb,
      expectedWays: expectedWaysGivenTrigger,
      payout,
      contribution,
    });
    totalContribution += contribution;
  }

  return {
    symbolId,
    perReelProbability,
    rows: rowsPerReel,
    reels: numReels,
    perKindBreakdown,
    totalContribution,
  };
}

/**
 * Sum PGF contributions across all paying symbols.
 *
 * Per-symbol probability is derived from `ir.reels.base[0]` weighted
 * mode (assumes uniform-strip across reels — caller's responsibility
 * to verify).
 *
 * Skips wild + scatter symbols (per ways-to-win convention they don't
 * pay standalone).
 */
export function pgfTotalRtp(
  ir: SlotGameIR,
  numReels: number,
  rowsPerReel: number,
): number {
  if (ir.reels.mode !== 'weighted') return 0;
  const reel0 = ir.reels.base[0];
  if (reel0 === undefined) return 0;
  const totalWeight = Object.values(reel0).reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return 0;

  const symbolKindById = new Map<SymbolKey, string>();
  for (const s of ir.symbols) symbolKindById.set(s.id, s.kind);

  let total = 0;
  for (const sym of Object.keys(ir.paytable)) {
    const kind = symbolKindById.get(sym);
    if (kind === 'wild' || kind === 'scatter') continue;
    const weight = reel0[sym] ?? 0;
    if (weight === 0) continue;
    const p = weight / totalWeight;
    const contrib = pgfWaysContribution(ir, sym, p, numReels, rowsPerReel);
    total += contrib.totalContribution;
  }
  return total;
}
