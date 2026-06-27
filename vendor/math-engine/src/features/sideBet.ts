/**
 * Faza 4.9 — Side bet (orthogonal RTP track).
 *
 * A side bet is a wager placed alongside the main game that pays out
 * independently. Examples:
 *   - "Lightning bet" — pays multipliers when scatter symbols land.
 *   - "Ante bet" — boosts FS trigger rate AND adds a side payout.
 *   - "Hi-Lo guess" — post-spin card-prediction mini-game.
 *
 * The defining property: **side-bet RTP does not affect main-game RTP**.
 * The two streams are orthogonal — engine evaluates them in separate
 * accounting buckets, regulators see two distinct RTPs that can be
 * published independently.
 *
 * This module models the side bet as a discrete distribution over
 * "side outcomes", each with a (probability, payoutX) pair. Closed-
 * form RTP, hit rate, variance, and feature interactions are all pure
 * functions of that distribution.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** One possible side-bet outcome. */
export interface SideBetOutcome {
  /** Display label / id (must be unique within a config). */
  readonly id: string;
  /** Probability per side bet (in [0, 1]). Sum over all outcomes ≤ 1. */
  readonly probability: number;
  /** Payout multiplier on side bet (≥ 0). */
  readonly payoutX: number;
}

export interface SideBetConfig {
  /** ID of the side bet (e.g. 'lightning_bet', 'ante_boost'). */
  readonly id: string;
  /** Outcome distribution. Probabilities must sum to ≤ 1. */
  readonly outcomes: ReadonlyArray<SideBetOutcome>;
  /**
   * "Missing-probability" semantics: when `outcomes.probability` sum
   * doesn't reach 1, the remainder is the implicit lose-no-pay
   * outcome (payoutX = 0). When true (default), validation rejects
   * configs where sum > 1.
   */
  readonly normaliseRemainderAsLose?: boolean;
  /**
   * Optional eligibility predicate for jurisdictions. Side bets are
   * routinely banned in markets that classify them as "gamble" (UKGC SI
   * 2025/215, Netherlands KSA, etc.). Adapter integration goes through
   * the existing `jurisdiction.adapter` layer; this flag is documentation
   * only.
   */
  readonly prohibitedJurisdictions?: ReadonlyArray<string>;
}

/** RNG dependency — anything that emits a uniform float in [0, 1). */
export interface SideBetRng {
  random(): number;
}

export interface SideBetResolution {
  /** Outcome ID hit (or the implicit lose id `'__lose__'`). */
  readonly outcomeId: string;
  /** Payout multiplier on the side bet stake. */
  readonly payoutX: number;
  /** Side-bet credit (= sideBetStake × payoutX). */
  readonly creditMinor: number;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const IMPLICIT_LOSE_ID = '__lose__';

function validate(cfg: SideBetConfig): void {
  if (!cfg.id || typeof cfg.id !== 'string') {
    throw new RangeError('SideBetConfig: id required');
  }
  if (!cfg.outcomes || cfg.outcomes.length === 0) {
    throw new RangeError('SideBetConfig: at least one outcome required');
  }
  const seen = new Set<string>();
  let pSum = 0;
  for (const o of cfg.outcomes) {
    if (!o.id || typeof o.id !== 'string') {
      throw new RangeError('SideBetConfig: every outcome must have an id');
    }
    if (o.id === IMPLICIT_LOSE_ID) {
      throw new RangeError(
        `SideBetConfig: outcome id "${IMPLICIT_LOSE_ID}" is reserved`
      );
    }
    if (seen.has(o.id)) {
      throw new RangeError(`SideBetConfig: duplicate outcome id "${o.id}"`);
    }
    seen.add(o.id);
    if (!Number.isFinite(o.probability) || o.probability < 0 || o.probability > 1) {
      throw new RangeError(
        `SideBetConfig: outcome ${o.id} probability must be in [0,1]`
      );
    }
    if (!Number.isFinite(o.payoutX) || o.payoutX < 0) {
      throw new RangeError(`SideBetConfig: outcome ${o.id} payoutX must be ≥ 0`);
    }
    pSum += o.probability;
  }
  if (pSum > 1 + 1e-9) {
    throw new RangeError(
      `SideBetConfig: outcome probabilities sum to ${pSum.toFixed(6)} > 1`
    );
  }
}

// ─── Closed-form RTP ──────────────────────────────────────────────────────────

/**
 * Side-bet RTP = Σ p_i × payoutX_i. (lose outcome has payoutX = 0 so
 * it contributes nothing.)
 */
export function sideBetRtp(cfg: SideBetConfig): number {
  validate(cfg);
  let s = 0;
  for (const o of cfg.outcomes) s += o.probability * o.payoutX;
  return s;
}

/** Hit rate = Σ probability of outcomes with payoutX > 0. */
export function sideBetHitRate(cfg: SideBetConfig): number {
  validate(cfg);
  let s = 0;
  for (const o of cfg.outcomes) {
    if (o.payoutX > 0) s += o.probability;
  }
  return s;
}

/** Variance of side-bet payoutX. */
export function sideBetVariance(cfg: SideBetConfig): number {
  validate(cfg);
  const rtp = sideBetRtp(cfg);
  let eX2 = 0;
  let pSum = 0;
  for (const o of cfg.outcomes) {
    eX2 += o.probability * o.payoutX * o.payoutX;
    pSum += o.probability;
  }
  // Add lose outcome's contribution (0² × residual probability = 0).
  void pSum;
  return eX2 - rtp * rtp;
}

// ─── Resolution (per-spin) ────────────────────────────────────────────────────

/**
 * Resolve a single side-bet spin. Uses inverse-CDF sampling on the
 * outcome distribution; if the uniform roll falls in the "remainder"
 * region, the implicit lose outcome is returned.
 */
export function resolveSideBet(input: {
  cfg: SideBetConfig;
  sideBetStakeMinor: number;
  rng: SideBetRng;
}): SideBetResolution {
  validate(input.cfg);
  if (!Number.isFinite(input.sideBetStakeMinor) || input.sideBetStakeMinor < 0) {
    throw new RangeError('resolveSideBet: sideBetStakeMinor must be ≥ 0');
  }
  const roll = input.rng.random();
  let acc = 0;
  for (const o of input.cfg.outcomes) {
    acc += o.probability;
    if (roll < acc) {
      return {
        outcomeId: o.id,
        payoutX: o.payoutX,
        creditMinor: Math.trunc(input.sideBetStakeMinor * o.payoutX),
      };
    }
  }
  // Fall-through ⇒ implicit lose.
  return {
    outcomeId: IMPLICIT_LOSE_ID,
    payoutX: 0,
    creditMinor: 0,
  };
}

/**
 * Orthogonality invariant — engine consumers call this to assert that
 * a side bet's existence does NOT touch main-game RTP. Returns true
 * by construction (this module never reads or mutates main-game
 * state); the regulator audit relies on this contract being enforced
 * at the engine-level.
 */
export function assertOrthogonal(cfg: SideBetConfig): boolean {
  validate(cfg);
  return true;
}
