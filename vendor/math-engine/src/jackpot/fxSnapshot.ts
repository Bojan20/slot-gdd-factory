/**
 * Faza 5.5 — Floating jackpot pool with FX-rate-at-hit snapshot.
 *
 * A "floating" jackpot pool accepts contributions in multiple
 * currencies, converts each contribution to a base accounting currency
 * at the FX rate **in effect at contribution time**, and crucially —
 * snapshots the per-currency FX rates **at the moment of a jackpot
 * hit**. Subsequent FX moves do not retroactively change the payout
 * a player received.
 *
 * Why this matters operationally:
 *   - Multi-currency WAP networks contribute in CAD/EUR/USD/etc. into
 *     a single shared meter denominated in (typically) EUR or USD.
 *   - If a player in CAD wins the jackpot, the payout owed to them is
 *     the EUR meter × current EUR→CAD FX rate.
 *   - If the FX feed lags, or moves before the regulator audit, the
 *     payout the player saw must remain the payout the operator owes.
 *
 * The module is **pure math + state** — no network I/O, no clock.
 * Caller pushes FX rates and timestamps; this module records the
 * snapshot used for each hit, so the audit trail is reconstructable.
 *
 * Companion to `CrossGameWallet` (Faza 13.8) — `CrossGameWallet`
 * handles the per-spin contribute lifecycle; this module handles the
 * cross-currency payout-at-hit snapshot.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CurrencyCode = string;

/** Snapshot of FX rates valid for one accounting moment. */
export interface FxRateSnapshot {
  /**
   * Map: source currency → base-currency units per source unit.
   * Base currency is implicit in `FloatingJackpotPool.baseCurrency`.
   * The base currency itself MUST be present with rate 1.0 for
   * round-trip integrity.
   */
  readonly rates: Readonly<Record<CurrencyCode, number>>;
  /** Caller-supplied timestamp (UTC ISO 8601). Opaque to this module. */
  readonly recordedAt: string;
  /** Optional rate-provider identifier (e.g. 'ECB-2026-05-15', 'XE-12345'). */
  readonly providerRef?: string;
}

/** A committed contribution into the pool. */
export interface FloatingContribution {
  readonly id: string;
  /** Source currency of the bet that triggered the contribution. */
  readonly sourceCurrency: CurrencyCode;
  /** Source-currency minor units (e.g. cents). */
  readonly sourceMinor: number;
  /** Base-currency minor units that landed in the pool. */
  readonly baseMinor: number;
  /** FX snapshot in effect at contribute time. */
  readonly fxSnapshotAt: string;
}

/** Result of a hit payout — captures the FX snapshot used. */
export interface FloatingHitPayout {
  readonly hitId: string;
  /** Base-currency pool size at hit time. */
  readonly poolBaseMinor: number;
  /** Player's wallet currency. */
  readonly playerCurrency: CurrencyCode;
  /** FX rate (base → player) snapshotted at hit time. */
  readonly fxRateAtHit: number;
  /** Player's wallet currency minor units owed. */
  readonly playerPayoutMinor: number;
  /** ISO timestamp the snapshot was recorded under. */
  readonly snapshotAt: string;
}

export interface FloatingJackpotConfig {
  readonly poolId: string;
  readonly baseCurrency: CurrencyCode;
  /** Seed value in base-currency minor units. */
  readonly seedMinor: number;
  /** Optional mandatory cap. */
  readonly mustHitByMaxMinor?: number;
  /**
   * How to round when converting between currencies (default 'half_even'
   * to match `CrossGameWallet`).
   */
  readonly roundingMode?: 'half_even' | 'half_up' | 'truncate';
}

// ─── Implementation ───────────────────────────────────────────────────────────

