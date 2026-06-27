/**
 * W152 Wave 177 — Avalanche Reactor Remove-and-Drop Wave Aggregator
 * (🎯 60. solver MILESTONE).
 *
 * Iconic za:
 *   * Play'n GO Reactoonz "Quantum Leap" (40 destruction → activation)
 *   * Play'n GO Reactoonz 2 Quantoom (multi-Quantoom tier)
 *   * ELK Reactor (10-cell removal threshold → energy burst)
 *   * Big Time Gaming Megaways "evolution" mechanism
 *   * Hacksaw Gaming Tombstone Rip (skull collect threshold → rip)
 *   * Pragmatic Sweet Bonanza ante-bet sa multiplier evolution
 *   * Push Gaming Punk Toilet — cluster-trigger threshold accumulator
 *
 * **🎯 60th closed-form solver MILESTONE** — doubly-compound Wald aggregator
 * za threshold-activation feature triggered by ACCUMULATED symbol removals
 * across the entire avalanche-reactor spin (multi-wave + multi-cluster).
 *
 * ── Math (doubly-compound Wald) ──────────────────────────────────────────────
 *
 * Per spin: chain of "waves" until no winning cluster forms.
 *   - W = number of waves per spin ~ Geometric(p)
 *     P(W = k) = p^k · (1 − p) for k = 0, 1, 2, ...
 *     E[W] = p / (1 − p), Var[W] = p / (1 − p)²
 *   - Per wave i: L_i = symbols removed in wave i, iid sa
 *     E[L] = μ_L, Var[L] = σ²_L (operator-provided iz cluster-size distribution).
 *
 * Total symbols removed per spin: S = Σ_{i=1..W} L_i. By Wald (W independent
 * od L_i):
 *
 *   **E[S] = E[W] · E[L]**
 *   **Var[S] = E[W] · Var[L] + Var[W] · (E[L])²**
 *
 * **Threshold activation** (Quantum Leap / Energy / Evolution): feature
 * triggers when S ≥ T_threshold (e.g., Reactoonz T = 40).
 *
 * For W ≥ 1 (at least one wave), CLT approximation of S around its mean
 * (valid for E[W] sufficiently large):
 *
 *   S ≈ Normal(E[S], Var[S])  →  P(S ≥ T) = 1 − Φ((T − E[S]) / stdDev[S])
 *
 * For low E[W] (≤ 2), CLT under-counts P(S=0) probability mass; analyzer
 * exposes BOTH `probActivationCLT` (Normal approx) AND
 * `probActivationConservative` (Markov inequality `P(S ≥ T) ≤ E[S]/T`).
 *
 * Per N spins:
 *   - **expectedActivationsPerSpin** = P(S ≥ T)
 *   - **oneInNSpinsActivation** = 1 / P(S ≥ T)
 *   - **expectedSymbolsPerSpin** = E[S]
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - W086 Cascade Sequential Multiplier Pyramid (deterministic per-step multiplier)
 *   - W102 Cluster Compound Variance (compound variance applied DIFFERENT level)
 *   - W121 Cascade Multiplier Chain Lockstep (conditional multiplier, ne removal)
 *   - W138 Tumble Multiplier with Cap (capped mult ladder, ne threshold)
 *   - W146 Cascade Meter Charge-Up (charge meter, fires INSIDE one cascade)
 *   - W171 Tumbling Cascade Chain Length (Geometric chain length payout, ne removal+threshold)
 *   - W118 Bonus Collect-N (single-collect Markov, ne multi-wave aggregator)
 *   - W144 Trail/Board Progression (deterministic step on board)
 *   - W150 Voltage/XP Meter Multi-Tier (multi-tier reward, ne single-threshold activation)
 *
 * Compliance:
 *   - UKGC RTS 14 (cascade chain + threshold disclosure)
 *   - MGA PPD §11 (avalanche reactor transparency)
 *   - eCOGRA Generic Slots Audit (multi-wave aggregator audit trail)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "avalanche reactor", "wave aggregator", "threshold activation" =
 * generic slot-design terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface AvalancheReactorWaveAggregatorConfig {
  /** Per-wave probability of winning cluster (chain continues) p ∈ (0, 1). */
  probWaveContinues: number;
  /** E[symbols removed per wave] iz cluster-size distribution (≥ 0). */
  expectedRemovalsPerWave: number;
  /** Var[symbols removed per wave] (≥ 0). */
  varianceRemovalsPerWave: number;
  /** Activation threshold T (total symbols removed to trigger feature, e.g. 40 za Reactoonz). */
  activationThreshold: number;
  /** Optional disclosure thresholds (e.g. [10, 20, 40, 60] cumulative removals). */
  disclosureRemovalThresholds?: number[];
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface AvalancheReactorWaveAggregatorResult {
  /** E[W] = p/(1−p) expected waves per spin. */
  expectedWavesPerSpin: number;
  /** Var[W] = p/(1−p)² variance of waves. */
  varianceWavesPerSpin: number;
  /** E[S] = E[W]·E[L] expected total symbols removed per spin (Wald). */
  expectedSymbolsRemovedPerSpin: number;
  /** Var[S] = E[W]·Var[L] + Var[W]·E[L]² (Wald-compound). */
  varianceSymbolsRemovedPerSpin: number;
  /** StdDev[S]. */
  stdDevSymbolsRemovedPerSpin: number;
  /** P(S ≥ T) via CLT-Normal approximation (valid when E[W] ≥ ~3). */
  probActivationCLT: number;
  /** Conservative upper bound P(S ≥ T) ≤ E[S]/T via Markov inequality. */
  probActivationConservativeMarkov: number;
  /** 1 / P(S ≥ T) per CLT estimate. */
  oneInNSpinsActivation: number;
  /** P(S ≥ k) survival at each disclosure threshold (CLT). */
  removalSurvivalAtThresholds: { k: number; probAtLeastK: number; oneInNSpins: number }[];
  /** Effective E[S]/T ratio — if > 1, activation expected on most spins. */
  meanToThresholdRatio: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: AvalancheReactorWaveAggregatorConfig): void {
  if (
    !Number.isFinite(cfg.probWaveContinues) ||
    cfg.probWaveContinues <= 0 ||
    cfg.probWaveContinues >= 1
  ) {
    throw new Error(
      `probWaveContinues must be in (0, 1), got ${cfg.probWaveContinues}`,
    );
  }
  if (
    !Number.isFinite(cfg.expectedRemovalsPerWave) ||
    cfg.expectedRemovalsPerWave < 0
  ) {
    throw new Error(
      `expectedRemovalsPerWave must be ≥ 0, got ${cfg.expectedRemovalsPerWave}`,
    );
  }
  if (
    !Number.isFinite(cfg.varianceRemovalsPerWave) ||
    cfg.varianceRemovalsPerWave < 0
  ) {
    throw new Error(
      `varianceRemovalsPerWave must be ≥ 0, got ${cfg.varianceRemovalsPerWave}`,
    );
  }
  if (
    !Number.isFinite(cfg.activationThreshold) ||
    cfg.activationThreshold <= 0
  ) {
    throw new Error(
      `activationThreshold must be > 0, got ${cfg.activationThreshold}`,
    );
  }
  if (cfg.disclosureRemovalThresholds) {
    for (const k of cfg.disclosureRemovalThresholds) {
      if (!Number.isFinite(k) || k <= 0) {
        throw new Error(
          `disclosureRemovalThresholds entries must be > 0, got ${k}`,
        );
      }
    }
  }
}

