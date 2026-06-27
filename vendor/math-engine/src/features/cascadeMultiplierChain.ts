/**
 * W152 Wave 121 — Cascade Multiplier Chain (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "lockstep conditional multiplier chain" mehaniku —
 * Quickspin Reactor Wilds / Push Gaming Token of Life / Hacksaw Cascade
 * Multiplier / BTG Megaways multiplier-on-win style. Multiplier raste
 * SAMO kada cascade ima win (skip-on-empty); chain se lomi kada empty
 * cascade pojavi.
 *
 * Naming policy (clean-room): "cascade", "multiplier chain", "lockstep"
 * = generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W86 Cascade Sequential Multiplier Pyramid — DETERMINISTIC ladder per cascade
 *     (M_k auto-increments regardless of win/empty)
 *   • W89 Persistent Multiplier Accumulator — Binomial drop chain (FS-only)
 *   • W102 Cluster Compound Variance — NO multiplier ladder (compound sum only)
 *   • W114 Sticky Wild Countdown — fixed N-spin lifetime, time-based not win-based
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Chain length L = number of consecutive WIN cascades:
 *   P(L = 0) = 1 − p  (initial cascade misses)
 *   P(L = k) = p^k · (1 − p)   for k ≥ 1   (k consecutive wins then break)
 *
 * Where p = winContinuationProbability (per-cascade win prob).
 * Equivalently L ~ Geometric distribution sa support {0, 1, 2, ...}, E[L] = p/(1−p).
 *
 * Per-cascade multiplier (only applied during win cascades k=1..L):
 *   linear:    M_k = base + (k−1) · step      (k = 1..L)
 *   geometric: M_k = base · ratio^(k−1)
 *
 * Per-cascade win value V_k iid ~ winValuePmf (given cascade is a win).
 *
 * Chain payout per spin:
 *   Y = Σ_{k=1..L} V_k · M_k   (zero when L = 0)
 *
 * Closed-form expectations (conditional independence V_k ⊥ L given L ≥ k):
 *   E[Y] = E[Σ_{k=1..L} V_k · M_k]
 *        = E[V] · Σ_{k=1..∞} M_k · P(L ≥ k)
 *        where P(L ≥ k) = p^k   (probability of at least k consecutive wins)
 *
 *   For linear M_k = base + (k−1)·step:
 *     Σ M_k · p^k = base · S₁ + step · S₂
 *       where S₁ = Σ p^k = p/(1−p)            (k=1..∞)
 *             S₂ = Σ (k−1)·p^k = p²/(1−p)²
 *
 *   For geometric M_k = base · r^(k−1):
 *     Σ M_k · p^k = base · Σ r^(k−1)·p^k = base · p · Σ (rp)^(k−1)
 *                 = base · p / (1 − rp)   (converges iff r·p < 1)
 *
 * Variance via second moment:
 *   E[Y²] = E[(Σ V_k · M_k)²]
 *         = Σ_k E[V_k² · M_k²]·P(L ≥ k) + 2·Σ_{j<k} E[V_j·M_j·V_k·M_k]·P(L ≥ k)
 *         = E[V²]·Σ M_k²·p^k + 2·E[V]²·Σ_{j<k} M_j·M_k · p^k
 *
 * Industry compliance:
 *   • UKGC RTS 14 — variance + max-multiplier disclosure
 *   • MGA PPD §11.f — chain volatility disclosure
 *   • eCOGRA Generic Slots Audit — verifies E[Y] / Var[Y] match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateCascadeMultiplierChain() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export type CascadeMultiplierGrowthMode = 'linear' | 'geometric';

export interface WinValuePmfEntry {
  /** Win value per cascade (in betX units, ≥ 0). */
  value: number;
  /** Probability of this value GIVEN cascade is a win (0 ≤ p ≤ 1, Σ ≈ 1). */
  probability: number;
}

export interface CascadeMultiplierChainConfig {
  /** Per-cascade win continuation probability (0 < p ≤ 1). */
  winContinuationProbability: number;
  /** Multiplier on the first win cascade (≥ 1). */
  baseMultiplier: number;
  /** Growth mode: linear (additive step) or geometric (multiplicative ratio). */
  growthMode: CascadeMultiplierGrowthMode;
  /** Linear step (only used when growthMode='linear'; default 0). */
  linearStep?: number;
  /** Geometric ratio (only used when growthMode='geometric'; default 1). */
  geometricRatio?: number;
  /** Conditional win value pmf (given cascade is a win). */
  winValuePmf: WinValuePmfEntry[];
  /** Optional chain-length cap K_max (default 1000 for numerical safety). */
  chainLengthCap?: number;
}