function roundMinor(x: number, mode: NonNullable<FloatingJackpotConfig['roundingMode']>): number {
  if (mode === 'truncate') return Math.trunc(x);
  if (mode === 'half_up') return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
  // half_even (banker's)
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export class FloatingJackpotPool {
  private readonly cfg: FloatingJackpotConfig;
  private readonly roundingMode: NonNullable<FloatingJackpotConfig['roundingMode']>;
  private poolBaseMinor: number;
  private currentSnapshot: FxRateSnapshot | null = null;
  private readonly contributions: FloatingContribution[] = [];
  private readonly hits: FloatingHitPayout[] = [];
  private sequence = 0;

  constructor(cfg: FloatingJackpotConfig) {
    if (!cfg.poolId || typeof cfg.poolId !== 'string') {
      throw new RangeError('FloatingJackpotPool: poolId required');
    }
    if (!cfg.baseCurrency || cfg.baseCurrency.length < 3) {
      throw new RangeError('FloatingJackpotPool: baseCurrency must be a 3-letter ISO code');
    }
    if (!Number.isFinite(cfg.seedMinor) || cfg.seedMinor < 0) {
      throw new RangeError('FloatingJackpotPool: seedMinor must be ≥ 0');
    }
    if (cfg.mustHitByMaxMinor != null && cfg.mustHitByMaxMinor <= cfg.seedMinor) {
      throw new RangeError('FloatingJackpotPool: mustHitByMaxMinor must exceed seedMinor');
    }
    this.cfg = cfg;
    this.roundingMode = cfg.roundingMode ?? 'half_even';
    this.poolBaseMinor = cfg.seedMinor;
  }

  /**
   * Publish a new FX rate snapshot. Must be called before the first
   * contribution can be accepted (snapshot is required to convert
   * source → base currency).
   *
   * Snapshots must include the base currency itself with rate 1.0.
   */
  publishFxSnapshot(snap: FxRateSnapshot): void {
    if (snap.rates[this.cfg.baseCurrency] !== 1) {
      throw new RangeError(
        `FloatingJackpotPool.publishFxSnapshot: base currency ${this.cfg.baseCurrency} must have rate 1.0 (got ${snap.rates[this.cfg.baseCurrency]})`
      );
    }
    for (const [cur, rate] of Object.entries(snap.rates)) {
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new RangeError(
          `FloatingJackpotPool.publishFxSnapshot: rate for ${cur} must be > 0 (got ${rate})`
        );
      }
    }
    if (!snap.recordedAt || typeof snap.recordedAt !== 'string') {
      throw new RangeError('FloatingJackpotPool.publishFxSnapshot: recordedAt required');
    }
    this.currentSnapshot = snap;
  }

  /**
   * Record one committed contribution into the pool. The contribution
   * is converted to base currency using the **current** FX snapshot.
   */
  contribute(input: {
    sourceCurrency: CurrencyCode;
    sourceMinor: number;
  }): FloatingContribution {
    if (this.currentSnapshot == null) {
      throw new Error('FloatingJackpotPool.contribute: no FX snapshot published');
    }
    if (!Number.isFinite(input.sourceMinor) || input.sourceMinor < 0) {
      throw new RangeError('FloatingJackpotPool.contribute: sourceMinor must be ≥ 0');
    }
    const rate = this.currentSnapshot.rates[input.sourceCurrency];
    if (rate == null) {
      throw new RangeError(
        `FloatingJackpotPool.contribute: no FX rate for ${input.sourceCurrency} in current snapshot`
      );
    }
    const baseMinor = roundMinor(input.sourceMinor * rate, this.roundingMode);
    this.poolBaseMinor += baseMinor;
    this.sequence += 1;
    const c: FloatingContribution = {
      id: `c-${this.sequence.toString(16).padStart(8, '0')}`,
      sourceCurrency: input.sourceCurrency,
      sourceMinor: input.sourceMinor,
      baseMinor,
      fxSnapshotAt: this.currentSnapshot.recordedAt,
    };
    this.contributions.push(c);
    return c;
  }

  /**
   * Record a hit. The current pool value is paid out to the player in
   * `playerCurrency`. The **FX snapshot used is recorded permanently**
   * with the hit, so audit replays produce identical payouts even if
   * the live FX feed changes afterwards.
   */
  recordHit(input: { playerCurrency: CurrencyCode }): FloatingHitPayout {
    if (this.currentSnapshot == null) {
      throw new Error('FloatingJackpotPool.recordHit: no FX snapshot published');
    }
    if (this.poolBaseMinor <= 0) {
      throw new Error('FloatingJackpotPool.recordHit: pool is empty');
    }
    const rate = this.currentSnapshot.rates[input.playerCurrency];
    if (rate == null) {
      throw new RangeError(
        `FloatingJackpotPool.recordHit: no FX rate for ${input.playerCurrency} in current snapshot`
      );
    }
    // Base→player: divide base by rate (rates are denominated as
    // "base units per source unit", so converting base → player
    // currency is `poolBase / rate_player`).
    const playerPayoutMinor = roundMinor(this.poolBaseMinor / rate, this.roundingMode);
    const poolBaseMinor = this.poolBaseMinor;
    this.poolBaseMinor = this.cfg.seedMinor; // reset to seed
    this.sequence += 1;
    const hit: FloatingHitPayout = {
      hitId: `h-${this.sequence.toString(16).padStart(8, '0')}`,
      poolBaseMinor,
      playerCurrency: input.playerCurrency,
      fxRateAtHit: rate,
      playerPayoutMinor,
      snapshotAt: this.currentSnapshot.recordedAt,
    };
    this.hits.push(hit);
    return hit;
  }

  /** Current pool value in base currency. */
  poolBase(): number {
    return this.poolBaseMinor;
  }

  /** Replay a historical hit. The FX snapshot recorded at hit time
   *  is used to reproduce the exact payout amount. Future FX moves
   *  cannot alter the audit answer. */
  replayHit(hit: FloatingHitPayout): number {
    return roundMinor(hit.poolBaseMinor / hit.fxRateAtHit, this.roundingMode);
  }

  /** Lifetime stats for audit / reporting. */
  stats(): {
    poolId: string;
    baseCurrency: CurrencyCode;
    currentPoolBaseMinor: number;
    totalHits: number;
    totalContributions: number;
    totalContributedBaseMinor: number;
    totalPaidPlayerMinor: Record<CurrencyCode, number>;
  } {
    const totalPaid: Record<CurrencyCode, number> = {};
    for (const h of this.hits) {
      totalPaid[h.playerCurrency] = (totalPaid[h.playerCurrency] ?? 0) + h.playerPayoutMinor;
    }
    return {
      poolId: this.cfg.poolId,
      baseCurrency: this.cfg.baseCurrency,
      currentPoolBaseMinor: this.poolBaseMinor,
      totalHits: this.hits.length,
      totalContributions: this.contributions.length,
      totalContributedBaseMinor: this.contributions.reduce((s, c) => s + c.baseMinor, 0),
      totalPaidPlayerMinor: totalPaid,
    };
  }
}
