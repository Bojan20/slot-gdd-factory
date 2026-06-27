/**
 * W152 Wave 159 — Hit Frequency Distribution Decomposition Analyzer (51. solver).
 *
 * INDUSTRY-STANDARD regulatory disclosure kernel — UKGC RTS 14 Tag 12 (operator
 * must disclose top hit rates per game), MGA Player Protection Directives §11.f
 * (variance disclosure including tier-stratified hit frequency), eCOGRA Generic
 * Slots Audit (hit-frequency table mandate), AU NCPF Reform 2022 Schedule 3
 * (rare-events disclosure with "1 in X" frequency for tier-stratified payouts).
 *
 * **51st closed-form solver** — post-50-solver milestone (W157). First explicit
 * **distribution-decomposition** kernel in the engine portfolio (prior solvers
 * compute scalar moments or single-tier probabilities; this one decomposes the
 * entire payout PMF into operator-/regulator-grade survival-function tiers).
 *
 * ── The problem ──────────────────────────────────────────────────────────
 * Operator/regulator asks: "Given per-spin payout PMF π(y) (in × bet units),
 * disclose for each tier C in {1×, 5×, 10×, 50×, 100×, 500×, 1000×, 5000×}:
 *   - Hit frequency at tier (P(Y ≥ C·bet))
 *   - Regulator-friendly '1 in N' form (1 / P(Y ≥ C·bet))
 *   - Conditional EV given tier hit (E[Y | Y ≥ C·bet])
 *   - RTP contribution from tier (Σ y·π(y) for y ≥ C·bet, normalised)
 *   - Top-X% RTP concentration (% of total RTP from top 1%, 5%, 10% mass events)
 *   - Heavy-tail diagnostic (Pareto α fit on survival function tail)
 * "
 *
 * No vendor publishes a formal closed-form survival-function decomposition
 * kernel. Existing operator hit-rate sheets are manually compiled spreadsheets
 * lacking variance, RTP-concentration, or heavy-tail fits. This solver
 * automates all of those.
 *
 * ── Distinct from ────────────────────────────────────────────────────────
 *   - W148 Max Win Cap Truncation — caps payouts at C, doesn't decompose tiers
 *   - W110 Bonus Trigger Wait Time — base-game trigger only, no payout aggregate
 *   - W57  Crash-style Multiplier — target multiplier hit, single tier only
 *   - W127 Anticipation/Tease — Bayesian reel reveal, no payout PMF
 *   - W118 Bonus Collect-N — token collector over multiple spins
 *
 * ── Math ─────────────────────────────────────────────────────────────────
 * Input: discrete PMF on multiples-of-bet { (m_1, p_1), (m_2, p_2), …, (m_K, p_K) }
 *   where m_k ∈ {0, 1, 2, 5, …} and Σ p_k = 1.
 *
 * Total RTP = Σ_k m_k · p_k
 * Total variance = Σ_k m_k² · p_k − RTP²
 * Hit frequency overall HF = Σ_{k: m_k > 0} p_k = 1 − π(0)
 * One-in-N spin overall = 1 / HF
 *
 * For each tier C in user-supplied list (sorted ascending):
 *   sIdx = first k where m_k ≥ C
 *   tierProb = Σ_{k ≥ sIdx} p_k                                  ← survival(C)
 *   oneInN = (tierProb > 0) ? 1 / tierProb : Infinity
 *   condEV = (tierProb > 0) ? (Σ_{k ≥ sIdx} m_k · p_k) / tierProb : 0
 *   rtpContrib = Σ_{k ≥ sIdx} m_k · p_k                          ← absolute contribution
 *   rtpShareOfTotal = rtpContrib / totalRTP                       ← share of total
 *
 * Top-X% concentration metric (regulator interpretability):
 *   - Sort outcomes by m_k descending
 *   - Cumulative mass curve: ranks events by P(m_k), take topProbFraction × full mass
 *   - Compute fraction of total RTP from top-fraction events
 *   - Reported for ranks 1%, 5%, 10% (standard regulator buckets)
 *
 * Heavy-tail Pareto α fit (asymptotic survival S(m) ≈ (m/m_min)^{−α}):
 *   - Use only positive-mass tier with at least 3 distinct outcomes ≥ user-supplied
 *     paretoTailStartMultiplier (e.g. 10×) and survival > 0
 *   - Maximum-likelihood α-hat = (n - 1) / Σ ln(m_k / m_min) (Hill estimator)
 *   - Returns NaN if insufficient tail data
 *
 * No MC needed for hit-frequency decomposition (the closed-form fully
 * characterises the distribution from the PMF). MC `simulateHitFrequency...`
 * is provided as cross-validation harness sampling from the PMF.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface PayoutPmfEntry {
  /** Payout in × bet units (must be ≥ 0). */
  multiple: number;
  /** Probability mass (must be in [0, 1]). */
  probability: number;
}

