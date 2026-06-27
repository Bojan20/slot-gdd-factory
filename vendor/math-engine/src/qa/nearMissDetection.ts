/**
 * SLOT MATH EXACT - Near-Miss Detection
 *
 * Detects and analyzes near-miss situations in slot games.
 * Near-misses are outcomes where the player "almost" wins, which can:
 * - Create psychological engagement (good when moderate)
 * - Violate regulations if artificially inflated (bad - must detect)
 *
 * GLI-11 requires that near-miss probabilities match true random distribution.
 * This module helps verify that near-misses occur at natural rates.
 *
 * Types of near-misses:
 * 1. Symbol-off: Winning symbol one position away
 * 2. Reel-short: Missing just one symbol for a win
 * 3. Feature-miss: Almost triggered a feature (e.g., 2 scatters instead of 3)
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';
import { bigIntToDecimal } from '../core/bigint.js';
import type { GameConfig, ReelSet } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Near-miss type classification
 */
export type NearMissType =
  | 'SYMBOL_OFF'      // Winning symbol one position away on reel
  | 'REEL_SHORT'      // Missing one reel for a win
  | 'FEATURE_MISS'    // Almost triggered feature
  | 'CLUSTER_MISS'    // Almost formed winning cluster
  | 'PAYLINE_MISS';   // Almost completed payline

/**
 * Individual near-miss occurrence
 */
export interface NearMissOccurrence {
  /** Type of near-miss */
  type: NearMissType;
  /** Symbol involved */
  symbolId: string;
  /** Which reel(s) caused the miss */
  reelIndices: number[];
  /** Position offset from win (e.g., 1 = one position away) */
  offset: number;
  /** What would have been won */
  potentialWin: Decimal;
  /** Actual count of this occurrence */
  count: bigint;
  /** Description for reporting */
  description: string;
}

/**
 * Near-miss analysis result
 */
export interface NearMissAnalysis {
  /** Total near-miss rate (near-misses / total spins) */
  overallRate: Decimal;
  /** Near-miss rate by type */
  rateByType: Map<NearMissType, Decimal>;
  /** Near-miss rate by symbol */
  rateBySymbol: Map<string, Decimal>;
  /** Most common near-misses */
  topOccurrences: NearMissOccurrence[];
  /** Regulatory compliance check */
  compliance: NearMissCompliance;
  /** Total near-miss count */
  totalNearMisses: bigint;
  /** Total cycles analyzed */
  totalCycles: bigint;
  /** Feature near-miss breakdown */
  featureNearMisses: FeatureNearMissStats;
}

/**
 * Feature near-miss statistics
 */
export interface FeatureNearMissStats {
  /** Scatter near-miss rate (e.g., 2 scatters when 3 needed) */
  scatterNearMissRate: Decimal;
  /** Bonus near-miss rate */
  bonusNearMissRate: Decimal;
  /** Distribution of scatter counts (0, 1, 2 scatters, etc.) */
  scatterDistribution: Map<number, Decimal>;
}

/**
 * Near-miss compliance result
 */
export interface NearMissCompliance {
  /** Overall pass/fail */
  passed: boolean;
  /** Individual checks */
  checks: Array<{
    name: string;
    passed: boolean;
    actual: number;
    threshold: number;
    severity: 'WARNING' | 'VIOLATION';
    message: string;
  }>;
  /** Regulatory standard applied */
  standard: 'GLI-11' | 'AGCO' | 'MGA' | 'UKGC' | 'CUSTOM';
}

/**
 * Near-miss detection configuration
 */
export interface NearMissConfig {
  /** Regulatory standard to apply */
  standard?: 'GLI-11' | 'AGCO' | 'MGA' | 'UKGC' | 'CUSTOM';
  /** Custom thresholds (when standard is 'CUSTOM') */
  customThresholds?: {
    maxOverallRate?: number;
    maxSymbolOffRate?: number;
    maxFeatureMissRate?: number;
  };
  /** Symbols to analyze (default: all paying symbols) */
  symbolsToAnalyze?: string[];
  /** Minimum potential win to count as near-miss */
  minPotentialWin?: number;
  /** Maximum offset to count (e.g., 1 = immediate neighbor) */
  maxOffset?: number;
}

// ============================================================================
// NEAR-MISS DETECTOR
// ============================================================================

/**
 * Near-miss detector class
 */
