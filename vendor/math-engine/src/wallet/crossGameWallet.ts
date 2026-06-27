/**
 * Faza 13.8 — Cross-game progressive wallet math.
 *
 * A single jackpot pool that multiple game IDs contribute to, with
 * per-game contribution rates, multi-currency contribution (FX-converted
 * at contribution time), per-tier seed/cap/must-hit logic, and full
 * two-phase commit semantics so the engine is safe behind a Wallet/RGS
 * protocol that may roll back.
 *
 * # Why this exists
 *
 * Provider-side, every "linked progressive" (e.g. Mystery Jackpot, Daily
 * Jackpots, Hold-and-Win shared meter) lives on multiple games at once.
 * Each game contributes a percentage of every wager. The engine that
 * runs game A must know A's contribution rate AND the rate paid by games
 * B, C, D, etc. — otherwise the published RTP is wrong (the engine
 * thinks it pays 1% to the meter but B also pays 1% so the meter grows
 * at 2× the rate).
 *
 * This module gives the simulator an authoritative model of that
 * arithmetic so closed-form RTP (Faza 6) and the MC reports (Faza 8.5)
 * both agree with how the live wallet will actually behave.
 *
 * # Determinism
 *
 * No I/O, no clocks, no RNG. Every operation is a pure function from
 * `(prior state, input)` → `(next state, event)`. The wallet only fires
 * hits when *you* call `recordHit(...)`; the must-hit-by logic merely
 * reports `pending` and lets the caller decide.
 *
 * # Two-phase commit
 *
 * Mirrors the in-game `JackpotManager` pattern:
 *
 *   ┌─ begin*  ─┐                    ┌─ commit*  ─┐
 *   │ contribute │ → pending payment  │ pool decrement │ → 'committed'
 *   │ recordHit  │                    │ pool decrement │ → 'committed'
 *   └────────────┘                    └─ rollback* ───┘ → 'rolled_back'
 *
 * Begin operations are reversible; commit operations are not. After
 * rollback the wallet's externally-observable state must equal the
 * state immediately prior to `begin*`. Tested in
 * `tests/cross_game_wallet.test.ts`.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** ISO 4217 currency code (loosely typed — any 3-letter code is accepted). */
export type CurrencyCode = string;

/** Game identifier — opaque string, must be unique across the operator. */
export type GameId = string;

/** Pool identifier — operator-scoped key for one progressive ladder. */
export type PoolId = string;

/** One progressive tier on the shared meter (Mini / Minor / Major / Grand / Mega). */
export interface CrossGameTier {
  /** Display name, must be unique within the pool. */
  readonly name: string;
  /** Seed value (in base-currency minor units, e.g. cents). */
  readonly seedMinor: number;
  /** Current pool value above the seed (in base-currency minor units). */
  poolMinor: number;
  /** Optional mandatory cap — engine emits `must_hit_by_approaching` ≥ 95% cap. */
  readonly mustHitByMaxMinor?: number;
}

/** Per-game contribution policy. */
export interface CrossGameContribution {
  readonly gameId: GameId;
  /** Fraction of bet routed to the pool, e.g. 0.005 = 0.5%. */
  readonly contributionRate: number;
  /** Optional per-tier weights (sum to ≤ 1.0) — distributes contribution
   *  across multiple tiers. Defaults to even split if absent. */
  readonly tierWeights?: Record<string, number>;
  /** If true, the game is "eligible" — contributions accepted. */
  readonly eligible: boolean;
}

/**
 * FX rate table: how many base-currency minor units one minor unit of
 * source currency is worth. E.g. for base=EUR, source=GBP@1.17 →
 * `{ GBP: 1.17 }` (one GBP cent = 1.17 EUR cents).
 *
 * Rates are snapshotted at contribution time inside the audit log so
 * later FX moves don't retroactively change pool history.
 */
export type FxRateTable = Record<CurrencyCode, number>;

