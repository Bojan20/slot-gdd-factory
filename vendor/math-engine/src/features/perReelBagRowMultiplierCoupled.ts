/**
 * W152 Wave 185 — Per-Reel Cash-Bag × Per-Row-Multiplier Coupled Accumulator (66. solver).
 *
 * **L&W M1 P0 GAP CLOSURE** — covers Dragon Spin CrossLink Water + future
 * L&W flagship direction.
 *
 * Iconic two-dimensional aggregator mehanika:
 *   * LNW Dragon Spin CrossLink Water (2024) — gold-coin bag fill per reel
 *     + per-row multiplier increment; defining novel L&W 2024 release
 *   * Future L&W variants extending the CrossLink pattern
 *
 * **66th closed-form solver.** First kernel modeling **per-reel cash-bag
 * accumulator coupled sa per-row multiplier ramp** — distinct od svih
 * postojećih single-pool collectors (P-002) i single-meter K-tier (P-067)
 * jer ovde rad imamo **dvodimenzionalan aggregator gde svaka landeing-coin
 * koincidentno doprinosi i reel-bag-u i row-multiplieru**.
 *
 * ── Math (Per-Cell Bernoulli × Coupled Dimension Aggregation) ──────────────
 *
 * Grid N reels × M rows. Per cell (i, j): I_{ij} ~ Bernoulli(q) independent.
 * Conditional on I_{ij} = 1, coin value V_{ij} ~ iid distribution sa
 * E[V] = μ_V, Var[V] = σ²_V.
 *
 * **Per-reel bag**: B_i = Σ_{j=1..M} I_{ij} · V_{ij}
 *   E[B_i] = M·q·μ_V (Wald compound)
 *   Var[B_i] = M·q·σ²_V + M·q·(1−q)·μ_V² (Bernoulli-mixed compound)
 *
 * **Per-row coin count**: C_j = Σ_{i=1..N} I_{ij}
 *   C_j ~ Binomial(N, q)
 *
 * **Per-row multiplier**: M_j(C_j) = vendor-specified function of coin count.
 *   Operator-provided lookup: multiplierByRowCoinCount[c] = m_c (length N+1)
 *   Typical Dragon Spin CrossLink Water: m_0 = 1, m_1 = 1, m_2 = 2, m_3 = 5,
 *   m_4 = 10, m_5 = 25 (escalating reward for "row fill").
 *
 * **Row j contribution to payout**: M_j · S_j gde S_j = Σ_i I_{ij}·V_{ij}
 *   By tower property (V independent of I):
 *   E[M_j · S_j] = E[M_j(C_j) · C_j · μ_V]   (conditional on C_j, S_j is
 *                                            sum of C_j iid V)
 *                = μ_V · Σ_{c=0..N} P(C_j = c) · m_c · c
 *
 * **Total payout per spin**: Y = Σ_{j=1..M} M_j · S_j (M rows iid)
 *   **E[Y] = M · μ_V · Σ_{c=0..N} Bin(c; N, q) · m_c · c**
 *
 * Variance (rows independent under iid assumption):
 *   Var[Y] = M · Var[M_j · S_j]
 *   E[(M_j·S_j)² | C_j=c] = m_c² · E[S_j² | C_j=c] = m_c² · (c·σ²_V + c²·μ_V²)
 *   E[(M_j·S_j)²] = Σ_c P(C_j=c) · m_c² · (c·σ²_V + c²·μ_V²)
 *   Var[M_j·S_j] = E[(M_j·S_j)²] − (E[M_j·S_j])²
 *
 * **Disclosure metrics**:
 *   - E[B_i] per-reel bag expectation (uniform across reels)
 *   - E[M_j] per-row multiplier expectation
 *   - **probAllRowsFull** = P(C_j = N)^M = q^(N·M) (all M rows fully filled)
 *   - **expectedRowsFull** = M · P(C_j = N) = M · q^N
 *   - **expectedHighestRowMultiplier** = E[max_{j=1..M} M_j(C_j)]
 *   - **commercialUpliftVsFlatMultiplier** = E[Y_coupled] / E[Y_flat] gde
 *     flat baseline koristi m_c = 1 svuda (čisti collector bez multiplier ramp-a)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-002 (W023) Persistent-Grid Cash-Collect** — SINGLE pool sum, ne dvostruka
 *     dimenzija; single-grid collector bez per-row multiplier ramp
 *   - **P-067 (W150) Voltage Meter Multi-Tier** — SINGLE meter K-tier, ne
 *     two-dimensional reel×row decomposition
 *   - **P-039 / P-046 Global Persistent Multiplier** — global scalar, ne per-row
 *   - **P-051 (W091) Coin Accumulator Mystery** — unconditional value-sum, ne
 *     coupled to row position
 *   - **P-083 (W182) Dynamic Grid-Expansion H&S** — grid evolves, ne per-cell
 *     two-dim aggregator
 *   - **P-085 (W184) Colossal Reels Wild-Transfer** — two-grid wild transfer,
 *     ne single-grid per-reel×per-row coupling
 *
 * Compliance:
 *   - UKGC RTS 14 (multi-dimensional feature aggregator disclosure)
 *   - MGA PPD §11 (per-reel + per-row reward transparency)
 *   - eCOGRA Generic Slots Audit (dual-dimension accumulator audit trail)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "per-reel bag", "per-row multiplier", "coupled aggregator" = generic
 * slot-design terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface PerReelBagRowMultiplierConfig {
  /** Number of reels N ≥ 1 (grid width). */
  numReels: number;
  /** Number of rows M ≥ 1 (grid height). */
  numRows: number;
  /** Per-cell Bernoulli landing probability q ∈ (0, 1). */
  probCoinLandPerCell: number;
  /** Mean value per landed coin (≥ 0). */
  expectedCoinValue: number;
  /** Variance of coin value (≥ 0). */
  varianceCoinValue: number;
  /**
   * Per-row multiplier as function of row-coin count, length N+1.
   * multiplierByRowCoinCount[c] = m_c, multiplier when row has c coins.
   * Convention: m_0 typically 1 (or 0 if "no coins → no reward").
   */
  multiplierByRowCoinCount: number[];
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface PerReelBagRowMultiplierResult {
  /** E[B_i] per-reel bag expectation (uniform across reels). */
  expectedReelBag: number;
  /** Var[B_i] per-reel bag variance. */
  varianceReelBag: number;
  /** E[C_j] per-row coin count expectation = N·q. */
  expectedRowCoinCount: number;
  /** E[M_j(C_j)] per-row multiplier expectation. */
  expectedRowMultiplier: number;
  /** PMF of row coin count C_j ~ Binomial(N, q), length N+1. */
  rowCoinCountPmf: number[];
  /** E[M_j · S_j] per-row payout contribution (mult × value sum). */
  expectedRowContribution: number;
  /** Var[M_j · S_j] per-row payout variance. */
  varianceRowContribution: number;
  /** E[Y] total expected payout per spin = M · E[row contribution]. */
  expectedTotalPayoutPerSpin: number;
  /** Var[Y] total payout variance (rows iid). */
  varianceTotalPayoutPerSpin: number;
  /** StdDev[Y]. */
  stdDevTotalPayoutPerSpin: number;
  /** P(at least one row full = C_j = N). */
  probAtLeastOneRowFull: number;
  /** E[# rows full] = M · q^N. */
  expectedRowsFull: number;
  /** Probability all M rows fully filled (q^(N·M)). */
  probAllRowsFull: number;
  /** 1 / probAtLeastOneRowFull regulator "1 in X" form. */
  oneInNSpinsAtLeastOneRowFull: number;
  /** E[max_{j} M_j(C_j)] expected highest-row multiplier. */
  expectedHighestRowMultiplier: number;
  /** Commercial uplift vs flat (m_c = 1) baseline. */
  commercialUpliftVsFlatMultiplier: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: PerReelBagRowMultiplierConfig): void {
  if (!Number.isInteger(cfg.numReels) || cfg.numReels < 1) {
    throw new Error(`numReels must be integer ≥ 1, got ${cfg.numReels}`);
  }
  if (!Number.isInteger(cfg.numRows) || cfg.numRows < 1) {
    throw new Error(`numRows must be integer ≥ 1, got ${cfg.numRows}`);
  }
  if (
    !Number.isFinite(cfg.probCoinLandPerCell) ||
    cfg.probCoinLandPerCell <= 0 ||
    cfg.probCoinLandPerCell >= 1
  ) {
    throw new Error(`probCoinLandPerCell must be in (0, 1), got ${cfg.probCoinLandPerCell}`);
  }
  if (!Number.isFinite(cfg.expectedCoinValue) || cfg.expectedCoinValue < 0) {
    throw new Error(`expectedCoinValue must be ≥ 0, got ${cfg.expectedCoinValue}`);
  }
  if (!Number.isFinite(cfg.varianceCoinValue) || cfg.varianceCoinValue < 0) {
    throw new Error(`varianceCoinValue must be ≥ 0, got ${cfg.varianceCoinValue}`);
  }
  const Np1 = cfg.numReels + 1;
  if (
    !Array.isArray(cfg.multiplierByRowCoinCount) ||
    cfg.multiplierByRowCoinCount.length !== Np1
  ) {
    throw new Error(
      `multiplierByRowCoinCount must have length ${Np1}, got ${cfg.multiplierByRowCoinCount?.length}`,
    );
  }
  for (let c = 0; c <= cfg.numReels; c++) {
    if (
      !Number.isFinite(cfg.multiplierByRowCoinCount[c]) ||
      cfg.multiplierByRowCoinCount[c] < 0
    ) {
      throw new Error(
        `multiplierByRowCoinCount[${c}] must be ≥ 0, got ${cfg.multiplierByRowCoinCount[c]}`,
      );
    }
  }
}

