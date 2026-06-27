/**
 * W152 Wave 89 — Persistent Multiplier Accumulator (Faza 4.3 ext).
 *
 * Closed-form solver za "running multiplier" mehaniku gde igrač akumulira
 * sticky multiplier kroz fiksiranih K free spins (industry-standard
 * Pragmatic / Nolimit / BTG variant).
 *
 * Per FS:
 *   • Drop happens w.p. q → multiplier += m_drop (deterministic increment)
 *   • Running multiplier M_n applied to spin n's base win W_n
 *   • Total payout Y = Σ W_n · M_n
 *
 * Naming policy (clean-room): "persistent multiplier", "sticky multiplier"
 * = generic industry terms. No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Inputs:
 *   K        = number of free spins (deterministic)
 *   m_init   = starting multiplier (typically 1)
 *   m_drop   = per-drop increment to running multiplier
 *   q        = probability a drop occurs on any given spin
 *   μ_W      = mean base win per FS
 *   σ²_W     = variance of base win per FS
 *
 * Drops D_n at spin n ~ Binomial(n, q):
 *   E[D_n] = n·q
 *   Var[D_n] = n·q·(1-q)
 *
 * Running multiplier M_n = m_init + D_n · m_drop:
 *   E[M_n]   = m_init + n·q·m_drop
 *   Var[M_n] = n·q·(1-q)·m_drop²
 *   Cov(M_n, M_m) = min(n,m)·q·(1-q)·m_drop²  (drop indicators are independent
 *                                              across spins; cumulative count
 *                                              has shared early-spin variance)
 *
 * Per-spin payout = W_n · M_n. W_n independent of M's:
 *   E[W_n·M_n] = μ_W · E[M_n]
 *   Var[W_n·M_n] = σ²_W · Var[M_n] + σ²_W · E[M_n]² + μ²_W · Var[M_n]
 *
 * Total Y = Σ_{n=1..K} W_n · M_n:
 *   E[Y]    = μ_W · Σ E[M_n]
 *           = μ_W · (K·m_init + q·m_drop · K(K+1)/2)
 *
 *   Var[Y]  = Σ Var[W_n·M_n]
 *           + 2 Σ_{n<m} Cov(W_n·M_n, W_m·M_m)
 *           = Σ Var[W_n·M_n]
 *           + 2 μ²_W Σ_{n<m} Cov(M_n, M_m)
 *
 * Tail risk:
 *   Final multiplier M_K = m_init + D_K · m_drop where D_K ~ Binomial(K, q)
 *   E[M_K]   = m_init + K·q·m_drop
 *   Var[M_K] = K·q·(1-q)·m_drop²
 *
 * Probability of "no drops in K spins" (worst case):
 *   P(M_K = m_init) = (1-q)^K
 *
 * Probability of "max drops" (best case):
 *   P(M_K = m_init + K·m_drop) = q^K
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulatePersistentMultiplier() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface PersistentMultiplierConfig {
  /** Number of free spins (deterministic, integer ≥ 1). */
  freeSpinsK: number;
  /** Starting multiplier value (typically 1). */
  multiplierInit: number;
  /** Per-drop increment added to running multiplier. */
  multiplierDropIncrement: number;
  /** Per-spin probability a drop occurs (0 ≤ q ≤ 1). */
  dropProbabilityPerSpin: number;
  /** Mean base win per FS (bet multiplier). */
  meanBaseWinPerSpinX: number;
  /** Variance of base win per FS. */
  varianceBaseWinPerSpinX: number;
}

export interface PersistentMultiplierResult {
  // Final multiplier statistics
  expectedFinalMultiplier: number;
  varianceFinalMultiplier: number;
  // Total payout statistics
  expectedTotalPayoutX: number;
  varianceTotalPayoutX: number;
  stdTotalPayoutX: number;
  // Per-spin running multiplier statistics
  expectedMultiplierAtSpinK: number;
  // Tail probabilities
  probNoDrops: number;
  probAllDrops: number;
  probAtLeastHalfDrops: number;
  // Decomposition
  expectedDropsTotal: number;
  varianceDropsTotal: number;
}

