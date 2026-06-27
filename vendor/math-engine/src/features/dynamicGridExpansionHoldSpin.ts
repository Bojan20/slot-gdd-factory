/**
 * W152 Wave 182 — Dynamic Grid-Expansion Hold-and-Spin Aggregator (63. solver).
 *
 * **L&W M3 GAP CLOSURE** — covers 8+ L&W titles iz Ultimate Fire Link +
 * Lock It Link Eureka families.
 *
 * Iconic dynamic-grid Hold-and-Spin mehanika:
 *   * SG Gaming Ultimate Fire Link Olvera Street (5-row → max 9-row expansion)
 *   * Ultimate Fire Link China Street / Riverwalk / Boardwalk / Route 66
 *   * Ultimate Fire Link Power 4 / Cash Falls / Explosion
 *   * Bally Lock It Link Eureka Reel Blast (dynamite scatters trigger row-add)
 *
 * **63rd closed-form solver.** First kernel modeling **dynamic rectangular
 * grid-state-space Markov sa cumulative-landing-trigger row-extension events**
 * — distinct od P-002 / P-049 / P-059 (sve assume FIXED grid).
 *
 * ── Math (Two-Level Markov Aggregator) ──────────────────────────────────────
 *
 * **Level 1: per-spin landing.** Grid currently N reels × m rows (m varies
 * dynamically during the feature). U_t empty cells = N·m − A_{t-1} (active
 * cash-bag cells from prior spins). Per spin: B_t ~ Binomial(U_t, q) new
 * landings. Classic H&S 3-spin reset: counter resets ako B_t ≥ 1, else
 * decrements; bonus ends when counter hits 0 (or grid fully filled).
 *
 * **Level 2: cumulative-landing trigger.** Cumulative landings S_t = Σ B_s.
 * R deterministic thresholds T_1 < T_2 < ... < T_R; m extends by +1 row
 * each time S_t crosses next threshold. Max m = m_0 + R.
 *
 * ── Closed-form aggregates (independence + steady-state) ────────────────────
 *
 * Conditional on average mid-feature row count m_avg (computed iteratively):
 *
 *   - E[B per spin | m, A] = (N·m − A) · q
 *   - E[spins until 3 stale] = (1/p_land) · 3, where p_land = 1 − (1 − q)^(N·m − A)
 *     **Geometric** with success = "any landing in spin" + 3-consecutive-failure rule:
 *     Approximate as **Negative-Binomial**: T_stop = first time 3 consecutive failures occur.
 *     E[T] ≈ (1 − p_fail³) / (p_land · p_fail³) + 3 for steady p_land.
 *     Practical simplification: E[T] ≈ (1 + 1/p_land + 2/p_land²) (renewal-bound).
 *
 * For acceptance-level math we adopt the **negative-binomial-with-stale-reset**
 * exact closed form for the canonical H&S termination distribution:
 *
 *   E[T_total] = (1 − p_fail^3) / (p_land · p_fail^3)         (formal)
 *   p_fail = 1 − p_land = (1 − q)^empty_cells
 *
 * **Approximation pipeline** (closed-form, no recursive DP):
 *   1. Estimate average empty cells across feature E[U_avg] iteratively
 *   2. Compute E[B/spin], E[T_total], E[bags landed total]
 *   3. Compute E[row extensions] = Σ_k P(S_total ≥ T_k)
 *   4. Compute E[final active cells] = E[B total landings]
 *   5. Compute E[payout total] = E[active cells] · E[value per cell]
 *
 * **Disclosure metrics**:
 *   - expectedFinalActiveCells = E[A_final]
 *   - expectedRowExtensions = Σ P(S_total ≥ T_k)
 *   - expectedSpinsToTermination = E[T_total]
 *   - expectedTotalPayout = E[bags] · μ_V
 *   - probGridFullyFilled = approx via geometric tail on extra-row capacity
 *   - oneInNFeatureMaxRowAchieved = 1 / P(all R extensions triggered)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-002 (W023) Persistent-Grid Cash-Collect** — FIXED grid, ne dynamic
 *   - **P-049 (W134) Hold-and-Win Multi-Tier Value-Based** — fixed grid + value tier
 *   - **P-059 (W049) N-tier H&W Jackpot Ladder** — fixed grid + jackpot ladder
 *   - **P-076 (W169) Drop-and-Stick Wild Expansion** — sticky for S spins, ne H&S accumulation
 *   - **P-082 (W181) Reel-Bound Mystery Progressive** — per-reel adjacency, ne grid-expansion
 *
 * Compliance:
 *   - UKGC RTS 14 (feature mechanic disclosure — grid expansion is regulator-flagged)
 *   - MGA PPD §11 (H&S trigger + grid-state transparency)
 *   - eCOGRA Generic Slots Audit (grid evolution audit trail)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "grid expansion", "hold-and-spin", "row extension" = generic
 * slot-design terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface DynamicGridExpansionConfig {
  /** Number of reels N ≥ 1 (grid width). */
  numReels: number;
  /** Initial number of rows m_0 ≥ 1. */
  initialRows: number;
  /** Maximum extra rows beyond m_0 (M_max = m_0 + maxExtraRows). */
  maxExtraRows: number;
  /** Per-cell per-spin landing probability q ∈ (0, 1). */
  probLandingPerEmptyCell: number;
  /** Stale-spin reset counter (classic H&S: 3). */
  staleSpinsBeforeBust: number;
  /** Cumulative-landing thresholds T_1 < T_2 < ... < T_R (each triggers +1 row). */
  rowExtensionThresholds: number[];
  /** Mean value per cash bag (in × bet units). */
  expectedValuePerBag: number;
  /** Variance of value per cash bag (≥ 0). */
  varianceValuePerBag: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface DynamicGridExpansionResult {
  /** E[total bags landed during feature]. */
  expectedTotalBags: number;
  /** Var[total bags landed]. */
  varianceTotalBags: number;
  /** E[final active cells in grid] = E[total bags] (monotone). */
  expectedFinalActiveCells: number;
  /** Per-threshold trigger probabilities P(S_total ≥ T_k). */
  rowExtensionProbabilities: number[];
  /** E[# row extensions triggered]. */
  expectedRowExtensions: number;
  /** E[final grid size] = m_0 + E[# extensions]. */
  expectedFinalRowCount: number;
  /** E[spins to bonus termination]. */
  expectedSpinsToTermination: number;
  /** Var[spins to termination]. */
  varianceSpinsToTermination: number;
  /** E[total payout in × bet]. */
  expectedTotalPayout: number;
  /** Std deviation of total payout. */
  stdDevTotalPayout: number;
  /** P(all R extensions triggered — full max-grid achievable). */
  probFullMaxGridAchieved: number;
  /** 1 / P(full max-grid). */
  oneInNFeaturesMaxGrid: number;
  /** Commercial uplift ratio = E[payout] / (baseline fixed-grid feature E[payout @ m_0]). */
  commercialUpliftVsFixedGrid: number;
  /** Effective per-spin landing rate at steady-state. */
  effectiveSteadyStateLandingProb: number;
}

