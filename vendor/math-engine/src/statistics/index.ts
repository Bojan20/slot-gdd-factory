/**
 * SLOT MATH EXACT - Statistics Module
 *
 * Comprehensive statistical analysis for slot game mathematics.
 *
 * Includes:
 * - Variance & Standard Deviation
 * - Higher Moments (Skewness, Kurtosis)
 * - Volatility Index Calculation
 * - Confidence Intervals (Clopper-Pearson, Wilson)
 */

export * from './variance.js';
export * from './parSheet.js';
export * from './streaming.js';
export * from './convergence.js';
export * from './topN.js';
export * from './tailFit.js';
// `hdrQuantile.ts` re-exports its own `HDR_THRESHOLDS` that collides
// with the one in `parSheet.ts`. Keep parSheet's as the canonical export
// (it's wired into the GLI-16 PAR generator) and surface the hdrQuantile
// helpers under disambiguated names for the few callers that need them.
export {
  hdrQuantile,
  hdrCdf,
  spinsForRtpPrecision,
  spinsForHitRatePrecision,
  HDR_THRESHOLDS as HDR_QUANTILE_THRESHOLDS,
} from './hdrQuantile.js';
export type { CdfEntry } from './hdrQuantile.js';
