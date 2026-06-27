/**
 * SLOT MATH EXACT - Streaming Statistics (Welford / Terriberry online 4-moment)
 *
 * Computes mean, variance, skewness and excess kurtosis in a single online pass
 * using Terriberry's extension of Welford's algorithm.
 *
 * NOT thread-safe — use one instance per thread, then merge with Chan's
 * parallel combination formula.
 */

// ============================================================================
// TYPES
// ============================================================================

export type StreamingVolatilityCategory =
  | 'VERY_LOW'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'VERY_HIGH'
  | 'EXTREME';

// ============================================================================
// STREAMING STATS CLASS
// ============================================================================

export class StreamingStats {
  private _n = 0;
  private _mean = 0;
  private _M2 = 0;   // sum of squared deviations
  private _M3 = 0;   // for skewness
  private _M4 = 0;   // for kurtosis

  /**
   * Add a single value using Terriberry's 4-moment online update.
   */
  push(x: number): void {
    const n1 = this._n;
    this._n++;
    const n = this._n;

    const delta = x - this._mean;
    const delta_n = delta / n;
    const delta_n2 = delta_n * delta_n;
    const term1 = delta * delta_n * n1;

    this._M4 += term1 * delta_n2 * (n * n - 3 * n + 3)
              + 6 * delta_n2 * this._M2
              - 4 * delta_n * this._M3;

    this._M3 += term1 * delta_n * (n - 2)
              - 3 * delta_n * this._M2;

    this._M2 += term1;
    this._mean += delta_n;
  }

  /**
   * Merge another StreamingStats into this one using Chan's parallel
   * combination formula. Modifies this instance in-place.
   */
  merge(other: StreamingStats): void {
    const nA = this._n;
    const nB = other._n;

    if (nB === 0) return;
    if (nA === 0) {
      this._n    = other._n;
      this._mean = other._mean;
      this._M2   = other._M2;
      this._M3   = other._M3;
      this._M4   = other._M4;
      return;
    }

    const n = nA + nB;
    const delta  = other._mean - this._mean;
    const delta2 = delta * delta;
    const delta3 = delta2 * delta;
    const delta4 = delta3 * delta;

    const combined_mean = (nA * this._mean + nB * other._mean) / n;

    const combined_M2 =
      this._M2 + other._M2 +
      delta2 * nA * nB / n;

    const combined_M3 =
      this._M3 + other._M3 +
      delta3 * nA * nB * (nA - nB) / (n * n) +
      3 * delta * (nA * other._M2 - nB * this._M2) / n;

    const combined_M4 =
      this._M4 + other._M4 +
      delta4 * nA * nB * (nA * nA - nA * nB + nB * nB) / (n * n * n) +
      6 * delta2 * (nA * nA * other._M2 + nB * nB * this._M2) / (n * n) +
      4 * delta * (nA * other._M3 - nB * this._M3) / n;

    this._n    = n;
    this._mean = combined_mean;
    this._M2   = combined_M2;
    this._M3   = combined_M3;
    this._M4   = combined_M4;
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  get count(): number {
    return this._n;
  }

  get mean(): number {
    return this._n === 0 ? 0 : this._mean;
  }

  get populationVariance(): number {
    return this._n < 1 ? 0 : this._M2 / this._n;
  }

  get sampleVariance(): number {
    return this._n < 2 ? 0 : this._M2 / (this._n - 1);
  }

  get stdDev(): number {
    return Math.sqrt(this.sampleVariance);
  }

  get cv(): number {
    const m = this.mean;
    return m === 0 ? 0 : this.stdDev / m;
  }

  get skewness(): number {
    if (this._n < 1 || this._M2 < 1e-30) return 0;
    return Math.sqrt(this._n) * this._M3 / Math.pow(this._M2, 1.5);
  }

  get excessKurtosis(): number {
    if (this._n < 1 || this._M2 < 1e-30) return 0;
    return this._n * this._M4 / (this._M2 * this._M2) - 3;
  }

  /** Alias for cv — coefficient of variation as a volatility proxy. */
  get volatilityIndex(): number {
    return this.cv;
  }

  get volatilityCategory(): StreamingVolatilityCategory {
    const c = this.cv;
    if (c < 0.5)  return 'VERY_LOW';
    if (c < 2.0)  return 'LOW';
    if (c < 5.0)  return 'MEDIUM';
    if (c < 10.0) return 'HIGH';
    if (c < 20.0) return 'VERY_HIGH';
    return 'EXTREME';
  }

  toJSON(): object {
    return {
      count:           this.count,
      mean:            this.mean,
      populationVariance: this.populationVariance,
      sampleVariance:  this.sampleVariance,
      stdDev:          this.stdDev,
      cv:              this.cv,
      skewness:        this.skewness,
      excessKurtosis:  this.excessKurtosis,
      volatilityIndex: this.volatilityIndex,
      volatilityCategory: this.volatilityCategory,
    };
  }
}