/** Configuration of the wallet. */
export interface CrossGameWalletConfig {
  readonly poolId: PoolId;
  readonly baseCurrency: CurrencyCode;
  readonly tiers: ReadonlyArray<Pick<CrossGameTier, 'name' | 'seedMinor' | 'mustHitByMaxMinor'>>;
  readonly contributions: ReadonlyArray<CrossGameContribution>;
  /** Fallback FX rates used when a contribution arrives in a non-base currency. */
  readonly fx?: FxRateTable;
  /** Minor-unit-rounding mode. Default 'half_even' (banker's). */
  readonly roundingMode?: 'half_even' | 'half_up' | 'truncate';
}

/** Pending operation — created by `begin*`, must be `commit*` or `rollback*`. */
export interface CrossGamePending {
  readonly pendingId: string;
  readonly opKind: 'contribute' | 'hit';
  readonly createdAtSequence: number;
  readonly gameId: GameId;
  readonly tierName: string;
  /** Sign-aware delta in base-currency minor units (positive = pool grew). */
  readonly deltaMinor: number;
  status: 'pending' | 'committed' | 'rolled_back';
  /** Snapshot of the contribution context, for audit. */
  readonly audit: {
    readonly sourceCurrency: CurrencyCode;
    readonly sourceAmountMinor: number;
    readonly fxRate: number;
    readonly contributionRate: number;
  };
}

/** Emitted on every state transition. */
export type CrossGameEvent =
  | { kind: 'contribution_recorded'; gameId: GameId; tier: string; sourceMinor: number; baseMinor: number; pendingId: string }
  | { kind: 'contribution_committed'; gameId: GameId; tier: string; pendingId: string; newPoolMinor: number }
  | { kind: 'contribution_rolled_back'; pendingId: string; reason: string }
  | { kind: 'hit_recorded'; gameId: GameId; tier: string; payoutMinor: number; pendingId: string }
  | { kind: 'hit_committed'; gameId: GameId; tier: string; pendingId: string; payoutMinor: number; newPoolMinor: number }
  | { kind: 'hit_rolled_back'; pendingId: string; reason: string }
  | { kind: 'must_hit_by_approaching'; tier: string; poolMinor: number; capMinor: number; ratio: number }
  | { kind: 'fx_rate_missing'; sourceCurrency: CurrencyCode; gameId: GameId }
  | { kind: 'ineligible_game'; gameId: GameId; tier: string };

/** Replay-friendly snapshot of the wallet state. */
export interface CrossGameWalletSnapshot {
  readonly poolId: PoolId;
  readonly baseCurrency: CurrencyCode;
  readonly tiers: ReadonlyArray<{ name: string; seedMinor: number; poolMinor: number; mustHitByMaxMinor?: number }>;
  /** Sequence number — incremented on every state transition. */
  readonly sequence: number;
  /** Total committed contributions (base-currency minor units) by game. */
  readonly contributionsTotalByGame: Record<GameId, number>;
  /** Total committed payouts (base-currency minor units) by tier. */
  readonly payoutsTotalByTier: Record<string, number>;
  /** Lifetime hit count by tier (committed only). */
  readonly hitsByTier: Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundMinor(x: number, mode: NonNullable<CrossGameWalletConfig['roundingMode']>): number {
  if (mode === 'truncate') return Math.trunc(x);
  if (mode === 'half_up') return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
  // half_even (banker's)
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // Exact half — round to even.
  return floor % 2 === 0 ? floor : floor + 1;
}

function pseudoId(prefix: string, seq: number): string {
  // Deterministic ID (no RNG, no clock) — pure function of the sequence
  // number. Operators that need globally-unique IDs across multiple
  // wallet shards prefix with their shard ID; this module stays pure.
  return `${prefix}-${seq.toString(16).padStart(8, '0')}`;
}

// ─── Implementation ───────────────────────────────────────────────────────────

const APPROACHING_THRESHOLD = 0.95;

export class CrossGameWallet {
  private readonly tiers = new Map<string, CrossGameTier>();
  private readonly contributions = new Map<GameId, CrossGameContribution>();
  private readonly pending = new Map<string, CrossGamePending>();
  private readonly contributionsTotalByGame: Record<GameId, number> = {};
  private readonly payoutsTotalByTier: Record<string, number> = {};
  private readonly hitsByTier: Record<string, number> = {};
  private readonly fx: FxRateTable;
  private readonly roundingMode: NonNullable<CrossGameWalletConfig['roundingMode']>;
  private readonly events: CrossGameEvent[] = [];
  private sequence = 0;

