/**
 * W152 Wave 97 — Free Spins Lookback Multiplier Aggregator (Faza 4.3 ext).
 *
 * Closed-form solver za "lookback multiplier" mehaniku — Push Money Cart 4 /
 * Hacksaw / select Pragmatic features gde se posle K free spins iznad sumiranih
 * win-ova primenjuje JEDAN multiplier (random iz distribucije).
 *
 * Distinct from:
 *   W86 (cascade ladder applies per-step)
 *   W89 (persistent mult accumulates during)
 *   W93 (multiplicative wild stack applied to single win)
 *
 * Ovde: multiplier se KASNIJE primenjuje na CELO sumirano osvojeno.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Inputs:
 *   K        = number of free spins (deterministic ≥ 1)
 *   W_1..W_K = per-FS base win, iid sa (μ_W, σ²_W)
 *   M        = lookback multiplier, random iz discrete distribucije
 *              μ_M = E[M], σ²_M = Var[M]
 *
 * Per episode:
 *   S_K = Σ_{i=1..K} W_i        (sum of K iid wins)
 *   Y   = M · S_K                (lookback multiplier applied)
 *
 * S_K moments:
 *   E[S_K]   = K · μ_W
 *   Var[S_K] = K · σ²_W
 *   E[S²_K]  = Var[S_K] + E[S_K]² = K·σ²_W + K²·μ²_W
 *
 * Lookback payout Y = M · S_K, M and S_K independent:
 *   E[Y]   = E[M] · E[S_K] = μ_M · K · μ_W
 *   E[Y²]  = E[M²] · E[S²_K] = (σ²_M + μ²_M) · (K·σ²_W + K²·μ²_W)
 *   Var[Y] = E[Y²] − E[Y]²
 *          = (σ²_M + μ²_M)·(K·σ²_W + K²·μ²_W) − μ²_M·K²·μ²_W
 *          = K·σ²_W·(σ²_M + μ²_M)  + K²·μ²_W·σ²_M
 *
 * Tail risk:
 *   P(M = m_max) = p_max (probability of best-case multiplier)
 *   E[Y | M = m_max] = m_max · K · μ_W (best-case mean)
 *   Max possible Y = m_max · K · w_max (assuming W bounded by w_max, deterministic)
 *
 * Per-base-spin contribution:
 *   E[feature payout per base spin] = q_trigger · E[Y]
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateFreeSpinsLookbackMultiplier() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface LookbackMultiplierOutcome {
  /** Display label. */
  label: string;
  /** Multiplier value. */
  valueX: number;
  /** Weight (probability proportional). */
  weight: number;
}

export interface FreeSpinsLookbackConfig {
  /** Number of free spins (integer ≥ 1). */
  freeSpinsK: number;
  /** Mean base win per FS. */
  meanBaseWinPerSpinX: number;
  /** Variance of base win per FS. */
  varianceBaseWinPerSpinX: number;
  /** Lookback multiplier distribution (applied to total). */
  multiplierDistribution: LookbackMultiplierOutcome[];
  /** (Optional) Per-base-spin trigger probability. */
  baseTriggerProbabilityPerSpin?: number;
}

export interface FreeSpinsLookbackResult {
  // Sum statistics
  expectedSumOverK: number;
  varianceSumOverK: number;
  // Multiplier moments
  expectedMultiplier: number;
  varianceMultiplier: number;
  maxMultiplier: number;
  probMaxMultiplier: number;
  // Total payout
  expectedTotalPayoutX: number;
  varianceTotalPayoutX: number;
  stdTotalPayoutX: number;
  // Tail
  expectedTotalIfMaxMultiplier: number;
  // Per-base-spin
  expectedFeaturePayoutPerBaseSpin: number | null;
}

