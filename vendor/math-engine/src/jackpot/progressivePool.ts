/**
 * W152 Wave 20 — Progressive Pool Math (Faza 15.C.4).
 *
 * Wide-area progressive (WAP) jackpot pool modeling. Pokriva:
 *   * Seed value (initial pool reset value)
 *   * Per-spin contribution rate (% of bet → pool)
 *   * Pool growth simulation
 *   * RTP contribution from pool seed AND from pool growth
 *   * Reset semantics (drop to seed on hit)
 *   * Multi-tier pool (mini/minor/major/grand) sa per-tier hit-rate
 *
 * Formulas (Cabot & Hannum 2002 § "Wide-Area Progressives"):
 *   * Long-run pool RTP = `contributionRate + (seed / averageHitInterval)`
 *   * Average pool size at hit = `seed + contributionRate × bet × meanSpinsToHit`
 *   * Total game RTP contribution from progressive = pool RTP
 *
 * Naming policy: `progressivePool` engine-generic. Vendor-specific
 * implementations exist under different proprietary names per
 * `docs/glossary.md`.
 *
 * Pure module — no I/O, no clock, no RNG. Deterministic.
 */

export interface ProgressiveTierConfig {
  /** Tier identifier (free-form: e.g. 'mini', 'minor', 'major', 'grand'). */
  tierId: string;
  /** Seed value (pool resets here on hit). */
  seedValue: number;
  /** Fraction of bet contributed per spin (e.g. 0.005 = 0.5%). */
  contributionRate: number;
  /** Per-spin hit probability (e.g. 1 / 100_000). */
  perSpinHitProbability: number;
  /** Optional cap (must-hit-by). */
  mustHitByMax?: number;
}

export interface ProgressivePoolSnapshot {
  tierId: string;
  currentValue: number;
  totalContributionsReceived: number;
  totalHitsPaid: number;
  totalAmountPaidOut: number;
  spinsSinceLastHit: number;
}

export interface ProgressiveContributionEvent {
  kind: 'contribution';
  tierId: string;
  betAmount: number;
  contributedAmount: number;
}

export interface ProgressiveHitEvent {
  kind: 'hit';
  tierId: string;
  payoutValue: number;
  spinsSinceLastHit: number;
}

export type ProgressiveEvent = ProgressiveContributionEvent | ProgressiveHitEvent;

/**
 * Stateful pool — tracks one tier across spins. Use one instance per
 * tier. Operator wires per-spin `contribute()` + per-trigger `recordHit()`.
 */
export class ProgressivePool {
  private readonly cfg: ProgressiveTierConfig;
  private state: ProgressivePoolSnapshot;
  private readonly events: ProgressiveEvent[] = [];

  constructor(config: ProgressiveTierConfig, initialState?: Partial<ProgressivePoolSnapshot>) {
    if (config.seedValue < 0) {
      throw new RangeError(`ProgressivePool: seedValue must be >= 0`);
    }
    if (config.contributionRate < 0 || config.contributionRate > 1) {
      throw new RangeError(`ProgressivePool: contributionRate out of [0, 1]`);
    }
    if (config.perSpinHitProbability <= 0 || config.perSpinHitProbability > 1) {
      throw new RangeError(`ProgressivePool: perSpinHitProbability out of (0, 1]`);
    }
    if (config.mustHitByMax !== undefined && config.mustHitByMax <= config.seedValue) {
      throw new RangeError(`ProgressivePool: mustHitByMax must be > seedValue`);
    }
    this.cfg = config;
    this.state = {
      tierId: config.tierId,
      currentValue: initialState?.currentValue ?? config.seedValue,
      totalContributionsReceived: initialState?.totalContributionsReceived ?? 0,
      totalHitsPaid: initialState?.totalHitsPaid ?? 0,
      totalAmountPaidOut: initialState?.totalAmountPaidOut ?? 0,
      spinsSinceLastHit: initialState?.spinsSinceLastHit ?? 0,
    };
  }

