/**
 * Faza 11.9 — Washington State centrally-determined draw pool.
 *
 * Washington State Gambling Commission Title 230 mandates a
 * "centrally determined" draw model for Class III tribal and lottery
 * terminals: prizes come from a server-side finite ticket pool, much
 * like Class II bingo (Faza 14.3), but with a few Washington-specific
 * twists:
 *
 *   1. **No pool reset within a session**: when a player begins a
 *      "playing session" (deposit → cash-out), they're allocated a
 *      slice of the pool. If the slice drains mid-session the engine
 *      MUST refuse further plays, not draw from another slice.
 *   2. **State-tax pre-deduction**: the State takes a percentage of
 *      the prize before payout (typically 7-12% depending on game).
 *   3. **Mandatory near-miss reveal**: cosmetic reels must visualise
 *      the drawn outcome PLUS at least one "near-miss" alternative —
 *      this is the WSGC anti-deception rule (Title 230 Ch.07.040).
 *
 * This module extends the `ClassIIBingoCoordinator` model with the
 * three additions above. Internals re-use the same `BingoRng` and
 * `Ticket` types for compatibility.
 */

import type { BingoRng, Ticket } from './classIIBingoCoordinator.js';
import { ClassIIBingoCoordinator, InMemoryBingoPool } from './classIIBingoCoordinator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WashingtonSessionConfig {
  readonly sessionId: string;
  /** Tickets pre-allocated to this session. */
  readonly sliceTickets: ReadonlyArray<Ticket>;
  /** State tax rate (in [0, 1]). E.g. 0.075 = 7.5%. */
  readonly stateTaxRate: number;
}

export interface WashingtonDrawConfig {
  readonly coordinatorPoolId: string;
  /** RNG (must be GLI-11 grade). */
  readonly rng: BingoRng;
}

export interface WashingtonDrawResult {
  readonly ticket: Ticket;
  /** Gross prize multiplier as drawn. */
  readonly grossPrizeX: number;
  /** Tax withheld (multiplier units). */
  readonly taxWithheldX: number;
  /** Net prize multiplier paid to player. */
  readonly netPrizeX: number;
  /** Cosmetic "near-miss" ticket id surfaced for anti-deception. */
  readonly nearMissPotId?: number;
  /** Remaining ticket count in the session slice. */
  readonly sliceRemaining: number;
}

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * One Washington draw session. Slice is fixed at construct time and
 * does NOT reseed — once empty, the session refuses further plays.
 */
export class WashingtonSession {
  private readonly coord: ClassIIBingoCoordinator;
  private readonly cfg: WashingtonSessionConfig;
  private readonly drawCfg: WashingtonDrawConfig;
  private active = true;

  constructor(cfg: WashingtonSessionConfig, drawCfg: WashingtonDrawConfig) {
    if (!cfg.sessionId) {
      throw new RangeError('WashingtonSession: sessionId required');
    }
    if (cfg.sliceTickets.length === 0) {
      throw new RangeError('WashingtonSession: empty session slice');
    }
    if (!Number.isFinite(cfg.stateTaxRate) || cfg.stateTaxRate < 0 || cfg.stateTaxRate > 1) {
      throw new RangeError('WashingtonSession: stateTaxRate must be in [0, 1]');
    }
    this.cfg = cfg;
    this.drawCfg = drawCfg;
    this.coord = new ClassIIBingoCoordinator({
      poolId: `${drawCfg.coordinatorPoolId}-${cfg.sessionId}`,
      poolTemplate: cfg.sliceTickets,
      rng: drawCfg.rng,
      cycleResetMode: 'manual',
      backend: new InMemoryBingoPool(cfg.sliceTickets),
    });
  }

  /** Draw one ticket — applies tax + emits near-miss reveal. */
  draw(): WashingtonDrawResult {
    if (!this.active) {
      throw new Error(
        `WashingtonSession[${this.cfg.sessionId}]: session is closed; allocate a new slice`
      );
    }
    const snapBefore = this.coord.snapshot();
    if (snapBefore.remainingTickets === 0) {
      this.active = false;
      throw new Error(
        `WashingtonSession[${this.cfg.sessionId}]: slice exhausted; cannot draw`
      );
    }
    const drawn = this.coord.draw();
    const grossX = drawn.ticket.prizeX;
    const taxX = grossX * this.cfg.stateTaxRate;
    const netX = grossX - taxX;
    const nearMissPotId = this.pickNearMiss(drawn.ticket.id);
    // If THIS draw emptied the slice, mark session inactive — operator
    // must allocate a fresh session before further plays.
    const sliceRemaining = drawn.poolAfter.remainingTickets;
    if (sliceRemaining === 0) this.active = false;
    return {
      ticket: drawn.ticket,
      grossPrizeX: grossX,
      taxWithheldX: taxX,
      netPrizeX: netX,
      ...(nearMissPotId != null ? { nearMissPotId } : {}),
      sliceRemaining,
    };
  }

  isActive(): boolean {
    return this.active;
  }

  remaining(): number {
    return this.coord.snapshot().remainingTickets;
  }

  /** WSGC Title 230 Ch.07.040 — surface a "near-miss" cosmetic id. */
  private pickNearMiss(actualId: number): number | undefined {
    // Pick any other ticket id from the remaining slice as the
    // cosmetic near-miss reveal. Deterministic order: first id NOT
    // equal to actualId.
    for (const t of this.cfg.sliceTickets) {
      if (t.id !== actualId) return t.id;
    }
    return undefined;
  }
}
