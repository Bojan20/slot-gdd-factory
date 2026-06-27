/**
 * W152 P2-12 — Self-exclusion client + circuit breaker.
 *
 * Per KIMI 11, 2025–2026 regulators (UKGC, MGA, Spelpaus, GGL, KSA,
 * AGCO, Spillemyndigheden) all run their own self-exclusion registry
 * which the operator MUST query in real-time before letting a player
 * deposit or spin. Cached answers are **explicitly non-compliant**
 * (SBC News 2025: GAMSTOP cached status violates regulatory intent).
 *
 * This module ships:
 *   1. `SelfExclusionProvider` — pluggable per-jurisdiction interface.
 *      Operators implement one impl per real registry (GAMSTOP HTTPS,
 *      OASIS POST /spielerstatus, Spelpaus Actor-ID/API-Key, …).
 *   2. `CircuitBreaker` — minimal half-open breaker (closed → open →
 *      half-open → closed) so a sustained registry outage doesn't
 *      hold the spin loop. Default budget: 500 ms p99 per call
 *      (KIMI 11 LCD).
 *   3. `SelfExclusionClient` — fans out queries to all configured
 *      providers in parallel, applies the breaker, emits an audit
 *      `SELF_EXCLUSION_LOOKUP` event per call, and returns a single
 *      `excluded` boolean. Fail-closed semantics: any provider that
 *      returns `excluded:true` blocks; if every provider's breaker
 *      is open and `failClosed` is true (default), the player is
 *      blocked rather than waved through.
 *
 * The module never reads or stores PII beyond the operator-supplied
 * `playerId` — handler of any registry-mandated transformation
 * (hashing, encrypting) lives in the provider impl, not here.
 */

import type { RGHookEmitter } from './hooks.js';

// ─── Provider abstraction ──────────────────────────────────────────────────

export type SelfExclusionRegistry =
  | 'GAMSTOP' // UKGC
  | 'OASIS' // Germany GGL
  | 'SPELPAUS' // Sweden Spelinspektionen
  | 'ROFUS' // Denmark Spillemyndigheden
  | 'CRUKS' // Netherlands KSA
  | 'AGCO_CSE'; // Ontario Centralized Self-Exclusion

export interface SelfExclusionProvider {
  /** Stable registry identifier. */
  readonly registry: SelfExclusionRegistry;
  /** Issue a real-time lookup. MUST return within the deadline or
   *  reject; cached answers violate regulatory intent and are
   *  explicitly forbidden by `SelfExclusionClient` semantics. */
  query(playerId: string, deadlineMs: number): Promise<{ excluded: boolean }>;
}

// ─── Circuit breaker ──────────────────────────────────────────────────────

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening. Default 5. */
  failureThreshold?: number;
  /** Wall-clock ms to wait in `open` before flipping to `half-open`.
   *  Default 30 s — registry SLAs typically recover within 30 s. */
  recoveryMs?: number;
  /** Override `Date.now()` for deterministic tests. */
  now?: () => number;
}

/**
 * Minimal three-state breaker. The implementation is sync because the
 * breaker tracks counters only — the async work is the wrapped
 * operation, which the caller awaits before calling `onSuccess` /
 * `onFailure`.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly recoveryMs: number;
  private readonly now: () => number;

  constructor(cfg: CircuitBreakerConfig = {}) {
    this.failureThreshold = cfg.failureThreshold ?? 5;
    this.recoveryMs = cfg.recoveryMs ?? 30_000;
    this.now = cfg.now ?? Date.now;
  }

  /** Is the gate currently letting traffic through? */
  canPass(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return true;
    // open → maybe time to flip to half-open
    if (this.now() - this.openedAt >= this.recoveryMs) {
      this.state = 'half-open';
      return true;
    }
    return false;
  }

  /** Caller MUST invoke after a successful pass. Resets the breaker. */
  onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  /** Caller MUST invoke after a failure. Opens the breaker once the
   *  threshold is crossed. */
  onFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  /** Diagnostic accessor — used by tests + dashboards. */
  snapshot(): { state: BreakerState; failures: number; openedAt: number } {
    return { state: this.state, failures: this.failures, openedAt: this.openedAt };
  }
}

// ─── Client ───────────────────────────────────────────────────────────────

export interface SelfExclusionClientConfig {
  providers: SelfExclusionProvider[];
  /** Per-call deadline. KIMI 11 LCD = 500 ms p99. */
  deadlineMs?: number;
  /** Fail-closed = block when every breaker is open. Default true
   *  (regulatory safety). */
  failClosed?: boolean;
  /** Optional `RGHookEmitter` to receive `SELF_EXCLUSION_LOOKUP`
   *  audit events per call. */
  emitter?: RGHookEmitter;
  /** Per-provider breaker config — applied to every provider. */
  breakerConfig?: CircuitBreakerConfig;
}

export interface SelfExclusionResult {
  excluded: boolean;
  /** Which registry returned `excluded:true`, if any. */
  registry?: SelfExclusionRegistry;
  /** Per-provider breakdown for audit. */
  perProvider: Array<{
    registry: SelfExclusionRegistry;
    excluded: boolean;
    latencyMs: number;
    error?: string;
    breakerTripped: boolean;
  }>;
}

