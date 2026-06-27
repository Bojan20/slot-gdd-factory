/**
 * W152 Wave 20 — Feature Trigger Profiler (Faza 15.C.5).
 *
 * Bonus / feature trigger frequency modeling. Two distributions
 * supported:
 *
 *   * **Poisson(λ)** — simple "hits per unit interval", suitable when
 *     trigger probability is constant per spin (e.g. classic FS scatter).
 *   * **Negative Binomial NB(r, p)** — generalisation when triggers
 *     come in clusters (e.g. retrigger-heavy bonuses, hit-and-tilt
 *     mechanics). Captures over-dispersion (variance > mean).
 *
 * Method:
 *   * MLE for Poisson — direct closed-form `λ̂ = mean`.
 *   * MLE for NB — iterative via Newton on the digamma equation
 *     (Anscombe 1950; Cameron & Trivedi 1998 §3.3).
 *
 * Model selection: AIC comparison. NB favoured if `AIC_NB < AIC_Poisson`
 * after the standard 2k penalty.
 *
 * Naming policy: `triggerProfiler` engine-generic. Pure module.
 */

export interface TriggerObservations {
  /** Per-bin trigger counts (e.g. triggers per 1000 spins). */
  counts: number[];
  /** Bin width in spins (default 1, but typically 100-1000). */
  binSpins?: number;
}

export interface PoissonFit {
  kind: 'poisson';
  lambda: number;
  logLikelihood: number;
  aic: number;
  meanCount: number;
  varianceCount: number;
}

export interface NegBinomialFit {
  kind: 'negative_binomial';
  /** Dispersion parameter r > 0. */
  r: number;
  /** Per-trial success probability p ∈ (0, 1). */
  p: number;
  logLikelihood: number;
  aic: number;
  meanCount: number;
  varianceCount: number;
  /** Iterations consumed by MLE Newton solver. */
  iterations: number;
}

export type TriggerFit = PoissonFit | NegBinomialFit;

export interface ModelSelectionResult {
  poisson: PoissonFit;
  negBinomial: NegBinomialFit;
  /** Better-fit model by AIC (lower = better). */
  best: 'poisson' | 'negative_binomial';
  /** AIC delta = AIC_loser − AIC_winner. */
  aicDelta: number;
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

/** Sum array. */
function sum(arr: number[]): number {
  let s = 0;
  for (const x of arr) s += x;
  return s;
}

/** Sample mean. */
function meanOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  return sum(arr) / arr.length;
}

/** Sample variance (N denominator — population). */
function varianceOf(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = meanOf(arr);
  let v = 0;
  for (const x of arr) v += (x - m) ** 2;
  return v / arr.length;
}

/** ln(n!) via Stirling for n >= 0. Exact for small n via lookup. */
function logFactorial(n: number): number {
  if (n < 0) return NaN;
  if (n < 2) return 0;
  // Stirling with Ramanujan correction (accurate to ~1e-10 for n >= 10)
  if (n < 100) {
    let lf = 0;
    for (let k = 2; k <= n; k++) lf += Math.log(k);
    return lf;
  }
  // For large n, full Stirling
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
}

