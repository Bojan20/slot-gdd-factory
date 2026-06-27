/**
 * Non-linear PAR tuner (P0 #4.2).
 *
 * Background
 * ──────────
 * The PAR sample generator in `scripts/par-samples-generate.mjs` runs a
 * two-pass linear scaler on each reference fixture's paytable. That scaler
 * is *exact* for lines / ways / cluster / pay-anywhere / pattern games —
 * every win is `paytable_entry × multiplier`, so multiplying the table by
 * a single scalar moves RTP proportionally.
 *
 * It is **not** exact for feature-heavy IRs where:
 *   - free-spin retriggers compound the global multiplier,
 *   - cascades chain across multiple wins with progression multipliers,
 *   - variable-row topologies redistribute hit-frequency vs. pay,
 *   - hold-and-win cash values float independently of the line paytable.
 *
 * Two fixtures land outside ±0.5% with linear scaling alone:
 *   - `complex-variable-rows` → 106.14%
 *   - `6x4-4096ways`          →  97.41%
 *
 * Strategy
 * ────────
 * For those, we wrap the linear pass with a bisection on a scalar `s`
 * applied to the paytable + cluster_pay_table. Each bisection iteration
 * runs `runIRSimulation` at a deterministic seed (so the search itself is
 * reproducible) and compares observed RTP to target. Bisection is robust
 * even when the feature math makes RTP non-monotonic w.r.t. the scalar —
 * we bracket on residual sign (above/below target) and narrow each step.
 *
 * Algorithm
 * ─────────
 *   1. Run an "as-is" sim → observe RTP₀.
 *      If |RTP₀ − target| / target < 0.005 → return untouched (idempotent).
 *
 *   2. Establish bracket [s_lo, s_hi]:
 *      - Seed both ends with linear-estimator guesses from RTP₀:
 *        s_guess = target / RTP₀. Walk it out by ×0.5 / ×1.5 if it doesn't
 *        already bracket the residual sign (max 4 expansion steps).
 *
 *   3. Bisect up to `maxIterations` (default 8) times:
 *      - s_mid = 0.5 × (s_lo + s_hi)
 *      - Run sim against `scalePaytable(ir, s_mid)`.
 *      - If |RTP_mid − target| ≤ tolerance → return as converged.
 *      - Else narrow the side that has the same sign as the residual.
 *
 *   4. Return `{ ir, scale, iterations, finalRtp, converged }`.
 *
 * Deterministic seed: every iteration uses the same fixed seed so the
 * bisection trajectory is reproducible byte-for-byte across runs.
 */

import { runIRSimulation, type IRSimConfig } from '../engine/irSimulator.js';
import type { SlotGameIR } from '../ir/types.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface TunePaytableOptions {
  /** Spins per bisection iteration. Default: 20_000. */
  spins?: number;
  /** Fixed seed for every iteration. Default: 12345. */
  seed?: number;
  /** Absolute RTP tolerance (e.g. 0.005 = ±0.5%). Default: 0.005. */
  tolerance?: number;
  /** Hard cap on bisection iterations. Default: 8. */
  maxIterations?: number;
  /**
   * Relative early-exit threshold for the pre-pass.
   * If |observed − target| / target < earlyExit → return as-is.
   * Default: 0.005.
   */
  earlyExit?: number;
}