export interface PersistentMultiplierMCResult {
  episodes: number;
  totalDrops: number;
  totalPayoutX: number;
  observedMeanFinalMult: number;
  observedVarianceFinalMult: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: PersistentMultiplierConfig): void {
  if (!Number.isInteger(cfg.freeSpinsK) || cfg.freeSpinsK < 1) {
    throw new Error(`freeSpinsK must be an integer ≥ 1`);
  }
  if (!Number.isFinite(cfg.multiplierInit) || cfg.multiplierInit < 0) {
    throw new Error(`multiplierInit must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.multiplierDropIncrement) || cfg.multiplierDropIncrement <= 0) {
    throw new Error(`multiplierDropIncrement must be > 0`);
  }
  if (
    !Number.isFinite(cfg.dropProbabilityPerSpin) ||
    cfg.dropProbabilityPerSpin < 0 ||
    cfg.dropProbabilityPerSpin > 1
  ) {
    throw new Error(`dropProbabilityPerSpin must be in [0, 1]`);
  }
  if (!Number.isFinite(cfg.meanBaseWinPerSpinX) || cfg.meanBaseWinPerSpinX < 0) {
    throw new Error(`meanBaseWinPerSpinX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.varianceBaseWinPerSpinX) || cfg.varianceBaseWinPerSpinX < 0) {
    throw new Error(`varianceBaseWinPerSpinX must be ≥ 0`);
  }
}

// Binomial PMF P(X=k) = C(n,k)·p^k·(1-p)^(n-k)
function logBinomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let v = 0;
  for (let i = 1; i <= k; i++) v += Math.log((n - i + 1) / i);
  return v;
}

