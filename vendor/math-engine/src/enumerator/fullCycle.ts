/**
 * SLOT MATH EXACT - Full Cycle Enumerator
 *
 * Exhaustively iterates through ALL possible stop positions on reels.
 * This is the core of exact RTP calculation.
 *
 * For a 5-reel game with reel lengths [30, 30, 30, 30, 30]:
 * Total combinations = 30^5 = 24,300,000 states
 *
 * Key features:
 * - Generator-based for memory efficiency
 * - Weighted probability for non-uniform reels
 * - Progress tracking for long calculations
 * - Parallel-friendly chunking
 */

import { Decimal, dec, safeDivide } from '../core/decimal.js';
import { totalCycleSize, bigIntToDecimal } from '../core/index.js';

import type { ReelSet, GridConfig } from '../types/config.js';

// BigInt constants
const BIGINT_ZERO = 0n;
const BIGINT_ONE = 1n;

/**
 * Stop position state
 */
export interface StopPosition {
  /** Index position on each reel (0-indexed) */
  positions: number[];
  /** Weight/probability of this combination (1 if uniform) */
  weight: bigint;
}

/**
 * Grid state from stop positions
 */
export interface GridState {
  /** 2D grid of symbol IDs [row][col] */
  grid: string[][];
  /** Stop positions that generated this grid */
  stops: number[];
  /** Probability weight */
  weight: bigint;
  /** Cycle index (for tracking) */
  cycleIndex: bigint;
}

/**
 * Enumerator options
 */
export interface EnumeratorOptions {
  /** Report progress every N cycles */
  progressInterval?: number;
  /** Progress callback */
  onProgress?: (current: bigint, total: bigint) => void;
  /** Starting position for chunked processing */
  startIndex?: bigint;
  /** Number of cycles to process (for chunking) */
  chunkSize?: bigint;
}

/**
 * Full cycle enumerator class
 */
export class FullCycleEnumerator {
  private readonly reelLengths: number[];
  private readonly reelStrips: string[][];
  private readonly reelWeights: number[][] | null;
  private readonly totalCycles: bigint;
  private readonly rows: number;

  constructor(
    reelSet: ReelSet,
    gridConfig: GridConfig
  ) {
    this.reelStrips = reelSet.reels.map(r => r.symbols);
    this.reelLengths = this.reelStrips.map(s => s.length);
    this.reelWeights = reelSet.reels.some(r => r.weights)
      ? reelSet.reels.map(r => r.weights ?? r.symbols.map(() => 1))
      : null;
    this.totalCycles = totalCycleSize(this.reelLengths);
    this.rows = gridConfig.rows;
  }

  /**
   * Get total number of cycles
   */
  getTotalCycles(): bigint {
    return this.totalCycles;
  }

  /**
   * Get reel lengths
   */
  getReelLengths(): number[] {
    return [...this.reelLengths];
  }

  /**
   * Convert cycle index to stop positions
   * Uses mixed-radix representation
   */
  indexToPositions(index: bigint): number[] {
    const positions: number[] = new Array(this.reelLengths.length);
    let remaining = index;

    // Process from last reel to first (like mixed-radix number)
    for (let i = this.reelLengths.length - 1; i >= 0; i--) {
      const reelLength = this.reelLengths[i];
      if (reelLength === undefined) continue;

      const pos = Number(remaining % BigInt(reelLength));
      positions[i] = pos;
      remaining = remaining / BigInt(reelLength);
    }

    return positions;
  }

  /**
   * Convert stop positions to cycle index
   */
  positionsToIndex(positions: number[]): bigint {
    let index = BIGINT_ZERO;
    let multiplier = BIGINT_ONE;

    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i];
      if (pos === undefined) continue;

      index += BigInt(pos) * multiplier;

