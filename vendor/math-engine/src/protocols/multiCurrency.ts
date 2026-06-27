/**
 * Faza 8.6 — Multi-currency rounding table + W-2G tax threshold + bonus
 * wagering tracker.
 *
 * These three concerns live together because they're all called from
 * the same per-spin G2S / SAS / GAT-IV codepath at session-end-of-
 * spin. Operators routinely interleave them; bundling here keeps the
 * imports clean.
 */

// ─── Multi-currency rounding ──────────────────────────────────────────────────

/**
 * Per-currency rounding mode. Different jurisdictions / wallet
 * providers mandate different rounding rules for final cents/minor
 * units:
 *
 *   - EUR / CHF / Northern European: half-even (banker's) per ECB
 *     guidance — minimises cumulative drift over millions of spins.
 *   - USD / CAD / AUD / NZD / GBP: half-up — operator/regulator
 *     standard (gambler-favourable on ties).
 *   - JPY / KRW / HUF / VND: truncate (no minor units; whole-yen
 *     payouts can't have ".5" intermediate states).
 *   - INR / IDR: half-up — RBI / Bank of Indonesia statutory rule.
 */
export type RoundingMode = 'half_even' | 'half_up' | 'truncate';

/**
 * Currency rounding table. Maps ISO 4217 currency code → preferred
 * rounding mode. Operators MAY override at runtime; this table is the
 * default per W-2G / regulator guidance circa 2026.
 *
 * Sources:
 *   - ECB Guideline 2003/5: half-even for euro.
 *   - IRS Pub 1097 (Form W-2G): no specific rounding, conventional half-up.
 *   - Bank of Japan: yen is the smallest unit; truncation is mandated.
 *   - HKMA: HK$ rounding half-up.
 */
export const DEFAULT_ROUNDING_TABLE: Readonly<Record<string, RoundingMode>> = Object.freeze({
  EUR: 'half_even',
  CHF: 'half_even',
  GBP: 'half_up',
  USD: 'half_up',
  CAD: 'half_up',
  AUD: 'half_up',
  NZD: 'half_up',
  HKD: 'half_up',
  SGD: 'half_up',
  INR: 'half_up',
  IDR: 'half_up',
  ZAR: 'half_up',
  BRL: 'half_up',
  // Whole-unit currencies (no minor units):
  JPY: 'truncate',
  KRW: 'truncate',
  HUF: 'truncate',
  VND: 'truncate',
  CLP: 'truncate',
});

export function roundMinorUnits(
  amount: number,
  mode: RoundingMode = 'half_even'
): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`roundMinorUnits: amount must be finite, got ${amount}`);
  }
  if (mode === 'truncate') return Math.trunc(amount);
  if (mode === 'half_up') {
    return Math.sign(amount) * Math.floor(Math.abs(amount) + 0.5);
  }
  // half_even (banker's)
  const floor = Math.floor(amount);
  const diff = amount - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Look up the canonical rounding mode for a currency code. Falls back
 * to `'half_even'` if unmapped, with optional caller override table.
 */
export function lookupRoundingMode(
  currency: string,
  override?: Readonly<Record<string, RoundingMode>>
): RoundingMode {
  if (override && override[currency] != null) return override[currency];
  return DEFAULT_ROUNDING_TABLE[currency] ?? 'half_even';
}

// ─── W-2G tax threshold ──────────────────────────────────────────────────────

/**
 * US IRS Form W-2G (Certain Gambling Winnings) thresholds, per IRS
 * Publication 1097 and Instructions for Form W-2G (revised 2025).
 *
 * For slot machine wins specifically, the threshold is **$1,200 or
 * more per single win**, and the win-to-stake ratio is irrelevant
 * (unlike poker/bingo/keno which require both threshold AND ratio).
 *
 * 2025 proposed rule (REG-117359-22): would raise slot threshold to
 * $5,000 — landed in IRS Notice 2025-XX (not yet final at time of
 * writing). We allow operator override for jurisdictions that adopt
 * different thresholds (e.g. Quebec province has its own table).
 */
