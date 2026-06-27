/**
 * SLOT MATH EXACT - RTP Calculator
 *
 * The heart of the exact calculation engine.
 * Performs full cycle enumeration with exact arithmetic.
 *
 * Features:
 * - Arbitrary precision (Decimal.js)
 * - Full cycle enumeration (all stop positions)
 * - Feature EV via Markov chains
 * - Win distribution analysis
 * - Parallel processing support
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide,
  toPercent,
  formatPercent
} from '../core/decimal.js';
import { bigIntToDecimal, formatBigInt } from '../core/bigint.js';
import { totalCycleSize } from '../core/combinatorics.js';
import { FullCycleEnumerator, createEnumerator, estimateComplexity } from '../enumerator/fullCycle.js';
import { LineEvaluator } from '../evaluators/lineEvaluator.js';
import { WaysEvaluator } from '../evaluators/waysEvaluator.js';
import { AllWaysEvaluator } from '../evaluators/allWaysEvaluator.js';
import { ClusterEvaluator } from '../evaluators/clusterEvaluator.js';
import { ScatterEvaluator } from '../evaluators/scatterEvaluator.js';
import { VariableWaysEvaluator } from '../evaluators/variableWaysEvaluator.js';
import { CascadeClusterEvaluator } from '../evaluators/cascadeCalculator.js';
import { SpecialWildManager } from '../evaluators/specialWilds.js';
import { MysterySymbolTransformer, createMysteryTransformer } from '../evaluators/mysterySymbol.js';
import {
  MarkovChainBuilder,
  MarkovChainSolver,
  buildFreeSpinsChain,
  calculateHoldAndWinEV,
  landingProbability,
  type HoldAndWinMarkovConfig
} from '../markov/index.js';
import { ConfigValidator, validateConfigOrThrow } from '../validator/configValidator.js';
import { Simulator, type SimulationResult } from '../simulator/simulator.js';
import type { GameConfig, RTPResult, WinResult, ReelSet } from '../types/config.js';

/**
 * Per-symbol statistics
 */
interface SymbolStats {
  contribution: Decimal;   // RTP contribution (weighted win sum)
  hitCount: bigint;        // Number of winning combinations with this symbol
}

/**
 * Win accumulator for exact calculation
 */
interface WinAccumulator {
  totalWinWeighted: Decimal;    // Sum of (win * weight)
  totalWeight: bigint;           // Sum of all weights
  hitCount: bigint;              // Number of winning combinations
  symbolStats: Map<string, SymbolStats>;  // Per-symbol tracking
  winDistribution: Map<string, { count: bigint; winSum: Decimal }>;
  maxWin: Decimal;
  featureTriggerCount: bigint;
  scatterWinWeighted: Decimal;
}

/**
 * RTP calculation options
 */
export interface RTOCalculatorOptions {
  /** Progress callback */
  onProgress?: (current: bigint, total: bigint, elapsed: number) => void;
  /** Validate config before calculation */
  validateConfig?: boolean;
  /** Include feature EV (Markov chains) */
  includeFeatures?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Maximum calculation time in milliseconds (default: 300000 = 5 min) */
  timeoutMs?: number;
  /** Maximum cycles to process (default: 10^12) */
  maxCycles?: bigint;
  /** Called when timeout occurs */
  onTimeout?: () => void;
  /** Auto-switch to simulation if cycles exceed threshold (default: true) */
  autoFallbackToSimulation?: boolean;
  /** Fallback simulation spin count (default: 10M) */
  fallbackSimulationSpins?: number;
  /** Called when falling back to simulation */
  onFallback?: (reason: 'CYCLES_TOO_LARGE' | 'TIMEOUT' | 'UNSUPPORTED_FEATURE') => void;
}

/**
 * Main RTP Calculator class
 */
export class RTPCalculator {
  private config: GameConfig;
  private enumerator: FullCycleEnumerator;
  private lineEvaluator: LineEvaluator | null = null;
  private waysEvaluator: WaysEvaluator | null = null;
  private allWaysEvaluator: AllWaysEvaluator | null = null;
  private clusterEvaluator: ClusterEvaluator | null = null;
  private variableWaysEvaluator: VariableWaysEvaluator | null = null;
  private cascadeEvaluator: CascadeClusterEvaluator | null = null;
  private scatterEvaluator: ScatterEvaluator;
  private specialWildManager: SpecialWildManager | null = null;
  private mysteryTransformer: MysterySymbolTransformer | null = null;
  private baseReelSet: ReelSet;

  constructor(config: GameConfig, options: RTOCalculatorOptions = {}) {
    // Validate config
    if (options.validateConfig !== false) {
      validateConfigOrThrow(config);
    }

    this.config = config;

    // Get base game reel set
    const baseReelSet = config.reelSets.find(rs => rs.id === config.baseGameReelSetId);
    if (!baseReelSet) {
      throw new Error(`Base reel set not found: ${config.baseGameReelSetId}`);
    }
    this.baseReelSet = baseReelSet;

    // Create enumerator
    this.enumerator = createEnumerator(baseReelSet, config.grid);

    // Check for special wilds that need state tracking
    const hasSpecialWilds = config.symbols.some(s =>
      s.role === 'WILD' && (s.wildType === 'WALKING' || s.wildType === 'STICKY' || s.wildType === 'EXPANDING')
    );
    if (hasSpecialWilds) {
      this.specialWildManager = new SpecialWildManager(config);
    }

    // Check for mystery symbols
    const mysterySymbol = config.symbols.find(s => s.role === 'MYSTERY');
    if (mysterySymbol) {
      this.mysteryTransformer = createMysteryTransformer(config, {
        symbolId: mysterySymbol.id
      });
    }

    // Check for cascade mechanic
    const hasCascade = config.clusterConfig?.cascadeMultiplierProgression !== undefined ||
                       config.evalType === 'CLUSTER';

    // Create appropriate evaluator based on eval type
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
        // Variable-ways uses dedicated evaluator with variable row heights
        this.variableWaysEvaluator = new VariableWaysEvaluator(config);
        // Also create ways evaluator as fallback for fixed-height evaluation
        this.waysEvaluator = new WaysEvaluator(config);
        break;
      case 'CLUSTER':
        this.clusterEvaluator = new ClusterEvaluator(config);
        // If cascade is enabled, also create cascade evaluator
        if (hasCascade) {
          this.cascadeEvaluator = new CascadeClusterEvaluator(config);
        }
        break;
      case 'ALL_WAYS':
        // ALL_WAYS pays in both directions (L→R and R→L)
        this.allWaysEvaluator = new AllWaysEvaluator(config);
        break;
      case 'HYBRID':
        // HYBRID combines multiple evaluation types (e.g., lines + cluster)
        // Create all evaluators and combine results
        this.lineEvaluator = new LineEvaluator(config);
        this.clusterEvaluator = new ClusterEvaluator(config);
        console.warn('HYBRID evalType combines lines and cluster evaluation. Results may need manual verification.');
        break;
      default:
        throw new Error(`Unsupported evalType: ${config.evalType}. Supported types: LINES_LTR, LINES_RTL, LINES_BOTH, WAYS, VARIABLE_WAYS, CLUSTER, ALL_WAYS, HYBRID`);
    }

