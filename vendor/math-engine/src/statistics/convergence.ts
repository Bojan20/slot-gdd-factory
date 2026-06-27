/**
 * SLOT MATH EXACT - Convergence Detector
 *
 * Sliding-window CI-width check for automatic stopping in Monte Carlo loops.
 * Uses a ring buffer of the last `windowSize` RTP readings and computes a
 * normal-approximation confidence interval half-width.
 */

// ============================================================================
// Z-SCORE TABLE
// ============================================================================

function zForConfidence(level: number): number {
  if (level >= 0.999) return 3.291;
  if (level >= 0.99)  return 2.576;
  if (level >= 0.95)  return 1.96;
  if (level >= 0.90)  return 1.645;
  return 1.96; // default to 95 %
}

// ============================================================================
// CONVERGENCE DETECTOR
// ============================================================================

export class ConvergenceDetector {
  private readonly _z: number;
  private readonly _target: number;
  private readonly _windowSize: number;

  /** Ring buffer */
  private _buf: Float64Array;
  private _pos = 0;        // next write position
  private _count = 0;      // number of valid entries (≤ windowSize)

  constructor(
    targetHalfWidthPp: number,
    confidenceLevel: number,
    windowSize: number,
  ) {
    this._target     = targetHalfWidthPp;
    this._z          = zForConfidence(confidenceLevel);
    this._windowSize = windowSize;
    this._buf        = new Float64Array(windowSize);
  }

  push(rtpPct: number): void {
    this._buf[this._pos] = rtpPct;
    this._pos = (this._pos + 1) % this._windowSize;
    if (this._count < this._windowSize) this._count++;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private _stats(): { mean: number; sampleVar: number } {
    const n = this._count;
    if (n === 0) return { mean: 0, sampleVar: 0 };

    let sum = 0;
    for (let i = 0; i < n; i++) sum += this._buf[i];
    const mean = sum / n;

    if (n < 2) return { mean, sampleVar: 0 };

    let sq = 0;
    for (let i = 0; i < n; i++) {
      const d = this._buf[i] - mean;
      sq += d * d;
    }
    return { mean, sampleVar: sq / (n - 1) };
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  get currentHalfWidthPp(): number {
    const n = this._count;
    if (n < 2) return Infinity;
    const { sampleVar } = this._stats();
    return this._z * Math.sqrt(sampleVar / n);
  }

  get hasConverged(): boolean {
    if (this._count < 2) return false;
    return this.currentHalfWidthPp <= this._target;
  }

  get readings(): number {
    return this._count;
  }

  get windowMean(): number {
    return this._stats().mean;
  }

  reset(): void {
    this._pos   = 0;
    this._count = 0;
    this._buf   = new Float64Array(this._windowSize);
  }
}
