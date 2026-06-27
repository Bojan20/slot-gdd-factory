/**
 * W152 P2-11 — RgsProtocol — the engine-facing surface integrators
 * implement to plug their RGS into the slot template.
 *
 * The protocol bundles four concerns:
 *   1. **Wallet calls** — `debit / credit / rollback / balance` via
 *      the injected `WalletBackend`.
 *   2. **Auth signing** — request envelopes signed via the injected
 *      `AuthSigner` (HMAC / JWT / RSA — see `auth/`).
 *   3. **Round event emission** — each `RoundEvent` is forwarded to a
 *      caller-supplied sink (typically the AML telemetry emitter from
 *      P2-13).
 *   4. **Promo token routing** — when a bet carries a `promoToken`,
 *      the protocol calls `validatePromo()` first and short-circuits
 *      the real-balance debit when the token is accepted.
 *
 * This is a thin orchestrator: no business rules beyond the
 * idempotency contract documented in `wallet.ts`. Latency is
 * end-to-end sub-200 ms p99 at the LCD per KIMI 13.
 */

import type { AuthSigner } from './auth/index.js';
import type {
  BalanceResponse,
  BetRequest,
  RoundEvent,
  WalletResult,
  WinRequest,
} from './types.js';
import type { WalletBackend } from './wallet.js';
import { canonicalJson } from './auth/index.js';

/** Caller-supplied promo token validator. */
export type PromoValidator = (
  token: string,
  bet: BetRequest,
) => Promise<{ valid: boolean; reason?: string }>;

/** Caller-supplied event sink (RoundEvent → AML telemetry / dashboard). */
export type RoundEventSink = (event: RoundEvent) => Promise<void>;

export interface RgsProtocolConfig {
  wallet: WalletBackend;
  signer: AuthSigner;
  /** Required when promo tokens are accepted; otherwise `undefined`. */
  promoValidator?: PromoValidator;
  /** Required when RoundEvents must reach AML / observability. */
  roundEventSink?: RoundEventSink;
  /** Maximum end-to-end latency budget per round in ms. p99 < 200 ms
   *  is the KIMI 13 LCD. The protocol enforces this as a wall-clock
   *  guard; exceedances throw `UPSTREAM_TIMEOUT`. */
  roundDeadlineMs?: number;
}

export class RgsProtocol {
  constructor(private readonly cfg: RgsProtocolConfig) {}

  get walletId(): string {
    return this.cfg.wallet.backendId;
  }

  get signerScheme(): string {
    return this.cfg.signer.schemeId;
  }

  /**
   * Sign a request envelope. Returns the signature bytes that the
   * caller appends to the outgoing payload (header or body field per
   * the upstream's protocol).
   */
  signEnvelope(body: unknown): Promise<Uint8Array> {
    const canonical = canonicalJson(body);
    const bytes = new TextEncoder().encode(canonical);
    return this.cfg.signer.sign(bytes);
  }

  /** Verify a previously signed envelope. */
  verifyEnvelope(body: unknown, signature: Uint8Array): Promise<boolean> {
    const canonical = canonicalJson(body);
    const bytes = new TextEncoder().encode(canonical);
    return this.cfg.signer.verify(bytes, signature);
  }

  /**
   * Atomic debit-before-RNG with promo-token short-circuit. Returns
   * the wallet result so the caller can branch on `ok`.
   */
  async debit(req: BetRequest): Promise<WalletResult<BalanceResponse>> {
    if (req.promoToken && this.cfg.promoValidator) {
      const promo = await this.cfg.promoValidator(req.promoToken, req);
      if (!promo.valid) {
        return {
          ok: false,
          error: { code: 'AUTH_FAILED', message: `invalid promo: ${promo.reason ?? 'unknown'}` },
        };
      }
      // Valid promo → forward to wallet which honours the token and
      // bypasses real-balance debit (see `InMemoryMockWallet.debit`).
    }
    return this.cfg.wallet.debit(req);
  }

  credit(req: WinRequest): Promise<WalletResult<BalanceResponse>> {
    return this.cfg.wallet.credit(req);
  }

  rollback(transactionUuid: string): Promise<WalletResult<BalanceResponse>> {
    return this.cfg.wallet.rollback(transactionUuid);
  }

  balance(
    playerId: string,
    currency: string,
  ): Promise<WalletResult<BalanceResponse>> {
    return this.cfg.wallet.balance(playerId, currency);
  }

  /** Forward a round event to the configured sink. No-op if absent. */
  async emitRoundEvent(event: RoundEvent): Promise<void> {
    await this.cfg.roundEventSink?.(event);
  }

  /**
   * Wrap an arbitrary round operation with the configured deadline
   * (default 200 ms per KIMI 13 LCD). Returns the underlying value or
   * throws `UPSTREAM_TIMEOUT`.
   */
  async withDeadline<T>(op: () => Promise<T>): Promise<T> {
    const deadlineMs = this.cfg.roundDeadlineMs ?? 200;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        op(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`UPSTREAM_TIMEOUT after ${deadlineMs}ms`)),
            deadlineMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
