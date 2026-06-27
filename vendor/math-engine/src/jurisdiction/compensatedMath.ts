/**
 * W152 Wave 17 — Compensated math mode (UK AWP `cycleProgress` state machine).
 *
 * UK Amusement With Prizes (AWP) machines — Category B3, B3A, B4, C, D —
 * are regulated under UKGC LCCP plus the Gambling Act 2005 (sched 13). A
 * defining feature: outcomes must converge to a *promised* RTP within a
 * known **finite cycle** of plays, not just "asymptotically over infinite
 * spins" the way digital RNG slots do. Operators publish e.g. "this AWP
 * pays back 70 % over a 10 000-game cycle, with maximum cumulative
 * deviation ≤ 4 %". An auditor can pull the machine, replay every spin
 * since the last cycle reset, and verify the math.
 *
 * The IR layer needs a state machine that:
 *   1. Tracks current cycle progress: spins played, cumulative bet,
 *      cumulative payout.
 *   2. Computes realised RTP and deviation from target.
 *   3. Emits "compensation hint" — how much the next N spins should
 *      under/over-pay to bring the cycle back inside tolerance.
 *   4. Resets at cycle boundary (configurable: by spin count or by
 *      a calendar trigger like daily UTC reset for venue closing).
 *
 * Engine integration is a *hint*, not an enforcement: this module never
 * touches RNG, never modifies a paytable, never returns a forced symbol.
 * It just publishes the deviation signal. A jurisdiction-aware feature
 * can opt into reading the signal and biasing nudges, multipliers, or
 * the next-spin payout cap accordingly. UKGC permits this for AWP
 * categories. For RNG slots in any RNG-mandated jurisdiction (UK
 * online, MGA, GLI-19) the signal MUST be ignored — the validator
 * already gates feature classes per profile.
 *
 * State persistence:
 *   * `serialize()` / `deserialize()` produce JSON round-trips so a
 *     daily ledger can be saved and re-loaded between sessions.
 *   * `resetCycle()` zeroes the counters and bumps the cycle id —
 *     the auditor's anchor point.
 */

export interface CompensatedMathConfig {
  /** Target RTP for the cycle (0–1, e.g. 0.70 for 70 %). */
  targetRtp: number;
  /** Hard cap on |realisedRtp − targetRtp| at end-of-cycle. */
  maxDeviationAbs: number;
  /** Cycle length in spins. Cycle resets after N spins. */
  cycleLengthSpins: number;
  /** Optional hard floor on stakeMinor — refuse to advance if 0. */
  minStakeMinor?: number;
}

export interface CompensatedMathState {
  cycleId: number;
  spinsInCycle: number;
  cumulativeBetMinor: number;
  cumulativePayoutMinor: number;
  /** Live realised RTP — `cumulativePayout / cumulativeBet`, 0 if no bet. */
  realisedRtp: number;
  /** Signed deviation from target — positive = over-paying. */
  deviation: number;
  /** Spins remaining before mandatory cycle reset. */
  spinsRemaining: number;
}

/**
 * Compensation hint emitted after each spin. A consumer of the signal
 * can scale the next batch of spins' payout cap up or down.
 *
 * `direction`:
 *   * `over_paying`     — realisedRtp > targetRtp + maxDeviationAbs.
 *                         Suggest reducing payouts.
 *   * `under_paying`    — realisedRtp < targetRtp − maxDeviationAbs.
 *                         Suggest topping up payouts.
 *   * `within_band`     — no compensation needed.
 *
 * `urgency` in [0, 1] grows linearly as |deviation| approaches the cap;
 * 0 = no concern, 1 = at the cap right now.
 */
export interface CompensationHint {
  direction: 'over_paying' | 'under_paying' | 'within_band';
  urgency: number;
  deviation: number;
  remainingBudget: number;
}

export class CompensatedMathStateMachine {
  private readonly cfg: CompensatedMathConfig;
  private state: CompensatedMathState;

  constructor(cfg: CompensatedMathConfig, initialState?: Partial<CompensatedMathState>) {
    if (cfg.targetRtp < 0 || cfg.targetRtp > 1.5) {
      throw new RangeError(`CompensatedMath: targetRtp out of range (got ${cfg.targetRtp})`);
    }
    if (cfg.maxDeviationAbs < 0 || cfg.maxDeviationAbs > 1) {
      throw new RangeError(`CompensatedMath: maxDeviationAbs out of [0, 1] (got ${cfg.maxDeviationAbs})`);
    }
    if (!Number.isInteger(cfg.cycleLengthSpins) || cfg.cycleLengthSpins <= 0) {
      throw new RangeError(`CompensatedMath: cycleLengthSpins must be positive integer (got ${cfg.cycleLengthSpins})`);
    }
    this.cfg = cfg;
    this.state = {
      cycleId: initialState?.cycleId ?? 0,
      spinsInCycle: initialState?.spinsInCycle ?? 0,
      cumulativeBetMinor: initialState?.cumulativeBetMinor ?? 0,
      cumulativePayoutMinor: initialState?.cumulativePayoutMinor ?? 0,
      realisedRtp: initialState?.realisedRtp ?? 0,
      deviation: initialState?.deviation ?? 0,
      spinsRemaining: cfg.cycleLengthSpins - (initialState?.spinsInCycle ?? 0),
    };
  }

