/**
 * Jackpot Manager — Faza 5.
 *
 * Manages multi-tier jackpot pools (fixed, progressive, pooled) for the
 * IR-native simulator. Tracks contributions, evaluates trigger conditions,
 * handles payouts with correct pool reset semantics, and provides metrics
 * for the PAR sheet generator.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type JackpotKind = 'fixed' | 'progressive' | 'pooled';

export interface JackpotTrigger {
  kind: 'random_pick' | 'win_multiplier_threshold' | 'hold_and_win_full' | 'symbol_combo';
  /** Hit probability per spin — used by random_pick and symbol_combo. */
  probability?: number;
  /** Minimum win multiplier required — used by win_multiplier_threshold. */
  min_win_x?: number;
}

export interface JackpotTierConfig {
  id: string;
  name: string;
  kind: JackpotKind;
  trigger: JackpotTrigger;
  /** Starting / reset value in bet multiples. */
  seed_amount_x: number;
  /** Fraction of wager contributed to pool each spin (progressive/pooled only). */
  contribution_rate?: number;
  /** Optional pool cap — contributions stop when pool reaches this. */
  cap_x?: number;
  /** Pool group id — pooled tiers sharing the same pool_id share a pool. */
  pool_id?: string;
}

export interface JackpotHit {
  tierId: string;
  /** Payout in bet multiples. */
  payout: number;
  /** Pool value at the moment of the hit (equals payout for progressive/pooled). */
  poolValueAtHit: number;
}

export interface JackpotTierState {
  config: JackpotTierConfig;
  currentPool: number;
  totalHits: number;
  totalPaid: number;
  totalContributed: number;
}

export interface JackpotMetrics {
  id: string;
  name: string;
  kind: JackpotKind;
  hits: number;
  /** Average spins between hits. Infinity if never hit. */
  avgInterval: number;
  totalPaidX: number;
  totalContributedX: number;
  currentPoolX: number;
  /** Fraction (not percent) — totalPaid / totalSpins. */
  contributionRtp: number;
}

// ─── JackpotManager ────────────────────────────────────────────────────────

export class JackpotManager {
  private readonly states: JackpotTierState[];
  private totalSpins: number = 0;

  constructor(configs: JackpotTierConfig[]) {
    this.states = configs.map((config) => ({
      config,
      currentPool: config.seed_amount_x,
      totalHits: 0,
      totalPaid: 0,
      totalContributed: 0,
    }));
  }

  /**
   * Contribute to all progressive and pooled tiers for one spin wager.
   * Contributions respect the optional cap: if the pool is already at or
   * above `cap_x`, no further contribution is made to that tier.
   */
  contributeAll(wager: number): void {
    for (const state of this.states) {
      const { kind, contribution_rate, cap_x, seed_amount_x } = state.config;
      if (kind === 'fixed') continue;
      if (!contribution_rate || contribution_rate <= 0) continue;

      const contribution = wager * contribution_rate;
      const cap = cap_x ?? Infinity;

      // Only grow the pool if we are still below the cap.
      if (state.currentPool < cap) {
        const headroom = cap - state.currentPool;
        const actual = Math.min(contribution, headroom);
        state.currentPool = Math.max(seed_amount_x, state.currentPool + actual);
        state.totalContributed += actual;
      }
    }
  }

  /**
   * Evaluate all tier triggers for the current spin.
   *
   * `rngVals[i]` is a pre-drawn value in [0, 1) for tier i (index
   * corresponds to the order of configs passed to the constructor).
   * `winMult` is the total win multiplier for this spin (bet multiples).
   *
   * Returns an array of JackpotHit for every triggered tier. Multiple tiers
   * can trigger on the same spin.
   */
  onSpin(rngVals: number[], winMult: number): JackpotHit[] {
    const hits: JackpotHit[] = [];

    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      if (!state) continue;
      const rng = rngVals[i] ?? 1; // default 1 → no hit when missing
      const { kind: trigKind, probability, min_win_x } = state.config.trigger;

      let triggered = false;

      switch (trigKind) {
        case 'random_pick':
        case 'symbol_combo':
          triggered = probability !== undefined && rng < probability;
          break;
        case 'win_multiplier_threshold':
          triggered = min_win_x !== undefined && winMult >= min_win_x;
          break;
        case 'hold_and_win_full':
          // Only triggered via recordHnwHit(); never from onSpin().
          triggered = false;
          break;
      }

      if (triggered) {
        const hit = this._payoutTier(state);
        hits.push(hit);
      }
    }