  constructor(public readonly config: CrossGameWalletConfig) {
    if (!config.poolId || typeof config.poolId !== 'string') {
      throw new RangeError('CrossGameWallet: poolId must be a non-empty string');
    }
    if (!config.baseCurrency || config.baseCurrency.length < 3) {
      throw new RangeError('CrossGameWallet: baseCurrency must be a 3-letter ISO code');
    }
    if (config.tiers.length === 0) {
      throw new RangeError('CrossGameWallet: must declare at least one tier');
    }
    const tierNames = new Set<string>();
    for (const tier of config.tiers) {
      if (tierNames.has(tier.name)) {
        throw new RangeError(`CrossGameWallet: duplicate tier name "${tier.name}"`);
      }
      tierNames.add(tier.name);
      if (tier.seedMinor < 0) {
        throw new RangeError(`CrossGameWallet: tier "${tier.name}" seedMinor must be ≥ 0`);
      }
      if (tier.mustHitByMaxMinor != null && tier.mustHitByMaxMinor <= tier.seedMinor) {
        throw new RangeError(
          `CrossGameWallet: tier "${tier.name}" mustHitByMaxMinor must exceed seedMinor`
        );
      }
      this.tiers.set(tier.name, {
        name: tier.name,
        seedMinor: tier.seedMinor,
        poolMinor: tier.seedMinor,
        ...(tier.mustHitByMaxMinor != null ? { mustHitByMaxMinor: tier.mustHitByMaxMinor } : {}),
      });
      this.payoutsTotalByTier[tier.name] = 0;
      this.hitsByTier[tier.name] = 0;
    }
    for (const c of config.contributions) {
      if (!Number.isFinite(c.contributionRate) || c.contributionRate < 0 || c.contributionRate > 1) {
        throw new RangeError(
          `CrossGameWallet: contribution.contributionRate must be in [0,1] for game "${c.gameId}"`
        );
      }
      if (c.tierWeights) {
        const sum = Object.values(c.tierWeights).reduce((a, b) => a + b, 0);
        if (sum > 1 + 1e-9) {
          throw new RangeError(`CrossGameWallet: tierWeights for "${c.gameId}" sum > 1.0 (${sum})`);
        }
        for (const t of Object.keys(c.tierWeights)) {
          if (!this.tiers.has(t)) {
            throw new RangeError(`CrossGameWallet: tierWeights references unknown tier "${t}"`);
          }
        }
      }
      this.contributions.set(c.gameId, c);
      this.contributionsTotalByGame[c.gameId] = 0;
    }
    this.fx = { ...(config.fx ?? {}), [config.baseCurrency]: 1.0 };
    this.roundingMode = config.roundingMode ?? 'half_even';
  }

  // ─── Inspection ─────────────────────────────────────────────────────

  /** Drain the event buffer. Caller assumes ownership of the array. */
  drainEvents(): CrossGameEvent[] {
    const out = this.events.splice(0, this.events.length);
    return out;
  }

  /** Inspect (but don't consume) the event buffer. */
  peekEvents(): ReadonlyArray<CrossGameEvent> {
    return this.events.slice();
  }

  /** Current pool value (above seed) per tier, in base-currency minor units. */
  poolValueMinor(tierName: string): number {
    const t = this.tiers.get(tierName);
    if (!t) throw new RangeError(`CrossGameWallet: unknown tier "${tierName}"`);
    return t.poolMinor;
  }

