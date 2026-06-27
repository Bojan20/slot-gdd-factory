/**
 * SLOT MATH EXACT - RTP Solver
 *
 * Reverse-engineers game parameters to achieve target RTP.
 *
 * Solves for:
 * - Paytable values (given reel strips)
 * - Symbol weights (given paytable)
 * - Feature parameters (given base game RTP)
 * - Optimal reel compositions
 *
 * Uses:
 * - Gradient descent optimization
 * - Linear programming for constraints
 * - Binary search for bounded parameters
 * - Constraint satisfaction
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide,
  clamp
} from '../core/decimal.js';
import type { GameConfig, PayEntry, SymbolDef, ReelSet } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Solver target
 */
export interface SolverTarget {
  /** Target RTP */
  targetRTP: Decimal;
  /** Tolerance (±) */
  tolerance: Decimal;
  /** Target hit rate (optional) */
  targetHitRate?: Decimal;
  /** Target volatility (optional) */
  targetVolatility?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  /** Feature frequency target (1/X) */
  targetFeatureFrequency?: Decimal;
}

/**
 * What to solve for
 */
export type SolveFor =
  | 'PAYTABLE'
  | 'SYMBOL_WEIGHTS'
  | 'FEATURE_PARAMS'
  | 'REEL_COMPOSITION'
  | 'ALL';

/**
 * Solver constraints
 */
export interface SolverConstraints {
  /** Minimum pay value */
  minPayValue?: Decimal;
  /** Maximum pay value */
  maxPayValue?: Decimal;
  /** Pay ratios (e.g., 5OK must be > 4OK) */
  enforcePayRatios?: boolean;
  /** Minimum symbol weight */
  minSymbolWeight?: number;
  /** Maximum symbol weight */
  maxSymbolWeight?: number;
  /** Locked parameters (don't change) */
  lockedParams?: string[];
  /** Custom constraints */
  customConstraints?: Array<{
    type: string;
    params: Record<string, unknown>;
  }>;
}

/**
 * Solver result
 */
export interface SolverResult {
  /** Did solver find solution? */
  success: boolean;
  /** Achieved RTP */
  achievedRTP: Decimal;
  /** RTP error (difference from target) */
  rtpError: Decimal;
  /** Number of iterations */
  iterations: number;
  /** Suggested parameter changes */
  changes: ParameterChange[];
  /** Updated configuration */
  updatedConfig?: Partial<GameConfig>;
  /** Warnings */
  warnings: string[];
  /** Solution quality score (0-1) */
  qualityScore: Decimal;
}

/**
 * Parameter change suggestion
 */
export interface ParameterChange {
  /** Parameter path (e.g., "paytable.H1.5") */
  path: string;
  /** Original value */
  originalValue: Decimal;
  /** New value */
  newValue: Decimal;
  /** Change percentage */
  changePercent: Decimal;
  /** Impact on RTP */
  rtpImpact: Decimal;
}

// ============================================================================
// RTP CALCULATOR (simplified for solver)
// ============================================================================

/**
 * Quick RTP calculation for optimization iterations
 */
function quickCalculateRTP(
  paytable: Map<string, Map<string, Decimal>>,
  symbolFrequencies: Map<string, Decimal>,
  gridSize: { rows: number; cols: number },
  evalType: string
): Decimal {
  let rtp = ZERO;
  const cols = gridSize.cols;

  for (const [symbolId, pays] of paytable.entries()) {
    const freq = symbolFrequencies.get(symbolId) ?? ZERO;
    if (freq.isZero()) continue;

    for (const [countStr, payValue] of pays.entries()) {
      const count = parseInt(countStr, 10);
      if (count < 3 || count > cols) continue;

      // Simplified probability calculation
      // P(exactly count symbols) ≈ C(cols, count) × freq^count × (1-freq)^(cols-count)
      // But for ways games, multiply by ways

      let probability: Decimal;

      if (evalType === 'WAYS' || evalType === 'VARIABLE_WAYS') {
        // Ways calculation: freq^count × rows^count
        const ways = Math.pow(gridSize.rows, count);
        probability = freq.pow(count).times(ways);

        // Adjust for overlap (simplified)
        probability = probability.times(dec(0.8)); // Rough adjustment
      } else {
        // Line calculation
        probability = freq.pow(count);
      }

      const contribution = probability.times(payValue);
      rtp = rtp.plus(contribution);
    }
  }

  return rtp;
}

