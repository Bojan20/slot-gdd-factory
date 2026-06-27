/**
 * W152 Wave 150 — Voltage/XP Meter Multi-Tier Reward Levels (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "multi-tier voltage/XP meter reward" mehaniku —
 * Hacksaw Stack 'Em (multi-tier boost levels) / Push Wild Swarm (power-up
 * tiers) / NetEnt Charged (XP bar 3-tier reward) / Yggdrasil Vault of
 * Anubis multi-step charge / Inspired XP bar / Hacksaw Aztec Magic
 * Deluxe Bonanza voltage meter / Push Aztec Bonanza (multi-tier).
 *
 * Naming policy (clean-room): "voltage meter", "XP bar", "multi-tier",
 * "tier reward" = generic industry terms. No vendor TM.
 *
 * ── Difference vs prior Wxx solvers ───────────────────────────────────────
 *   • W146 Cascade Meter Charge-Up — SINGLE threshold T, count fires
 *     F = ⌊L/T⌋ ~ Geometric(1-p^T); ovaj solver MULTIPLE thresholds T_1
 *     < T_2 < ... < T_K sa K-tier reward structure
 *   • W138 Tumble Multiplier with Cap — per-cascade ladder M_k=min(base+
 *     (k-1)·step, M_max); ovaj solver tier crossed once per spin (not
 *     per-cascade)
 *   • W118 Bonus Collect-N — collect-N tokens base-game; ovaj solver
 *     in-spin cascade-driven voltage
 *   • W101 Symbol Upgrade Chain — count-based upgrades, no tier rewards
 *   • W50 Charge Meter — stationary steady-state, no chain
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin: cascade chain L ~ Geometric(1−p), L = 0, 1, 2, ...
 *   P(L = ℓ) = p^ℓ · (1 − p), P(L ≥ ℓ) = p^ℓ
 *
 * K voltage tiers sa thresholds T_1 < T_2 < ... < T_K and rewards
 *   R_1, R_2, ..., R_K (in X bet units, non-negative).
 *
 * "Highest tier reached" H = max{k : L ≥ T_k}, or 0 if L < T_1.
 *
 * Two configurable reward modes:
 *
 *   MODE 1 — "highest-only" (Push Wild Swarm style):
 *     Per-spin reward = R_H (R_0 = 0 if no tier reached)
 *     P(H = k) = P(L ≥ T_k) − P(L ≥ T_{k+1})
 *              = p^{T_k} − p^{T_{k+1}}  (T_{K+1} = ∞, p^∞ = 0)
 *     E[reward] = Σ_{k=1}^{K} R_k · (p^{T_k} − p^{T_{k+1}})
 *               = R_1·p^{T_1} + Σ_{k=2}^{K} (R_k − R_{k-1})·p^{T_k}
 *                 (telescoping form for monotone R_k)
 *
 *   MODE 2 — "cumulative" (Hacksaw Stack 'Em / Yggdrasil multi-step style):
 *     Per-spin reward = Σ_{k: L ≥ T_k} R_k
 *     E[reward] = Σ_{k=1}^{K} R_k · P(L ≥ T_k) = Σ_{k=1}^{K} R_k · p^{T_k}
 *
 * Variance:
 *   MODE 1: E[reward²] = Σ_k R_k² · (p^{T_k} − p^{T_{k+1}})
 *           Var = E[reward²] − E[reward]²
 *
 *   MODE 2: E[reward²] = Σ_k R_k² · p^{T_k}
 *           + 2 · Σ_{i<j} R_i · R_j · p^{T_j}  (P(L ≥ T_j) since T_j ≥ T_i)
 *           Var = E[reward²] − E[reward]²
 *
 * ── Compliance ────────────────────────────────────────────────────────────
 *   • UKGC RTS 14 — multi-tier reward frequency disclosure (per tier hit rate)
 *   • MGA PPD §11.f — operator-facing tier mechanic transparency
 *   • eCOGRA Generic Slots Audit — verifies per-tier hit rates match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateVoltageMeterMultiTier() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export type VoltageMeterRewardMode = 'highest-only' | 'cumulative';

export interface VoltageMeterTier {
  /** Voltage/XP threshold (positive integer; cumulative chain wins to cross). */
  threshold: number;
  /** Reward for crossing this tier (X bet units, non-negative). */
  rewardX: number;
}

export interface VoltageMeterMultiTierConfig {
  /** Cascade continuation probability p (0 < p < 1). L ~ Geometric(1-p). */
  cascadeContinuationProbability: number;
  /** Tier list, MUST be sorted by threshold ascending. */
  tiers: VoltageMeterTier[];
  /** Reward aggregation mode. */
  rewardMode: VoltageMeterRewardMode;
}

export interface VoltageMeterMultiTierResult {
  cascadeContinuationProbability: number;
  rewardMode: VoltageMeterRewardMode;
  tierCount: number;
  /** Per-tier hit probability: P(L ≥ T_k) for each tier. */
  perTierHitProbability: number[];
  /** Per-tier "exact-highest" probability: P(H = k) for each tier. Sum + P(H=0) = 1. */
  perTierExactHighestProbability: number[];
  /** P(no tier reached) = P(H = 0) = 1 − p^{T_1}. */
  probNoTierReached: number;
  /** Expected reward per spin under selected mode. */
  expectedRewardPerSpin: number;
  /** Variance of reward per spin. */
  varianceRewardPerSpin: number;
}

