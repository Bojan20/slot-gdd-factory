/**
 * W152 Wave 18 — Spin Orchestrator (Faza 15.A.7).
 *
 * Explicit finite-state machine for one spin's lifecycle. Three flow
 * dispatch styles are supported:
 *
 *   * `LinearOrchestrator`        — fixed sequential pipeline. Predictable,
 *                                    no event indirection. Default for
 *                                    classic line/ways games.
 *   * `StateMachineOrchestrator`  — typed FSM with guard-restricted
 *                                    transitions. Best when the spin can
 *                                    branch (e.g. feature triggers, retry).
 *   * `EventDrivenOrchestrator`   — pub-sub bus. Best when third-party
 *                                    plugins observe lifecycle events
 *                                    without modifying the orchestrator.
 *
 * All three implement the same `Orchestrator` interface so a debug CLI
 * can swap them at runtime. Bit-identical state transitions across
 * the three classes are part of the acceptance contract — any divergence
 * is an orchestrator bug, not a feature difference.
 *
 * Naming policy: `spinOrchestrator` is the engine-generic name. Vendor-
 * specific implementations exist under different proprietary names —
 * those terms are documented in `docs/glossary.md` (RESERVED TERMS).
 * Patent-risk audit (W152 Wave 18) selected `spinOrchestrator` as the
 * clean-room rebrand of an earlier MEDIUM-risk identifier.
 *
 * State machine (10 states):
 *
 *      init  ──▶  wager  ──▶  spin  ──▶  evaluate
 *                                              │
 *                                              ▼
 *                                       feature_entry
 *                                              │
 *                                              ▼
 *                                       feature_loop ──┐
 *                                              │       │ (loops within feature)
 *                                              ▼       │
 *                                       feature_exit ──┘
 *                                              │
 *                                              ▼
 *                                          rollup
 *                                              │
 *                                              ▼
 *                                          settle
 *                                              │
 *                                              ▼
 *                                          cleanup
 *
 *   * Spins WITHOUT a feature trigger skip the `feature_*` triplet
 *     directly from `evaluate` to `rollup`.
 *   * `feature_loop` self-loops while the feature emits more sub-spins
 *     (free spins, cascade tumbles, hold-and-win respins).
 */

export type SpinPhase =
  | 'init'
  | 'wager'
  | 'spin'
  | 'evaluate'
  | 'feature_entry'
  | 'feature_loop'
  | 'feature_exit'
  | 'rollup'
  | 'settle'
  | 'cleanup';

export interface SpinPhaseEvent {
  phase: SpinPhase;
  /** Monotonic event index — strictly increasing within one spin. */
  index: number;
  /** Optional per-phase payload (free-form). */
  payload?: Record<string, unknown>;
}

export interface OrchestratorRunOptions {
  /** Whether the spin should enter feature_* phases. Default `false`. */
  triggerFeature?: boolean;
  /**
   * For feature_loop self-loops, how many sub-spins to emit before
   * advancing to feature_exit. Default 0 (no sub-loop).
   */
  featureLoopCount?: number;
  /** Optional payload-decorator. */
  decorate?: (phase: SpinPhase) => Record<string, unknown> | undefined;
}

export interface Orchestrator {
  readonly kind: 'linear' | 'state_machine' | 'event_driven';
  /** Run one full spin lifecycle and emit ordered events. */
  run(opts?: OrchestratorRunOptions): SpinPhaseEvent[];
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

function buildPhaseSequence(opts: OrchestratorRunOptions = {}): SpinPhase[] {
  const seq: SpinPhase[] = ['init', 'wager', 'spin', 'evaluate'];
  if (opts.triggerFeature) {
    seq.push('feature_entry');
    const loops = Math.max(0, Math.floor(opts.featureLoopCount ?? 0));
    for (let i = 0; i < Math.max(1, loops); i++) seq.push('feature_loop');
    seq.push('feature_exit');
  }
  seq.push('rollup', 'settle', 'cleanup');
  return seq;
}

// ════════════════════════════════════════════════════════════════════════════
// LinearOrchestrator — fixed pipeline
// ════════════════════════════════════════════════════════════════════════════

export class LinearOrchestrator implements Orchestrator {
  readonly kind = 'linear' as const;

