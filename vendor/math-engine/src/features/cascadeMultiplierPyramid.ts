/**
 * W152 Wave 86 — Cascade Sequential Multiplier Pyramid (Faza 12 ext).
 *
 * Closed-form solver za cascade chain sa per-step multiplier ladder.
 * Industry-standard model za:
 *   • "Sweet Bonanza"-style cascade + tumble multiplier collection
 *   • "Sugar Rush"-style escalating multipliers per cascade
 *   • "Wanted Dead or a Wild"-style sticky wild + cascade mult chain
 *
 * Naming policy (clean-room): "Cascade", "Multiplier Pyramid",
 * "Cascade chain" = generic industry terms. No vendor-specific
 * implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin episode:
 *   1. Base spin wins → triggers cascade chain.
 *   2. Each cascade step k = 1, 2, 3, …:
 *      a. Produces base win W_k ~ iid (mean μ_W, var σ²_W)
 *      b. Multiplier m_k applied (deterministic ladder: m_1, m_2, …, m_max).
 *      c. Step payout = W_k · m_k.
 *      d. With prob q, another cascade triggered; else episode ends.
 *
 *   Number of cascades N ∼ shifted-geometric:
 *     P(N = k) = q^(k-1) · (1 - q),   k = 1, 2, 3, …
 *     P(N ≥ k) = q^(k-1)
 *
 *   Multiplier ladder ceiling: m_k = m_max for k > maxLevel.
 *
 * Total episode payout Y = Σ_{k=1..N} W_k · m_k
 *
 *   E[Y] = E[Σ W_k · m_k]
 *        = μ_W · Σ_{k=1..∞} P(N ≥ k) · m_k                  (interchange)
 *
 *   For finite ladder with ceiling:
 *     E[Y] = μ_W · [ Σ_{k=1..L} q^(k-1) · m_k
 *                   + m_max · q^L / (1 - q) ]
 *   where L = maxLevel.
 *
 *   E[N] = 1 / (1 - q),    Var[N] = q / (1 - q)²
 *   E[T] = expected number of cascade steps = E[N]
 *
 *   For variance: full Var[Y] depends on covariance structure of
 *   m_k for varying N. We compute via conditional moments:
 *     E[Y | N=n] = μ_W · S_n          where S_n = Σ_{k=1..n} m_k
 *     Var[Y | N=n] = σ²_W · Σ_{k=1..n} m_k²
 *
 *   E[Y²] = E[ E[Y² | N] ]
 *         = E[ Var[Y|N] + E[Y|N]² ]
 *         = σ²_W · E[ Σ m_k² ] + μ²_W · E[ S_N² ]
 *
 *   Var[Y] = E[Y²] − E[Y]²
 *
 * Tail risk:
 *   P(N ≥ k) = q^(k-1)
 *   "Mega-hit" expected RTP = q^(maxLevel-1) · μ_W · m_max
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateCascadeMultiplierPyramid() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface CascadeMultiplierConfig {
  /** Per-step probability that another cascade triggers (0 ≤ q < 1). */
  cascadeContinuationProbability: number;
  /** Multiplier ladder per cascade step. m_1, m_2, …, m_max. */
  multiplierLadder: number[];
  /** Mean base win per cascade step (bet multiplier). */
  meanBaseWinPerStepX: number;
  /** Variance of base win per cascade step. */
  varianceBaseWinPerStepX: number;
}

export interface CascadeMultiplierResult {
  // Cascade chain statistics
  expectedCascades: number;
  varianceCascades: number;
  // Per-episode payout statistics
  expectedTotalPayoutX: number;
  varianceTotalPayoutX: number;
  stdTotalPayoutX: number;
  // Ladder reach
  expectedFinalMultiplier: number;
  // Tail probabilities
  probReachMaxLadder: number;
  probAtLeastFiveCascades: number;
  probAtLeastTenCascades: number;
  // Mega-hit contribution: E[payout from cascades at ladder ceiling]
  expectedMegaHitContribution: number;
}

