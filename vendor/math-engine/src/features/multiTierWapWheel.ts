/**
 * W152 Wave 75 — Multi-tier WAP jackpot + wheel acceptance (Faza 4.6/5 ⚠️→✅).
 *
 * Closes the long-standing twin TODO rows:
 *   • Line 475: "Multi-tier WAP jackpot + wheel-style wheel + Pick bonus + multi-level pick game"
 *   • Line 500: "Multi-tier WAP jackpot + wheel-konfiguracija → 4-tier RTP raspodela"
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * WAP (Wide-Area Progressive) = networked progressive jackpot pool shared
 * across many machines / sites / operators. Multi-tier = a single trigger
 * resolves into one of N tiers (Mini / Minor / Major / Grand / Mega …) via
 * a "wheel" sampling step (weighted random segment).
 *
 * Classic operator example: hit probability per spin is small (~1e-4 to
 * 1e-3); on hit, a wheel/picker selects tier with weights w_i; that tier's
 * current pool is paid out and reset to its seed; the contribution stream
 * c_i (per-spin bet share) keeps refilling the pool between hits.
 *
 * Naming policy (clean-room, per docs/IP_REVIEW.md):
 *   • "Multi-tier WAP jackpot" + "wheel selection" = generic industry terms.
 *   • No vendor-specific marks (no Mega Moolah™, no Hall of Gods™, etc.).
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin:
 *   1. With probability p_trigger, a wheel is spun.
 *   2. Wheel returns tier i ∈ {1..N} with prob w_i / Σ w_j.
 *   3. Tier i pays out its current pool, then resets to seed_i.
 *   4. Between hits, each tier i accumulates contribution c_i per spin.
 *
 * Per-tier marginal hit probability:
 *   λ_i = p_trigger · w_i / Σ w_j
 *
 * Steady-state (renewal theory, identical to a standalone progressive):
 *   E[spins between tier-i hits] = 1 / λ_i
 *   E[pool_i at hit]              = seed_i + c_i / λ_i
 *   E[payout_i per tier-i hit]    = E[pool_i at hit]
 *   E[payout_i per spin]          = λ_i · E[pool_i at hit] = c_i + λ_i · seed_i
 *
 * Total per-spin RTP from jackpot system:
 *   RTP_jackpot = Σ_i (c_i + λ_i · seed_i)
 *               = (Σ_i c_i) + p_trigger · Σ_i (w_i/Σw) · seed_i
 *               = total_contribution + p_trigger · E[seed | hit]
 *
 * Notable corollary: RTP = (sum of contributions) + (expected seed funded
 * by operator per hit) — only the seed portion is genuine operator cost;
 * the contribution stream is recycled player money.
 *
 * Variance & tail:
 *   For each tier, time-to-hit is Geometric(λ_i); pool-at-hit is
 *   seed_i + c_i · (Geometric residual), so:
 *     Var[pool_i at hit] = c_i² · (1 − λ_i) / λ_i²
 *     Var[payout_i per spin] ≈ λ_i · (seed_i + c_i/λ_i)² − (RTP_i)²
 *       (compound Bernoulli, leading term dominates for small λ_i).
 *
 * Tier RTP share (regulatory disclosure):
 *   share_i = RTP_i / RTP_total
 *   — operator/auditor expects each tier's contribution to total RTP to
 *   match the configured PAR sheet within tolerance.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface WapWheelTier {
  /** Tier ID (e.g. 'MINI', 'MINOR', 'MAJOR', 'GRAND', 'MEGA'). */
  id: string;
  /** Seed value (operator-funded reset) in X (bet multiplier). */
  seedX: number;
  /** Per-spin contribution to this tier's pool in X. */
  contributionPerSpinX: number;
  /** Wheel segment weight (relative). */
  wheelWeight: number;
}