export interface VoltageMeterMultiTierMcResult {
  spins: number;
  observedMeanRewardPerSpin: number;
  observedPerTierHitFraction: number[];
  observedPerTierExactHighestFraction: number[];
  observedNoTierReachedFraction: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateConfig(cfg: VoltageMeterMultiTierConfig): void {
  if (!(cfg.cascadeContinuationProbability > 0 && cfg.cascadeContinuationProbability < 1)) {
    throw new Error(`cascadeContinuationProbability must be in (0, 1) (got ${cfg.cascadeContinuationProbability})`);
  }
  if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) {
    throw new Error('tiers must be non-empty array');
  }
  if (cfg.rewardMode !== 'highest-only' && cfg.rewardMode !== 'cumulative') {
    throw new Error(`rewardMode must be 'highest-only' or 'cumulative' (got ${cfg.rewardMode})`);
  }
  let prevThr = 0;
  for (const t of cfg.tiers) {
    if (!Number.isInteger(t.threshold) || t.threshold < 1) {
      throw new Error(`tier threshold must be positive integer (got ${t.threshold})`);
    }
    if (t.threshold <= prevThr) {
      throw new Error(`tier thresholds must be strictly ascending (got ${t.threshold} after ${prevThr})`);
    }
    if (!Number.isFinite(t.rewardX) || t.rewardX < 0) {
      throw new Error(`tier rewardX must be finite non-negative (got ${t.rewardX})`);
    }
    prevThr = t.threshold;
  }
}

// ── Closed-form solver ──────────────────────────────────────────────────────

export function solveVoltageMeterMultiTier(cfg: VoltageMeterMultiTierConfig): VoltageMeterMultiTierResult {
  validateConfig(cfg);
  const { cascadeContinuationProbability: p, tiers, rewardMode } = cfg;
  const K = tiers.length;

  // P(L ≥ T_k) = p^{T_k}
  const hitProbs: number[] = tiers.map((t) => Math.pow(p, t.threshold));

  // P(H = k) = p^{T_k} − p^{T_{k+1}}; for last tier T_{K+1} = ∞, p^∞ = 0
  const exactHighest: number[] = new Array(K).fill(0);
  for (let k = 0; k < K; k++) {
    const pk = hitProbs[k];
    const pk1 = k < K - 1 ? hitProbs[k + 1] : 0;
    exactHighest[k] = pk - pk1;
  }
  const probNoTier = 1 - hitProbs[0];

  let eR = 0;
  let eR2 = 0;

  if (rewardMode === 'highest-only') {
    // E[R] = Σ_k R_k · P(H = k)
    for (let k = 0; k < K; k++) {
      const r = tiers[k].rewardX;
      eR += r * exactHighest[k];
      eR2 += r * r * exactHighest[k];
    }
  } else {
    // cumulative: E[R] = Σ_k R_k · P(L ≥ T_k) = Σ_k R_k · p^{T_k}
    for (let k = 0; k < K; k++) {
      const r = tiers[k].rewardX;
      eR += r * hitProbs[k];
    }
    // E[R²] = Σ_k R_k² · p^{T_k} + 2 · Σ_{i<j} R_i · R_j · p^{T_j}
    // (because indicator I(L ≥ T_i) · I(L ≥ T_j) = I(L ≥ T_j) when T_j > T_i)
    for (let k = 0; k < K; k++) {
      const rk = tiers[k].rewardX;
      eR2 += rk * rk * hitProbs[k];
    }
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        const ri = tiers[i].rewardX;
        const rj = tiers[j].rewardX;
        eR2 += 2 * ri * rj * hitProbs[j];
      }
    }
  }

  const varR = Math.max(0, eR2 - eR * eR);

  return {
    cascadeContinuationProbability: p,
    rewardMode,
    tierCount: K,
    perTierHitProbability: hitProbs,
    perTierExactHighestProbability: exactHighest,
    probNoTierReached: probNoTier,
    expectedRewardPerSpin: eR,
    varianceRewardPerSpin: varR,
  };
}

// ── MC reference ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateVoltageMeterMultiTier(
  cfg: VoltageMeterMultiTierConfig,
  spins: number,
  seed: number,
): VoltageMeterMultiTierMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(spins) || spins < 1) {
    throw new Error(`Invalid spins: ${spins}`);
  }
  const rng = mulberry32(seed);
  const { cascadeContinuationProbability: p, tiers, rewardMode } = cfg;
  const K = tiers.length;

  let totalReward = 0;
  const tierHitCount = new Array(K).fill(0);
  const tierExactHighestCount = new Array(K).fill(0);
  let noTierCount = 0;

  for (let spin = 0; spin < spins; spin++) {
    // Sample chain length L ~ Geometric(1-p): increment while rng < p.
    let L = 0;
    while (rng() < p) L += 1;

    // Determine highest tier and accumulate hits
    let H = -1; // index of highest tier reached, -1 if none
    for (let k = 0; k < K; k++) {
      if (L >= tiers[k].threshold) {
        tierHitCount[k] += 1;
        H = k;
      }
    }
    if (H === -1) {
      noTierCount += 1;
    } else {
      tierExactHighestCount[H] += 1;
    }

    // Reward per spin
    let R = 0;
    if (rewardMode === 'highest-only') {
      if (H >= 0) R = tiers[H].rewardX;
    } else {
      // cumulative
      for (let k = 0; k <= H; k++) {
        R += tiers[k].rewardX;
      }
    }
    totalReward += R;
  }

  return {
    spins,
    observedMeanRewardPerSpin: totalReward / spins,
    observedPerTierHitFraction: tierHitCount.map((c) => c / spins),
    observedPerTierExactHighestFraction: tierExactHighestCount.map((c) => c / spins),
    observedNoTierReachedFraction: noTierCount / spins,
  };
}
