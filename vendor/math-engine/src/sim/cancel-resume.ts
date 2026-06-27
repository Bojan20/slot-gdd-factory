/**
 * W152 Wave 15 — Faza 11.3 — Sim cancel/resume controller (TS).
 *
 * The Rust simulator already has crash-resume checkpointing in
 * `rust-sim/src/bulk/checkpoint.rs`. The TS dashboard side needs a
 * parallel control surface so a long-running browser-side sim can be
 * paused, the partial result preserved, and the work resumed without
 * losing per-segment statistics.
 *
 * This module ships:
 *   1. `SimController` — `cancel()` / `pause()` / `resume()` / `snapshot()` API
 *      backed by an `AbortSignal` for cooperative interrupts.
 *   2. `Checkpoint<T>` — pluggable persistence interface (in-memory by
 *      default; operators wire localStorage / IndexedDB / disk).
 *   3. `MemoryCheckpoint` — reference impl used by tests + dashboard.
 *   4. `runChunked()` — convenience wrapper that loops the work in
 *      cancel-friendly chunks, persisting a checkpoint after each
 *      chunk and respecting the controller state machine.
 *
 * State machine:
 *   running → paused (via pause())
 *   running → cancelled (via cancel())
 *   paused → running (via resume())
 *   paused → cancelled (via cancel())
 *   cancelled is terminal.
 *
 * `runChunked()` returns the **last persisted checkpoint** on cancel
 * so the operator can resume from exactly where they stopped instead
 * of losing the last chunk.
 */

export type SimState = 'running' | 'paused' | 'cancelled' | 'finished';

export class SimController {
  private _state: SimState = 'running';
  private readonly abortController = new AbortController();
  private readonly resumeWaiters: Array<() => void> = [];

  get state(): SimState {
    return this._state;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  pause(): void {
    if (this._state === 'running') {
      this._state = 'paused';
    }
  }

  resume(): void {
    if (this._state === 'paused') {
      this._state = 'running';
      const waiters = this.resumeWaiters.splice(0);
      for (const w of waiters) w();
    }
  }

  cancel(): void {
    if (this._state === 'cancelled' || this._state === 'finished') return;
    this._state = 'cancelled';
    this.abortController.abort();
    const waiters = this.resumeWaiters.splice(0);
    for (const w of waiters) w();
  }

  /** Mark the run as cleanly finished — used by `runChunked()` on success. */
  markFinished(): void {
    if (this._state === 'running') {
      this._state = 'finished';
    }
  }

  /** Block until the controller exits `paused` (or any terminal state). */
  async waitWhilePaused(): Promise<void> {
    while (this._state === 'paused') {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
  }
}

// ─── Checkpoint persistence ───────────────────────────────────────────────

export interface Checkpoint<T> {
  /** Persist the snapshot under `key`. */
  save(key: string, snapshot: T): Promise<void>;
  /** Load the snapshot, or `null` if none exists. */
  load(key: string): Promise<T | null>;
  /** Drop the snapshot (e.g. after clean finish). */
  clear(key: string): Promise<void>;
}

/** In-memory checkpoint — reference impl for tests + dashboard. */
export class MemoryCheckpoint<T> implements Checkpoint<T> {
  private readonly store = new Map<string, T>();
  async save(key: string, snapshot: T): Promise<void> {
    // Deep-clone via JSON round-trip so the caller can keep mutating
    // their working object without corrupting the stored snapshot.
    this.store.set(key, JSON.parse(JSON.stringify(snapshot)) as T);
  }
  async load(key: string): Promise<T | null> {
    const v = this.store.get(key);
    return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T);
  }
  async clear(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ─── Chunked runner ───────────────────────────────────────────────────────

export interface ChunkedRunOptions<S> {
  /** Stable key for the checkpoint store. */
  jobId: string;
  /** Total work units. */
  totalSpins: number;
  /** Spins per chunk. Smaller chunk = finer cancel granularity at the
   *  cost of checkpoint write overhead. Default 10k. */
  chunkSize?: number;
  /** Initial snapshot (used only if no checkpoint exists). */
  initialState: S;
  /** Process one chunk, mutating `state` in place. Returns updated state.
   *  Must respect `controller.signal.aborted` cooperatively. */
  processChunk: (
    state: S,
    chunkStart: number,
    chunkEnd: number,
    controller: SimController,
  ) => Promise<S>;
  /** Where snapshots persist. */
  checkpoint: Checkpoint<{ spinsDone: number; state: S }>;
  controller: SimController;
}

export interface ChunkedRunResult<S> {
  spinsDone: number;
  state: S;
  status: 'finished' | 'cancelled';
}

export async function runChunked<S>(
  opts: ChunkedRunOptions<S>,
): Promise<ChunkedRunResult<S>> {
  const chunkSize = Math.max(1, opts.chunkSize ?? 10_000);
  let state = opts.initialState;
  let spinsDone = 0;

  // Resume from existing checkpoint if any.
  const restored = await opts.checkpoint.load(opts.jobId);
  if (restored) {
    spinsDone = restored.spinsDone;
    state = restored.state;
  }

  while (spinsDone < opts.totalSpins) {
    // Honour pause first — wait until resumed or cancelled.
    await opts.controller.waitWhilePaused();
    if (opts.controller.state === 'cancelled') {
      return { spinsDone, state, status: 'cancelled' };
    }
    const chunkEnd = Math.min(spinsDone + chunkSize, opts.totalSpins);
    state = await opts.processChunk(state, spinsDone, chunkEnd, opts.controller);
    spinsDone = chunkEnd;
    await opts.checkpoint.save(opts.jobId, { spinsDone, state });
  }

  // Clean finish: clear the checkpoint so the next run starts fresh.
  await opts.checkpoint.clear(opts.jobId);
  opts.controller.markFinished();
  return { spinsDone, state, status: 'finished' };
}
