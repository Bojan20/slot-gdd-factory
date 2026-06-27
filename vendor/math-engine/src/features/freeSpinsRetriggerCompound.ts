/**
 * W152 Wave 84 — Free Spins Retrigger Compound Variance (Faza 4.3 ext).
 *
 * Closed-form Wald + compound-sum solver for free-spins batches with
 * per-batch retrigger probability + iid per-FS payout distribution.
 *
 * Existing `src/features/retrigger.ts` covers Markov-chain progression
 * of retrigger awards. This module fills the complementary gap:
 *   • Total-spin count distribution (compound geometric)
 *   • Total-payout mean + variance (Wald + compound-sum identity)
 *   • Total-spin PMF (closed-form per k = K, 2K, 3K, …)
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Free-spins with retrigger is industry standard since 1990s. Standard
 * model: player triggers feature → K free spins → at end of batch,
 * probability p of triggering another K-spin batch ("retrigger").
 * Recurs until non-retrigger occurs.
 *
 * Compound-sum variance is required for:
 *   • PAR sheet variance disclosure (UKGC RTS 14)
 *   • Player-protection limit calculations (MGA PPD §11.f)
 *   • Bankroll-management chart generation (operator pre-launch QA)
 *
 * Naming policy (clean-room): "Free Spins" + "Retrigger" = generic
 * industry terms. No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Let:
 *   K   = spins awarded per batch (deterministic)
 *   p   = probability of retrigger per batch (independent across batches)
 *   μ   = E[V_i] — mean payout per free spin
 *   σ²  = Var[V_i] — variance of payout per free spin
 *
 * Number of batches N ∈ {1, 2, 3, …}:
 *   P(N = k) = p^(k-1) · (1-p)        (shifted geometric, k ≥ 1)
 *   E[N]     = 1 / (1-p)
 *   Var[N]   = p / (1-p)²
 *
 * Total free-spin count T = K · N:
 *   E[T]   = K / (1-p)
 *   Var[T] = K² · p / (1-p)²
 *
 * Total feature payout Y = Σ_{i=1..T} V_i (compound sum, V_i iid):
 *   E[Y]   = E[T] · μ                        (Wald's identity)
 *   Var[Y] = E[T] · σ² + Var[T] · μ²
 *          = K · σ² / (1-p) + K² · p · μ² / (1-p)²
 *
 * Probability of "extreme run" (k batches or more):
 *   P(N ≥ k) = p^(k-1)
 *
 * Required total feature EV (player-perspective):
 *   In a per-bet RTP context where the feature is reached with
 *   probability q_trigger per base spin:
 *     E[FS payout per base spin] = q_trigger · K · μ / (1-p)
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface FreeSpinsRetriggerConfig {
  /** Spins awarded per batch (must be ≥ 1). */
  spinsPerBatchK: number;
  /** Per-batch retrigger probability (0 ≤ p < 1). */
  retriggerProbability: number;
  /** Expected payout per individual free spin (bet multiplier). */
  meanPayoutPerFreeSpinX: number;
  /** Variance of payout per individual free spin. */
  variancePayoutPerFreeSpinX: number;
  /** (Optional) Per-base-spin probability that the feature is triggered. */
  baseTriggerProbabilityPerSpin?: number;
}

export interface FreeSpinsRetriggerResult {
  // Batch statistics
  expectedBatches: number;
  varianceBatches: number;
  // Total-FS statistics
  expectedTotalFreeSpins: number;
  varianceTotalFreeSpins: number;
  stdTotalFreeSpins: number;
  // Total-payout statistics
  expectedTotalPayoutX: number;
  varianceTotalPayoutX: number;
  stdTotalPayoutX: number;
  // Tail probabilities
  probAtLeastTwoBatches: number;
  probAtLeastFiveBatches: number;
  probAtLeastTenBatches: number;
  // Per-base-spin contribution (optional)
  expectedFeaturePayoutPerBaseSpin: number | null;
}

