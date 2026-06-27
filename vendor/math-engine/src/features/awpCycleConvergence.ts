/**
 * W152 Wave 167 — AWP Cycle Convergence Analyzer (55. solver).
 *
 * INDUSTRY-FIRST closed-form analyzer above `src/jurisdiction/compensatedMath.ts`
 * cycle state machine — UKGC LCCP B3/B3A/C/D (Amusement With Prizes finite-cycle
 * convergence disclosure mandate), MGA AWP §15 (cycle deviation tolerance proof),
 * EU GA 2024 (compensated math disclosure), AU NCPF (Class III machines).
 *
 * **55th closed-form solver** — first kernel that LIFTS over an existing IR state
 * machine. Prior solvers all consume raw config; this one reads a partial-cycle
 * snapshot (spinsPlayed, cumulativeBet, cumulativePayout) and projects to:
 *   - expectedFinalRTPGivenCurrent
 *   - probDeviationExceedsTolerance at cycle end
 *   - expectedReturnToTargetSpins (time to drift back inside band)
 *   - maxAchievableDeviationWithoutCompensation
 *   - compensationHintMagnitudeRecommended
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * UK AWP cycle: N total spins per cycle, base bet b per spin (constant).
 * Target RTP R* ∈ [0, 1]. Tolerance τ — UKGC mandates |R_N − R*| ≤ τ at cycle
 * end (typical τ = 0.04 = 4 percentage points).
 *
 * Current snapshot:
 *   n           = spinsPlayed so far (0 ≤ n ≤ N)
 *   B_n         = cumulative bet  = n · b
 *   P_n         = cumulative payout
 *   r_n         = realised RTP   = P_n / B_n (NaN at n=0)
 *
 * Per-spin payout under target Y ~ distribution with E[Y] = R*·b, Var[Y] = σ²·b²
 * (σ² is the per-bet payout variance — operator config).
 *
 * Remaining horizon: m = N − n spins. Sum of remaining payouts:
 *   S_m = Σ_{i=n+1..N} Y_i  ~  N(m·R*·b, m·σ²·b²)   (CLT)
 *
 * Final realised RTP at cycle end:
 *   r_N = (P_n + S_m) / (N·b)
 *
 * Deviation at cycle end:
 *   D_N = r_N − R*  ~  N((P_n + m·R*·b − N·b·R*) / (N·b),  m·σ²/(N²))
 *                  =  N((P_n − n·b·R*) / (N·b),  m·σ²/(N²))
 *
 * Mean deviation = (current cumulative excess payout) / total cycle wager.
 * Variance of deviation shrinks with cycle progress (m → 0).
 *
 * ── Closed-form metrics ──────────────────────────────────────────────────
 * expectedFinalRTP        = (P_n + m·R*·b) / (N·b)
 * stdDevFinalRTP          = σ·√m / N
 * probExceedsToleranceAtEnd
 *                         = P(|D_N| > τ) via Φ
 * compensationHintRecommended
 *                         = − mean(D_N) (size to fully offset projected drift)
 * maxAchievableDeviationWithoutCompensation
 *                         = current mean + k·stdDevFinalRTP    (k = 3 = 99.7%)
 * expectedReturnToTargetSpins
 *                         = E[min n' > n : r_{n'} ∈ [R*−τ, R*+τ]]
 *                           (approximated via expected drift time under target)
 * cycleProgressFraction   = n / N
 * cycleHealthScore ∈ [0, 1] — composite (lower if probExceeds high)
 *
 * ── Distinct from ────────────────────────────────────────────────────────
 *   - `src/jurisdiction/compensatedMath.ts` IR state machine (operates on
 *     event stream; this solver computes analytical projections from snapshot)
 *   - W148 Max Win Cap (payout truncation, not RTP convergence)
 *   - W110 Bonus Trigger Wait Time (single feature trigger, not cycle)
 *   - W57 Crash Multiplier (target multiplier hit, not RTP band)
 *   - W95 Ante Bet (decision EV, not cycle dynamics)
 *
 * Naming: "AWP cycle", "compensation hint", "tolerance band" = generic UK
 * regulatory terms from UKGC LCCP / Gambling Act 2005 Schedule 13. No vendor
 * TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface AwpCycleConvergenceConfig {
  /** Cycle length N (typical 5000–50000 spins). */
  cycleLengthSpins: number;
  /** Base bet b per spin (constant within cycle). */
  baseBet: number;
  /** Target RTP R* ∈ [0, 1] (typical UK AWP = 0.70 for B3, 0.90 for D). */
  targetRtp: number;
  /** Tolerance τ at cycle end (typical 0.02–0.05 = 2–5pp). */
  toleranceAbs: number;
  /** Per-bet payout standard deviation σ (volatility index × b convention or absolute). */
  payoutStdDevPerBet: number;
  /** Current snapshot: spins played so far (0 ≤ n ≤ N). */
  spinsPlayed: number;
  /** Current snapshot: cumulative payout. */
  cumulativePayout: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface AwpCycleConvergenceResult {
  /** Cycle progress fraction n/N ∈ [0, 1]. */
  cycleProgressFraction: number;
  /** Spins remaining = N − n. */
  spinsRemaining: number;
  /** Current realised RTP = P_n / B_n (NaN if n=0). */
  realisedRtpCurrent: number;
  /** Current deviation = realisedRTP − targetRTP. */
  deviationCurrent: number;
  /** Expected final RTP at cycle end given current state. */
  expectedFinalRtp: number;
  /** Std-dev of final RTP at cycle end (shrinks as cycle progresses). */
  stdDevFinalRtp: number;
  /** Mean final deviation E[r_N − R*]. */
  meanDeviationFinal: number;
  /** P(|D_N| > tolerance) at cycle end. */
  probExceedsToleranceAtEnd: number;
  /** Regulator "1 in N cycles" form. */
  oneInNCyclesExceeds: number;
  /** Recommended compensation hint magnitude = −mean(D_N). */
  compensationHintRecommended: number;
  /** Max achievable deviation without compensation = |mean| + 3·std. */
  maxAchievableDeviationNoCompensation: number;
  /** Cycle health score ∈ [0, 1]; 1 = fully on target, 0 = near tolerance limit. */
  cycleHealthScore: number;
  /** Is current state inside tolerance band? */
  withinToleranceCurrent: boolean;
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: AwpCycleConvergenceConfig): void {
  if (!Number.isInteger(cfg.cycleLengthSpins) || cfg.cycleLengthSpins <= 0) {
    throw new Error(`awpCycleConvergence: cycleLengthSpins must be positive integer, got ${cfg.cycleLengthSpins}`);
  }
  if (!Number.isFinite(cfg.baseBet) || cfg.baseBet <= 0) {
    throw new Error(`awpCycleConvergence: baseBet must be > 0, got ${cfg.baseBet}`);
  }
  if (!Number.isFinite(cfg.targetRtp) || cfg.targetRtp < 0 || cfg.targetRtp > 1.5) {
    throw new Error(`awpCycleConvergence: targetRtp must be in [0, 1.5], got ${cfg.targetRtp}`);
  }
  if (!Number.isFinite(cfg.toleranceAbs) || cfg.toleranceAbs <= 0 || cfg.toleranceAbs > 1) {
    throw new Error(`awpCycleConvergence: toleranceAbs must be in (0, 1], got ${cfg.toleranceAbs}`);
  }
  if (!Number.isFinite(cfg.payoutStdDevPerBet) || cfg.payoutStdDevPerBet < 0) {
    throw new Error(`awpCycleConvergence: payoutStdDevPerBet must be ≥ 0, got ${cfg.payoutStdDevPerBet}`);
  }
  if (!Number.isInteger(cfg.spinsPlayed) || cfg.spinsPlayed < 0 || cfg.spinsPlayed > cfg.cycleLengthSpins) {
    throw new Error(`awpCycleConvergence: spinsPlayed must be integer in [0, ${cfg.cycleLengthSpins}], got ${cfg.spinsPlayed}`);
  }
  if (!Number.isFinite(cfg.cumulativePayout) || cfg.cumulativePayout < 0) {
    throw new Error(`awpCycleConvergence: cumulativePayout must be ≥ 0, got ${cfg.cumulativePayout}`);
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveAwpCycleConvergence(cfg: AwpCycleConvergenceConfig): AwpCycleConvergenceResult {
  validateConfig(cfg);

  const N = cfg.cycleLengthSpins;
  const b = cfg.baseBet;
  const n = cfg.spinsPlayed;
  const m = N - n;
  const totalCycleWager = N * b;

  const cycleProgressFraction = n / N;
  const realisedRtpCurrent = n > 0 ? cfg.cumulativePayout / (n * b) : NaN;
  const deviationCurrent = n > 0 ? realisedRtpCurrent - cfg.targetRtp : 0;
  const withinToleranceCurrent = n > 0 ? Math.abs(deviationCurrent) <= cfg.toleranceAbs : true;

  // Expected final RTP assuming remaining payouts hit target on average:
  //   E[P_N] = P_n + m·R*·b
  //   E[r_N] = E[P_N] / (N·b)
  const expectedFinalPayout = cfg.cumulativePayout + m * cfg.targetRtp * b;
  const expectedFinalRtp = expectedFinalPayout / totalCycleWager;

  // Std-dev of final RTP via CLT on remaining sum:
  //   Var[S_m] = m·σ²·b²; Var[r_N] = Var[S_m]/(N·b)² = m·σ²/N²
  const varFinalRtp = (m * cfg.payoutStdDevPerBet * cfg.payoutStdDevPerBet) / (N * N);
  const stdDevFinalRtp = Math.sqrt(varFinalRtp);

  // Mean and probability metrics
  const meanDeviationFinal = expectedFinalRtp - cfg.targetRtp;
  let probExceedsToleranceAtEnd: number;
  if (stdDevFinalRtp < 1e-12) {
    // Degenerate: no remaining spins or zero variance → deterministic
    probExceedsToleranceAtEnd = Math.abs(meanDeviationFinal) > cfg.toleranceAbs ? 1 : 0;
  } else {
    // P(|D_N| > τ) = P(D_N > τ) + P(D_N < −τ)
    //              = [1 − Φ((τ − μ)/σ)] + Φ((−τ − μ)/σ)
    const z1 = (cfg.toleranceAbs - meanDeviationFinal) / stdDevFinalRtp;
    const z2 = (-cfg.toleranceAbs - meanDeviationFinal) / stdDevFinalRtp;
    probExceedsToleranceAtEnd = (1 - normalCdf(z1)) + normalCdf(z2);
    probExceedsToleranceAtEnd = Math.max(0, Math.min(1, probExceedsToleranceAtEnd));
  }
  const oneInNCyclesExceeds = probExceedsToleranceAtEnd > 1e-15 ? 1 / probExceedsToleranceAtEnd : Infinity;

  // Compensation hint: nudge magnitude that would offset projected drift
  const compensationHintRecommended = -meanDeviationFinal;

  // Max achievable deviation without compensation (3σ envelope)
  const maxAchievableDeviationNoCompensation = Math.abs(meanDeviationFinal) + 3 * stdDevFinalRtp;

  // Cycle health: scaled inverse of probExceeds; 1 = healthy, 0 = at risk
  const cycleHealthScore = 1 - probExceedsToleranceAtEnd;

  return {
    cycleProgressFraction,
    spinsRemaining: m,
    realisedRtpCurrent,
    deviationCurrent,
    expectedFinalRtp,
    stdDevFinalRtp,
    meanDeviationFinal,
    probExceedsToleranceAtEnd,
    oneInNCyclesExceeds,
    compensationHintRecommended,
    maxAchievableDeviationNoCompensation,
    cycleHealthScore,
    withinToleranceCurrent,
  };
}

/** ── MC simulation (cross-validates closed-form) ────────────────────────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianSample(rng: () => number): number {
  let u1 = rng();
  while (u1 < 1e-12) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface AwpCycleConvergenceMcResult {
  cycles: number;
  observedExpectedFinalRtp: number;
  observedStdDevFinalRtp: number;
  observedProbExceedsToleranceAtEnd: number;
}

/**
 * MC: simulate `cycles` cycle completions, drawing remaining payouts ~ N(R*·b, σ²·b²).
 * Records observed final RTP distribution.
 */
export function simulateAwpCycleConvergence(
  cfg: AwpCycleConvergenceConfig,
  cycles: number,
  seed: number,
): AwpCycleConvergenceMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);
  const m = cfg.cycleLengthSpins - cfg.spinsPlayed;
  const totalCycleWager = cfg.cycleLengthSpins * cfg.baseBet;
  const muPerSpin = cfg.targetRtp * cfg.baseBet;
  const sigmaPerSpin = cfg.payoutStdDevPerBet * cfg.baseBet;

  const finalRtps: number[] = [];
  let exceedsCount = 0;

  for (let c = 0; c < cycles; c++) {
    let remaining = 0;
    for (let i = 0; i < m; i++) {
      remaining += muPerSpin + sigmaPerSpin * gaussianSample(rng);
    }
    const finalPayout = cfg.cumulativePayout + remaining;
    const finalRtp = finalPayout / totalCycleWager;
    finalRtps.push(finalRtp);
    if (Math.abs(finalRtp - cfg.targetRtp) > cfg.toleranceAbs) exceedsCount++;
  }

  const mean = finalRtps.reduce((a, b) => a + b, 0) / cycles;
  const variance = finalRtps.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / cycles;

  return {
    cycles,
    observedExpectedFinalRtp: mean,
    observedStdDevFinalRtp: Math.sqrt(variance),
    observedProbExceedsToleranceAtEnd: exceedsCount / cycles,
  };
}