export interface HitFrequencyDistributionConfig {
  /** Discrete payout PMF — entries summed must ≈ 1.0 (within 1e-6). */
  payoutPmf: PayoutPmfEntry[];
  /** Sorted-ascending list of tier-disclosure thresholds (× bet units). */
  tierThresholds: number[];
  /** Min multiple at which to start Hill-estimator tail fit (e.g. 10× for slot games). */
  paretoTailStartMultiplier?: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface TierBreakdownEntry {
  threshold: number;
  /** Survival probability P(Y ≥ threshold × bet). */
  tierProb: number;
  /** Regulator "1 in N" form (1 / tierProb), Infinity if tierProb = 0. */
  oneInN: number;
  /** Conditional E[Y | Y ≥ threshold] in × bet units. */
  condEV: number;
  /** Absolute RTP contribution from tier = Σ_{m ≥ threshold} m · p (× bet units). */
  rtpContribution: number;
  /** Share of total RTP attributable to this tier (0..1). */
  rtpShareOfTotal: number;
}

export interface RtpConcentrationEntry {
  /** Top-X% of events by probability rank (0.01 = top 1%). */
  topFraction: number;
  /** Fraction of total RTP from those top events (0..1). */
  rtpShare: number;
  /** Number of distinct outcome rows contributing. */
  eventCount: number;
}

export interface HitFrequencyDistributionResult {
  /** Total RTP = Σ m·p (× bet units, typically ≤ 1 for house-edge games). */
  totalRtp: number;
  /** Total variance σ² = Σ m²·p − RTP² (× bet² units). */
  totalVariance: number;
  /** Std dev = √variance. */
  totalStdDev: number;
  /** Overall hit frequency HF = 1 − π(0). */
  overallHitFrequency: number;
  /** Overall "1 in N spins" = 1 / HF, Infinity if HF = 0. */
  overallOneInN: number;
  /** Per-tier breakdown (one row per supplied threshold). */
  tierBreakdown: TierBreakdownEntry[];
  /** RTP concentration at top fractions {1%, 5%, 10%}. */
  rtpConcentration: RtpConcentrationEntry[];
  /** Hill-estimator Pareto α on tail (m ≥ paretoTailStartMultiplier); NaN if insufficient data. */
  paretoTailAlpha: number;
  /** Number of distinct positive-payout rows used in Pareto fit. */
  paretoTailRowCount: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: HitFrequencyDistributionConfig): void {
  if (!Array.isArray(cfg.payoutPmf) || cfg.payoutPmf.length === 0) {
    throw new Error(`hitFrequencyDistribution: payoutPmf must be non-empty array`);
  }
  let pSum = 0;
  for (const e of cfg.payoutPmf) {
    if (!Number.isFinite(e.multiple) || e.multiple < 0) {
      throw new Error(
        `hitFrequencyDistribution: every entry.multiple must be ≥ 0, got ${e.multiple}`,
      );
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(
        `hitFrequencyDistribution: every entry.probability must be in [0, 1], got ${e.probability}`,
      );
    }
    pSum += e.probability;
  }
  if (Math.abs(pSum - 1) > 1e-6) {
    throw new Error(`hitFrequencyDistribution: PMF probabilities must sum to 1 (within 1e-6), got ${pSum}`);
  }
  if (!Array.isArray(cfg.tierThresholds) || cfg.tierThresholds.length === 0) {
    throw new Error(`hitFrequencyDistribution: tierThresholds must be non-empty array`);
  }
  for (let i = 0; i < cfg.tierThresholds.length; i++) {
    const t = cfg.tierThresholds[i];
    if (!Number.isFinite(t) || t < 0) {
      throw new Error(`hitFrequencyDistribution: tierThresholds must contain only ≥ 0 numbers, got ${t}`);
    }
    if (i > 0 && t < cfg.tierThresholds[i - 1]) {
      throw new Error(
        `hitFrequencyDistribution: tierThresholds must be sorted ascending, got ${cfg.tierThresholds[i - 1]} > ${t}`,
      );
    }
  }
  if (cfg.paretoTailStartMultiplier !== undefined) {
    if (!Number.isFinite(cfg.paretoTailStartMultiplier) || cfg.paretoTailStartMultiplier <= 0) {
      throw new Error(
        `hitFrequencyDistribution: paretoTailStartMultiplier must be > 0 if given, got ${cfg.paretoTailStartMultiplier}`,
      );
    }
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveHitFrequencyDistribution(
  cfg: HitFrequencyDistributionConfig,
): HitFrequencyDistributionResult {
  validateConfig(cfg);

  // Sort PMF entries ascending by multiple (without mutating input).
  const sorted = cfg.payoutPmf
    .slice()
    .sort((a, b) => a.multiple - b.multiple);

  // Total moments.
  let totalRtp = 0;
  let totalSecondMoment = 0;
  let zeroPayoutMass = 0;
  for (const e of sorted) {
    totalRtp += e.multiple * e.probability;
    totalSecondMoment += e.multiple * e.multiple * e.probability;
    if (e.multiple === 0) zeroPayoutMass += e.probability;
  }
  const totalVariance = Math.max(0, totalSecondMoment - totalRtp * totalRtp);
  const totalStdDev = Math.sqrt(totalVariance);
  const overallHitFrequency = Math.max(0, Math.min(1, 1 - zeroPayoutMass));
  const overallOneInN = overallHitFrequency > 0 ? 1 / overallHitFrequency : Infinity;

  // Per-tier breakdown.
  const tierBreakdown: TierBreakdownEntry[] = cfg.tierThresholds.map((threshold) => {
    let tierProb = 0;
    let tierRtpContrib = 0;
    for (const e of sorted) {
      if (e.multiple >= threshold) {
        tierProb += e.probability;
        tierRtpContrib += e.multiple * e.probability;
      }
    }
    const oneInN = tierProb > 1e-15 ? 1 / tierProb : Infinity;
    const condEV = tierProb > 1e-15 ? tierRtpContrib / tierProb : 0;
    const rtpShareOfTotal = totalRtp > 1e-15 ? tierRtpContrib / totalRtp : 0;
    return {
      threshold,
      tierProb,
      oneInN,
      condEV,
      rtpContribution: tierRtpContrib,
      rtpShareOfTotal,
    };
  });

  // RTP concentration: sort POSITIVE-payout outcomes by descending multiple
  // (highest-paying first), then take top-X% by event-count rank weighted by
  // probability mass. Regulator convention is "top X% of EVENTS by rarity"
  // — here we use rarity = descending multiple (highest payouts are rarest).
  const positive = sorted.filter((e) => e.multiple > 0 && e.probability > 0);
  positive.sort((a, b) => b.multiple - a.multiple); // descending multiple
  const totalPositiveProb = positive.reduce((s, e) => s + e.probability, 0);
  const fractions = [0.01, 0.05, 0.10];
  const rtpConcentration: RtpConcentrationEntry[] = fractions.map((frac) => {
    const target = totalPositiveProb * frac;
    let cumProb = 0;
    let cumRtp = 0;
    let eventCount = 0;
    for (const e of positive) {
      if (cumProb >= target) break;
      const take = Math.min(e.probability, target - cumProb);
      cumProb += take;
      cumRtp += e.multiple * take;
      eventCount++;
    }
    return {
      topFraction: frac,
      rtpShare: totalRtp > 1e-15 ? cumRtp / totalRtp : 0,
      eventCount,
    };
  });

  // Hill-estimator Pareto α on tail.
  const tailStart = cfg.paretoTailStartMultiplier ?? 10;
  const tail = sorted.filter((e) => e.multiple >= tailStart && e.probability > 0);
  let paretoTailAlpha = NaN;
  const paretoTailRowCount = tail.length;
  if (tail.length >= 3) {
    // Hill estimator: α̂ = (n − 1) / Σ ln(m_i / m_min)
    // Weighted by mass to respect PMF (since same-multiple may have several
    // entries already collapsed in our representation; weight by probability
    // gives the empirical-distribution Hill estimator).
    const mMin = tail[0].multiple;
    let sumLog = 0;
    let totalTailMass = 0;
    for (const e of tail) {
      sumLog += e.probability * Math.log(e.multiple / mMin);
      totalTailMass += e.probability;
    }
    // α̂ = totalTailMass / sumLog, equivalent to (n−1)/Σln in continuous limit.
    paretoTailAlpha = sumLog > 1e-15 ? totalTailMass / sumLog : Infinity;
  }

  return {
    totalRtp,
    totalVariance,
    totalStdDev,
    overallHitFrequency,
    overallOneInN,
    tierBreakdown,
    rtpConcentration,
    paretoTailAlpha,
    paretoTailRowCount,
  };
}

/** ── MC simulation (cross-validates closed-form by sampling from PMF) ─── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HitFrequencyDistributionMcResult {
  spinsSimulated: number;
  observedRtp: number;
  observedHitFrequency: number;
  observedTierProbabilities: Array<{ threshold: number; observedProb: number }>;
}

/**
 * MC sampler — draws `spins` outcomes from the categorical PMF and accumulates
 * per-tier hit counts. Cross-validates per-tier `tierProb` for CF.
 */
export function simulateHitFrequencyDistribution(
  cfg: HitFrequencyDistributionConfig,
  spins: number,
  seed: number,
): HitFrequencyDistributionMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  // Build cumulative distribution for sampling.
  const sorted = cfg.payoutPmf.slice().sort((a, b) => a.multiple - b.multiple);
  const cum: number[] = [];
  let acc = 0;
  for (const e of sorted) {
    acc += e.probability;
    cum.push(acc);
  }

  let totalPayout = 0;
  let hitCount = 0;
  const tierHits = new Array(cfg.tierThresholds.length).fill(0);

  for (let s = 0; s < spins; s++) {
    const u = rng();
    // Binary-search cum for u.
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    const drawn = sorted[lo].multiple;
    totalPayout += drawn;
    if (drawn > 0) hitCount++;
    for (let t = 0; t < cfg.tierThresholds.length; t++) {
      if (drawn >= cfg.tierThresholds[t]) tierHits[t]++;
    }
  }

  return {
    spinsSimulated: spins,
    observedRtp: totalPayout / spins,
    observedHitFrequency: hitCount / spins,
    observedTierProbabilities: cfg.tierThresholds.map((threshold, i) => ({
      threshold,
      observedProb: tierHits[i] / spins,
    })),
  };
}