export interface FreeSpinsLookbackMCResult {
  episodes: number;
  totalPayoutX: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
  observedMeanSumS: number;
  observedMeanMultiplier: number;
  observedMaxMultObserved: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: FreeSpinsLookbackConfig): void {
  if (!Number.isInteger(cfg.freeSpinsK) || cfg.freeSpinsK < 1) {
    throw new Error(`freeSpinsK must be integer ≥ 1`);
  }
  if (!Number.isFinite(cfg.meanBaseWinPerSpinX) || cfg.meanBaseWinPerSpinX < 0) {
    throw new Error(`meanBaseWinPerSpinX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.varianceBaseWinPerSpinX) || cfg.varianceBaseWinPerSpinX < 0) {
    throw new Error(`varianceBaseWinPerSpinX must be ≥ 0`);
  }
  if (!Array.isArray(cfg.multiplierDistribution) || cfg.multiplierDistribution.length === 0) {
    throw new Error(`multiplierDistribution must be non-empty`);
  }
  const seen = new Set<string>();
  for (const o of cfg.multiplierDistribution) {
    if (typeof o.label !== 'string' || o.label.length === 0) {
      throw new Error(`mult outcome label must be non-empty`);
    }
    if (seen.has(o.label)) throw new Error(`duplicate label: ${o.label}`);
    seen.add(o.label);
    if (!Number.isFinite(o.valueX) || o.valueX <= 0) {
      throw new Error(`outcome ${o.label}: valueX must be > 0`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`outcome ${o.label}: weight must be > 0`);
    }
  }
  if (cfg.baseTriggerProbabilityPerSpin !== undefined) {
    const q = cfg.baseTriggerProbabilityPerSpin;
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      throw new Error(`baseTriggerProbabilityPerSpin must be in [0, 1]`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveFreeSpinsLookbackMultiplier(
  config: FreeSpinsLookbackConfig,
): FreeSpinsLookbackResult {
  validate(config);
  const K = config.freeSpinsK;
  const muW = config.meanBaseWinPerSpinX;
  const sigma2W = config.varianceBaseWinPerSpinX;
  const dist = config.multiplierDistribution;

  // Multiplier distribution moments
  const sumW = dist.reduce((a, o) => a + o.weight, 0);
  let muM = 0;
  let eM2 = 0;
  let maxM = 0;
  let pMax = 0;
  for (const o of dist) {
    const p = o.weight / sumW;
    muM += p * o.valueX;
    eM2 += p * o.valueX * o.valueX;
    if (o.valueX > maxM) {
      maxM = o.valueX;
      pMax = p;
    } else if (o.valueX === maxM) {
      pMax += p;
    }
  }
  const varM = Math.max(0, eM2 - muM * muM);

  // S_K = Σ W_i, iid:
  //   E[S_K]   = K·μ_W
  //   Var[S_K] = K·σ²_W
  //   E[S²_K]  = K·σ²_W + K²·μ²_W
  const eSK = K * muW;
  const varSK = K * sigma2W;
  const eSK2 = varSK + eSK * eSK;

  // Y = M·S_K, M and S_K independent
  //   E[Y]   = μ_M · K·μ_W
  //   E[Y²]  = E[M²] · E[S²_K]
  //   Var[Y] = E[Y²] − E[Y]²
  const eY = muM * eSK;
  const eY2 = eM2 * eSK2;
  const varY = Math.max(0, eY2 - eY * eY);
  const stdY = Math.sqrt(varY);

  // Tail
  const eYIfMaxM = maxM * eSK;

  // Per-base-spin contribution
  const q = config.baseTriggerProbabilityPerSpin;
  const featurePerBase = q !== undefined ? q * eY : null;

  return {
    expectedSumOverK: eSK,
    varianceSumOverK: varSK,
    expectedMultiplier: muM,
    varianceMultiplier: varM,
    maxMultiplier: maxM,
    probMaxMultiplier: pMax,
    expectedTotalPayoutX: eY,
    varianceTotalPayoutX: varY,
    stdTotalPayoutX: stdY,
    expectedTotalIfMaxMultiplier: eYIfMaxM,
    expectedFeaturePayoutPerBaseSpin: featurePerBase,
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

export function simulateFreeSpinsLookbackMultiplier(
  config: FreeSpinsLookbackConfig,
  episodes: number,
  seed: number,
): FreeSpinsLookbackMCResult {
  validate(config);
  const rng = makePrng(seed);
  const K = config.freeSpinsK;
  const muW = config.meanBaseWinPerSpinX;
  const sigma2W = config.varianceBaseWinPerSpinX;
  const dist = config.multiplierDistribution;
  const sumW = dist.reduce((a, o) => a + o.weight, 0);
  const Nd = dist.length;
  const cum: number[] = new Array<number>(Nd);
  {
    let running = 0;
    for (let i = 0; i < Nd; i++) {
      running += dist[i].weight / sumW;
      cum[i] = running;
    }
    cum[Nd - 1] = 1;
  }

  let totalPayout = 0;
  let totalPayoutSq = 0;
  let totalSumS = 0;
  let totalMult = 0;
  let maxObserved = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let sumS = 0;
    for (let i = 0; i < K; i++) {
      sumS += samplePayoutTwoPoint(rng, muW, sigma2W);
    }
    // Sample multiplier
    const u = rng();
    let idx = Nd - 1;
    for (let j = 0; j < Nd; j++) {
      if (u < cum[j]) { idx = j; break; }
    }
    const mult = dist[idx].valueX;
    const payout = mult * sumS;
    totalPayout += payout;
    totalPayoutSq += payout * payout;
    totalSumS += sumS;
    totalMult += mult;
    if (mult > maxObserved) maxObserved = mult;
  }

  const meanY = totalPayout / episodes;
  const variance = Math.max(0, totalPayoutSq / episodes - meanY * meanY);

  return {
    episodes,
    totalPayoutX: totalPayout,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: variance,
    observedMeanSumS: totalSumS / episodes,
    observedMeanMultiplier: totalMult / episodes,
    observedMaxMultObserved: maxObserved,
  };
}
