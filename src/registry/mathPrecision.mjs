/**
 * src/registry/mathPrecision.mjs
 *
 * Globalna precision band konstanta.
 *
 * Boki direktiva (2026-06-22): "mora da radi seto postgo na +- 0.05%".
 *
 * Sve math compliance gates, PAR audit bands, UKGC/MGA tolerance default-i,
 * RTP/HF/vol acceptance bands MORAJU import-ovati odavde umesto hard-code-a.
 * Bilo koja labavija tolerancija je regression vector.
 *
 * Konstante:
 *   MATH_PRECISION_BAND_PCT    = 0.05  (percent — for RTP/HF acceptance)
 *   MATH_PRECISION_BAND_PP     = 0.05  (percentage points — for tolerance gates)
 *   MATH_PRECISION_BAND_FRAC   = 0.0005 (fraction — for ratio gates)
 */

export const MATH_PRECISION_BAND_PCT  = 0.05;
export const MATH_PRECISION_BAND_PP   = 0.05;
export const MATH_PRECISION_BAND_FRAC = 0.0005;

/* Convenience: format helper. */
export const MATH_PRECISION_BAND_LABEL = '±0.05%';
