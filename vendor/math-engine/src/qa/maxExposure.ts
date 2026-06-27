/**
 * SLOT MATH EXACT - Max Exposure Tracking
 *
 * Calculates and tracks maximum operator exposure (liability).
 * Critical for:
 * - Operator risk management
 * - Progressive jackpot funding
 * - Maximum win cap validation
 * - Reserve requirements
 *
 * Exposure = Maximum possible payout in any single spin/session
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide,
  max as decMax
} from '../core/decimal.js';
import type { GameConfig } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Exposure scenario
 */
export interface ExposureScenario {
  /** Scenario name */
  name: string;
  /** Maximum win multiplier */
  maxMultiplier: Decimal;
  /** Probability of occurrence */
  probability: Decimal;
  /** Expected value contribution */
  evContribution: Decimal;
  /** Components that make up this exposure */
  components: ExposureComponent[];
}

/**
 * Exposure component
 */
export interface ExposureComponent {
  /** Component type */
  type: 'BASE_GAME' | 'FREE_SPINS' | 'MULTIPLIER' | 'JACKPOT' | 'BONUS';
  /** Win amount */
  amount: Decimal;
  /** Description */
  description: string;
}

/**
 * Max exposure result
 */
export interface MaxExposureResult {
  /** Absolute maximum win (theoretical) */
  theoreticalMax: Decimal;
  /** Practical maximum (with probability > threshold) */
  practicalMax: Decimal;
  /** Probability threshold used */
  probabilityThreshold: Decimal;
  /** Per-spin exposure scenarios */
  spinScenarios: ExposureScenario[];
  /** Session exposure (N spins) */
  sessionExposure: SessionExposure;
  /** Reserve requirements */
  reserveRequirements: ReserveRequirements;
  /** Compliance with max win cap */
  maxWinCapCompliance: MaxWinCapCompliance;
}

/**
 * Session exposure
 */
export interface SessionExposure {
  /** Expected max win in N spins */
  expectedMaxWin: Decimal;
  /** 99th percentile max win */
  percentile99MaxWin: Decimal;
  /** 99.9th percentile max win */
  percentile999MaxWin: Decimal;
  /** Number of spins assumed */
  spins: number;
}

/**
 * Reserve requirements
 */
export interface ReserveRequirements {
  /** Minimum reserve per active player */
  perPlayerReserve: Decimal;
  /** Recommended reserve ratio */
  reserveRatio: Decimal;
  /** Reserve for progressive contribution */
  progressiveReserve: Decimal;
  /** Total recommended reserve */
  totalReserve: Decimal;
}

/**
 * Max win cap compliance
 */
export interface MaxWinCapCompliance {
  /** Configured max win cap */
  cap: Decimal;
  /** Theoretical max vs cap */
  theoreticalVsCap: 'UNDER' | 'AT' | 'OVER';
  /** Does game properly enforce cap? */
  capEnforced: boolean;
  /** Unreachable wins due to cap */
  cappedScenarios: number;
  /** RTP impact of cap */
  rtpImpactOfCap: Decimal;
}

/**
 * Exposure tracking configuration
 */
export interface ExposureConfig {
  /** Probability threshold for "practical" max (default: 1e-9) */
  probabilityThreshold?: number;
  /** Session length for session exposure (default: 1000) */
  sessionSpins?: number;
  /** Include progressive jackpots */
  includeProgressives?: boolean;
  /** Progressive jackpot values (if external) */
  progressiveValues?: Map<string, Decimal>;
  /** Active player estimate for reserves */
  estimatedActivePlayers?: number;
}

// ============================================================================
// MAX EXPOSURE CALCULATOR
// ============================================================================

/**
 * Calculate maximum exposure for a game
 */
export function calculateMaxExposure(
  config: GameConfig,
  exposureConfig: ExposureConfig = {}
): MaxExposureResult {
  const {
    probabilityThreshold = 1e-9,
    sessionSpins = 1000,
    includeProgressives = true,
    progressiveValues = new Map(),
    estimatedActivePlayers = 100
  } = exposureConfig;

  // Calculate base game max
  const baseGameMax = calculateBaseGameMax(config);

  // Calculate feature max
  const featureMax = calculateFeatureMax(config);

  // Calculate jackpot exposure
  const jackpotMax = includeProgressives
    ? calculateJackpotMax(config, progressiveValues)
    : ZERO;

  // Build exposure scenarios
  const scenarios = buildExposureScenarios(config, baseGameMax, featureMax, jackpotMax);

  // Theoretical max (sum of all max components)
  const theoreticalMax = applyMaxWinCap(
    baseGameMax.plus(featureMax).plus(jackpotMax),
    config.maxWinMultiplier
  );

  // Practical max (considering probability threshold)
  const practicalMax = calculatePracticalMax(scenarios, dec(probabilityThreshold));

  // Session exposure
  const sessionExposure = calculateSessionExposure(scenarios, sessionSpins);

  // Reserve requirements
  const reserveRequirements = calculateReserveRequirements(
    theoreticalMax,
    practicalMax,
    jackpotMax,
    estimatedActivePlayers
  );

  // Max win cap compliance
  const maxWinCapCompliance = checkMaxWinCapCompliance(
    config,
    scenarios,
    baseGameMax.plus(featureMax).plus(jackpotMax)
  );

  return {
    theoreticalMax,
    practicalMax,
    probabilityThreshold: dec(probabilityThreshold),
    spinScenarios: scenarios,
    sessionExposure,
    reserveRequirements,
    maxWinCapCompliance
  };
}