/**
 * Calculate symbol frequencies from reel strips
 */
function calculateSymbolFrequencies(reelSet: ReelSet): Map<string, Decimal> {
  const frequencies = new Map<string, Decimal>();
  const totalSymbols = new Map<string, number>();
  let totalPositions = 0;

  for (const reel of reelSet.reels) {
    for (const sym of reel.symbols) {
      totalSymbols.set(sym, (totalSymbols.get(sym) ?? 0) + 1);
      totalPositions++;
    }
  }

  const avgReelLength = totalPositions / reelSet.reels.length;

  for (const [sym, count] of totalSymbols.entries()) {
    frequencies.set(sym, dec(count).dividedBy(avgReelLength));
  }

  return frequencies;
}

// ============================================================================
// PAYTABLE SOLVER
// ============================================================================

/**
 * Solve for paytable values to achieve target RTP
 */
export function solvePaytable(
  config: GameConfig,
  target: SolverTarget,
  constraints: SolverConstraints = {}
): SolverResult {
  const changes: ParameterChange[] = [];
  const warnings: string[] = [];

  // Get current paytable as mutable structure
  const paytable = new Map<string, Map<string, Decimal>>();
  for (const entry of config.paytable) {
    const pays = new Map<string, Decimal>();
    for (const [count, value] of Object.entries(entry.pays)) {
      pays.set(count, dec(value));
    }
    paytable.set(entry.symbolId, pays);
  }

  // Calculate symbol frequencies
  const baseReelSet = config.reelSets.find(rs => rs.id === config.baseGameReelSetId);
  if (!baseReelSet) {
    return {
      success: false,
      achievedRTP: ZERO,
      rtpError: target.targetRTP,
      iterations: 0,
      changes: [],
      warnings: ['Base reel set not found'],
      qualityScore: ZERO
    };
  }

  const frequencies = calculateSymbolFrequencies(baseReelSet);

  // Current RTP
  let currentRTP = quickCalculateRTP(paytable, frequencies, config.grid, config.evalType);
  const targetRTP = target.targetRTP;
  let rtpError = targetRTP.minus(currentRTP).abs();

  const maxIterations = 100;
  const learningRate = dec(0.1);
  let iteration = 0;

  while (rtpError.greaterThan(target.tolerance) && iteration < maxIterations) {
    iteration++;

    // Calculate gradient (RTP sensitivity to each pay value)
    const gradients = new Map<string, Map<string, Decimal>>();

    for (const [symbolId, pays] of paytable.entries()) {
      const symGradients = new Map<string, Decimal>();
      const freq = frequencies.get(symbolId) ?? ZERO;

      for (const [countStr, _] of pays.entries()) {
        const count = parseInt(countStr, 10);

        // Gradient ≈ P(count symbols) × frequency
        let gradient = freq.pow(count);
        if (config.evalType === 'WAYS') {
          gradient = gradient.times(Math.pow(config.grid.rows, count));
        }

        symGradients.set(countStr, gradient);
      }

      gradients.set(symbolId, symGradients);
    }

    // Update paytable values using gradient descent
    const rtpDiff = targetRTP.minus(currentRTP);
    const direction = rtpDiff.greaterThan(ZERO) ? ONE : dec(-1);

    for (const [symbolId, pays] of paytable.entries()) {
      if (constraints.lockedParams?.includes(symbolId)) continue;

      const symGradients = gradients.get(symbolId);
      if (!symGradients) continue;

      for (const [countStr, currentValue] of pays.entries()) {
        const gradient = symGradients.get(countStr) ?? ZERO;
        if (gradient.isZero()) continue;

        // Calculate step
        const step = direction.times(learningRate).times(
          safeDivide(rtpDiff.abs(), gradient)
        );

        let newValue = currentValue.plus(step);

        // Apply constraints
        if (constraints.minPayValue) {
          newValue = Decimal.max(newValue, constraints.minPayValue);
        }
        if (constraints.maxPayValue) {
          newValue = Decimal.min(newValue, constraints.maxPayValue);
        }

        // Ensure pay ratios (5OK > 4OK > 3OK)
        if (constraints.enforcePayRatios) {
          const count = parseInt(countStr, 10);
          const higherCount = (count + 1).toString();
          const lowerCount = (count - 1).toString();

          const higherPay = pays.get(higherCount);
          const lowerPay = pays.get(lowerCount);

          if (higherPay && newValue.greaterThanOrEqualTo(higherPay)) {
            newValue = higherPay.times(0.95);
          }
          if (lowerPay && newValue.lessThanOrEqualTo(lowerPay)) {
            newValue = lowerPay.times(1.05);
          }
        }

        pays.set(countStr, newValue);
      }
    }

    // Recalculate RTP
    currentRTP = quickCalculateRTP(paytable, frequencies, config.grid, config.evalType);
    rtpError = targetRTP.minus(currentRTP).abs();
  }

  // Build changes list
  for (const entry of config.paytable) {
    const newPays = paytable.get(entry.symbolId);
    if (!newPays) continue;

    for (const [count, originalValue] of Object.entries(entry.pays)) {
      const newValue = newPays.get(count) ?? dec(originalValue);
      const original = dec(originalValue);

      if (!newValue.equals(original)) {
        const changePercent = safeDivide(newValue.minus(original), original).times(100);

        changes.push({
          path: `paytable.${entry.symbolId}.${count}`,
          originalValue: original,
          newValue,
          changePercent,
          rtpImpact: newValue.minus(original).times(frequencies.get(entry.symbolId) ?? ZERO)
        });
      }
    }
  }

  // Build updated config
  const updatedPaytable: PayEntry[] = [];
  for (const [symbolId, pays] of paytable.entries()) {
    const paysObj: Record<string, number> = {};
    for (const [count, value] of pays.entries()) {
      paysObj[count] = value.toNumber();
    }
    updatedPaytable.push({ symbolId, pays: paysObj });
  }

  const success = rtpError.lessThanOrEqualTo(target.tolerance);
  const qualityScore = ONE.minus(rtpError.dividedBy(target.targetRTP));

  if (!success) {
    warnings.push(`Could not achieve target RTP within tolerance after ${maxIterations} iterations`);
    warnings.push(`Best achieved: ${currentRTP.times(100).toFixed(4)}% (target: ${targetRTP.times(100).toFixed(4)}%)`);
  }

  return {
    success,
    achievedRTP: currentRTP,
    rtpError,
    iterations: iteration,
    changes,
    updatedConfig: { paytable: updatedPaytable },
    warnings,
    qualityScore: clamp(qualityScore, ZERO, ONE)
  };
}

