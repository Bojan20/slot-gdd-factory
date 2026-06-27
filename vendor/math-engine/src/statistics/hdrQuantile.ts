/**
 * SLOT MATH EXACT - HDR Quantile & CDF Utilities
 *
 * Provides quantile extraction and CDF table construction from an HDR
 * histogram snapshot (32 buckets), plus sample-size estimation helpers.
 */

// ============================================================================
// HDR THRESHOLD BOUNDARIES
// ============================================================================

/**
 * 30 upper-boundary values for HDR histogram buckets 1..30.
 * Bucket 31 is open-ended (win ≥ 50 000×).
 */
export const HDR_THRESHOLDS = [
  0.1, 0.2, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 10.0, 15.0, 20.0, 30.0, 50.0, 75.0,
  100.0, 150.0, 200.0, 300.0, 500.0, 750.0, 1000.0, 1500.0, 2000.0, 3000.0,
  5000.0, 7500.0, 10000.0, 15000.0, 20000.0, 50000.0,
] as const;

// ============================================================================
// QUANTILE EXTRACTION
// ============================================================================

/**
 * Extract a quantile from an HDR histogram snapshot.
 *
 * snapshot: 32-element array of counts
 *   [0]    → win == 0  (no-win spins)
 *   [1]    → 0 < win < 0.1
 *   [2]    → 0.1 ≤ win < 0.2
 *   ...
 *   [30]   → 20 000 ≤ win < 50 000
 *   [31]   → win ≥ 50 000
 *
 * p: quantile in [0, 1]
 * Returns estimated win value in bet multiples.
 */
export function hdrQuantile(snapshot: readonly number[], p: number): number {
  if (!snapshot || snapshot.length === 0) return 0;

  const total = snapshot.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;

  const target = Math.floor(p * total);
  let cumulative = 0;

  for (let i = 0; i < snapshot.length; i++) {
    cumulative += snapshot[i];

    if (cumulative > target) {
      // Bucket 0 is a point mass at 0.0
      if (i === 0) return 0;

      // Bucket 31 is unbounded; return lower bound
      if (i === 31) return HDR_THRESHOLDS[29]; // 50 000

      // Bucket i (1..30) covers [lo, hi)
      const lo = i === 1 ? 0 : HDR_THRESHOLDS[i - 2];
      const hi = HDR_THRESHOLDS[i - 1];

      // Linear interpolation within the bucket
      const prevCumulative = cumulative - snapshot[i];
      const fraction = snapshot[i] === 0
        ? 0
        : (target - prevCumulative) / snapshot[i];

      return lo + fraction * (hi - lo);
    }
  }

  // p == 1.0 edge case: return top of last bucket
  return HDR_THRESHOLDS[29]; // 50 000
}

// ============================================================================
// CDF TABLE
// ============================================================================

export interface CdfEntry {
  fromX:       number;
  toX:         number | null;  // null = unbounded top
  probability: number;         // P(win in this bucket)
  cumulative:  number;         // P(win ≤ toX)
}

/**
 * Build a CDF table (32 entries) from an HDR histogram snapshot.
 */
export function hdrCdf(snapshot: readonly number[]): CdfEntry[] {
  const total = snapshot.reduce((s, c) => s + c, 0);
  const entries: CdfEntry[] = [];

  let runningCumulative = 0;

  for (let i = 0; i < snapshot.length; i++) {
    const probability = total === 0 ? 0 : snapshot[i] / total;
    runningCumulative += probability;

    let fromX: number;
    let toX: number | null;

    if (i === 0) {
      // Point mass at 0
      fromX = 0;
      toX   = 0;
    } else if (i === 1) {
      fromX = 0;
      toX   = HDR_THRESHOLDS[0]; // 0.1
    } else if (i <= 30) {
      fromX = HDR_THRESHOLDS[i - 2];
      toX   = HDR_THRESHOLDS[i - 1];
    } else {
      // Bucket 31: unbounded
      fromX = HDR_THRESHOLDS[29]; // 50 000
      toX   = null;
    }

    entries.push({
      fromX,
      toX,
      probability,
      cumulative: runningCumulative,
    });
  }

  return entries;
}

// ============================================================================
// SAMPLE-SIZE ESTIMATION
// ============================================================================

function zForConfidence(confidence: number): number {
  if (confidence >= 0.999) return 3.291;
  if (confidence >= 0.99)  return 2.576;
  if (confidence >= 0.95)  return 1.96;
  return 1.96;
}

/**
 * Minimum spins required so that the RTP confidence interval half-width
 * does not exceed `targetHalfWidthPp` percentage points.
 *
 * Formula: n = (z * σ / ε)²
 * where ε = targetHalfWidthPp / 100 (converting pp → fraction of RTP).
 *
 * @param perSpinVariance  Variance of the per-spin win in bet-multiple² units.
 * @param targetHalfWidthPp  Desired CI half-width in percentage points (e.g. 0.01).
 * @param confidence  Confidence level (0.95, 0.99, 0.999).
 */
export function spinsForRtpPrecision(
  perSpinVariance: number,
  targetHalfWidthPp: number,
  confidence: number,
): number {
  const z       = zForConfidence(confidence);
  const epsilon = targetHalfWidthPp / 100; // pp → fraction
  return Math.ceil((z * z * perSpinVariance) / (epsilon * epsilon));
}

/**
 * Minimum spins required so that the hit-rate confidence interval half-width
 * does not exceed `targetHalfWidthFraction`.
 *
 * Formula: n = z² * p * (1-p) / ε²
 *
 * @param hitRate  Expected hit rate (fraction, e.g. 0.25).
 * @param targetHalfWidthFraction  Desired CI half-width as a fraction.
 * @param confidence  Confidence level.
 */
export function spinsForHitRatePrecision(
  hitRate: number,
  targetHalfWidthFraction: number,
  confidence: number,
): number {
  const z = zForConfidence(confidence);
  const p = Math.max(0, Math.min(1, hitRate));
  const e = targetHalfWidthFraction;
  return Math.ceil((z * z * p * (1 - p)) / (e * e));
}
