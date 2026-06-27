/**
 * W152 P2-13 — AML telemetry emitter.
 *
 * Slot supplier ↔ PAM (Player Account Management) integration layer for
 * per-spin AML telemetry. Each spin emits a canonical record:
 *
 *   {ts, bet, win, gameId, roundSeed, sessionId, playerHash?, jurisdiction?,
 *    netSessionLoss?, spinIndex?, flags?: AmlFlag[]}
 *
 * UKGC AML enforcement effective Oct 2025 (10 m£ fines landed on operators)
 * requires the supplier to expose this stream — the supplier is upstream of
 * the obligation but the operator cannot prove the velocity / loss /
 * geo-pattern flags without the supplier's per-round metadata.
 *
 * Design:
 *   - **Pluggable backends**: `TelemetryBackend` is an interface; we ship
 *     three reference impls (stdout JSONL, in-memory buffer, no-op).
 *     Operators wire their own HTTPS / Kafka / Kinesis impl.
 *   - **Async append**: `emit()` returns `Promise<void>` so transport-level
 *     I/O never blocks the spin loop. Errors throw so the operator catches
 *     them inline — silent telemetry loss is a regulatory red line.
 *   - **`flush()`** for graceful shutdown; backends may buffer.
 *   - **Stateless emitter** — no session state lives in the emitter; the
 *     caller (RGSession or the round controller) is responsible for
 *     constructing the event. Keeps the emitter trivially testable.
 *
 * Schema is regulator-aligned with the four reporting adapters (PGAD,
 * DK-XML, MGA-JSON, NJ-CSV) so a single canonical event can be fed into
 * any of them later. See `src/report/adapters/` for downstream consumers.
 */

import { writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// ─── Schema ──────────────────────────────────────────────────────────────────

/** One AML-flag observation attached to a spin. */
export type AmlFlag =
  | 'velocity_high'
  | 'consecutive_wins_high'
  | 'big_win_threshold'
  | 'session_loss_threshold'
  | 'session_duration_long'
  | 'self_exclusion_active'
  | 'reality_check_due';

/**
 * Per-spin telemetry record. Field naming uses lowerCamelCase to match the
 * TS engine convention; reporting adapters (which use snake_case per the
 * regulator schemas) translate at the boundary.
 */
export interface TelemetrySpinEvent {
  /** Wall-clock ms since epoch — used for chronological ordering. */
  ts: number;
  /** Bet amount (player currency units, NOT bet multiples). */
  bet: number;
  /** Total payout this spin. */
  win: number;
  /** Stable game identifier (slug or ID-from-PAM). */
  gameId: string;
  /**
   * Round seed: the cryptographically committed PRNG seed for this spin
   * (hex string, length depends on backend). Required for GLI-19 replay.
   */
  roundSeed: string;
  /** Operator-issued session identifier. */
  sessionId: string;
  /** Pseudonymous player handle — hashed in compliance with GDPR. */
  playerHash?: string;
  /** Jurisdiction tag — drives downstream reporting routing. */
  jurisdiction?: string;
  /** Running net session loss (positive = player down). */
  netSessionLoss?: number;
  /** Number of spins played in this session before this one. */
  spinIndex?: number;
  /** AML flags raised during this spin (may be empty array). */
  flags?: AmlFlag[];
}

// ─── Backend interface ───────────────────────────────────────────────────────

export interface TelemetryBackend {
  /** Append one event to the underlying transport. Throws on failure. */
  emit(event: TelemetrySpinEvent): Promise<void>;
  /** Flush any buffered events. No-op for unbuffered backends. */
  flush(): Promise<void>;
  /** Drain count — implementations expose for observability. */
  emittedCount(): number;
}

// ─── Reference implementations ───────────────────────────────────────────────

/** No-op backend — useful in tests and for dev environments. */
export class NoopTelemetryBackend implements TelemetryBackend {
  private _count = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async emit(_event: TelemetrySpinEvent): Promise<void> {
    this._count += 1;
  }
  async flush(): Promise<void> {}
  emittedCount(): number {
    return this._count;
  }
}

/**
 * Buffering in-memory backend — events stay in RAM until `drain()` or
 * `flush()` is called. Used by unit tests and for short-lived sim runs
 * where we want to assert what was emitted.
 */
export class BufferingTelemetryBackend implements TelemetryBackend {
  private readonly events: TelemetrySpinEvent[] = [];
  async emit(event: TelemetrySpinEvent): Promise<void> {
    this.events.push(event);
  }
  async flush(): Promise<void> {}
  emittedCount(): number {
    return this.events.length;
  }
  /** Take ownership of the buffer (returns events, clears state). */
  drain(): TelemetrySpinEvent[] {
    return this.events.splice(0, this.events.length);
  }
  /** Read events without clearing the buffer. */
  snapshot(): ReadonlyArray<TelemetrySpinEvent> {
    return this.events.slice();
  }
}

/**
 * JSONL stdout backend — writes one JSON line per event to stdout.
 *
 * Production use-case: docker logs collector (fluentd, Vector) picks up the
 * lines, ships to PAM downstream. NDJSON keeps logs structured but
 * stream-friendly.
 */
export class StdoutTelemetryBackend implements TelemetryBackend {
  private _count = 0;
  private readonly _writer: (line: string) => void;
  constructor(writer?: (line: string) => void) {
    // eslint-disable-next-line no-console
    this._writer = writer ?? ((line) => console.log(line));
  }
  async emit(event: TelemetrySpinEvent): Promise<void> {
    this._writer(JSON.stringify(event));
    this._count += 1;
  }
  async flush(): Promise<void> {}
  emittedCount(): number {
    return this._count;
  }
}

/**
 * JSONL file-append backend — appends one JSON line per event to a file.
 * Creates the file (and parent dir) lazily on the first emit. fsync semantics
 * are inherited from the host filesystem — fine for non-financial AML logs;
 * if you need durable financial commit, wrap this with the HSM audit log
 * (`src/hsm/audit.ts`).
 */
export class JsonlFileTelemetryBackend implements TelemetryBackend {
  private readonly path: string;
  private _count = 0;
  private _ensured = false;

  constructor(path: string) {
    this.path = path;
  }

  async emit(event: TelemetrySpinEvent): Promise<void> {
    if (!this._ensured) {
      await mkdir(dirname(this.path), { recursive: true });
      // Use writeFile w/ flag 'a' for the first append (creates file).
      await writeFile(this.path, '', { flag: 'a' });
      this._ensured = true;
    }
    await appendFile(this.path, JSON.stringify(event) + '\n');
    this._count += 1;
  }

  async flush(): Promise<void> {}

  emittedCount(): number {
    return this._count;
  }
}

// ─── Composite: fan-out to multiple backends ────────────────────────────────

/**
 * Fan-out backend — emits each event to N child backends. Errors from any
 * child propagate; if one child failure should be ignored, wrap that child
 * in a swallow-errors adapter at the caller level.
 */
export class CompositeTelemetryBackend implements TelemetryBackend {
  private readonly children: ReadonlyArray<TelemetryBackend>;
  private _count = 0;
  constructor(children: TelemetryBackend[]) {
    this.children = children;
  }
  async emit(event: TelemetrySpinEvent): Promise<void> {
    for (const c of this.children) {
      // Sequential, not parallel — preserves event order across backends.
      await c.emit(event);
    }
    this._count += 1;
  }
  async flush(): Promise<void> {
    for (const c of this.children) await c.flush();
  }
  emittedCount(): number {
    return this._count;
  }
}

// ─── High-level helper ─────────────────────────────────────────────────────

/**
 * Build a canonical `TelemetrySpinEvent` from raw spin outcome data.
 *
 * Caller responsibilities:
 *   - Provide `roundSeed` from the PRNG split commitment (not a stringified
 *     U64 — should be the cryptographic seed used to fork the spin RNG).
 *   - Provide `playerHash` already hashed (we do NOT hash here — GDPR
 *     compliance is the operator's responsibility).
 */
export function buildTelemetryEvent(input: {
  ts?: number;
  bet: number;
  win: number;
  gameId: string;
  roundSeed: string;
  sessionId: string;
  playerHash?: string;
  jurisdiction?: string;
  netSessionLoss?: number;
  spinIndex?: number;
  flags?: AmlFlag[];
}): TelemetrySpinEvent {
  return {
    ts: input.ts ?? Date.now(),
    bet: input.bet,
    win: input.win,
    gameId: input.gameId,
    roundSeed: input.roundSeed,
    sessionId: input.sessionId,
    playerHash: input.playerHash,
    jurisdiction: input.jurisdiction,
    netSessionLoss: input.netSessionLoss,
    spinIndex: input.spinIndex,
    flags: input.flags && input.flags.length > 0 ? input.flags : undefined,
  };
}