  /**
   * Record one spin's bet + payout. Returns the post-spin compensation
   * hint. Caller decides how (or whether) to act on it.
   *
   * Throws if the cycle would overflow — caller should call `resetCycle()`
   * first when `spinsRemaining === 0`.
   */
  recordSpin(betMinor: number, payoutMinor: number): CompensationHint {
    if (!Number.isFinite(betMinor) || !Number.isFinite(payoutMinor)) {
      throw new TypeError(`CompensatedMath.recordSpin: bet/payout must be finite numbers`);
    }
    if (betMinor < 0 || payoutMinor < 0) {
      throw new RangeError(`CompensatedMath.recordSpin: bet/payout must be non-negative`);
    }
    if (this.cfg.minStakeMinor !== undefined && betMinor < this.cfg.minStakeMinor) {
      throw new RangeError(
        `CompensatedMath.recordSpin: bet ${betMinor} below minStakeMinor ${this.cfg.minStakeMinor}`,
      );
    }
    if (this.state.spinsInCycle >= this.cfg.cycleLengthSpins) {
      throw new Error(
        `CompensatedMath.recordSpin: cycle ${this.state.cycleId} is full (${this.state.spinsInCycle}/${this.cfg.cycleLengthSpins}). Call resetCycle() first.`,
      );
    }
    this.state.spinsInCycle += 1;
    this.state.cumulativeBetMinor += betMinor;
    this.state.cumulativePayoutMinor += payoutMinor;
    this.state.spinsRemaining = this.cfg.cycleLengthSpins - this.state.spinsInCycle;
    if (this.state.cumulativeBetMinor > 0) {
      this.state.realisedRtp = this.state.cumulativePayoutMinor / this.state.cumulativeBetMinor;
    } else {
      this.state.realisedRtp = 0;
    }
    this.state.deviation = this.state.realisedRtp - this.cfg.targetRtp;
    return this.computeHint();
  }

  private computeHint(): CompensationHint {
    const absDev = Math.abs(this.state.deviation);
    const cap = this.cfg.maxDeviationAbs;
    const urgency = cap > 0 ? Math.min(1, absDev / cap) : 0;
    let direction: CompensationHint['direction'];
    if (this.state.deviation > cap) direction = 'over_paying';
    else if (this.state.deviation < -cap) direction = 'under_paying';
    else direction = 'within_band';

    // remainingBudget = how much MORE we can over- or under-pay before
    // hitting the deviation cap, expressed in minor units of bet.
    // Useful for downstream "how much win can the next spin emit before
    // we breach the cap?" reasoning. Always non-negative.
    const remainingBudget =
      Math.max(0, cap - absDev) * Math.max(this.state.cumulativeBetMinor, 1);

    return {
      direction,
      urgency,
      deviation: this.state.deviation,
      remainingBudget,
    };
  }

  /** Snapshot of the current cycle state. Returns a copy. */
  snapshot(): CompensatedMathState {
    return { ...this.state };
  }

  /** Begin a new cycle — bumps `cycleId`, zeroes counters. */
  resetCycle(): void {
    this.state = {
      cycleId: this.state.cycleId + 1,
      spinsInCycle: 0,
      cumulativeBetMinor: 0,
      cumulativePayoutMinor: 0,
      realisedRtp: 0,
      deviation: 0,
      spinsRemaining: this.cfg.cycleLengthSpins,
    };
  }

  /** Persist state for cross-session ledger. */
  serialize(): { config: CompensatedMathConfig; state: CompensatedMathState } {
    return { config: this.cfg, state: this.snapshot() };
  }

  /** Re-hydrate from persisted state. */
  static deserialize(persisted: {
    config: CompensatedMathConfig;
    state: CompensatedMathState;
  }): CompensatedMathStateMachine {
    return new CompensatedMathStateMachine(persisted.config, persisted.state);
  }

  /**
   * End-of-cycle audit verdict — `true` iff the cycle finished within
   * the deviation cap. Designed to be called after the last spin of a
   * cycle but BEFORE `resetCycle()`. Returns `null` if cycle isn't
   * complete yet (caller called too early).
   */
  cycleVerdict(): { passed: boolean; cycleId: number; finalDeviation: number } | null {
    if (this.state.spinsInCycle < this.cfg.cycleLengthSpins) return null;
    const passed = Math.abs(this.state.deviation) <= this.cfg.maxDeviationAbs;
    return {
      passed,
      cycleId: this.state.cycleId,
      finalDeviation: this.state.deviation,
    };
  }
}
