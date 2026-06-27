/**
 * W152 Wave 195 — Mid-Spin Random Reel-Reshape Mixture Aggregator (76. solver).
 *
 * **L&W M13 P1 GAP CLOSURE** — covers WMS Wizard of Oz Follow the Yellow Brick
 * Road (2017 Glinda reshape feature, defining title) + Wizard of Oz reshape
 * variants + future L&W reshape-mechanic flagships.
 *
 * Iconic mid-spin reel-reshape mehanika:
 *   * LNW WMS Wizard of Oz Follow the Yellow Brick Road (2017, defining title —
 *     Glinda the Good Witch waves wand mid-spin, replaces entire reel set sa
 *     alternative paytable)
 *   * Wizard of Oz Munchkinland reshape variants
 *   * Future L&W titles sa stochastic mid-spin reel-set transitions
 *
 * **76th closed-form solver.** First kernel modeling **mixture distribution
 * payout sa stochastic mid-spin reel-set transition** — distinct od existing
 * trigger-gated kernels jer no-reshape pathway ALSO pays out (non-zero base),
 * making this a **K-component mixture distribution** (ne trigger gating).
 *
 * ── Math (K-Component Reel-Set Mixture Distribution) ───────────────────────
 *
 * Per spin: state K ~ Categorical(p_0, p_1, ..., p_{K-1}) gde Σ p_i = 1:
 *   - p_0 = P(no reshape / base reel-set)
 *   - p_k = P(reshape to alternative reel-set k) for k = 1..K-1
 *
 * Per reel-set k: payout X_k ~ iid sa (μ_k, σ²_k) own paytable distribution.
 *
 * Per-spin payout:
 *   Y = X_K (where K random, X_K conditionally independent given K)
 *
 * **Mixture moments** (law of total expectation/variance):
 *
 *   **E[Y] = Σ_k p_k · μ_k**            (mixture mean)
 *   E[Y²] = Σ_k p_k · (σ²_k + μ²_k)
 *   **Var[Y] = E[Y²] − (E[Y])²**         (mixture variance)
 *
 * **Decomposition** (Conditional variance identity):
 *
 *   Var[Y] = E[Var[Y|K]] + Var[E[Y|K]]
 *          = Σ p_k · σ²_k + (Σ p_k · μ²_k − (Σ p_k · μ_k)²)
 *          = E[within-set variance] + Between-set variance
 *
 * **Disclosure metrics**:
 *   - perReelSet.contributionToRtp = p_k · μ_k / E[Y]
 *   - perReelSet.oneInNSpinsForThisSet = 1 / p_k (regulator "1 in X")
 *   - baseReelSetIndex = 0 (convention)
 *   - reshapeProbability = 1 − p_0 (P(any reshape))
 *   - bestReelSetIndex = argmax_k μ_k
 *   - **commercialUpliftVsBaseOnly = E[Y] / μ_0** (reshape uplift over base RTP)
 *   - bestReelSetUpliftIfReshape = μ_{best} / μ_0
 *   - **withinSetVarianceShare = E[Var[Y|K]] / Var[Y]**
 *     (decomposition — how much variance comes from within-set vs between-set)
 *   - oneInNSpinsAnyReshape = 1 / reshapeProbability
 *   - oneInNSpinsBestReshape = 1 / p_{best} (only meaningful if best ≠ base)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────
 *   - **P-094 (W193) Multi-Pot Branched H&S Sub-Feature** — TRIGGER-gated
 *     (Y=0 if no trigger); ovde **no-trigger pathway also pays** (base reel-set
 *     spin continues — mixture distribution, ne trigger gating).
 *   - **P-089 (W188) Player-Elects Composition** — player CHOOSES subset;
 *     ovde **vendor-categorical** mid-spin Glinda decision.
 *   - **P-067 (W150) Voltage Meter K-Tier** — cumulative meter advancement;
 *     ovde **per-spin** state Categorical reshape.
 *   - **P-058 (W137) Markov Wild State Tier** — within-feature state Markov;
 *     ovde **reel-set** switching at engine level (different paytable
 *     altogether).
 *   - **P-022 (W104) Wheel Bonus** — wheel slice payout draw; ovde **per-spin
 *     reel-set selection** sa own internal payout distribution.
 *
 * Compliance:
 *   - **UKGC RTS-14** mandatory per-reel-set RTP disclosure (all alternatives)
 *   - **MGA PPD §11** stochastic reshape transparency
 *   - **eCOGRA** per-reel-set paytable audit trail
 *   - **EU GA 2024** cross-jurisdiction baseline
 *
 * Naming: "reel-set", "reshape", "reel-reshape", "mixture distribution"
 * = generic slot-design + statistical terms. No vendor TM.
 */