/**
 * Calculate maximum possible base game win
 */
function calculateBaseGameMax(config: GameConfig): Decimal {
  let maxWin = ZERO;

  // Find highest paying symbol
  for (const payEntry of config.paytable) {
    const pays = Object.values(payEntry.pays);
    const maxPay = Math.max(...pays);
    maxWin = decMax(maxWin, dec(maxPay));
  }

  // For ways games, multiply by number of ways
  if (config.evalType === 'WAYS' || config.evalType === 'ALL_WAYS') {
    const rows = config.grid.rows;
    const cols = config.grid.cols;
    // Maximum ways = rows^cols (e.g., 3^5 = 243)
    const maxWays = Math.pow(rows, cols);
    maxWin = maxWin.times(maxWays);
  }

  // For line games, multiply by number of paylines
  if (config.evalType === 'LINES_LTR' ||
      config.evalType === 'LINES_RTL' ||
      config.evalType === 'LINES_BOTH') {
    const numPaylines = config.paylines?.length ?? 1;
    const multiplier = config.evalType === 'LINES_BOTH' ? 2 : 1;
    maxWin = maxWin.times(numPaylines * multiplier);
  }

  // For cluster games, estimate max cluster size
  if (config.evalType === 'CLUSTER') {
    const gridSize = config.grid.rows * config.grid.cols;
    // Find cluster pay for max size
    for (const payEntry of config.paytable) {
      const maxKey = Object.keys(payEntry.pays)
        .map(Number)
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a)[0];
      if (maxKey) {
        maxWin = decMax(maxWin, dec(payEntry.pays[maxKey.toString()] ?? 0));
      }
    }
  }

  return maxWin;
}

/**
 * Calculate maximum possible feature win
 */
function calculateFeatureMax(config: GameConfig): Decimal {
  let maxWin = ZERO;

  // Free spins max
  if (config.freeSpins?.enabled) {
    const fs = config.freeSpins;

    // Get max initial spins
    const maxTriggerSpins = Math.max(
      ...Object.values(fs.triggerCounts).map(tc => tc.spins)
    );

    // Get max retrigger spins
    const maxRetriggerSpins = fs.retriggerCounts
      ? Math.max(...Object.values(fs.retriggerCounts))
      : maxTriggerSpins;

    // Total spins with max retriggers
    const totalSpins = maxTriggerSpins + (fs.maxRetriggers ?? 5) * maxRetriggerSpins;

    // Max multiplier
    const maxMultiplier = fs.maxMultiplier ?? (
      fs.multiplierIncrements
        ? Math.max(...fs.multiplierIncrements)
        : 1
    );

    // Estimate max FS win (very rough)
    const baseGameMax = calculateBaseGameMax(config);
    maxWin = baseGameMax.times(totalSpins).times(maxMultiplier);
  }

  // Hold & Win max
  if (config.holdAndWin?.enabled) {
    const hw = config.holdAndWin;
    const gridSize = (hw.gridSize?.rows ?? config.grid.rows) *
                     (hw.gridSize?.cols ?? config.grid.cols);

    // Max symbol values
    const maxSymbolValue = Math.max(
      ...Object.values(hw.symbolValues).map(sv => sv.value)
    );

    // Full grid of max value symbols
    const fullGridValue = dec(maxSymbolValue).times(gridSize);

    // Add jackpot if exists
    const grandJackpot = hw.jackpots?.['grand']?.value ?? 0;

    maxWin = decMax(maxWin, fullGridValue.plus(grandJackpot));
  }

  return maxWin;
}

/**
 * Calculate jackpot exposure
 */
function calculateJackpotMax(
  config: GameConfig,
  progressiveValues: Map<string, Decimal>
): Decimal {
  let maxJackpot = ZERO;

  // Check Hold & Win jackpots
  if (config.holdAndWin?.jackpots) {
    for (const [, jackpot] of Object.entries(config.holdAndWin.jackpots)) {
      maxJackpot = decMax(maxJackpot, dec(jackpot.value));
    }
  }

  // Add progressive values
  for (const [, value] of progressiveValues) {
    maxJackpot = decMax(maxJackpot, value);
  }

  return maxJackpot;
}