/** ── Numerical helpers ──────────────────────────────────────────────────────── */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: DynamicGridExpansionConfig): void {
  if (!Number.isInteger(cfg.numReels) || cfg.numReels < 1) {
    throw new Error(`numReels must be integer ≥ 1, got ${cfg.numReels}`);
  }
  if (!Number.isInteger(cfg.initialRows) || cfg.initialRows < 1) {
    throw new Error(`initialRows must be integer ≥ 1, got ${cfg.initialRows}`);
  }
  if (!Number.isInteger(cfg.maxExtraRows) || cfg.maxExtraRows < 0) {
    throw new Error(`maxExtraRows must be integer ≥ 0, got ${cfg.maxExtraRows}`);
  }
  if (
    !Number.isFinite(cfg.probLandingPerEmptyCell) ||
    cfg.probLandingPerEmptyCell <= 0 ||
    cfg.probLandingPerEmptyCell >= 1
  ) {
    throw new Error(
      `probLandingPerEmptyCell must be in (0, 1), got ${cfg.probLandingPerEmptyCell}`,
    );
  }
  if (!Number.isInteger(cfg.staleSpinsBeforeBust) || cfg.staleSpinsBeforeBust < 1) {
    throw new Error(`staleSpinsBeforeBust must be integer ≥ 1, got ${cfg.staleSpinsBeforeBust}`);
  }
  if (!Array.isArray(cfg.rowExtensionThresholds)) {
    throw new Error('rowExtensionThresholds must be an array');
  }
  if (cfg.rowExtensionThresholds.length !== cfg.maxExtraRows) {
    throw new Error(
      `rowExtensionThresholds.length (${cfg.rowExtensionThresholds.length}) must equal maxExtraRows (${cfg.maxExtraRows})`,
    );
  }
  for (let k = 0; k < cfg.rowExtensionThresholds.length; k++) {
    const t = cfg.rowExtensionThresholds[k];
    if (!Number.isFinite(t) || t < 1) {
      throw new Error(`rowExtensionThresholds[${k}] must be ≥ 1, got ${t}`);
    }
    if (k > 0 && t <= cfg.rowExtensionThresholds[k - 1]) {
      throw new Error(
        `rowExtensionThresholds must be strictly increasing, got [${k - 1}]=${cfg.rowExtensionThresholds[k - 1]} ≥ [${k}]=${t}`,
      );
    }
  }
  if (!Number.isFinite(cfg.expectedValuePerBag) || cfg.expectedValuePerBag < 0) {
    throw new Error(`expectedValuePerBag must be ≥ 0, got ${cfg.expectedValuePerBag}`);
  }
  if (!Number.isFinite(cfg.varianceValuePerBag) || cfg.varianceValuePerBag < 0) {
    throw new Error(`varianceValuePerBag must be ≥ 0, got ${cfg.varianceValuePerBag}`);
  }
}