  /** Contribute one spin's bet portion to the pool. */
  contribute(betAmount: number): ProgressiveContributionEvent {
    if (betAmount < 0 || !Number.isFinite(betAmount)) {
      throw new RangeError(`ProgressivePool.contribute: betAmount must be non-negative finite`);
    }
    const contributed = betAmount * this.cfg.contributionRate;
    this.state.currentValue += contributed;
    this.state.totalContributionsReceived += contributed;
    this.state.spinsSinceLastHit += 1;
    // Apply must-hit-by cap if exceeded
    if (this.cfg.mustHitByMax !== undefined && this.state.currentValue > this.cfg.mustHitByMax) {
      this.state.currentValue = this.cfg.mustHitByMax;
    }
    const event: ProgressiveContributionEvent = {
      kind: 'contribution',
      tierId: this.cfg.tierId,
      betAmount,
      contributedAmount: contributed,
    };
    this.events.push(event);
    return event;
  }

  /** Pay out the pool — caller indicates a hit happened. Pool resets to seed. */
  recordHit(): ProgressiveHitEvent {
    const payout = this.state.currentValue;
    const spinsSince = this.state.spinsSinceLastHit;
    this.state.currentValue = this.cfg.seedValue;
    this.state.totalHitsPaid += 1;
    this.state.totalAmountPaidOut += payout;
    this.state.spinsSinceLastHit = 0;
    const event: ProgressiveHitEvent = {
      kind: 'hit',
      tierId: this.cfg.tierId,
      payoutValue: payout,
      spinsSinceLastHit: spinsSince,
    };
    this.events.push(event);
    return event;
  }

  /** Snapshot state — returns a copy. */
  snapshot(): ProgressivePoolSnapshot {
    return { ...this.state };
  }

  /** Defensive copy of event log. */
  eventLog(): ProgressiveEvent[] {
    return this.events.slice();
  }

  /** Reset to fresh seed (test-only helper). */
  reset(): void {
    this.state = {
      tierId: this.cfg.tierId,
      currentValue: this.cfg.seedValue,
      totalContributionsReceived: 0,
      totalHitsPaid: 0,
      totalAmountPaidOut: 0,
      spinsSinceLastHit: 0,
    };
    this.events.length = 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Closed-form math
// ════════════════════════════════════════════════════════════════════════════

/**
 * Long-run RTP contribution from a single progressive tier.
 *
 * Formula: `RTP_pool = contributionRate + (seedValue × pHit / averageBet)`
 *   * `contributionRate` is the 100% of contribution returned over time.
 *   * `seedValue × pHit / averageBet` is the seed amortised over the
 *     interval between hits.
 *
 * Returns 0 if hits are deterministically impossible.
 */
export function poolRtpContribution(
  config: ProgressiveTierConfig,
  averageBet: number,
): number {
  if (averageBet <= 0) {
    throw new RangeError(`poolRtpContribution: averageBet must be > 0`);
  }
  return config.contributionRate + (config.seedValue * config.perSpinHitProbability) / averageBet;
}

/**
 * Expected pool size at the moment of hit (steady-state).
 *
 * Formula: `E[pool] = seed + contributionRate × averageBet × E[spinsToHit]`
 *   * `E[spinsToHit] = 1 / pHit` for geometric-distributed hits.
 */
export function expectedPoolSizeAtHit(config: ProgressiveTierConfig, averageBet: number): number {
  if (averageBet <= 0) {
    throw new RangeError(`expectedPoolSizeAtHit: averageBet must be > 0`);
  }
  const expectedSpinsToHit = 1 / config.perSpinHitProbability;
  return config.seedValue + config.contributionRate * averageBet * expectedSpinsToHit;
}

/**
 * Multi-tier roll-up: sum RTP contribution across all tiers.
 */
export function totalProgressiveRtp(
  tiers: ProgressiveTierConfig[],
  averageBet: number,
): number {
  return tiers.reduce((sum, tier) => sum + poolRtpContribution(tier, averageBet), 0);
}