export interface TunePaytableResult {
  /** Deep-cloned IR with scaled paytable. */
  ir: SlotGameIR;
  /** The final scalar multiplier applied. 1.0 means no change. */
  scale: number;
  /** Number of MC iterations executed (the pre-pass counts as 1). */
  iterations: number;
  /** Observed RTP from the final sim. */
  finalRtp: number;
  /** True iff |finalRtp − target| ≤ tolerance. */
  converged: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function deepClone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/**
 * Apply a scalar multiplier to every numeric paytable + cluster_pay_table
 * entry of an IR. Returns a deep clone — input is untouched.
 *
 * Exported because the par-samples generator calls it directly for its
 * single-pass linear stage; the tuner re-uses the same primitive across
 * its bisection iterations.
 */
export function scalePaytable(ir: SlotGameIR, scale: number): SlotGameIR {
  const cloned = deepClone(ir);
  // Main paytable: { symbolId: { countOrSize: number } }
  if (cloned.paytable && typeof cloned.paytable === 'object') {
    for (const sym of Object.keys(cloned.paytable)) {
      const entries = cloned.paytable[sym];
      if (entries && typeof entries === 'object') {
        for (const k of Object.keys(entries)) {
          const v = entries[k];
          if (typeof v === 'number') {
            entries[k] = v * scale;
          }
        }
      }
    }
  }
  // Cluster pay table (kind: cluster — separate per-size pay table).
  if (
    cloned.evaluation &&
    cloned.evaluation.kind === 'cluster' &&
    'cluster_pay_table' in cloned.evaluation &&
    cloned.evaluation.cluster_pay_table
  ) {
    const cpt = cloned.evaluation.cluster_pay_table as Record<string, number>;
    for (const k of Object.keys(cpt)) {
      if (typeof cpt[k] === 'number') {
        cpt[k] = (cpt[k] as number) * scale;
      }
    }
  }
  return cloned;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Bisect a scalar paytable multiplier so the resulting IR's MC-observed RTP
 * lands within `tolerance` of `targetRtp`.
 *
 * Determinism: every iteration uses the same seed. Calling this twice with
 * the same `(ir, targetRtp, opts)` returns byte-identical `{ir, scale}`.
 *
 * @param ir         Source IR (NOT mutated — caller's reference is safe).
 * @param targetRtp  Target RTP as a 0–1 fraction (e.g. 0.96 for 96%).
 * @param opts       Tuning knobs; see `TunePaytableOptions`.
 */
export async function tunePaytableToTarget(
  ir: SlotGameIR,
  targetRtp: number,
  opts: TunePaytableOptions = {},
): Promise<TunePaytableResult> {
  const spins = opts.spins ?? 20_000;
  const seed = opts.seed ?? 12345;
  const tolerance = opts.tolerance ?? 0.005;
  const maxIterations = opts.maxIterations ?? 8;
  const earlyExit = opts.earlyExit ?? 0.005;

  if (!Number.isFinite(targetRtp) || targetRtp <= 0) {
    throw new Error(
      `tunePaytableToTarget: targetRtp must be positive finite, got ${targetRtp}`,
    );
  }

  const simCfg: IRSimConfig = { spins, seed };

  // ── Pre-pass: untuned sim ────────────────────────────────────────────────
  const initial = await runIRSimulation(ir, simCfg);
  const initialRtp = initial.rtp;
  let iterations = 1;

  // Idempotency: if we're already inside the early-exit band, hand back a
  // deep-cloned IR with scale=1. Deep-clone preserves the no-mutation
  // contract even on this happy path.
  if (
    Number.isFinite(initialRtp) &&
    initialRtp > 0 &&
    Math.abs(initialRtp - targetRtp) / targetRtp < earlyExit
  ) {
    return {
      ir: deepClone(ir),
      scale: 1.0,
      iterations,
      finalRtp: initialRtp,
      converged: Math.abs(initialRtp - targetRtp) <= tolerance,
    };
  }

  // If the pre-pass produced a non-finite or zero RTP, bisection is undefined.
  // Return non-converged with scale=1 so caller can decide policy.
  if (!Number.isFinite(initialRtp) || initialRtp <= 0) {
    return {
      ir: deepClone(ir),
      scale: 1.0,
      iterations,
      finalRtp: initialRtp,
      converged: false,
    };
  }

  // ── Iterative refinement ─────────────────────────────────────────────────
  // We maintain `(scale, rtp)` samples and combine them three ways:
  //
  //   - First refinement step: linear-estimator from the untuned RTP, i.e.
  //     `s = target / RTP₀`. For exact-linear paytable mechanics (lines /
  //     ways / cluster / pay-anywhere / pattern), this single step lands
  //     bang-on target.
  //
  //   - Subsequent steps: when we have two bracketing samples
  //     (one above target, one below), do a *secant* step — the linear
  //     interpolation in `(scale, rtp)` space picks the scale where
  //     the chord crosses `target`. This is one Newton iter on an
  //     assumed-linear local model and converges much faster than naive
  //     bisection when the underlying function is approximately linear
  //     (which is the case for paytable-scalar perturbations).
  //
  //   - Fallback: if all samples sit on the same side of target or the
  //     secant step would step outside the current bracket, fall back to
  //     a straight bisection of the bracket.
  //
  // Worst-case behaviour: each iteration runs exactly one MC sim, so the
  // hard cap of `maxIterations` is honoured regardless of strategy.

  let bestScale = 1.0;
  let bestRtp = initialRtp;
  let bestErr = Math.abs(initialRtp - targetRtp);

  // Maintain a low/high bracket as we learn. `null` means "not yet probed
  // on that side".
  let sLo: number | null = null;
  let rtpLo: number | null = null;
  let sHi: number | null = null;
  let rtpHi: number | null = null;

  // Seed the bracket from the initial sample. Initial rtp != target (we
  // already shortcut above), so we know which side scale=1 sits on.
  if (initialRtp > targetRtp) {
    sHi = 1.0;
    rtpHi = initialRtp;
  } else {
    sLo = 1.0;
    rtpLo = initialRtp;
  }

  // First refinement: linear-estimator guess.
  let nextScale = targetRtp / initialRtp;

  while (iterations < maxIterations) {
    // Defensive: scale must stay positive.
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      nextScale = bestScale * (targetRtp / Math.max(bestRtp, 1e-12));
      if (!Number.isFinite(nextScale) || nextScale <= 0) {
        break;
      }
    }

    const sim = await runIRSimulation(scalePaytable(ir, nextScale), simCfg);
    iterations++;
    const rtp = sim.rtp;
    const err = Math.abs(rtp - targetRtp);

    if (err < bestErr) {
      bestErr = err;
      bestScale = nextScale;
      bestRtp = rtp;
    }

    if (err <= tolerance) {
      return {
        ir: scalePaytable(ir, nextScale),
        scale: nextScale,
        iterations,
        finalRtp: rtp,
        converged: true,
      };
    }

    // Update bracket with this sample.
    if (rtp > targetRtp) {
      if (sHi === null || nextScale < sHi) {
        sHi = nextScale;
        rtpHi = rtp;
      }
    } else {
      if (sLo === null || nextScale > sLo) {
        sLo = nextScale;
        rtpLo = rtp;
      }
    }

    // Plan the next probe.
    if (sLo !== null && sHi !== null && rtpLo !== null && rtpHi !== null) {
      // Have a true bracket. Try secant first.
      const rtpSpan = rtpHi - rtpLo;
      if (rtpSpan > 1e-12) {
        const secant =
          sLo + ((targetRtp - rtpLo) * (sHi - sLo)) / rtpSpan;
        // Clamp into bracket with a small safety margin so we don't
        // immediately collapse one end.
        const margin = 0.1 * (sHi - sLo);
        if (secant > sLo + margin && secant < sHi - margin) {
          nextScale = secant;
        } else {
          // Secant would push to an edge — use plain bisection instead.
          nextScale = 0.5 * (sLo + sHi);
        }
      } else {
        nextScale = 0.5 * (sLo + sHi);
      }
    } else if (sLo !== null && rtpLo !== null) {
      // Only "below" samples — push higher.
      // Heuristic: extrapolate using local sensitivity if we have ≥ 2 samples
      // on this side; otherwise grow geometrically.
      nextScale = sLo * Math.max(1.5, targetRtp / Math.max(rtp, 1e-12));
    } else if (sHi !== null && rtpHi !== null) {
      // Only "above" samples — shrink.
      nextScale = sHi * Math.min(0.5, targetRtp / Math.max(rtp, 1e-12));
    } else {
      // Shouldn't reach here — initial sample always populates one side.
      nextScale = bestScale * (targetRtp / Math.max(rtp, 1e-12));
    }
  }

  return {
    ir: scalePaytable(ir, bestScale),
    scale: bestScale,
    iterations,
    finalRtp: bestRtp,
    converged: bestErr <= tolerance,
  };
}