export interface CascadeMultiplierMCResult {
  episodes: number;
  totalCascades: number;
  totalPayoutX: number;
  observedMeanCascades: number;
  observedMaxCascades: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
  observedFinalMultiplierAvg: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: CascadeMultiplierConfig): void {
  if (
    !Number.isFinite(cfg.cascadeContinuationProbability) ||
    cfg.cascadeContinuationProbability < 0 ||
    cfg.cascadeContinuationProbability >= 1
  ) {
    throw new Error(`cascadeContinuationProbability must be in [0, 1)`);
  }
  if (!Array.isArray(cfg.multiplierLadder) || cfg.multiplierLadder.length === 0) {
    throw new Error(`multiplierLadder must be a non-empty array`);
  }
  for (const m of cfg.multiplierLadder) {
    if (!Number.isFinite(m) || m < 0) {
      throw new Error(`multiplier ladder entry must be ≥ 0`);
    }
  }
  if (!Number.isFinite(cfg.meanBaseWinPerStepX) || cfg.meanBaseWinPerStepX < 0) {
    throw new Error(`meanBaseWinPerStepX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.varianceBaseWinPerStepX) || cfg.varianceBaseWinPerStepX < 0) {
    throw new Error(`varianceBaseWinPerStepX must be ≥ 0`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveCascadeMultiplierPyramid(
  config: CascadeMultiplierConfig,
): CascadeMultiplierResult {
  validate(config);
  const q = config.cascadeContinuationProbability;
  const ladder = config.multiplierLadder;
  const L = ladder.length;
  const mMax = ladder[L - 1];
  const muW = config.meanBaseWinPerStepX;
  const sigma2W = config.varianceBaseWinPerStepX;

  // Cascade chain stats: shifted-geometric (k = 1, 2, …)
  // P(N = k) = q^(k-1) · (1 - q)
  // P(N ≥ k) = q^(k-1)
  const eN = 1 / (1 - q);
  const varN = q / ((1 - q) * (1 - q));

  // Helper: m_k for k = 1, 2, …
  const m = (k: number): number => {
    if (k <= 0) return 0;
    return k <= L ? ladder[k - 1] : mMax;
  };

  // E[Y] = μ_W · Σ_{k=1..∞} P(N ≥ k) · m_k
  //      = μ_W · [ Σ_{k=1..L} q^(k-1) · m_k + Σ_{k>L} q^(k-1) · m_max ]
  //      = μ_W · [ Σ_{k=1..L} q^(k-1) · m_k + m_max · q^L · (1 + q + q² + …) ]
  //      = μ_W · [ Σ_{k=1..L} q^(k-1) · m_k + m_max · q^L / (1 - q) ]
  let eYBase = 0;
  for (let k = 1; k <= L; k++) {
    eYBase += Math.pow(q, k - 1) * ladder[k - 1];
  }
  const tailContribution = mMax * Math.pow(q, L) / (1 - q);
  const sumPSGTimesM = eYBase + tailContribution;
  const eY = muW * sumPSGTimesM;

  // E[final multiplier] = Σ_{k=1..∞} P(N=k) · m_k
  //                    = (1-q) · Σ_{k=1..L} q^(k-1) · m_k + q^L · m_max
  let eFinalMult = (1 - q) * eYBase + Math.pow(q, L) * mMax;

  // Compute E[S_N²] where S_n = Σ_{k=1..n} m_k for variance:
  //   E[S_N²] = Σ_{n=1..∞} P(N=n) · S_n²
  //   For practical computation we sum up to n = L + 50 (sufficient
  //   for q < 0.99 — tail decays geometrically as q^n).
  //   Beyond L the partial sum is S_n = S_L + (n - L) · m_max.
  let sumP = 0;
  let eSN = 0;
  let eSN2 = 0;
  let eSumM2 = 0; // E[Σ_{k=1..N} m_k²]
  let cumM = 0;
  let cumM2 = 0;
  for (let k = 1; k <= L; k++) {
    cumM += ladder[k - 1];
    cumM2 += ladder[k - 1] * ladder[k - 1];
    const pNk = Math.pow(q, k - 1) * (1 - q);
    sumP += pNk;
    eSN += pNk * cumM;
    eSN2 += pNk * cumM * cumM;
    eSumM2 += pNk * cumM2;
  }
  // Tail n > L: closed form sum
  // S_n = S_L + (n - L) · m_max
  // Σ_{k=1..n} m_k² = cumM2 + (n - L) · m_max²
  // P(N = n) = q^(n-1) · (1 - q)
  // We need Σ_{n>L} P(N=n) · [S_L + (n - L) · m_max]²
  //       + Σ_{n>L} P(N=n) · [cumM2 + (n - L) · m_max²]
  // Substitute j = n - L (j = 1, 2, …), P(N = L+j) = q^(L+j-1) · (1-q)
  //   Total tail prob = q^L (geometric sum)
  //   Σ_{j=1..∞} q^(L+j-1) · (1-q) · X(j) where X(j) is the per-cascade term
  //
  // Let A = S_L, B = m_max. Then S_n = A + j·B
  //   (A + j·B)² = A² + 2·A·B·j + B²·j²
  //   Σ q^(L+j-1) · (1-q) · (A + j·B)²
  //     = q^L · [ A² · 1 + 2·A·B · E_geo[j] + B² · E_geo[j²] ]
  //   where j ~ shifted-geometric on {1,2,…} with parameter q
  //     E_geo[j] = 1 / (1 - q)
  //     E_geo[j²] = (1 + q) / (1 - q)²
  //   Similarly for Σ m_k²: cumM2 + j·m_max²
  //     Σ q^(L+j-1) · (1-q) · (cumM2 + j·m_max²)
  //       = q^L · [ cumM2 + m_max² · E_geo[j] ]
  if (L > 0 && q > 0) {
    const A = cumM;
    const B = mMax;
    const eJ = 1 / (1 - q);
    const eJ2 = (1 + q) / ((1 - q) * (1 - q));
    const qPowL = Math.pow(q, L);
    const tailProb = qPowL; // Σ_{n>L} P(N=n) = q^L
    sumP += tailProb;
    // Tail SN contribution: q^L · [ A + B · E_geo[j] ] (only need E_geo[j], not E_geo[j²])
    eSN += qPowL * (A + B * eJ);
    // Tail SN² contribution: q^L · [ A² + 2·A·B·E_geo[j] + B²·E_geo[j²] ]
    eSN2 += qPowL * (A * A + 2 * A * B * eJ + B * B * eJ2);
    eSumM2 += qPowL * (cumM2 + (B * B) * eJ);
  }

  // E[Y²] = σ²_W · E[Σ m_k²] + μ²_W · E[S_N²]
  const eY2 = sigma2W * eSumM2 + muW * muW * eSN2;
  const varY = Math.max(0, eY2 - eY * eY);
  const stdY = Math.sqrt(varY);

  // Tail probabilities
  const probReachMax = Math.pow(q, L - 1);
  const probGe5 = Math.pow(q, 4);
  const probGe10 = Math.pow(q, 9);

  // Mega-hit contribution: E[payout from steps at ladder ceiling]
  // = μ_W · m_max · Σ_{k > L} P(N ≥ k) = μ_W · m_max · q^L / (1 - q) (tail steps)
  // PLUS the L-th step if L is ladder ceiling.
  const megaHit = muW * mMax * Math.pow(q, L - 1);

  return {
    expectedCascades: eN,
    varianceCascades: varN,
    expectedTotalPayoutX: eY,
    varianceTotalPayoutX: varY,
    stdTotalPayoutX: stdY,
    expectedFinalMultiplier: eFinalMult,
    probReachMaxLadder: probReachMax,
    probAtLeastFiveCascades: probGe5,
    probAtLeastTenCascades: probGe10,
    expectedMegaHitContribution: megaHit,
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

export function simulateCascadeMultiplierPyramid(
  config: CascadeMultiplierConfig,
  episodes: number,
  seed: number,
): CascadeMultiplierMCResult {
  validate(config);
  const rng = makePrng(seed);
  const q = config.cascadeContinuationProbability;
  const ladder = config.multiplierLadder;
  const L = ladder.length;
  const mMax = ladder[L - 1];
  const muW = config.meanBaseWinPerStepX;
  const sigma2W = config.varianceBaseWinPerStepX;

  let totalCascades = 0;
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let maxCascades = 0;
  let totalFinalMult = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let n = 0;
    let payout = 0;
    do {
      n++;
      const w = samplePayoutTwoPoint(rng, muW, sigma2W);
      const m = n <= L ? ladder[n - 1] : mMax;
      payout += w * m;
    } while (rng() < q);
    totalCascades += n;
    totalPayout += payout;
    totalPayoutSq += payout * payout;
    if (n > maxCascades) maxCascades = n;
    totalFinalMult += n <= L ? ladder[n - 1] : mMax;
  }

  const meanY = totalPayout / episodes;
  const varianceY = Math.max(0, totalPayoutSq / episodes - meanY * meanY);

  return {
    episodes,
    totalCascades,
    totalPayoutX: totalPayout,
    observedMeanCascades: totalCascades / episodes,
    observedMaxCascades: maxCascades,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: varianceY,
    observedFinalMultiplierAvg: totalFinalMult / episodes,
  };
}
