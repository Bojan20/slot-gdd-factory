/**
 * W152 Wave 102 — Cluster Compound Variance solver (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "cluster-cascade compound payout" mehaniku —
 * Sweet Bonanza / Reactoonz / Jammin' Jars / Wild Swarm style igre gde
 * jedan spin pokreće cascade chain, svaki korak pravi cluster (pay-anywhere
 * 8+ symbols), payout = paytable(cluster_size), pa simboli padaju i lanac
 * se nastavlja ili prekida.
 *
 * Naming policy (clean-room): "cluster cascade", "compound variance",
 * "drop chain" = generic industry terms. No vendor-specific data.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 *
 * Per spin episode:
 *   1. Chain length N ∈ {0, 1, 2, ...} ~ stopping process
 *   2. Per chain step i (1..N): cluster size K_i ∈ {0, 1, 2, ...}
 *      Drawn iid from per-step pmf clusterPmf[k] = P(K = k).
 *      K_i = 0 means "no winning cluster on this step" (the dead-step
 *      contribution stays at f(0)=0 in typical paytables; the operator
 *      can override.)
 *   3. Per cluster size: payout y_i = paytable(K_i) (e.g. f(0..7)=0,
 *      f(8)=0.25×, f(9)=0.5×, …, f(40+)=200×)
 *   4. Total payout per episode Y = Σ_{i=1}^{N} y_i (compound sum)
 *
 * Wald's identity for compound sum:
 *   E[Y]   = E[N] · μ_Y                        where μ_Y = E[f(K)]
 *   Var[Y] = E[N] · σ²_Y + Var[N] · μ²_Y       (compound variance formula)
 *
 * Where:
 *   μ_Y     = Σ_k clusterPmf[k] · paytable[k]
 *   σ²_Y    = Σ_k clusterPmf[k] · paytable[k]² − μ_Y²
 *   E[N]    = Σ_n n · chainPmf[n]
 *   Var[N]  = Σ_n n² · chainPmf[n] − E[N]²
 *
 * Wald's compound variance identity holds when:
 *   - N is independent of {K_i}
 *   - {K_i} are iid
 *   - All moments exist
 *
 * If the chain length is GEOMETRIC with kill prob p_kill (each chain step
 * has prob p_kill of being the last), then:
 *   chainPmf[n] = (1−p_kill)^n · p_kill           for n ≥ 0
 *   E[N]        = (1−p_kill) / p_kill
 *   Var[N]      = (1−p_kill) / p_kill²
 *
 * We expose three input modes:
 *   - 'explicit': caller supplies chainPmf[] and clusterPmf[] arrays
 *   - 'geometric': caller supplies p_kill + clusterPmf[]; chainPmf[] derived
 *   - 'parametric': caller supplies p_kill + cluster geometric mean k_mean;
 *      cluster distribution is shifted-geometric (k ≥ k_min, mean k_mean)
 *
 * Industry mapping:
 *   - Sweet Bonanza (Pragmatic): cluster cascade with persistent multiplier
 *     symbol; pure cluster part is Wave 102; mult symbol is Wave 89.
 *   - Reactoonz (Play'n GO): cluster + quantum leap + uncharged wilds.
 *     Wave 102 covers the BASE cluster-cascade compound; quantum leap is
 *     a state-machine separate from this kernel.
 *   - Jammin' Jars (Push Gaming): cluster cascade with growing wild multipliers.
 *     Wave 102 covers cluster-cascade compound; wild stack is Wave 93.
 */

/** Per-cluster-size payout in bet multiples. Index = cluster size. */
export type ClusterPaytable = number[];

/** Per-cluster-size probability mass. Index = cluster size, sum = 1. */
export type ClusterPmf = number[];

/** Per-chain-length probability mass. Index = chain length n, sum = 1. */
export type ChainLengthPmf = number[];

/** ── Config (explicit-input form) ───────────────────────────────────────── */
export interface ClusterCompoundConfigExplicit {
  /** Per-chain-length pmf. chainPmf[n] = P(chain length = n). */
  chainPmf: ChainLengthPmf;
  /** Per-cluster-size pmf. clusterPmf[k] = P(cluster size = k | step occurs). */
  clusterPmf: ClusterPmf;
  /** Per-cluster-size payout. paytable[k] = bet multiplier for cluster of size k. */
  paytable: ClusterPaytable;
}