      const reelLength = this.reelLengths[i];
      if (reelLength !== undefined) {
        multiplier *= BigInt(reelLength);
      }
    }

    return index;
  }

  /**
   * Get weight for a stop position combination
   */
  getWeight(positions: number[]): bigint {
    if (!this.reelWeights) {
      return BIGINT_ONE;  // Uniform weight
    }

    let weight = BIGINT_ONE;
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const reelWeights = this.reelWeights[i];
      if (pos === undefined || reelWeights === undefined) continue;

      const w = reelWeights[pos];
      if (w === undefined) continue;

      weight *= BigInt(Math.round(w));
    }

    return weight;
  }

  /**
   * Get total weight (sum of all weights)
   * For uniform reels, this equals totalCycles
   */
  getTotalWeight(): bigint {
    if (!this.reelWeights) {
      return this.totalCycles;
    }

    let total = BIGINT_ONE;
    for (const weights of this.reelWeights) {
      const reelSum = weights.reduce((a, b) => a + b, 0);
      total *= BigInt(Math.round(reelSum));
    }

    return total;
  }

  /**
   * Get grid symbols for a stop position
   * Handles wrap-around for rows
   */
  getGrid(positions: number[]): string[][] {
    const grid: string[][] = [];

    for (let row = 0; row < this.rows; row++) {
      const rowSymbols: string[] = [];

      for (let col = 0; col < positions.length; col++) {
        const pos = positions[col];
        const reelStrip = this.reelStrips[col];

        if (pos === undefined || reelStrip === undefined) {
          rowSymbols.push('');
          continue;
        }

        // Wrap around for multi-row display
        const reelLength = reelStrip.length;
        const symbolIndex = (pos + row) % reelLength;
        const symbol = reelStrip[symbolIndex];
        rowSymbols.push(symbol ?? '');
      }

      grid.push(rowSymbols);
    }

    return grid;
  }

  /**
   * Generator that yields all grid states
   */
  *enumerate(options: EnumeratorOptions = {}): Generator<GridState> {
    const {
      progressInterval = 1000000,
      onProgress,
      startIndex = BIGINT_ZERO,
      chunkSize
    } = options;

    const endIndex = chunkSize !== undefined
      ? (startIndex + chunkSize < this.totalCycles ? startIndex + chunkSize : this.totalCycles)
      : this.totalCycles;

    let lastProgress = startIndex;

    for (let i = startIndex; i < endIndex; i++) {
      const positions = this.indexToPositions(i);
      const grid = this.getGrid(positions);
      const weight = this.getWeight(positions);

      yield {
        grid,
        stops: positions,
        weight,
        cycleIndex: i
      };

      // Progress reporting
      if (onProgress && i - lastProgress >= BigInt(progressInterval)) {
        onProgress(i, this.totalCycles);
        lastProgress = i;
      }
    }

    // Final progress report
    if (onProgress) {
      onProgress(endIndex, this.totalCycles);
    }
  }

  /**
   * Generator for just stop positions (no grid generation)
   * Faster when grid isn't needed for every cycle
   */
  *enumeratePositions(options: EnumeratorOptions = {}): Generator<StopPosition> {
    const {
      startIndex = BIGINT_ZERO,
      chunkSize
    } = options;

    const endIndex = chunkSize !== undefined
      ? (startIndex + chunkSize < this.totalCycles ? startIndex + chunkSize : this.totalCycles)
      : this.totalCycles;

    for (let i = startIndex; i < endIndex; i++) {
      const positions = this.indexToPositions(i);
      const weight = this.getWeight(positions);

      yield { positions, weight };
    }
  }

  /**
   * Create chunk specifications for parallel processing
   */
  createChunks(numChunks: number): Array<{ startIndex: bigint; chunkSize: bigint }> {
    const chunks: Array<{ startIndex: bigint; chunkSize: bigint }> = [];
    const baseChunkSize = this.totalCycles / BigInt(numChunks);
    const remainder = this.totalCycles % BigInt(numChunks);

    let currentIndex = BIGINT_ZERO;

    for (let i = 0; i < numChunks; i++) {
      // Distribute remainder across first chunks
      const extraOne = BigInt(i) < remainder ? BIGINT_ONE : BIGINT_ZERO;
      const chunkSize = baseChunkSize + extraOne;

      chunks.push({
        startIndex: currentIndex,
        chunkSize
      });

      currentIndex += chunkSize;
    }

    return chunks;
  }

  /**
   * Calculate probability of a specific outcome
   */
  calculateProbability(positions: number[]): Decimal {
    const weight = this.getWeight(positions);
    const totalWeight = this.getTotalWeight();

    return safeDivide(bigIntToDecimal(weight), bigIntToDecimal(totalWeight));
  }
}

/**
 * Create enumerator from config
 */
export function createEnumerator(
  reelSet: ReelSet,
  gridConfig: GridConfig
): FullCycleEnumerator {
  return new FullCycleEnumerator(reelSet, gridConfig);
}

/**
 * Quick estimate of calculation complexity
 */
export function estimateComplexity(reelLengths: number[]): {
  totalCycles: bigint;
  estimatedTimeMs: number;  // Very rough estimate
  feasibility: 'INSTANT' | 'FAST' | 'MEDIUM' | 'SLOW' | 'VERY_SLOW' | 'IMPRACTICAL';
} {
  const total = totalCycleSize(reelLengths);

  // Rough estimate: ~1M cycles per second on modern hardware
  const cyclesPerMs = 1000n;
  const estimatedTimeMs = Number(total / cyclesPerMs);

  let feasibility: 'INSTANT' | 'FAST' | 'MEDIUM' | 'SLOW' | 'VERY_SLOW' | 'IMPRACTICAL';

  if (total < 1_000_000n) {
    feasibility = 'INSTANT';
  } else if (total < 100_000_000n) {
    feasibility = 'FAST';
  } else if (total < 1_000_000_000n) {
    feasibility = 'MEDIUM';
  } else if (total < 10_000_000_000n) {
    feasibility = 'SLOW';
  } else if (total < 1_000_000_000_000n) {
    feasibility = 'VERY_SLOW';
  } else {
    feasibility = 'IMPRACTICAL';
  }

  return {
    totalCycles: total,
    estimatedTimeMs,
    feasibility
  };
}
