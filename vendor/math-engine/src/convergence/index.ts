/**
 * Faza 13.10 — Predictive Convergence ML
 *
 * Public API for the convergence prediction module.
 */

export type {
  ConvergencePoint,
  ConvergencePrediction,
  GPConfig,
  ConvergencePredictorConfig,
} from './types.js';

export type { GPPrediction } from './gp.js';
export { GaussianProcess } from './gp.js';
export { ConvergencePredictor } from './predictor.js';
