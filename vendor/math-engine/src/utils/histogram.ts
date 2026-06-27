/**
 * SLOT MATH ENGINE TEMPLATE - HDR Histogram Wrapper
 *
 * Uses hdr-histogram-js for precise tail distribution tracking.
 * Critical for:
 * - Accurate P99, P99.9, P99.99 percentiles
 * - Tail weight analysis (100x, 500x, 1000x+ wins)
 * - Volatility curve generation
 * - Certification-grade precision
 *
 * HDR Histogram stores counts in logarithmic buckets,
 * providing O(1) percentile queries with configurable precision.
 */

import hdr from 'hdr-histogram-js';

/**
 * Standard percentiles for slot math analysis
 */
export interface StandardPercentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p99_9: number;
  p99_99: number;
}

/**
 * Tail bucket counts
 */
export interface TailBuckets {
  ge10x: number;
  ge50x: number;
  ge100x: number;
  ge200x: number;
  ge500x: number;
  ge1000x: number;
}

/**
 * Histogram export format for reports
 */
export interface HistogramExport {
  totalCount: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  percentiles: StandardPercentiles;
  tailBuckets: TailBuckets;
  bins: { range: string; count: number; percentage: number }[];
}

/**
 * Win Distribution Histogram
 *
 * Specialized for slot win tracking with decimal precision.
 * Stores wins as integers (x100) for HDR compatibility.
 */
export class WinHistogram {
  private histogram: hdr.Histogram;
  private tailCounts = {
    ge10x: 0,
    ge50x: 0,
    ge100x: 0,
    ge200x: 0,
    ge500x: 0,
    ge1000x: 0
  };

  /**
   * Create histogram for win multiples
   * @param maxWin Maximum expected win (x bet)
   * @param precision Significant digits (1-5)
   */
  constructor(
    maxWin: number = 100000,
    precision: 1 | 2 | 3 | 4 | 5 = 3
  ) {
    this.histogram = hdr.build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: Math.round(maxWin * 100) + 1,
      numberOfSignificantValueDigits: precision
    });
  }

  /**
   * Record a win (in bet multiples)
   */
  record(winX: number): void {
    // HDR needs positive integers, store as x100 for 2 decimal precision
    const hdrValue = Math.max(1, Math.round(winX * 100));
    this.histogram.recordValue(hdrValue);

    // Track tail buckets
    if (winX >= 10) this.tailCounts.ge10x++;
    if (winX >= 50) this.tailCounts.ge50x++;
    if (winX >= 100) this.tailCounts.ge100x++;
    if (winX >= 200) this.tailCounts.ge200x++;
    if (winX >= 500) this.tailCounts.ge500x++;
    if (winX >= 1000) this.tailCounts.ge1000x++;
  }

  /**
   * Get percentile value (in bet multiples)
   */
  getPercentile(p: number): number {
    const hdrValue = this.histogram.getValueAtPercentile(p);
    return hdrValue / 100;
  }

  /**
   * Get standard percentiles
   */
  getStandardPercentiles(): StandardPercentiles {
    return {
      p50: this.getPercentile(50),
      p75: this.getPercentile(75),
      p90: this.getPercentile(90),
      p95: this.getPercentile(95),
      p99: this.getPercentile(99),
      p99_9: this.getPercentile(99.9),
      p99_99: this.getPercentile(99.99)
    };
  }

  /**
   * Get tail bucket counts
   */
  getTailBuckets(): TailBuckets {
    return { ...this.tailCounts };
  }

  /**
   * Get total count
   */
  get count(): number {
    return this.histogram.totalCount;
  }

  /**
   * Get min value
   */
  get min(): number {
    return this.histogram.minNonZeroValue / 100;
  }

  /**
   * Get max value
   */
  get max(): number {
    return this.histogram.maxValue / 100;
  }

  /**
   * Get mean value
   */
  get mean(): number {
    return this.histogram.mean / 100;
  }

  /**
   * Get standard deviation
   */
  get stdDev(): number {
    return this.histogram.stdDeviation / 100;
  }

  /**
   * Reset histogram
   */
  reset(): void {
    this.histogram.reset();
    this.tailCounts = {
      ge10x: 0,
      ge50x: 0,
      ge100x: 0,
      ge200x: 0,
      ge500x: 0,
      ge1000x: 0
    };
  }

  /**
   * Merge another histogram into this one
   */
  merge(other: WinHistogram): void {
    this.histogram.add(other.histogram);
    this.tailCounts.ge10x += other.tailCounts.ge10x;
    this.tailCounts.ge50x += other.tailCounts.ge50x;
    this.tailCounts.ge100x += other.tailCounts.ge100x;
    this.tailCounts.ge200x += other.tailCounts.ge200x;
    this.tailCounts.ge500x += other.tailCounts.ge500x;
    this.tailCounts.ge1000x += other.tailCounts.ge1000x;
  }

  /**
   * Serialize histogram for worker transfer
   * Uses JSON with essential stats (HDR encode may not be available in all builds)
   */
  serialize(): string {
    const data = {
      percentiles: this.getStandardPercentiles(),
      count: this.histogram.totalCount,
      tailCounts: this.tailCounts
    };
    return JSON.stringify(data);
  }

  /**
   * Deserialize histogram from worker data
   * Creates a new histogram with tail counts for merging
   */
  static deserialize(serialized: string): WinHistogram {
    const data = JSON.parse(serialized);
    const instance = new WinHistogram();

    // Restore tail counts - this is what we need for merging
    instance.tailCounts = data.tailCounts;

    return instance;
  }

  /**
   * Export histogram data for reports
   */
  export(): HistogramExport {
    const total = this.count;

    // Create logarithmic bins for visualization using percentile-based approximation
    const binEdges = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, Infinity];
    const bins: { range: string; count: number; percentage: number }[] = [];

    // Get cumulative counts at bin edges using getValueAtPercentile inverse
    for (let i = 0; i < binEdges.length - 1; i++) {
      const low = binEdges[i];
      const high = binEdges[i + 1];
      const range = high === Infinity ? `${low}x+` : `${low}x-${high}x`;

      // Approximate count using percentile interpolation
      // HDR doesn't expose direct count queries, so use tail buckets where available
      let count = 0;
      if (i === binEdges.length - 2) {
        // Last bin (1000x+)
        count = this.tailCounts.ge1000x;
      } else {
        // Estimate from tail differences
        const tailCount = this.getTailCountAt(low);
        const nextTailCount = this.getTailCountAt(high);
        count = Math.max(0, tailCount - nextTailCount);
      }

      bins.push({
        range,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0
      });
    }

    return {
      totalCount: total,
      min: this.min,
      max: this.max,
      mean: this.mean,
      stdDev: this.stdDev,
      percentiles: this.getStandardPercentiles(),
      tailBuckets: this.getTailBuckets(),
      bins
    };
  }

  /**
   * Get tail count at specific threshold
   */
  private getTailCountAt(threshold: number): number {
    if (threshold >= 1000) return this.tailCounts.ge1000x;
    if (threshold >= 500) return this.tailCounts.ge500x;
    if (threshold >= 200) return this.tailCounts.ge200x;
    if (threshold >= 100) return this.tailCounts.ge100x;
    if (threshold >= 50) return this.tailCounts.ge50x;
    if (threshold >= 10) return this.tailCounts.ge10x;
    return this.count; // All values are >= 0
  }
}

