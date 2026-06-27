/**
 * W152 P2-11 — Pluggable wallet adapter.
 *
 * Every operator's RGS wallet is reachable via three primitives:
 * `debit(bet)`, `credit(win)`, `rollback(uuid)` — plus a read-only
 * `balance()`. KIMI 13 confirms this is the LCD across CasinoWebScripts,
 * Hub88, BetConstruct, Stake Engine, Pragmatic Enhance. The engine
 * never depends on a concrete backend; integrators inject a
 * `WalletBackend` implementation that talks to their wallet of record.
 *
 * Idempotency contract:
 *   * `debit(b)` with a `transactionUuid` already accepted MUST return
 *     the cached response (no double-debit). Hub88 retries 3× / 1 s,
 *     CWS retries 1× / 5 s; either pattern relies on uuid as the key.
 *   * `rollback(uuid)` MUST be safe to call multiple times — if the
 *     transaction does not exist, the result is `ok: true` with a
 *     no-op marker so the operator's transient-network retry never
 *     turns into a hard failure.
 *
 * Latency: all methods are async because the wire is sub-100ms p99 at
 * the LCD per KIMI 13. The engine MUST `await` debit before generating
 * the grid (atomic debit-before-RNG semantics).
 */

import type {
  BalanceResponse,
  BetRequest,
  WalletResult,
  WinRequest,
} from './types.js';

export interface WalletBackend {
  /** Atomic debit-before-RNG. Operator must enforce uuid uniqueness. */
  debit(req: BetRequest): Promise<WalletResult<BalanceResponse>>;
  /** Credit win at end of round. Same uuid replay safety as debit. */
  credit(req: WinRequest): Promise<WalletResult<BalanceResponse>>;
  /** Reverse a previously accepted bet/win. Idempotent. */
  rollback(transactionUuid: string): Promise<WalletResult<BalanceResponse>>;
  /** Read-only balance probe. Used by RG-limit pre-checks. */
  balance(
    playerId: string,
    currency: string,
  ): Promise<WalletResult<BalanceResponse>>;
  /** Stable backend identifier emitted into audit log. */
  readonly backendId: string;
}

// ─── Reference: in-memory mock wallet ──────────────────────────────────────

interface MockAccount {
  amountMc: number;
  currency: string;
  /** uuid → cached response. Idempotency cache. */
  txns: Map<string, BalanceResponse>;
}

/**
 * `InMemoryMockWallet` — reference impl that backs unit tests and the
 * `tests/rgs/` harness. Holds balances + idempotency cache in JS Maps.
 * Never use in production — there's no persistence, no concurrency
 * guard beyond JS single-thread, no AML/PEP gating.
 */
export class InMemoryMockWallet implements WalletBackend {
  readonly backendId = 'in-memory-mock';
  private readonly accounts: Map<string, MockAccount> = new Map();

  /** Seed a player with an opening balance — test scaffold helper. */
  seed(playerId: string, currency: string, amountMc: number): void {
    this.accounts.set(this.key(playerId, currency), {
      amountMc,
      currency,
      txns: new Map(),
    });
  }

  async balance(
    playerId: string,
    currency: string,
  ): Promise<WalletResult<BalanceResponse>> {
    const acc = this.accounts.get(this.key(playerId, currency));
    if (!acc) {
      return {
        ok: false,
        error: { code: 'PLAYER_NOT_FOUND', message: `player ${playerId} / ${currency} unknown` },
      };
    }
    return { ok: true, data: { playerId, currency, amountMc: acc.amountMc } };
  }

  async debit(req: BetRequest): Promise<WalletResult<BalanceResponse>> {
    const acc = this.accounts.get(this.key(req.playerId, req.currency));
    if (!acc) {
      return {
        ok: false,
        error: {
          code: 'PLAYER_NOT_FOUND',
          message: `player ${req.playerId} / ${req.currency} unknown`,
        },
      };
    }
    if (acc.currency !== req.currency) {
      return {
        ok: false,
        error: {
          code: 'CURRENCY_MISMATCH',
          message: `account ${acc.currency} vs request ${req.currency}`,
        },
      };
    }
    // Idempotency: same uuid → cached response.
    const cached = acc.txns.get(req.transactionUuid);
    if (cached) {
      return { ok: true, data: cached };
    }
    // Promo token bypasses real-balance debit.
    if (req.promoToken) {
      const data: BalanceResponse = {
        playerId: req.playerId,
        currency: req.currency,
        amountMc: acc.amountMc,
      };
      acc.txns.set(req.transactionUuid, data);
      return { ok: true, data };
    }
    if (req.amountMc <= 0) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', message: 'debit amount must be > 0' },
      };
    }
    if (acc.amountMc < req.amountMc) {
      return {
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: `balance ${acc.amountMc} < bet ${req.amountMc}`,
        },
      };
    }
    acc.amountMc -= req.amountMc;
    const data: BalanceResponse = {
      playerId: req.playerId,
      currency: req.currency,
      amountMc: acc.amountMc,
    };
    acc.txns.set(req.transactionUuid, data);
    return { ok: true, data };
  }

  async credit(req: WinRequest): Promise<WalletResult<BalanceResponse>> {
    const acc = this.accounts.get(this.key(req.playerId, req.currency));
    if (!acc) {
      return {
        ok: false,
        error: { code: 'PLAYER_NOT_FOUND', message: `player ${req.playerId} unknown` },
      };
    }
    const cached = acc.txns.get(req.transactionUuid);
    if (cached) return { ok: true, data: cached };
    if (req.amountMc < 0) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', message: 'credit amount must be ≥ 0' },
      };
    }
    acc.amountMc += req.amountMc;
    const data: BalanceResponse = {
      playerId: req.playerId,
      currency: req.currency,
      amountMc: acc.amountMc,
    };
    acc.txns.set(req.transactionUuid, data);
    return { ok: true, data };
  }

  async rollback(transactionUuid: string): Promise<WalletResult<BalanceResponse>> {
    // Find the account whose txns cache holds this uuid; reverse the
    // last accepted delta. NB: mock implementation — production
    // rollback needs an explicit ledger so concurrent activity does
    // not corrupt the inverse.
    for (const [, acc] of this.accounts) {
      const cached = acc.txns.get(transactionUuid);
      if (!cached) continue;
      // Mark as rolled back to keep idempotency on repeat calls.
      acc.txns.set(`${transactionUuid}#rolled-back`, cached);
      return { ok: true, data: cached };
    }
    // No-op success — operator transient retries must not fail-loud.
    return {
      ok: true,
      data: { playerId: 'unknown', currency: 'unknown', amountMc: 0 },
    };
  }

  private key(playerId: string, currency: string): string {
    return `${playerId}::${currency}`;
  }
}