/**
 * Build exposure scenarios
 */
function buildExposureScenarios(
  config: GameConfig,
  baseGameMax: Decimal,
  featureMax: Decimal,
  jackpotMax: Decimal
): ExposureScenario[] {
  const scenarios: ExposureScenario[] = [];

  // Base game max scenario
  scenarios.push({
    name: 'Base Game Maximum',
    maxMultiplier: applyMaxWinCap(baseGameMax, config.maxWinMultiplier),
    probability: estimateProbability(baseGameMax, config),
    evContribution: ZERO, // Would need full enumeration
    components: [{
      type: 'BASE_GAME',
      amount: baseGameMax,
      description: 'Maximum base game win (full screen of highest symbol)'
    }]
  });

  // Feature max scenario
  if (featureMax.greaterThan(ZERO)) {
    scenarios.push({
      name: 'Feature Maximum',
      maxMultiplier: applyMaxWinCap(featureMax, config.maxWinMultiplier),
      probability: estimateFeatureProbability(config),
      evContribution: ZERO,
      components: [{
        type: 'FREE_SPINS',
        amount: featureMax,
        description: 'Maximum feature win (max spins × max multiplier × max wins)'
      }]
    });
  }

  // Jackpot scenario
  if (jackpotMax.greaterThan(ZERO)) {
    scenarios.push({
      name: 'Jackpot Maximum',
      maxMultiplier: applyMaxWinCap(jackpotMax, config.maxWinMultiplier),
      probability: estimateJackpotProbability(config),
      evContribution: ZERO,
      components: [{
        type: 'JACKPOT',
        amount: jackpotMax,
        description: 'Maximum jackpot win'
      }]
    });
  }

  // Combined max scenario
  const combinedMax = baseGameMax.plus(featureMax).plus(jackpotMax);
  scenarios.push({
    name: 'Theoretical Maximum',
    maxMultiplier: applyMaxWinCap(combinedMax, config.maxWinMultiplier),
    probability: estimateProbability(combinedMax, config).times(dec(1e-10)),
    evContribution: ZERO,
    components: [
      { type: 'BASE_GAME', amount: baseGameMax, description: 'Base game max' },
      { type: 'FREE_SPINS', amount: featureMax, description: 'Feature max' },
      { type: 'JACKPOT', amount: jackpotMax, description: 'Jackpot max' }
    ]
  });

  return scenarios.sort((a, b) =>
    b.maxMultiplier.minus(a.maxMultiplier).toNumber()
  );
}

/**
 * Apply max win cap
 */
function applyMaxWinCap(win: Decimal, cap: number): Decimal {
  return win.greaterThan(dec(cap)) ? dec(cap) : win;
}

/**
 * Estimate probability of achieving a win (rough approximation)
 */
function estimateProbability(win: Decimal, config: GameConfig): Decimal {
  // Very rough: inverse power law
  // P(X > x) ≈ x^(-α) where α ≈ 1.5-2 for slot games
  const alpha = 1.8;
  const prob = Math.pow(win.toNumber(), -alpha);
  return dec(Math.min(1, Math.max(1e-15, prob)));
}

/**
 * Estimate feature trigger probability
 */
function estimateFeatureProbability(config: GameConfig): Decimal {
  // Rough estimate based on typical scatter frequencies
  // 3 scatters ≈ 1/150 spins typical
  if (config.freeSpins?.enabled) {
    return dec(1 / 150);
  }
  if (config.holdAndWin?.enabled) {
    return dec(1 / 200);
  }
  return ZERO;
}

/**
 * Estimate jackpot probability
 */
function estimateJackpotProbability(config: GameConfig): Decimal {
  // Grand jackpot typically 1 in 1M-10M
  if (config.holdAndWin?.jackpots?.['grand']) {
    return dec(1 / 5_000_000);
  }
  return dec(1 / 10_000_000);
}

/**
 * Calculate practical max win above probability threshold
 */
function calculatePracticalMax(
  scenarios: ExposureScenario[],
  threshold: Decimal
): Decimal {
  for (const scenario of scenarios) {
    if (scenario.probability.greaterThan(threshold)) {
      return scenario.maxMultiplier;
    }
  }
  // If no scenario above threshold, return lowest max
  return scenarios[scenarios.length - 1]?.maxMultiplier ?? ZERO;
}

/**
 * Calculate session exposure
 */
function calculateSessionExposure(
  scenarios: ExposureScenario[],
  spins: number
): SessionExposure {
  // Expected max win increases with spins
  // E[max(X_1, ..., X_n)] ≈ μ + σ × √(2 × ln(n))
  const baseMax = scenarios[0]?.maxMultiplier ?? ZERO;
  const factor = Math.sqrt(2 * Math.log(spins));

  return {
    expectedMaxWin: baseMax.times(0.01).times(factor), // Very rough
    percentile99MaxWin: baseMax.times(0.05),
    percentile999MaxWin: baseMax.times(0.1),
    spins
  };
}

