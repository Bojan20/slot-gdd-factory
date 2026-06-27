/**
 * W152 Wave 196 — Stacked Multi-Wheel Composition Aggregator (77. solver).
 *
 * **L&W M6 P1 GAP CLOSURE — FINAL L&W GAP (16/16 closed)** — covers LNW Bally
 * Triple Cash Wheel (2022 defining title 3 stacked wheels) + Quick Hit Cash
 * Wheel (2014) + Cash Wheel Quick Hit (2014) + multi-wheel composition
 * variants u Bally Cash Wheel family.
 *
 * Iconic stacked multi-wheel composition mehanika:
 *   * LNW Bally Triple Cash Wheel (2022 defining title — 3 wheels spin
 *     independently, total payout = Σ per-wheel slice draws)
 *   * Bally Quick Hit Cash Wheel (2014) — wheel composition + Quick Hit
 *     mechanic
 *   * Bally Cash Wheel Quick Hit (2014) — wheel × paytable composition
 *   * Future L&W multi-wheel flagships sa N stacked independent wheels
 *
 * **77th closed-form solver — FINAL L&W GAP CLOSURE solver (16/16 P0+P1+P2
 * KIMI gaps now closed).** First kernel modeling **N stacked independent
 * wheels sa per-wheel discrete PMF aggregation** — distinct od P-022 (single
 * wheel) i P-046 (wheel respin Markov).
 *
 * ── Math (Independent Multi-Wheel Sum sa Per-Slice Joint Disclosure) ───────
 *
 * N wheels (N ≥ 2). Per wheel i ∈ {1..N}: discrete PMF over M_i slices:
 *   - Slice probabilities p_{i,j}, Σ_j p_{i,j} = 1
 *   - Slice payout values V_{i,j} ≥ 0
 *
 * Per-wheel moment:
 *   μ_i = E[W_i] = Σ_j p_{i,j} · V_{i,j}
 *   E[W_i²] = Σ_j p_{i,j} · V_{i,j}²
 *   σ²_i = E[W_i²] − μ_i²
 *
 * **Joint aggregate Y = Σ_i W_i** under independence:
 *   **E[Y] = Σ_i μ_i**       (linearity)
 *   **Var[Y] = Σ_i σ²_i**     (independence)
 *
 * **Joint disclosure metrics**:
 *   - perWheel.expectedPayout = μ_i
 *   - perWheel.contributionToTotalRtp = μ_i / E[Y]
 *   - perWheel.varianceContribution = σ²_i / Var[Y]
 *   - **probabilityAllTopSlice = Π_i p_{i,j*}** (jackpot — all wheels hit
 *     top slice simultaneously)
 *   - probabilityAtLeastOneTopSlice = 1 − Π_i (1 − p_{i,j*}) (any wheel
 *     hits top)
 *   - **oneInNSpinsAllTopJackpot = 1 / probabilityAllTopSlice**
 *   - bestWheelIndex = argmax_i μ_i (highest-RTP wheel)
 *   - commercialUpliftVsSingleWheel = E[Y] / μ_{best} (N-wheel uplift over
 *     single-best-wheel baseline)
 *   - **independenceVarianceLift** = Σ σ²_i / (Σ σ_i)² ... well-defined for
 *     standard-deviation-additive comparison
 *
 * **Per-wheel top-slice tracking** (UKGC RTS-14 critical for jackpot
 * disclosure): each wheel's top-slice probability + value emitted.
 *
 * ── Distinct from ──────────────────────────────────────────────────────────
 *   - **P-022 (W104) Wheel Bonus** — SINGLE wheel sa categorical slice
 *     payout; ovde **N stacked independent wheels** sa aggregate sum.
 *   - **P-046 (W118) Bonus Wheel Respin** — multi-wheel respin **Markov**
 *     (one wheel triggers next); ovde **simultaneous independent** wheels
 *     bez Markov chain.
 *   - **P-035 (W075) Multi-tier WAP + Wheel** — per-tier wheel jackpot;
 *     ovde **per-wheel discrete PMF**, ne per-tier WAP.
 *   - **P-093 (W192) Race/Competitive Pick** — categorical winner across
 *     N candidates (one wins); ovde **all wheels spin, all pay**.
 *   - **P-091 (W190) Nested Mini-Slot** — hierarchical compositional;
 *     ovde **flat parallel aggregation**.
 *   - **P-030 (W110) Parallel Screens Aggregate** — slično iz N-screen
 *     perspective, ali ovde **specifično N-wheel composition** sa per-wheel
 *     PMF disclosure + top-slice joint jackpot probability (Π).
 *
 * Compliance:
 *   - **UKGC RTS-14** mandatory per-wheel RTP contribution disclosure
 *   - **UKGC RTS-3** simultaneous-wheel jackpot probability (Π p_i_top)
 *   - **MGA PPD §11** multi-wheel composition transparency
 *   - **eCOGRA** per-wheel slice + joint audit trail
 *   - **EU GA 2024** cross-jurisdiction baseline
 *
 * Naming: "wheel", "stacked wheels", "composition", "slice"
 * = generic slot-design + bonus-game terms. No vendor TM.
 */