/** ── Config (geometric-chain form) ──────────────────────────────────────── */
export interface ClusterCompoundConfigGeometric {
  /**
   * Per-step kill probability. Chain stops with prob p_kill each step.
   * Geometric model: P(N = n) = (1−p_kill)^n · p_kill, n ≥ 0.
   */
  pKill: number;
  /** Per-cluster-size pmf (used for every step). */
  clusterPmf: ClusterPmf;
  /** Per-cluster-size payout. */
  paytable: ClusterPaytable;
  /** Optional cap on chain length (default 50). Affects MC only; CF uses true geometric. */
  chainCap?: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface ClusterCompoundClosedForm {
  /** Expected payout per cluster-step (μ_Y = E[f(K)]). */
  expectedPayoutPerStep: number;
  /** Variance of payout per cluster-step (σ²_Y). */
  variancePayoutPerStep: number;
  /** Expected chain length (E[N]). */
  expectedChainLength: number;
  /** Variance of chain length (Var[N]). */
  varianceChainLength: number;
  /** Compound expected total payout per episode (E[Y_total] = E[N]·μ_Y). */
  expectedTotalPayoutX: number;
  /**
   * Compound variance per episode via Wald's identity:
   *   Var[Y_total] = E[N]·σ²_Y + Var[N]·μ²_Y
   */
  varianceTotalPayout: number;
  /** Std dev = √Var[Y_total]. */
  stdDevTotalPayout: number;
  /** Coefficient of variation = stdDev / |mean|, or NaN if mean=0. */
  coefficientOfVariation: number;
  /** P(empty episode = no chain steps) = chainPmf[0]. */
  probEmptyEpisode: number;
  /** Sum of |chainPmf|; should be ≈ 1 (sanity readback). */
  chainPmfMass: number;
  /** Sum of |clusterPmf|; should be ≈ 1 (sanity readback). */
  clusterPmfMass: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function isProbabilityArray(arr: number[], tolerance = 1e-9): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  let sum = 0;
  for (const p of arr) {
    if (!Number.isFinite(p)) return false;
    if (p < -tolerance) return false;
    sum += p;
  }
  return Math.abs(sum - 1) < 1e-6;
}

function validateExplicit(cfg: ClusterCompoundConfigExplicit): void {
  if (!isProbabilityArray(cfg.chainPmf)) {
    throw new Error(`clusterCompoundVariance: chainPmf must sum to 1 (within 1e-6) and be non-negative`);
  }
  if (!isProbabilityArray(cfg.clusterPmf)) {
    throw new Error(`clusterCompoundVariance: clusterPmf must sum to 1 (within 1e-6) and be non-negative`);
  }
  if (!Array.isArray(cfg.paytable) || cfg.paytable.length === 0) {
    throw new Error(`clusterCompoundVariance: paytable must be a non-empty array`);
  }
  if (cfg.paytable.length < cfg.clusterPmf.length) {
    throw new Error(
      `clusterCompoundVariance: paytable length (${cfg.paytable.length}) must be ≥ clusterPmf length (${cfg.clusterPmf.length})`,
    );
  }
  for (const v of cfg.paytable) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`clusterCompoundVariance: paytable values must be finite and non-negative`);
    }
  }
}

function validateGeometric(cfg: ClusterCompoundConfigGeometric): void {
  if (!Number.isFinite(cfg.pKill) || cfg.pKill <= 0 || cfg.pKill > 1) {
    throw new Error(`clusterCompoundVariance: pKill must be in (0, 1], got ${cfg.pKill}`);
  }
  if (!isProbabilityArray(cfg.clusterPmf)) {
    throw new Error(`clusterCompoundVariance: clusterPmf must sum to 1 (within 1e-6) and be non-negative`);
  }
  if (!Array.isArray(cfg.paytable) || cfg.paytable.length === 0) {
    throw new Error(`clusterCompoundVariance: paytable must be a non-empty array`);
  }
  if (cfg.paytable.length < cfg.clusterPmf.length) {
    throw new Error(
      `clusterCompoundVariance: paytable length (${cfg.paytable.length}) must be ≥ clusterPmf length (${cfg.clusterPmf.length})`,
    );
  }
  for (const v of cfg.paytable) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`clusterCompoundVariance: paytable values must be finite and non-negative`);
    }
  }
}

/** ── Closed-form solvers ────────────────────────────────────────────────── */