export class NearMissDetector {
  private config: GameConfig;
  private reelSet: ReelSet;
  private detectionConfig: Required<NearMissConfig>;
  private payingSymbols: Set<string>;
  private scatterSymbol: string | null;
  private bonusSymbol: string | null;

  constructor(config: GameConfig, reelSet: ReelSet, detectionConfig: NearMissConfig = {}) {
    this.config = config;
    this.reelSet = reelSet;

    // Merge with defaults
    this.detectionConfig = {
      standard: detectionConfig.standard ?? 'GLI-11',
      customThresholds: detectionConfig.customThresholds ?? {},
      symbolsToAnalyze: detectionConfig.symbolsToAnalyze ?? [],
      minPotentialWin: detectionConfig.minPotentialWin ?? 0,
      maxOffset: detectionConfig.maxOffset ?? 1
    };

    // Identify paying symbols
    this.payingSymbols = new Set(config.paytable.map(p => p.symbolId));

    // Identify scatter and bonus
    this.scatterSymbol = config.symbols.find(s => s.role === 'SCATTER')?.id ?? null;
    this.bonusSymbol = config.symbols.find(s => s.role === 'BONUS')?.id ?? null;
  }

  /**
   * Analyze near-misses for a single grid
   */
  analyzeGrid(grid: string[][], stopPositions: number[]): NearMissOccurrence[] {
    const occurrences: NearMissOccurrence[] = [];

    // 1. Symbol-off analysis (winning symbol one position away)
    occurrences.push(...this.detectSymbolOff(grid, stopPositions));

    // 2. Reel-short analysis (missing one reel for a win)
    occurrences.push(...this.detectReelShort(grid));

    // 3. Feature-miss analysis (almost triggered feature)
    occurrences.push(...this.detectFeatureMiss(grid));

    return occurrences;
  }

  /**
   * Detect symbol-off near-misses
   * A symbol-off occurs when a winning symbol is one position above or below
   * the visible area on a reel.
   */
  private detectSymbolOff(grid: string[][], stopPositions: number[]): NearMissOccurrence[] {
    const occurrences: NearMissOccurrence[] = [];
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;

    for (let col = 0; col < cols; col++) {
      const reel = this.reelSet.reels[col];
      if (!reel) continue;

      const reelLength = reel.symbols.length;
      const stopPos = stopPositions[col] ?? 0;

      // Check symbols above visible area
      for (let offset = 1; offset <= this.detectionConfig.maxOffset; offset++) {
        const abovePos = (stopPos - offset + reelLength) % reelLength;
        const aboveSymbol = reel.symbols[abovePos];

        if (aboveSymbol && this.isHighValueSymbol(aboveSymbol)) {
          // Check if this symbol would complete a win
          const potentialWin = this.checkPotentialWin(grid, col, 0, aboveSymbol);
          if (potentialWin.greaterThan(dec(this.detectionConfig.minPotentialWin))) {
            occurrences.push({
              type: 'SYMBOL_OFF',
              symbolId: aboveSymbol,
              reelIndices: [col],
              offset: -offset,
              potentialWin,
              count: 1n,
              description: `${aboveSymbol} is ${offset} position(s) above reel ${col + 1}`
            });
          }
        }
      }

      // Check symbols below visible area
      for (let offset = 1; offset <= this.detectionConfig.maxOffset; offset++) {
        const belowPos = (stopPos + rows + offset - 1) % reelLength;
        const belowSymbol = reel.symbols[belowPos];

        if (belowSymbol && this.isHighValueSymbol(belowSymbol)) {
          const potentialWin = this.checkPotentialWin(grid, col, rows - 1, belowSymbol);
          if (potentialWin.greaterThan(dec(this.detectionConfig.minPotentialWin))) {
            occurrences.push({
              type: 'SYMBOL_OFF',
              symbolId: belowSymbol,
              reelIndices: [col],
              offset: offset,
              potentialWin,
              count: 1n,
              description: `${belowSymbol} is ${offset} position(s) below reel ${col + 1}`
            });
          }
        }
      }
    }

    return occurrences;
  }

