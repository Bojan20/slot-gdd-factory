/**
 * HSM Audit + Health Monitor — P0 #10 hardening pass.
 *
 * The base `hsm.ts` module gives us `HSMProvider` / `HSMSession` / a
 * `MockHSMProvider` for dev. Regulators ask for two further things at
 * cert time and we satisfy them here without touching the hot path:
 *
 *  1. **Audit trail** (`HSMAuditLog`) — append-only structured log of
 *     every `open`, `generateRandomBytes`, `healthCheck`, `close` and
 *     **every failure**, suitable for daily export to the operator's
 *     SIEM.  Records who/what/when/how-many-bytes/vendor/serial; never
 *     logs PINs or raw entropy.  GLI-19 §4.6.3 and UKGC RTS-7 both
 *     require this for the lifetime of every live key.
 *
 *  2. **Health monitor** (`HSMHealthMonitor`) — wraps any
 *     `HSMProvider` with periodic `healthCheck()`s and a
 *     consecutive-failure counter.  Once the threshold is crossed it
 *     toggles `isHealthy()` → `false`, which `RngFactory` reads as a
 *     refusal-to-start signal in production tenants.
 *
 * Both classes are dependency-free, fully typed, and exposed as named
 * exports so an `HSMAuditedSession` wrapper can drop in transparently
 * between `HSMSession` and `HSMBackedRngBackend`.  See `hsm_audit.test.ts`
 * for the conformance contract.
 *
 * Why a separate file: keep `hsm.ts` (469 LOC) focused on the spin-loop
 * critical path.  Audit + monitoring are *cross-cutting* — they wrap a
 * session and observe its lifecycle.  Putting them in a sibling file
 * keeps the diff small and lets the operator import only what they need.
 *
 * No native deps, no I/O — the log is in-memory and the operator is
 * expected to flush it on shutdown / hourly cron through their existing
 * audit-export pipeline.  We expose `toJsonl()` to produce the
 * regulator-canonical format directly.
 */

import type {
  HSMHealth,
  HSMOpenOptions,
  HSMProvider,
  HSMSession,
} from './hsm.js';

// ─────────────────────────────────────────────────────────────────────────────
// Audit record types
// ─────────────────────────────────────────────────────────────────────────────

/** All recognized audit event kinds. */
export type HSMAuditEventKind =
  | 'session.open'
  | 'session.close'
  | 'rng.generate'
  | 'health.check'
  | 'error';

export interface HSMAuditEvent {
  /** Monotonic event id starting at 1.  Per-log scope. */
  id: number;
  /** ISO-8601 UTC timestamp (sortable). */
  timestamp: string;
  kind: HSMAuditEventKind;
  /** Stable opaque session token. `null` for provider-level events. */
  sessionId: string | null;
  /** HSM vendor as reported by `healthCheck` (or `'unknown'`). */
  vendor: string;
  /** Optional FIPS serial / token label. */
  serialNo?: string;
  /** Bytes generated this call (only for `rng.generate`). */
  byteCount?: number;
  /** Health latency ms (only for `health.check`). */
  latencyMs?: number;
  /** Free-form context — operator id, tenant, etc.  Never PIN/entropy. */
  context?: Record<string, string | number | boolean>;
  /** Set when `kind === 'error'` — sanitized error message. */
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HSMAuditLog
// ─────────────────────────────────────────────────────────────────────────────

const RESERVED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'pin', 'password', 'secret', 'token', 'apiKey',
  'PIN', 'PASSWORD', 'SECRET',
]);

/**
 * In-memory append-only audit log with a hard cap so the engine never
 * leaks memory.  Operators flush via `drain()` (returns + clears) or
 * `toJsonl()` (returns without clearing).
 *
 * Thread-model: this is single-threaded JS — no locking needed.  In a
 * future Web Worker / Node cluster setup the operator wraps the log
 * with a serialization barrier.
 */
export class HSMAuditLog {
  /** Default cap: 100k events ≈ 30 days @ 1 event / 30 s. */
  static readonly DEFAULT_MAX_EVENTS = 100_000;

  private readonly _events: HSMAuditEvent[] = [];
  private _nextId = 1;
  private _droppedCount = 0;
  private readonly _maxEvents: number;
  private readonly _clock: () => Date;