/** ── Per-slice config ─────────────────────────────────────────────────────── */
export interface WheelSliceConfig {
  /** Optional slice label (audit trail; e.g. "mini", "minor", "major"). */
  label?: string;
  /** Slice selection probability ∈ [0, 1]; Σ_j = 1 per wheel. */
  probability: number;
  /** Payout × bet if this slice is selected (≥ 0). */
  payout: number;
}

/** ── Per-wheel config ─────────────────────────────────────────────────────── */
export interface StackedWheelConfig {
  /** Optional wheel label. */
  label?: string;
  /** Slice distribution over M_i ≥ 2 slices. */
  slices: WheelSliceConfig[];
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface StackedMultiWheelCompositionConfig {
  /** N stacked wheels (N ≥ 2). */
  wheels: StackedWheelConfig[];
}

/** ── Per-slice disclosure ─────────────────────────────────────────────────── */
export interface WheelSliceDisclosure {
  index: number;
  label: string;
  probability: number;
  payout: number;
  /** True if this slice has the highest payout in its wheel. */
  isTopSlice: boolean;
}

/** ── Per-wheel disclosure ─────────────────────────────────────────────────── */
export interface WheelDisclosure {
  index: number;
  label: string;
  numSlices: number;
  slices: WheelSliceDisclosure[];
  /** E[W_i] = Σ p_j · V_j. */
  expectedPayout: number;
  /** Var[W_i]. */
  variancePayout: number;
  /** σ_i. */
  stdDevPayout: number;
  /** μ_i / E[Y] (share of total RTP). */
  contributionToTotalRtp: number;
  /** σ²_i / Var[Y] (share of total variance). */
  varianceContribution: number;
  /** p_{i,j*} top-slice probability. */
  topSlicePayout: number;
  /** V_{i,j*} top-slice payout. */
  topSliceProbability: number;
  /** 1 / p_{i,j*} (1-in-N spins for this wheel's top slice). */
  oneInNSpinsForThisWheelTopSlice: number;
  /** True if this wheel has highest μ. */
  isBestWheel: boolean;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface StackedMultiWheelCompositionResult {
  /** N (number of stacked wheels). */
  numWheels: number;
  /** Per-wheel disclosure rows. */
  perWheel: WheelDisclosure[];
  /** E[Y] = Σ μ_i. */
  expectedTotalPayout: number;
  /** Var[Y] = Σ σ²_i. */
  varianceTotalPayout: number;
  /** Std dev total. */
  stdDevTotalPayout: number;
  /** argmax_i μ_i (best wheel index). */
  bestWheelIndex: number;
  /** Π_i p_{i,top} (probability all wheels hit top simultaneously — grand). */
  probabilityAllTopSlice: number;
  /** 1 − Π_i (1 − p_{i,top}) (at least one wheel hits top). */
  probabilityAtLeastOneTopSlice: number;
  /** 1 / Π_i p_{i,top} (regulator "1 in X" for grand jackpot). */
  oneInNSpinsAllTopJackpot: number;
  /** E[Y] / μ_{best} (N-wheel uplift over single-best baseline). */
  commercialUpliftVsSingleWheel: number;
  /** Σ σ_i (std-dev sum) — for variance scaling comparison. */
  sumStdDevs: number;
  /** σ_Y / Σ σ_i (independence-vs-perfectly-correlated indicator;
   *  = 1 for fully correlated, < 1 for independent). */
  independenceVarianceRatio: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: StackedMultiWheelCompositionConfig): void {
  if (!Array.isArray(cfg.wheels) || cfg.wheels.length < 2) {
    throw new Error(`wheels must be array of length ≥ 2, got ${cfg.wheels?.length ?? 0}`);
  }
  for (let i = 0; i < cfg.wheels.length; i++) {
    const w = cfg.wheels[i]!;
    if (!Array.isArray(w.slices) || w.slices.length < 2) {
      throw new Error(`wheels[${i}].slices must have length ≥ 2, got ${w.slices?.length ?? 0}`);
    }
    let sumP = 0;
    for (let j = 0; j < w.slices.length; j++) {
      const sl = w.slices[j]!;
      if (!Number.isFinite(sl.probability) || sl.probability < 0 || sl.probability > 1) {
        throw new Error(
          `wheels[${i}].slices[${j}].probability must be ∈ [0,1], got ${sl.probability}`,
        );
      }
      if (!Number.isFinite(sl.payout) || sl.payout < 0) {
        throw new Error(`wheels[${i}].slices[${j}].payout must be ≥ 0, got ${sl.payout}`);
      }
      sumP += sl.probability;
    }
    if (Math.abs(sumP - 1) > 1e-9) {
      throw new Error(`wheels[${i}].slices probability must sum to 1, got ${sumP}`);
    }
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeStackedMultiWheelComposition(
  cfg: StackedMultiWheelCompositionConfig,
): StackedMultiWheelCompositionResult {
  validate(cfg);

  const N = cfg.wheels.length;
  // Per-wheel moments
  const wheelMoments = cfg.wheels.map((w) => {
    const mu = w.slices.reduce((acc, sl) => acc + sl.probability * sl.payout, 0);
    const e2 = w.slices.reduce((acc, sl) => acc + sl.probability * sl.payout * sl.payout, 0);
    const variance = Math.max(0, e2 - mu * mu);
    return { mu, variance, stdDev: Math.sqrt(variance) };
  });

  const expectedTotalPayout = wheelMoments.reduce((acc, m) => acc + m.mu, 0);
  const varianceTotalPayout = wheelMoments.reduce((acc, m) => acc + m.variance, 0);
  const stdDevTotalPayout = Math.sqrt(Math.max(0, varianceTotalPayout));

  // Best wheel
  let bestWheelIndex = 0;
  for (let i = 1; i < N; i++) {
    if (wheelMoments[i]!.mu > wheelMoments[bestWheelIndex]!.mu) {
      bestWheelIndex = i;
    }
  }

  // Per-wheel disclosure rows
  const perWheel: WheelDisclosure[] = cfg.wheels.map((w, i) => {
    const m = wheelMoments[i]!;
    // Find top slice (max payout) of this wheel
    let topSliceIdx = 0;
    for (let j = 1; j < w.slices.length; j++) {
      if (w.slices[j]!.payout > w.slices[topSliceIdx]!.payout) topSliceIdx = j;
    }
    const topSlice = w.slices[topSliceIdx]!;
    const slicesDisclosure: WheelSliceDisclosure[] = w.slices.map((sl, j) => ({
      index: j,
      label: sl.label ?? `slice_${j}`,
      probability: sl.probability,
      payout: sl.payout,
      isTopSlice: j === topSliceIdx,
    }));
    return {
      index: i,
      label: w.label ?? `wheel_${i}`,
      numSlices: w.slices.length,
      slices: slicesDisclosure,
      expectedPayout: m.mu,
      variancePayout: m.variance,
      stdDevPayout: m.stdDev,
      contributionToTotalRtp:
        expectedTotalPayout > 1e-12 ? m.mu / expectedTotalPayout : 0,
      varianceContribution:
        varianceTotalPayout > 1e-12 ? m.variance / varianceTotalPayout : 0,
      topSliceProbability: topSlice.probability,
      topSlicePayout: topSlice.payout,
      oneInNSpinsForThisWheelTopSlice:
        topSlice.probability > 1e-15 ? 1 / topSlice.probability : Number.POSITIVE_INFINITY,
      isBestWheel: i === bestWheelIndex,
    };
  });

  // Joint top-slice metrics
  const probabilityAllTopSlice = perWheel.reduce(
    (acc, wd) => acc * wd.topSliceProbability,
    1,
  );
  const probabilityAtLeastOneTopSlice =
    1 - perWheel.reduce((acc, wd) => acc * (1 - wd.topSliceProbability), 1);
  const oneInNSpinsAllTopJackpot =
    probabilityAllTopSlice > 1e-15 ? 1 / probabilityAllTopSlice : Number.POSITIVE_INFINITY;

  const muBest = wheelMoments[bestWheelIndex]!.mu;
  const commercialUpliftVsSingleWheel =
    muBest > 1e-12 ? expectedTotalPayout / muBest : Number.POSITIVE_INFINITY;

  // independenceVarianceRatio = σ_Y / Σ σ_i (1 if all perfectly correlated,
  // < 1 for independent — typically √N · σ̄ / (N · σ̄) = 1/√N for equal wheels)
  const sumStdDevs = perWheel.reduce((acc, wd) => acc + wd.stdDevPayout, 0);
  const independenceVarianceRatio =
    sumStdDevs > 1e-12 ? stdDevTotalPayout / sumStdDevs : 0;

  return {
    numWheels: N,
    perWheel,
    expectedTotalPayout,
    varianceTotalPayout,
    stdDevTotalPayout,
    bestWheelIndex,
    probabilityAllTopSlice,
    probabilityAtLeastOneTopSlice,
    oneInNSpinsAllTopJackpot,
    commercialUpliftVsSingleWheel,
    sumStdDevs,
    independenceVarianceRatio,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveStackedMultiWheelComposition = analyzeStackedMultiWheelComposition;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateStackedMultiWheelComposition(
  cfg: StackedMultiWheelCompositionConfig,
  numSpins: number,
  seed = 0xface0196,
): {
  meanTotalPayout: number;
  stdDevTotalPayout: number;
  perWheelMeans: number[];
  observedAllTopSliceRate: number;
  observedAtLeastOneTopSliceRate: number;
} {
  validate(cfg);
  if (!Number.isInteger(numSpins) || numSpins < 1) {
    throw new Error(`numSpins must be integer ≥ 1, got ${numSpins}`);
  }

  const N = cfg.wheels.length;
  // Build per-wheel cumulative CDF
  const wheelCdfs: number[][] = cfg.wheels.map((w) => {
    const cdf: number[] = [];
    let cum = 0;
    for (const sl of w.slices) {
      cum += sl.probability;
      cdf.push(cum);
    }
    cdf[cdf.length - 1] = 1; // floating safety
    return cdf;
  });
  // Top slice index per wheel
  const topSliceIdx: number[] = cfg.wheels.map((w) => {
    let idx = 0;
    for (let j = 1; j < w.slices.length; j++) {
      if (w.slices[j]!.payout > w.slices[idx]!.payout) idx = j;
    }
    return idx;
  });

  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return (z >>> 0) / 4294967296;
  };
  const sampleSlice = (cdf: number[]): number => {
    const u = rng();
    for (let j = 0; j < cdf.length; j++) {
      if (u <= cdf[j]!) return j;
    }
    return cdf.length - 1;
  };

  let sumY = 0;
  let sumY2 = 0;
  const perWheelSums = new Array<number>(N).fill(0);
  let allTopCount = 0;
  let atLeastOneTopCount = 0;

  for (let spin = 0; spin < numSpins; spin++) {
    let y = 0;
    let allTop = true;
    let anyTop = false;
    for (let i = 0; i < N; i++) {
      const j = sampleSlice(wheelCdfs[i]!);
      const payout = cfg.wheels[i]!.slices[j]!.payout;
      y += payout;
      perWheelSums[i]! += payout;
      if (j !== topSliceIdx[i]!) allTop = false;
      else anyTop = true;
    }
    if (allTop) allTopCount++;
    if (anyTop) atLeastOneTopCount++;
    sumY += y;
    sumY2 += y * y;
  }

  const meanY = sumY / numSpins;
  const varY = Math.max(0, sumY2 / numSpins - meanY * meanY);
  return {
    meanTotalPayout: meanY,
    stdDevTotalPayout: Math.sqrt(varY),
    perWheelMeans: perWheelSums.map((s) => s / numSpins),
    observedAllTopSliceRate: allTopCount / numSpins,
    observedAtLeastOneTopSliceRate: atLeastOneTopCount / numSpins,
  };
}