  /**
   * Detect reel-short near-misses
   * A reel-short occurs when you have N-1 matching symbols for an N-of-a-kind win.
   */
  private detectReelShort(grid: string[][]): NearMissOccurrence[] {
    const occurrences: NearMissOccurrence[] = [];
    const cols = grid[0]?.length ?? 0;

    // For each paying symbol, check if we're one short
    for (const symbolId of this.payingSymbols) {
      // Count consecutive symbols from left
      let consecutiveCount = 0;
      const matchingReels: number[] = [];

      for (let col = 0; col < cols; col++) {
        const hasSymbol = grid.some(row => {
          const sym = row[col];
          return sym === symbolId || this.isWildSubstitute(sym, symbolId);
        });

        if (hasSymbol) {
          consecutiveCount++;
          matchingReels.push(col);
        } else {
          break;
        }
      }

      // Check if we're one short of a pay
      if (consecutiveCount >= 2 && consecutiveCount < cols) {
        const currentPay = this.getPayForCount(symbolId, consecutiveCount);
        const nextPay = this.getPayForCount(symbolId, consecutiveCount + 1);

        if (nextPay.greaterThan(currentPay)) {
          const missedReel = matchingReels.length;
          occurrences.push({
            type: 'REEL_SHORT',
            symbolId,
            reelIndices: [missedReel],
            offset: 1,
            potentialWin: nextPay.minus(currentPay),
            count: 1n,
            description: `${symbolId} ${consecutiveCount}-of-a-kind, missing reel ${missedReel + 1} for ${consecutiveCount + 1}-of-a-kind`
          });
        }
      }
    }

    return occurrences;
  }

  /**
   * Detect feature near-misses
   * Almost triggered free spins, bonus, etc.
   */
  private detectFeatureMiss(grid: string[][]): NearMissOccurrence[] {
    const occurrences: NearMissOccurrence[] = [];

    // Scatter near-miss
    if (this.scatterSymbol && this.config.freeSpins?.enabled) {
      const scatterCount = this.countSymbol(grid, this.scatterSymbol);
      const triggerCounts = Object.keys(this.config.freeSpins.triggerCounts)
        .map(Number)
        .sort((a, b) => a - b);

      const minTrigger = triggerCounts[0] ?? 3;

      // Near-miss: one less than trigger
      if (scatterCount === minTrigger - 1) {
        const triggerConfig = this.config.freeSpins.triggerCounts[minTrigger.toString()];
        const featureValue = this.estimateFeatureValue(
          triggerConfig?.spins ?? 10,
          triggerConfig?.pay ?? 0
        );

        occurrences.push({
          type: 'FEATURE_MISS',
          symbolId: this.scatterSymbol,
          reelIndices: [],
          offset: 1,
          potentialWin: featureValue,
          count: 1n,
          description: `${scatterCount} scatters, needed ${minTrigger} for Free Spins`
        });
      }
    }

    // Bonus near-miss
    if (this.bonusSymbol && this.config.holdAndWin?.enabled) {
      const bonusCount = this.countSymbol(grid, this.bonusSymbol);
      const triggerCount = this.config.holdAndWin.triggerCount;

      if (bonusCount === triggerCount - 1) {
        occurrences.push({
          type: 'FEATURE_MISS',
          symbolId: this.bonusSymbol,
          reelIndices: [],
          offset: 1,
          potentialWin: dec(100), // Rough estimate for H&W value
          count: 1n,
          description: `${bonusCount} bonus symbols, needed ${triggerCount} for Hold & Win`
        });
      }
    }

    return occurrences;
  }

  /**
   * Aggregate analysis over multiple grids/cycles
   */
  aggregateAnalysis(
    occurrences: NearMissOccurrence[],
    totalCycles: bigint
  ): NearMissAnalysis {
    // Aggregate by type
    const byType = new Map<NearMissType, bigint>();
    const bySymbol = new Map<string, bigint>();

    // Merge identical occurrences
    const merged = new Map<string, NearMissOccurrence>();

    for (const occ of occurrences) {
      const key = `${occ.type}|${occ.symbolId}|${occ.reelIndices.join(',')}|${occ.offset}`;

      if (merged.has(key)) {
        const existing = merged.get(key)!;
        existing.count += occ.count;
      } else {
        merged.set(key, { ...occ });
      }

      // Aggregate by type
      byType.set(occ.type, (byType.get(occ.type) ?? 0n) + occ.count);

      // Aggregate by symbol
      bySymbol.set(occ.symbolId, (bySymbol.get(occ.symbolId) ?? 0n) + occ.count);
    }

    // Calculate rates
    const totalDec = bigIntToDecimal(totalCycles);
    const totalNearMisses = Array.from(merged.values()).reduce((sum, o) => sum + o.count, 0n);

    const rateByType = new Map<NearMissType, Decimal>();
    for (const [type, count] of byType) {
      rateByType.set(type, safeDivide(bigIntToDecimal(count), totalDec));
    }

    const rateBySymbol = new Map<string, Decimal>();
    for (const [symbol, count] of bySymbol) {
      rateBySymbol.set(symbol, safeDivide(bigIntToDecimal(count), totalDec));
    }

    // Sort by count for top occurrences
    const topOccurrences = Array.from(merged.values())
      .sort((a, b) => Number(b.count - a.count))
      .slice(0, 20);

    // Feature near-miss stats
    const featureNearMisses = this.calculateFeatureNearMissStats(
      Array.from(merged.values()),
      totalCycles
    );

    // Compliance check
    const compliance = this.checkCompliance(
      safeDivide(bigIntToDecimal(totalNearMisses), totalDec),
      rateByType,
      featureNearMisses
    );

    return {
      overallRate: safeDivide(bigIntToDecimal(totalNearMisses), totalDec),
      rateByType,
      rateBySymbol,
      topOccurrences,
      compliance,
      totalNearMisses,
      totalCycles,
      featureNearMisses
    };
  }