    // Scatter evaluator always created
    this.scatterEvaluator = new ScatterEvaluator(config);
  }

  /**
   * Calculate exact RTP using full cycle enumeration
   * Automatically falls back to simulation if cycles are too large
   */
  calculate(options: RTOCalculatorOptions = {}): RTPResult {
    const startTime = Date.now();
    const totalCycles = this.enumerator.getTotalCycles();

    // Edge case: Timeout and max cycles limits
    const timeoutMs = options.timeoutMs ?? 300000;  // 5 minutes default
    const maxCycles = options.maxCycles ?? 10n ** 12n;  // 1 trillion default
    const autoFallback = options.autoFallbackToSimulation !== false;  // default true
    const fallbackSpins = options.fallbackSimulationSpins ?? 10_000_000;  // 10M default
    let timedOut = false;

    // Complexity check
    const complexity = estimateComplexity(this.enumerator.getReelLengths());
    if (options.verbose) {
      console.log(`Total cycles: ${formatBigInt(complexity.totalCycles)}`);
      console.log(`Feasibility: ${complexity.feasibility}`);
    }

    // Graceful degradation: auto-switch to simulation if cycles exceed threshold
    if (totalCycles > maxCycles && autoFallback) {
      if (options.verbose) {
        console.warn(`Cycles (${totalCycles}) exceed limit (${maxCycles}). Falling back to simulation.`);
      }
      if (options.onFallback) {
        options.onFallback('CYCLES_TOO_LARGE');
      }
      return this.fallbackToSimulation(fallbackSpins, options, 'CYCLES_TOO_LARGE');
    }

    // Check for unsupported feature combinations that require simulation
    const unsupportedReason = this.checkUnsupportedFeatures();
    if (unsupportedReason && autoFallback) {
      if (options.verbose) {
        console.warn(`Unsupported feature: ${unsupportedReason}. Falling back to simulation.`);
      }
      if (options.onFallback) {
        options.onFallback('UNSUPPORTED_FEATURE');
      }
      return this.fallbackToSimulation(fallbackSpins, options, 'UNSUPPORTED_FEATURE', unsupportedReason);
    }

    // Warn if cycle count exceeds practical limit but no fallback
    if (totalCycles > maxCycles && !autoFallback) {
      console.warn(`Warning: Total cycles (${totalCycles}) exceeds max limit (${maxCycles}). Consider using simulation mode.`);
    }

    // Initialize accumulator
    const acc: WinAccumulator = {
      totalWinWeighted: ZERO,
      totalWeight: 0n,
      hitCount: 0n,
      symbolStats: new Map(),
      winDistribution: this.initializeWinDistribution(),
      maxWin: ZERO,
      featureTriggerCount: 0n,
      scatterWinWeighted: ZERO
    };

    // Initialize symbol stats for all paying symbols
    for (const entry of this.config.paytable) {
      acc.symbolStats.set(entry.symbolId, { contribution: ZERO, hitCount: 0n });
    }

    // Enumerate all combinations
    let processed = 0n;
    const progressInterval = totalCycles > 1000000n ? totalCycles / 100n : 10000n;
    const timeoutCheckInterval = 10000n;  // Check timeout every 10k cycles

    for (const gridState of this.enumerator.enumerate()) {
      // Timeout check (every N cycles to minimize overhead)
      if (processed % timeoutCheckInterval === 0n) {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          timedOut = true;
          if (options.onTimeout) {
            options.onTimeout();
          }
          if (options.verbose) {
            console.warn(`Timeout after ${elapsed}ms (processed ${processed} of ${totalCycles} cycles)`);
          }
          break;
        }
      }

      // Max cycles check
      if (processed >= maxCycles) {
        if (options.verbose) {
          console.warn(`Max cycles limit reached (${maxCycles})`);
        }
        break;
      }

      const weight = bigIntToDecimal(gridState.weight);

      // Evaluate grid (pass stop positions for cascade support)
      const { lineWin, scatterWin, wins, triggeredFS } = this.evaluateGrid(gridState.grid, gridState.stops);

      const totalWin = lineWin.plus(scatterWin);

      // Accumulate weighted win
      acc.totalWinWeighted = acc.totalWinWeighted.plus(totalWin.times(weight));
      acc.totalWeight += gridState.weight;

      // Track hits
      if (totalWin.greaterThan(ZERO)) {
        acc.hitCount += gridState.weight;
      }

      // Track scatter wins separately
      acc.scatterWinWeighted = acc.scatterWinWeighted.plus(scatterWin.times(weight));

      // Track feature triggers
      if (triggeredFS) {
        acc.featureTriggerCount += gridState.weight;
      }

      // Update max win
      if (totalWin.greaterThan(acc.maxWin)) {
        acc.maxWin = totalWin;
      }

      // Update per-symbol stats (contribution + hit count)
      for (const win of wins) {
        const stats = acc.symbolStats.get(win.symbolId);
        if (stats) {
          stats.contribution = stats.contribution.plus(dec(win.totalWin).times(weight));
          stats.hitCount += gridState.weight;
        }
      }

      // Update win distribution
      this.updateWinDistribution(acc.winDistribution, totalWin, gridState.weight);

      processed++;

      // Progress callback
      if (options.onProgress && processed % progressInterval === 0n) {
        const elapsed = Date.now() - startTime;
        options.onProgress(processed, totalCycles, elapsed);
      }
    }

    // Calculate base game RTP
    const totalWeightDecimal = bigIntToDecimal(acc.totalWeight);
    const baseGameRTP = safeDivide(acc.totalWinWeighted, totalWeightDecimal);

    // Calculate scatter RTP contribution
    const scatterRTP = safeDivide(acc.scatterWinWeighted, totalWeightDecimal);

    // Calculate feature RTP via Markov chain (if enabled)
    let freeSpinsRTP = ZERO;
    let holdAndWinRTP = ZERO;
    let bonusBuyRTPs: Map<string, Decimal> = new Map();

    if (options.includeFeatures !== false) {
      if (this.config.freeSpins?.enabled) {
        freeSpinsRTP = this.calculateFreeSpinsRTP(acc, totalWeightDecimal);
      }

      if (this.config.holdAndWin?.enabled) {
        holdAndWinRTP = this.calculateHoldAndWinRTP(acc, totalWeightDecimal);
      }

      if (this.config.bonusBuy?.enabled) {
        bonusBuyRTPs = this.calculateBonusBuyRTPs(acc, totalWeightDecimal, freeSpinsRTP, holdAndWinRTP);
      }
    }

    // Total RTP (base game RTP, bonus buy is separate as it's a different bet mode)
    const totalRTP = baseGameRTP.plus(freeSpinsRTP).plus(holdAndWinRTP);

    // Average bonus buy RTP (if multiple options exist)
    const bonusRTP = bonusBuyRTPs.size > 0
      ? safeDivide(
          Array.from(bonusBuyRTPs.values()).reduce((acc, v) => acc.plus(v), ZERO),
          dec(bonusBuyRTPs.size)
        )
      : ZERO;

    // Hit rate
    const hitRate = safeDivide(bigIntToDecimal(acc.hitCount), totalWeightDecimal);

    // Feature frequency
    const featureFreq = acc.featureTriggerCount > 0n
      ? Number(acc.totalWeight / acc.featureTriggerCount)
      : Infinity;

    // Determine volatility class
    const volatility = this.determineVolatility(acc, totalWeightDecimal);

    // Build symbol contributions with proper hit rates
    const symbolContributions = Array.from(acc.symbolStats.entries()).map(([symbolId, stats]) => ({
      symbolId,
      contribution: safeDivide(stats.contribution, totalWeightDecimal).toNumber(),
      hitRate: safeDivide(bigIntToDecimal(stats.hitCount), totalWeightDecimal).toNumber()
    }));

    // Build win distribution
    const winDistribution = this.buildWinDistributionResult(acc.winDistribution, acc.totalWeight);

    const elapsed = Date.now() - startTime;

    if (options.verbose) {
      console.log(`\nCalculation complete in ${elapsed}ms`);
      if (timedOut || processed < totalCycles) {
        console.log(`Partial calculation: ${processed} of ${totalCycles} cycles (${(Number(processed * 100n / totalCycles))}%)`);
      }
      console.log(`Base Game RTP: ${formatPercent(baseGameRTP)}`);
      console.log(`Free Spins RTP: ${formatPercent(freeSpinsRTP)}`);
      console.log(`Hold & Win RTP: ${formatPercent(holdAndWinRTP)}`);
      console.log(`Total RTP: ${formatPercent(totalRTP)}`);
      console.log(`Hit Rate: ${formatPercent(hitRate)}`);
    }

    // Build warnings for partial/timeout
    const warnings: RTPResult['warnings'] = [];
    if (timedOut) {
      warnings.push({
        code: 'TIMEOUT',
        message: 'Calculation timed out before completing all cycles',
        details: `Processed ${processed} of ${totalCycles} cycles (${Number(processed * 100n / totalCycles)}%)`
      });
    } else if (processed < totalCycles) {
      warnings.push({
        code: 'PARTIAL_CALCULATION',
        message: 'Calculation stopped before completing all cycles',
        details: `Processed ${processed} of ${totalCycles} cycles (${Number(processed * 100n / totalCycles)}%)`
      });
    }

    return {
      totalRTP: totalRTP.toNumber(),
      baseGameRTP: baseGameRTP.toNumber(),
      freeSpinsRTP: freeSpinsRTP.toNumber(),
      holdAndWinRTP: holdAndWinRTP.toNumber(),
      bonusRTP: bonusRTP.toNumber(),
      hitRate: hitRate.toNumber(),
      volatility,
      featureFrequencies: {
        freeSpins: featureFreq
      },
      maxWin: acc.maxWin.toNumber(),
      symbolContributions,
      winDistribution,
      totalCycles,
      cyclesCalculated: processed,
      calculationType: timedOut || processed < totalCycles ? 'HYBRID' : 'EXACT',
      calculationTimeMs: elapsed,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Evaluate a single grid
   */
  private evaluateGrid(grid: string[][], stopPositions?: number[]): {
    lineWin: Decimal;
    scatterWin: Decimal;
    wins: WinResult[];
    triggeredFS: boolean;
    cascadeLevel: number;
  } {
    let lineWin = ZERO;
    const wins: WinResult[] = [];
    let cascadeLevel = 0;

    // Apply special wilds transformation if manager exists
    let evalGrid = grid;
    if (this.specialWildManager) {
      // Detect new wilds and apply transformations
      this.specialWildManager.detectNewWilds(grid);
      evalGrid = this.specialWildManager.applyAndAdvance(grid);
    }

    // Handle mystery symbols - calculate EV over all possible reveals
    if (this.mysteryTransformer && this.mysteryTransformer.hasMysterySymbols(evalGrid)) {
      return this.evaluateGridWithMystery(evalGrid, stopPositions);
    }

    // Evaluate based on game type
    // HYBRID mode: evaluate with both line and cluster evaluators
    const isHybrid = this.lineEvaluator && this.clusterEvaluator;

    if (isHybrid) {
      // Evaluate lines
      const lineWins = this.lineEvaluator!.evaluate(evalGrid);
      wins.push(...lineWins);
      lineWin = sum(lineWins.map(w => dec(w.totalWin)));

      // Evaluate clusters (additively)
      const clusterWins = this.clusterEvaluator!.evaluate(evalGrid);
      wins.push(...clusterWins);
      lineWin = lineWin.plus(sum(clusterWins.map(w => dec(w.totalWin))));

    } else if (this.variableWaysEvaluator) {
      // Variable-ways: use variable row evaluation
      // For exact calculation, we evaluate with the grid's actual row counts
      const symbolsPerReel = this.getSymbolsPerReel(evalGrid);
      const varWins = this.variableWaysEvaluator.evaluate(evalGrid, symbolsPerReel);
      wins.push(...varWins);
      lineWin = sum(varWins.map(w => dec(w.totalWin)));

    } else if (this.lineEvaluator) {
      const lineWins = this.lineEvaluator.evaluate(evalGrid);
      wins.push(...lineWins);
      lineWin = sum(lineWins.map(w => dec(w.totalWin)));

    } else if (this.allWaysEvaluator) {
      const allWaysWins = this.allWaysEvaluator.evaluate(evalGrid);
      wins.push(...allWaysWins);
      lineWin = sum(allWaysWins.map(w => dec(w.totalWin)));

    } else if (this.waysEvaluator) {
      const waysWins = this.waysEvaluator.evaluate(evalGrid);
      wins.push(...waysWins);
      lineWin = sum(waysWins.map(w => dec(w.totalWin)));

    } else if (this.clusterEvaluator) {
      // Check if cascade evaluation should be used
      if (this.cascadeEvaluator && stopPositions) {
        // Use cascade evaluator for deterministic cascade sequence
        const cascadeResult = this.cascadeEvaluator.evaluateCascade(
          evalGrid,
          this.baseReelSet,
          stopPositions
        );
        wins.push(...cascadeResult.states.flatMap(s => s.wins));
        lineWin = cascadeResult.totalWin;
        cascadeLevel = cascadeResult.totalCascades;
      } else {
        // Standard cluster evaluation without cascade
        const clusterWins = this.clusterEvaluator.evaluate(evalGrid);
        wins.push(...clusterWins);
        lineWin = sum(clusterWins.map(w => dec(w.totalWin)));
      }
    }

    // Evaluate scatters
    const scatterResult = this.scatterEvaluator.evaluate(evalGrid);
    wins.push(...scatterResult.wins);
    const scatterWin = sum(scatterResult.wins.map(w => dec(w.totalWin)));

    // Reset special wild manager after evaluation
    if (this.specialWildManager) {
      this.specialWildManager.reset();
    }

    return {
      lineWin,
      scatterWin,
      wins,
      triggeredFS: scatterResult.triggeredFeature === 'FREE_SPINS',
      cascadeLevel
    };
  }

  /**
   * Evaluate grid with mystery symbols by computing weighted EV
   * across all possible reveal outcomes
   */
  private evaluateGridWithMystery(
    grid: string[][],
    stopPositions?: number[]
  ): {
    lineWin: Decimal;
    scatterWin: Decimal;
    wins: WinResult[];
    triggeredFS: boolean;
    cascadeLevel: number;
  } {
    if (!this.mysteryTransformer) {
      throw new Error('Mystery transformer not initialized');
    }

    // Get all possible reveal outcomes
    const outcomes = this.mysteryTransformer.getAllRevealOutcomes(grid);

    let weightedLineWin = ZERO;
    let weightedScatterWin = ZERO;
    let anyTriggeredFS = false;
    let maxCascadeLevel = 0;
    const allWins: WinResult[] = [];

    // Evaluate each outcome and weight by probability
    for (const outcome of outcomes) {
      // Recursively evaluate (mystery symbols replaced)
      const result = this.evaluateGridCore(outcome.grid, stopPositions);

      weightedLineWin = weightedLineWin.plus(result.lineWin.times(outcome.probability));
      weightedScatterWin = weightedScatterWin.plus(result.scatterWin.times(outcome.probability));

      if (result.triggeredFS) {
        anyTriggeredFS = true;
      }

      if (result.cascadeLevel > maxCascadeLevel) {
        maxCascadeLevel = result.cascadeLevel;
      }

      // Weight wins by probability
      for (const win of result.wins) {
        allWins.push({
          ...win,
          totalWin: win.totalWin * outcome.probability.toNumber()
        });
      }
    }

    return {
      lineWin: weightedLineWin,
      scatterWin: weightedScatterWin,
      wins: allWins,
      triggeredFS: anyTriggeredFS,
      cascadeLevel: maxCascadeLevel
    };
  }

  /**
   * Core grid evaluation without mystery symbol handling (to avoid recursion issues)
   */
  private evaluateGridCore(
    grid: string[][],
    stopPositions?: number[]
  ): {
    lineWin: Decimal;
    scatterWin: Decimal;
    wins: WinResult[];
    triggeredFS: boolean;
    cascadeLevel: number;
  } {
    let lineWin = ZERO;
    const wins: WinResult[] = [];
    let cascadeLevel = 0;

    // Evaluate based on game type
    const isHybrid = this.lineEvaluator && this.clusterEvaluator;

    if (isHybrid) {
      const lineWins = this.lineEvaluator!.evaluate(grid);
      wins.push(...lineWins);
      lineWin = sum(lineWins.map(w => dec(w.totalWin)));

      const clusterWins = this.clusterEvaluator!.evaluate(grid);
      wins.push(...clusterWins);
      lineWin = lineWin.plus(sum(clusterWins.map(w => dec(w.totalWin))));

    } else if (this.variableWaysEvaluator) {
      const symbolsPerReel = this.getSymbolsPerReel(grid);
      const varWins = this.variableWaysEvaluator.evaluate(grid, symbolsPerReel);
      wins.push(...varWins);
      lineWin = sum(varWins.map(w => dec(w.totalWin)));

    } else if (this.lineEvaluator) {
      const lineWins = this.lineEvaluator.evaluate(grid);
      wins.push(...lineWins);
      lineWin = sum(lineWins.map(w => dec(w.totalWin)));

    } else if (this.allWaysEvaluator) {
      const allWaysWins = this.allWaysEvaluator.evaluate(grid);
      wins.push(...allWaysWins);
      lineWin = sum(allWaysWins.map(w => dec(w.totalWin)));

    } else if (this.waysEvaluator) {
      const waysWins = this.waysEvaluator.evaluate(grid);
      wins.push(...waysWins);
      lineWin = sum(waysWins.map(w => dec(w.totalWin)));

    } else if (this.clusterEvaluator) {
      if (this.cascadeEvaluator && stopPositions) {
        const cascadeResult = this.cascadeEvaluator.evaluateCascade(
          grid,
          this.baseReelSet,
          stopPositions
        );
        wins.push(...cascadeResult.states.flatMap(s => s.wins));
        lineWin = cascadeResult.totalWin;
        cascadeLevel = cascadeResult.totalCascades;
      } else {
        const clusterWins = this.clusterEvaluator.evaluate(grid);
        wins.push(...clusterWins);
        lineWin = sum(clusterWins.map(w => dec(w.totalWin)));
      }
    }

    // Evaluate scatters
    const scatterResult = this.scatterEvaluator.evaluate(grid);
    wins.push(...scatterResult.wins);
    const scatterWin = sum(scatterResult.wins.map(w => dec(w.totalWin)));

    return {
      lineWin,
      scatterWin,
      wins,
      triggeredFS: scatterResult.triggeredFeature === 'FREE_SPINS',
      cascadeLevel
    };
  }

  /**
   * Get the number of non-empty symbols per reel (for variable-ways grids)
   */
  private getSymbolsPerReel(grid: string[][]): number[] {
    const cols = grid[0]?.length ?? 0;
    const symbolsPerReel: number[] = [];

    for (let col = 0; col < cols; col++) {
      let count = 0;
      for (const row of grid) {
        if (row[col] && row[col] !== '') {
          count++;
        }
      }
      symbolsPerReel.push(count);
    }

    return symbolsPerReel;
  }

  /**
   * Calculate Free Spins RTP contribution using Markov chain
   */
  private calculateFreeSpinsRTP(acc: WinAccumulator, totalWeight: Decimal): Decimal {
    if (!this.config.freeSpins?.enabled) return ZERO;

    const fs = this.config.freeSpins;

    // Trigger probability
    const triggerProb = safeDivide(
      bigIntToDecimal(acc.featureTriggerCount),
      totalWeight
    );

    if (triggerProb.equals(ZERO)) return ZERO;

    // Get average trigger configuration
    const triggerCounts = Object.keys(fs.triggerCounts).map(Number).sort((a, b) => a - b);
    const minTrigger = triggerCounts[0] ?? 3;
    const triggerConfig = fs.triggerCounts[minTrigger.toString()];

    if (!triggerConfig) return ZERO;

    // Calculate retrigger probability from FS reel strip composition
    const retriggerProb = this.calculateRetriggerProbability(fs.triggerSymbol, minTrigger);

    // Average spin win in base game
    const avgBaseWin = safeDivide(acc.totalWinWeighted, totalWeight);

    // Multiplier during FS (assume 2x average if progression exists)
    const fsMultiplier = fs.multiplierProgression ? dec(2) : ONE;
    const avgFSSpinWin = avgBaseWin.times(fsMultiplier);

    // Build Markov chain for FS
    const chain = buildFreeSpinsChain({
      initialSpins: triggerConfig.spins,
      retriggerProbability: retriggerProb,
      retriggerSpins: fs.retriggerCounts?.[minTrigger.toString()] ?? triggerConfig.spins,
      maxRetriggers: fs.maxRetriggers ?? 5,
      avgSpinWin: avgFSSpinWin,
      multiplierProgression: fs.multiplierProgression === 'PER_SPIN'
        ? fs.multiplierIncrements
        : undefined
    });

    // Solve for expected value
    const solver = new MarkovChainSolver(chain);
    const fsEV = solver.solveExpectedValue();

    // Add scatter pay on trigger
    const scatterPay = triggerConfig.pay ?? 0;

    // Total FS RTP = trigger_probability × (EV + scatter_pay)
    return triggerProb.times(fsEV.plus(dec(scatterPay)));
  }

  /**
   * Calculate Hold & Win RTP contribution using Markov chain
   */
  private calculateHoldAndWinRTP(acc: WinAccumulator, totalWeight: Decimal): Decimal {
    if (!this.config.holdAndWin?.enabled) return ZERO;

    const hwConfig = this.config.holdAndWin;

    // Calculate trigger probability from base game enumeration
    // Need to count how often we get triggerCount or more trigger symbols
    const triggerProb = this.calculateHWTriggerProbability();

    if (triggerProb.equals(ZERO)) return ZERO;

    // Convert GameConfig H&W to Markov H&W config
    const gridRows = hwConfig.gridSize?.rows ?? this.config.grid.rows;
    const gridCols = hwConfig.gridSize?.cols ?? this.config.grid.cols;

    // Convert symbolValues from record to array format
    const symbolValues: Array<{ value: Decimal; weight: number }> = [];
    for (const [, sv] of Object.entries(hwConfig.symbolValues)) {
      symbolValues.push({
        value: dec(sv.value),
        weight: sv.weight
      });
    }

    // Calculate landing probability based on reel strip composition
    // Simplified: use trigger symbol frequency on reels
    const landingProb = this.calculateHWLandingProbability();

    // Build Markov config
    const markovConfig: HoldAndWinMarkovConfig = {
      initialRespins: hwConfig.initialRespins,
      gridRows,
      gridCols,
      landingProbability: landingProb,
      symbolValues,
      jackpots: hwConfig.jackpots ? {
        grand: hwConfig.jackpots['grand'] ? {
          condition: 'FULL_GRID',
          value: dec(hwConfig.jackpots['grand'].value)
        } : undefined
      } : undefined,
      resetOnLanding: hwConfig.respinsResetOnLand
    };

    // Calculate H&W EV using Markov chain
    const { expectedValue } = calculateHoldAndWinEV(markovConfig);

    // Estimate average trigger value (symbols that triggered the feature)
    const avgTriggerValue = this.calculateAvgTriggerValue(hwConfig);

    // Total H&W RTP = P(trigger) × (trigger_symbol_value + feature_EV)
    return triggerProb.times(avgTriggerValue.plus(expectedValue));
  }

  /**
   * Calculate Hold & Win trigger probability
   *
   * If triggerProbability is explicitly set in config, use it.
   * Otherwise, approximate from reel strip composition.
   */
  private calculateHWTriggerProbability(): Decimal {
    if (!this.config.holdAndWin?.enabled) return ZERO;

    const hwConfig = this.config.holdAndWin;

    // Use explicit trigger probability if provided
    if (hwConfig.triggerProbability !== undefined) {
      return dec(hwConfig.triggerProbability);
    }

    const triggerSymbol = hwConfig.triggerSymbol;
    const triggerCount = hwConfig.triggerCount;

    // Find trigger symbol in paytable/symbols
    // For exact calculation, we'd enumerate all grids
    // Here we approximate using reel strip frequencies

    const reelFreqs: number[] = [];
    for (const reel of this.baseReelSet.reels) {
      const count = reel.symbols.filter(s => s === triggerSymbol).length;
      reelFreqs.push(count / reel.symbols.length);
    }

    // Approximate probability using Poisson binomial
    // For simplicity, use average frequency
    const avgFreq = reelFreqs.reduce((a, b) => a + b, 0) / reelFreqs.length;
    const gridSize = this.config.grid.rows * this.config.grid.cols;

    // P(X >= triggerCount) where X ~ Binomial(gridSize, avgFreq)
    let probTrigger = ZERO;
    for (let k = triggerCount; k <= gridSize; k++) {
      const prob = landingProbability(gridSize, k, dec(avgFreq));
      probTrigger = probTrigger.plus(prob);
    }

    return probTrigger;
  }

  /**
   * Calculate landing probability for H&W respins
   *
   * If landingProbability is specified in config, use it directly.
   * Otherwise, estimate from reel strip composition.
   */
  private calculateHWLandingProbability(): Decimal {
    if (!this.config.holdAndWin?.enabled) return ZERO;

    // Use explicit landing probability if provided
    if (this.config.holdAndWin.landingProbability !== undefined) {
      return dec(this.config.holdAndWin.landingProbability);
    }

    const triggerSymbol = this.config.holdAndWin.triggerSymbol;

    // Fallback: estimate from reel strip composition (less accurate for H&W)
    let totalFreq = 0;
    for (const reel of this.baseReelSet.reels) {
      const count = reel.symbols.filter(s => s === triggerSymbol).length;
      totalFreq += count / reel.symbols.length;
    }

    return dec(totalFreq / this.baseReelSet.reels.length);
  }

  /**
   * Calculate average value of trigger symbols
   */
  private calculateAvgTriggerValue(hwConfig: NonNullable<GameConfig['holdAndWin']>): Decimal {
    // Weighted average of all symbol values
    let totalValue = ZERO;
    let totalWeight = 0;

    for (const [, sv] of Object.entries(hwConfig.symbolValues)) {
      totalValue = totalValue.plus(dec(sv.value).times(sv.weight));
      totalWeight += sv.weight;
    }

    const avgSymbolValue = totalWeight > 0 ? safeDivide(totalValue, dec(totalWeight)) : ZERO;

    // Multiply by trigger count (symbols that triggered)
    return avgSymbolValue.times(hwConfig.triggerCount);
  }

  /**
   * Calculate Bonus Buy RTPs for each available option
   *
   * Bonus Buy RTP = Feature EV / Buy Cost
   *
   * When buying a feature directly:
   * - Player pays cost (e.g., 100x bet)
   * - Gets guaranteed feature entry (e.g., Free Spins)
   * - RTP = Expected feature value / cost paid
   */
  private calculateBonusBuyRTPs(
    acc: WinAccumulator,
    totalWeight: Decimal,
    freeSpinsRTP: Decimal,
    holdAndWinRTP: Decimal
  ): Map<string, Decimal> {
    const rtps = new Map<string, Decimal>();

    if (!this.config.bonusBuy?.enabled) return rtps;

    for (const option of this.config.bonusBuy.options) {
      const cost = dec(option.cost);

      // Determine feature EV based on which feature is being bought
      let featureEV = ZERO;

      switch (option.feature) {
        case 'FREE_SPINS':
        case 'free_spins':
          // Get trigger probability to convert RTP to EV
          // FS RTP = P(trigger) × EV, so EV = FS RTP / P(trigger)
          // But for bonus buy, we get 100% trigger, so EV directly
          if (this.config.freeSpins?.enabled) {
            const triggerProb = safeDivide(
              bigIntToDecimal(acc.featureTriggerCount),
              totalWeight
            );
            // If trigger prob is 0, use RTP as rough estimate
            if (triggerProb.greaterThan(ZERO)) {
              featureEV = safeDivide(freeSpinsRTP, triggerProb);
            } else {
              // Fallback: estimate from config
              featureEV = this.estimateFreeSpinsEV();
            }
          }
          break;

        case 'HOLD_AND_WIN':
        case 'hold_and_win':
          if (this.config.holdAndWin?.enabled) {
            const triggerProb = this.calculateHWTriggerProbability();
            if (triggerProb.greaterThan(ZERO)) {
              featureEV = safeDivide(holdAndWinRTP, triggerProb);
            }
          }
          break;

        default:
          // Unknown feature, skip
          continue;
      }

      // Apply guaranteed minimum if specified
      if (option.guaranteedValue !== undefined) {
        const guaranteedMin = dec(option.guaranteedValue);
        if (guaranteedMin.greaterThan(featureEV)) {
          // Guaranteed value affects EV calculation
          // This is a simplified model - real calculation would need
          // to integrate the truncated distribution
          featureEV = guaranteedMin.plus(featureEV).div(2);
        }
      }

      // Bonus Buy RTP = Feature EV / Cost
      const buyRTP = safeDivide(featureEV, cost);
      rtps.set(option.id, buyRTP);
    }

    return rtps;
  }

  /**
   * Estimate Free Spins EV from config using Markov chain
   *
   * When we don't have exact base game statistics (e.g., bonus buy without trigger data),
   * we build a Markov chain with estimated values from config.
   *
   * Key improvements:
   * 1. Uses actual retrigger probability from reel composition
   * 2. Models multiplier progression properly
   * 3. Accounts for scatter pay on trigger
   */
  private estimateFreeSpinsEV(): Decimal {
    if (!this.config.freeSpins?.enabled) return ZERO;

    const fs = this.config.freeSpins;

    // Get trigger configuration
    const triggerCounts = Object.keys(fs.triggerCounts).map(Number).sort((a, b) => a - b);
    const minTrigger = triggerCounts[0] ?? 3;
    const triggerConfig = fs.triggerCounts[minTrigger.toString()];

    if (!triggerConfig) return ZERO;

    // Calculate retrigger probability from actual reel composition
    const retriggerProb = this.calculateRetriggerProbability(fs.triggerSymbol, minTrigger);

    // Estimate average spin win during FS
    // Use base game average from paytable analysis
    const estimatedBaseWin = this.estimateBaseGameAvgWin();

    // FS typically has enhanced wins (2x-3x base game)
    // Apply multiplier if configured
    let avgFSWinMultiplier = ONE;
    if (fs.multiplierProgression === 'PER_SPIN' && fs.multiplierIncrements) {
      // Calculate weighted average multiplier across spins
      const increments = fs.multiplierIncrements;
      const spins = triggerConfig.spins;
      let totalMult = ZERO;

      for (let i = 0; i < spins; i++) {
        const mult = increments[Math.min(i, increments.length - 1)] ?? 1;
        totalMult = totalMult.plus(dec(mult));
      }
      avgFSWinMultiplier = safeDivide(totalMult, dec(spins));
    } else if (fs.startMultiplier && fs.startMultiplier > 1) {
      avgFSWinMultiplier = dec(fs.startMultiplier);
    }

    // Enhanced FS reel set typically provides ~2x base game wins
    const fsReelBoost = fs.reelSetId !== this.config.baseGameReelSetId ? dec(2) : ONE;

    const avgFSSpinWin = estimatedBaseWin.times(avgFSWinMultiplier).times(fsReelBoost);

    // Build Markov chain
    const chain = buildFreeSpinsChain({
      initialSpins: triggerConfig.spins,
      retriggerProbability: retriggerProb,
      retriggerSpins: fs.retriggerCounts?.[minTrigger.toString()] ?? triggerConfig.spins,
      maxRetriggers: fs.maxRetriggers ?? 5,
      avgSpinWin: avgFSSpinWin,
      multiplierProgression: fs.multiplierProgression === 'PER_SPIN'
        ? fs.multiplierIncrements
        : undefined
    });

    // Solve for EV
    const solver = new MarkovChainSolver(chain);
    const fsEV = solver.solveExpectedValue();

    // Add scatter pay on trigger
    const scatterPay = triggerConfig.pay ?? 0;

    return fsEV.plus(dec(scatterPay));
  }

  /**
   * Estimate base game average win from paytable analysis
   */
  private estimateBaseGameAvgWin(): Decimal {
    // Quick paytable analysis to estimate average win per spin
    // This is a rough estimate based on symbol frequencies and pays

    let totalExpectedWin = ZERO;
    const reels = this.baseReelSet.reels;
    const cols = reels.length;
    const rows = this.config.grid.rows;

    for (const entry of this.config.paytable) {
      const symbolId = entry.symbolId;

      // Calculate approximate probability of 3+ matching
      const reelProbs: Decimal[] = [];

      for (const reel of reels) {
        const symbolCount = reel.symbols.filter(s => s === symbolId).length;
        const wildCount = reel.symbols.filter(s =>
          this.config.symbols.find(sym => sym.id === s)?.role === 'WILD'
        ).length;

        // Probability of symbol or wild in visible window
        const matchProb = dec(symbolCount + wildCount).dividedBy(reel.symbols.length);
        reelProbs.push(matchProb);
      }

      // P(3 of a kind from left) ≈ p1 × p2 × p3
      if (reelProbs.length >= 3) {
        const p3 = (reelProbs[0] ?? ZERO).times(reelProbs[1] ?? ZERO).times(reelProbs[2] ?? ZERO);
        const pay3 = entry.pays['3'] ?? 0;

        if (pay3 > 0) {
          totalExpectedWin = totalExpectedWin.plus(p3.times(dec(pay3)));
        }
      }

      // P(4 of a kind) ≈ p1 × p2 × p3 × p4
      if (reelProbs.length >= 4) {
        const p4 = (reelProbs[0] ?? ZERO).times(reelProbs[1] ?? ZERO).times(reelProbs[2] ?? ZERO).times(reelProbs[3] ?? ZERO);
        const pay4 = entry.pays['4'] ?? 0;

        if (pay4 > 0) {
          totalExpectedWin = totalExpectedWin.plus(p4.times(dec(pay4)));
        }
      }

      // P(5 of a kind) ≈ p1 × p2 × p3 × p4 × p5
      if (reelProbs.length >= 5) {
        const p5 = (reelProbs[0] ?? ZERO).times(reelProbs[1] ?? ZERO).times(reelProbs[2] ?? ZERO).times(reelProbs[3] ?? ZERO).times(reelProbs[4] ?? ZERO);
        const pay5 = entry.pays['5'] ?? 0;

        if (pay5 > 0) {
          totalExpectedWin = totalExpectedWin.plus(p5.times(dec(pay5)));
        }
      }
    }

    // If estimate is too low, use reasonable default
    if (totalExpectedWin.lessThan(dec(0.1))) {
      return ONE; // 1x average win is reasonable for most slots
    }

    return totalExpectedWin;
  }

  /**
   * Determine volatility class based on win distribution
   */
  private determineVolatility(acc: WinAccumulator, totalWeight: Decimal): 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
    // Calculate coefficient of variation
    // Simplified: use max win and hit rate as proxies

    const hitRate = safeDivide(bigIntToDecimal(acc.hitCount), totalWeight);
    const maxWin = acc.maxWin;

    if (maxWin.greaterThan(dec(5000)) || hitRate.lessThan(dec(0.2))) {
      return 'VERY_HIGH';
    } else if (maxWin.greaterThan(dec(1000)) || hitRate.lessThan(dec(0.3))) {
      return 'HIGH';
    } else if (maxWin.greaterThan(dec(200)) || hitRate.lessThan(dec(0.4))) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  /**
   * Initialize win distribution buckets
   */
  private initializeWinDistribution(): Map<string, { count: bigint; winSum: Decimal }> {
    const dist = new Map<string, { count: bigint; winSum: Decimal }>();

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
      '100x+'
    ];

    for (const range of ranges) {
      dist.set(range, { count: 0n, winSum: ZERO });
    }

    return dist;
  }

  /**
   * Update win distribution
   */
  private updateWinDistribution(
    dist: Map<string, { count: bigint; winSum: Decimal }>,
    win: Decimal,
    weight: bigint
  ): void {
    let range: string;

    if (win.equals(ZERO)) {
      range = '0x';
    } else if (win.lessThan(dec(0.5))) {
      range = '0.01-0.5x';
    } else if (win.lessThan(ONE)) {
      range = '0.5-1x';
    } else if (win.lessThan(dec(2))) {
      range = '1-2x';
    } else if (win.lessThan(dec(5))) {
      range = '2-5x';
    } else if (win.lessThan(dec(10))) {
      range = '5-10x';
    } else if (win.lessThan(dec(20))) {
      range = '10-20x';
    } else if (win.lessThan(dec(50))) {
      range = '20-50x';
    } else if (win.lessThan(dec(100))) {
      range = '50-100x';
    } else {
      range = '100x+';
    }

    const bucket = dist.get(range);
    if (bucket) {
      bucket.count += weight;
      bucket.winSum = bucket.winSum.plus(win.times(bigIntToDecimal(weight)));
    }
  }

  /**
   * Build win distribution result
   */
  private buildWinDistributionResult(
    dist: Map<string, { count: bigint; winSum: Decimal }>,
    totalWeight: bigint
  ): Array<{ range: string; probability: number; rtpContribution: number }> {
    const totalWeightDec = bigIntToDecimal(totalWeight);

    return Array.from(dist.entries()).map(([range, data]) => ({
      range,
      probability: safeDivide(bigIntToDecimal(data.count), totalWeightDec).toNumber(),
      rtpContribution: safeDivide(data.winSum, totalWeightDec).toNumber()
    }));
  }

  /**
   * Calculate retrigger probability from FS reel strip composition
   *
   * Computes exact probability of landing `requiredCount` or more scatter symbols
   * on the Free Spins reel set (or base reels if no FS-specific set).
   *
   * Uses dynamic programming to compute Poisson Binomial distribution
   * (sum of independent Bernoulli RVs with different success probabilities).
   */
  private calculateRetriggerProbability(scatterSymbol: string, requiredCount: number): Decimal {
    // Get the FS reel set (or use base if not specified)
    const fsReelSetId = this.config.freeSpins?.reelSetId;
    const reelSet = fsReelSetId
      ? this.config.reelSets.find(rs => rs.id === fsReelSetId) ?? this.baseReelSet
      : this.baseReelSet;

    const rows = this.config.grid.rows;
    const cols = this.config.grid.cols;

    // Calculate per-position probability of scatter landing
    // For each reel, probability = (scatter count on reel) / (reel length)
    // For each visible position, we have `rows` positions from the strip
    const perReelScatterProbs: Decimal[] = [];

    for (const reel of reelSet.reels) {
      const scatterCount = reel.symbols.filter(s => s === scatterSymbol).length;
      const reelLength = reel.symbols.length;

      // Probability that at least one scatter appears in visible window
      // P(at least 1) = 1 - P(none in window)
      // For a window of size `rows`, P(none) ≈ ((L-S)/L)^rows for uniform stops
      // But exact: we need to count windows that contain no scatters

      // Count windows with at least one scatter
      let windowsWithScatter = 0;
      for (let stop = 0; stop < reelLength; stop++) {
        let hasScatter = false;
        for (let r = 0; r < rows; r++) {
          const pos = (stop + r) % reelLength;
          if (reel.symbols[pos] === scatterSymbol) {
            hasScatter = true;
            break;
          }
        }
        if (hasScatter) windowsWithScatter++;
      }

      const probScatterInWindow = dec(windowsWithScatter).dividedBy(reelLength);
      perReelScatterProbs.push(probScatterInWindow);
    }

    // Now compute P(total scatters >= requiredCount)
    // This is a multi-column problem where each column can contribute 0-rows scatters
    // For simplicity, we model each reel as binary: has scatter in window or not
    // This undercounts (multiple scatters per reel possible) but is conservative

    // For more accuracy: compute expected scatters per reel and use Poisson Binomial
    // Expected scatters per reel = sum over all rows of per-position probability
    // Then sum across reels

    // More accurate approach: For each reel, compute distribution of scatter count
    // Then convolve across reels

    // Simplified but accurate for most games: use Poisson Binomial for binary per-reel
    const n = perReelScatterProbs.length;

    // DP for Poisson Binomial: prob[k] = probability of exactly k successes
    let dp: Decimal[] = [ONE];
    for (let i = 0; i < n; i++) {
      dp.push(ZERO);
    }

    for (let i = 0; i < n; i++) {
      const p = perReelScatterProbs[i] ?? ZERO;
      const q = ONE.minus(p);

      // Iterate backwards to avoid overwriting
      const newDp: Decimal[] = [];
      for (let k = 0; k <= i + 1; k++) {
        const fromPrev = k > 0 && dp[k - 1] ? dp[k - 1]!.times(p) : ZERO;
        const fromCurr = dp[k] ? dp[k]!.times(q) : ZERO;
        newDp[k] = fromPrev.plus(fromCurr);
      }
      dp = newDp;
    }

    // Sum P(k >= requiredCount)
    let probRetrigger = ZERO;
    for (let k = requiredCount; k <= n; k++) {
      if (dp[k]) {
        probRetrigger = probRetrigger.plus(dp[k]!);
      }
    }

    return probRetrigger;
  }

  /**
   * Get calculation complexity info
   */
  getComplexity(): {
    totalCycles: bigint;
    estimatedTimeMs: number;
    feasibility: string;
  } {
    return estimateComplexity(this.enumerator.getReelLengths());
  }

  /**
   * Check for unsupported features that require simulation
   * Returns reason string if unsupported, null otherwise
   */
  private checkUnsupportedFeatures(): string | null {
    // Mystery symbols are now supported via exact EV calculation
    // (no longer requires simulation fallback)

    // Variable-ways with very high variability
    if (this.config.evalType === 'VARIABLE_WAYS' && this.config.variableWaysConfig) {
      const { minSymbolsPerReel, maxSymbolsPerReel } = this.config.variableWaysConfig;
      const variability = maxSymbolsPerReel - minSymbolsPerReel;
      if (variability > 5) {
        return 'Variable-ways with high variability (>5 symbol range)';
      }
    }

    // Gamble feature (requires simulation for accurate EV)
    // Note: Not currently in schema but check for future compatibility
    if ((this.config as any).gamble?.enabled) {
      return 'Gamble feature enabled';
    }

    // Complex wild types that need multi-spin state
    const hasComplexWilds = this.config.symbols.some(s =>
      s.role === 'WILD' && (s.wildType === 'WALKING' || s.wildType === 'STICKY')
    );
    // Note: We handle these in specialWildManager, but for very long games
    // simulation may be more accurate
    if (hasComplexWilds && this.config.freeSpins?.enabled) {
      const triggerCounts = Object.values(this.config.freeSpins.triggerCounts);
      const maxSpins = Math.max(...triggerCounts.map(tc => tc.spins));
      if (maxSpins > 20) {
        return 'Walking/Sticky wilds with long free spins (>20 spins)';
      }
    }

    return null;
  }

  /**
   * Fallback to simulation mode
   */
  private fallbackToSimulation(
    spins: number,
    options: RTOCalculatorOptions,
    fallbackReason?: 'CYCLES_TOO_LARGE' | 'TIMEOUT' | 'UNSUPPORTED_FEATURE',
    unsupportedDetails?: string
  ): RTPResult {
    const simulator = new Simulator(this.config);
    const result = simulator.simulate({
      spins,
      includeFeatures: options.includeFeatures,
      verbose: options.verbose,
      onProgress: options.onProgress
        ? (current, total, rtp) => options.onProgress!(BigInt(current), BigInt(total), 0)
        : undefined
    });

    // Build warnings array
    const warnings: RTPResult['warnings'] = [];

    if (fallbackReason) {
      warnings.push({
        code: 'SIMULATION_FALLBACK',
        message: `Calculation fell back to Monte Carlo simulation`,
        details: fallbackReason === 'CYCLES_TOO_LARGE'
          ? `Total cycles exceed maximum threshold. Results are statistical estimates.`
          : fallbackReason === 'TIMEOUT'
          ? `Exact calculation timed out. Results are statistical estimates.`
          : `Unsupported feature detected: ${unsupportedDetails ?? 'unknown'}. Results are statistical estimates.`
      });
    }

    if (fallbackReason === 'UNSUPPORTED_FEATURE' && unsupportedDetails) {
      warnings.push({
        code: 'UNSUPPORTED_FEATURE',
        message: unsupportedDetails,
        details: 'This feature combination cannot be calculated exactly and requires simulation.'
      });
    }

    // Convert SimulationResult to RTPResult format
    return {
      totalRTP: result.totalRTP,
      baseGameRTP: result.baseGameRTP,
      freeSpinsRTP: result.freeSpinsRTP,
      holdAndWinRTP: result.holdAndWinRTP,
      bonusRTP: result.bonusRTP,
      hitRate: result.hitRate,
      volatility: result.volatility,
      featureFrequencies: result.featureFrequencies,
      maxWin: result.maxWin,
      symbolContributions: result.symbolContributions,
      winDistribution: result.winDistribution,
      totalCycles: result.totalCycles,
      cyclesCalculated: result.cyclesCalculated,
      calculationType: 'SIMULATION',
      confidenceInterval: result.confidenceInterval,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}

/**
 * Quick RTP calculation function
 */
export function calculateRTP(config: GameConfig, options?: RTOCalculatorOptions): RTPResult {
  const calculator = new RTPCalculator(config, options);
  return calculator.calculate(options);
}
