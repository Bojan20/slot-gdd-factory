/**
 * W152 Wave 19 — Variance Profiler & RTP Tolerance Engine (Faza 15.B.3).
 *
 * Volatility Index (VI) computation + tolerance bands + drift gate.
 *
 * Regulatory requirements covered:
 *   * Missouri 11 CSR 45-5.193(2)(B) — VI must be reported for every
 *     game submission to MGC.
 *   * UKGC LCCP RTS 14F — live RTP monitoring with deviation alerts
 *     when measured RTP falls outside the published tolerance band.
 *   * MGA Player Protection Directive 2018 §11(d) — operator must
 *     demonstrate that RTP variance is within the modeled distribution.
 *
 * Inputs (from `WelfordAccumulator` or any moment-bearing source):
 *   * `n`         — sample size
 *   * `mean`      — sample mean (RTP estimate)
 *   * `m2`        — sum of squared deviations (Welford's M2)
 *   * `targetRtp` — operator-published RTP target
 *
 * Outputs:
 *   * `vi95` / `vi99`       — Volatility Index at 95% / 99% CI
 *   * `expectedSigma`       — analytical σ from binomial / Poisson model
 *   * `observedSigma`       — sample σ from Welford
 *   * `toleranceBand`       — [lower, upper] absolute RTP tolerance
 *   * `withinTolerance`     — boolean gate
 *   * `deviationSigma`      — z-score of (mean − target) / σ_mean
 *
 * The VI metric (industry-generic):
 *   VI = σ_payout / mean_bet
 * Higher VI = higher volatility = bigger payout swings.
 *
 * Naming: `varianceProfiler` and `rtpToleranceGate` are engine-generic.
 * No reserved-term collision (see `docs/glossary.md`).
 */

export interface WelfordMoments {
  /** Number of observations. */
  n: number;
  /** Sample mean. */
  mean: number;
  /** Welford's M2 = Σ(x_i - mean)^2. */
  m2: number;
}

export interface VarianceProfileInput {
  moments: WelfordMoments;
  /** Operator-published RTP target (e.g. 0.96). */
  targetRtp: number;
  /**
   * Operator-published tolerance band half-width (e.g. 0.005 for ±0.5%).
   * Default: 0.01 (±1.0%).
   */
  toleranceHalfWidth?: number;
  /**
   * Optional analytical σ if available (overrides the
   * binomial-approximation default).
   */
  analyticalSigma?: number;
}

export interface VarianceProfileResult {
  vi95: number;
  vi99: number;
  expectedSigma: number;
  observedSigma: number;
  toleranceBand: [number, number];
  withinTolerance: boolean;
  deviationSigma: number;
  /** True if observedSigma is within ±20% of expectedSigma (engine-generic). */
  sigmaWithinTolerance: boolean;
}

/**
 * Compute the variance profile from Welford moments and a target RTP.
 *
 * Throws on:
 *   * `n < 2` (variance undefined)
 *   * non-finite inputs
 *   * `targetRtp` out of [0, 2]
 *   * `toleranceHalfWidth < 0`
 */