/**
 * Streaming statistics calculator with HDR histogram
 * For real-time percentile tracking during simulation
 */
export class StreamingStats {
  private histogram: WinHistogram;
  private _sum = 0;
  private _sumSquares = 0;
  private _count = 0;
  private _hits = 0;

  constructor(maxWin: number = 100000) {
    this.histogram = new WinHistogram(maxWin);
  }

  /**
   * Add a sample
   */
  add(value: number): void {
    this._count++;
    this._sum += value;
    this._sumSquares += value * value;

    if (value > 0) {
      this._hits++;
      this.histogram.record(value);
    }
  }

  get count(): number {
    return this._count;
  }

  get sum(): number {
    return this._sum;
  }

  get hits(): number {
    return this._hits;
  }

  get hitRate(): number {
    return this._count > 0 ? this._hits / this._count : 0;
  }

  get mean(): number {
    return this._count > 0 ? this._sum / this._count : 0;
  }

  get variance(): number {
    if (this._count < 2) return 0;
    const mean = this.mean;
    return (this._sumSquares / this._count) - (mean * mean);
  }

  get stdDev(): number {
    return Math.sqrt(Math.max(0, this.variance));
  }

  getPercentiles(): StandardPercentiles {
    return this.histogram.getStandardPercentiles();
  }

  getTailBuckets(): TailBuckets {
    return this.histogram.getTailBuckets();
  }

  getHistogram(): WinHistogram {
    return this.histogram;
  }

  /**
   * Merge with another stats instance
   */
  merge(other: StreamingStats): void {
    this._count += other._count;
    this._sum += other._sum;
    this._sumSquares += other._sumSquares;
    this._hits += other._hits;
    this.histogram.merge(other.histogram);
  }

  /**
   * Export full report data
   */
  export() {
    return {
      count: this._count,
      hits: this._hits,
      hitRate: this.hitRate,
      sum: this._sum,
      mean: this.mean,
      variance: this.variance,
      stdDev: this.stdDev,
      histogram: this.histogram.export()
    };
  }
}