function clusterMoments(
  clusterPmf: ClusterPmf,
  paytable: ClusterPaytable,
): { mu: number; sigma2: number } {
  let mu = 0;
  let mu2 = 0;
  for (let k = 0; k < clusterPmf.length; k++) {
    const p = clusterPmf[k];
    const y = paytable[k];
    mu += p * y;
    mu2 += p * y * y;
  }
  const sigma2 = Math.max(0, mu2 - mu * mu);
  return { mu, sigma2 };
}

function chainMoments(chainPmf: ChainLengthPmf): { eN: number; varN: number; pEmpty: number; mass: number } {
  let eN = 0;
  let eN2 = 0;
  let mass = 0;
  for (let n = 0; n < chainPmf.length; n++) {
    const p = chainPmf[n];
    eN += n * p;
    eN2 += n * n * p;
    mass += p;
  }
  const varN = Math.max(0, eN2 - eN * eN);
  const pEmpty = chainPmf[0] ?? 0;
  return { eN, varN, pEmpty, mass };
}

/**
 * Closed-form compound-variance solver — explicit-input form.
 * Accepts chainPmf[] and clusterPmf[] directly. Most general — supports any
 * chain-length distribution (geometric, truncated geometric, empirical
 * from per-game data, etc.).
 */
export function solveClusterCompoundExplicit(
  cfg: ClusterCompoundConfigExplicit,
): ClusterCompoundClosedForm {
  validateExplicit(cfg);

  const { mu, sigma2 } = clusterMoments(cfg.clusterPmf, cfg.paytable);
  const { eN, varN, pEmpty, mass: chainMass } = chainMoments(cfg.chainPmf);

  const expectedTotalPayoutX = eN * mu;
  // Wald's compound variance: Var[Y] = E[N]·Var[Y_i] + Var[N]·(E[Y_i])²
  const varianceTotalPayout = eN * sigma2 + varN * mu * mu;
  const stdDev = Math.sqrt(varianceTotalPayout);
  const cov = expectedTotalPayoutX > 1e-12 ? stdDev / expectedTotalPayoutX : Number.NaN;

  let clusterMass = 0;
  for (const p of cfg.clusterPmf) clusterMass += p;

  return {
    expectedPayoutPerStep: mu,
    variancePayoutPerStep: sigma2,
    expectedChainLength: eN,
    varianceChainLength: varN,
    expectedTotalPayoutX,
    varianceTotalPayout,
    stdDevTotalPayout: stdDev,
    coefficientOfVariation: cov,
    probEmptyEpisode: pEmpty,
    chainPmfMass: chainMass,
    clusterPmfMass: clusterMass,
  };
}

/**
 * Closed-form compound-variance solver — geometric-chain form.
 * Per step has prob p_kill of being the last (chain stops). For N ~
 * geometric (zero-indexed, support {0, 1, 2, ...}):
 *   P(N = n) = (1 − p_kill)^n · p_kill
 *   E[N]     = (1 − p_kill) / p_kill
 *   Var[N]   = (1 − p_kill) / p_kill²
 */
export function solveClusterCompoundGeometric(
  cfg: ClusterCompoundConfigGeometric,
): ClusterCompoundClosedForm {
  validateGeometric(cfg);

  const { mu, sigma2 } = clusterMoments(cfg.clusterPmf, cfg.paytable);

  const q = 1 - cfg.pKill;
  const eN = q / cfg.pKill;
  const varN = q / (cfg.pKill * cfg.pKill);
  const pEmpty = cfg.pKill; // P(N = 0)

  const expectedTotalPayoutX = eN * mu;
  const varianceTotalPayout = eN * sigma2 + varN * mu * mu;
  const stdDev = Math.sqrt(varianceTotalPayout);
  const cov = expectedTotalPayoutX > 1e-12 ? stdDev / expectedTotalPayoutX : Number.NaN;

  let clusterMass = 0;
  for (const p of cfg.clusterPmf) clusterMass += p;

  return {
    expectedPayoutPerStep: mu,
    variancePayoutPerStep: sigma2,
    expectedChainLength: eN,
    varianceChainLength: varN,
    expectedTotalPayoutX,
    varianceTotalPayout,
    stdDevTotalPayout: stdDev,
    coefficientOfVariation: cov,
    probEmptyEpisode: pEmpty,
    chainPmfMass: 1, // true geometric — mass sums to 1
    clusterPmfMass: clusterMass,
  };
}