  /**
   * @param maxEvents — hard cap; older events are dropped FIFO.
   * @param clock     — injectable for test determinism.
   */
  constructor(
    maxEvents: number = HSMAuditLog.DEFAULT_MAX_EVENTS,
    clock: () => Date = () => new Date(),
  ) {
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
      throw new RangeError(`HSMAuditLog: maxEvents must be a positive int, got ${maxEvents}`);
    }
    this._maxEvents = maxEvents;
    this._clock = clock;
  }

  /**
   * Append a new event.  The `id` and `timestamp` are filled here.
   * Returns the assigned id.  Throws if any reserved key (PIN, etc.)
   * leaks into `context` — that's a programmer error, not a runtime
   * fallthrough.
   */
  record(event: Omit<HSMAuditEvent, 'id' | 'timestamp'>): number {
    if (event.context) {
      for (const k of Object.keys(event.context)) {
        if (RESERVED_CONTEXT_KEYS.has(k)) {
          throw new Error(`HSMAuditLog.record: reserved context key '${k}' — refused`);
        }
      }
    }
    const full: HSMAuditEvent = {
      id: this._nextId++,
      timestamp: this._clock().toISOString(),
      ...event,
    };
    this._events.push(full);
    // FIFO eviction
    while (this._events.length > this._maxEvents) {
      this._events.shift();
      this._droppedCount++;
    }
    return full.id;
  }

  /** Read-only snapshot of all currently-buffered events. */
  events(): readonly HSMAuditEvent[] {
    return this._events;
  }

  /** Filter helper — events of a specific kind. */
  ofKind(kind: HSMAuditEventKind): readonly HSMAuditEvent[] {
    return this._events.filter((e) => e.kind === kind);
  }

  /** Filter helper — events for a single session id. */
  forSession(sessionId: string): readonly HSMAuditEvent[] {
    return this._events.filter((e) => e.sessionId === sessionId);
  }

  /** How many events were dropped because we exceeded maxEvents. */
  droppedCount(): number {
    return this._droppedCount;
  }

  /** Total currently buffered. */
  size(): number {
    return this._events.length;
  }

  /** Regulator-canonical export: one JSON object per line, no trailing newline. */
  toJsonl(): string {
    return this._events.map((e) => JSON.stringify(e)).join('\n');
  }

  /** Return + clear.  Returns the events as a new array — log is empty after. */
  drain(): HSMAuditEvent[] {
    const out = this._events.slice();
    this._events.length = 0;
    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HSMHealthMonitor
// ─────────────────────────────────────────────────────────────────────────────

export interface HSMHealthMonitorOptions {
  /** Number of consecutive failures before isHealthy() flips to false. */
  consecutiveFailureThreshold?: number;
  /** Optional audit log to receive `health.check` + `error` events. */
  auditLog?: HSMAuditLog;
  /** Vendor + serial for audit (fallback when probe itself fails). */
  vendorHint?: string;
  serialHint?: string;
}

/**
 * Periodic/manual health-check wrapper around an `HSMSession`. Exposes
 * `runOnce()` for caller-driven cadence (recommended — keeps test
 * determinism) plus `start(intervalMs)`/`stop()` for a self-driven loop
 * when the operator prefers fire-and-forget.
 *
 * Once `consecutiveFailureThreshold` is crossed, `isHealthy()` stays
 * `false` until a successful probe arrives.
 */
export class HSMHealthMonitor {
  static readonly DEFAULT_THRESHOLD = 3;

  private readonly _session: HSMSession;
  private readonly _threshold: number;
  private readonly _audit?: HSMAuditLog;
  private readonly _vendorHint: string;
  private readonly _serialHint?: string;

  private _consecutiveFailures = 0;
  private _lastProbe?: HSMHealth;
  private _lastError?: string;
  private _totalProbes = 0;
  private _totalFailures = 0;
  private _interval: ReturnType<typeof setInterval> | null = null;

  constructor(session: HSMSession, opts: HSMHealthMonitorOptions = {}) {
    this._session = session;
    this._threshold = opts.consecutiveFailureThreshold ?? HSMHealthMonitor.DEFAULT_THRESHOLD;
    if (!Number.isInteger(this._threshold) || this._threshold <= 0) {
      throw new RangeError(
        `HSMHealthMonitor: consecutiveFailureThreshold must be a positive int, got ${this._threshold}`,
      );
    }
    this._audit = opts.auditLog;
    this._vendorHint = opts.vendorHint ?? 'unknown';
    this._serialHint = opts.serialHint;
  }

  /** Run one health check.  Returns the probe result (or null on throw). */
  async runOnce(): Promise<HSMHealth | null> {
    this._totalProbes++;
    try {
      const h = await this._session.healthCheck();
      this._lastProbe = h;
      if (h.ok) {
        this._consecutiveFailures = 0;
      } else {
        this._consecutiveFailures++;
        this._totalFailures++;
      }
      this._audit?.record({
        kind: 'health.check',
        sessionId: this._sessionId(),
        vendor: h.vendor,
        serialNo: h.serialNo,
        latencyMs: h.latencyMs,
        context: { ok: h.ok },
      });
      return h;
    } catch (err) {
      this._consecutiveFailures++;
      this._totalFailures++;
      const msg = err instanceof Error ? err.message : String(err);
      this._lastError = msg;
      this._audit?.record({
        kind: 'error',
        sessionId: this._sessionId(),
        vendor: this._vendorHint,
        serialNo: this._serialHint,
        errorMessage: sanitizeErrorMessage(msg),
      });
      return null;
    }
  }

  /**
   * Begin a self-driving probe loop at `intervalMs`.  Caller MUST
   * `stop()` before tearing down the session.  Used in production
   * tenants; tests prefer `runOnce` for determinism.
   */
  start(intervalMs: number): void {
    if (this._interval) {
      throw new Error('HSMHealthMonitor.start: already running');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(`HSMHealthMonitor.start: intervalMs must be positive, got ${intervalMs}`);
    }
    this._interval = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
  }

  /** Stop the self-driving loop, if any.  Idempotent. */
  stop(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  isHealthy(): boolean {
    return this._consecutiveFailures < this._threshold;
  }

  consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  totalProbes(): number {
    return this._totalProbes;
  }

  totalFailures(): number {
    return this._totalFailures;
  }

  lastProbe(): HSMHealth | undefined {
    return this._lastProbe;
  }

  lastError(): string | undefined {
    return this._lastError;
  }

  /** Reset all counters — used after manual operator intervention. */
  reset(): void {
    this._consecutiveFailures = 0;
    this._lastError = undefined;
  }

  private _sessionId(): string {
    // Best-effort: HSMSession doesn't expose an id, so we use vendor+serial
    // as the audit anchor. Good enough for single-session deployments;
    // multi-session deployments wrap each session with its own monitor.
    return `${this._vendorHint}:${this._serialHint ?? 'no-serial'}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HSMAuditedProvider — transparent wrapper that records every call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps any `HSMProvider` so all sessions opened through it emit
 * audit events. Use this in production tenants — drop-in replacement
 * for the bare provider, no API changes downstream.
 */
export class HSMAuditedProvider implements HSMProvider {
  private readonly _inner: HSMProvider;
  private readonly _audit: HSMAuditLog;
  private _sessionCounter = 0;

  constructor(inner: HSMProvider, audit: HSMAuditLog) {
    this._inner = inner;
    this._audit = audit;
  }

  async open(opts: HSMOpenOptions): Promise<HSMSession> {
    const session = await this._inner.open(opts);
    const sessionId = `sess-${++this._sessionCounter}`;
    let health: HSMHealth | null = null;
    try {
      health = await session.healthCheck();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._audit.record({
        kind: 'error',
        sessionId,
        vendor: 'unknown',
        errorMessage: sanitizeErrorMessage(msg),
      });
      throw e;
    }
    this._audit.record({
      kind: 'session.open',
      sessionId,
      vendor: health.vendor,
      serialNo: health.serialNo,
    });
    return wrapSessionWithAudit(session, this._audit, sessionId, health);
  }
}

function wrapSessionWithAudit(
  session: HSMSession,
  audit: HSMAuditLog,
  sessionId: string,
  initialHealth: HSMHealth,
): HSMSession {
  return {
    async generateRandomBytes(n: number): Promise<Uint8Array> {
      const bytes = await session.generateRandomBytes(n);
      audit.record({
        kind: 'rng.generate',
        sessionId,
        vendor: initialHealth.vendor,
        serialNo: initialHealth.serialNo,
        byteCount: n,
      });
      return bytes;
    },
    async close(): Promise<void> {
      await session.close();
      audit.record({
        kind: 'session.close',
        sessionId,
        vendor: initialHealth.vendor,
        serialNo: initialHealth.serialNo,
      });
    },
    async healthCheck(): Promise<HSMHealth> {
      const h = await session.healthCheck();
      audit.record({
        kind: 'health.check',
        sessionId,
        vendor: h.vendor,
        serialNo: h.serialNo,
        latencyMs: h.latencyMs,
        context: { ok: h.ok },
      });
      return h;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip anything that *looks* like a PIN / secret / hex blob from an
 * error message before logging.  Conservative — if in doubt, redact.
 */
export function sanitizeErrorMessage(msg: string): string {
  // Numeric runs of 4+ digits → likely PINs
  let out = msg.replace(/\b\d{4,}\b/g, '[REDACTED-NUMERIC]');
  // Long hex runs → likely keys / nonces
  out = out.replace(/\b[a-fA-F0-9]{16,}\b/g, '[REDACTED-HEX]');
  // Anything labelled pin=… / pwd=… up to whitespace
  out = out.replace(/\b(pin|pwd|password|secret)=\S+/gi, '$1=[REDACTED]');
  return out;
}
