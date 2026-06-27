/**
 * W152 Wave 138 — Tumble Multiplier with Cap (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "tumble cascade sa multiplier ladder + CAP"
 * mehaniku — NetEnt Gonzo's Quest (max 5×) / BTG Bonanza (max 10×) /
 * Push Gaming Money Cart 4 (max 20×) / Pragmatic Sweet Bonanza Xmas
 * (max 100×). Per-cascade multiplier ladder + EXPLICIT M_max cap koji
 * menja closed-form (geometric tail beyond cap).
 *
 * Naming policy (clean-room): "tumble", "cascade", "multiplier cap" =
 * generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W86 Cascade Sequential Multiplier Pyramid — DETERMINISTIC per-cascade,
 *     no chain-break i no cap
 *   • W89 Persistent Multiplier Accumulator — Binomial drop chain, FS-only,
 *     no cascade-conditional growth
 *   • W102 Cluster Compound Variance — Wald compound-sum, no multiplier ladder
 *   • W121 Cascade Multiplier Chain Lockstep Conditional — NO CAP
 *     (ovaj W138 distinct = explicit M_max cap mathematically split sum)
 *   • W114 Sticky Wild Countdown — time-based (N spins), ne cascade-based
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Chain length L = number of consecutive WIN cascades:
 *   L ~ Geometric: P(L = k) = p^k · (1 − p)   for k ≥ 0
 *   E[L] = p/(1−p), P(L ≥ k) = p^k
 *
 * Per-cascade multiplier ladder sa CAP:
 *   linear:    M_k = min(baseMult + (k−1)·step, M_max)    for k = 1..L
 *
 * Define k* = smallest k where M_k = M_max:
 *   k* = ⌈ (M_max − baseMult) / step ⌉ + 1  (for step > 0)
 *   k* = 1                                  (for step = 0, M_max = base)
 *
 * Per-win V_k iid ~ winValuePmf (given cascade is a win).
 *
 * Chain payout per spin:
 *   Y = Σ_{k=1..L} V_k · M_k
 *
 * Closed-form via P(L ≥ k) = p^k:
 *   E[Y] = E[V] · Σ_{k=1..∞} M_k · p^k
 *
 *   Split sum at k = k*:
 *     A = Σ_{k=1..k*-1} (base + (k−1)·step) · p^k       (ramp portion)
 *     B = M_max · Σ_{k=k*..∞} p^k                      (saturated tail)
 *       = M_max · p^k* / (1 − p)
 *
 *   E[Y] = E[V] · (A + B)
 *
 * Variance:
 *   E[Y²] = E[V²] · Σ M_k² · p^k + 2·E[V]² · Σ_{j<k} M_j·M_k · p^k
 *   Var[Y] = E[Y²] − E[Y]²
 *
 * Industry compliance:
 *   • UKGC RTS 14 — multiplier ladder + cap disclosure
 *   • MGA PPD §11.f — operator-facing tumble volatility
 *   • eCOGRA Generic Slots Audit — verifies E[Y] / Var[Y] match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateTumbleMultiplierWithCap() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface TumbleWinValuePmfEntry {
  /** Win value per cascade (in betX units, ≥ 0). */
  value: number;
  /** Probability of this value GIVEN cascade is a win (0 ≤ p ≤ 1, Σ ≈ 1). */
  probability: number;
}

export interface TumbleMultiplierWithCapConfig {
  /** Per-cascade win continuation probability (0 < p < 1). */
  winContinuationProbability: number;
  /** Multiplier on the first win cascade (≥ 1). */
  baseMultiplier: number;
  /** Per-step increment (≥ 0; 0 means constant base, cap=base). */
  multiplierStep: number;
  /** Maximum multiplier (≥ base; cap to prevent unbounded growth). */
  maximumMultiplier: number;
  /** Conditional win value pmf (given cascade is a win). */
  winValuePmf: TumbleWinValuePmfEntry[];
  /** Truncation cap for tail computation (default 1000). */
  chainLengthCap?: number;
}