/** ── MC simulation (cross-validates closed-form) ────────────────────────── */

/** Deterministic seedable RNG — Mulberry32 (same as engine baseline). */
function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleFromPmf(pmf: number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < pmf.length; i++) {
    acc += pmf[i];
    if (u < acc) return i;
  }
  return pmf.length - 1;
}

export interface ClusterCompoundMcResult {
  episodes: number;
  observedMeanPayoutX: number;
  observedStdDevPayoutX: number;
  observedMeanChainLength: number;
  observedEmptyRate: number;
}

export interface ClusterCompoundMcConfig {
  episodes: number;
  seed: number;
}

export function simulateClusterCompoundExplicit(
  cfg: ClusterCompoundConfigExplicit,
  mc: ClusterCompoundMcConfig,
): ClusterCompoundMcResult {
  validateExplicit(cfg);
  const rng = makeRng(mc.seed);

  let sumY = 0;
  let sumY2 = 0;
  let sumN = 0;
  let emptyCount = 0;

  for (let e = 0; e < mc.episodes; e++) {
    const n = sampleFromPmf(cfg.chainPmf, rng());
    if (n === 0) emptyCount++;
    let payout = 0;
    for (let step = 0; step < n; step++) {
      const k = sampleFromPmf(cfg.clusterPmf, rng());
      payout += cfg.paytable[k] ?? 0;
    }
    sumY += payout;
    sumY2 += payout * payout;
    sumN += n;
  }

  const mean = sumY / mc.episodes;
  const meanSq = sumY2 / mc.episodes;
  const variance = Math.max(0, meanSq - mean * mean);
  return {
    episodes: mc.episodes,
    observedMeanPayoutX: mean,
    observedStdDevPayoutX: Math.sqrt(variance),
    observedMeanChainLength: sumN / mc.episodes,
    observedEmptyRate: emptyCount / mc.episodes,
  };
}

export function simulateClusterCompoundGeometric(
  cfg: ClusterCompoundConfigGeometric,
  mc: ClusterCompoundMcConfig,
): ClusterCompoundMcResult {
  validateGeometric(cfg);
  const rng = makeRng(mc.seed);
  const chainCap = cfg.chainCap ?? 50;

  let sumY = 0;
  let sumY2 = 0;
  let sumN = 0;
  let emptyCount = 0;

  for (let e = 0; e < mc.episodes; e++) {
    let n = 0;
    let payout = 0;
    while (n < chainCap) {
      if (rng() < cfg.pKill) break; // chain stops BEFORE this step would happen
      const k = sampleFromPmf(cfg.clusterPmf, rng());
      payout += cfg.paytable[k] ?? 0;
      n++;
    }
    if (n === 0) emptyCount++;
    sumY += payout;
    sumY2 += payout * payout;
    sumN += n;
  }

  const mean = sumY / mc.episodes;
  const meanSq = sumY2 / mc.episodes;
  const variance = Math.max(0, meanSq - mean * mean);
  return {
    episodes: mc.episodes,
    observedMeanPayoutX: mean,
    observedStdDevPayoutX: Math.sqrt(variance),
    observedMeanChainLength: sumN / mc.episodes,
    observedEmptyRate: emptyCount / mc.episodes,
  };
}

/** ── Convenience: derive geometric chainPmf for cross-validation ────────── */

/**
 * Build truncated-geometric chainPmf for use with the EXPLICIT solver
 * (useful when caller wants to enumerate the geometric chain via the same
 * code path as arbitrary chain distributions).
 *
 * P(N = n) = (1 − p_kill)^n · p_kill   for n = 0, 1, ..., capMinus1
 * P(N = cap)  = remaining mass         (lumps tail at cap)
 */
export function buildGeometricChainPmf(pKill: number, cap = 50): ChainLengthPmf {
  if (!Number.isFinite(pKill) || pKill <= 0 || pKill > 1) {
    throw new Error(`buildGeometricChainPmf: pKill must be in (0, 1], got ${pKill}`);
  }
  if (cap < 1) throw new Error(`buildGeometricChainPmf: cap must be ≥ 1`);
  const q = 1 - pKill;
  const out: number[] = new Array(cap + 1);
  let cumulative = 0;
  for (let n = 0; n < cap; n++) {
    out[n] = Math.pow(q, n) * pKill;
    cumulative += out[n];
  }
  out[cap] = Math.max(0, 1 - cumulative); // residual tail mass
  return out;
}