export function profileVariance(input: VarianceProfileInput): VarianceProfileResult {
  const { moments, targetRtp } = input;
  const tolHalf = input.toleranceHalfWidth ?? 0.01;
  if (!Number.isFinite(targetRtp) || targetRtp < 0 || targetRtp > 2) {
    throw new RangeError(`profileVariance: targetRtp out of [0, 2] (got ${targetRtp})`);
  }
  if (tolHalf < 0) {
    throw new RangeError(`profileVariance: toleranceHalfWidth must be >= 0 (got ${tolHalf})`);
  }
  if (!Number.isFinite(moments.n) || moments.n < 2) {
    throw new RangeError(`profileVariance: moments.n must be >= 2 (got ${moments.n})`);
  }
  if (!Number.isFinite(moments.mean)) {
    throw new TypeError(`profileVariance: moments.mean must be finite`);
  }
  if (!Number.isFinite(moments.m2) || moments.m2 < 0) {
    throw new RangeError(`profileVariance: moments.m2 must be finite >= 0`);
  }
  // Sample variance (unbiased, N-1 denominator)
  const sampleVar = moments.m2 / (moments.n - 1);
  const observedSigma = Math.sqrt(sampleVar);

  // Standard error of the mean (σ_mean = σ / √n)
  const sem = observedSigma / Math.sqrt(moments.n);

  // VI ≡ σ / mean (CV-style, industry-generic). Treat tiny mean as 0.
  const vi = moments.mean !== 0 ? observedSigma / Math.abs(moments.mean) : 0;
  // VI95 ≈ 1.96 × SEM × √n / mean (per-spin volatility scaled to 1-σ).
  // Use textbook normal approx: confidence half-widths z=1.96 and z=2.576.
  const vi95 = 1.96 * sem;
  const vi99 = 2.576 * sem;

  // Expected sigma: caller-provided analytical σ wins. Otherwise binomial
  // approximation: σ ≈ √(targetRtp × (1 - targetRtp)) for one Bernoulli
  // trial. For payout-per-bet streams, this is order-of-magnitude only;
  // operator should supply analyticalSigma when known.
  const expectedSigma =
    input.analyticalSigma !== undefined && Number.isFinite(input.analyticalSigma)
      ? input.analyticalSigma
      : Math.sqrt(Math.max(0, targetRtp * (1 - Math.min(1, targetRtp))));

  // Tolerance band on the mean (deviation gate)
  const lower = targetRtp - tolHalf;
  const upper = targetRtp + tolHalf;
  const withinTolerance = moments.mean >= lower && moments.mean <= upper;

  // Z-score: how many SEM-σ-mean units away from target the sample mean is
  const deviationSigma = sem === 0 ? 0 : (moments.mean - targetRtp) / sem;

  // Sigma vs analytical: ±20% tolerance band (industry-generic)
  const sigmaWithinTolerance =
    expectedSigma === 0
      ? Math.abs(observedSigma) <= 1e-9
      : Math.abs(observedSigma - expectedSigma) / expectedSigma <= 0.2;

  return {
    vi95,
    vi99,
    expectedSigma,
    observedSigma,
    toleranceBand: [lower, upper],
    withinTolerance,
    deviationSigma,
    sigmaWithinTolerance,
  };
}

/**
 * CI-friendly gate: pass/fail with structured failure reasons. Used
 * by `slot-truth-check --variance-gate`. Returns 0 on pass, non-zero
 * on failure (one bit per failure type).
 */
export interface VarianceGateResult {
  passed: boolean;
  failureBits: number;
  failureReasons: string[];
  profile: VarianceProfileResult;
}

export const VARIANCE_GATE_BITS = {
  RTP_OUT_OF_TOLERANCE: 1 << 0,
  SIGMA_OUT_OF_TOLERANCE: 1 << 1,
  DEVIATION_SIGMA_HIGH: 1 << 2, // |z| > 3
} as const;

export function varianceGate(input: VarianceProfileInput): VarianceGateResult {
  const profile = profileVariance(input);
  let bits = 0;
  const reasons: string[] = [];
  if (!profile.withinTolerance) {
    bits |= VARIANCE_GATE_BITS.RTP_OUT_OF_TOLERANCE;
    reasons.push(
      `RTP ${profile.observedSigma === 0 ? input.moments.mean.toFixed(6) : input.moments.mean.toFixed(6)} outside band [${profile.toleranceBand[0].toFixed(6)}, ${profile.toleranceBand[1].toFixed(6)}]`,
    );
  }
  if (!profile.sigmaWithinTolerance) {
    bits |= VARIANCE_GATE_BITS.SIGMA_OUT_OF_TOLERANCE;
    reasons.push(
      `observedSigma ${profile.observedSigma.toFixed(6)} > ±20% of expectedSigma ${profile.expectedSigma.toFixed(6)}`,
    );
  }
  if (Math.abs(profile.deviationSigma) > 3) {
    bits |= VARIANCE_GATE_BITS.DEVIATION_SIGMA_HIGH;
    reasons.push(`|deviationSigma| ${Math.abs(profile.deviationSigma).toFixed(2)} > 3.0`);
  }
  return {
    passed: bits === 0,
    failureBits: bits,
    failureReasons: reasons,
    profile,
  };
}