    return hits;
  }

  /**
   * Force-record a Hold-and-Win full-grid hit for the tier identified by
   * `tierId`. Returns the hit or null if the tier id is not found or its
   * trigger kind is not `hold_and_win_full`.
   */
  recordHnwHit(tierId: string): JackpotHit | null {
    const state = this.states.find((s) => s.config.id === tierId);
    if (!state) return null;
    if (state.config.trigger.kind !== 'hold_and_win_full') return null;
    return this._payoutTier(state);
  }

  /** Increment the global spin counter. Call once per base-game spin. */
  recordSpin(): void {
    this.totalSpins += 1;
  }

  /** Return a metrics snapshot for every tier — used by PAR sheet. */
  getMetrics(): JackpotMetrics[] {
    return this.states.map((state) => {
      const { config, totalHits, totalPaid, totalContributed, currentPool } = state;
      const avgInterval =
        totalHits > 0 ? this.totalSpins / totalHits : Infinity;
      const contributionRtp =
        this.totalSpins > 0 ? totalPaid / this.totalSpins : 0;

      return {
        id: config.id,
        name: config.name,
        kind: config.kind,
        hits: totalHits,
        avgInterval,
        totalPaidX: totalPaid,
        totalContributedX: totalContributed,
        currentPoolX: currentPool,
        contributionRtp,
      };
    });
  }

  /** Reset all pools to their seed amounts and clear hit/paid counters. */
  reset(): void {
    this.totalSpins = 0;
    for (const state of this.states) {
      state.currentPool = state.config.seed_amount_x;
      state.totalHits = 0;
      state.totalPaid = 0;
      state.totalContributed = 0;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _payoutTier(state: JackpotTierState): JackpotHit {
    const poolValueAtHit = state.currentPool;
    let payout: number;

    switch (state.config.kind) {
      case 'fixed':
        payout = state.config.seed_amount_x;
        // Fixed jackpot: pool does not change.
        break;
      case 'progressive':
      case 'pooled':
        payout = state.currentPool;
        // Reset pool to seed.
        state.currentPool = state.config.seed_amount_x;
        break;
    }

    state.totalHits += 1;
    state.totalPaid += payout;

    return { tierId: state.config.id, payout, poolValueAtHit };
  }
}

// ─── Analytical helper ─────────────────────────────────────────────────────

/**
 * Compute simple analytical metrics for a jackpot tier.
 *
 * Returns null for trigger kinds that are not analytically tractable
 * (`win_multiplier_threshold` and `hold_and_win_full`).
 *
 * For fixed jackpots the variance formula is simple:
 *   σ² = p × v² × (1 − p)
 * where v = seed_amount_x and p = probability.
 *
 * For progressive jackpots the pool at hit is not constant, so this
 * function uses the seed amount as a lower-bound proxy for the expected
 * payout — it will under-count progressive RTP when pools grow between
 * hits, but serves as a useful floor for PAR sheet planning.
 */
export function analyzeJackpot(config: JackpotTierConfig): {
  expectedRtp: number;
  expectedInterval: number;
  rtpStdDev: number;
} | null {
  const { trigger, seed_amount_x } = config;

  if (
    trigger.kind === 'win_multiplier_threshold' ||
    trigger.kind === 'hold_and_win_full'
  ) {
    return null;
  }

  const p = trigger.probability;
  if (p === undefined || p < 0 || p > 1) return null;

  // For probability === 0 we return well-defined zeros (never hits).
  if (p === 0) {
    return {
      expectedRtp: 0,
      expectedInterval: Infinity,
      rtpStdDev: 0,
    };
  }

  const v = seed_amount_x;

  // E[payout] × hit_probability (per spin)
  const expectedRtp = p * v;

  // E[spins between hits] = 1 / p (geometric distribution)
  const expectedInterval = 1 / p;

  // σ = √(p × v² × (1 − p))
  const rtpStdDev = Math.sqrt(p * v * v * (1 - p));

  return { expectedRtp, expectedInterval, rtpStdDev };
}
