/**
 * W152 P2-11 — RGS (Remote Gaming Server) shared types.
 *
 * Canonical bet / win lifecycle envelope. Mirrors the LCD across
 * CasinoWebScripts / Hub88 / Stake Engine / BetConstruct REST APIs
 * per KIMI 13 (`docs/W152/13-rgs-integration-protocols.md`).
 *
 * Numerical convention: all amounts are integer **millicredits**
 * (1 credit = 1000 mc) to keep adapter math floating-point free.
 * Currency code is a free-form ISO-4217 string ("EUR", "USD", "GBP",
 * "CRY" for crypto-native operators).
 */

/** A single bet request from the operator. */
export interface BetRequest {
  /** Server-generated idempotency UUID. Hub88 + CWS + Stake Engine
   *  all require this; replay must return cached response. */
  transactionUuid: string;
  /** Stable operator-side player identifier. NEVER PII. */
  playerId: string;
  /** ISO-4217 currency. */
  currency: string;
  /** Total bet amount in millicredits. Positive integer. */
  amountMc: number;
  /** Game identifier (vendor:game version). */
  gameId: string;
  /** Round identifier — couples bet, free-spin awards, and credit
   *  back into one auditable chain. */
  roundId: string;
  /** Optional promo token (free-spin allocation). Suppresses
   *  real-balance debit when valid. */
  promoToken?: string;
  /** Per-vendor metadata blob (RTP variant, jackpot opt-in, …). */
  metadata?: Record<string, string | number | boolean>;
}

/** Win credit request — emitted at end of round. */
export interface WinRequest {
  transactionUuid: string;
  playerId: string;
  currency: string;
  amountMc: number;
  gameId: string;
  roundId: string;
  /** True if the credit is the result of a free spin / promo round. */
  isPromo?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

/** Wallet balance snapshot. */
export interface BalanceResponse {
  playerId: string;
  currency: string;
  amountMc: number;
}

/** Common error shape — every adapter normalises into this. */
export interface WalletError {
  code:
    | 'INSUFFICIENT_FUNDS'
    | 'PLAYER_NOT_FOUND'
    | 'CURRENCY_MISMATCH'
    | 'DUPLICATE_TRANSACTION'
    | 'AUTH_FAILED'
    | 'UPSTREAM_TIMEOUT'
    | 'UNAVAILABLE';
  message: string;
  /** Vendor-side trace id, if the upstream supplied one. */
  upstreamTraceId?: string;
}

/** Result envelope. Either `data` or `error` is present, never both. */
export type WalletResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: WalletError };

/** Round event emitted by the engine after every spin — feeds RGS
 *  observability + AML telemetry without coupling to the wallet. */
export interface RoundEvent {
  playerId: string;
  roundId: string;
  gameId: string;
  betUuid: string;
  winUuid?: string;
  /** Spin wall-clock duration in ms (engine-measured). */
  elapsedMs: number;
  /** SHA-256 of the canonical spin transcript — operators store
   *  this as the audit primary key. */
  complianceHash: string;
  /** UTC ISO timestamp of round close. */
  ts: string;
}
