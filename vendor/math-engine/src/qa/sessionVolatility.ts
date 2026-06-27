/**
 * SLOT MATH EXACT - Session Volatility Metrics
 *
 * Calculates player session-level volatility metrics.
 * Important for:
 * - Responsible gambling compliance
 * - Session duration analysis
 * - Bankroll requirements
 * - Player experience modeling
 *
 * Metrics include:
 * - Expected session duration (time/spins to ruin)
 * - Balance variance over session
 * - Risk of Ruin calculations
 * - VaR (Value at Risk) for sessions
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  sum,
  safeDivide
} from '../core/decimal.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Initial bankroll (in bet units) */
  initialBankroll: Decimal;
  /** Bet size per spin (always 1 for normalized calculations) */
  betSize?: Decimal;
  /** Target win (optional - for win goal scenarios) */
  targetWin?: Decimal;
  /** Maximum spins (optional - for time-limited sessions) */
  maxSpins?: number;
  /** RTP of the game */
  rtp: Decimal;
  /** Variance (σ²) of single spin */
  variance: Decimal;
  /** Standard deviation of single spin */
  standardDeviation: Decimal;
}

/**
 * Session volatility result
 */
export interface SessionVolatilityResult {
  /** Expected number of spins to ruin (bankroll = 0) */
  expectedSpinsToRuin: Decimal;
  /** Risk of Ruin probability */
  riskOfRuin: Decimal;
  /** Risk of Ruin with win goal */
  riskOfRuinWithGoal?: Decimal;
  /** Expected value over session */
  expectedSessionValue: Decimal;
  /** Standard deviation of session outcome */
  sessionStandardDeviation: Decimal;
  /** Value at Risk (5%, 1%, 0.1% worst cases) */
  valueAtRisk: {
    var95: Decimal;  // 5% worst case
    var99: Decimal;  // 1% worst case
    var999: Decimal; // 0.1% worst case
  };
  /** Probability of doubling bankroll */
  probabilityOfDoubling: Decimal;
  /** Expected peak bankroll */
  expectedPeakBankroll: Decimal;
  /** Expected low point */
  expectedLowPoint: Decimal;
  /** Coefficient of variation for session */
  sessionCV: Decimal;
}

/**
 * Bankroll simulation result
 */
export interface BankrollSimulation {
  /** Median final bankroll */
  medianFinalBankroll: Decimal;
  /** Mean final bankroll */
  meanFinalBankroll: Decimal;
  /** Percentile distribution */
  percentiles: {
    p5: Decimal;
    p10: Decimal;
    p25: Decimal;
    p50: Decimal;
    p75: Decimal;
    p90: Decimal;
    p95: Decimal;
  };
  /** Ruin rate (ended at 0) */
  ruinRate: Decimal;
  /** Win rate (ended above start) */
  winRate: Decimal;
  /** Big win rate (ended 2x+ start) */
  bigWinRate: Decimal;
}

// ============================================================================
// SESSION VOLATILITY CALCULATOR
// ============================================================================

/**
 * Calculate session volatility metrics
 */