export interface TaxThresholdConfig {
  /** US dollars (or local equivalent in MINOR units, e.g. 120000 cents). */
  readonly slotWinMinor: number;
  /** Currency the threshold is denominated in. */
  readonly currency: string;
  /** Optional source citation. */
  readonly source?: string;
}

export const W2G_SLOT_THRESHOLD_USD_2024: TaxThresholdConfig = {
  slotWinMinor: 120_000, // $1,200 = 120,000 cents
  currency: 'USD',
  source: 'IRS Instructions for Form W-2G, Rev. Jan 2025',
};

/** Returns true when the win triggers W-2G reporting. */
export function triggersW2G(
  winMinor: number,
  currency: string,
  threshold: TaxThresholdConfig = W2G_SLOT_THRESHOLD_USD_2024
): boolean {
  if (currency !== threshold.currency) {
    // Cross-currency check: caller should convert via FX before invoking.
    return false;
  }
  return winMinor >= threshold.slotWinMinor;
}

/**
 * Emit a W-2G event payload — operators stream this to their tax
 * pipeline. The payload deliberately omits PII (player identity) —
 * the operator's RGS layer joins this with the player profile.
 */
export interface W2GEvent {
  readonly kind: 'w2g_threshold_reached';
  readonly winMinor: number;
  readonly currency: string;
  readonly stakeMinor: number;
  readonly thresholdMinor: number;
  readonly source: string;
}

export function maybeW2GEvent(input: {
  winMinor: number;
  stakeMinor: number;
  currency: string;
  threshold?: TaxThresholdConfig;
}): W2GEvent | null {
  const t = input.threshold ?? W2G_SLOT_THRESHOLD_USD_2024;
  if (!triggersW2G(input.winMinor, input.currency, t)) return null;
  return {
    kind: 'w2g_threshold_reached',
    winMinor: input.winMinor,
    currency: input.currency,
    stakeMinor: input.stakeMinor,
    thresholdMinor: t.slotWinMinor,
    source: t.source ?? 'IRS W-2G',
  };
}

// ─── Bonus wagering requirement tracker ──────────────────────────────────────

/**
 * Bonus wagering requirement (WR) tracker. Operators credit a bonus
 * to a player wallet; the player must wager `bonusAmount × wrMultiplier`
 * of *eligible bets* before any winnings convert from "bonus" to
 * "cash" balance.
 *
 * UKGC SI 2025/215 + W149 BonusWageringValidator caps `wrMultiplier`
 * at 10× (effective 19 Dec 2025). This tracker enforces the per-spin
 * progress accounting against that cap.
 *
 * State transitions:
 *
 *   ┌─────────┐    bonus.eligibleProgress ≥ requirement     ┌─────────┐
 *   │ ACTIVE  │ ──────────────────────────────────────────► │ CLEARED │
 *   └────┬────┘                                              └─────────┘
 *        │ bonus.expiresAt < now                              ┌─────────┐
 *        └─────────────────────────────────────────────────► │ EXPIRED │
 *                                                            └─────────┘
 *                                                            ┌─────────┐
 *        ◄ bonus.forfeited === true ────────────────────────►│FORFEITED│
 *                                                            └─────────┘
 *
 * Calls are deterministic — caller supplies `now` for state-machine
 * deadlines so audit replays produce identical history.
 */

export type BonusWageringStatus = 'active' | 'cleared' | 'expired' | 'forfeited';

export interface BonusWageringState {
  readonly bonusId: string;
  /** Bonus amount granted (minor units). */
  readonly bonusAmountMinor: number;
  /** Total eligible-wager amount needed before clear (= bonus × WR). */
  readonly requirementMinor: number;
  /** Bonus expiry ISO timestamp. */
  readonly expiresAt: string;
  /** Player currency. */
  readonly currency: string;
  status: BonusWageringStatus;
  /** Cumulative eligible bet logged so far (minor units). */
  progressMinor: number;
  /** Status transition timestamps for audit. */
  readonly transitions: {
    activeAt: string;
    clearedAt?: string;
    expiredAt?: string;
    forfeitedAt?: string;
  };
}