/** ── Per-reel-set config ──────────────────────────────────────────────────── */
export interface ReelSetConfig {
  /** Optional reel-set label (audit trail). */
  label?: string;
  /** Selection probability ∈ [0, 1]; Σ_k probability = 1 enforced. */
  selectionProbability: number;
  /** E[X | this reel-set] mean payout (× bet, ≥ 0). */
  meanPayout: number;
  /** Var[X | this reel-set] variance (≥ 0). */
  variancePayout: number;
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface MidSpinReelReshapeMixtureConfig {
  /** Reel-sets (K ≥ 2). Convention: index 0 = base, rest = reshape alternatives. */
  reelSets: ReelSetConfig[];
}

/** ── Per-reel-set disclosure ──────────────────────────────────────────────── */
export interface ReelSetDisclosure {
  index: number;
  label: string;
  selectionProbability: number;
  meanPayout: number;
  variancePayout: number;
  /** p_k · μ_k / E[Y] (share of total RTP). */
  contributionToRtp: number;
  /** 1 / p_k Geometric (regulator "1 in X" form). */
  oneInNSpinsForThisSet: number;
  /** rank descending by meanPayout (1..K). */
  rankByMeanPayout: number;
  /** True if this reel-set has the highest meanPayout. */
  isBestReelSet: boolean;
  /** True if this is the base reel-set (index 0). */
  isBaseReelSet: boolean;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface MidSpinReelReshapeMixtureResult {
  /** K (number of reel-sets). */
  numReelSets: number;
  /** Per-reel-set disclosure rows. */
  perReelSet: ReelSetDisclosure[];
  /** E[Y] = Σ p_k · μ_k (mixture mean = total RTP × bet). */
  expectedPayoutPerSpin: number;
  /** E[Y²] = Σ p_k · (σ²_k + μ²_k). */
  secondMomentPayoutPerSpin: number;
  /** Var[Y] = E[Y²] − E[Y]² (total mixture variance). */
  variancePayoutPerSpin: number;
  /** Std dev. */
  stdDevPayoutPerSpin: number;
  /** E[Var[Y|K]] = Σ p_k · σ²_k (within-set component). */
  withinSetVariance: number;
  /** Var[E[Y|K]] = Σ p_k·μ²_k − (Σ p_k·μ_k)² (between-set component). */
  betweenSetVariance: number;
  /** withinSetVariance / Var[Y] (∈ [0, 1]). */
  withinSetVarianceShare: number;
  /** 1 − p_0 (P(any reshape during the spin)). */
  reshapeProbability: number;
  /** 1 / reshapeProbability Geometric expected spins to first reshape. */
  oneInNSpinsAnyReshape: number;
  /** argmax_k μ_k (best reel-set index). */
  bestReelSetIndex: number;
  /** E[Y] / μ_base (reshape uplift over base-only RTP). */
  commercialUpliftVsBaseOnly: number;
  /** μ_best / μ_base. */
  bestReelSetUpliftIfReshape: number;
  /** 1 / p_best (regulator "1 in X" form for best reel-set hit). */
  oneInNSpinsBestReelSet: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: MidSpinReelReshapeMixtureConfig): void {
  if (!Array.isArray(cfg.reelSets) || cfg.reelSets.length < 2) {
    throw new Error(`reelSets must be array of length ≥ 2, got ${cfg.reelSets?.length ?? 0}`);
  }
  let sumP = 0;
  for (let k = 0; k < cfg.reelSets.length; k++) {
    const rs = cfg.reelSets[k]!;
    if (
      !Number.isFinite(rs.selectionProbability) ||
      rs.selectionProbability < 0 ||
      rs.selectionProbability > 1
    ) {
      throw new Error(
        `reelSets[${k}].selectionProbability must be ∈ [0, 1], got ${rs.selectionProbability}`,
      );
    }
    if (!Number.isFinite(rs.meanPayout) || rs.meanPayout < 0) {
      throw new Error(`reelSets[${k}].meanPayout must be ≥ 0, got ${rs.meanPayout}`);
    }
    if (!Number.isFinite(rs.variancePayout) || rs.variancePayout < 0) {
      throw new Error(`reelSets[${k}].variancePayout must be ≥ 0, got ${rs.variancePayout}`);
    }
    sumP += rs.selectionProbability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`reelSets selectionProbability must sum to 1.0, got ${sumP}`);
  }
  if (!(cfg.reelSets[0]!.selectionProbability > 0)) {
    throw new Error(`reelSets[0] (base) selectionProbability must be > 0`);
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeMidSpinReelReshapeMixture(
  cfg: MidSpinReelReshapeMixtureConfig,
): MidSpinReelReshapeMixtureResult {
  validate(cfg);

  const K = cfg.reelSets.length;
  const p0 = cfg.reelSets[0]!.selectionProbability;
  const mu0 = cfg.reelSets[0]!.meanPayout;

  // E[Y] = Σ p_k · μ_k
  const expectedPayoutPerSpin = cfg.reelSets.reduce(
    (acc, rs) => acc + rs.selectionProbability * rs.meanPayout,
    0,
  );

  // E[Y²] = Σ p_k · (σ²_k + μ²_k)
  const secondMomentPayoutPerSpin = cfg.reelSets.reduce(
    (acc, rs) =>
      acc + rs.selectionProbability * (rs.variancePayout + rs.meanPayout * rs.meanPayout),
    0,
  );

  // Var[Y] mixture
  const variancePayoutPerSpin = Math.max(
    0,
    secondMomentPayoutPerSpin - expectedPayoutPerSpin * expectedPayoutPerSpin,
  );
  const stdDevPayoutPerSpin = Math.sqrt(variancePayoutPerSpin);

  // Within-set: E[Var[Y|K]] = Σ p_k · σ²_k
  const withinSetVariance = cfg.reelSets.reduce(
    (acc, rs) => acc + rs.selectionProbability * rs.variancePayout,
    0,
  );
  // Between-set: Var[E[Y|K]] = Σ p_k · μ²_k − (Σ p_k · μ_k)²
  const sumPMuSq = cfg.reelSets.reduce(
    (acc, rs) => acc + rs.selectionProbability * rs.meanPayout * rs.meanPayout,
    0,
  );
  const betweenSetVariance = Math.max(
    0,
    sumPMuSq - expectedPayoutPerSpin * expectedPayoutPerSpin,
  );
  const withinSetVarianceShare =
    variancePayoutPerSpin > 1e-12 ? withinSetVariance / variancePayoutPerSpin : 0;

  // Best reel-set
  let bestReelSetIndex = 0;
  for (let k = 1; k < K; k++) {
    if (cfg.reelSets[k]!.meanPayout > cfg.reelSets[bestReelSetIndex]!.meanPayout) {
      bestReelSetIndex = k;
    }
  }
  const pBest = cfg.reelSets[bestReelSetIndex]!.selectionProbability;
  const muBest = cfg.reelSets[bestReelSetIndex]!.meanPayout;

  // rank
  const sortedByMean = [...cfg.reelSets.keys()].sort(
    (a, b) => cfg.reelSets[b]!.meanPayout - cfg.reelSets[a]!.meanPayout,
  );
  const rankByMean = new Array<number>(K);
  for (let r = 0; r < K; r++) {
    rankByMean[sortedByMean[r]!] = r + 1;
  }

  const perReelSet: ReelSetDisclosure[] = cfg.reelSets.map((rs, k) => ({
    index: k,
    label: rs.label ?? (k === 0 ? 'base' : `reshape_${k}`),
    selectionProbability: rs.selectionProbability,
    meanPayout: rs.meanPayout,
    variancePayout: rs.variancePayout,
    contributionToRtp:
      expectedPayoutPerSpin > 1e-12
        ? (rs.selectionProbability * rs.meanPayout) / expectedPayoutPerSpin
        : 0,
    oneInNSpinsForThisSet:
      rs.selectionProbability > 1e-15 ? 1 / rs.selectionProbability : Number.POSITIVE_INFINITY,
    rankByMeanPayout: rankByMean[k]!,
    isBestReelSet: k === bestReelSetIndex,
    isBaseReelSet: k === 0,
  }));

  const reshapeProbability = 1 - p0;
  const oneInNSpinsAnyReshape =
    reshapeProbability > 1e-15 ? 1 / reshapeProbability : Number.POSITIVE_INFINITY;

  const commercialUpliftVsBaseOnly =
    mu0 > 1e-12 ? expectedPayoutPerSpin / mu0 : Number.POSITIVE_INFINITY;
  const bestReelSetUpliftIfReshape =
    mu0 > 1e-12 ? muBest / mu0 : Number.POSITIVE_INFINITY;
  const oneInNSpinsBestReelSet =
    pBest > 1e-15 ? 1 / pBest : Number.POSITIVE_INFINITY;

  return {
    numReelSets: K,
    perReelSet,
    expectedPayoutPerSpin,
    secondMomentPayoutPerSpin,
    variancePayoutPerSpin,
    stdDevPayoutPerSpin,
    withinSetVariance,
    betweenSetVariance,
    withinSetVarianceShare,
    reshapeProbability,
    oneInNSpinsAnyReshape,
    bestReelSetIndex,
    commercialUpliftVsBaseOnly,
    bestReelSetUpliftIfReshape,
    oneInNSpinsBestReelSet,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveMidSpinReelReshapeMixture = analyzeMidSpinReelReshapeMixture;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateMidSpinReelReshapeMixture(
  cfg: MidSpinReelReshapeMixtureConfig,
  numSpins: number,
  seed = 0xface0195,
): {
  meanPayoutPerSpin: number;
  stdDevPayoutPerSpin: number;
  observedReelSetFreqs: number[];
  observedReshapeRate: number;
  meanPayoutGivenReshape: number;
} {
  validate(cfg);
  if (!Number.isInteger(numSpins) || numSpins < 1) {
    throw new Error(`numSpins must be integer ≥ 1, got ${numSpins}`);
  }

  const K = cfg.reelSets.length;
  const cdf: number[] = [];
  let cum = 0;
  for (const rs of cfg.reelSets) {
    cum += rs.selectionProbability;
    cdf.push(cum);
  }
  cdf[K - 1] = 1;

  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return (z >>> 0) / 4294967296;
  };
  const gaussian = (mu: number, sigma: number): number => {
    if (sigma <= 0) return mu;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
  };
  const sampleSet = (): number => {
    const u = rng();
    for (let k = 0; k < K; k++) {
      if (u <= cdf[k]!) return k;
    }
    return K - 1;
  };

  let sumY = 0;
  let sumY2 = 0;
  let reshapeCount = 0;
  let sumReshapePayout = 0;
  const setCounts = new Array<number>(K).fill(0);

  for (let i = 0; i < numSpins; i++) {
    const k = sampleSet();
    setCounts[k]!++;
    const rs = cfg.reelSets[k]!;
    const sig = Math.sqrt(rs.variancePayout);
    // Note: no Math.max(0, .) clip — clipping creates upward bias za high-σ configs.
    // CF validation prefers unclipped Gaussian for clean mean/variance match (W186 fix pattern).
    const y = gaussian(rs.meanPayout, sig);
    sumY += y;
    sumY2 += y * y;
    if (k !== 0) {
      reshapeCount++;
      sumReshapePayout += y;
    }
  }

  const meanY = sumY / numSpins;
  const varY = Math.max(0, sumY2 / numSpins - meanY * meanY);
  return {
    meanPayoutPerSpin: meanY,
    stdDevPayoutPerSpin: Math.sqrt(varY),
    observedReelSetFreqs: setCounts.map((c) => c / numSpins),
    observedReshapeRate: reshapeCount / numSpins,
    meanPayoutGivenReshape: reshapeCount > 0 ? sumReshapePayout / reshapeCount : 0,
  };
}