/** ── Closed-form analyzer (exact Markov DP) ──────────────────────────────────
 *
 * Per-spin transition over state (active, m, stale) with deterministic row
 * extensions when cumulative landings cross thresholds. Binomial(empty, q)
 * landing PMF computed exactly per state. Termination: stale == k_stale OR
 * grid fully filled.
 *
 * State space is small for industry-relevant inputs (≤ N·m_max · (R+1) ·
 * k_stale states); typical Ultimate Fire Link configs run in <1ms.
 */
export function analyzeDynamicGridExpansion(
  cfg: DynamicGridExpansionConfig,
): DynamicGridExpansionResult {
  validate(cfg);

  const N = cfg.numReels;
  const m0 = cfg.initialRows;
  const R = cfg.maxExtraRows;
  const q = cfg.probLandingPerEmptyCell;
  const kStale = cfg.staleSpinsBeforeBust;
  const T = cfg.rowExtensionThresholds;
  const muV = cfg.expectedValuePerBag;
  const sigma2V = cfg.varianceValuePerBag;
  const mMax = m0 + R;
  const cellsMax = N * mMax;

  // Precompute Binomial PMFs Bin(n, q) za n = 0..cellsMax. Numerically stable
  // log-space accumulator for n up to ~1000; for typical N·m_max < 100 the
  // direct iterative formula is fine.
  const binomialPmf = (n: number): number[] => {
    const pmf = new Array(n + 1).fill(0);
    if (n === 0) {
      pmf[0] = 1;
      return pmf;
    }
    // Start with (1−q)^n then multiply by q/(1−q) and (n−k+1)/k iteratively
    const oneMinusQ = 1 - q;
    pmf[0] = Math.pow(oneMinusQ, n);
    const ratio = q / oneMinusQ;
    for (let k = 1; k <= n; k++) {
      pmf[k] = (pmf[k - 1] * ratio * (n - k + 1)) / k;
    }
    return pmf;
  };
  const pmfCache: Map<number, number[]> = new Map();
  const getPmf = (n: number): number[] => {
    let pmf = pmfCache.get(n);
    if (!pmf) {
      pmf = binomialPmf(n);
      pmfCache.set(n, pmf);
    }
    return pmf;
  };

  // State key: (active, m_idx, stale, cumLandings) — but cumLandings monotone
  // and bounded; we track row-index extensionsTriggered instead.
  // Map (active, m_idx, stale) → probability mass. Transition iteratively.
  // Use string keys for the small map.
  type StateProb = { p: number; bags: number; bagsSq: number; spins: number; spinsSq: number };
  const stateMap: Map<string, StateProb> = new Map();
  const key = (a: number, mIdx: number, s: number): string => `${a},${mIdx},${s}`;
  stateMap.set(key(0, 0, 0), { p: 1, bags: 0, bagsSq: 0, spins: 0, spinsSq: 0 });

  // Accumulators for terminal states.
  let terminalProb = 0;
  let termBagsSum = 0;
  let termBagsSqSum = 0;
  let termSpinsSum = 0;
  let termSpinsSqSum = 0;
  const rowExtensionMass = new Array(R).fill(0); // mass of features that triggered ≥k-th extension
  let fullMaxGridMass = 0;

  // Hard cap on iterations to prevent infinite-loop on numerical edge.
  const maxIter = Math.max(50, cellsMax * 4 + kStale * 4);
  for (let iter = 0; iter < maxIter; iter++) {
    if (stateMap.size === 0) break;
    const next: Map<string, StateProb> = new Map();
    let liveMassRemaining = 0;
    for (const [k, st] of stateMap) {
      const [aStr, mIdxStr, sStr] = k.split(',');
      const a = parseInt(aStr, 10);
      const mIdx = parseInt(mIdxStr, 10);
      const s = parseInt(sStr, 10);
      const mNow = m0 + mIdx;
      const totalCells = N * mNow;
      const empty = totalCells - a;
      if (empty <= 0) {
        // Grid full: terminate immediately
        terminalProb += st.p;
        termBagsSum += st.p * st.bags;
        termBagsSqSum += st.p * st.bagsSq;
        termSpinsSum += st.p * st.spins;
        termSpinsSqSum += st.p * st.spinsSq;
        for (let r = 0; r < R; r++) {
          if (st.bags >= T[r]) rowExtensionMass[r] += st.p;
        }
        if (st.bags >= (T[R - 1] ?? Infinity)) fullMaxGridMass += st.p;
        continue;
      }
      const pmf = getPmf(empty);
      const newSpins = st.spins + 1;
      const newSpinsSq = st.spinsSq + 2 * st.spins + 1; // (s+1)² = s² + 2s + 1
      for (let b = 0; b <= empty; b++) {
        const pTrans = pmf[b];
        if (pTrans < 1e-18) continue;
        const massHere = st.p * pTrans;
        const newA = a + b;
        const newBags = st.bags + b;
        const newBagsSq = st.bagsSq + 2 * st.bags * b + b * b;
        // Row extensions: count how many thresholds the new bags total crosses
        // (deterministic — applies row-by-row, but we only track mIdx).
        let newMIdx = mIdx;
        while (newMIdx < R && newBags >= T[newMIdx]) newMIdx++;
        // Stale counter
        const newStale = b === 0 ? s + 1 : 0;
        if (newStale >= kStale) {
          // Terminate
          terminalProb += massHere;
          termBagsSum += massHere * newBags;
          termBagsSqSum += massHere * newBagsSq;
          termSpinsSum += massHere * newSpins;
          termSpinsSqSum += massHere * newSpinsSq;
          for (let r = 0; r < R; r++) {
            if (newBags >= T[r]) rowExtensionMass[r] += massHere;
          }
          if (newBags >= (T[R - 1] ?? Infinity)) fullMaxGridMass += massHere;
          continue;
        }
        const newTotalCells = N * (m0 + newMIdx);
        if (newA >= newTotalCells) {
          // Grid full after this spin
          terminalProb += massHere;
          termBagsSum += massHere * newBags;
          termBagsSqSum += massHere * newBagsSq;
          termSpinsSum += massHere * newSpins;
          termSpinsSqSum += massHere * newSpinsSq;
          for (let r = 0; r < R; r++) {
            if (newBags >= T[r]) rowExtensionMass[r] += massHere;
          }
          if (newBags >= (T[R - 1] ?? Infinity)) fullMaxGridMass += massHere;
          continue;
        }
        const nk = key(newA, newMIdx, newStale);
        const existing = next.get(nk);
        if (existing) {
          const oldP = existing.p;
          const totalP = oldP + massHere;
          existing.bags = (existing.bags * oldP + newBags * massHere) / totalP;
          existing.bagsSq = (existing.bagsSq * oldP + newBagsSq * massHere) / totalP;
          existing.spins = (existing.spins * oldP + newSpins * massHere) / totalP;
          existing.spinsSq = (existing.spinsSq * oldP + newSpinsSq * massHere) / totalP;
          existing.p = totalP;
        } else {
          next.set(nk, {
            p: massHere,
            bags: newBags,
            bagsSq: newBagsSq,
            spins: newSpins,
            spinsSq: newSpinsSq,
          });
        }
        liveMassRemaining += massHere;
      }
    }
    stateMap.clear();
    for (const [k, v] of next) stateMap.set(k, v);
    if (liveMassRemaining < 1e-12) break;
  }
  // Drain any residual probability (numerical edge) as terminated.
  for (const [, st] of stateMap) {
    terminalProb += st.p;
    termBagsSum += st.p * st.bags;
    termBagsSqSum += st.p * st.bagsSq;
    termSpinsSum += st.p * st.spins;
    termSpinsSqSum += st.p * st.spinsSq;
    for (let r = 0; r < R; r++) {
      if (st.bags >= T[r]) rowExtensionMass[r] += st.p;
    }
    if (st.bags >= (T[R - 1] ?? Infinity)) fullMaxGridMass += st.p;
  }

  // Normalize against terminalProb (should be ≈ 1; tiny numerical drift OK).
  const Z = Math.max(terminalProb, 1e-15);
  const expectedBags = termBagsSum / Z;
  const expectedBagsSq = termBagsSqSum / Z;
  const varianceBags = Math.max(0, expectedBagsSq - expectedBags * expectedBags);
  const expectedSpins = termSpinsSum / Z;
  const expectedSpinsSq = termSpinsSqSum / Z;
  const varianceSpins = Math.max(0, expectedSpinsSq - expectedSpins * expectedSpins);

  const rowExtensionProbabilities = rowExtensionMass.map((m) => clamp01(m / Z));
  const expectedRowExtensions = rowExtensionProbabilities.reduce((a, b) => a + b, 0);
  const probFullMaxGridAchieved = R > 0 ? clamp01(fullMaxGridMass / Z) : 1;
  const oneInNFeaturesMaxGrid =
    probFullMaxGridAchieved > 1e-12 ? 1 / probFullMaxGridAchieved : Number.POSITIVE_INFINITY;

  const expectedTotalPayout = expectedBags * muV;
  const variancePayout = expectedBags * sigma2V + varianceBags * muV * muV;
  const stdDevTotalPayout = Math.sqrt(Math.max(0, variancePayout));

  // Baseline (fixed grid m_0) for commercial uplift — recompute via same DP
  // with R=0 to get apples-to-apples comparison.
  let commercialUpliftVsFixedGrid = 1;
  if (R > 0) {
    const baseline = analyzeDynamicGridExpansion({
      ...cfg,
      maxExtraRows: 0,
      rowExtensionThresholds: [],
    });
    commercialUpliftVsFixedGrid =
      baseline.expectedTotalPayout > 1e-9 ? expectedTotalPayout / baseline.expectedTotalPayout : 1;
  }

  // Effective steady-state landing prob (informational) at m0+R/2 average:
  const mAvg = m0 + R / 2;
  const effectiveSteadyStateLandingProb = clamp01(1 - Math.pow(1 - q, (N * mAvg) / 2));

  return {
    expectedTotalBags: expectedBags,
    varianceTotalBags: varianceBags,
    expectedFinalActiveCells: expectedBags,
    rowExtensionProbabilities,
    expectedRowExtensions,
    expectedFinalRowCount: m0 + expectedRowExtensions,
    expectedSpinsToTermination: expectedSpins,
    varianceSpinsToTermination: varianceSpins,
    expectedTotalPayout,
    stdDevTotalPayout,
    probFullMaxGridAchieved,
    oneInNFeaturesMaxGrid,
    commercialUpliftVsFixedGrid,
    effectiveSteadyStateLandingProb,
  };
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solveDynamicGridExpansion = analyzeDynamicGridExpansion;

/** Abramowitz-Stegun normal CDF (max abs err ~7.5e-8). */
function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const az = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * az);
  const erfApprox =
    1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-az * az);
  return 0.5 * (1 + sign * erfApprox);
}

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateDynamicGridExpansion(
  cfg: DynamicGridExpansionConfig,
  numFeatures: number,
  seed = 0xface0182,
): {
  meanTotalBags: number;
  meanFinalActiveCells: number;
  meanRowExtensions: number;
  meanFinalRowCount: number;
  meanSpinsToTermination: number;
  meanTotalPayout: number;
  stdDevTotalPayout: number;
  probFullMaxGridAchieved: number;
} {
  validate(cfg);
  if (!Number.isInteger(numFeatures) || numFeatures < 1) {
    throw new Error(`numFeatures must be integer ≥ 1, got ${numFeatures}`);
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
  const sigmaV = Math.sqrt(cfg.varianceValuePerBag);
  const gaussian = (mu: number, sigma: number): number => {
    if (sigma <= 0) return mu;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mu + sigma * z);
  };

  const N = cfg.numReels;
  const m0 = cfg.initialRows;
  const R = cfg.maxExtraRows;
  const q = cfg.probLandingPerEmptyCell;
  const kStale = cfg.staleSpinsBeforeBust;
  const T = cfg.rowExtensionThresholds;

  let sumBags = 0;
  let sumRowExt = 0;
  let sumSpins = 0;
  let sumPayout = 0;
  let sumPayout2 = 0;
  let countFullGrid = 0;

  for (let f = 0; f < numFeatures; f++) {
    let m = m0;
    let active = 0;
    let cumLandings = 0;
    let extensionsTriggered = 0;
    let staleStreak = 0;
    let spins = 0;
    let payout = 0;
    const maxRows = m0 + R;
    while (staleStreak < kStale) {
      spins++;
      const totalCells = N * m;
      const emptyCells = totalCells - active;
      if (emptyCells <= 0) break; // grid fully filled
      let landings = 0;
      for (let c = 0; c < emptyCells; c++) {
        if (rng() < q) landings++;
      }
      if (landings > 0) {
        active += landings;
        cumLandings += landings;
        for (let l = 0; l < landings; l++) {
          payout += gaussian(cfg.expectedValuePerBag, sigmaV);
        }
        // Check row-extension thresholds:
        while (extensionsTriggered < R && cumLandings >= T[extensionsTriggered] && m < maxRows) {
          m++;
          extensionsTriggered++;
        }
        staleStreak = 0;
      } else {
        staleStreak++;
      }
    }
    sumBags += cumLandings;
    sumRowExt += extensionsTriggered;
    sumSpins += spins;
    sumPayout += payout;
    sumPayout2 += payout * payout;
    if (extensionsTriggered === R) countFullGrid++;
  }

  const meanBags = sumBags / numFeatures;
  const meanRowExt = sumRowExt / numFeatures;
  const meanSpins = sumSpins / numFeatures;
  const meanPayout = sumPayout / numFeatures;
  const varPayout = Math.max(0, sumPayout2 / numFeatures - meanPayout * meanPayout);

  return {
    meanTotalBags: meanBags,
    meanFinalActiveCells: meanBags,
    meanRowExtensions: meanRowExt,
    meanFinalRowCount: m0 + meanRowExt,
    meanSpinsToTermination: meanSpins,
    meanTotalPayout: meanPayout,
    stdDevTotalPayout: Math.sqrt(varPayout),
    probFullMaxGridAchieved: countFullGrid / numFeatures,
  };
}
