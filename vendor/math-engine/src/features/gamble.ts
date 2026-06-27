/**
 * SLOT MATH EXACT - Gamble Feature Calculator
 *
 * Calculates the EV impact of gamble/risk features.
 * Gamble allows players to risk wins for higher returns.
 *
 * Common gamble types:
 * - Red/Black (50/50)
 * - Card suit (25% each)
 * - Ladder (progressive multipliers)
 *
 * RTP Impact:
 * - Fair gamble: RTP unchanged (but variance increases)
 * - House edge gamble: RTP decreases proportionally
 */

import { Decimal, dec, ZERO, ONE, safeDivide } from '../core/decimal.js';

/**
 * Gamble feature configuration for EV calculation
 */
export interface GambleFeatureConfig {
  /** Win probability (e.g., 0.5 for 50/50) */
  winProbability: number;
  /** Multiplier on win (e.g., 2x for double or nothing) */
  winMultiplier: number;
  /** Multiplier on loss (usually 0) */
  loseMultiplier?: number;
  /** Maximum number of gambles allowed */
  maxGambles: number;
  /** Maximum win cap during gamble (in bet multiplier) */
  maxWinCap?: number;
}

/**
 * Gamble result statistics
 */
export interface GambleStats {
  /** Expected value multiplier (EV / original win) */
  evMultiplier: Decimal;
  /** RTP contribution factor (multiply by base win RTP) */
  rtpFactor: Decimal;
  /** Probability of walking away with any win */
  survivalRate: Decimal;
  /** Expected number of gambles taken */
  expectedGambles: Decimal;
  /** House edge per gamble */
  houseEdge: Decimal;
}

/**
 * Calculate gamble EV multiplier
 *
 * For a fair gamble (e.g., 50% chance to double):
 * EV = 0.5 * 2x + 0.5 * 0x = 1x
 *
 * For house edge gamble (e.g., 45% chance to double):
 * EV = 0.45 * 2x + 0.55 * 0x = 0.9x
 */
export function calculateSingleGambleEV(config: GambleFeatureConfig): Decimal {
  const winProb = dec(config.winProbability);
  const loseProb = ONE.minus(winProb);
  const winMult = dec(config.winMultiplier);
  const loseMult = dec(config.loseMultiplier ?? 0);

  // EV = P(win) × win_mult + P(lose) × lose_mult
  return winProb.times(winMult).plus(loseProb.times(loseMult));
}

/**
 * Calculate house edge for a single gamble
 * House edge = 1 - EV
 */
export function calculateHouseEdge(config: GambleFeatureConfig): Decimal {
  const ev = calculateSingleGambleEV(config);
  return ONE.minus(ev);
}

/**
 * Calculate gamble RTP factor assuming players always gamble
 *
 * If a player always gambles up to maxGambles times:
 * RTP_factor = EV^maxGambles
 *
 * @param config Gamble configuration
 * @param participationRate Percentage of players who gamble (0-1)
 */
export function calculateGambleRTPFactor(
  config: GambleFeatureConfig,
  participationRate: number = 1
): Decimal {
  const singleEV = calculateSingleGambleEV(config);
  const maxGambles = config.maxGambles;

  // If no one gambles, RTP unchanged
  if (participationRate === 0 || maxGambles === 0) {
    return ONE;
  }

  // Calculate EV^n for n gambles
  let evPower = ONE;
  for (let i = 0; i < maxGambles; i++) {
    evPower = evPower.times(singleEV);
  }

  // Weighted average based on participation
  // participants get EV^n, non-participants get 1x
  const partRate = dec(participationRate);
  const nonPartRate = ONE.minus(partRate);

  return partRate.times(evPower).plus(nonPartRate);
}

/**
 * Calculate probability of surviving N gambles
 */
export function calculateSurvivalRate(
  config: GambleFeatureConfig,
  numGambles: number
): Decimal {
  const winProb = dec(config.winProbability);
  let survival = ONE;

  for (let i = 0; i < numGambles; i++) {
    survival = survival.times(winProb);
  }

  return survival;
}

/**
 * Calculate comprehensive gamble statistics
 */
export function calculateGambleStats(
  config: GambleFeatureConfig,
  participationRate: number = 1
): GambleStats {
  const singleEV = calculateSingleGambleEV(config);
  const houseEdge = calculateHouseEdge(config);
  const rtpFactor = calculateGambleRTPFactor(config, participationRate);
  const survivalRate = calculateSurvivalRate(config, config.maxGambles);

  // Expected number of gambles (simplified: assume all or nothing)
  const expectedGambles = dec(participationRate).times(config.maxGambles);

  // EV multiplier for those who gamble
  let evMultiplier = ONE;
  for (let i = 0; i < config.maxGambles; i++) {
    evMultiplier = evMultiplier.times(singleEV);
  }

  return {
    evMultiplier,
    rtpFactor,
    survivalRate,
    expectedGambles,
    houseEdge
  };
}

/**
 * Calculate optimal stopping point for gamble
 *
 * Returns the number of gambles that maximizes expected utility
 * given a risk aversion parameter.
 *
 * @param config Gamble configuration
 * @param riskAversion Risk aversion (0 = risk neutral, 1 = very risk averse)
 */
export function calculateOptimalGambles(
  config: GambleFeatureConfig,
  riskAversion: number = 0
): number {
  const singleEV = calculateSingleGambleEV(config);

  // For fair or better-than-fair gamble with no risk aversion, always gamble
  if (riskAversion === 0 && singleEV.greaterThanOrEqualTo(ONE)) {
    return config.maxGambles;
  }

  // For house edge gamble with no risk aversion, never gamble
  if (riskAversion === 0 && singleEV.lessThan(ONE)) {
    return 0;
  }

  // With risk aversion, use expected utility theory
  // This is a simplified model
  const riskFactor = dec(1 - riskAversion);

  let bestGambles = 0;
  let bestUtility = ONE;

  for (let n = 0; n <= config.maxGambles; n++) {
    let ev = ONE;
    let survival = ONE;

    for (let i = 0; i < n; i++) {
      ev = ev.times(singleEV);
      survival = survival.times(dec(config.winProbability));
    }

    // Utility = EV × survival^riskAversion
    const utility = ev.times(survival.pow(riskAversion));

    if (utility.greaterThan(bestUtility)) {
      bestUtility = utility;
      bestGambles = n;
    }
  }

  return bestGambles;
}

/**
 * Calculate gamble RTP impact on total game RTP
 *
 * @param baseGameRTP Base game RTP (e.g., 0.96)
 * @param config Gamble configuration
 * @param participationRate Percentage of wins that are gambled
 */
export function calculateGambleRTPImpact(
  baseGameRTP: number,
  config: GambleFeatureConfig,
  participationRate: number = 0.3  // Typically 30% of players gamble
): { adjustedRTP: Decimal; rtpChange: Decimal } {
  const baseRTP = dec(baseGameRTP);
  const rtpFactor = calculateGambleRTPFactor(config, participationRate);

  // Adjusted RTP = base RTP × gamble factor
  const adjustedRTP = baseRTP.times(rtpFactor);
  const rtpChange = adjustedRTP.minus(baseRTP);

  return { adjustedRTP, rtpChange };
}