/** ── Binomial PMF (n, p). */
function binomialPmf(n: number, p: number): number[] {
  const pmf = new Array(n + 1).fill(0);
  if (n === 0) {
    pmf[0] = 1;
    return pmf;
  }
  if (p <= 0) {
    pmf[0] = 1;
    return pmf;
  }
  if (p >= 1) {
    pmf[n] = 1;
    return pmf;
  }
  const oneMinusP = 1 - p;
  pmf[0] = Math.pow(oneMinusP, n);
  const ratio = p / oneMinusP;
  for (let k = 1; k <= n; k++) {
    pmf[k] = (pmf[k - 1] * ratio * (n - k + 1)) / k;
  }
  return pmf;
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzePerReelBagRowMultiplierCoupled(
  cfg: PerReelBagRowMultiplierConfig,
): PerReelBagRowMultiplierResult {
  validate(cfg);

  const N = cfg.numReels;
  const M = cfg.numRows;
  const q = cfg.probCoinLandPerCell;
  const muV = cfg.expectedCoinValue;
  const sig2V = cfg.varianceCoinValue;
  const mult = cfg.multiplierByRowCoinCount;

  // ── Per-reel bag (Wald compound of Bernoulli × value)
  const expectedReelBag = M * q * muV;
  const varianceReelBag = M * q * sig2V + M * q * (1 - q) * muV * muV;

  // ── Per-row coin count C_j ~ Binomial(N, q)
  const pmfC = binomialPmf(N, q);
  const expectedRowCoinCount = N * q;

  // ── Per-row multiplier expectation E[M_j(C_j)]
  let expectedRowMultiplier = 0;
  for (let c = 0; c <= N; c++) expectedRowMultiplier += pmfC[c] * mult[c];

  // ── Per-row payout contribution E[M_j · S_j] = μ_V · Σ_c P(C_j=c)·m_c·c
  let expectedRowContribution = 0;
  for (let c = 0; c <= N; c++) expectedRowContribution += pmfC[c] * mult[c] * c;
  expectedRowContribution *= muV;

  // ── Per-row payout variance:
  //   E[(M·S)² | C=c] = m_c² · E[S² | C=c] = m_c² · (c·σ²_V + c²·μ_V²)
  //   E[(M·S)²] = Σ_c P(C=c) · m_c² · (c·σ²_V + c²·μ_V²)
  //   Var[M·S] = E[(M·S)²] − (E[M·S])²
  let secondMomentRowContrib = 0;
  for (let c = 0; c <= N; c++) {
    secondMomentRowContrib += pmfC[c] * mult[c] * mult[c] * (c * sig2V + c * c * muV * muV);
  }
  const varianceRowContribution = Math.max(
    0,
    secondMomentRowContrib - expectedRowContribution * expectedRowContribution,
  );

  // ── Total payout (M iid rows)
  const expectedTotalPayoutPerSpin = M * expectedRowContribution;
  const varianceTotalPayoutPerSpin = M * varianceRowContribution;
  const stdDevTotalPayoutPerSpin = Math.sqrt(varianceTotalPayoutPerSpin);

  // ── Row-full disclosure: P(C_j = N) = q^N
  const probRowFull = pmfC[N];
  const probAtLeastOneRowFull =
    probRowFull >= 1 - 1e-15 ? 1 : 1 - Math.pow(1 - probRowFull, M);
  const expectedRowsFull = M * probRowFull;
  const probAllRowsFull = Math.pow(probRowFull, M);
  const oneInNSpinsAtLeastOneRowFull =
    probAtLeastOneRowFull > 1e-15 ? 1 / probAtLeastOneRowFull : Number.POSITIVE_INFINITY;

  // ── E[max row multiplier] = E[max_{j=1..M} M_j(C_j)]
  //   M_j are iid. For each candidate multiplier value v (sorted), compute:
  //     P(max ≤ v) = (P(M_j ≤ v))^M
  //   Then E[max] = Σ v · (P(max ≤ v) − P(max ≤ prev_v))
  // Sort unique multiplier values with their probabilities.
  const valueProbMap: Map<number, number> = new Map();
  for (let c = 0; c <= N; c++) {
    const v = mult[c];
    valueProbMap.set(v, (valueProbMap.get(v) ?? 0) + pmfC[c]);
  }
  const sortedValues = Array.from(valueProbMap.keys()).sort((a, b) => a - b);
  let expectedHighestRowMultiplier = 0;
  let cumulative = 0;
  let prevCdf = 0;
  for (const v of sortedValues) {
    cumulative += valueProbMap.get(v) ?? 0;
    const cdfMax = Math.pow(cumulative, M);
    const massAtV = cdfMax - prevCdf;
    expectedHighestRowMultiplier += v * massAtV;
    prevCdf = cdfMax;
  }

  // ── Commercial uplift vs flat (m_c = 1 svuda) baseline
  // Flat baseline: E[Y_flat] = M · μ_V · Σ_c pmfC[c]·c = M · μ_V · E[C_j] = M·μ_V·N·q
  const flatBaseline = M * muV * N * q;
  const commercialUpliftVsFlatMultiplier =
    flatBaseline > 1e-12 ? expectedTotalPayoutPerSpin / flatBaseline : 1;

  return {
    expectedReelBag,
    varianceReelBag,
    expectedRowCoinCount,
    expectedRowMultiplier,
    rowCoinCountPmf: pmfC,
    expectedRowContribution,
    varianceRowContribution,
    expectedTotalPayoutPerSpin,
    varianceTotalPayoutPerSpin,
    stdDevTotalPayoutPerSpin,
    probAtLeastOneRowFull,
    expectedRowsFull,
    probAllRowsFull,
    oneInNSpinsAtLeastOneRowFull,
    expectedHighestRowMultiplier,
    commercialUpliftVsFlatMultiplier,
  };
}

/** Alias for portfolio runner naming convention. */
export const solvePerReelBagRowMultiplierCoupled = analyzePerReelBagRowMultiplierCoupled;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulatePerReelBagRowMultiplierCoupled(
  cfg: PerReelBagRowMultiplierConfig,
  numSpins: number,
  seed = 0xface0185,
): {
  meanTotalPayoutPerSpin: number;
  stdDevTotalPayoutPerSpin: number;
  meanReelBag: number;
  meanRowMultiplier: number;
  meanHighestRowMultiplier: number;
  observedProbAtLeastOneRowFull: number;
  observedProbAllRowsFull: number;
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
  const sigmaV = Math.sqrt(cfg.varianceCoinValue);
  const sampleV = (): number => {
    if (sigmaV <= 0) return cfg.expectedCoinValue;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, cfg.expectedCoinValue + sigmaV * z);
  };

  const N = cfg.numReels;
  const M = cfg.numRows;
  const q = cfg.probCoinLandPerCell;
  const mult = cfg.multiplierByRowCoinCount;

  let sumPayout = 0;
  let sumPayout2 = 0;
  let sumReelBag = 0;
  let sumRowMult = 0;
  let sumHighestRowMult = 0;
  let countAtLeastOneFull = 0;
  let countAllFull = 0;

  for (let spin = 0; spin < numSpins; spin++) {
    // Row sums S_j i row counts C_j
    const rowSum = new Array(M).fill(0);
    const rowCount = new Array(M).fill(0);
    const reelBag = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        if (rng() < q) {
          const v = sampleV();
          rowSum[j] += v;
          rowCount[j]++;
          reelBag[i] += v;
        }
      }
    }
    let payout = 0;
    let highestMult = 0;
    let rowsFull = 0;
    for (let j = 0; j < M; j++) {
      const m_j = mult[rowCount[j]];
      payout += m_j * rowSum[j];
      sumRowMult += m_j;
      if (m_j > highestMult) highestMult = m_j;
      if (rowCount[j] === N) rowsFull++;
    }
    sumPayout += payout;
    sumPayout2 += payout * payout;
    for (let i = 0; i < N; i++) sumReelBag += reelBag[i];
    sumHighestRowMult += highestMult;
    if (rowsFull >= 1) countAtLeastOneFull++;
    if (rowsFull === M) countAllFull++;
  }

  const meanPayout = sumPayout / numSpins;
  const varPayout = Math.max(0, sumPayout2 / numSpins - meanPayout * meanPayout);

  return {
    meanTotalPayoutPerSpin: meanPayout,
    stdDevTotalPayoutPerSpin: Math.sqrt(varPayout),
    meanReelBag: sumReelBag / (numSpins * N),
    meanRowMultiplier: sumRowMult / (numSpins * M),
    meanHighestRowMultiplier: sumHighestRowMult / numSpins,
    observedProbAtLeastOneRowFull: countAtLeastOneFull / numSpins,
    observedProbAllRowsFull: countAllFull / numSpins,
  };
}