export function calculateSessionVolatility(config: SessionConfig): SessionVolatilityResult {
  const {
    initialBankroll,
    betSize = ONE,
    targetWin,
    rtp,
    variance,
    standardDeviation
  } = config;

  // Normalize to bet units
  const bankrollUnits = safeDivide(initialBankroll, betSize);
  const targetUnits = targetWin ? safeDivide(targetWin, betSize) : undefined;

  // House edge (expected loss per bet)
  const houseEdge = ONE.minus(rtp);

  // Expected spins to ruin using gambler's ruin formula
  // For negative expected value games:
  // E[T] = bankroll / (house_edge) when variance is considered
  // More accurate: E[T] ≈ B / μ where μ = 1 - RTP
  const expectedSpinsToRuin = houseEdge.greaterThan(ZERO)
    ? safeDivide(bankrollUnits, houseEdge)
    : dec(Infinity);

  // Risk of Ruin using exponential approximation
  // RoR ≈ exp(-2 * μ * B / σ²) for random walk with drift
  const riskOfRuin = calculateRiskOfRuin(bankrollUnits, houseEdge, variance);

  // Risk of Ruin with win goal
  const riskOfRuinWithGoal = targetUnits
    ? calculateRiskOfRuinWithGoal(bankrollUnits, targetUnits, houseEdge, variance)
    : undefined;

  // Expected session value (after N spins)
  // E[X_N] = N × (RTP - 1) = -N × houseEdge
  // Using expected spins to ruin as session length
  const sessionSpins = expectedSpinsToRuin.lessThan(dec(10000))
    ? expectedSpinsToRuin
    : dec(1000); // Cap for reasonable calculations

  const expectedSessionValue = sessionSpins.times(rtp.minus(ONE));

  // Session standard deviation: σ_session = σ_spin × √N
  const sessionStandardDeviation = standardDeviation.times(sessionSpins.sqrt());

  // Value at Risk calculations
  const valueAtRisk = calculateVaR(
    expectedSessionValue,
    sessionStandardDeviation
  );

  // Probability of doubling (reaching 2 × initial)
  const probabilityOfDoubling = calculateDoublingProbability(
    bankrollUnits,
    houseEdge,
    variance
  );

  // Expected peak and low using reflection principle
  const { peak, low } = calculateExpectedExtremes(
    bankrollUnits,
    sessionSpins,
    rtp,
    standardDeviation
  );

  // Session CV
  const sessionCV = expectedSessionValue.abs().greaterThan(dec(0.001))
    ? safeDivide(sessionStandardDeviation, expectedSessionValue.abs())
    : ZERO;

  return {
    expectedSpinsToRuin,
    riskOfRuin,
    riskOfRuinWithGoal,
    expectedSessionValue,
    sessionStandardDeviation,
    valueAtRisk,
    probabilityOfDoubling,
    expectedPeakBankroll: peak,
    expectedLowPoint: low,
    sessionCV
  };
}

/**
 * Calculate Risk of Ruin
 *
 * Uses the classical gambler's ruin formula adjusted for slot machines.
 * For negative EV games with variance σ²:
 * RoR = ((σ² + μ) / (σ² - μ))^(B/σ²) when μ < 0
 */
function calculateRiskOfRuin(
  bankroll: Decimal,
  houseEdge: Decimal,
  variance: Decimal
): Decimal {
  if (houseEdge.lessThanOrEqualTo(ZERO)) {
    // Fair or player-favorable game - use limit formula
    return dec(1).dividedBy(bankroll.plus(1));
  }

  if (variance.lessThanOrEqualTo(ZERO)) {
    // Degenerate case - certain ruin
    return ONE;
  }

  // Exponential approximation for RoR
  // RoR ≈ exp(-2 × houseEdge × bankroll / variance)
  const exponent = dec(-2).times(houseEdge).times(bankroll).dividedBy(variance);

  // Cap exponent to avoid numerical issues
  if (exponent.lessThan(dec(-50))) {
    return ZERO; // Effectively zero
  }

  if (exponent.greaterThan(dec(0))) {
    return ONE; // Certain ruin
  }

  return dec(Math.exp(exponent.toNumber()));
}

/**
 * Calculate Risk of Ruin with a win goal
 *
 * Probability of losing all bankroll before reaching target.
 */
function calculateRiskOfRuinWithGoal(
  bankroll: Decimal,
  target: Decimal,
  houseEdge: Decimal,
  variance: Decimal
): Decimal {
  const totalDistance = target.plus(bankroll);

  if (houseEdge.lessThanOrEqualTo(ZERO)) {
    // Fair/favorable game - proportional to distance ratio
    return safeDivide(target, totalDistance);
  }

  // For unfavorable games, use gambler's ruin with barriers
  const q = dec(Math.exp((-2 * houseEdge.toNumber()) / variance.toNumber()));
  const qB = q.pow(bankroll.toNumber());
  const qTotal = q.pow(totalDistance.toNumber());

  if (qTotal.equals(ONE)) {
    // Degenerate case
    return safeDivide(target, totalDistance);
  }

  return safeDivide(qB.minus(qTotal), ONE.minus(qTotal));
}

/**
 * Calculate Value at Risk
 *
 * VaR represents the worst-case loss at a given confidence level.
 */