  /**
   * Calculate feature near-miss statistics
   */
  private calculateFeatureNearMissStats(
    occurrences: NearMissOccurrence[],
    totalCycles: bigint
  ): FeatureNearMissStats {
    const totalDec = bigIntToDecimal(totalCycles);

    // Filter feature misses
    const featureMisses = occurrences.filter(o => o.type === 'FEATURE_MISS');

    // Scatter near-miss rate
    const scatterMisses = featureMisses
      .filter(o => o.symbolId === this.scatterSymbol)
      .reduce((sum, o) => sum + o.count, 0n);

    // Bonus near-miss rate
    const bonusMisses = featureMisses
      .filter(o => o.symbolId === this.bonusSymbol)
      .reduce((sum, o) => sum + o.count, 0n);

    return {
      scatterNearMissRate: safeDivide(bigIntToDecimal(scatterMisses), totalDec),
      bonusNearMissRate: safeDivide(bigIntToDecimal(bonusMisses), totalDec),
      scatterDistribution: new Map() // Would need full enumeration data
    };
  }

  /**
   * Check regulatory compliance
   */
  private checkCompliance(
    overallRate: Decimal,
    rateByType: Map<NearMissType, Decimal>,
    featureStats: FeatureNearMissStats
  ): NearMissCompliance {
    const checks: NearMissCompliance['checks'] = [];
    let passed = true;

    // Get thresholds based on standard
    const thresholds = this.getThresholds();

    // Overall rate check
    if (thresholds.maxOverallRate !== undefined) {
      const actualRate = overallRate.toNumber();
      const checkPassed = actualRate <= thresholds.maxOverallRate;
      if (!checkPassed) passed = false;

      checks.push({
        name: 'Overall Near-Miss Rate',
        passed: checkPassed,
        actual: actualRate,
        threshold: thresholds.maxOverallRate,
        severity: checkPassed ? 'WARNING' : 'VIOLATION',
        message: checkPassed
          ? 'Overall near-miss rate within acceptable limits'
          : `Overall near-miss rate (${(actualRate * 100).toFixed(2)}%) exceeds threshold (${(thresholds.maxOverallRate * 100).toFixed(2)}%)`
      });
    }

    // Symbol-off rate check
    if (thresholds.maxSymbolOffRate !== undefined) {
      const symbolOffRate = rateByType.get('SYMBOL_OFF')?.toNumber() ?? 0;
      const checkPassed = symbolOffRate <= thresholds.maxSymbolOffRate;
      if (!checkPassed) passed = false;

      checks.push({
        name: 'Symbol-Off Rate',
        passed: checkPassed,
        actual: symbolOffRate,
        threshold: thresholds.maxSymbolOffRate,
        severity: checkPassed ? 'WARNING' : 'VIOLATION',
        message: checkPassed
          ? 'Symbol-off near-miss rate within acceptable limits'
          : `Symbol-off rate (${(symbolOffRate * 100).toFixed(2)}%) exceeds threshold`
      });
    }

    // Feature near-miss rate check
    if (thresholds.maxFeatureMissRate !== undefined) {
      const featureRate = featureStats.scatterNearMissRate
        .plus(featureStats.bonusNearMissRate)
        .toNumber();
      const checkPassed = featureRate <= thresholds.maxFeatureMissRate;
      if (!checkPassed) passed = false;

      checks.push({
        name: 'Feature Near-Miss Rate',
        passed: checkPassed,
        actual: featureRate,
        threshold: thresholds.maxFeatureMissRate,
        severity: checkPassed ? 'WARNING' : 'VIOLATION',
        message: checkPassed
          ? 'Feature near-miss rate within acceptable limits'
          : `Feature near-miss rate (${(featureRate * 100).toFixed(2)}%) exceeds threshold`
      });
    }

    return {
      passed,
      checks,
      standard: this.detectionConfig.standard
    };
  }

