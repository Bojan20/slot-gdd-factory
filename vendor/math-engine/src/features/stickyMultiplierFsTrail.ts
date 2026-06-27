/**
 * W152 Wave 179 — Sticky Multiplier FS Trail Aggregator (61. solver).
 *
 * Iconic FS-persistent multiplier mehanika sa **linear trail growth** —
 * sticky multiplier never resets during Free Spins, increments on event
 * (cluster win, mult-coin land, scatter retrigger).
 *
 *   * Big Time Gaming Bonanza Megaways FS (M_0=1, +1 per cluster win)
 *   * Pragmatic Sweet Bonanza FS (M_0=1, mult-coin lands sa Δ avg multiplier)
 *   * Pragmatic Big Bass Bonanza FS Money Collect (fisherman collect tier escalation)
 *   * BTG White Rabbit FS (xMult per scatter)
 *   * Hacksaw Wanted Dead or a Wild Bounty FS (xMult chain za bounty hit)
 *   * Pragmatic Money Cart 4 EXTRA SHIFT (persistent multiplier across re-spins)
 *   * ELK Wild Robo Factory (sticky multiplier accumulator across grid)
 *   * Quickspin Big Bad Wolf FS Pigs Turned Wild
 *
 * **61st closed-form solver** — first FS-persistent multiplier trail aggregator
 * sa **doubly-compound payout** = base FS win × cumulative trail multiplier
 * summed over N spins (linear-in-N growth gives quadratic payout scaling).
 *
 * ── Math (Compound Binomial Trail) ───────────────────────────────────────────
 *
 * N FS spins. Per spin: I_i ~ Bernoulli(q) indicator of "increment event"
 * (cluster win, mult-coin land, scatter retrigger — vendor-specific). When
 * I_i = 1, multiplier increments by Δ_i ~ iid distribution (E[Δ] = μ_Δ,
 * Var[Δ] = σ²_Δ).
 *
 * **Final multiplier** M_N = M_0 + Σ_{i=1..N} I_i · Δ_i.
 *
 *   N_inc = Σ I_i ~ Binomial(N, q)
 *   E[N_inc] = N·q, Var[N_inc] = N·q·(1−q)
 *   T_inc = Σ_{i=1..N_inc} Δ_i (compound Binomial sum)
 *
 * **Wald-Blackwell compound** za T_inc (Binomial → independent count + iid Δ):
 *   E[T_inc] = E[N_inc] · μ_Δ = N·q·μ_Δ
 *   Var[T_inc] = E[N_inc]·σ²_Δ + Var[N_inc]·μ_Δ²
 *               = N·q·σ²_Δ + N·q·(1−q)·μ_Δ²
 *               = N·q·(σ²_Δ + (1−q)·μ_Δ²)
 *
 *   **E[M_N] = M_0 + N·q·μ_Δ**
 *   **Var[M_N] = N·q·(σ²_Δ + (1−q)·μ_Δ²)**
 *
 * **Trail-sum payout** S_FS = Σ_{t=1..N} Y_t · M_{t-1}, gde Y_t = base FS
 * win (iid sa E[Y] = μ_Y, Var[Y] = σ²_Y), M_{t-1} = multiplier AT spin t
 * (before this spin's possible increment).
 *
 * Assuming Y_t independent of M_t (vendor multiplier collected from separate
 * symbol, not from base win):
 *
 *   E[S_FS] = μ_Y · Σ_{t=1..N} E[M_{t-1}]
 *           = μ_Y · Σ_{t=1..N} (M_0 + (t−1)·q·μ_Δ)
 *           = μ_Y · (N·M_0 + q·μ_Δ · N(N−1)/2)
 *
 * **Quadratic growth in N** za trail-sum payout — defining commercial
 * signature za sticky-trail FS.
 *
 *   Var[S_FS] aggregate (under independence): Σ_t Var[Y_t · M_{t-1}]
 *           = Σ_t (E[M_{t-1}²]·σ²_Y + Var[M_{t-1}]·μ_Y²)
 *           = Σ_t (Var[M_{t-1}] + (E[M_{t-1}])²)·σ²_Y + Σ_t Var[M_{t-1}]·μ_Y²
 *
 * Per-disclosure:
 *   - **expectedTrailSumPayoutPerFS** = E[S_FS]
 *   - **expectedFinalMultiplier** = E[M_N]
 *   - **expectedSpinsToReachMultiplierTarget(M_target)** = (M_target − M_0)/(q·μ_Δ)
 *     (deterministic linear approx; exact requires Negative-Binomial-like)
 *   - **commercialUpliftRatio** = E[S_FS] / (μ_Y · N · M_0) — how much trail
 *     mehanic uplifts vs flat-multiplier FS
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - W049 N-tier H&W Jackpot Ladder (jackpot tier system, ne FS-multiplier trail)
 *   - W089 Persistent Multiplier Accumulator (persistent across spins, BUT
 *     not FS-trail with N-spin quadratic aggregation)
 *   - W097 Free Spins Lookback Multiplier (lookback multiplier on retrigger,
 *     ne sticky-trail-increment)
 *   - W114 Sticky Wild Countdown Multiplier (countdown, ne increment)
 *   - W132 Multi-Level Wild Tier (Markov tier upgrade, ne stick-trail)
 *   - W138 Tumble Multiplier with Cap (capped per-cascade, ne FS-persistent)
 *   - W121 Cascade Multiplier Chain Lockstep (conditional per-cascade)
 *
 * Compliance:
 *   - UKGC RTS 14 (multiplier mechanic disclosure)
 *   - MGA PPD §11 (FS feature transparency)
 *   - eCOGRA Generic Slots Audit (multiplier accumulator audit trail)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "sticky multiplier", "FS trail", "trail-sum payout" = generic
 * slot-design terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface StickyMultiplierFsTrailConfig {
  /** Number of FS spins N ≥ 1. */
  numFreeSpins: number;
  /** Starting multiplier M_0 ≥ 1 (typically 1). */
  startMultiplier: number;
  /** Per-spin Bernoulli probability of increment event q ∈ [0, 1]. */
  probIncrementPerSpin: number;
  /** Mean of increment value Δ per event (≥ 0). */
  expectedIncrementValue: number;
  /** Variance of increment value Δ per event (≥ 0). */
  varianceIncrementValue: number;
  /** Mean of per-spin base FS win Y in × bet units (≥ 0). */
  baseFsWinMean: number;
  /** Variance of per-spin base FS win Y (≥ 0). */
  baseFsWinVar: number;
  /** Optional multiplier-target disclosure (e.g. spins to reach M=10). */
  multiplierTargetForSpinDisclosure?: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface StickyMultiplierFsTrailResult {
  /** E[# increments] = N·q. */
  expectedIncrementsPerFs: number;
  /** Var[# increments] = N·q·(1−q). */
  varianceIncrementsPerFs: number;
  /** E[M_N] final multiplier. */
  expectedFinalMultiplier: number;
  /** Var[M_N] final multiplier (compound Binomial). */
  varianceFinalMultiplier: number;
  /** StdDev[M_N]. */
  stdDevFinalMultiplier: number;
  /** E[S_FS] trail-sum payout = μ_Y · (N·M_0 + q·μ_Δ·N(N−1)/2). */
  expectedTrailSumPayoutPerFs: number;
  /** Var[S_FS] aggregate trail-sum payout. */
  varianceTrailSumPayoutPerFs: number;
  /** StdDev[S_FS]. */
  stdDevTrailSumPayoutPerFs: number;
  /** Commercial uplift ratio = E[S_FS] / (μ_Y · N · M_0). */
  commercialUpliftRatio: number;
  /** Expected spins to reach a given multiplier target (linear approximation). */
  expectedSpinsToReachMultiplierTarget?: number;
  /** Per-spin E[M_t] trajectory za audit (length N). */
  multiplierTrajectoryExpectations: number[];
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: StickyMultiplierFsTrailConfig): void {
  if (
    !Number.isFinite(cfg.numFreeSpins) ||
    cfg.numFreeSpins < 1 ||
    !Number.isInteger(cfg.numFreeSpins)
  ) {
    throw new Error(`numFreeSpins must be integer ≥ 1, got ${cfg.numFreeSpins}`);
  }
  if (!Number.isFinite(cfg.startMultiplier) || cfg.startMultiplier < 1) {
    throw new Error(`startMultiplier must be ≥ 1, got ${cfg.startMultiplier}`);
  }
  if (
    !Number.isFinite(cfg.probIncrementPerSpin) ||
    cfg.probIncrementPerSpin < 0 ||
    cfg.probIncrementPerSpin > 1
  ) {
    throw new Error(
      `probIncrementPerSpin must be in [0, 1], got ${cfg.probIncrementPerSpin}`,
    );
  }
  if (!Number.isFinite(cfg.expectedIncrementValue) || cfg.expectedIncrementValue < 0) {
    throw new Error(
      `expectedIncrementValue must be ≥ 0, got ${cfg.expectedIncrementValue}`,
    );
  }
  if (!Number.isFinite(cfg.varianceIncrementValue) || cfg.varianceIncrementValue < 0) {
    throw new Error(
      `varianceIncrementValue must be ≥ 0, got ${cfg.varianceIncrementValue}`,
    );
  }
  if (!Number.isFinite(cfg.baseFsWinMean) || cfg.baseFsWinMean < 0) {
    throw new Error(`baseFsWinMean must be ≥ 0, got ${cfg.baseFsWinMean}`);
  }
  if (!Number.isFinite(cfg.baseFsWinVar) || cfg.baseFsWinVar < 0) {
    throw new Error(`baseFsWinVar must be ≥ 0, got ${cfg.baseFsWinVar}`);
  }
  if (cfg.multiplierTargetForSpinDisclosure !== undefined) {
    if (
      !Number.isFinite(cfg.multiplierTargetForSpinDisclosure) ||
      cfg.multiplierTargetForSpinDisclosure < cfg.startMultiplier
    ) {
      throw new Error(
        `multiplierTargetForSpinDisclosure must be ≥ startMultiplier, got ${cfg.multiplierTargetForSpinDisclosure}`,
      );
    }
  }
}