  run(opts: OrchestratorRunOptions = {}): SpinPhaseEvent[] {
    const phases = buildPhaseSequence(opts);
    return phases.map((phase, index) => ({
      phase,
      index,
      payload: opts.decorate ? opts.decorate(phase) : undefined,
    }));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// StateMachineOrchestrator — guarded transitions
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_TRANSITIONS: Record<SpinPhase, SpinPhase[]> = {
  init: ['wager'],
  wager: ['spin'],
  spin: ['evaluate'],
  evaluate: ['feature_entry', 'rollup'],
  feature_entry: ['feature_loop'],
  feature_loop: ['feature_loop', 'feature_exit'],
  feature_exit: ['rollup'],
  rollup: ['settle'],
  settle: ['cleanup'],
  cleanup: [],
};

export class StateMachineOrchestrator implements Orchestrator {
  readonly kind = 'state_machine' as const;

  run(opts: OrchestratorRunOptions = {}): SpinPhaseEvent[] {
    const sequence = buildPhaseSequence(opts);
    // Validate every adjacent transition against the allowed table.
    // Throws on any divergence — guarantees state-machine correctness.
    for (let i = 1; i < sequence.length; i++) {
      const from = sequence[i - 1];
      const to = sequence[i];
      if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new Error(
          `StateMachineOrchestrator: illegal transition ${from} → ${to} at index ${i}`,
        );
      }
    }
    return sequence.map((phase, index) => ({
      phase,
      index,
      payload: opts.decorate ? opts.decorate(phase) : undefined,
    }));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EventDrivenOrchestrator — pub-sub
// ════════════════════════════════════════════════════════════════════════════

export type PhaseSubscriber = (event: SpinPhaseEvent) => void;

export class EventDrivenOrchestrator implements Orchestrator {
  readonly kind = 'event_driven' as const;
  private subscribers: PhaseSubscriber[] = [];

  /** Register a subscriber to receive every phase event. */
  subscribe(sub: PhaseSubscriber): () => void {
    this.subscribers.push(sub);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== sub);
    };
  }

  /** Number of currently registered subscribers (test inspector). */
  subscriberCount(): number {
    return this.subscribers.length;
  }

  run(opts: OrchestratorRunOptions = {}): SpinPhaseEvent[] {
    const phases = buildPhaseSequence(opts);
    const events = phases.map((phase, index) => ({
      phase,
      index,
      payload: opts.decorate ? opts.decorate(phase) : undefined,
    }));
    // Synchronous broadcast — preserves ordering across subscribers.
    for (const ev of events) {
      for (const sub of this.subscribers) {
        try {
          sub(ev);
        } catch (e) {
          // Subscribers must not break the orchestrator. Swallow + tag.
          // Production callers can wire a log adapter inside the subscriber.
          void e;
        }
      }
    }
    return events;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Trace utilities (for the debug CLI `slot-sim trace --orchestrator <kind>`)
// ════════════════════════════════════════════════════════════════════════════

/** Render a phase sequence as one-event-per-line text. */
export function renderTrace(events: SpinPhaseEvent[]): string {
  return events.map((e) => `${String(e.index).padStart(3, '0')}  ${e.phase}`).join('\n');
}

/**
 * Compare two traces for bit-identical phase sequences. Used by the
 * acceptance gate: all 3 orchestrator implementations MUST produce the
 * same phase ordering for identical input options.
 */
export function tracesEqual(a: SpinPhaseEvent[], b: SpinPhaseEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].phase !== b[i].phase || a[i].index !== b[i].index) return false;
  }
  return true;
}

/** Factory by `kind` — for the CLI dispatch path. */
export function orchestratorByKind(kind: Orchestrator['kind']): Orchestrator {
  switch (kind) {
    case 'linear':
      return new LinearOrchestrator();
    case 'state_machine':
      return new StateMachineOrchestrator();
    case 'event_driven':
      return new EventDrivenOrchestrator();
    default:
      throw new Error(`orchestratorByKind: unknown kind '${kind}'`);
  }
}