export interface BonusWageringEvent {
  readonly kind:
    | 'bonus_progress'
    | 'bonus_cleared'
    | 'bonus_expired'
    | 'bonus_forfeited';
  readonly bonusId: string;
  readonly progressMinor: number;
  readonly requirementMinor: number;
}

/** UKGC SI 2025/215 cap. */
export const MAX_WAGERING_MULTIPLIER = 10;

export function createBonusWageringState(input: {
  bonusId: string;
  bonusAmountMinor: number;
  wrMultiplier: number;
  expiresAt: string;
  currency: string;
  now: string;
}): BonusWageringState {
  if (!input.bonusId) throw new RangeError('createBonusWageringState: bonusId required');
  if (input.bonusAmountMinor <= 0) {
    throw new RangeError('createBonusWageringState: bonusAmountMinor > 0 required');
  }
  if (input.wrMultiplier <= 0 || !Number.isFinite(input.wrMultiplier)) {
    throw new RangeError('createBonusWageringState: wrMultiplier > 0 required');
  }
  if (input.wrMultiplier > MAX_WAGERING_MULTIPLIER) {
    throw new RangeError(
      `createBonusWageringState: wrMultiplier ${input.wrMultiplier} > ${MAX_WAGERING_MULTIPLIER} (UKGC SI 2025/215 cap)`
    );
  }
  return {
    bonusId: input.bonusId,
    bonusAmountMinor: input.bonusAmountMinor,
    requirementMinor: input.bonusAmountMinor * input.wrMultiplier,
    expiresAt: input.expiresAt,
    currency: input.currency,
    status: 'active',
    progressMinor: 0,
    transitions: { activeAt: input.now },
  };
}

/**
 * Log an eligible bet against the bonus. Returns an event indicating
 * any state transition triggered. Idempotent for `cleared` / `expired`
 * / `forfeited` states (additional logs are no-ops).
 */
export function logEligibleWager(
  state: BonusWageringState,
  input: { betMinor: number; now: string }
): BonusWageringEvent {
  if (state.status !== 'active') {
    return {
      kind: 'bonus_progress',
      bonusId: state.bonusId,
      progressMinor: state.progressMinor,
      requirementMinor: state.requirementMinor,
    };
  }
  // Check expiry first — expiry takes precedence over progress.
  if (input.now > state.expiresAt) {
    state.status = 'expired';
    state.transitions.expiredAt = input.now;
    return {
      kind: 'bonus_expired',
      bonusId: state.bonusId,
      progressMinor: state.progressMinor,
      requirementMinor: state.requirementMinor,
    };
  }
  if (!Number.isFinite(input.betMinor) || input.betMinor < 0) {
    throw new RangeError('logEligibleWager: betMinor must be ≥ 0');
  }
  state.progressMinor += input.betMinor;
  if (state.progressMinor >= state.requirementMinor) {
    state.status = 'cleared';
    state.transitions.clearedAt = input.now;
    return {
      kind: 'bonus_cleared',
      bonusId: state.bonusId,
      progressMinor: state.progressMinor,
      requirementMinor: state.requirementMinor,
    };
  }
  return {
    kind: 'bonus_progress',
    bonusId: state.bonusId,
    progressMinor: state.progressMinor,
    requirementMinor: state.requirementMinor,
  };
}

export function forfeitBonus(
  state: BonusWageringState,
  input: { now: string }
): BonusWageringEvent {
  if (state.status === 'active') {
    state.status = 'forfeited';
    state.transitions.forfeitedAt = input.now;
  }
  return {
    kind: 'bonus_forfeited',
    bonusId: state.bonusId,
    progressMinor: state.progressMinor,
    requirementMinor: state.requirementMinor,
  };
}

/** True if the bonus can convert to cash balance. */
export function isBonusCleared(state: BonusWageringState): boolean {
  return state.status === 'cleared';
}
