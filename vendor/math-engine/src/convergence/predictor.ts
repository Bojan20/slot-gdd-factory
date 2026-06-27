/**
 * Faza 13.10 — Predictive Convergence ML
 *
 * ConvergencePredictor accumulates (spinCount, rtpEstimate, ci95) observations
 * and predicts how many total spins are needed to reach a target CI95 width.
 *
 * Two prediction methods are available:
 *
 * 1. power_law  (default, always available with ≥ 2 observations)
 *    CI ≈ a / sqrt(n)  →  n = (a / targetCI)^2
 *    Fit by regressing log(CI) on log(n).
 *
 * 2. gp  (Gaussian Process, available when minObservationsForGP is met)
 *    GP is trained on (log(n), log(CI)) pairs and used to predict the
 *    log(n) at which log(CI) = log(targetCI).
 */

import { GaussianProcess } from './gp.js';
import type {
  ConvergencePoint,
  ConvergencePrediction,
  ConvergencePredictorConfig,
  GPConfig,
} from './types.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Safe natural log — clamps input to a minimum to avoid -Infinity.
 */
function safeLog(x: number): number {
  return Math.log(Math.max(x, 1e-15));
}

/**
 * Ordinary Least Squares fit of y = a + b*x.
 * Returns { intercept, slope }.
 */
function ols(xs: number[], ys: number[]): { intercept: number; slope: number } {
  const n = xs.length;
  if (n === 0) return { intercept: 0, slope: 0 };
  if (n === 1) return { intercept: ys[0], slope: 0 };

  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX  += xs[i];
    sumY  += ys[i];
    sumXX += xs[i] * xs[i];
    sumXY += xs[i] * ys[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-15) {
    // degenerate — all x equal
    return { intercept: sumY / n, slope: 0 };
  }
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { intercept, slope };
}

// ============================================================================
// CONVERGENCE PREDICTOR
// ============================================================================

const DEFAULT_MIN_OBS_FOR_GP = 3;

export class ConvergencePredictor {
  private readonly _targetRtp: number | undefined;
  private readonly _minObsForGP: number;
  private readonly _gpCfg: Partial<GPConfig>;

  /** Accumulated observation history */
  private readonly _history: ConvergencePoint[] = [];

  /** GP instance (retrained on each prediction when sufficient data) */
  private _gp: GaussianProcess;