export interface MultiTierWapWheelConfig {
  /** Per-spin probability that the wheel is triggered at all. */
  triggerProbabilityPerSpin: number;
  /** Tier ladder (length N ≥ 1). */
  tiers: WapWheelTier[];
}

export interface WapWheelTierResult {
  id: string;
  /** Marginal hit probability per spin = p_trigger · w_i / Σw. */
  hitProbabilityPerSpin: number;
  /** Renewal mean: 1/λ_i. */
  expectedSpinsBetweenHits: number;
  /** Mean pool size at the moment of a hit: seed_i + c_i/λ_i. */
  expectedPoolAtHit: number;
  /** Same as expectedPoolAtHit (every hit pays out the full pool). */
  expectedPayoutPerHit: number;
  /** λ_i · E[pool_i at hit] = c_i + λ_i·seed_i. */
  expectedPayoutPerSpin: number;
  /** Variance of pool size at the moment of a hit. */
  variancePoolAtHit: number;
  /** Effective RTP share contributed by this tier. */
  rtpShare: number;
}

export interface MultiTierWapWheelResult {
  /** Total wheel weight (Σ w_i). */
  totalWheelWeight: number;
  /** Per-tier breakdown (same order as config.tiers). */
  tierResults: WapWheelTierResult[];
  /** Σ tierResults[i].expectedPayoutPerSpin — total RTP from jackpot system. */
  totalExpectedPayoutPerSpin: number;
  /** Σ tierResults[i].rtpShare — must equal 1.0 exactly. */
  totalRtpShare: number;
  /** Total per-spin contribution (Σ c_i). */
  totalContributionPerSpin: number;
  /** Total seed cost per trigger (Σ (w_i/Σw)·seed_i). */
  expectedSeedCostPerTrigger: number;
  /** Operator-funded portion: p_trigger · E[seed | hit]. */
  operatorFundedPortion: number;
}

