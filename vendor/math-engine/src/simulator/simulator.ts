/**
 * SLOT MATH EXACT - Monte Carlo Simulator
 *
 * Fallback simulation mode for games with cycle spaces too large
 * for exhaustive enumeration.
 *
 * Features:
 * - Seedable XorShift128+ RNG for reproducibility
 * - Streaming statistics (Welford's algorithm)
 * - Configurable confidence intervals
 * - Support for all game types
 */

import { Decimal, dec, ZERO, ONE, sum, safeDivide, formatPercent } from '../core/decimal.js';
import type { GameConfig, RTPResult, ReelSet, WinResult } from '../types/config.js';
import { LineEvaluator } from '../evaluators/lineEvaluator.js';
import { WaysEvaluator } from '../evaluators/waysEvaluator.js';
import { ClusterEvaluator } from '../evaluators/clusterEvaluator.js';
import { ScatterEvaluator } from '../evaluators/scatterEvaluator.js';
import { VariableWaysEvaluator } from '../evaluators/variableWaysEvaluator.js';

/**
 * XorShift128+ PRNG - fast, high-quality, seedable
 */
export class XorShift128Plus {
  private s0: bigint;
  private s1: bigint;

  constructor(seed: bigint = BigInt(Date.now())) {
    // Initialize with seed using splitmix64
    this.s0 = this.splitmix64(seed);
    this.s1 = this.splitmix64(this.s0);
  }

