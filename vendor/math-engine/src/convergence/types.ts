/**
 * Faza 13.10 — Predictive Convergence ML
 *
 * Types for Gaussian Process surrogate model that predicts
 * how many more spins are needed until the MC RTP estimate
 * converges to within ε confidence interval.
 */

// ============================================================================
// DATA TYPES
// ============================================================================

/**
 * A single observed data point in the convergence trace.
 * Records the spin count, estimated RTP, and current CI95 half-width
 * at a particular point in time during a Monte Carlo run.
 */
export interface ConvergencePoint {
  /** Number of spins simulated so far */
  spinCount: number;
  /** Current RTP estimate (e.g. 0.96) */
  rtpEstimate: number;
  /** Current 95% CI half-width (e.g. 0.013 means ±1.3%) */
  ci95: number;
}

/**
 * A prediction of how many additional spins are required
 * to reach a target CI95 half-width.
 */
export interface ConvergencePrediction {
  /** Predicted total spin count at convergence */
  predictedN: number;
  /** Confidence in the prediction [0, 1] */
  confidence: number;
  /** Model used to produce this prediction */
  method: 'gp' | 'power_law';
  /** Current CI95 half-width at time of prediction */
  currentCI: number;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Configuration for the Gaussian Process kernel and inference.
 */
export interface GPConfig {
  /**
   * Signal variance (amplitude squared) for the RBF kernel.
   * k(x,y) = sigma2 * exp(-||x-y||^2 / (2 * lengthScale^2))
   * @default 1.0
   */
  sigma2: number;
  /**
   * Length scale for the RBF kernel.
   * Controls how quickly correlations decay with distance.
   * @default 1.0
   */
  lengthScale: number;
  /**
   * Observation noise variance added to the diagonal of the kernel matrix
   * for numerical stability and to model noisy observations.
   * @default 1e-4
   */
  noiseVariance: number;
}

/**
 * Configuration for the ConvergencePredictor.
 */
export interface ConvergencePredictorConfig {
  /**
   * Target RTP for the game (optional).
   * If provided it is used as a prior anchor for predictions.
   */
  targetRtp?: number;
  /**
   * Minimum number of observations required before switching to
   * GP-based predictions (otherwise uses power_law).
   * @default 3
   */
  minObservationsForGP?: number;
  /**
   * GP kernel/noise configuration.
   */
  gpConfig?: Partial<GPConfig>;
}
