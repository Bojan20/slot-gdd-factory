/**
 * Faza 14.6 (alias Faza 13.11 "Time-machine compliance") —
 * Long-run replay differential.
 *
 * Periodically (default annually) replay a captured 1 M-spin set
 * against the current production engine commit and prove the output
 * is bit-identical to the snapshot taken at the time of the original
 * capture. Any drift = silent regression, fail the gate.
 *
 * # Why this is its own module, not part of `acceptanceHarness`
 *
 * `acceptanceHarness` is the per-fixture convergence check — ±0.001 %
 * tolerance, MC vs closed-form. **This** module is the differential:
 * tolerance is exact zero, every byte of the recorded spin history
 * must reproduce identically on the engine that runs today.
 *
 * # Regulator framing
 *
 * Faza 14.2 (continuous certification) ships the engine's daily root
 * hash to a regulator inbox. Faza 14.6 is the *replay-side* proof:
 * take any earlier capture, hand it to today's engine, get the same
 * answer, byte for byte. The two together form the "no silent drift
 * over time" dossier.
 *
 * # Data shape
 *
 * `ReplayCapture` is the minimal record we need to keep to do this
 * audit. It carries: the IR config hash, the seed, the spin count,
 * and a per-spin digest (SHA-256 of every spin's evaluator output,
 * concatenated in order, then re-hashed). For 1 M spins we only need
 * to store the final 32-byte hash + every 10 000-th checkpoint.
 *
 * # Integration
 *
 * Operators wire this into Faza 8.5 (Spin recall) — every audit
 * digest emitted at capture time becomes a future replay reference.
 * When the regulator (or internal auditor) reruns the engine on the
 * stored seed + config, the running digest at each checkpoint MUST
 * match. Mismatch at any checkpoint = drift.
 */

import { createHash } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReplayCheckpoint {
  /** Spin index at the checkpoint (0-indexed). */
  readonly spinIndex: number;
  /** SHA-256 hex of the running digest at this spin. */
  readonly runningDigestHex: string;
}

export interface ReplayCapture {
  /** Engine commit when the capture was made. */
  readonly engineCommit: string;
  /** ISO timestamp the capture was created. */
  readonly capturedAt: string;
  /** IR config SHA-256. */
  readonly configHashHex: string;
  /** Seed used. */
  readonly seed: number;
  /** Total spins in the capture. */
  readonly totalSpins: number;
  /** Per-spin digest cadence (default 10 000). */
  readonly checkpointEverySpins: number;
  /** Checkpoint trail. The final entry's digest covers every spin. */
  readonly checkpoints: ReadonlyArray<ReplayCheckpoint>;
}

export interface ReplayDifferentialInput {
  /** The stored historic capture. */
  readonly capture: ReplayCapture;
  /** Live engine output, one entry per spin in identical order. */
  readonly liveSpinDigests: ReadonlyArray<string>;
}

export type DifferentialStatus =
  | 'bit_identical'
  | 'checkpoint_mismatch'
  | 'count_mismatch'
  | 'engine_changed_warning';

