/**
 * Faza 14.3 — Class II bingo coordinator.
 *
 * US Indian gaming (Class II) uses a fundamentally different evaluation
 * path than regular slots: prizes are drawn from a **finite, centrally-
 * determined ticket pool**, not generated independently per spin. The
 * slot reels are a *visualisation* of the underlying bingo draw, not
 * the source of randomness.
 *
 * # Why this is its own module
 *
 * Regular slot engines apply RNG-per-spin → reel weights → grid →
 * evaluator → payout. Class II flips the order:
 *
 *   1. A **finite prize pool** is seeded at coordinator startup
 *      (e.g. 50 000 tickets, each with a known prize amount).
 *   2. Each player request **draws one ticket** from the remaining pool
 *      (without replacement). The drawn ticket determines the prize.
 *   3. The reels then **animate** to reveal a configuration consistent
 *      with the drawn prize — pure cosmetics, no probability inversion.
 *
 * GLI-11 §3 (Class II Gaming Devices) requires that:
 *   - Prize distribution be auditable per game cycle.
 *   - The pool draw be cryptographically random (HSM-grade RNG).
 *   - Two slot terminals on the same coordinator must NEVER receive
 *     the same ticket (atomic decrement).
 *   - A complete cycle (all tickets drawn) regenerates the pool from
 *     the same template — no probability drift over time.
 *
 * # API contract
 *
 * `ClassIIBingoCoordinator` is a **single coordinator** managing one
 * pool. In production a real coordinator runs on its own server with
 * a TCP API; this module is the math-side stub that operators wire
 * into their RGS. The pool is pluggable so operators can run an
 * in-memory mock in tests and an SQL-backed pool in production.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TicketId = number;

/** A single prize ticket in the pool. */
export interface Ticket {
  readonly id: TicketId;
  /** Prize as a bet multiplier — `0` means a losing ticket. */
  readonly prizeX: number;
  /** Optional category for cosmetic reel reveal (e.g. 'jackpot', 'free-spins'). */
  readonly category?: string;
}

/** Pool snapshot for audit / cycle-end reporting. */
export interface PoolSnapshot {
  readonly poolId: string;
  readonly totalTickets: number;
  readonly remainingTickets: number;
  readonly drawnTickets: number;
  readonly currentCycle: number;
  /** Sum of `prizeX` across all remaining tickets, for live RTP audit. */
  readonly remainingTotalPrizeX: number;
}

export interface DrawResult {
  readonly ticket: Ticket;
  readonly drawIndex: number; // 0-based within the current cycle
  readonly cycleIndex: number;
  readonly poolAfter: PoolSnapshot;
}

/** RNG dependency — anything that emits a uniform u32 in [0, n). */
export interface BingoRng {
  /** Returns an integer in `[0, n)`. MUST be cryptographically random. */
  randInt(nExclusive: number): number;
}

/** Pluggable pool backend — in-memory mock or SQL implementation. */
export interface PoolBackend {
  /** Remove one ticket at index `idx` and return it. */
  takeAt(idx: number): Ticket;
  /** Snapshot length / total counts without mutating. */
  size(): number;
  /** Reseed the pool — called on cycle reset. */
  reseed(tickets: ReadonlyArray<Ticket>): void;
  /** Sum of prizeX across remaining tickets — for audit. */
  remainingTotalPrizeX(): number;
}

// ─── Default in-memory backend ────────────────────────────────────────────────

/** Vec-backed pool with O(1) swap-remove draws. */
export class InMemoryBingoPool implements PoolBackend {
  private _tickets: Ticket[];
  private _totalPrize: number;

  constructor(seed: ReadonlyArray<Ticket>) {
    this._tickets = seed.slice();
    this._totalPrize = this._tickets.reduce((s, t) => s + t.prizeX, 0);
  }

  takeAt(idx: number): Ticket {
    if (idx < 0 || idx >= this._tickets.length) {
      throw new RangeError(`InMemoryBingoPool.takeAt: idx=${idx} out of range`);
    }
    const t = this._tickets[idx];
    // Swap-remove for O(1) — order doesn't matter, we draw by index.
    const last = this._tickets[this._tickets.length - 1];
    if (idx !== this._tickets.length - 1) this._tickets[idx] = last;
    this._tickets.pop();
    this._totalPrize -= t.prizeX;
    return t;
  }

  size(): number {
    return this._tickets.length;
  }