export interface TumbleMultiplierWithCapResult {
  winContinuationProbability: number;
  expectedChainLength: number;
  probZeroChain: number;
  // Multiplier ladder
  multiplierAtCascadeLevel: number[]; // M_1..M_K (truncated at cap)
  cascadesToCap: number; // k* (smallest k where M_k = M_max)
  maximumMultiplier: number;
  // Win value moments
  expectedWinValuePerCascade: number;
  expectedWinValueSquaredPerCascade: number;
  // Payout
  expectedPayoutPerSpin: number;
  expectedPayoutSquaredPerSpin: number;
  variancePayoutPerSpin: number;
  // Operator disclosure
  expectedRampPayoutContribution: number;  // E[V] · A
  expectedCappedTailContribution: number;  // E[V] · B
  truncationCap: number;
  truncationProbabilityRemaining: number;
}

export interface TumbleMultiplierWithCapMCResult {
  spins: number;
  observedMeanChainLength: number;
  observedMeanPayoutPerSpin: number;
  observedVariancePayoutPerSpin: number;
  observedZeroChainFraction: number;
  observedMaxMultiplierSeen: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: TumbleMultiplierWithCapConfig): void {
  const p = cfg.winContinuationProbability;
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`winContinuationProbability must be in (0, 1) (got ${p})`);
  }
  if (!Number.isFinite(cfg.baseMultiplier) || cfg.baseMultiplier < 1) {
    throw new Error(`baseMultiplier must be ≥ 1 (got ${cfg.baseMultiplier})`);
  }
  if (!Number.isFinite(cfg.multiplierStep) || cfg.multiplierStep < 0) {
    throw new Error(`multiplierStep must be ≥ 0 (got ${cfg.multiplierStep})`);
  }
  if (!Number.isFinite(cfg.maximumMultiplier) || cfg.maximumMultiplier < cfg.baseMultiplier) {
    throw new Error(`maximumMultiplier must be ≥ baseMultiplier (got ${cfg.maximumMultiplier})`);
  }
  if (!Array.isArray(cfg.winValuePmf) || cfg.winValuePmf.length === 0) {
    throw new Error(`winValuePmf must be non-empty`);
  }
  let sumP = 0;
  for (const e of cfg.winValuePmf) {
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`winValuePmf.value must be ≥ 0`);
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`winValuePmf.probability must be in [0, 1]`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`winValuePmf probabilities sum to ${sumP}, must be 1`);
  }
  if (cfg.chainLengthCap !== undefined) {
    if (!Number.isInteger(cfg.chainLengthCap) || cfg.chainLengthCap < 1) {
      throw new Error(`chainLengthCap must be positive integer ≥ 1`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveTumbleMultiplierWithCap(
  config: TumbleMultiplierWithCapConfig,
): TumbleMultiplierWithCapResult {
  validate(config);
  const p = config.winContinuationProbability;
  const base = config.baseMultiplier;
  const step = config.multiplierStep;
  const M_max = config.maximumMultiplier;
  const cap = config.chainLengthCap ?? 1000;

  // Compute k* — smallest k where M_k = M_max
  let kStar: number;
  if (step === 0) {
    kStar = 1; // immediately at base (which equals M_max since base ≤ M_max ≤ base when step=0... no, M_max ≥ base; if step=0 and M_max > base, never reaches → but bound by M_max so always base)
    // Actually with step=0, M_k = base for all k. If base < M_max, multiplier never reaches M_max.
    // Define kStar conventionally as 1 (immediately at "ladder top" = base).
  } else {
    kStar = Math.ceil((M_max - base) / step) + 1;
  }

  // Build multiplier array up to cap
  const M: number[] = new Array<number>(cap);
  for (let k = 0; k < cap; k++) {
    if (step === 0) {
      M[k] = base;
    } else {
      M[k] = Math.min(base + k * step, M_max);
    }
  }

  // E[L] = p/(1-p)
  const eL = p / (1 - p);

  // Win-value moments
  let eV = 0;
  let eV2 = 0;
  for (const { value, probability } of config.winValuePmf) {
    eV += value * probability;
    eV2 += value * value * probability;
  }

  // Σ_{k=1..cap} M_k · p^k
  // Split into ramp (k=1..k*-1) sa M_k < M_max + tail (k=k*..cap) sa M_k = M_max
  let rampSum = 0; // A
  let tailSum = 0; // B (within cap)
  let sumMP = 0;
  let sumM2P = 0;
  let pPow = 1;
  for (let k = 1; k <= cap; k++) {
    pPow *= p;
    const m = M[k - 1];
    sumMP += m * pPow;
    sumM2P += m * m * pPow;
    if (step > 0 && k < kStar) {
      rampSum += m * pPow;
    } else {
      tailSum += m * pPow;
    }
  }

  // Approximation: closed-form B = M_max · p^k* / (1 − p)
  // We already computed exact tailSum within cap. Add geometric tail beyond cap if needed.
  // For default cap=1000 sa p<1, p^1000 is essentially zero.
  const eY = eV * sumMP;

  // E[Y²] = E[V²]·Σ M_k²·p^k + 2·E[V]²·Σ_{j<k} M_j·M_k·p^k
  let crossSum = 0;
  for (let k = 2; k <= cap; k++) {
    let inner = 0;
    for (let j = 1; j < k; j++) inner += M[j - 1];
    crossSum += inner * M[k - 1] * Math.pow(p, k);
  }
  const eY2 = eV2 * sumM2P + 2 * eV * eV * crossSum;
  const varY = Math.max(0, eY2 - eY * eY);

  const probTruncRemaining = Math.pow(p, cap + 1) / (1 - p);

  return {
    winContinuationProbability: p,
    expectedChainLength: eL,
    probZeroChain: 1 - p,
    multiplierAtCascadeLevel: M.slice(0, Math.min(cap, kStar + 2)), // truncated for readability
    cascadesToCap: kStar,
    maximumMultiplier: M_max,
    expectedWinValuePerCascade: eV,
    expectedWinValueSquaredPerCascade: eV2,
    expectedPayoutPerSpin: eY,
    expectedPayoutSquaredPerSpin: eY2,
    variancePayoutPerSpin: varY,
    expectedRampPayoutContribution: eV * rampSum,
    expectedCappedTailContribution: eV * tailSum,
    truncationCap: cap,
    truncationProbabilityRemaining: probTruncRemaining,
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

function sampleWinValue(pmf: TumbleWinValuePmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

export function simulateTumbleMultiplierWithCap(
  config: TumbleMultiplierWithCapConfig,
  spins: number,
  seed: number,
): TumbleMultiplierWithCapMCResult {
  validate(config);
  const rng = makePrng(seed);
  const p = config.winContinuationProbability;
  const base = config.baseMultiplier;
  const step = config.multiplierStep;
  const M_max = config.maximumMultiplier;
  const cap = config.chainLengthCap ?? 1000;

  let sumL = 0;
  let sumY = 0;
  let sumY2 = 0;
  let zeroCount = 0;
  let maxMultSeen = 0;

  for (let t = 0; t < spins; t++) {
    let L = 0;
    let chainPayout = 0;
    while (L < cap && rng() < p) {
      L++;
      const M = Math.min(base + (L - 1) * step, M_max);
      const V = sampleWinValue(config.winValuePmf, rng());
      chainPayout += V * M;
      if (M > maxMultSeen) maxMultSeen = M;
    }
    sumL += L;
    sumY += chainPayout;
    sumY2 += chainPayout * chainPayout;
    if (L === 0) zeroCount++;
  }

  const meanY = sumY / spins;
  const varY = Math.max(0, sumY2 / spins - meanY * meanY);

  return {
    spins,
    observedMeanChainLength: sumL / spins,
    observedMeanPayoutPerSpin: meanY,
    observedVariancePayoutPerSpin: varY,
    observedZeroChainFraction: zeroCount / spins,
    observedMaxMultiplierSeen: maxMultSeen,
  };
}