  /** Replay-friendly state snapshot — sufficient to reconstruct via `fromSnapshot`. */
  snapshot(): CrossGameWalletSnapshot {
    return {
      poolId: this.config.poolId,
      baseCurrency: this.config.baseCurrency,
      tiers: Array.from(this.tiers.values()).map((t) => ({
        name: t.name,
        seedMinor: t.seedMinor,
        poolMinor: t.poolMinor,
        ...(t.mustHitByMaxMinor != null ? { mustHitByMaxMinor: t.mustHitByMaxMinor } : {}),
      })),
      sequence: this.sequence,
      contributionsTotalByGame: { ...this.contributionsTotalByGame },
      payoutsTotalByTier: { ...this.payoutsTotalByTier },
      hitsByTier: { ...this.hitsByTier },
    };
  }

  /** Reconstruct wallet from a snapshot.  Pending operations are NOT preserved. */
  static fromSnapshot(config: CrossGameWalletConfig, snap: CrossGameWalletSnapshot): CrossGameWallet {
    const w = new CrossGameWallet(config);
    for (const t of snap.tiers) {
      const internal = w.tiers.get(t.name);
      if (internal) internal.poolMinor = t.poolMinor;
    }
    w.sequence = snap.sequence;
    for (const [g, total] of Object.entries(snap.contributionsTotalByGame)) {
      w.contributionsTotalByGame[g] = total;
    }
    for (const [t, total] of Object.entries(snap.payoutsTotalByTier)) {
      w.payoutsTotalByTier[t] = total;
    }
    for (const [t, hits] of Object.entries(snap.hitsByTier)) {
      w.hitsByTier[t] = hits;
    }
    return w;
  }

  // ─── Contribute (two-phase) ─────────────────────────────────────────

  /**
   * Begin a contribution.  Returns the pending record; commit or rollback
   * must be invoked.  Returns `null` if the game is ineligible, the FX
   * rate is missing, or the bet rounds to 0 contribution.
   */
  beginContribute(input: {
    gameId: GameId;
    /** Bet amount in source currency minor units. */
    sourceMinor: number;
    /** Source currency. */
    currency: CurrencyCode;
    /** Optional tier name override (else split per `tierWeights`). */
    tierName?: string;
  }): CrossGamePending | null {
    const c = this.contributions.get(input.gameId);
    if (!c || !c.eligible) {
      this.emit({ kind: 'ineligible_game', gameId: input.gameId, tier: input.tierName ?? '*' });
      return null;
    }
    if (!Number.isFinite(input.sourceMinor) || input.sourceMinor < 0) {
      throw new RangeError('beginContribute: sourceMinor must be a non-negative number');
    }
    const fxRate = this.fx[input.currency];
    if (fxRate == null) {
      this.emit({ kind: 'fx_rate_missing', sourceCurrency: input.currency, gameId: input.gameId });
      return null;
    }

    // Resolve target tier — explicit overrides default split.
    let tierName: string;
    if (input.tierName) {
      if (!this.tiers.has(input.tierName)) {
        throw new RangeError(`beginContribute: unknown tier "${input.tierName}"`);
      }
      tierName = input.tierName;
    } else if (c.tierWeights) {
      const weighted = Object.entries(c.tierWeights).sort((a, b) => b[1] - a[1]);
      tierName = weighted[0]?.[0] ?? this.tiers.keys().next().value!;
    } else {
      tierName = this.tiers.keys().next().value!;
    }

    const baseContributionExact = input.sourceMinor * c.contributionRate * fxRate;
    const baseContribution = roundMinor(baseContributionExact, this.roundingMode);
    if (baseContribution === 0) {
      // Don't create churn — every micro-bet would emit a pending.
      return null;
    }

    const pending: CrossGamePending = {
      pendingId: pseudoId('contrib', this.sequence + 1),
      opKind: 'contribute',
      createdAtSequence: this.sequence + 1,
      gameId: input.gameId,
      tierName,
      deltaMinor: +baseContribution,
      status: 'pending',
      audit: {
        sourceCurrency: input.currency,
        sourceAmountMinor: input.sourceMinor,
        fxRate,
        contributionRate: c.contributionRate,
      },
    };
    this.bumpSequence();
    this.pending.set(pending.pendingId, pending);
    this.emit({
      kind: 'contribution_recorded',
      gameId: input.gameId,
      tier: tierName,
      sourceMinor: input.sourceMinor,
      baseMinor: baseContribution,
      pendingId: pending.pendingId,
    });
    return pending;
  }

