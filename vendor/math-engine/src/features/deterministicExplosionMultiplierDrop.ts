/**
 * W152 Wave 187 — Deterministic Explosion Multiplier-Drop Aggregator (68. solver).
 *
 * **L&W M4 P1 GAP CLOSURE** — covers Dancing Drums Explosion + Revolution.
 *
 * Iconic deterministic-grid explosion mehanika:
 *   * LNW Bally Dancing Drums Explosion (2020 — explosion adds 2×/3×/5× to K
 *     predetermined positions)
 *   * LNW Bally Dancing Drums Revolution (2025 LightWave cabinet — multi-stage)
 *
 * **68th closed-form solver.** First kernel modeling **one-shot deterministic
 * explosion sa multiplier-drop on fixed positions** — distinct od P-063
 * (W142 random reel-stop multipliers — positions are random) i P-038/P-086
 * (cascade pyramid — chain-conditional, ne one-shot).
 *
 * ── Math (Trigger-Gated Compound Sum) ──────────────────────────────────────
 *
 * Per spin:
 *   - Bernoulli trigger T ~ Bernoulli(p_trigger)
 *   - Konditcionalno on T = 1: K predetermined positions "explode"
 *   - Each exploded position gets multiplier V_k iz discrete PMF
 *     {(v_1, π_1), (v_2, π_2), ..., (v_L, π_L)} sa Σ π_l = 1
 *   - Base pay multiplier per position: c (vendor "free position value")
 *   - V_k iid across positions (conditional on trigger)
 *
 * **E[V] = Σ_l π_l · v_l**, **Var[V] = Σ_l π_l · v_l² − E[V]²**.
 *
 * **Per-trigger sum**: S = c · Σ_{k=1..K} V_k
 *   E[S | trigger] = K · c · E[V]
 *   Var[S | trigger] = K · c² · Var[V]  (iid positions)
 *
 * **Per-spin payout** (gated by trigger):
 *   Y = T · S = c · T · Σ V_k
 *   **`E[Y per spin] = p_trigger · K · c · E[V]`**
 *   **`Var[Y per spin]` = E[Y²] − E[Y]²** sa law of total variance:
 *     E[Y² | T=1] = K·c²·Var[V] + (K·c·E[V])²
 *     E[Y²] = p_trigger · E[Y² | T=1] = p_trigger · (K·c²·Var[V] + K²·c²·E[V]²)
 *     Var[Y] = E[Y²] − (p_trigger · K · c · E[V])²
 *           = p_trigger·K²·c²·E[V]²·(1−p_trigger) + p_trigger·K·c²·Var[V]
 *
 * **Top multiplier disclosure** (UKGC RTS-14 max-win):
 *   - **maxTotalMultiplierAchievable** = K · v_max
 *   - **`P(all K positions hit max v_max) = π_max^K`** (rare jackpot)
 *   - **oneInNSpinsAllMaxExplosion** = 1 / (p_trigger · π_max^K)
 *
 * **Per-multiplier-value disclosure** (per UKGC tag-level audit):
 *   - probAtLeastOnePositionHitsValueV_l per value v_l = 1 − (1 − π_l)^K
 *   - expectedPositionsHittingValueV_l = K · π_l
 *
 * **Commercial uplift vs flat-baseline** (no explosion mechanic):
 *   - baseline: spin payout c (no multiplier explosion)
 *   - upliftRatio = E[Y] / c = p_trigger · K · E[V]
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-063 (W142) Symbol Multiplier on Reel-Stop** — RANDOM landing positions,
 *     not deterministic
 *   - **P-038 (W086) Cascade Sequential Multiplier Pyramid** — CHAIN-conditional,
 *     not one-shot
 *   - **P-086 (W185) Per-Reel Bag × Per-Row-Multiplier Coupled** — per-cell
 *     Bernoulli landing + per-row multiplier ramp (different mechanic)
 *   - **P-067 (W150) Voltage Meter Multi-Tier** — single-meter K-tier, not
 *     position-wise multiplier explosion
 *
 * Compliance:
 *   - UKGC RTS-14 (max-win mandatory disclosure)
 *   - MGA PPD §11 (explosion-mechanic transparency)
 *   - eCOGRA Generic Slots Audit (deterministic-position mechanic audit)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "explosion", "multiplier drop", "deterministic position" = generic
 * slot-design terms. No vendor TM.
 */

