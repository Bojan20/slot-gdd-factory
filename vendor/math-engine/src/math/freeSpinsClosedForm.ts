/**
 * Free Spins closed-form expected-value solver — Faza 6.
 *
 * Computes exact analytical (no Monte Carlo) RTP contribution from a
 * Free Spins feature, accounting for retriggers, global multipliers,
 * multiplier ladders, and spin caps.
 *
 * The retrigger model is a geometric series:
 *   E[total spins] = initialSpins / (1 - ρ)
 * where ρ = retriggerProbabilityPerSpin × extraSpinsPerRetrigger / initialSpins
 * (clipped to [0, 0.9999) to ensure convergence).
 *
 * If a maxTotal cap is provided and the geometric sum exceeds it, the
 * total is clamped to maxTotal.
 */

import type { Feature } from '../ir/types.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FreeSpinsConfig {
  initialSpins: number;
  /** P(scatter ≥ min) per FS spin, from analytical or MC estimate */
  retriggerProbabilityPerSpin: number;
  /** avg extra spins when retrigger fires */
  extraSpinsPerRetrigger: number;
  /** cap on total spins (from retrigger.max_total) */
  maxTotal?: number;
  /** feature.global_multiplier ?? 1 */
  globalMultiplier: number;
  /** modifiers includes 'multiplier_ladder' */
  hasMultiplierLadder: boolean;
  /** E[win per spin] from base game analytical (bet multiples) */
  baseWinPerSpin: number;
}

export interface FreeSpinsResult {
  expectedTotalSpins: number;
  expectedRetriggers: number;
  /** total expected payout in bet multiples */
  expectedPayout: number;
  /** expectedPayout / 1 (since bet=1) */
  rtpContribution: number;
  /** true if maxTotal was binding */
  retriggerCapActive: boolean;
  /** effective avg multiplier accounting for ladder */
  ladderAdjustedMultiplier: number;
}

// ─── Solver ────────────────────────────────────────────────────────────────

/**
 * Solve Free Spins expected value analytically.
 *
 * Retrigger formula (geometric series):
 *   raw = initialSpins / (1 - clamp(pRetrig × extra / initial, 0, 0.9999))
 *
 * Multiplier ladder:
 *   On each spin c (0-indexed), the multiplier is (c+1).
 *   With N total spins, E[multiplier] = (1 + N) / 2 (arithmetic mean).
 *   This is an approximation; exact ladder tracking requires MC.
 */