export interface CascadeMultiplierChainResult {
  winContinuationProbability: number;
  expectedChainLength: number; // E[L] = p/(1-p)
  varianceChainLength: number; // Var[L] = p/(1-p)²
  probZeroChain: number;       // P(L=0) = 1-p
  probReachLength: number[];   // P(L ≥ k) for k=0..chainLengthCap (truncated)
  // Per-cascade multipliers truncated at cap
  multipliersByCascadeLevel: number[]; // M_1..M_K
  maxMultiplier: number;
  // Win value moments
  expectedWinValuePerCascade: number;
  varianceWinValuePerCascade: number;
  expectedWinValueSquaredPerCascade: number;
  // Chain payout per spin
  expectedPayoutPerSpin: number;
  expectedPayoutSquaredPerSpin: number;
  variancePayoutPerSpin: number;
  // Operator disclosure
  truncationCap: number;
  truncationProbabilityRemaining: number; // P(L > cap), should be near 0
}

export interface CascadeMultiplierChainMCResult {
  spins: number;
  observedMeanChainLength: number;
  observedMeanPayoutPerSpin: number;
  observedVariancePayoutPerSpin: number;
  observedZeroChainFraction: number;
  observedMaxChainLength: number;
  observedMaxPayoutSeen: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: CascadeMultiplierChainConfig): void {
  const p = cfg.winContinuationProbability;
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`winContinuationProbability must be in (0, 1) (got ${p})`);
  }
  if (!Number.isFinite(cfg.baseMultiplier) || cfg.baseMultiplier < 1) {
    throw new Error(`baseMultiplier must be ≥ 1 (got ${cfg.baseMultiplier})`);
  }
  if (cfg.growthMode !== 'linear' && cfg.growthMode !== 'geometric') {
    throw new Error(`growthMode must be 'linear' or 'geometric'`);
  }
  if (cfg.growthMode === 'linear') {
    const step = cfg.linearStep ?? 0;
    if (!Number.isFinite(step) || step < 0) {
      throw new Error(`linearStep must be ≥ 0 (got ${step})`);
    }
  } else {
    const r = cfg.geometricRatio ?? 1;
    if (!Number.isFinite(r) || r < 1) {
      throw new Error(`geometricRatio must be ≥ 1 (got ${r})`);
    }
    // Convergence guard: r·p < 1 required for finite E[Y]
    if (r * p >= 1) {
      throw new Error(
        `geometricRatio·winContinuationProbability must be < 1 for finite E[Y] (got r·p = ${r * p})`,
      );
    }
  }
  if (!Array.isArray(cfg.winValuePmf) || cfg.winValuePmf.length === 0) {
    throw new Error(`winValuePmf must be non-empty`);
  }
  let sumP = 0;
  for (const e of cfg.winValuePmf) {
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`winValuePmf.value must be ≥ 0 (got ${e.value})`);
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`winValuePmf.probability must be in [0, 1] (got ${e.probability})`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`winValuePmf probabilities sum to ${sumP}, must be 1`);
  }
  if (cfg.chainLengthCap !== undefined) {
    if (!Number.isInteger(cfg.chainLengthCap) || cfg.chainLengthCap < 1) {
      throw new Error(`chainLengthCap must be positive integer ≥ 1 (got ${cfg.chainLengthCap})`);
    }
  }
}

// ── Solver helpers ─────────────────────────────────────────────────────────

function computeMultipliers(cfg: CascadeMultiplierChainConfig, K: number): number[] {
  const base = cfg.baseMultiplier;
  const out: number[] = new Array<number>(K);
  if (cfg.growthMode === 'linear') {
    const step = cfg.linearStep ?? 0;
    for (let k = 0; k < K; k++) out[k] = base + k * step;
  } else {
    const r = cfg.geometricRatio ?? 1;
    let m = base;
    for (let k = 0; k < K; k++) {
      out[k] = m;
      m *= r;
    }
  }
  return out;
}