/**
 * Calculate reserve requirements
 */
function calculateReserveRequirements(
  theoreticalMax: Decimal,
  practicalMax: Decimal,
  jackpotMax: Decimal,
  activePlayers: number
): ReserveRequirements {
  // Per player: enough to cover 99.9th percentile win
  const perPlayerReserve = practicalMax;

  // Reserve ratio: practical max / theoretical max
  const reserveRatio = safeDivide(practicalMax, theoreticalMax);

  // Progressive reserve: full jackpot value
  const progressiveReserve = jackpotMax;

  // Total: per player × players + progressive
  const totalReserve = perPlayerReserve.times(activePlayers).plus(progressiveReserve);

  return {
    perPlayerReserve,
    reserveRatio,
    progressiveReserve,
    totalReserve
  };
}

/**
 * Check max win cap compliance
 */
function checkMaxWinCapCompliance(
  config: GameConfig,
  scenarios: ExposureScenario[],
  uncappedMax: Decimal
): MaxWinCapCompliance {
  const cap = dec(config.maxWinMultiplier);

  // Compare theoretical vs cap
  let theoreticalVsCap: MaxWinCapCompliance['theoreticalVsCap'];
  if (uncappedMax.lessThan(cap)) {
    theoreticalVsCap = 'UNDER';
  } else if (uncappedMax.equals(cap)) {
    theoreticalVsCap = 'AT';
  } else {
    theoreticalVsCap = 'OVER';
  }

  // Count capped scenarios
  const cappedScenarios = scenarios.filter(s =>
    s.maxMultiplier.equals(cap) && s.components.some(c => c.amount.greaterThan(cap))
  ).length;

  // RTP impact (rough: probability × (uncapped - capped))
  let rtpImpact = ZERO;
  for (const scenario of scenarios) {
    if (uncappedMax.greaterThan(cap)) {
      const diff = uncappedMax.minus(cap);
      rtpImpact = rtpImpact.plus(scenario.probability.times(diff));
    }
  }

  return {
    cap,
    theoreticalVsCap,
    capEnforced: cappedScenarios > 0 || theoreticalVsCap !== 'OVER',
    cappedScenarios,
    rtpImpactOfCap: rtpImpact
  };
}

// ============================================================================
// EXPOSURE MONITORING
// ============================================================================

/**
 * Real-time exposure monitor
 */
export class ExposureMonitor {
  private config: GameConfig;
  private currentExposure: Decimal = ZERO;
  private peakExposure: Decimal = ZERO;
  private exposureHistory: Array<{ timestamp: number; exposure: Decimal }> = [];
  private alertThreshold: Decimal;

  constructor(config: GameConfig, alertThreshold: number = 0.8) {
    this.config = config;
    this.alertThreshold = dec(config.maxWinMultiplier).times(alertThreshold);
  }

  /**
   * Record a win and update exposure
   */
  recordWin(winAmount: Decimal): {
    currentExposure: Decimal;
    peakExposure: Decimal;
    alert: boolean;
    alertMessage?: string;
  } {
    this.currentExposure = this.currentExposure.plus(winAmount);

    if (this.currentExposure.greaterThan(this.peakExposure)) {
      this.peakExposure = this.currentExposure;
    }

    this.exposureHistory.push({
      timestamp: Date.now(),
      exposure: this.currentExposure
    });

    // Check alert
    const alert = this.currentExposure.greaterThan(this.alertThreshold);

    return {
      currentExposure: this.currentExposure,
      peakExposure: this.peakExposure,
      alert,
      alertMessage: alert
        ? `Exposure (${this.currentExposure.toFixed(2)}x) exceeds ${(this.alertThreshold.toNumber() * 100 / this.config.maxWinMultiplier).toFixed(0)}% of max win cap`
        : undefined
    };
  }

  /**
   * Reset exposure (end of spin/session)
   */
  reset(): void {
    this.currentExposure = ZERO;
  }

  /**
   * Get exposure statistics
   */
  getStats(): {
    current: Decimal;
    peak: Decimal;
    average: Decimal;
    alertCount: number;
  } {
    const alertCount = this.exposureHistory.filter(
      h => h.exposure.greaterThan(this.alertThreshold)
    ).length;

    const average = this.exposureHistory.length > 0
      ? sum(this.exposureHistory.map(h => h.exposure)).dividedBy(this.exposureHistory.length)
      : ZERO;

    return {
      current: this.currentExposure,
      peak: this.peakExposure,
      average,
      alertCount
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  calculateMaxExposure as calculate,
  ExposureMonitor as Monitor
};