function calculateVaR(
  expectedValue: Decimal,
  standardDeviation: Decimal
): {
  var95: Decimal;
  var99: Decimal;
  var999: Decimal;
} {
  // Z-scores for percentiles
  const z95 = 1.645;   // 5th percentile
  const z99 = 2.326;   // 1st percentile
  const z999 = 3.090;  // 0.1st percentile

  return {
    var95: expectedValue.minus(standardDeviation.times(z95)),
    var99: expectedValue.minus(standardDeviation.times(z99)),
    var999: expectedValue.minus(standardDeviation.times(z999))
  };
}

/**
 * Calculate probability of doubling bankroll
 */
function calculateDoublingProbability(
  bankroll: Decimal,
  houseEdge: Decimal,
  variance: Decimal
): Decimal {
  // This is equivalent to RoR with goal = bankroll
  // P(double) = 1 - P(ruin before double)
  const rorWithGoal = calculateRiskOfRuinWithGoal(
    bankroll,
    bankroll,  // Target = bankroll (to double)
    houseEdge,
    variance
  );

  return ONE.minus(rorWithGoal);
}

/**
 * Calculate expected extreme values during session
 */
function calculateExpectedExtremes(
  bankroll: Decimal,
  spins: Decimal,
  rtp: Decimal,
  stdDev: Decimal
): { peak: Decimal; low: Decimal } {
  const n = spins.toNumber();
  const sigma = stdDev.toNumber();
  const drift = (rtp.toNumber() - 1);

  // Expected maximum using reflection principle
  // E[max] ≈ μn + σ√(2n/π) for random walk with drift
  const expectedDrift = drift * n;
  const volatilityContribution = sigma * Math.sqrt(2 * n / Math.PI);

  // Peak: bankroll + upside
  const peak = bankroll.plus(dec(Math.max(0, expectedDrift + volatilityContribution)));

  // Low: bankroll - downside (bounded by 0)
  const lowValue = bankroll.toNumber() + expectedDrift - volatilityContribution;
  const low = dec(Math.max(0, lowValue));

  return { peak, low };
}

// ============================================================================
// SESSION LENGTH ANALYSIS
// ============================================================================

/**
 * Session length result
 */
export interface SessionLengthAnalysis {
  /** Expected spins at given loss limit */
  expectedSpins: Decimal;
  /** Median spins */
  medianSpins: Decimal;
  /** 90th percentile spins (10% last longer) */
  spins90thPercentile: Decimal;
  /** 95th percentile spins */
  spins95thPercentile: Decimal;
  /** Distribution of session lengths */
  lengthDistribution: Array<{
    spins: number;
    probability: Decimal;
    cumulativeProbability: Decimal;
  }>;
}

/**
 * Calculate session length distribution
 */
export function calculateSessionLength(
  config: SessionConfig,
  lossLimit: Decimal
): SessionLengthAnalysis {
  const { rtp, variance, standardDeviation } = config;
  const houseEdge = ONE.minus(rtp);

  // Expected spins to lose lossLimit
  const expectedSpins = houseEdge.greaterThan(ZERO)
    ? safeDivide(lossLimit, houseEdge)
    : dec(Infinity);

  // Session length follows a heavy-tailed distribution
  // Approximate median as 0.7 × expected (typical for gambler's ruin)
  const medianSpins = expectedSpins.times(0.7);

  // Percentiles using log-normal approximation
  const sigma = Math.log(2); // Approximate log-std for session lengths
  const mu = Math.log(expectedSpins.toNumber()) - sigma * sigma / 2;

  const spins90thPercentile = dec(Math.exp(mu + sigma * 1.282));
  const spins95thPercentile = dec(Math.exp(mu + sigma * 1.645));

  // Build distribution (discretized)
  const lengthDistribution: SessionLengthAnalysis['lengthDistribution'] = [];
  const spinValues = [10, 25, 50, 100, 200, 500, 1000, 2000, 5000];
  let cumulative = ZERO;

  for (const spins of spinValues) {
    // Approximate CDF using gamma distribution
    const prob = approximateSessionLengthCDF(spins, expectedSpins, variance);
    const marginalProb = prob.minus(cumulative);
    cumulative = prob;

    lengthDistribution.push({
      spins,
      probability: marginalProb,
      cumulativeProbability: cumulative
    });
  }

  return {
    expectedSpins,
    medianSpins,
    spins90thPercentile,
    spins95thPercentile,
    lengthDistribution
  };
}

