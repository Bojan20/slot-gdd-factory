#!/usr/bin/env node
/**
 * tools/auto-converge-solver.mjs
 *
 * LV3-13 — Auto-convergence solver (MATH-INTEGRATION-LV3, Boki 2026-06-26).
 *
 * # WHY
 *
 * Boki's directive (2026-06-25): "pametan simulator koji sam računa sve
 * dok ne dobije željeni rezultat." The slot factory parses a GDD that
 * DECLARES a target RTP (e.g. 96.00 ± 0.05%). The Rust kernel can MEASURE
 * the actual RTP for any reel-weight / FS-frequency / multiplier-distribution
 * triple. This solver bridges them:
 *
 *   1. Read GDD targets (RTP, volatility, hit-rate, max-win).
 *   2. Initialize parameters from smartDefaults.
 *   3. Run Rust kernel → measure delta.
 *   4. If |delta| > tolerance → apply Newton-Raphson (1D, single
 *      sensitivity dimension) or Nelder-Mead (multi-D simplex) update.
 *   5. Re-run with new parameters.
 *   6. Loop until |delta| ≤ tolerance OR iteration cap OR stagnation.
 *
 * Output: converged model.json + convergence history JSONL + verdict.
 *
 * # WHY DETERMINISTIC (NO AI IN THE LOOP)
 *
 * Regulator certification (UKGC, MGA, NJDGE) requires that a math
 * deliverable can be RE-RUN by an independent auditor and produce
 * byte-identical results. An LLM in the loop breaks that contract.
 * This solver uses Newton-Raphson + Nelder-Mead — both are textbook
 * deterministic numerical methods with reproducible convergence given
 * the same seed.
 *
 * # API
 *
 *   import { solveRtp, NewtonOneD, NelderMead } from '...';
 *
 *   const result = await solveRtp({
 *     model,                            // parsed GDD model
 *     targetRtp: 0.96,                  // from GDD declared
 *     toleranceBps: 5,                  // ±5 basis points = ±0.05%
 *     maxIterations: 30,
 *     probeSpins: 250_000,              // per-iteration Rust kernel call
 *     runner: customRunOnce,            // dependency-inject for tests
 *   });
 *
 *   result.converged → boolean
 *   result.iterations → [{step, params, measuredRtp, deltaBps}]
 *   result.finalParams → { reelWeightScale, fsFrequencyScale, ... }
 *
 * # CONVERGENCE STRATEGIES
 *
 *   strategy: 'newton' (default, 1D scale parameter)
 *     - Pick one knob (default: reel weight scale).
 *     - Newton-Raphson: param_{n+1} = param_n - (rtp_n - target) / slope_n
 *     - Slope estimated by finite-difference probe.
 *     - Fast (2-5 iterations typical) but assumes monotonic.
 *
 *   strategy: 'simplex' (Nelder-Mead, N-D)
 *     - Multi-dimensional simplex over { weight_scale, fs_freq_scale,
 *       multiplier_pool_shift }.
 *     - Slower (20-40 iterations) but escapes local plateaus.
 *
 * # ALL DETERMINISTIC
 *
 *   - Same seed → same convergence path.
 *   - Same initial params + same target → byte-identical history JSONL.
 *   - Zero RNG outside the Rust kernel (which itself uses PCG64 + HSM seed).
 */

/* ─── 1-D Newton-Raphson ──────────────────────────────────────────── */

/**
 * Single-knob Newton-Raphson solver.
 *
 * @template T
 * @param {{
 *   initial: number,
 *   target: number,
 *   measure: (param: number) => Promise<number> | number,
 *   tolerance: number,
 *   maxIterations?: number,
 *   slopeStep?: number,
 *   bounds?: [number, number],
 * }} opts
 * @returns {Promise<{converged: boolean, finalParam: number,
 *   finalMeasured: number, iterations: Array<{step:number,param:number,
 *   measured:number,delta:number,slope?:number}>}>}
 */