  reseed(tickets: ReadonlyArray<Ticket>): void {
    this._tickets = tickets.slice();
    this._totalPrize = this._tickets.reduce((s, t) => s + t.prizeX, 0);
  }

  remainingTotalPrizeX(): number {
    return this._totalPrize;
  }
}

// ─── Coordinator ──────────────────────────────────────────────────────────────

export interface CoordinatorConfig {
  readonly poolId: string;
  /** The pool template — replicated to recreate the pool every cycle. */
  readonly poolTemplate: ReadonlyArray<Ticket>;
  /** Cryptographic RNG (UKGC / GLI-11: HSM-grade required). */
  readonly rng: BingoRng;
  /** Backend (defaults to in-memory). */
  readonly backend?: PoolBackend;
  /**
   * Cycle reset behaviour:
   *   - 'auto' (default): when pool drains, automatically reseed.
   *   - 'manual': caller must explicitly invoke `resetCycle()`.
   */
  readonly cycleResetMode?: 'auto' | 'manual';
}

export class ClassIIBingoCoordinator {
  private readonly cfg: CoordinatorConfig;
  private readonly backend: PoolBackend;
  private cycleIndex = 0;
  private drawsThisCycle = 0;
  private readonly totalPerCycle: number;

  constructor(cfg: CoordinatorConfig) {
    if (!cfg.poolId || typeof cfg.poolId !== 'string') {
      throw new RangeError('ClassIIBingoCoordinator: poolId required');
    }
    if (!cfg.poolTemplate || cfg.poolTemplate.length === 0) {
      throw new RangeError('ClassIIBingoCoordinator: poolTemplate must be non-empty');
    }
    // Dupe-id check — every ticket must have a unique id.
    const ids = new Set<TicketId>();
    for (const t of cfg.poolTemplate) {
      if (ids.has(t.id)) {
        throw new RangeError(`ClassIIBingoCoordinator: duplicate ticket id ${t.id}`);
      }
      if (t.prizeX < 0) {
        throw new RangeError(`ClassIIBingoCoordinator: ticket ${t.id} has negative prizeX`);
      }
      ids.add(t.id);
    }
    this.cfg = cfg;
    this.backend = cfg.backend ?? new InMemoryBingoPool(cfg.poolTemplate);
    if (!cfg.backend) {
      // Backend defaulted — already seeded.
    } else {
      this.backend.reseed(cfg.poolTemplate);
    }
    this.totalPerCycle = cfg.poolTemplate.length;
  }

  /**
   * Draw one ticket from the pool. Returns the ticket + cycle metadata.
   *
   * Behaviour when the pool drains:
   *   - `cycleResetMode='auto'`: pool is automatically reseeded; next draw is from a fresh cycle.
   *   - `cycleResetMode='manual'`: throws `Error('pool empty — call resetCycle()')`.
   */
  draw(): DrawResult {
    if (this.backend.size() === 0) {
      if ((this.cfg.cycleResetMode ?? 'auto') === 'auto') {
        this.resetCycle();
      } else {
        throw new Error(
          `ClassIIBingoCoordinator[${this.cfg.poolId}]: pool empty — call resetCycle()`
        );
      }
    }
    const idx = this.cfg.rng.randInt(this.backend.size());
    const ticket = this.backend.takeAt(idx);
    const drawIndex = this.drawsThisCycle;
    this.drawsThisCycle += 1;
    return {
      ticket,
      drawIndex,
      cycleIndex: this.cycleIndex,
      poolAfter: this.snapshot(),
    };
  }

  /**
   * Force a cycle reset — pool is rebuilt from the template, cycle
   * counter increments, draw counter resets.
   */
  resetCycle(): void {
    this.backend.reseed(this.cfg.poolTemplate);
    this.cycleIndex += 1;
    this.drawsThisCycle = 0;
  }

  snapshot(): PoolSnapshot {
    return {
      poolId: this.cfg.poolId,
      totalTickets: this.totalPerCycle,
      remainingTickets: this.backend.size(),
      drawnTickets: this.drawsThisCycle,
      currentCycle: this.cycleIndex,
      remainingTotalPrizeX: this.backend.remainingTotalPrizeX(),
    };
  }

  /** Pool-level theoretical RTP (Σ prizeX / |pool|) — constant across cycles. */
  poolTheoreticalRtp(): number {
    const total = this.cfg.poolTemplate.reduce((s, t) => s + t.prizeX, 0);
    return total / this.cfg.poolTemplate.length;
  }
}