/** Multiplier value distribution entry. */
export interface MultiplierValueDistributionEntry {
  /** Multiplier value (≥ 0). */
  value: number;
  /** Probability mass (≥ 0; all entries in distribution must sum to 1). */
  probability: number;
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface DeterministicExplosionConfig {
  /** Per-spin probability that the explosion triggers ∈ (0, 1]. */
  probTriggerPerSpin: number;
  /** Number of predetermined positions that explode K ≥ 1 (vendor-fixed). */
  numExplodingPositions: number;
  /** Discrete PMF over multiplier values (sum of probabilities = 1). */
  multiplierValueDistribution: MultiplierValueDistributionEntry[];
  /** Free-position base value per position (× bet units, ≥ 0). */
  freePositionBaseValue: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface DeterministicExplosionResult {
  /** E[V] expected multiplier value per position. */
  expectedMultiplierValue: number;
  /** Var[V] multiplier-value variance per position. */
  varianceMultiplierValue: number;
  /** E[S | trigger] per-trigger expected total payout = K · c · E[V]. */
  expectedTotalPayoutGivenTrigger: number;
  /** Var[S | trigger] per-trigger total variance = K · c² · Var[V]. */
  varianceTotalPayoutGivenTrigger: number;
  /** Std dev given trigger. */
  stdDevTotalPayoutGivenTrigger: number;
  /** E[Y per spin] = p_trigger · E[S | trigger]. */
  expectedPayoutPerSpin: number;
  /** Var[Y per spin] via law of total variance. */
  variancePayoutPerSpin: number;
  /** Std dev per spin. */
  stdDevPayoutPerSpin: number;
  /** Maximum total achievable multiplier value = K · v_max. */
  maxTotalMultiplierAchievable: number;
  /** P(all K positions hit max value v_max | trigger) = π_max^K. */
  probAllPositionsHitMaxGivenTrigger: number;
  /** P(all K positions hit max value v_max per spin) = p_trigger · π_max^K. */
  probAllPositionsHitMaxPerSpin: number;
  /** 1 / P(all K hit max per spin) regulator "1 in X" form. */
  oneInNSpinsAllMaxExplosion: number;
  /**
   * Per-value disclosure: for each multiplier value v_l, the prob
   * "at least one position hits v_l given trigger" and "expected positions
   * hitting v_l given trigger".
   */
  perValueDisclosure: Array<{
    value: number;
    probability: number;
    probAtLeastOneHitGivenTrigger: number;
    expectedPositionsHittingGivenTrigger: number;
    perSpinContributionToPayout: number;
  }>;
  /** Commercial uplift ratio = E[Y] / baseValuePerSpin. */
  commercialUpliftVsFlatBaseline: number;
  /** Top-tier contribution: max value × probability share to total RTP. */
  topTierRtpContribution: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: DeterministicExplosionConfig): void {
  if (
    !Number.isFinite(cfg.probTriggerPerSpin) ||
    cfg.probTriggerPerSpin <= 0 ||
    cfg.probTriggerPerSpin > 1
  ) {
    throw new Error(`probTriggerPerSpin must be ∈ (0, 1], got ${cfg.probTriggerPerSpin}`);
  }
  if (!Number.isInteger(cfg.numExplodingPositions) || cfg.numExplodingPositions < 1) {
    throw new Error(
      `numExplodingPositions must be integer ≥ 1, got ${cfg.numExplodingPositions}`,
    );
  }
  if (!Array.isArray(cfg.multiplierValueDistribution) || cfg.multiplierValueDistribution.length === 0) {
    throw new Error('multiplierValueDistribution must be non-empty array');
  }
  let pmfSum = 0;
  for (let i = 0; i < cfg.multiplierValueDistribution.length; i++) {
    const e = cfg.multiplierValueDistribution[i];
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`multiplierValueDistribution[${i}].value must be ≥ 0, got ${e.value}`);
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(
        `multiplierValueDistribution[${i}].probability must be ∈ [0, 1], got ${e.probability}`,
      );
    }
    pmfSum += e.probability;
  }
  if (Math.abs(pmfSum - 1) > 1e-9) {
    throw new Error(`multiplierValueDistribution probabilities must sum to 1, got ${pmfSum}`);
  }
  if (!Number.isFinite(cfg.freePositionBaseValue) || cfg.freePositionBaseValue < 0) {
    throw new Error(`freePositionBaseValue must be ≥ 0, got ${cfg.freePositionBaseValue}`);
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeDeterministicExplosion(
  cfg: DeterministicExplosionConfig,
): DeterministicExplosionResult {
  validate(cfg);

  const p = cfg.probTriggerPerSpin;
  const K = cfg.numExplodingPositions;
  const c = cfg.freePositionBaseValue;
  const dist = cfg.multiplierValueDistribution;

  // ── 1. E[V] and Var[V]
  let expV = 0;
  let expV2 = 0;
  let vMax = 0;
  let piMax = 0;
  for (const e of dist) {
    expV += e.probability * e.value;
    expV2 += e.probability * e.value * e.value;
    if (e.value > vMax) {
      vMax = e.value;
      piMax = e.probability;
    } else if (e.value === vMax) {
      piMax += e.probability; // ties at the same max
    }
  }
  const varV = Math.max(0, expV2 - expV * expV);

  // ── 2. Per-trigger sum: S = c · Σ V_k, K iid V's
  const expectedTotalPayoutGivenTrigger = K * c * expV;
  const varianceTotalPayoutGivenTrigger = K * c * c * varV;
  const stdDevTotalPayoutGivenTrigger = Math.sqrt(varianceTotalPayoutGivenTrigger);

  // ── 3. Per-spin Y = T · S (T ~ Bernoulli(p)). Law of total variance:
  //   E[Y] = p · E[S]
  //   Var[Y] = p · Var[S | T=1] + p·(1−p)·E[S]² = p · Var[S] + p(1-p)·(K·c·E[V])²
  const expectedPayoutPerSpin = p * expectedTotalPayoutGivenTrigger;
  const variancePayoutPerSpin =
    p * varianceTotalPayoutGivenTrigger +
    p * (1 - p) * expectedTotalPayoutGivenTrigger * expectedTotalPayoutGivenTrigger;
  const stdDevPayoutPerSpin = Math.sqrt(Math.max(0, variancePayoutPerSpin));

  // ── 4. Top-multiplier disclosure
  const maxTotalMultiplierAchievable = K * vMax;
  const probAllPositionsHitMaxGivenTrigger = Math.pow(piMax, K);
  const probAllPositionsHitMaxPerSpin = p * probAllPositionsHitMaxGivenTrigger;
  const oneInNSpinsAllMaxExplosion =
    probAllPositionsHitMaxPerSpin > 1e-15
      ? 1 / probAllPositionsHitMaxPerSpin
      : Number.POSITIVE_INFINITY;

  // ── 5. Per-value disclosure
  const perValueDisclosure = dist.map((e) => {
    const probAtLeast = 1 - Math.pow(1 - e.probability, K);
    const expectedPositions = K * e.probability;
    const perSpinContrib = p * c * K * e.probability * e.value;
    return {
      value: e.value,
      probability: e.probability,
      probAtLeastOneHitGivenTrigger: probAtLeast,
      expectedPositionsHittingGivenTrigger: expectedPositions,
      perSpinContributionToPayout: perSpinContrib,
    };
  });

  // ── 6. Commercial uplift vs flat baseline (no explosion = c per "free" position
  //    just always equal to c · K, no multiplier inflation, no trigger gating)
  const baselineNoMultPerSpin = c; // alternative: c·K · p (flat trigger no mult)
  const commercialUpliftVsFlatBaseline =
    baselineNoMultPerSpin > 1e-12 ? expectedPayoutPerSpin / baselineNoMultPerSpin : 1;

  // ── 7. Top-tier RTP contribution (max value share)
  const topTierRtpContribution = p * c * K * piMax * vMax;

  return {
    expectedMultiplierValue: expV,
    varianceMultiplierValue: varV,
    expectedTotalPayoutGivenTrigger,
    varianceTotalPayoutGivenTrigger,
    stdDevTotalPayoutGivenTrigger,
    expectedPayoutPerSpin,
    variancePayoutPerSpin,
    stdDevPayoutPerSpin,
    maxTotalMultiplierAchievable,
    probAllPositionsHitMaxGivenTrigger,
    probAllPositionsHitMaxPerSpin,
    oneInNSpinsAllMaxExplosion,
    perValueDisclosure,
    commercialUpliftVsFlatBaseline,
    topTierRtpContribution,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveDeterministicExplosion = analyzeDeterministicExplosion;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateDeterministicExplosion(
  cfg: DeterministicExplosionConfig,
  numSpins: number,
  seed = 0xface0187,
): {
  meanPayoutPerSpin: number;
  stdDevPayoutPerSpin: number;
  observedTriggerRate: number;
  meanMultiplierValueAcrossPositions: number;
  observedProbAllMaxPerSpin: number;
} {
  validate(cfg);
  if (!Number.isInteger(numSpins) || numSpins < 1) {
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

  // Build cumulative PMF for fast sampling
  const cumPmf: Array<{ value: number; cumProb: number }> = [];
  let acc = 0;
  for (const e of cfg.multiplierValueDistribution) {
    acc += e.probability;
    cumPmf.push({ value: e.value, cumProb: acc });
  }
  const sampleV = (): number => {
    const u = rng();
    for (const entry of cumPmf) if (u <= entry.cumProb) return entry.value;
    return cumPmf[cumPmf.length - 1].value;
  };

  const p = cfg.probTriggerPerSpin;
  const K = cfg.numExplodingPositions;
  const c = cfg.freePositionBaseValue;
  let vMax = 0;
  for (const e of cfg.multiplierValueDistribution) if (e.value > vMax) vMax = e.value;

  let sumPayout = 0;
  let sumPayout2 = 0;
  let countTrigger = 0;
  let countAllMax = 0;
  let totalPositionsExploded = 0;
  let sumMultiplierAcrossPositions = 0;

  for (let spin = 0; spin < numSpins; spin++) {
    const triggered = rng() < p;
    let payout = 0;
    if (triggered) {
      countTrigger++;
      let allMax = true;
      for (let k = 0; k < K; k++) {
        const v = sampleV();
        payout += c * v;
        if (v !== vMax) allMax = false;
        sumMultiplierAcrossPositions += v;
      }
      totalPositionsExploded += K;
      if (allMax) countAllMax++;
    }
    sumPayout += payout;
    sumPayout2 += payout * payout;
  }

  const meanPayout = sumPayout / numSpins;
  const varPayout = Math.max(0, sumPayout2 / numSpins - meanPayout * meanPayout);

  return {
    meanPayoutPerSpin: meanPayout,
    stdDevPayoutPerSpin: Math.sqrt(varPayout),
    observedTriggerRate: countTrigger / numSpins,
    meanMultiplierValueAcrossPositions:
      totalPositionsExploded > 0 ? sumMultiplierAcrossPositions / totalPositionsExploded : 0,
    observedProbAllMaxPerSpin: countAllMax / numSpins,
  };
}