export async function NewtonOneD(opts) {
  const {
    initial,
    target,
    measure,
    tolerance,
    maxIterations = 30,
    slopeStep = 0.01,
    bounds = [0.01, 100],
  } = opts;
  const [lo, hi] = bounds;
  const _clamp = (x) => Math.min(hi, Math.max(lo, x));
  const iterations = [];
  let param = _clamp(initial);

  for (let step = 0; step < maxIterations; step++) {
    const measured = await measure(param);
    const delta = measured - target;
    iterations.push({ step, param, measured, delta });
    if (Math.abs(delta) <= tolerance) {
      return { converged: true, finalParam: param, finalMeasured: measured, iterations };
    }
    /* Forward-difference slope estimate (central would cost 2 calls
       per iteration — keep cheaper unless slope is unstable). */
    const probeParam = _clamp(param + slopeStep);
    const probeMeasured = await measure(probeParam);
    const slope = (probeMeasured - measured) / (probeParam - param);
    iterations[iterations.length - 1].slope = slope;
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) {
      /* Flat — Newton can't make progress, bail out. */
      return {
        converged: false,
        finalParam: param,
        finalMeasured: measured,
        iterations,
        reason: 'slope vanished — sensitivity exhausted',
      };
    }
    const next = _clamp(param - delta / slope);
    if (next === param) {
      /* Step too small to register against clamp bounds. */
      return {
        converged: false,
        finalParam: param,
        finalMeasured: measured,
        iterations,
        reason: 'step pinned by bounds',
      };
    }
    param = next;
  }
  return {
    converged: false,
    finalParam: param,
    finalMeasured: iterations[iterations.length - 1]?.measured,
    iterations,
    reason: `max iterations (${maxIterations}) reached`,
  };
}

/* ─── Nelder-Mead simplex (N-D) ──────────────────────────────────── */

/**
 * Multi-dimensional Nelder-Mead minimizer. Minimizes `objective(params)`
 * over an N-dimensional parameter vector. Standard textbook constants
 * (reflection α=1, expansion γ=2, contraction ρ=0.5, shrink σ=0.5).
 *
 * Used by `solveRtp` when 1D Newton stalls or when the GDD has multiple
 * coupled targets (RTP + hit-rate + volatility).
 *
 * @param {{
 *   initial: number[],
 *   step: number,
 *   objective: (params: number[]) => Promise<number> | number,
 *   tolerance: number,
 *   maxIterations?: number,
 *   bounds?: Array<[number, number]>,
 * }} opts
 * @returns {Promise<{converged: boolean, finalParams: number[],
 *   finalScore: number, iterations: number}>}
 */
export async function NelderMead(opts) {
  const {
    initial,
    step,
    objective,
    tolerance,
    maxIterations = 100,
    bounds,
  } = opts;
  const N = initial.length;
  const _clampVec = (v) => {
    if (!bounds) return v.slice();
    return v.map((x, i) => {
      const [lo, hi] = bounds[i] || [-Infinity, Infinity];
      return Math.min(hi, Math.max(lo, x));
    });
  };
  /* Build initial simplex: N+1 vertices = base + N axis-perturbed. */
  const vertices = [_clampVec(initial.slice())];
  for (let i = 0; i < N; i++) {
    const v = initial.slice();
    v[i] += step;
    vertices.push(_clampVec(v));
  }
  /* Evaluate all vertices. */
  const scores = [];
  for (const v of vertices) {
    scores.push(await objective(v));
  }
  let iter = 0;
  while (iter < maxIterations) {
    /* Sort by score (ascending — minimization). */
    const indexed = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
    const best = indexed[0];
    const worst = indexed[N];
    if (Math.abs(worst.s - best.s) <= tolerance) {
      return {
        converged: true,
        finalParams: vertices[best.i],
        finalScore: best.s,
        iterations: iter,
      };
    }
    /* Centroid of N best (excluding worst). */
    const centroid = new Array(N).fill(0);
    for (let k = 0; k < N; k++) {
      const idx = indexed[k].i;
      for (let j = 0; j < N; j++) centroid[j] += vertices[idx][j];
    }
    for (let j = 0; j < N; j++) centroid[j] /= N;

    /* Reflection. */
    const xr = _clampVec(centroid.map((c, j) => c + 1.0 * (c - vertices[worst.i][j])));
    const fr = await objective(xr);
    if (fr >= best.s && fr < indexed[N - 1].s) {
      vertices[worst.i] = xr;
      scores[worst.i] = fr;
    } else if (fr < best.s) {
      /* Expansion. */
      const xe = _clampVec(centroid.map((c, j) => c + 2.0 * (xr[j] - c)));
      const fe = await objective(xe);
      vertices[worst.i] = fe < fr ? xe : xr;
      scores[worst.i] = fe < fr ? fe : fr;
    } else {
      /* Contraction. */
      const xc = _clampVec(centroid.map((c, j) => c + 0.5 * (vertices[worst.i][j] - c)));
      const fc = await objective(xc);
      if (fc < worst.s) {
        vertices[worst.i] = xc;
        scores[worst.i] = fc;
      } else {
        /* Shrink toward best. */
        const bestVertex = vertices[best.i];
        for (let k = 0; k < N + 1; k++) {
          if (k === best.i) continue;
          vertices[k] = _clampVec(vertices[k].map((x, j) => bestVertex[j] + 0.5 * (x - bestVertex[j])));
          scores[k] = await objective(vertices[k]);
        }
      }
    }
    iter++;
  }
  const indexed = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
  return {
    converged: false,
    finalParams: vertices[indexed[0].i],
    finalScore: indexed[0].s,
    iterations: iter,
  };
}

