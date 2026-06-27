/**
 * Faza 14.4 — Variance reduction toolkit.
 *
 * Three classical MC variance-reduction techniques, packaged so the
 * simulator can compose them on top of the standard pseudo-random
 * path:
 *
 *   1. **Antithetic variates** — pair each draw `u` with `1 - u`.
 *      Removes the "monotone component" of variance for monotone
 *      integrands.
 *
 *   2. **Sobol quasi-random sequence** (van der Corput / base-2
 *      digit-reversed) — low-discrepancy points that fill the unit
 *      hypercube uniformly rather than randomly. For smooth
 *      integrands, error scales as `O((log N)^d / N)` instead of
 *      `O(1/√N)`.
 *
 *   3. **Control variates** — subtract a closely-correlated proxy
 *      with known expectation. The optimal blending coefficient is
 *      `β* = Cov(Y, X) / Var(X)`, computed on a pilot batch.
 *
 * Together they support the Faza 14.4 ambition: "1B-spin equivalent
 * CI in 100k actual spins". The module emits pure math — the engine
 * caller drives spin generation against the supplied uniform stream.
 *
 * All three techniques are unbiased: the estimator's mean equals the
 * true RTP (no systematic shift), only the variance shrinks.
 */

// ─── Antithetic variates ─────────────────────────────────────────────────────

/**
 * Generate `n` pairs of antithetic uniform samples, given a base RNG.
 * Returns a `2n`-length array where each consecutive pair sums to 1.
 *
 * For monotone integrands (winX as a monotone function of grid roll
 * `u`), `Var[(f(u) + f(1-u))/2] ≤ Var[f(u)]` with equality only when
 * `f` is affine.  Typical variance reduction for slot RTP: 30-60%.
 */
export function antitheticUniforms(n: number, rng: () => number): number[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`antitheticUniforms: n must be a non-negative integer, got ${n}`);
  }
  const out = new Array<number>(2 * n);
  for (let i = 0; i < n; i++) {
    const u = rng();
    out[2 * i] = u;
    out[2 * i + 1] = 1 - u;
  }
  return out;
}

// ─── Sobol sequence (1-dim Van der Corput, base 2) ───────────────────────────

/**
 * 1-dimensional Sobol sequence — the van der Corput sequence in base 2.
 * For each integer `i`, the i-th element is the bit-reversal of `i`
 * normalised to `[0, 1)`. This is the cheapest possible low-discrepancy
 * sequence and is fully deterministic (no RNG needed).
 *
 * Multi-dimensional Sobol requires direction-numbers + Gray-code
 * iteration — out of scope for this module (and rarely needed for
 * 1-dim slot RTP integrals).
 */
export function vanDerCorputBase2(i: number): number {
  if (!Number.isInteger(i) || i < 0) {
    throw new RangeError(`vanDerCorputBase2: i must be a non-negative integer, got ${i}`);
  }
  let n = i;
  let result = 0;
  let denom = 0.5;
  while (n > 0) {
    if (n & 1) result += denom;
    n >>>= 1;
    denom *= 0.5;
  }
  return result;
}

/** First `n` values of the base-2 van der Corput sequence. */
export function sobol1d(n: number, skip = 1): number[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`sobol1d: n must be a non-negative integer, got ${n}`);
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new RangeError(`sobol1d: skip must be a non-negative integer, got ${skip}`);
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = vanDerCorputBase2(i + skip);
  }
  return out;
}

// ─── Control variates ────────────────────────────────────────────────────────

/**
 * Estimate the optimal blending coefficient `β* = Cov(Y, X) / Var(X)`
 * from a pilot batch. `Y` is the target (e.g. game-RTP-per-spin),
 * `X` is the control (e.g. closed-form-RTP-per-spin).
 *
 * Returns 0 when `Var(X)` is degenerate.
 */
export function controlVariateBeta(
  y: ReadonlyArray<number>,
  x: ReadonlyArray<number>
): number {
  if (y.length !== x.length) {
    throw new RangeError(
      `controlVariateBeta: y and x must have same length (${y.length} vs ${x.length})`
    );
  }
  const n = y.length;
  if (n < 2) return 0;
  let meanY = 0;
  let meanX = 0;
  for (let i = 0; i < n; i++) {
    meanY += y[i];
    meanX += x[i];
  }
  meanY /= n;
  meanX /= n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
  }
  if (varX <= 0) return 0;
  return cov / varX;
}

/**
 * Apply the control variate to per-spin observations:
 *
 *   `y_hat_i = y_i − β × (x_i − E[X])`
 *
 * Returns `(adjusted_y[], variance_reduction_pct)`. The variance-
 * reduction estimate is `1 − Var(y_hat) / Var(y)` computed from the
 * input batch — caller compares to 0 to confirm the control was
 * effective.
 */
export interface ControlVariateResult {
  readonly adjustedY: ReadonlyArray<number>;
  /** Empirical variance reduction fraction in [0, 1] (clamped). */
  readonly varianceReductionPct: number;
  readonly beta: number;
}

export function applyControlVariate(input: {
  y: ReadonlyArray<number>;
  x: ReadonlyArray<number>;
  /** Known expectation of the control variate, E[X]. */
  expectedX: number;
}): ControlVariateResult {
  const { y, x, expectedX } = input;
  if (y.length !== x.length) {
    throw new RangeError('applyControlVariate: y and x must have same length');
  }
  if (y.length === 0) {
    return { adjustedY: [], varianceReductionPct: 0, beta: 0 };
  }
  const beta = controlVariateBeta(y, x);
  const adjusted = new Array<number>(y.length);
  for (let i = 0; i < y.length; i++) {
    adjusted[i] = y[i] - beta * (x[i] - expectedX);
  }
  const varY = variance(y);
  const varAdj = variance(adjusted);
  const reduction = varY <= 0 ? 0 : 1 - varAdj / varY;
  return {
    adjustedY: adjusted,
    varianceReductionPct: Math.max(0, Math.min(1, reduction)),
    beta,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function variance(xs: ReadonlyArray<number>): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mean = 0;
  for (const v of xs) mean += v;
  mean /= n;
  let acc = 0;
  for (const v of xs) {
    const d = v - mean;
    acc += d * d;
  }
  return acc / (n - 1);
}