function pmfMoments(pmf: WinValuePmfEntry[]): { e: number; e2: number; v: number } {
  let e = 0;
  let e2 = 0;
  for (const { value, probability } of pmf) {
    e += value * probability;
    e2 += value * value * probability;
  }
  return { e, e2, v: Math.max(0, e2 - e * e) };
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveCascadeMultiplierChain(
  config: CascadeMultiplierChainConfig,
): CascadeMultiplierChainResult {
  validate(config);
  const p = config.winContinuationProbability;
  const cap = config.chainLengthCap ?? 1000;

  // P(L ≥ k) = p^k for k = 0..cap (k=0 gives 1, k=1 gives p)
  const probReachLength: number[] = new Array<number>(cap + 1);
  probReachLength[0] = 1;
  for (let k = 1; k <= cap; k++) probReachLength[k] = probReachLength[k - 1] * p;

  // Probability mass beyond cap
  const truncationProbabilityRemaining = probReachLength[cap] * p; // P(L > cap)

  // Multipliers M_1..M_cap
  const M = computeMultipliers(config, cap);
  const maxM = M[cap - 1];

  // Win value moments (per win cascade, conditional)
  const { e: eV, e2: eV2, v: varV } = pmfMoments(config.winValuePmf);

  // E[Y] = E[V] · Σ_{k=1..cap} M_k · P(L ≥ k)
  let sumMP = 0;
  let sumM2P = 0;
  for (let k = 1; k <= cap; k++) {
    sumMP += M[k - 1] * probReachLength[k];
    sumM2P += M[k - 1] * M[k - 1] * probReachLength[k];
  }
  const eY = eV * sumMP;

  // E[Y²] = E[V²]·Σ M_k²·p^k + 2·E[V]²·Σ_{j<k} M_j·M_k·p^k
  // P(L ≥ k) = p^k. For j<k, P(both L≥j and L≥k) = P(L≥k) = p^k.
  let crossSum = 0;
  for (let k = 2; k <= cap; k++) {
    let innerSum = 0;
    for (let j = 1; j < k; j++) innerSum += M[j - 1];
    crossSum += innerSum * M[k - 1] * probReachLength[k];
  }
  const eY2 = eV2 * sumM2P + 2 * eV * eV * crossSum;
  const varY = Math.max(0, eY2 - eY * eY);

  // E[L] = p/(1-p), Var[L] = p/(1-p)²
  const eL = p / (1 - p);
  const varL = p / Math.pow(1 - p, 2);

  return {
    winContinuationProbability: p,
    expectedChainLength: eL,
    varianceChainLength: varL,
    probZeroChain: 1 - p,
    probReachLength,
    multipliersByCascadeLevel: M,
    maxMultiplier: maxM,
    expectedWinValuePerCascade: eV,
    expectedWinValueSquaredPerCascade: eV2,
    varianceWinValuePerCascade: varV,
    expectedPayoutPerSpin: eY,
    expectedPayoutSquaredPerSpin: eY2,
    variancePayoutPerSpin: varY,
    truncationCap: cap,
    truncationProbabilityRemaining,
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

function sampleWinValue(pmf: WinValuePmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

export function simulateCascadeMultiplierChain(
  config: CascadeMultiplierChainConfig,
  spins: number,
  seed: number,
): CascadeMultiplierChainMCResult {
  validate(config);
  const rng = makePrng(seed);
  const p = config.winContinuationProbability;
  const cap = config.chainLengthCap ?? 1000;
  const M = computeMultipliers(config, cap);

  let sumL = 0;
  let sumY = 0;
  let sumY2 = 0;
  let zeroChainCount = 0;
  let maxL = 0;
  let maxY = 0;

  for (let t = 0; t < spins; t++) {
    let L = 0;
    let chainPayout = 0;
    // Walk chain until empty cascade (no win)
    while (L < cap && rng() < p) {
      L++;
      const V = sampleWinValue(config.winValuePmf, rng());
      chainPayout += V * M[L - 1];
    }
    sumL += L;
    sumY += chainPayout;
    sumY2 += chainPayout * chainPayout;
    if (L === 0) zeroChainCount++;
    if (L > maxL) maxL = L;
    if (chainPayout > maxY) maxY = chainPayout;
  }

  const meanY = sumY / spins;
  const varY = Math.max(0, sumY2 / spins - meanY * meanY);

  return {
    spins,
    observedMeanChainLength: sumL / spins,
    observedMeanPayoutPerSpin: meanY,
    observedVariancePayoutPerSpin: varY,
    observedZeroChainFraction: zeroChainCount / spins,
    observedMaxChainLength: maxL,
    observedMaxPayoutSeen: maxY,
  };
}