  commitContribute(pendingId: string): void {
    const p = this.pending.get(pendingId);
    if (!p) throw new RangeError(`commitContribute: unknown pendingId "${pendingId}"`);
    if (p.opKind !== 'contribute') throw new RangeError(`commitContribute: opKind=${p.opKind}`);
    if (p.status !== 'pending') throw new RangeError(`commitContribute: status=${p.status}`);
    const tier = this.tiers.get(p.tierName);
    if (!tier) throw new Error('commitContribute: tier disappeared');
    tier.poolMinor += p.deltaMinor;
    this.contributionsTotalByGame[p.gameId] =
      (this.contributionsTotalByGame[p.gameId] ?? 0) + p.deltaMinor;
    p.status = 'committed';
    this.bumpSequence();
    this.emit({
      kind: 'contribution_committed',
      gameId: p.gameId,
      tier: p.tierName,
      pendingId: p.pendingId,
      newPoolMinor: tier.poolMinor,
    });
    this.maybeEmitMustHitApproaching(tier);
  }

  rollbackContribute(pendingId: string, reason: string): void {
    const p = this.pending.get(pendingId);
    if (!p) throw new RangeError(`rollbackContribute: unknown pendingId "${pendingId}"`);
    if (p.opKind !== 'contribute') throw new RangeError(`rollbackContribute: opKind=${p.opKind}`);
    if (p.status !== 'pending') throw new RangeError(`rollbackContribute: status=${p.status}`);
    p.status = 'rolled_back';
    this.bumpSequence();
    this.emit({ kind: 'contribution_rolled_back', pendingId: p.pendingId, reason });
  }

  // ─── Record hit (two-phase) ─────────────────────────────────────────

  /** Begin a payout. Returns the pending record. */
  beginHit(input: { gameId: GameId; tierName: string }): CrossGamePending {
    if (!this.contributions.has(input.gameId)) {
      throw new RangeError(`beginHit: game "${input.gameId}" not registered to this pool`);
    }
    const tier = this.tiers.get(input.tierName);
    if (!tier) throw new RangeError(`beginHit: unknown tier "${input.tierName}"`);
    const payout = tier.poolMinor;
    if (payout <= 0) {
      throw new RangeError(
        `beginHit: tier "${tier.name}" pool is empty (poolMinor=${payout}) — cannot hit`
      );
    }
    const pending: CrossGamePending = {
      pendingId: pseudoId('hit', this.sequence + 1),
      opKind: 'hit',
      createdAtSequence: this.sequence + 1,
      gameId: input.gameId,
      tierName: tier.name,
      deltaMinor: -payout,
      status: 'pending',
      audit: {
        sourceCurrency: this.config.baseCurrency,
        sourceAmountMinor: payout,
        fxRate: 1,
        contributionRate: 0,
      },
    };
    this.bumpSequence();
    this.pending.set(pending.pendingId, pending);
    this.emit({
      kind: 'hit_recorded',
      gameId: input.gameId,
      tier: tier.name,
      payoutMinor: payout,
      pendingId: pending.pendingId,
    });
    return pending;
  }

  commitHit(pendingId: string): void {
    const p = this.pending.get(pendingId);
    if (!p) throw new RangeError(`commitHit: unknown pendingId "${pendingId}"`);
    if (p.opKind !== 'hit') throw new RangeError(`commitHit: opKind=${p.opKind}`);
    if (p.status !== 'pending') throw new RangeError(`commitHit: status=${p.status}`);
    const tier = this.tiers.get(p.tierName);
    if (!tier) throw new Error('commitHit: tier disappeared');
    const payout = -p.deltaMinor;
    tier.poolMinor = tier.seedMinor; // reset to seed after a hit
    this.payoutsTotalByTier[p.tierName] = (this.payoutsTotalByTier[p.tierName] ?? 0) + payout;
    this.hitsByTier[p.tierName] = (this.hitsByTier[p.tierName] ?? 0) + 1;
    p.status = 'committed';
    this.bumpSequence();
    this.emit({
      kind: 'hit_committed',
      gameId: p.gameId,
      tier: p.tierName,
      pendingId: p.pendingId,
      payoutMinor: payout,
      newPoolMinor: tier.poolMinor,
    });
  }