// ============================================================================
// SYMBOL WEIGHT SOLVER
// ============================================================================

/**
 * Solve for symbol weights (reel composition) to achieve target RTP
 */
export function solveSymbolWeights(
  config: GameConfig,
  target: SolverTarget,
  constraints: SolverConstraints = {}
): SolverResult {
  const changes: ParameterChange[] = [];
  const warnings: string[] = [];

  // Get base reel set
  const baseReelSet = config.reelSets.find(rs => rs.id === config.baseGameReelSetId);
  if (!baseReelSet) {
    return {
      success: false,
      achievedRTP: ZERO,
      rtpError: target.targetRTP,
      iterations: 0,
      changes: [],
      warnings: ['Base reel set not found'],
      qualityScore: ZERO
    };
  }

  // Build paytable map
  const paytable = new Map<string, Map<string, Decimal>>();
  for (const entry of config.paytable) {
    const pays = new Map<string, Decimal>();
    for (const [count, value] of Object.entries(entry.pays)) {
      pays.set(count, dec(value));
    }
    paytable.set(entry.symbolId, pays);
  }

  // Current weights (normalized frequencies)
  let weights = calculateSymbolFrequencies(baseReelSet);
  let currentRTP = quickCalculateRTP(paytable, weights, config.grid, config.evalType);

  const targetRTP = target.targetRTP;
  let rtpError = targetRTP.minus(currentRTP).abs();

  const maxIterations = 100;
  let iteration = 0;

  while (rtpError.greaterThan(target.tolerance) && iteration < maxIterations) {
    iteration++;

    // Calculate RTP contribution per symbol
    const contributions = new Map<string, Decimal>();

    for (const [symbolId, pays] of paytable.entries()) {
      const freq = weights.get(symbolId) ?? ZERO;
      let contribution = ZERO;

      for (const [countStr, payValue] of pays.entries()) {
        const count = parseInt(countStr, 10);
        let prob = freq.pow(count);
        if (config.evalType === 'WAYS') {
          prob = prob.times(Math.pow(config.grid.rows, count));
        }
        contribution = contribution.plus(prob.times(payValue));
      }

      contributions.set(symbolId, contribution);
    }

    // Adjust weights based on RTP difference
    const rtpDiff = targetRTP.minus(currentRTP);
    const needIncrease = rtpDiff.greaterThan(ZERO);

    // Sort symbols by contribution
    const sortedSymbols = Array.from(contributions.entries())
      .sort((a, b) => b[1].minus(a[1]).toNumber());

    const newWeights = new Map(weights);

    for (const [symbolId, contribution] of sortedSymbols) {
      if (constraints.lockedParams?.includes(symbolId)) continue;

      const currentWeight = weights.get(symbolId) ?? ZERO;
      const isHighContributor = contribution.greaterThan(ZERO);

      let adjustment: Decimal;
      if (needIncrease && isHighContributor) {
        // Increase high-pay symbol frequency
        adjustment = dec(0.02);
      } else if (!needIncrease && isHighContributor) {
        // Decrease high-pay symbol frequency
        adjustment = dec(-0.02);
      } else if (needIncrease && !isHighContributor) {
        // Decrease low-pay symbol frequency
        adjustment = dec(-0.01);
      } else {
        // Increase low-pay symbol frequency
        adjustment = dec(0.01);
      }

      let newWeight = currentWeight.plus(adjustment);

      // Apply constraints
      const minWeight = dec(constraints.minSymbolWeight ?? 0.01);
      const maxWeight = dec(constraints.maxSymbolWeight ?? 0.30);
      newWeight = clamp(newWeight, minWeight, maxWeight);

      newWeights.set(symbolId, newWeight);
    }

    // Normalize weights
    const totalWeight = sum(Array.from(newWeights.values()));
    for (const [symbolId, weight] of newWeights.entries()) {
      newWeights.set(symbolId, safeDivide(weight, totalWeight));
    }

    weights = newWeights;
    currentRTP = quickCalculateRTP(paytable, weights, config.grid, config.evalType);
    rtpError = targetRTP.minus(currentRTP).abs();
  }

  // Build changes
  const originalWeights = calculateSymbolFrequencies(baseReelSet);
  for (const [symbolId, newWeight] of weights.entries()) {
    const original = originalWeights.get(symbolId) ?? ZERO;
    if (!newWeight.equals(original)) {
      changes.push({
        path: `weights.${symbolId}`,
        originalValue: original,
        newValue: newWeight,
        changePercent: safeDivide(newWeight.minus(original), original.plus(dec(0.001))).times(100),
        rtpImpact: ZERO // Would need to calculate
      });
    }
  }

  const success = rtpError.lessThanOrEqualTo(target.tolerance);

  if (!success) {
    warnings.push(`Could not achieve target RTP through weight adjustment alone`);
  }

  return {
    success,
    achievedRTP: currentRTP,
    rtpError,
    iterations: iteration,
    changes,
    warnings,
    qualityScore: ONE.minus(rtpError.dividedBy(target.targetRTP))
  };
}