/**
 * `SelfExclusionClient` — fan-out across all configured providers.
 *
 * Calls are issued in parallel. The first provider returning
 * `excluded:true` short-circuits the verdict (player blocked); if
 * every provider returns `excluded:false` the player is cleared. If
 * the breaker is open for a provider, the call is skipped and the
 * `breakerTripped` flag set in the per-provider audit slice.
 *
 * Latency: bounded by `deadlineMs` (default 500 ms). The client
 * `Promise.race`s every call against a timeout — slow providers do
 * not delay the verdict.
 */
export class SelfExclusionClient {
  private readonly providers: SelfExclusionProvider[];
  private readonly breakers: Map<SelfExclusionRegistry, CircuitBreaker>;
  private readonly deadlineMs: number;
  private readonly failClosed: boolean;
  private readonly emitter?: RGHookEmitter;

  constructor(cfg: SelfExclusionClientConfig) {
    this.providers = cfg.providers;
    this.deadlineMs = cfg.deadlineMs ?? 500;
    this.failClosed = cfg.failClosed ?? true;
    this.emitter = cfg.emitter;
    this.breakers = new Map();
    for (const p of cfg.providers) {
      this.breakers.set(p.registry, new CircuitBreaker(cfg.breakerConfig));
    }
  }

  /** Snapshot of breaker state per registry — diagnostics only. */
  breakerStates(): Record<string, BreakerState> {
    const out: Record<string, BreakerState> = {};
    for (const [k, b] of this.breakers) {
      out[k] = b.snapshot().state;
    }
    return out;
  }

  /**
   * Issue a real-time exclusion check across all providers.
   * Emits one `SELF_EXCLUSION_LOOKUP` per provider when an emitter
   * is configured. Returns once every provider has resolved (or
   * tripped its breaker / timed out).
   */
  async query(
    sessionId: string,
    playerId: string,
  ): Promise<SelfExclusionResult> {
    const tasks = this.providers.map((p) => this.queryOne(sessionId, playerId, p));
    const perProvider = await Promise.all(tasks);
    const excludedHit = perProvider.find((r) => r.excluded);
    if (excludedHit) {
      return {
        excluded: true,
        registry: excludedHit.registry,
        perProvider,
      };
    }
    // Determine fail-closed verdict: if every provider has its
    // breaker open AND nobody returned excluded, fail closed (block).
    const allOpen = perProvider.every((r) => r.breakerTripped);
    if (allOpen && this.failClosed) {
      return { excluded: true, perProvider };
    }
    return { excluded: false, perProvider };
  }

  private async queryOne(
    sessionId: string,
    playerId: string,
    p: SelfExclusionProvider,
  ): Promise<SelfExclusionResult['perProvider'][number]> {
    const breaker = this.breakers.get(p.registry);
    if (!breaker || !breaker.canPass()) {
      this.emit({
        sessionId,
        playerId,
        registry: p.registry,
        excluded: this.failClosed,
        latencyMs: 0,
        breakerTripped: true,
      });
      return {
        registry: p.registry,
        excluded: this.failClosed,
        latencyMs: 0,
        breakerTripped: true,
      };
    }

    const start = Date.now();
    try {
      const result = await Promise.race([
        p.query(playerId, this.deadlineMs),
        new Promise<{ excluded: boolean }>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), this.deadlineMs),
        ),
      ]);
      breaker.onSuccess();
      const latency = Date.now() - start;
      this.emit({
        sessionId,
        playerId,
        registry: p.registry,
        excluded: result.excluded,
        latencyMs: latency,
      });
      return {
        registry: p.registry,
        excluded: result.excluded,
        latencyMs: latency,
        breakerTripped: false,
      };
    } catch (err) {
      breaker.onFailure();
      const latency = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      this.emit({
        sessionId,
        playerId,
        registry: p.registry,
        excluded: this.failClosed,
        latencyMs: latency,
        breakerTripped: false,
        error,
      });
      return {
        registry: p.registry,
        excluded: this.failClosed,
        latencyMs: latency,
        breakerTripped: false,
        error,
      };
    }
  }

  private emit(payload: {
    sessionId: string;
    playerId: string;
    registry: SelfExclusionRegistry;
    excluded: boolean;
    latencyMs: number;
    breakerTripped?: boolean;
    error?: string;
  }): void {
    this.emitter?.emit({
      kind: 'SELF_EXCLUSION_LOOKUP',
      sessionId: payload.sessionId,
      ts: Date.now(),
      detail: {
        provider: payload.registry,
        playerId: payload.playerId,
        excluded: payload.excluded,
        latencyMs: payload.latencyMs,
        circuitBreakerTripped: payload.breakerTripped,
      },
    });
  }
}

// ─── Mock provider (reference impl for tests) ──────────────────────────────

/**
 * `StubSelfExclusionProvider` — deterministic, configurable mock for
 * tests. Operators implement their own real HTTPS provider in
 * production.
 */
export class StubSelfExclusionProvider implements SelfExclusionProvider {
  constructor(
    readonly registry: SelfExclusionRegistry,
    private readonly responses: Map<string, { excluded: boolean; delayMs?: number; throws?: string }>,
  ) {}

  async query(playerId: string, _deadlineMs: number): Promise<{ excluded: boolean }> {
    const r = this.responses.get(playerId) ?? { excluded: false };
    if (r.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, r.delayMs));
    }
    if (r.throws) {
      throw new Error(r.throws);
    }
    return { excluded: r.excluded };
  }
}