/* ─── solveRtp: high-level driver ────────────────────────────────── */

/**
 * Convergence loop: tune parameters until measured RTP lands within
 * `toleranceBps` of `targetRtp`. Returns convergence history + final
 * parameters that any downstream consumer can stamp onto model.json.
 *
 * @param {{
 *   model: object,
 *   targetRtp: number,
 *   toleranceBps?: number,
 *   maxIterations?: number,
 *   probeSpins?: number,
 *   strategy?: 'newton' | 'simplex',
 *   runner: (config: object) => Promise<{ok: boolean, rtp?: number,
 *           hitRate?: number, latencyMs: number, reason?: string}>,
 * }} opts
 * @returns {Promise<{converged: boolean, finalParams: object,
 *   finalRtp: number, deltaBps: number, iterations:
 *   Array<{step:number,params:object,measuredRtp:number,deltaBps:number,
 *   latencyMs:number}>, reason?: string}>}
 */
export async function solveRtp(opts) {
  const {
    model,
    targetRtp,
    toleranceBps = 5,
    maxIterations = 20,
    probeSpins = 250_000,
    strategy = 'newton',
    runner,
  } = opts;
  if (typeof runner !== 'function') {
    throw new TypeError('solveRtp: runner is required (use sister-rust-server.runOnce)');
  }
  if (!Number.isFinite(targetRtp) || targetRtp <= 0 || targetRtp >= 2) {
    throw new RangeError(
      `solveRtp: targetRtp must be ∈ (0, 2) — got ${targetRtp}. Did you pass a percent (e.g. 96) instead of a fraction (0.96)?`,
    );
  }
  const tolerance = toleranceBps / 10_000; // 5 bps = 0.0005
  const history = [];

  /* Build config from current parameters; runner accepts a single
     scale knob `reelWeightScale` for the 1D Newton path. */
  const _buildConfig = (params) => ({
    name: model?.name || 'auto-converge-probe',
    schema: model?.__schema__?.version || '1.0.0',
    topology: model?.topology || { reels: 5, rows: 3, paylines: 20 },
    featureKind: 'baseline',
    spins: probeSpins,
    seed: 42, // deterministic
    /* Solver-introduced knobs — the Rust kernel reads these and
       multiplies / shifts its internal distributions accordingly. */
    reelWeightScale: params.reelWeightScale,
    fsFrequencyScale: params.fsFrequencyScale,
    multiplierPoolShift: params.multiplierPoolShift,
  });

  if (strategy === 'newton') {
    let lastResult = null;
    const newton = await NewtonOneD({
      initial: 1.0,
      target: targetRtp,
      tolerance,
      maxIterations,
      slopeStep: 0.02,
      bounds: [0.1, 5.0],
      measure: async (scale) => {
        const params = { reelWeightScale: scale, fsFrequencyScale: 1.0, multiplierPoolShift: 0 };
        const cfg = _buildConfig(params);
        const r = await runner(cfg);
        lastResult = r;
        if (!r.ok || typeof r.rtp !== 'number') {
          /* Solver gets a sentinel that pushes it away (target + huge
             penalty so the direction stays meaningful). */
          history.push({
            step: history.length,
            params,
            measuredRtp: NaN,
            deltaBps: NaN,
            latencyMs: r.latencyMs || 0,
            error: r.reason,
          });
          return targetRtp + (targetRtp > 0.5 ? -0.5 : 0.5);
        }
        history.push({
          step: history.length,
          params,
          measuredRtp: r.rtp,
          deltaBps: (r.rtp - targetRtp) * 10_000,
          latencyMs: r.latencyMs,
        });
        return r.rtp;
      },
    });
    return {
      converged: newton.converged,
      finalParams: {
        reelWeightScale: newton.finalParam,
        fsFrequencyScale: 1.0,
        multiplierPoolShift: 0,
      },
      finalRtp: newton.finalMeasured,
      deltaBps: (newton.finalMeasured - targetRtp) * 10_000,
      iterations: history,
      reason: newton.reason,
    };
  }

  if (strategy === 'simplex') {
    let lastParams = null;
    const nelder = await NelderMead({
      initial: [1.0, 1.0, 0.0],
      step: 0.1,
      tolerance,
      maxIterations,
      bounds: [
        [0.1, 5.0],
        [0.1, 5.0],
        [-0.5, 0.5],
      ],
      objective: async ([wScale, fsScale, mShift]) => {
        const params = {
          reelWeightScale: wScale,
          fsFrequencyScale: fsScale,
          multiplierPoolShift: mShift,
        };
        lastParams = params;
        const r = await runner(_buildConfig(params));
        if (!r.ok || typeof r.rtp !== 'number') {
          history.push({
            step: history.length,
            params,
            measuredRtp: NaN,
            deltaBps: NaN,
            latencyMs: r.latencyMs || 0,
            error: r.reason,
          });
          return Math.abs(targetRtp) * 10; // heavy penalty
        }
        const deltaBps = Math.abs(r.rtp - targetRtp) * 10_000;
        history.push({
          step: history.length,
          params,
          measuredRtp: r.rtp,
          deltaBps: (r.rtp - targetRtp) * 10_000,
          latencyMs: r.latencyMs,
        });
        return Math.abs(r.rtp - targetRtp);
      },
    });
    const finalDelta = Math.abs(nelder.finalScore);
    return {
      converged: nelder.converged && finalDelta <= tolerance,
      finalParams: lastParams || {
        reelWeightScale: nelder.finalParams[0],
        fsFrequencyScale: nelder.finalParams[1],
        multiplierPoolShift: nelder.finalParams[2],
      },
      finalRtp: targetRtp + (nelder.finalScore * Math.sign(nelder.finalScore || 1)),
      deltaBps: nelder.finalScore * 10_000,
      iterations: history,
      reason: nelder.converged ? undefined : `simplex maxIterations (${maxIterations}) reached`,
    };
  }

  throw new Error(`solveRtp: unknown strategy ${JSON.stringify(strategy)} (try 'newton' or 'simplex')`);
}

/* ─── test seam ──────────────────────────────────────────────────── */

/**
 * Test-only helper — build a deterministic synthetic measure function
 * that simulates a monotonic relationship between a single scale knob
 * and measured RTP. Lets unit tests verify the Newton driver without
 * spawning the Rust kernel.
 *
 * @param {{ baseRtp?: number, sensitivity?: number, noise?: number }} [opts]
 * @returns {(scale: number) => number}
 */
export function _syntheticRtpModel(opts = {}) {
  const baseRtp = opts.baseRtp ?? 0.94;
  const sensitivity = opts.sensitivity ?? 0.02;
  const noise = opts.noise ?? 0;
  return (scale) => baseRtp + sensitivity * (scale - 1.0) + noise * (scale - 1.0) * (scale - 1.0);
}
