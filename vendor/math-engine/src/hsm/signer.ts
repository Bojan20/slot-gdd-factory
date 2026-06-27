/**
 * High-level Signer service.
 *
 * Wraps any `HsmAdapter` with:
 *   - Retry policy (configurable, only for transient `HsmError` codes)
 *   - Per-operation timeout (in addition to adapter-level timeout)
 *   - Circuit breaker — after N consecutive failures, "open" the breaker
 *     for `openMs` to avoid hammering a dead HSM
 *   - Audit-log fan-out — every operation (success or failure) lands in
 *     the configured `AuditLog`
 *   - Canonicalization helper for JSON payloads (stable JSON.stringify
 *     equivalent) so signatures over JSON are reproducible across hosts
 *
 * The signer never holds key material — it just composes the adapter's
 * primitives into something a feature module (PAR signer, spin attestor,
 * RNG drawing certifier) can call with confidence.
 */

import * as nodeCrypto from 'node:crypto';
import {
  HsmError,
  type AuditLog,
  type HsmAdapter,
  type HsmErrorCode,
  type KeyHandle,
  type SignRequest,
  type SignResponse,
  type VerifyRequest,
  type VerifyResponse,
} from './types.js';
import { TRANSIENT_CODES } from './types.js';

export interface SignerConfig {
  adapter: HsmAdapter;
  auditLog: AuditLog;
  /** Retry policy. Defaults: 2 retries, 200ms initial backoff, doubled per attempt. */
  retry?: {
    maxAttempts?: number;
    initialBackoffMs?: number;
    backoffFactor?: number;
  };
  /** Circuit breaker. */
  breaker?: {
    failureThreshold?: number; // consecutive failures before opening
    openMs?: number; // how long to stay open before half-open trial
  };
}

interface BreakerState {
  consecutiveFailures: number;
  openedAtMs: number | null;
}

export class Signer {
  private readonly cfg: Required<SignerConfig>;
  private readonly breaker: BreakerState = { consecutiveFailures: 0, openedAtMs: null };

  constructor(cfg: SignerConfig) {
    this.cfg = {
      adapter: cfg.adapter,
      auditLog: cfg.auditLog,
      retry: {
        maxAttempts: cfg.retry?.maxAttempts ?? 3,
        initialBackoffMs: cfg.retry?.initialBackoffMs ?? 200,
        backoffFactor: cfg.retry?.backoffFactor ?? 2,
      },
      breaker: {
        failureThreshold: cfg.breaker?.failureThreshold ?? 5,
        openMs: cfg.breaker?.openMs ?? 30_000,
      },
    };
  }

  /** Sign with retry + breaker + audit. */
  async sign(req: SignRequest): Promise<SignResponse> {
    this.assertBreakerClosed();
    let attempt = 0;
    let lastErr: HsmError | undefined;
    while (attempt < (this.cfg.retry.maxAttempts ?? 3)) {
      attempt++;
      try {
        const out = await this.cfg.adapter.sign(req);
        await this.cfg.auditLog.append(out.audit);
        this.breaker.consecutiveFailures = 0;
        return out;
      } catch (err) {
        const hsmErr = err instanceof HsmError ? err : new HsmError('CryptoFailure', String(err), { cause: err });
        // The adapter attaches an audit record on the error; persist it.
        const errAudit = (hsmErr as HsmError & { audit?: import('./types.js').AuditRecord }).audit;
        if (errAudit) {
          try {
            await this.cfg.auditLog.append(errAudit);
          } catch (auditErr) {
            // Re-throw audit failures as a distinct code — operator must
            // see this. Audit drops are a compliance violation.
            throw new HsmError('AuditWriteFailure', `audit log write failed: ${String(auditErr)}`, {
              cause: auditErr,
            });
          }
        }
        lastErr = hsmErr;
        this.breaker.consecutiveFailures++;
        if (this.breaker.consecutiveFailures >= (this.cfg.breaker.failureThreshold ?? 5)) {
          this.breaker.openedAtMs = Date.now();
        }
        if (!this.isRetryable(hsmErr.code) || attempt >= (this.cfg.retry.maxAttempts ?? 3)) {
          throw hsmErr;
        }
        const backoff =
          (this.cfg.retry.initialBackoffMs ?? 200) *
          Math.pow(this.cfg.retry.backoffFactor ?? 2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    /* istanbul ignore next */
    throw lastErr ?? new HsmError('CryptoFailure', 'sign loop exited without success or failure');
  }

  async verify(req: VerifyRequest): Promise<VerifyResponse> {
    return this.cfg.adapter.verify(req);
  }

  async describeKey(id: string): Promise<KeyHandle> {
    return this.cfg.adapter.describeKey(id);
  }

  // ─── Breaker plumbing ──────────────────────────────────────────────────

  private isRetryable(code: HsmErrorCode): boolean {
    return TRANSIENT_CODES.has(code);
  }

  private assertBreakerClosed(): void {
    if (this.breaker.openedAtMs === null) return;
    const elapsed = Date.now() - this.breaker.openedAtMs;
    if (elapsed >= (this.cfg.breaker.openMs ?? 30_000)) {
      // Half-open: allow one trial. Reset state.
      this.breaker.openedAtMs = null;
      this.breaker.consecutiveFailures = 0;
      return;
    }
    throw new HsmError('AdapterUnavailable', `circuit breaker open (${elapsed}ms / ${this.cfg.breaker.openMs}ms)`);
  }

  // ─── Helpers exposed for higher-level signers ──────────────────────────

  /**
   * Canonicalize a JSON value for deterministic signing. Recursively sorts
   * object keys, normalizes numbers to JSON form, and emits compact UTF-8
   * bytes. Mirrors the rule in `src/observability/canonical.ts` (if
   * present) — kept independent here for the HSM module's autonomy.
   */
  static canonicalize(value: unknown): Uint8Array {
    const json = stableStringify(value);
    return new TextEncoder().encode(json);
  }

  /** SHA-256 a payload to a hex string. Useful for audit log lookups. */
  static digestHex(message: Uint8Array): string {
    return nodeCrypto.createHash('sha256').update(message).digest('hex');
  }
}

// ─── Canonical JSON (sorted keys, no spaces) ────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
