/**
 * W152 P2-12 — Responsible-Gaming hooks emitter.
 *
 * Per KIMI 11 (`docs/W152/11-rg-technical-hooks.md`), 2025–2026
 * regulators (UKGC RTS 12 / 14 eff. 31 Oct 2025, MGA PPD, GGL OASIS
 * v6.0, Spelpaus SIFS 2026:3) require synchronous, server-side
 * hooks the slot supplier emits at well-defined points in the round
 * lifecycle. This module is the centralised emit surface — the
 * engine fires events, multiple subscribers (operator dashboard,
 * AML telemetry, audit log) consume them.
 *
 * Event taxonomy (extends `RGEvent` from `types.ts`):
 *   * REALITY_CHECK_ACK   — player acknowledged reality-check overlay.
 *   * SPIN_SPEED_GATE     — engine refused a spin because the spin
 *                           timer hadn't elapsed (RTS 14D, GGL 5s).
 *   * DEPOSIT_LIMIT_BLOCK — deposit refused: gross-deposit cap hit.
 *   * LOSS_LIMIT_REACHED  — loss limit met during play.
 *   * SELF_EXCLUSION_LOOKUP — self-exclusion API was queried; result
 *                           recorded for audit trail.
 *   * AFFORDABILITY_SCREEN — UKGC enhanced affordability prompt shown.
 *   * SESSION_TIMER       — 1 h periodic check (UKGC mandatory).
 *   * COOLING_OFF_INIT    — 24 h cooling-off period started after
 *                           deposit limit breach (UKGC RTS 12).
 *
 * The emitter is intentionally framework-free. Operators can subscribe
 * from any environment (Node, browser preview, Web Worker simulator)
 * and pipe events into their telemetry of choice.
 */

/**
 * Discriminated-union over the per-hook payload shapes. Each `kind`
 * carries its own `detail` schema so downstream consumers branch
 * narrow-typed.
 */
export type RGHookEvent =
  | {
      kind: 'REALITY_CHECK_ACK';
      sessionId: string;
      ts: number;
      detail: { acknowledgedAtMs: number; elapsedSessionMs: number };
    }
  | {
      kind: 'SPIN_SPEED_GATE';
      sessionId: string;
      ts: number;
      detail: { jurisdiction: string; requiredMinMs: number; observedMs: number };
    }
  | {
      kind: 'DEPOSIT_LIMIT_BLOCK';
      sessionId: string;
      ts: number;
      detail: {
        playerId: string;
        currency: string;
        cumulativeMc: number;
        capMc: number;
        windowDays: number;
      };
    }
  | {
      kind: 'LOSS_LIMIT_REACHED';
      sessionId: string;
      ts: number;
      detail: { netLossMc: number; capMc: number; windowDays?: number };
    }
  | {
      kind: 'SELF_EXCLUSION_LOOKUP';
      sessionId: string;
      ts: number;
      detail: {
        provider: string; // GAMSTOP / OASIS / Spelpaus / ROFUS / CRUKS / AGCO_CSE
        playerId: string;
        excluded: boolean;
        latencyMs: number;
        circuitBreakerTripped?: boolean;
      };
    }
  | {
      kind: 'AFFORDABILITY_SCREEN';
      sessionId: string;
      ts: number;
      detail: { playerId: string; triggerReason: string };
    }
  | {
      kind: 'SESSION_TIMER';
      sessionId: string;
      ts: number;
      detail: { elapsedMs: number; nextCheckAt: number };
    }
  | {
      kind: 'COOLING_OFF_INIT';
      sessionId: string;
      ts: number;
      detail: { durationMs: number; reason: string };
    };

/** Subscriber callback. Synchronous; throw-on-error so the operator
 *  pipeline catches misconfiguration immediately. */
export type RGHookListener = (event: RGHookEvent) => void;

/**
 * `RGHookEmitter` — fan-out for `RGHookEvent`. Multiple listeners
 * supported; `subscribe()` returns an unsubscribe function for
 * idiomatic cleanup. Events are dispatched in subscription order.
 *
 * The emitter is **not** async — every listener runs in the calling
 * thread. Long-running consumers MUST queue and return control fast
 * so the engine spin loop is not blocked. For async telemetry, layer
 * a queue between the emitter and the I/O sink.
 */
export class RGHookEmitter {
  private readonly listeners: Set<RGHookListener> = new Set();

  /** Add a listener; returns an unsubscribe function. */
  subscribe(listener: RGHookListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fire an event to every listener in subscription order. */
  emit(event: RGHookEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Active listener count — used by tests and diagnostics. */
  listenerCount(): number {
    return this.listeners.size;
  }

  /** Drop every listener — usually called at session teardown. */
  clear(): void {
    this.listeners.clear();
  }
}