/**
 * Approximate CDF for session length
 */
function approximateSessionLengthCDF(
  spins: number,
  expectedSpins: Decimal,
  variance: Decimal
): Decimal {
  const mu = expectedSpins.toNumber();

  if (mu <= 0 || !isFinite(mu)) {
    return ZERO;
  }

  // Use gamma distribution approximation
  // Shape k = μ²/σ², Scale θ = σ²/μ
  const k = mu * mu / (variance.toNumber() * mu);
  const theta = (variance.toNumber() * mu) / (mu * mu);

  // Regularized incomplete gamma function approximation
  const x = spins / (k * theta);

  // Simple approximation using normal distribution
  const z = (spins - mu) / Math.sqrt(variance.toNumber() * mu);
  const prob = 0.5 * (1 + erf(z / Math.sqrt(2)));

  return dec(Math.min(1, Math.max(0, prob)));
}

/**
 * Error function approximation
 */
function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

// ============================================================================
// RESPONSIBLE GAMBLING METRICS
// ============================================================================

/**
 * Responsible gambling assessment
 */
export interface ResponsibleGamblingMetrics {
  /** Time to lose X% of bankroll (25%, 50%, 75%, 100%) */
  timeToLose: {
    percent25: Decimal;
    percent50: Decimal;
    percent75: Decimal;
    percent100: Decimal;
  };
  /** Recommended session limits */
  recommendedLimits: {
    maxSpins: number;
    maxTime: string;  // Formatted duration
    lossLimit: Decimal;
  };
  /** Risk classification */
  riskClassification: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  /** Warning indicators */
  warnings: string[];
}

/**
 * Calculate responsible gambling metrics
 */
export function calculateResponsibleGamblingMetrics(
  config: SessionConfig,
  spinDurationSeconds: number = 3
): ResponsibleGamblingMetrics {
  const { initialBankroll, rtp, variance, standardDeviation } = config;
  const houseEdge = ONE.minus(rtp);

  // Time to lose percentages
  const timeToLose = {
    percent25: safeDivide(initialBankroll.times(0.25), houseEdge),
    percent50: safeDivide(initialBankroll.times(0.50), houseEdge),
    percent75: safeDivide(initialBankroll.times(0.75), houseEdge),
    percent100: safeDivide(initialBankroll, houseEdge)
  };

  // Coefficient of variation (volatility measure)
  const cv = safeDivide(standardDeviation, rtp);
  const cvNum = cv.toNumber();

  // Risk classification
  let riskClassification: ResponsibleGamblingMetrics['riskClassification'];
  if (cvNum < 3) {
    riskClassification = 'LOW';
  } else if (cvNum < 6) {
    riskClassification = 'MEDIUM';
  } else if (cvNum < 10) {
    riskClassification = 'HIGH';
  } else {
    riskClassification = 'VERY_HIGH';
  }

  // Recommended limits based on risk
  const baseSpins = {
    'LOW': 500,
    'MEDIUM': 300,
    'HIGH': 200,
    'VERY_HIGH': 100
  }[riskClassification];

  const maxSpins = baseSpins;
  const maxTimeMinutes = Math.round(maxSpins * spinDurationSeconds / 60);
  const lossLimit = initialBankroll.times(0.2); // 20% of bankroll

  // Warnings
  const warnings: string[] = [];

  if (cvNum > 8) {
    warnings.push('High volatility game - expect large swings in balance');
  }

  if (houseEdge.greaterThan(dec(0.05))) {
    warnings.push('House edge above 5% - faster expected loss rate');
  }

  if (timeToLose.percent100.lessThan(dec(100))) {
    warnings.push('Session may be short - consider smaller bet sizes');
  }

  return {
    timeToLose,
    recommendedLimits: {
      maxSpins,
      maxTime: formatDuration(maxTimeMinutes),
      lossLimit
    },
    riskClassification,
    warnings
  };
}

/**
 * Format duration in minutes to human-readable string
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minutes`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  calculateSessionVolatility as session,
  calculateSessionLength as length,
  calculateResponsibleGamblingMetrics as responsibleGambling
};