/** Lanczos digamma approximation (Bernardo 1976). Precise to ~1e-8. */
function digamma(x: number): number {
  if (x < 6) {
    return digamma(x + 1) - 1 / x;
  }
  return (
    Math.log(x) -
    1 / (2 * x) -
    1 / (12 * x * x) +
    1 / (120 * x * x * x * x) -
    1 / (252 * x * x * x * x * x * x)
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Poisson MLE
// ════════════════════════════════════════════════════════════════════════════

export function fitPoisson(obs: TriggerObservations): PoissonFit {
  const counts = obs.counts;
  if (counts.length === 0) {
    throw new Error('fitPoisson: empty observations');
  }
  for (const c of counts) {
    if (!Number.isInteger(c) || c < 0) {
      throw new RangeError(`fitPoisson: counts must be non-negative integers (got ${c})`);
    }
  }
  const lambda = meanOf(counts);
  // Log-likelihood: Σ [k_i × log(λ) − λ − log(k_i!)]
  let ll = 0;
  for (const k of counts) {
    ll += k * Math.log(Math.max(lambda, 1e-300)) - lambda - logFactorial(k);
  }
  // AIC = 2k − 2ll, k = 1 (lambda)
  const aic = 2 * 1 - 2 * ll;
  return {
    kind: 'poisson',
    lambda,
    logLikelihood: ll,
    aic,
    meanCount: meanOf(counts),
    varianceCount: varianceOf(counts),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Negative Binomial MLE (method-of-moments seed + Newton on digamma)
// ════════════════════════════════════════════════════════════════════════════

export function fitNegBinomial(obs: TriggerObservations, opts: { maxIterations?: number; tol?: number } = {}): NegBinomialFit {
  const counts = obs.counts;
  if (counts.length === 0) {
    throw new Error('fitNegBinomial: empty observations');
  }
  for (const c of counts) {
    if (!Number.isInteger(c) || c < 0) {
      throw new RangeError(`fitNegBinomial: counts must be non-negative integers (got ${c})`);
    }
  }
  const m = meanOf(counts);
  const v = varianceOf(counts);
  if (v <= m + 1e-9) {
    // Variance ≤ mean → not over-dispersed → NB collapses toward Poisson.
    // We still produce a fit by falling back to a tiny over-dispersion seed.
    const r = 1e6;
    const p = r / (r + m);
    return finaliseNB(counts, r, p, 0, m, v);
  }
  // Method-of-moments seed: r = m^2 / (v - m)
  let r = (m * m) / (v - m);
  const tol = opts.tol ?? 1e-8;
  const maxIter = opts.maxIterations ?? 100;
  let iterations = 0;

  // Bisection-bracket the log-likelihood maximum first. NB MLE is
  // unimodal in r → bisection finds the optimum robustly even when
  // Newton overshoots into the asymptotic-Poisson regime. We bracket
  // r ∈ [0.01, 1e6] then refine to ±1e-3 precision before letting
  // Newton polish (if needed).
  const llAt = (rTrial: number): number => {
    let s = 0;
    for (const k of counts) {
      s +=
        logGammaApprox(k + rTrial) -
        logGammaApprox(rTrial) -
        logFactorial(k) +
        rTrial * Math.log(rTrial / (rTrial + m)) +
        k * Math.log(m / (rTrial + m));
    }
    return s;
  };
  // Wide bracket — covers full plausible NB range. Any r above 1e6 is
  // numerically Poisson; below 0.001 the distribution degenerates.
  let lo = 0.001;
  let hi = 1e6;
  // Golden-section refinement on log-r axis (better resolution at small r
  // where the optimum often lives for over-dispersed data).
  let logLo = Math.log(lo);
  let logHi = Math.log(hi);
  for (let bi = 0; bi < 80; bi++) {
    iterations += 1;
    const logA = logLo + (logHi - logLo) * 0.382;
    const logB = logLo + (logHi - logLo) * 0.618;
    if (llAt(Math.exp(logA)) > llAt(Math.exp(logB))) logHi = logB;
    else logLo = logA;
    if (logHi - logLo < 1e-6) break;
  }
  r = Math.exp((logLo + logHi) / 2);
  // Bisection on the log axis is enough — Newton on top of bisection-
  // located optimum either converges in 1-2 iterations or oscillates
  // due to digamma-trigamma approximation noise. We use the bisection
  // result directly. `tol`/`maxIter` retained for API compat (no-op now).
  void tol;
  void maxIter;
  const p = r / (r + m);
  return finaliseNB(counts, r, p, iterations, m, v);
}

function trigammaApprox(x: number): number {
  if (x < 6) {
    return trigammaApprox(x + 1) + 1 / (x * x);
  }
  return 1 / x + 1 / (2 * x * x) + 1 / (6 * x * x * x);
}

function finaliseNB(
  counts: number[],
  r: number,
  p: number,
  iterations: number,
  meanCount: number,
  varianceCount: number,
): NegBinomialFit {
  let ll = 0;
  for (const k of counts) {
    // log P(k) = log Γ(k+r) − log Γ(r) − log k! + r log p + k log(1-p)
    // Use lgamma via accumulated logFactorial for integer k+r when r close to integer.
    ll += logGammaApprox(k + r) - logGammaApprox(r) - logFactorial(k) + r * Math.log(p) + k * Math.log(1 - p);
  }
  const aic = 2 * 2 - 2 * ll;
  return {
    kind: 'negative_binomial',
    r,
    p,
    logLikelihood: ll,
    aic,
    meanCount,
    varianceCount,
    iterations,
  };
}

/** Log-gamma via Stirling. Precise to ~1e-7 for x >= 1. */
function logGammaApprox(x: number): number {
  if (x < 1) return logGammaApprox(x + 1) - Math.log(x);
  if (x < 10) {
    let acc = 0;
    let cur = x;
    while (cur < 10) {
      acc -= Math.log(cur);
      cur += 1;
    }
    return acc + logGammaApprox(cur);
  }
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * x);
}

// ════════════════════════════════════════════════════════════════════════════
// Model selection
// ════════════════════════════════════════════════════════════════════════════

export function selectBestTriggerModel(obs: TriggerObservations): ModelSelectionResult {
  const poisson = fitPoisson(obs);
  const negBinomial = fitNegBinomial(obs);
  const best = poisson.aic < negBinomial.aic ? 'poisson' : 'negative_binomial';
  const aicDelta = Math.abs(poisson.aic - negBinomial.aic);
  return { poisson, negBinomial, best, aicDelta };
}