  rollbackHit(pendingId: string, reason: string): void {
    const p = this.pending.get(pendingId);
    if (!p) throw new RangeError(`rollbackHit: unknown pendingId "${pendingId}"`);
    if (p.opKind !== 'hit') throw new RangeError(`rollbackHit: opKind=${p.opKind}`);
    if (p.status !== 'pending') throw new RangeError(`rollbackHit: status=${p.status}`);
    p.status = 'rolled_back';
    this.bumpSequence();
    this.emit({ kind: 'hit_rolled_back', pendingId: p.pendingId, reason });
  }

  // ─── Cross-game RTP accounting ──────────────────────────────────────

  /**
   * Closed-form RTP contribution of this pool back to game `gameId`
   * given a steady-state hit rate `hitsPerSpin` and steady-state mean
   * pool value at hit time `meanPoolAtHit` (both in base-currency).
   *
   * Used by the analytical engine to fold the pool contribution into
   * the per-spin theoretical RTP. The math is simple:
   *
   *   rtp_contribution = (hits_per_spin × mean_pool_at_hit) / mean_bet
   *
   * but it MUST use the operator's actual `meanPoolAtHit` (long-run
   * average from MC), not the seed value — otherwise the published RTP
   * undercounts what the pool pays back.
   */
  rtpContribution(input: {
    gameId: GameId;
    meanBetMinor: number;
    hitsPerSpinByTier: Record<string, number>;
    meanPoolAtHitByTier: Record<string, number>;
  }): number {
    if (input.meanBetMinor <= 0) return 0;
    let sum = 0;
    for (const tier of this.tiers.keys()) {
      const hps = input.hitsPerSpinByTier[tier] ?? 0;
      const mph = input.meanPoolAtHitByTier[tier] ?? 0;
      sum += hps * mph;
    }
    return sum / input.meanBetMinor;
  }

  /**
   * Pool growth rate per spin for game `gameId` — the share of one bet
   * that lands in the pool. Used to validate that operator-published
   * contribution rates match the wallet's accounting.
   */
  poolGrowthPerSpin(input: { gameId: GameId; meanBetMinor: number }): number {
    const c = this.contributions.get(input.gameId);
    if (!c || !c.eligible) return 0;
    return input.meanBetMinor * c.contributionRate;
  }

  // ─── private ────────────────────────────────────────────────────────

  private bumpSequence(): void {
    this.sequence += 1;
  }

  private emit(ev: CrossGameEvent): void {
    this.events.push(ev);
  }

  private maybeEmitMustHitApproaching(tier: CrossGameTier): void {
    if (tier.mustHitByMaxMinor == null) return;
    const ratio = tier.poolMinor / tier.mustHitByMaxMinor;
    if (ratio >= APPROACHING_THRESHOLD) {
      this.emit({
        kind: 'must_hit_by_approaching',
        tier: tier.name,
        poolMinor: tier.poolMinor,
        capMinor: tier.mustHitByMaxMinor,
        ratio,
      });
    }
  }
}

// ─── Barrel-friendly helpers ─────────────────────────────────────────────────

/**
 * Build a wallet from a "simple" config — single-tier, single-currency,
 * even contribution split. Convenience for tests.
 */
export function makeSimpleWallet(args: {
  poolId: PoolId;
  baseCurrency?: CurrencyCode;
  tierName?: string;
  seedMinor?: number;
  games: ReadonlyArray<{ gameId: GameId; contributionRate: number }>;
}): CrossGameWallet {
  return new CrossGameWallet({
    poolId: args.poolId,
    baseCurrency: args.baseCurrency ?? 'EUR',
    tiers: [{ name: args.tierName ?? 'Grand', seedMinor: args.seedMinor ?? 0 }],
    contributions: args.games.map((g) => ({
      gameId: g.gameId,
      contributionRate: g.contributionRate,
      eligible: true,
    })),
  });
}