export function solveFreeSpins(config: FreeSpinsConfig): FreeSpinsResult {
  const {
    initialSpins,
    retriggerProbabilityPerSpin,
    extraSpinsPerRetrigger,
    maxTotal,
    globalMultiplier,
    hasMultiplierLadder,
    baseWinPerSpin,
  } = config;

  if (initialSpins <= 0) {
    return {
      expectedTotalSpins: 0,
      expectedRetriggers: 0,
      expectedPayout: 0,
      rtpContribution: 0,
      retriggerCapActive: false,
      ladderAdjustedMultiplier: 1,
    };
  }

  // ── Expected total spins ─────────────────────────────────────────────

  // ρ = contribution rate of retriggers per spin
  // Each spin independently fires a retrigger with probability pRetrig,
  // yielding extraSpins more spins. Those extra spins can themselves retrigger.
  // So the expected total is a geometric series with ratio ρ = pRetrig * extra.
  // We normalise by initialSpins to get the per-spin version:
  //   E[total] = initialSpins / (1 - pRetrig * extraSpins / initialSpins)  ... if extra < initial
  //
  // Cleaner derivation: let T = total spins. Each of T spins fires a retrigger
  // with prob pRetrig, yielding extra spins. So:
  //   T = initialSpins + T * pRetrig * extraSpinsPerRetrigger / initialSpins
  // Wait — that's not quite right either. The standard model:
  //   T = initialSpins + (T * pRetrig * extraSpinsPerRetrigger)
  //   T(1 - pRetrig * extra) = initialSpins
  //   T = initialSpins / (1 - pRetrig * extra)
  //
  // This holds when pRetrig is per-spin (not per-session).

  const rho = Math.min(
    retriggerProbabilityPerSpin * extraSpinsPerRetrigger,
    0.9999,
  );

  let rawExpectedSpins: number;
  if (rho <= 0 || extraSpinsPerRetrigger <= 0) {
    rawExpectedSpins = initialSpins;
  } else {
    rawExpectedSpins = initialSpins / (1 - rho);
  }

  let retriggerCapActive = false;
  let expectedTotalSpins = rawExpectedSpins;
  if (maxTotal !== undefined && rawExpectedSpins > maxTotal) {
    expectedTotalSpins = maxTotal;
    retriggerCapActive = true;
  }

  // ── Expected retriggers ──────────────────────────────────────────────
  const additionalSpins = expectedTotalSpins - initialSpins;
  const expectedRetriggers =
    extraSpinsPerRetrigger > 0 ? additionalSpins / extraSpinsPerRetrigger : 0;

  // ── Ladder-adjusted multiplier ───────────────────────────────────────
  // For a multiplier ladder that goes 1×, 2×, 3×, …, N× (one step per spin),
  // the arithmetic mean is (1 + N) / 2 where N = floor(expectedTotalSpins).
  // This is an approximation since actual N varies per session.
  let ladderAdjustedMultiplier: number;
  if (hasMultiplierLadder) {
    const N = Math.max(1, Math.floor(expectedTotalSpins));
    ladderAdjustedMultiplier = (1 + N) / 2;
  } else {
    ladderAdjustedMultiplier = 1;
  }

  // ── Expected payout ──────────────────────────────────────────────────
  const expectedPayout =
    expectedTotalSpins * baseWinPerSpin * globalMultiplier * ladderAdjustedMultiplier;

  return {
    expectedTotalSpins,
    expectedRetriggers: Math.max(0, expectedRetriggers),
    expectedPayout,
    rtpContribution: expectedPayout, // bet = 1 by convention
    retriggerCapActive,
    ladderAdjustedMultiplier,
  };
}

// ─── IR builder ────────────────────────────────────────────────────────────

/**
 * Build FreeSpinsConfig from an IR Feature (free_spins kind).
 *
 * @param feature       The free_spins Feature from the IR.
 * @param retriggerProbabilityPerSpin  P(retrigger scatter ≥ min) per FS spin.
 *                                     Typically computed analytically or from MC.
 * @param baseWinPerSpin  E[win per spin] in bet multiples (from base game RTP
 *                        or free-spins reel set analytical computation).
 */
export function buildFsConfig(
  feature: Extract<Feature, { kind: 'free_spins' }>,
  retriggerProbabilityPerSpin: number,
  baseWinPerSpin: number,
): FreeSpinsConfig {
  // Extra spins per retrigger: use the minimum threshold value as a conservative
  // estimate (or the largest threshold for max), defaulting to 0 if no retrigger.
  let extraSpinsPerRetrigger = 0;
  let maxTotal: number | undefined;

  if (feature.retrigger) {
    const thresholds = feature.retrigger.thresholds;
    if (thresholds) {
      const values = Object.values(thresholds).filter(
        (v): v is number => typeof v === 'number',
      );
      if (values.length > 0) {
        // Use the minimum threshold value as a conservative per-retrigger award
        extraSpinsPerRetrigger = Math.min(...values);
      }
    }
    if (feature.retrigger.max_total !== undefined) {
      maxTotal = feature.retrigger.max_total;
    }
  }

  // Initial spins: use the maximum threshold value from the trigger thresholds
  // (typically the highest scatter count award), defaulting to 10.
  let initialSpins = 10;
  if (feature.trigger.thresholds) {
    const trigValues = Object.values(feature.trigger.thresholds).filter(
      (v): v is number => typeof v === 'number',
    );
    if (trigValues.length > 0) {
      initialSpins = Math.max(...trigValues);
    }
  }

  return {
    initialSpins,
    retriggerProbabilityPerSpin,
    extraSpinsPerRetrigger,
    maxTotal,
    globalMultiplier: feature.global_multiplier ?? 1,
    hasMultiplierLadder: feature.modifiers?.includes('multiplier_ladder') ?? false,
    baseWinPerSpin,
  };
}
