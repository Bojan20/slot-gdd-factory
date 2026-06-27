/**
 * Cascade feature closed-form expected-value solver — Faza 6.
 *
 * Computes expected payout per base spin for a cascade (tumble/avalanche)
 * mechanic analytically, using a geometric-series model over chain depth.
 *
 * Model:
 *   - Chain 0: initial spin — always fires (probability 1).
 *   - Chain c (c ≥ 1): fires if and only if chain c-1 produced a win.
 *   - P(chain c fires) = p_win^c  (independent Bernoulli wins per chain)
 *   - P(exactly c chains total): geometric PMF truncated at maxChain.
 *
 * The multiplier at chain c is multiplierProgression[c] ?? 1.
 *
 * Expected payout per base spin:
 *   E[payout] = baseWinPerSpin × Σ_{c=0}^{maxChain} P(≥c chains) × m_c
 *             = baseWinPerSpin × Σ_{c=0}^{maxChain} p_win^c × m_c
 *
 * Note: chain 0 contributes p_win^0 = 1, meaning *every* spin contributes
 * m_0 × baseWinPerSpin in expected value regardless of whether there is a win.
 * The caller should set baseWinPerSpin = E[win per spin] = p_win × E[win|win],
 * so the chain 0 term automatically accounts for the loss probability.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CascadeConfig {
  /** P(winning spin) per chain step */
  baseWinProbability: number;
  /** E[win | winning spin] in bet multiples */
  baseWinPerSpin: number;
  /** feature.multiplier_progression (empty → all 1x) */
  multiplierProgression: number[];
  /** feature.max_chain */
  maxChain: number;
  replacement: 'drop' | 'refill_random' | 'fixed_strip';
}

export interface CascadeResult {
  /** avg chains per base spin (E[geometric series]) */
  expectedCascadeChains: number;
  /** total expected cascade payout per base spin */
  expectedPayoutPerSpin: number;
  /** ratio vs no-cascade scenario (with same p_win) */
  effectiveMultiplierBoost: number;
  /** P(exactly c chains) for c = 0, 1, ..., maxChain */
  chainProbabilities: number[];
}

// ─── Solver ────────────────────────────────────────────────────────────────

/**
 * Compute the multiplier for chain index c from the progression array.
 * Falls back to 1× if the progression is shorter than c+1.
 */
function getMultiplier(progression: number[], c: number): number {
  return (c < progression.length ? progression[c] : undefined) ?? 1;
}

/**
 * Solve cascade expected value analytically.
 *
 * P(exactly c chains):
 *   For c < maxChain: p_win^c * (1 - p_win)
 *   For c = maxChain: p_win^maxChain  (absorbing — game stops here regardless)
 *
 * P(≥ c chains) = p_win^c  for c ≤ maxChain
 *
 * E[payout] = baseWinPerSpin × Σ_{c=0}^{maxChain} p_win^c × m_c
 */
export function solveCascade(config: CascadeConfig): CascadeResult {
  const {
    baseWinProbability,
    baseWinPerSpin,
    multiplierProgression,
    maxChain,
  } = config;

  const p = Math.max(0, Math.min(1, baseWinProbability));
  const safeMax = Math.max(0, maxChain);

  // ── Chain probabilities ──────────────────────────────────────────────
  const chainProbabilities: number[] = new Array<number>(safeMax + 1).fill(0);
  for (let c = 0; c <= safeMax; c++) {
    if (c < safeMax) {
      chainProbabilities[c] = Math.pow(p, c) * (1 - p);
    } else {
      // c === maxChain: probability of reaching exactly maxChain (game stops)
      chainProbabilities[c] = Math.pow(p, c);
    }
  }

  // ── Expected cascade chains ──────────────────────────────────────────
  // E[cascade depth] = Σ_{c=0}^{maxChain} c × P(c chains)
  // = Σ_{c=0}^{maxChain-1} c × p^c × (1-p) + maxChain × p^maxChain
  let expectedCascadeChains = 0;
  for (let c = 0; c <= safeMax; c++) {
    expectedCascadeChains += c * (chainProbabilities[c] ?? 0);
  }

  // ── Expected payout ──────────────────────────────────────────────────
  // E[payout] = baseWinPerSpin × Σ_{c=0}^{maxChain} P(≥c chains) × m_c
  //           = baseWinPerSpin × Σ_{c=0}^{maxChain} p^c × m_c
  let weightedMultiplierSum = 0;
  for (let c = 0; c <= safeMax; c++) {
    const pAtLeastC = Math.pow(p, c);
    const mc = getMultiplier(multiplierProgression, c);
    weightedMultiplierSum += pAtLeastC * mc;
  }

  const expectedPayoutPerSpin = baseWinPerSpin * weightedMultiplierSum;

  // ── Effective multiplier boost ───────────────────────────────────────
  // Baseline (no cascade, all wins at m=1 for chain 0 only):
  //   baseline = baseWinPerSpin × p^0 × 1 = baseWinPerSpin
  // So boost = expectedPayoutPerSpin / baseWinPerSpin  (if baseWinPerSpin > 0)
  // This equals weightedMultiplierSum.
  //
  // For comparison vs "no-cascade scenario" (just one spin at 1×):
  //   effectiveMultiplierBoost = expectedPayoutPerSpin / (baseWinPerSpin * p)
  //                            = weightedMultiplierSum / p  (if p > 0)
  // We follow the spec: ratio vs no-cascade scenario which has just 1 chain
  // at 1×: effective = expectedPayout / (baseWinPerSpin × p_win).
  let effectiveMultiplierBoost: number;
  if (p > 0 && baseWinPerSpin > 0) {
    const noCascadeBaseline = baseWinPerSpin * p;
    effectiveMultiplierBoost = expectedPayoutPerSpin / noCascadeBaseline;
  } else {
    effectiveMultiplierBoost = weightedMultiplierSum; // degenerate case
  }

  return {
    expectedCascadeChains,
    expectedPayoutPerSpin,
    effectiveMultiplierBoost,
    chainProbabilities,
  };
}