  private splitmix64(x: bigint): bigint {
    x = (x + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
    x = ((x ^ (x >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
    x = ((x ^ (x >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
    return (x ^ (x >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
  }

  /**
   * Generate next random 64-bit value
   */
  next(): bigint {
    let s1 = this.s0;
    const s0 = this.s1;
    const result = (s0 + s1) & 0xFFFFFFFFFFFFFFFFn;

    this.s0 = s0;
    s1 ^= s1 << 23n;
    this.s1 = (s1 ^ s0 ^ (s1 >> 17n) ^ (s0 >> 26n)) & 0xFFFFFFFFFFFFFFFFn;

    return result;
  }

  /**
   * Random float in [0, 1)
   */
  random(): number {
    return Number(this.next() >> 11n) / 9007199254740992;
  }

  /**
   * Random integer in [0, max)
   */
  nextInt(max: number): number {
    return Math.floor(this.random() * max);
  }
}

/**
 * Streaming statistics accumulator
 * Uses Welford's algorithm for stable variance calculation
 */
export class StreamingStats {
  private n: number = 0;
  private mean: number = 0;
  private m2: number = 0;
  private min: number = Infinity;
  private max: number = 0;
  private sum: number = 0;
  private hitCount: number = 0;

  add(value: number): void {
    this.n++;
    this.sum += value;

    if (value > 0) {
      this.hitCount++;
    }

    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;

    // Welford's algorithm
    const delta = value - this.mean;
    this.mean += delta / this.n;
    const delta2 = value - this.mean;
    this.m2 += delta * delta2;
  }

  getCount(): number {
    return this.n;
  }

  getMean(): number {
    return this.mean;
  }

  getVariance(): number {
    return this.n > 1 ? this.m2 / (this.n - 1) : 0;
  }

  getStdDev(): number {
    return Math.sqrt(this.getVariance());
  }

  getMin(): number {
    return this.min === Infinity ? 0 : this.min;
  }

  getMax(): number {
    return this.max;
  }

  getSum(): number {
    return this.sum;
  }

  getHitRate(): number {
    return this.n > 0 ? this.hitCount / this.n : 0;
  }

  /**
   * 95% confidence interval for the mean
   */
  getConfidenceInterval95(): { lower: number; upper: number } {
    if (this.n < 2) return { lower: this.mean, upper: this.mean };

    const se = this.getStdDev() / Math.sqrt(this.n);
    const z = 1.96; // 95% CI

    return {
      lower: this.mean - z * se,
      upper: this.mean + z * se
    };
  }
}

/**
 * Decimal precision streaming statistics accumulator
 * Uses Welford's algorithm with Decimal.js for exact precision
 *
 * Use this for:
 * - Very long simulations (>100M spins)
 * - Games with extreme volatility
 * - Certification-level accuracy requirements
 */
export class DecimalStreamingStats {
  private n: Decimal = ZERO;
  private mean: Decimal = ZERO;
  private m2: Decimal = ZERO;
  private min: Decimal = dec(Infinity);
  private max: Decimal = ZERO;
  private sum: Decimal = ZERO;
  private hitCount: Decimal = ZERO;

  add(value: Decimal | number): void {
    const val = typeof value === 'number' ? dec(value) : value;

    this.n = this.n.plus(ONE);
    this.sum = this.sum.plus(val);

    if (val.greaterThan(ZERO)) {
      this.hitCount = this.hitCount.plus(ONE);
    }

    if (val.lessThan(this.min)) this.min = val;
    if (val.greaterThan(this.max)) this.max = val;

    // Welford's algorithm with Decimal precision
    const delta = val.minus(this.mean);
    this.mean = this.mean.plus(safeDivide(delta, this.n));
    const delta2 = val.minus(this.mean);
    this.m2 = this.m2.plus(delta.times(delta2));
  }

  getCount(): Decimal {
    return this.n;
  }

  getMean(): Decimal {
    return this.mean;
  }

  getVariance(): Decimal {
    if (this.n.greaterThan(ONE)) {
      return safeDivide(this.m2, this.n.minus(ONE));
    }
    return ZERO;
  }

  getStdDev(): Decimal {
    return this.getVariance().sqrt();
  }

  getMin(): Decimal {
    return this.min.equals(dec(Infinity)) ? ZERO : this.min;
  }

  getMax(): Decimal {
    return this.max;
  }

  getSum(): Decimal {
    return this.sum;
  }

  getHitRate(): Decimal {
    return this.n.greaterThan(ZERO) ? safeDivide(this.hitCount, this.n) : ZERO;
  }

  /**
   * 95% confidence interval for the mean
   */
  getConfidenceInterval95(): { lower: Decimal; upper: Decimal } {
    if (this.n.lessThan(dec(2))) {
      return { lower: this.mean, upper: this.mean };
    }

    const se = safeDivide(this.getStdDev(), this.n.sqrt());
    const z = dec('1.96'); // 95% CI

    return {
      lower: this.mean.minus(z.times(se)),
      upper: this.mean.plus(z.times(se))
    };
  }

  /**
   * Merge two DecimalStreamingStats (for parallel simulation)
   */
  merge(other: DecimalStreamingStats): void {
    if (other.n.equals(ZERO)) return;
    if (this.n.equals(ZERO)) {
      this.n = other.n;
      this.mean = other.mean;
      this.m2 = other.m2;
      this.min = other.min;
      this.max = other.max;
      this.sum = other.sum;
      this.hitCount = other.hitCount;
      return;
    }

    // Parallel Welford merge algorithm
    const nTotal = this.n.plus(other.n);
    const delta = other.mean.minus(this.mean);

    // Combined mean
    const newMean = this.mean.plus(safeDivide(delta.times(other.n), nTotal));

    // Combined M2 (for variance)
    const newM2 = this.m2.plus(other.m2).plus(
      delta.times(delta).times(safeDivide(this.n.times(other.n), nTotal))
    );

    this.n = nTotal;
    this.mean = newMean;
    this.m2 = newM2;
    this.min = Decimal.min(this.min, other.min);
    this.max = Decimal.max(this.max, other.max);
    this.sum = this.sum.plus(other.sum);
    this.hitCount = this.hitCount.plus(other.hitCount);
  }

  /**
   * Convert to number-based stats for compatibility
   */
  toStreamingStats(): {
    n: number;
    mean: number;
    variance: number;
    stdDev: number;
    min: number;
    max: number;
    sum: number;
    hitRate: number;
  } {
    return {
      n: this.n.toNumber(),
      mean: this.mean.toNumber(),
      variance: this.getVariance().toNumber(),
      stdDev: this.getStdDev().toNumber(),
      min: this.getMin().toNumber(),
      max: this.max.toNumber(),
      sum: this.sum.toNumber(),
      hitRate: this.getHitRate().toNumber()
    };
  }
}

/**
 * Simulation options
 */
export interface SimulatorOptions {
  /** Number of spins to simulate */
  spins: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Progress callback */
  onProgress?: (current: number, total: number, currentRTP: number) => void;
  /** Progress interval (spins between callbacks) */
  progressInterval?: number;
  /** Include feature calculations */
  includeFeatures?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Memory protection: max histogram entries before pruning (default: 100000) */
  maxHistogramEntries?: number;
  /** Memory protection: estimated memory limit in MB (default: 512) */
  memoryLimitMB?: number;
  /** Memory protection callback when approaching limit */
  onMemoryWarning?: (usedMB: number, limitMB: number) => void;
}

/**
 * Memory-safe win distribution tracker
 * Uses bucketing to prevent unbounded memory growth
 */
export class WinDistributionTracker {
  private buckets: Map<string, { count: number; winSum: number }> = new Map();
  private maxEntries: number;
  private totalEntries: number = 0;

  constructor(maxEntries: number = 100000) {
    this.maxEntries = maxEntries;
    this.initializeBuckets();
  }

  private initializeBuckets(): void {
    const ranges = [
      '0x',
      '0.01-0.5x',
      '0.5-1x',
      '1-2x',
      '2-5x',
      '5-10x',
      '10-20x',
      '20-50x',
      '50-100x',
      '100-500x',
      '500-1000x',
      '1000x+'
    ];

    for (const range of ranges) {
      this.buckets.set(range, { count: 0, winSum: 0 });
    }
  }

  add(win: number): void {
    let range: string;

    if (win === 0) {
      range = '0x';
    } else if (win < 0.5) {
      range = '0.01-0.5x';
    } else if (win < 1) {
      range = '0.5-1x';
    } else if (win < 2) {
      range = '1-2x';
    } else if (win < 5) {
      range = '2-5x';
    } else if (win < 10) {
      range = '5-10x';
    } else if (win < 20) {
      range = '10-20x';
    } else if (win < 50) {
      range = '20-50x';
    } else if (win < 100) {
      range = '50-100x';
    } else if (win < 500) {
      range = '100-500x';
    } else if (win < 1000) {
      range = '500-1000x';
    } else {
      range = '1000x+';
    }

    const bucket = this.buckets.get(range);
    if (bucket) {
      bucket.count++;
      bucket.winSum += win;
    }

    this.totalEntries++;
  }

  getDistribution(totalSpins: number): Array<{ range: string; probability: number; rtpContribution: number }> {
    return Array.from(this.buckets.entries()).map(([range, data]) => ({
      range,
      probability: totalSpins > 0 ? data.count / totalSpins : 0,
      rtpContribution: totalSpins > 0 ? data.winSum / totalSpins : 0
    }));
  }

  getEntryCount(): number {
    return this.totalEntries;
  }

  /**
   * Prune old entries if memory limit approached (no-op for bucket-based implementation)
   */
  prune(): void {
    // Bucket-based implementation doesn't need pruning
    // This method exists for compatibility with other implementations
  }
}

/**
 * Simulation result
 */
export interface SimulationResult extends RTPResult {
  /** Calculation type identifier */
  calculationType: 'SIMULATION';
  /** Number of spins simulated */
  spinsSimulated: number;
  /** Seed used */
  seed: number;
  /** Standard deviation of RTP */
  rtpStdDev: number;
  /** 95% confidence interval */
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  /** Elapsed time in ms */
  elapsedMs: number;
}

/**
 * Monte Carlo Simulator
 */
export class Simulator {
  private config: GameConfig;
  private rng: XorShift128Plus;
  private baseReelSet: ReelSet;

  private lineEvaluator: LineEvaluator | null = null;
  private waysEvaluator: WaysEvaluator | null = null;
  private clusterEvaluator: ClusterEvaluator | null = null;
  private variableWaysEvaluator: VariableWaysEvaluator | null = null;
  private scatterEvaluator: ScatterEvaluator;

  constructor(config: GameConfig, seed?: number) {
    this.config = config;
    this.rng = new XorShift128Plus(BigInt(seed ?? Date.now()));

    // Get base reel set
    const baseReelSet = config.reelSets.find(rs => rs.id === config.baseGameReelSetId);
    if (!baseReelSet) {
      throw new Error(`Base reel set not found: ${config.baseGameReelSetId}`);
    }
    this.baseReelSet = baseReelSet;

    // Create evaluators
    switch (config.evalType) {
      case 'LINES_LTR':
      case 'LINES_RTL':
      case 'LINES_BOTH':
        this.lineEvaluator = new LineEvaluator(config);
        break;
      case 'WAYS':
        this.waysEvaluator = new WaysEvaluator(config);
        break;
      case 'VARIABLE_WAYS':
        this.variableWaysEvaluator = new VariableWaysEvaluator(config);
        break;
      case 'CLUSTER':
        this.clusterEvaluator = new ClusterEvaluator(config);
        break;
    }

    this.scatterEvaluator = new ScatterEvaluator(config);
  }

  /**
   * Run simulation
   */
  simulate(options: SimulatorOptions): SimulationResult {
    const startTime = Date.now();
    const { spins, progressInterval = 100000 } = options;
    const memoryLimitMB = options.memoryLimitMB ?? 512;
    const memoryCheckInterval = 1000000;  // Check every 1M spins

    // Re-seed if provided
    if (options.seed !== undefined) {
      this.rng = new XorShift128Plus(BigInt(options.seed));
    }

    const stats = new StreamingStats();
    const symbolStats = new Map<string, StreamingStats>();
    const winDistribution = new WinDistributionTracker(options.maxHistogramEntries);
    let featureTriggers = 0;

    // Initialize symbol stats
    for (const entry of this.config.paytable) {
      symbolStats.set(entry.symbolId, new StreamingStats());
    }

    // Main simulation loop
    for (let spin = 0; spin < spins; spin++) {
      // Generate random grid
      const { grid, stopPositions } = this.generateRandomGrid();

      // Evaluate
      const { totalWin, wins, triggeredFS } = this.evaluateGrid(grid);

      // Accumulate
      stats.add(totalWin);
      winDistribution.add(totalWin);

      if (triggeredFS) {
        featureTriggers++;
      }

      // Per-symbol stats
      for (const win of wins) {
        const symStats = symbolStats.get(win.symbolId);
        if (symStats) {
          symStats.add(win.totalWin);
        }
      }

      // Memory check (only in Node.js environment)
      if ((spin + 1) % memoryCheckInterval === 0) {
        const memUsed = this.getMemoryUsageMB();
        if (memUsed > memoryLimitMB * 0.9) {
          if (options.onMemoryWarning) {
            options.onMemoryWarning(memUsed, memoryLimitMB);
          }
          // Force garbage collection hint
          winDistribution.prune();
          if (options.verbose) {
            console.warn(`Memory warning: ${memUsed.toFixed(1)}MB / ${memoryLimitMB}MB`);
          }
        }
      }

      // Progress
      if (options.onProgress && (spin + 1) % progressInterval === 0) {
        options.onProgress(spin + 1, spins, stats.getMean());
      }
    }

    const elapsed = Date.now() - startTime;
    const ci = stats.getConfidenceInterval95();

    // Build symbol contributions
    const symbolContributions = Array.from(symbolStats.entries()).map(([symbolId, symStats]) => ({
      symbolId,
      contribution: symStats.getMean(),
      hitRate: symStats.getHitRate()
    }));

    // Determine volatility
    const volatility = this.determineVolatility(stats);

    if (options.verbose) {
      console.log(`\nSimulation complete in ${elapsed}ms`);
      console.log(`Spins: ${spins.toLocaleString()}`);
      console.log(`RTP: ${(stats.getMean() * 100).toFixed(4)}%`);
      console.log(`95% CI: [${(ci.lower * 100).toFixed(4)}%, ${(ci.upper * 100).toFixed(4)}%]`);
      console.log(`Hit Rate: ${(stats.getHitRate() * 100).toFixed(2)}%`);
      console.log(`Max Win: ${stats.getMax().toFixed(2)}x`);
    }

    return {
      calculationType: 'SIMULATION',
      spinsSimulated: spins,
      seed: options.seed ?? 0,
      totalRTP: stats.getMean(),
      baseGameRTP: stats.getMean(),
      freeSpinsRTP: 0,
      holdAndWinRTP: 0,
      bonusRTP: 0,
      hitRate: stats.getHitRate(),
      volatility,
      featureFrequencies: {
        freeSpins: featureTriggers > 0 ? spins / featureTriggers : Infinity
      },
      maxWin: stats.getMax(),
      symbolContributions,
      winDistribution: winDistribution.getDistribution(spins),
      totalCycles: BigInt(spins),
      cyclesCalculated: BigInt(spins),
      confidenceInterval: ci,
      rtpStdDev: stats.getStdDev(),
      elapsedMs: elapsed
    };
  }

  /**
   * Get current memory usage in MB
   * Works in Node.js environment
   */
  private getMemoryUsageMB(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed / (1024 * 1024);
    }
    // Browser environment - return 0 to skip memory checks
    return 0;
  }

  /**
   * Generate random grid from reel strips
   */
  private generateRandomGrid(): { grid: string[][]; stopPositions: number[] } {
    const rows = this.config.grid.rows;
    const cols = this.baseReelSet.reels.length;
    const grid: string[][] = [];
    const stopPositions: number[] = [];

    // Initialize grid
    for (let r = 0; r < rows; r++) {
      grid.push(new Array(cols).fill(''));
    }

    // Random stop position for each reel
    for (let col = 0; col < cols; col++) {
      const reel = this.baseReelSet.reels[col];
      if (!reel) continue;

      const stripLength = reel.symbols.length;
      let stopPos: number;

      // Handle weighted reels
      if (reel.weights) {
        stopPos = this.weightedRandomStop(reel.weights);
      } else {
        stopPos = this.rng.nextInt(stripLength);
      }

      stopPositions.push(stopPos);

      // Fill visible rows
      for (let row = 0; row < rows; row++) {
        const symbolIdx = (stopPos + row) % stripLength;
        const gridRow = grid[row];
        if (gridRow) {
          gridRow[col] = reel.symbols[symbolIdx] ?? '';
        }
      }
    }

    return { grid, stopPositions };
  }

  /**
   * Weighted random stop position
   */
  private weightedRandomStop(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let random = this.rng.random() * total;

    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] ?? 0;
      random -= w;
      if (random <= 0) {
        return i;
      }
    }

    return weights.length - 1;
  }

  /**
   * Evaluate a grid
   */
  private evaluateGrid(grid: string[][]): {
    totalWin: number;
    wins: WinResult[];
    triggeredFS: boolean;
  } {
    let lineWin = 0;
    const wins: WinResult[] = [];

    if (this.lineEvaluator) {
      const lineWins = this.lineEvaluator.evaluate(grid);
      wins.push(...lineWins);
      lineWin = lineWins.reduce((sum, w) => sum + w.totalWin, 0);

    } else if (this.variableWaysEvaluator) {
      const symbolsPerReel = grid[0]?.map(() => grid.length) ?? [];
      const varWins = this.variableWaysEvaluator.evaluate(grid, symbolsPerReel);
      wins.push(...varWins);
      lineWin = varWins.reduce((sum, w) => sum + w.totalWin, 0);

    } else if (this.waysEvaluator) {
      const waysWins = this.waysEvaluator.evaluate(grid);
      wins.push(...waysWins);
      lineWin = waysWins.reduce((sum, w) => sum + w.totalWin, 0);

    } else if (this.clusterEvaluator) {
      const clusterWins = this.clusterEvaluator.evaluate(grid);
      wins.push(...clusterWins);
      lineWin = clusterWins.reduce((sum, w) => sum + w.totalWin, 0);
    }

    // Scatters
    const scatterResult = this.scatterEvaluator.evaluate(grid);
    wins.push(...scatterResult.wins);
    const scatterWin = scatterResult.wins.reduce((sum, w) => sum + w.totalWin, 0);

    return {
      totalWin: lineWin + scatterWin,
      wins,
      triggeredFS: scatterResult.triggeredFeature === 'FREE_SPINS'
    };
  }

  /**
   * Determine volatility from stats
   */
  private determineVolatility(stats: StreamingStats): 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
    const hitRate = stats.getHitRate();
    const maxWin = stats.getMax();
    const cv = stats.getStdDev() / (stats.getMean() || 1);

    if (maxWin > 5000 || hitRate < 0.2 || cv > 10) {
      return 'VERY_HIGH';
    } else if (maxWin > 1000 || hitRate < 0.3 || cv > 5) {
      return 'HIGH';
    } else if (maxWin > 200 || hitRate < 0.4 || cv > 2) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }
}

/**
 * Quick simulation function
 */
export function simulateRTP(config: GameConfig, options: SimulatorOptions): SimulationResult {
  const simulator = new Simulator(config, options.seed);
  return simulator.simulate(options);
}