export interface DifferentialResult {
  readonly status: DifferentialStatus;
  /** Spin index of first mismatch, if any. */
  readonly firstMismatchSpin: number | null;
  /** Digest difference summary. */
  readonly capturedDigest: string;
  readonly liveDigest: string;
  /** Free-form reason for logs / regulator inbox. */
  readonly reason: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Roll forward the running digest by one spin. The running digest at
 * spin `i+1` is `sha256(runningDigest_i || spinDigest_i)`. This is
 * the standard hash-chain construction: any tampering at any point
 * makes every later digest diverge.
 */
export function advanceRunningDigest(
  prior: string,
  spinDigest: string
): string {
  return sha256Hex(`${prior}|${spinDigest}`);
}

/**
 * Build a `ReplayCapture` from a stream of per-spin digests. Useful
 * for snapshotting at capture time.
 */
export function buildReplayCapture(input: {
  engineCommit: string;
  capturedAt: string;
  configHashHex: string;
  seed: number;
  spinDigests: ReadonlyArray<string>;
  checkpointEverySpins?: number;
}): ReplayCapture {
  const cadence = input.checkpointEverySpins ?? 10_000;
  if (!Number.isInteger(cadence) || cadence <= 0) {
    throw new RangeError('buildReplayCapture: checkpointEverySpins must be a positive integer');
  }
  const checkpoints: ReplayCheckpoint[] = [];
  let running = sha256Hex(`${input.configHashHex}|${input.seed}`);
  for (let i = 0; i < input.spinDigests.length; i++) {
    running = advanceRunningDigest(running, input.spinDigests[i]);
    if ((i + 1) % cadence === 0 || i === input.spinDigests.length - 1) {
      checkpoints.push({ spinIndex: i, runningDigestHex: running });
    }
  }
  return {
    engineCommit: input.engineCommit,
    capturedAt: input.capturedAt,
    configHashHex: input.configHashHex,
    seed: input.seed,
    totalSpins: input.spinDigests.length,
    checkpointEverySpins: cadence,
    checkpoints,
  };
}

/**
 * Replay differential: given a historic capture + a live spin-digest
 * stream from today's engine, prove they match byte-for-byte.
 *
 * - `bit_identical` — every checkpoint matched and totals match.
 * - `count_mismatch` — live stream length ≠ capture totalSpins.
 * - `checkpoint_mismatch` — running digest at some checkpoint
 *                            doesn't match. Earliest mismatch
 *                            spin index reported.
 * - `engine_changed_warning` — checkpoints all match but
 *                                `capture.engineCommit` != today (NOT
 *                                a failure — the audit value is that
 *                                a different commit reproduced the
 *                                same answer).
 */
export function differentialReplay(
  input: ReplayDifferentialInput,
  todayEngineCommit: string
): DifferentialResult {
  const cap = input.capture;
  if (input.liveSpinDigests.length !== cap.totalSpins) {
    return {
      status: 'count_mismatch',
      firstMismatchSpin: null,
      capturedDigest: cap.checkpoints[cap.checkpoints.length - 1]?.runningDigestHex ?? '',
      liveDigest: '',
      reason: `live stream has ${input.liveSpinDigests.length} spins; capture has ${cap.totalSpins}`,
    };
  }

  let running = sha256Hex(`${cap.configHashHex}|${cap.seed}`);
  let nextCheckpoint = 0;
  for (let i = 0; i < input.liveSpinDigests.length; i++) {
    running = advanceRunningDigest(running, input.liveSpinDigests[i]);
    const checkpoint = cap.checkpoints[nextCheckpoint];
    if (checkpoint != null && checkpoint.spinIndex === i) {
      if (running !== checkpoint.runningDigestHex) {
        return {
          status: 'checkpoint_mismatch',
          firstMismatchSpin: i,
          capturedDigest: checkpoint.runningDigestHex,
          liveDigest: running,
          reason: `spin ${i} checkpoint mismatch: live=${running.slice(0, 16)}… expected=${checkpoint.runningDigestHex.slice(0, 16)}…`,
        };
      }
      nextCheckpoint += 1;
    }
  }

  const finalDigest = running;
  const status: DifferentialStatus =
    cap.engineCommit === todayEngineCommit ? 'bit_identical' : 'engine_changed_warning';
  return {
    status,
    firstMismatchSpin: null,
    capturedDigest: cap.checkpoints[cap.checkpoints.length - 1]?.runningDigestHex ?? '',
    liveDigest: finalDigest,
    reason:
      status === 'bit_identical'
        ? `all ${cap.totalSpins.toLocaleString()} spins match capture from ${cap.capturedAt}`
        : `all ${cap.totalSpins.toLocaleString()} spins match BUT engine commit changed ${cap.engineCommit}→${todayEngineCommit} (cross-version reproducibility proven)`,
  };
}