export interface MultiTierWapWheelMCResult {
  spins: number;
  triggers: number;
  totalPayout: number;
  observedTriggerProbability: number;
  observedTotalPayoutPerSpin: number;
  observedTierPayoutPerSpin: number[];
  observedTierHits: number[];
  observedMeanPoolAtHit: number[];
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: MultiTierWapWheelConfig): void {
  if (
    !Number.isFinite(cfg.triggerProbabilityPerSpin) ||
    cfg.triggerProbabilityPerSpin <= 0 ||
    cfg.triggerProbabilityPerSpin > 1
  ) {
    throw new Error(`triggerProbabilityPerSpin must be in (0, 1]`);
  }
  if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) {
    throw new Error(`tiers must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const t of cfg.tiers) {
    if (typeof t.id !== 'string' || t.id.length === 0) {
      throw new Error(`tier id must be a non-empty string`);
    }
    if (seen.has(t.id)) throw new Error(`duplicate tier id: ${t.id}`);
    seen.add(t.id);
    if (!Number.isFinite(t.seedX) || t.seedX < 0) {
      throw new Error(`tier ${t.id}: seedX must be ≥ 0`);
    }
    if (!Number.isFinite(t.contributionPerSpinX) || t.contributionPerSpinX < 0) {
      throw new Error(`tier ${t.id}: contributionPerSpinX must be ≥ 0`);
    }
    if (!Number.isFinite(t.wheelWeight) || t.wheelWeight <= 0) {
      throw new Error(`tier ${t.id}: wheelWeight must be > 0`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveMultiTierWapWheel(
  config: MultiTierWapWheelConfig,
): MultiTierWapWheelResult {
  validate(config);
  const totalW = config.tiers.reduce((acc, t) => acc + t.wheelWeight, 0);
  const tierResults: WapWheelTierResult[] = [];
  let totalRtp = 0;
  let totalContribution = 0;
  let expectedSeedCostPerTrigger = 0;
  // First pass: compute per-tier RTP so we can normalize shares.
  for (const t of config.tiers) {
    const segProb = t.wheelWeight / totalW;
    const lambda = config.triggerProbabilityPerSpin * segProb;
    const spinsBetween = 1 / lambda;
    const ePool = t.seedX + t.contributionPerSpinX * spinsBetween;
    const ePayoutPerSpin = lambda * ePool; // = c_i + λ_i · seed_i
    const oneMinusL = 1 - lambda;
    const varPool = (t.contributionPerSpinX * t.contributionPerSpinX) * oneMinusL / (lambda * lambda);
    totalRtp += ePayoutPerSpin;
    totalContribution += t.contributionPerSpinX;
    expectedSeedCostPerTrigger += segProb * t.seedX;
    tierResults.push({
      id: t.id,
      hitProbabilityPerSpin: lambda,
      expectedSpinsBetweenHits: spinsBetween,
      expectedPoolAtHit: ePool,
      expectedPayoutPerHit: ePool,
      expectedPayoutPerSpin: ePayoutPerSpin,
      variancePoolAtHit: varPool,
      rtpShare: 0, // filled below
    });
  }
  // Normalize RTP shares.
  for (const tr of tierResults) {
    tr.rtpShare = totalRtp > 0 ? tr.expectedPayoutPerSpin / totalRtp : 0;
  }
  return {
    totalWheelWeight: totalW,
    tierResults,
    totalExpectedPayoutPerSpin: totalRtp,
    totalRtpShare: tierResults.reduce((a, b) => a + b.rtpShare, 0),
    totalContributionPerSpin: totalContribution,
    expectedSeedCostPerTrigger,
    operatorFundedPortion: config.triggerProbabilityPerSpin * expectedSeedCostPerTrigger,
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

export function simulateMultiTierWapWheel(
  config: MultiTierWapWheelConfig,
  spins: number,
  seed: number,
): MultiTierWapWheelMCResult {
  validate(config);
  const rng = makePrng(seed);
  const N = config.tiers.length;
  // Pre-compute cumulative wheel weights for sampling.
  const totalW = config.tiers.reduce((acc, t) => acc + t.wheelWeight, 0);
  const cumW: number[] = new Array<number>(N);
  {
    let running = 0;
    for (let i = 0; i < N; i++) {
      running += config.tiers[i].wheelWeight / totalW;
      cumW[i] = running;
    }
    cumW[N - 1] = 1; // numerical safety
  }
  // Per-tier state.
  const pools: number[] = config.tiers.map((t) => t.seedX);
  const hits: number[] = new Array<number>(N).fill(0);
  const tierPayoutTotal: number[] = new Array<number>(N).fill(0);
  const tierPoolAtHitSum: number[] = new Array<number>(N).fill(0);
  let triggers = 0;
  let totalPayout = 0;
  for (let s = 0; s < spins; s++) {
    // Each tier accumulates its contribution every spin.
    for (let i = 0; i < N; i++) pools[i] += config.tiers[i].contributionPerSpinX;
    // Trigger check.
    if (rng() < config.triggerProbabilityPerSpin) {
      triggers++;
      // Sample wheel segment.
      const u = rng();
      let tierIdx = N - 1;
      for (let i = 0; i < N; i++) {
        if (u < cumW[i]) {
          tierIdx = i;
          break;
        }
      }
      const payout = pools[tierIdx];
      hits[tierIdx]++;
      tierPayoutTotal[tierIdx] += payout;
      tierPoolAtHitSum[tierIdx] += payout;
      totalPayout += payout;
      pools[tierIdx] = config.tiers[tierIdx].seedX;
    }
  }
  return {
    spins,
    triggers,
    totalPayout,
    observedTriggerProbability: triggers / spins,
    observedTotalPayoutPerSpin: totalPayout / spins,
    observedTierPayoutPerSpin: tierPayoutTotal.map((p) => p / spins),
    observedTierHits: hits,
    observedMeanPoolAtHit: hits.map((h, i) => (h > 0 ? tierPoolAtHitSum[i] / h : 0)),
  };
}