function binomCDFAtLeast(n: number, k: number, p: number): number {
  // P(X ≥ k) where X ~ Binomial(n, p)
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let sum = 0;
  const logP = Math.log(p);
  const log1MinusP = Math.log(1 - p);
  for (let j = k; j <= n; j++) {
    const logProb = logBinomCoeff(n, j) + j * logP + (n - j) * log1MinusP;
    sum += Math.exp(logProb);
  }
  return Math.min(1, Math.max(0, sum));
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solvePersistentMultiplier(
  config: PersistentMultiplierConfig,
): PersistentMultiplierResult {
  validate(config);
  const K = config.freeSpinsK;
  const m0 = config.multiplierInit;
  const md = config.multiplierDropIncrement;
  const q = config.dropProbabilityPerSpin;
  const muW = config.meanBaseWinPerSpinX;
  const sigma2W = config.varianceBaseWinPerSpinX;

  // Final multiplier: M_K = m0 + D_K · md, D_K ~ Binomial(K, q)
  const eMK = m0 + K * q * md;
  const varMK = K * q * (1 - q) * md * md;

  // Expected drops total
  const eDrops = K * q;
  const varDrops = K * q * (1 - q);

  // E[Y] = μ_W · Σ_{n=1..K} (m0 + n·q·md)
  //      = μ_W · (K·m0 + q·md · K(K+1)/2)
  const eY = muW * (K * m0 + q * md * K * (K + 1) / 2);

  // Var[Y]: Σ Var[W_n·M_n] + 2 Σ_{n<m} Cov(W_n·M_n, W_m·M_m)
  //
  // Var[W_n·M_n] = σ²_W·Var[M_n] + σ²_W·E[M_n]² + μ²_W·Var[M_n]
  // Cov(W_n·M_n, W_m·M_m) for n≠m, W's independent of M's, W_n iid W_m:
  //   = μ²_W · Cov(M_n, M_m)
  //   For Bernoulli drop indicators ξ_1,…,ξ_K iid Bern(q),
  //   D_n = Σ_{i≤n} ξ_i, M_n = m0 + D_n·md.
  //   Cov(M_n, M_m) = md² · Cov(D_n, D_m) = md² · min(n,m) · q·(1-q)

  let varY = 0;
  for (let n = 1; n <= K; n++) {
    const eMn = m0 + n * q * md;
    const varMn = n * q * (1 - q) * md * md;
    const varWnMn = sigma2W * varMn + sigma2W * eMn * eMn + muW * muW * varMn;
    varY += varWnMn;
  }
  // Cov sum: 2 · μ²_W · md²·q(1-q) · Σ_{n<m} min(n,m)
  //   For n < m, min(n,m) = n.
  //   Σ_{n=1..K-1} Σ_{m=n+1..K} n = Σ_{n=1..K-1} n·(K-n)
  //   = K·Σ n − Σ n² = K·(K-1)K/2 − (K-1)K(2K-1)/6
  //   For K = 1, sum = 0.
  let crossSum = 0;
  for (let n = 1; n < K; n++) {
    crossSum += n * (K - n);
  }
  varY += 2 * muW * muW * md * md * q * (1 - q) * crossSum;
  const stdY = Math.sqrt(Math.max(0, varY));

  // Tail probabilities (using exact Binomial)
  const probNoDrops = Math.pow(1 - q, K);
  const probAllDrops = Math.pow(q, K);
  const probAtLeastHalf = binomCDFAtLeast(K, Math.ceil(K / 2), q);

  return {
    expectedFinalMultiplier: eMK,
    varianceFinalMultiplier: varMK,
    expectedTotalPayoutX: eY,
    varianceTotalPayoutX: Math.max(0, varY),
    stdTotalPayoutX: stdY,
    expectedMultiplierAtSpinK: eMK,
    probNoDrops,
    probAllDrops,
    probAtLeastHalfDrops: probAtLeastHalf,
    expectedDropsTotal: eDrops,
    varianceDropsTotal: varDrops,
  };
}

// ── MC reference solver ────────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePayoutTwoPoint(rng: () => number, mu: number, sigma2: number): number {
  if (mu === 0) return 0;
  if (sigma2 <= 0) return mu;
  const x = mu + sigma2 / mu;
  const probability = (mu * mu) / (mu * mu + sigma2);
  return rng() < probability ? x : 0;
}

export function simulatePersistentMultiplier(
  config: PersistentMultiplierConfig,
  episodes: number,
  seed: number,
): PersistentMultiplierMCResult {
  validate(config);
  const rng = makePrng(seed);
  const K = config.freeSpinsK;
  const m0 = config.multiplierInit;
  const md = config.multiplierDropIncrement;
  const q = config.dropProbabilityPerSpin;
  const muW = config.meanBaseWinPerSpinX;
  const sigma2W = config.varianceBaseWinPerSpinX;

  let totalDrops = 0;
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let totalMK = 0;
  let totalMKSq = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let M = m0;
    let payout = 0;
    let drops = 0;
    for (let n = 1; n <= K; n++) {
      if (rng() < q) {
        M += md;
        drops++;
      }
      const w = samplePayoutTwoPoint(rng, muW, sigma2W);
      payout += w * M;
    }
    totalDrops += drops;
    totalPayout += payout;
    totalPayoutSq += payout * payout;
    totalMK += M;
    totalMKSq += M * M;
  }

  const meanY = totalPayout / episodes;
  const varianceY = Math.max(0, totalPayoutSq / episodes - meanY * meanY);
  const meanMK = totalMK / episodes;
  const varianceMK = Math.max(0, totalMKSq / episodes - meanMK * meanMK);

  return {
    episodes,
    totalDrops,
    totalPayoutX: totalPayout,
    observedMeanFinalMult: meanMK,
    observedVarianceFinalMult: varianceMK,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: varianceY,
  };
}