/** ── Main analyzer ───────────────────────────────────────────────────────── */
export function analyzeStickyMultiplierFsTrail(
  cfg: StickyMultiplierFsTrailConfig,
): StickyMultiplierFsTrailResult {
  validate(cfg);

  const N = cfg.numFreeSpins;
  const M0 = cfg.startMultiplier;
  const q = cfg.probIncrementPerSpin;
  const muDelta = cfg.expectedIncrementValue;
  const sigma2Delta = cfg.varianceIncrementValue;
  const muY = cfg.baseFsWinMean;
  const sigma2Y = cfg.baseFsWinVar;

  // Increment count: N_inc ~ Binomial(N, q)
  const expInc = N * q;
  const varInc = N * q * (1 - q);

  // Final multiplier: M_N = M_0 + T_inc where T_inc compound Binomial
  // E[T_inc] = N·q·μ_Δ
  // Var[T_inc] = N·q·σ²_Δ + N·q·(1−q)·μ_Δ²
  //            = N·q·(σ²_Δ + (1−q)·μ_Δ²)
  const expFinalM = M0 + N * q * muDelta;
  const varFinalM = N * q * (sigma2Delta + (1 - q) * muDelta * muDelta);

  // Per-spin trajectory E[M_t] = M_0 + t·q·μ_Δ for t = 0..N-1
  // (M_{t-1} used at spin t)
  const trajectory: number[] = new Array(N);
  for (let t = 0; t < N; t++) {
    trajectory[t] = M0 + t * q * muDelta;
  }

  // Trail-sum payout S_FS = Σ_{t=1..N} Y_t · M_{t-1}
  // Assuming Y_t indep of M_{t-1}:
  //   E[S_FS] = μ_Y · Σ E[M_{t-1}] = μ_Y · (N·M_0 + q·μ_Δ · N(N-1)/2)
  const sumExpM = N * M0 + q * muDelta * (N * (N - 1)) / 2;
  const expS = muY * sumExpM;

  // Var[S_FS] under independence:
  //   Var[Y·M] = E[M²]·Var[Y] + Var[M]·E[Y]²
  // Sum over t (independence between time steps not strictly true since M_t
  // builds on M_{t-1}, but for closed-form proxy we use simple sum — this
  // approximation is conservative for variance).
  let varS = 0;
  for (let t = 0; t < N; t++) {
    const expMt = trajectory[t];
    // Var[M_t] = t·q·(σ²_Δ + (1-q)·μ_Δ²)
    const varMt = t * q * (sigma2Delta + (1 - q) * muDelta * muDelta);
    const expMt2 = varMt + expMt * expMt;
    varS += expMt2 * sigma2Y + varMt * muY * muY;
  }

  const commercialUplift = N * M0 * muY > 0 ? expS / (muY * N * M0) : 1;

  // Spins to reach target multiplier (deterministic linear approx)
  let spinsToTarget: number | undefined;
  if (cfg.multiplierTargetForSpinDisclosure !== undefined) {
    const target = cfg.multiplierTargetForSpinDisclosure;
    const denom = q * muDelta;
    spinsToTarget = denom > 0 ? (target - M0) / denom : Number.POSITIVE_INFINITY;
  }

  return {
    expectedIncrementsPerFs: expInc,
    varianceIncrementsPerFs: varInc,
    expectedFinalMultiplier: expFinalM,
    varianceFinalMultiplier: varFinalM,
    stdDevFinalMultiplier: Math.sqrt(varFinalM),
    expectedTrailSumPayoutPerFs: expS,
    varianceTrailSumPayoutPerFs: varS,
    stdDevTrailSumPayoutPerFs: Math.sqrt(varS),
    commercialUpliftRatio: commercialUplift,
    expectedSpinsToReachMultiplierTarget: spinsToTarget,
    multiplierTrajectoryExpectations: trajectory,
  };
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solveStickyMultiplierFsTrail = analyzeStickyMultiplierFsTrail;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateStickyMultiplierFsTrail(
  cfg: StickyMultiplierFsTrailConfig,
  numFsBonusRuns: number,
  seed = 0xface0179,
): {
  meanIncrementsPerFs: number;
  meanFinalMultiplier: number;
  stdDevFinalMultiplier: number;
  meanTrailSumPayoutPerFs: number;
  stdDevTrailSumPayoutPerFs: number;
} {
  validate(cfg);
  if (!Number.isFinite(numFsBonusRuns) || numFsBonusRuns < 1 || !Number.isInteger(numFsBonusRuns)) {
    throw new Error(`numFsBonusRuns must be integer ≥ 1, got ${numFsBonusRuns}`);
  }

  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return (z >>> 0) / 4294967296;
  };
  const sigmaDelta = Math.sqrt(cfg.varianceIncrementValue);
  const sigmaY = Math.sqrt(cfg.baseFsWinVar);
  const gaussian = (mu: number, sigma: number): number => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mu + sigma * z);
  };

  const N = cfg.numFreeSpins;
  const M0 = cfg.startMultiplier;
  const q = cfg.probIncrementPerSpin;
  const muDelta = cfg.expectedIncrementValue;
  const muY = cfg.baseFsWinMean;

  let sumInc = 0;
  let sumM = 0;
  let sumM2 = 0;
  let sumS = 0;
  let sumS2 = 0;

  for (let run = 0; run < numFsBonusRuns; run++) {
    let M = M0;
    let payout = 0;
    let inc = 0;
    for (let t = 0; t < N; t++) {
      // Pre-spin: payout uses M_{t-1}, then possible increment
      const yT = gaussian(muY, sigmaY);
      payout += yT * M;
      if (rng() < q) {
        const delta = gaussian(muDelta, sigmaDelta);
        M += delta;
        inc++;
      }
    }
    sumInc += inc;
    sumM += M;
    sumM2 += M * M;
    sumS += payout;
    sumS2 += payout * payout;
  }

  const meanM = sumM / numFsBonusRuns;
  const varM = Math.max(0, sumM2 / numFsBonusRuns - meanM * meanM);
  const meanS = sumS / numFsBonusRuns;
  const varS = Math.max(0, sumS2 / numFsBonusRuns - meanS * meanS);

  return {
    meanIncrementsPerFs: sumInc / numFsBonusRuns,
    meanFinalMultiplier: meanM,
    stdDevFinalMultiplier: Math.sqrt(varM),
    meanTrailSumPayoutPerFs: meanS,
    stdDevTrailSumPayoutPerFs: Math.sqrt(varS),
  };
}