/**
 * Standard Normal CDF via Abramowitz-Stegun 26.2.17 approximation
 * (max abs error 7.5e-8).
 */
function normalCdf(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const erfApprox =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erfApprox);
}

/** ── Main analyzer ───────────────────────────────────────────────────────── */
export function analyzeAvalancheReactorWaveAggregator(
  cfg: AvalancheReactorWaveAggregatorConfig,
): AvalancheReactorWaveAggregatorResult {
  validate(cfg);

  const p = cfg.probWaveContinues;
  const muL = cfg.expectedRemovalsPerWave;
  const sigma2L = cfg.varianceRemovalsPerWave;
  const T = cfg.activationThreshold;

  // Geometric(p) waves: E[W] = p/(1−p), Var[W] = p/(1−p)²
  const expW = p / (1 - p);
  const varW = p / ((1 - p) * (1 - p));

  // Wald compound moments for S = Σ L_i:
  // E[S] = E[W] · E[L]
  // Var[S] = E[W] · Var[L] + Var[W] · (E[L])²
  const expS = expW * muL;
  const varS = expW * sigma2L + varW * muL * muL;
  const stdS = Math.sqrt(varS);

  // CLT-Normal approximation za P(S ≥ T):
  //   z = (T − E[S]) / stdDev[S]
  //   P(S ≥ T) = 1 − Φ(z)
  // Edge case: stdS = 0 → degenerate, use indicator
  let probCLT: number;
  if (stdS < 1e-12) {
    probCLT = expS >= T ? 1 : 0;
  } else {
    const z = (T - expS) / stdS;
    probCLT = 1 - normalCdf(z);
  }

  // Markov conservative upper bound: P(S ≥ T) ≤ E[S] / T
  // (only meaningful when E[S] < T, otherwise trivially ≤ 1)
  const probMarkov = T > 0 ? Math.min(1, expS / T) : 0;

  const oneInN = probCLT > 1e-12 ? 1 / probCLT : Number.POSITIVE_INFINITY;

  // Survival at thresholds
  const thresholds = cfg.disclosureRemovalThresholds ?? [];
  const survival: { k: number; probAtLeastK: number; oneInNSpins: number }[] = [];
  for (const k of thresholds) {
    let prob: number;
    if (stdS < 1e-12) {
      prob = expS >= k ? 1 : 0;
    } else {
      const z = (k - expS) / stdS;
      prob = 1 - normalCdf(z);
    }
    survival.push({
      k,
      probAtLeastK: prob,
      oneInNSpins: prob > 1e-12 ? 1 / prob : Number.POSITIVE_INFINITY,
    });
  }

  return {
    expectedWavesPerSpin: expW,
    varianceWavesPerSpin: varW,
    expectedSymbolsRemovedPerSpin: expS,
    varianceSymbolsRemovedPerSpin: varS,
    stdDevSymbolsRemovedPerSpin: stdS,
    probActivationCLT: probCLT,
    probActivationConservativeMarkov: probMarkov,
    oneInNSpinsActivation: oneInN,
    removalSurvivalAtThresholds: survival,
    meanToThresholdRatio: T > 0 ? expS / T : 0,
  };
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solveAvalancheReactorWaveAggregator = analyzeAvalancheReactorWaveAggregator;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateAvalancheReactorWaveAggregator(
  cfg: AvalancheReactorWaveAggregatorConfig,
  numSpins: number,
  seed = 0xbabe0177,
): {
  meanWavesPerSpin: number;
  meanSymbolsRemovedPerSpin: number;
  stdDevSymbolsRemovedPerSpin: number;
  probActivation: number;
  empiricalRemovalSurvival: { k: number; probAtLeastK: number }[];
} {
  validate(cfg);
  if (!Number.isFinite(numSpins) || numSpins < 1 || !Number.isInteger(numSpins)) {
    throw new Error(`numSpins must be integer ≥ 1, got ${numSpins}`);
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
  // Box-Muller Gaussian for per-wave L draws (clip at 0; user may supply any
  // non-negative distribution — here we approximate with Normal(muL, sigmaL)).
  const sigmaL = Math.sqrt(cfg.varianceRemovalsPerWave);
  const gaussianL = (): number => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, cfg.expectedRemovalsPerWave + sigmaL * z);
  };

  const p = cfg.probWaveContinues;
  const T = cfg.activationThreshold;
  const thresholds = cfg.disclosureRemovalThresholds ?? [];
  const survivalCounts = new Array<number>(thresholds.length).fill(0);

  let sumW = 0;
  let sumS = 0;
  let sumS2 = 0;
  let activationCount = 0;

  for (let spin = 0; spin < numSpins; spin++) {
    let waves = 0;
    let totalRemoved = 0;
    // Each wave: continue with probability p, terminate with probability 1−p
    while (rng() < p) {
      waves++;
      totalRemoved += gaussianL();
    }
    sumW += waves;
    sumS += totalRemoved;
    sumS2 += totalRemoved * totalRemoved;
    if (totalRemoved >= T) activationCount++;
    for (let i = 0; i < thresholds.length; i++) {
      if (totalRemoved >= thresholds[i]) survivalCounts[i]++;
    }
  }

  const meanS = sumS / numSpins;
  const varS = Math.max(0, sumS2 / numSpins - meanS * meanS);

  return {
    meanWavesPerSpin: sumW / numSpins,
    meanSymbolsRemovedPerSpin: meanS,
    stdDevSymbolsRemovedPerSpin: Math.sqrt(varS),
    probActivation: activationCount / numSpins,
    empiricalRemovalSurvival: thresholds.map((k, i) => ({
      k,
      probAtLeastK: survivalCounts[i] / numSpins,
    })),
  };
}