  constructor(config: ConvergencePredictorConfig = {}) {
    this._targetRtp   = config.targetRtp;
    this._minObsForGP = config.minObservationsForGP ?? DEFAULT_MIN_OBS_FOR_GP;
    this._gpCfg       = config.gpConfig ?? {};
    this._gp          = new GaussianProcess(this._gpCfg);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record a new observation from a Monte Carlo run.
   *
   * @param spinCount     Total spins simulated so far
   * @param rtpEstimate   Current RTP estimate (e.g. 0.953)
   * @param currentCI95   Current 95% CI half-width (e.g. 0.042 means ±4.2%)
   */
  addObservation(spinCount: number, rtpEstimate: number, currentCI95: number): void {
    this._history.push({ spinCount, rtpEstimate, ci95: currentCI95 });
  }

  /**
   * Predict the total number of spins needed to achieve `targetCI95`.
   *
   * @param targetCI95  Desired 95% CI half-width to reach (e.g. 0.005)
   * @param targetRtp   Optional override of the constructor-level targetRtp
   * @returns ConvergencePrediction
   */
  predictRemainingSpins(
    targetCI95: number,
    targetRtp?: number,
  ): ConvergencePrediction {
    void targetRtp; // used only for future extension; optional per spec

    const n = this._history.length;
    const currentCI = n > 0 ? this._history[n - 1].ci95 : Infinity;
    const currentN  = n > 0 ? this._history[n - 1].spinCount : 0;

    // Edge case — no observations
    if (n === 0) {
      return {
        predictedN:  0,
        confidence:  0,
        method:      'power_law',
        currentCI:   Infinity,
      };
    }

    // Already converged
    if (currentCI <= targetCI95) {
      return {
        predictedN:  currentN,
        confidence:  1.0,
        method:      'power_law',
        currentCI,
      };
    }

    // Always compute power-law prediction (requires ≥ 1 obs)
    const plResult = this._powerLawPredict(targetCI95);

    // Use GP if we have enough observations
    if (n >= this._minObsForGP) {
      const gpResult = this._gpPredict(targetCI95, currentN, currentCI, plResult.predictedN);
      if (gpResult !== null) return gpResult;
    }

    return plResult;
  }

  /** Number of accumulated observations. */
  get observationCount(): number {
    return this._history.length;
  }

  /** A copy of the accumulated observation history. */
  get history(): ConvergencePoint[] {
    return this._history.slice();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal: Power-Law Prediction
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Fit CI ≈ a / sqrt(n), i.e. log(CI) = log(a) - 0.5 * log(n).
   * In practice we let the slope be free: log(CI) = c + b * log(n).
   * Then solve for log(n) = (log(targetCI) - c) / b.
   */
  private _powerLawPredict(targetCI95: number): ConvergencePrediction {
    const n = this._history.length;
    const currentCI  = this._history[n - 1].ci95;
    const currentN   = this._history[n - 1].spinCount;

    if (n === 1) {
      // Single observation: use theoretical CI ≈ a / sqrt(n) →
      // a = CI * sqrt(n), then predictedN = (a / targetCI)^2
      const a          = currentCI * Math.sqrt(currentN);
      const predictedN = Math.ceil((a / targetCI95) ** 2);
      return {
        predictedN: Math.max(predictedN, currentN),
        confidence:  0.5,
        method:      'power_law',
        currentCI,
      };
    }

    // Multi-point OLS in log-log space
    const logNs  = this._history.map(p => safeLog(p.spinCount));
    const logCIs = this._history.map(p => safeLog(p.ci95));

    const { intercept, slope } = ols(logNs, logCIs);

    let predictedN: number;
    if (Math.abs(slope) < 1e-10) {
      // Flat: can't extrapolate — use fallback
      const a          = currentCI * Math.sqrt(currentN);
      predictedN       = Math.ceil((a / targetCI95) ** 2);
    } else {
      const logNTarget = (safeLog(targetCI95) - intercept) / slope;
      predictedN       = Math.ceil(Math.exp(logNTarget));
    }

    predictedN = Math.max(predictedN, currentN);

    // Confidence: higher when data is more consistent with power law
    const confidence = this._powerLawConfidence(logNs, logCIs, intercept, slope);

    return {
      predictedN,
      confidence,
      method: 'power_law',
      currentCI,
    };
  }

  /**
   * Compute an R²-based confidence score [0, 1] for the power-law fit.
   */
  private _powerLawConfidence(
    logNs: number[],
    logCIs: number[],
    intercept: number,
    slope: number,
  ): number {
    const m = logCIs.length;
    if (m < 2) return 0.5;

    const meanLogCI = logCIs.reduce((a, b) => a + b, 0) / m;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < m; i++) {
      const pred = intercept + slope * logNs[i];
      ssTot += (logCIs[i] - meanLogCI) ** 2;
      ssRes += (logCIs[i] - pred) ** 2;
    }
    if (ssTot < 1e-15) return 0.5;
    const r2 = 1 - ssRes / ssTot;
    return Math.max(0, Math.min(1, r2));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal: GP Prediction
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Use a Gaussian Process trained on (log(n), log(CI)) to find the log(n)
   * at which the predictive mean equals log(targetCI95).
   *
   * Strategy: train GP, then binary-search for the crossing point.
   *
   * Returns null if the GP gives nonsensical results.
   */
  private _gpPredict(
    targetCI95: number,
    currentN: number,
    currentCI: number,
    powerLawN: number,
  ): ConvergencePrediction | null {
    const xs = this._history.map(p => safeLog(p.spinCount));
    const ys = this._history.map(p => safeLog(p.ci95));

    // Normalise inputs for numerical stability
    const xMean  = xs.reduce((a, b) => a + b, 0) / xs.length;
    const xStd   = Math.max(
      Math.sqrt(xs.reduce((a, b) => a + (b - xMean) ** 2, 0) / xs.length),
      1e-6,
    );
    const xsNorm = xs.map(x => (x - xMean) / xStd);

    const yMean  = ys.reduce((a, b) => a + b, 0) / ys.length;
    const ysNorm = ys.map(y => y - yMean);

    this._gp = new GaussianProcess(this._gpCfg);
    this._gp.fit(xsNorm, ysNorm);

    const logTarget = safeLog(targetCI95) - yMean;

    // Binary search for log(n) where GP mean crosses logTarget
    // Search between current n and 100× the power-law estimate
    const logLow  = safeLog(currentN);
    const logHigh = safeLog(Math.max(powerLawN * 100, currentN * 1000));

    const xLowNorm  = (logLow  - xMean) / xStd;
    const xHighNorm = (logHigh - xMean) / xStd;

    const predLow  = this._gp.predict(xLowNorm).mean;
    const predHigh = this._gp.predict(xHighNorm).mean;

    // If both ends are on same side of target, GP can't find a crossing
    // in the search range — fall back to power_law
    if ((predLow - logTarget) * (predHigh - logTarget) > 0) {
      return null;
    }

    // Bisect
    let lo = xLowNorm, hi = xHighNorm;
    for (let iter = 0; iter < 50; iter++) {
      const mid  = (lo + hi) / 2;
      const fMid = this._gp.predict(mid).mean - logTarget;
      if (Math.abs(fMid) < 1e-8) { hi = mid; break; }
      const fLo  = this._gp.predict(lo).mean - logTarget;
      if (fLo * fMid < 0) hi = mid; else lo = mid;
    }

    const xStarNorm  = (lo + hi) / 2;
    const xStar      = xStarNorm * xStd + xMean;
    const predictedN = Math.max(Math.ceil(Math.exp(xStar)), currentN);

    // Confidence: based on posterior variance at the crossing point
    const { variance } = this._gp.predict(xStarNorm);
    // Low variance → high confidence; map variance through exp(-var)
    const confidence   = Math.exp(-variance);

    return {
      predictedN,
      confidence: Math.max(0, Math.min(1, confidence)),
      method:     'gp',
      currentCI,
    };
  }
}