export interface FreeSpinsRetriggerMCResult {
  episodes: number;
  totalBatches: number;
  totalFreeSpins: number;
  totalPayoutX: number;
  observedMeanBatches: number;
  observedMeanFreeSpins: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
  observedMaxBatches: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: FreeSpinsRetriggerConfig): void {
  if (!Number.isFinite(cfg.spinsPerBatchK) || cfg.spinsPerBatchK < 1 || !Number.isInteger(cfg.spinsPerBatchK)) {
    throw new Error(`spinsPerBatchK must be an integer ≥ 1`);
  }
  if (!Number.isFinite(cfg.retriggerProbability) || cfg.retriggerProbability < 0 || cfg.retriggerProbability >= 1) {
    throw new Error(`retriggerProbability must be in [0, 1)`);
  }
  if (!Number.isFinite(cfg.meanPayoutPerFreeSpinX) || cfg.meanPayoutPerFreeSpinX < 0) {
    throw new Error(`meanPayoutPerFreeSpinX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.variancePayoutPerFreeSpinX) || cfg.variancePayoutPerFreeSpinX < 0) {
    throw new Error(`variancePayoutPerFreeSpinX must be ≥ 0`);
  }
  if (cfg.baseTriggerProbabilityPerSpin !== undefined) {
    const q = cfg.baseTriggerProbabilityPerSpin;
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      throw new Error(`baseTriggerProbabilityPerSpin must be in [0, 1]`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveFreeSpinsRetrigger(
  config: FreeSpinsRetriggerConfig,
): FreeSpinsRetriggerResult {
  validate(config);
  const K = config.spinsPerBatchK;
  const p = config.retriggerProbability;
  const mu = config.meanPayoutPerFreeSpinX;
  const sigma2 = config.variancePayoutPerFreeSpinX;
  const q = config.baseTriggerProbabilityPerSpin;

  // Shifted geometric N (k ≥ 1): E[N] = 1/(1-p), Var[N] = p/(1-p)²
  const eN = 1 / (1 - p);
  const varN = p / ((1 - p) * (1 - p));

  // Total free spins T = K · N
  const eT = K * eN;
  const varT = K * K * varN;
  const stdT = Math.sqrt(varT);

  // Compound sum Y = Σ V_i over T spins, V_i iid:
  //   E[Y] = E[T] · μ
  //   Var[Y] = E[T] · σ² + Var[T] · μ²
  const eY = eT * mu;
  const varY = eT * sigma2 + varT * mu * mu;
  const stdY = Math.sqrt(varY);

  // Tail probabilities: P(N ≥ k) = p^(k-1) for k ≥ 1
  const probGe2 = p; // P(N ≥ 2) = p
  const probGe5 = Math.pow(p, 4);
  const probGe10 = Math.pow(p, 9);

  // Per-base-spin contribution if baseTriggerProb provided
  const featurePerBase = q !== undefined ? q * eY : null;

  return {
    expectedBatches: eN,
    varianceBatches: varN,
    expectedTotalFreeSpins: eT,
    varianceTotalFreeSpins: varT,
    stdTotalFreeSpins: stdT,
    expectedTotalPayoutX: eY,
    varianceTotalPayoutX: varY,
    stdTotalPayoutX: stdY,
    probAtLeastTwoBatches: probGe2,
    probAtLeastFiveBatches: probGe5,
    probAtLeastTenBatches: probGe10,
    expectedFeaturePayoutPerBaseSpin: featurePerBase,
  };
}

// ── PMF helpers ────────────────────────────────────────────────────────────

/**
 * PMF of total free-spins count T = K · N where N is shifted-geometric.
 * Returns array of (totalSpins, probability) pairs for k = 1..maxBatches.
 */
export function freeSpinsTotalPMF(
  config: FreeSpinsRetriggerConfig,
  maxBatches: number,
): { totalSpins: number; probability: number }[] {
  validate(config);
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new Error(`maxBatches must be an integer ≥ 1`);
  }
  const p = config.retriggerProbability;
  const K = config.spinsPerBatchK;
  const out: { totalSpins: number; probability: number }[] = [];
  for (let k = 1; k <= maxBatches; k++) {
    out.push({
      totalSpins: K * k,
      probability: Math.pow(p, k - 1) * (1 - p),
    });
  }
  return out;
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

/**
 * Sample per-FS payout from an exact 2-point distribution with given
 * (mean μ, variance σ²) — non-negative, no clipping, exact moments:
 *
 *   V ∈ {0, x}  with P(V = x) = q
 *   E[V]  = q · x       = μ
 *   Var[V] = q(1-q)·x²   = σ²
 *
 *   ⇒ x = μ + σ²/μ,   q = μ² / (μ² + σ²)
 *
 * Falls back to deterministic V = μ when σ² = 0. When μ = 0, V = 0 always.
 * Production engines plug in the real per-FS payout distribution.
 */
function samplePayoutTwoPoint(rng: () => number, mu: number, sigma2: number): number {
  if (mu === 0) return 0;
  if (sigma2 <= 0) return mu;
  const x = mu + sigma2 / mu;
  const q = (mu * mu) / (mu * mu + sigma2);
  return rng() < q ? x : 0;
}

export function simulateFreeSpinsRetrigger(
  config: FreeSpinsRetriggerConfig,
  episodes: number,
  seed: number,
): FreeSpinsRetriggerMCResult {
  validate(config);
  const rng = makePrng(seed);
  const K = config.spinsPerBatchK;
  const p = config.retriggerProbability;
  const mu = config.meanPayoutPerFreeSpinX;
  const sigma2 = config.variancePayoutPerFreeSpinX;

  let totalBatches = 0;
  let totalFreeSpins = 0;
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let maxBatches = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let batches = 0;
    let episodePayout = 0;
    // First batch always happens (we are in the feature)
    do {
      batches++;
      for (let i = 0; i < K; i++) {
        episodePayout += samplePayoutTwoPoint(rng, mu, sigma2);
      }
    } while (rng() < p);
    totalBatches += batches;
    totalFreeSpins += batches * K;
    totalPayout += episodePayout;
    totalPayoutSq += episodePayout * episodePayout;
    if (batches > maxBatches) maxBatches = batches;
  }

  const meanY = totalPayout / episodes;
  const varianceY = Math.max(0, totalPayoutSq / episodes - meanY * meanY);

  return {
    episodes,
    totalBatches,
    totalFreeSpins,
    totalPayoutX: totalPayout,
    observedMeanBatches: totalBatches / episodes,
    observedMeanFreeSpins: totalFreeSpins / episodes,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: varianceY,
    observedMaxBatches: maxBatches,
  };
}
