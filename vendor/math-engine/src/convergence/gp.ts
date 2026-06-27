/**
 * Faza 13.10 — Predictive Convergence ML
 *
 * Gaussian Process with RBF (squared-exponential) kernel.
 * Pure TypeScript — no external ML dependencies.
 *
 * Kernel:
 *   k(x, y) = sigma2 * exp( -||x - y||^2 / (2 * ell^2) )
 *
 * Inference:
 *   Given training data (X, y), predict mean and variance at new X*.
 *   mu* = K(X*, X) [K(X,X) + noise*I]^{-1} y
 *   var* = K(X*, X*) - K(X*, X) [K(X,X) + noise*I]^{-1} K(X, X*)
 */

import type { GPConfig } from './types.js';

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_GP_CONFIG: GPConfig = {
  sigma2: 1.0,
  lengthScale: 1.0,
  noiseVariance: 1e-4,
};

// ============================================================================
// LINEAR ALGEBRA HELPERS
// ============================================================================

/**
 * Cholesky decomposition of a symmetric positive-definite matrix A.
 * Returns lower triangular L such that A = L * L^T.
 * Uses the standard Cholesky–Banachiewicz algorithm.
 */
function cholesky(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        const val = A[i][i] - sum;
        L[i][j] = val > 0 ? Math.sqrt(val) : Math.sqrt(Math.abs(val) + 1e-12);
      } else {
        L[i][j] = L[j][j] > 0 ? (A[i][j] - sum) / L[j][j] : 0;
      }
    }
  }
  return L;
}

/**
 * Solve the lower-triangular system L * x = b using forward substitution.
 */
function forwardSolve(L: number[][], b: number[]): number[] {
  const n = b.length;
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < i; j++) {
      sum += L[i][j] * x[j];
    }
    x[i] = L[i][i] !== 0 ? (b[i] - sum) / L[i][i] : 0;
  }
  return x;
}

/**
 * Solve the upper-triangular system L^T * x = b using back substitution.
 */
function backSolve(L: number[][], b: number[]): number[] {
  const n = b.length;
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) {
      sum += L[j][i] * x[j]; // L^T[i][j] = L[j][i]
    }
    x[i] = L[i][i] !== 0 ? (b[i] - sum) / L[i][i] : 0;
  }
  return x;
}

/**
 * Solve (L L^T) x = b using forward + back substitution.
 */
function choleskySolve(L: number[][], b: number[]): number[] {
  const y = forwardSolve(L, b);
  return backSolve(L, y);
}

// ============================================================================
// GAUSSIAN PROCESS
// ============================================================================

/**
 * Prediction result from the Gaussian Process.
 */
export interface GPPrediction {
  /** Posterior mean at the query point */
  mean: number;
  /** Posterior variance at the query point */
  variance: number;
}

/**
 * Gaussian Process regressor with RBF (squared-exponential) kernel.
 *
 * Input features are 1-D scalars.  The class is intentionally minimal —
 * only the methods required by ConvergencePredictor are exposed.
 */
export class GaussianProcess {
  private readonly _cfg: GPConfig;

  /** Training inputs (normalised log-scale) */
  private _xs: number[] = [];
  /** Training targets */
  private _ys: number[] = [];

  /** Cached Cholesky factor of (K + noise*I) */
  private _L: number[][] | null = null;
  /** Cached alpha = (K + noise*I)^{-1} y */
  private _alpha: number[] | null = null;

  constructor(config: Partial<GPConfig> = {}) {
    this._cfg = { ...DEFAULT_GP_CONFIG, ...config };
  }

  // ──────────────────────────────────────────────────────────────────
  // Kernel
  // ──────────────────────────────────────────────────────────────────

  /**
   * RBF kernel: k(x, y) = sigma2 * exp( -(x-y)^2 / (2*ell^2) )
   */
  private _k(x: number, y: number): number {
    const { sigma2, lengthScale: ell } = this._cfg;
    const d = x - y;
    return sigma2 * Math.exp(-(d * d) / (2 * ell * ell));
  }

  // ──────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────

  /**
   * Fit the GP to training data.
   * @param xs  Input values (1-D)
   * @param ys  Target values
   */
  fit(xs: number[], ys: number[]): void {
    if (xs.length !== ys.length) {
      throw new Error(`GaussianProcess.fit: xs.length (${xs.length}) !== ys.length (${ys.length})`);
    }
    this._xs = xs.slice();
    this._ys = ys.slice();
    this._L = null;
    this._alpha = null;

    if (xs.length === 0) return;

    // Build kernel matrix K(X, X) + noise*I
    const n = xs.length;
    const K: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => {
        const kij = this._k(xs[i], xs[j]);
        return i === j ? kij + this._cfg.noiseVariance : kij;
      }),
    );

    this._L = cholesky(K);
    this._alpha = choleskySolve(this._L, ys);
  }

  /**
   * Predict the posterior mean and variance at a new input point x*.
   */
  predict(xStar: number): GPPrediction {
    if (this._xs.length === 0 || this._alpha === null || this._L === null) {
      // Prior: mean 0, prior variance = sigma2
      return { mean: 0, variance: this._cfg.sigma2 };
    }

    // k* = K(x*, X)
    const kStar = this._xs.map(xi => this._k(xStar, xi));

    // Posterior mean: mu* = k*^T * alpha
    const mean = kStar.reduce((acc, k, i) => acc + k * this._alpha![i], 0);

    // Posterior variance: var* = k(x*, x*) - k*^T (K + noise*I)^{-1} k*
    //   = k(x*, x*) - v^T v   where v = L^{-1} k*
    const kStarStar = this._k(xStar, xStar) + this._cfg.noiseVariance;
    const v = forwardSolve(this._L, kStar);
    const vTv = v.reduce((acc, vi) => acc + vi * vi, 0);
    const variance = Math.max(0, kStarStar - vTv);

    return { mean, variance };
  }

  /** Number of training points currently stored. */
  get trainingSize(): number {
    return this._xs.length;
  }

  /** The GP configuration in use. */
  get config(): GPConfig {
    return { ...this._cfg };
  }
}