  /**
   * Get thresholds based on regulatory standard
   */
  private getThresholds(): {
    maxOverallRate?: number;
    maxSymbolOffRate?: number;
    maxFeatureMissRate?: number;
  } {
    switch (this.detectionConfig.standard) {
      case 'GLI-11':
        // GLI doesn't specify exact rates, but requires "natural" distribution
        // These are conservative thresholds based on industry practice
        return {
          maxOverallRate: 0.15,      // 15% of spins
          maxSymbolOffRate: 0.10,    // 10% for symbol-off specifically
          maxFeatureMissRate: 0.05   // 5% for feature near-misses
        };

      case 'UKGC':
        // UK GC has stricter requirements
        return {
          maxOverallRate: 0.12,
          maxSymbolOffRate: 0.08,
          maxFeatureMissRate: 0.03
        };

      case 'MGA':
        // Malta Gaming Authority
        return {
          maxOverallRate: 0.15,
          maxSymbolOffRate: 0.10,
          maxFeatureMissRate: 0.04
        };

      case 'AGCO':
        // Ontario AGCO
        return {
          maxOverallRate: 0.12,
          maxSymbolOffRate: 0.08,
          maxFeatureMissRate: 0.03
        };

      case 'CUSTOM':
        return this.detectionConfig.customThresholds ?? {};

      default:
        return {
          maxOverallRate: 0.15,
          maxSymbolOffRate: 0.10,
          maxFeatureMissRate: 0.05
        };
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Check if a symbol is high-value (worth tracking for near-misses)
   */
  private isHighValueSymbol(symbolId: string): boolean {
    // If specific symbols configured, check that
    if (this.detectionConfig.symbolsToAnalyze.length > 0) {
      return this.detectionConfig.symbolsToAnalyze.includes(symbolId);
    }

    // Otherwise, check if it's a paying symbol
    const payEntry = this.config.paytable.find(p => p.symbolId === symbolId);
    if (!payEntry) return false;

    // Get max pay for this symbol
    const maxPay = Math.max(...Object.values(payEntry.pays));
    return maxPay >= 1; // At least 1x bet
  }

  /**
   * Check if a symbol is wild and can substitute for another
   */
  private isWildSubstitute(symbol: string | undefined, targetSymbol: string): boolean {
    if (!symbol) return false;

    const symbolDef = this.config.symbols.find(s => s.id === symbol);
    if (!symbolDef || symbolDef.role !== 'WILD') return false;

    // Check if wild can substitute for target
    if (symbolDef.substitutes && symbolDef.substitutes.length > 0) {
      return symbolDef.substitutes.includes(targetSymbol);
    }

    // Default: wild substitutes for all paying symbols
    const targetDef = this.config.symbols.find(s => s.id === targetSymbol);
    return targetDef?.canBeSubstituted !== false;
  }

  /**
   * Check potential win if a symbol were in a position
   */
  private checkPotentialWin(
    grid: string[][],
    col: number,
    row: number,
    hypotheticalSymbol: string
  ): Decimal {
    // Create hypothetical grid
    const hypotheticalGrid = grid.map(r => [...r]);
    const targetRow = hypotheticalGrid[row];
    if (targetRow) {
      targetRow[col] = hypotheticalSymbol;
    }

    // Check for wins with this hypothetical grid
    // Simplified: just check consecutive count from left
    let consecutiveCount = 0;
    const cols = hypotheticalGrid[0]?.length ?? 0;

    for (let c = 0; c < cols; c++) {
      const hasSymbol = hypotheticalGrid.some(r => {
        const sym = r[c];
        return sym === hypotheticalSymbol || this.isWildSubstitute(sym, hypotheticalSymbol);
      });

      if (hasSymbol) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    return this.getPayForCount(hypotheticalSymbol, consecutiveCount);
  }

  /**
   * Get pay amount for a symbol count
   */
  private getPayForCount(symbolId: string, count: number): Decimal {
    const payEntry = this.config.paytable.find(p => p.symbolId === symbolId);
    if (!payEntry) return ZERO;

    const pay = payEntry.pays[count.toString()];
    return pay !== undefined ? dec(pay) : ZERO;
  }

  /**
   * Count occurrences of a symbol in grid
   */
  private countSymbol(grid: string[][], symbolId: string): number {
    let count = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell === symbolId) count++;
      }
    }
    return count;
  }