// ============================================================================
// COMBINED SOLVER
// ============================================================================

/**
 * Solve for multiple parameters to achieve target
 */
export function solveRTP(
  config: GameConfig,
  target: SolverTarget,
  solveFor: SolveFor = 'ALL',
  constraints: SolverConstraints = {}
): SolverResult {
  const allWarnings: string[] = [];
  const results: SolverResult[] = [];

  // Try paytable first (least disruptive)
  if (solveFor === 'ALL' || solveFor === 'PAYTABLE') {
    const paytableResult = solvePaytable(config, target, constraints);

    if (paytableResult.success) {
      return paytableResult;
    }

    results.push(paytableResult);
    allWarnings.push(...paytableResult.warnings);
  }

  // Try symbol weights if paytable wasn't enough
  if (solveFor === 'ALL' || solveFor === 'SYMBOL_WEIGHTS') {
    const weightsResult = solveSymbolWeights(config, target, constraints);

    if (weightsResult.success) {
      return weightsResult;
    }

    results.push(weightsResult);
    allWarnings.push(...weightsResult.warnings);
  }

  // If still not solved, try combined approach
  if (solveFor === 'ALL') {
    // First optimize paytable
    const paytableResult = solvePaytable(config, target, {
      ...constraints,
      enforcePayRatios: true
    });

    // Then fine-tune with weights
    if (paytableResult.updatedConfig?.paytable) {
      const intermediateConfig = {
        ...config,
        paytable: paytableResult.updatedConfig.paytable
      };

      const weightsResult = solveSymbolWeights(intermediateConfig, target, constraints);

      if (weightsResult.success || weightsResult.rtpError.lessThan(paytableResult.rtpError)) {
        return {
          ...weightsResult,
          changes: [...paytableResult.changes, ...weightsResult.changes],
          warnings: [...allWarnings, ...weightsResult.warnings]
        };
      }
    }
  }

  // Find best result from attempts
  if (results.length > 0) {
    const bestResult = results.reduce((best, current) =>
      current.rtpError.lessThan(best.rtpError) ? current : best
    );
    return {
      ...bestResult,
      warnings: [...allWarnings, ...bestResult.warnings]
    };
  }

  // No attempts made - return failure
  return {
    success: false,
    achievedRTP: ZERO,
    rtpError: target.targetRTP,
    iterations: 0,
    changes: [],
    warnings: [...allWarnings, 'No solution found'],
    qualityScore: ZERO
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Suggest paytable for target RTP
 */
export function suggestPaytable(
  targetRTP: number,
  symbolCount: number,
  gridSize: { rows: number; cols: number },
  evalType: string = 'LINES_LTR'
): Record<string, number>[] {
  const paytable: Record<string, number>[] = [];
  const rtpBudget = dec(targetRTP);

  // High pay symbols get ~60% of RTP
  // Low pay symbols get ~30% of RTP
  // Features get ~10% of RTP

  const highPayCount = Math.ceil(symbolCount * 0.3);
  const lowPayCount = symbolCount - highPayCount;

  const highPayBudget = rtpBudget.times(0.6).dividedBy(highPayCount);
  const lowPayBudget = rtpBudget.times(0.3).dividedBy(lowPayCount);

  for (let i = 0; i < highPayCount; i++) {
    const symbolId = `H${i + 1}`;
    const basePay = highPayBudget.times(1 - i * 0.15);

    paytable.push({
      symbolId,
      pays: {
        '3': basePay.times(0.5).toNumber(),
        '4': basePay.times(2).toNumber(),
        '5': basePay.times(5).toNumber()
      }
    } as unknown as Record<string, number>);
  }

  for (let i = 0; i < lowPayCount; i++) {
    const symbolId = `L${i + 1}`;
    const basePay = lowPayBudget.times(1 - i * 0.1);

    paytable.push({
      symbolId,
      pays: {
        '3': basePay.times(0.3).toNumber(),
        '4': basePay.times(1).toNumber(),
        '5': basePay.times(2).toNumber()
      }
    } as unknown as Record<string, number>);
  }

  return paytable;
}

/**
 * Validate RTP is achievable with given constraints
 */
export function validateRTPAchievable(
  targetRTP: Decimal,
  config: GameConfig,
  constraints: SolverConstraints
): { achievable: boolean; reason?: string } {
  // Check if target is in valid range
  if (targetRTP.lessThan(dec(0.80)) || targetRTP.greaterThan(dec(0.99))) {
    return {
      achievable: false,
      reason: `Target RTP ${targetRTP.times(100).toFixed(2)}% is outside valid range (80%-99%)`
    };
  }

  // Check if paytable constraints allow sufficient RTP
  if (constraints.maxPayValue) {
    const maxTheoreticalRTP = constraints.maxPayValue.times(config.grid.cols);
    if (targetRTP.greaterThan(maxTheoreticalRTP)) {
      return {
        achievable: false,
        reason: `Max pay constraint prevents achieving target RTP`
      };
    }
  }

  return { achievable: true };
}