  /**
   * Estimate value of triggering a feature
   */
  private estimateFeatureValue(spins: number, scatterPay: number): Decimal {
    // Rough estimate: spins × 1x average + scatter pay
    return dec(spins).plus(scatterPay);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Analyze near-misses for a game configuration
 */
export function analyzeNearMisses(
  config: GameConfig,
  reelSetId: string,
  grids: Array<{ grid: string[][]; stops: number[]; weight: bigint }>,
  detectionConfig?: NearMissConfig
): NearMissAnalysis {
  const reelSet = config.reelSets.find(rs => rs.id === reelSetId);
  if (!reelSet) {
    throw new Error(`Reel set not found: ${reelSetId}`);
  }

  const detector = new NearMissDetector(config, reelSet, detectionConfig);

  // Collect all occurrences
  const allOccurrences: NearMissOccurrence[] = [];
  let totalCycles = 0n;

  for (const { grid, stops, weight } of grids) {
    const occurrences = detector.analyzeGrid(grid, stops);

    // Scale by weight
    for (const occ of occurrences) {
      occ.count = weight;
    }

    allOccurrences.push(...occurrences);
    totalCycles += weight;
  }

  return detector.aggregateAnalysis(allOccurrences, totalCycles);
}

/**
 * Generate near-miss report for certification
 */
export function generateNearMissReport(analysis: NearMissAnalysis): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    '                    NEAR-MISS ANALYSIS REPORT',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Total Cycles Analyzed: ${analysis.totalCycles.toLocaleString()}`,
    `Total Near-Misses: ${analysis.totalNearMisses.toLocaleString()}`,
    `Overall Near-Miss Rate: ${(analysis.overallRate.toNumber() * 100).toFixed(4)}%`,
    '',
    '───────────────────────────────────────────────────────────────',
    'NEAR-MISS RATES BY TYPE',
    '───────────────────────────────────────────────────────────────',
  ];

  for (const [type, rate] of analysis.rateByType) {
    lines.push(`  ${type}: ${(rate.toNumber() * 100).toFixed(4)}%`);
  }

  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('FEATURE NEAR-MISS ANALYSIS');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`  Scatter Near-Miss Rate: ${(analysis.featureNearMisses.scatterNearMissRate.toNumber() * 100).toFixed(4)}%`);
  lines.push(`  Bonus Near-Miss Rate: ${(analysis.featureNearMisses.bonusNearMissRate.toNumber() * 100).toFixed(4)}%`);

  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('REGULATORY COMPLIANCE');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`  Standard: ${analysis.compliance.standard}`);
  lines.push(`  Status: ${analysis.compliance.passed ? '✓ PASSED' : '✗ FAILED'}`);
  lines.push('');

  for (const check of analysis.compliance.checks) {
    const icon = check.passed ? '✓' : '✗';
    lines.push(`  ${icon} ${check.name}`);
    lines.push(`      Actual: ${(check.actual * 100).toFixed(4)}%`);
    lines.push(`      Threshold: ${(check.threshold * 100).toFixed(4)}%`);
    if (!check.passed) {
      lines.push(`      ${check.message}`);
    }
  }

  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('TOP NEAR-MISS OCCURRENCES');
  lines.push('───────────────────────────────────────────────────────────────');

  for (const occ of analysis.topOccurrences.slice(0, 10)) {
    const rate = analysis.totalCycles > 0n
      ? Number(occ.count * 10000n / analysis.totalCycles) / 100
      : 0;
    lines.push(`  ${occ.description}`);
    lines.push(`      Count: ${occ.count.toLocaleString()} (${rate.toFixed(2)}%)`);
    lines.push(`      Potential Win: ${occ.potentialWin.toFixed(2)}x`);
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  NearMissDetector as Detector,
  analyzeNearMisses as analyze,
  generateNearMissReport as report
};
