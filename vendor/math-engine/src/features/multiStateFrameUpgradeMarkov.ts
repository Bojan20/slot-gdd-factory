/**
 * W152 Wave 183 — Multi-State Frame Upgrade Markov Aggregator (64. solver).
 *
 * **L&W M2 P0 GAP CLOSURE** — covers 8+ L&W titles iz Huff N' Puff family.
 *
 * Iconic frame-upgrade Markov mehanika:
 *   * SG/LNW Huff N' Puff (original, 2019 — Straw → Wood → Brick upgrade)
 *   * Huff N' More Puff (2020 — 5-tier wheel + extended frame states)
 *   * Huff N' Even More Puff (2022 — frame upgrade + Mega Hat add-on)
 *   * Huff N' Lots of Puff (2023 — Lots-of-Puff multi-wheel pick tree)
 *   * Huff N' Xtra Puff (2024 — Xtra Puff persistent meter)
 *   * Hard Hat Edition (2024 — Even More Puff variant)
 *   * Grand (2024 — escalated grand jackpot)
 *   * Money Mansion (2024 — Even More Puff + Mansion bonus stage)
 *
 * **64th closed-form solver.** First kernel modeling **N×M independent
 * per-cell K-state Markov chain on grid sa Kronecker-product aggregation**
 * — each cell independently transitions Idle → Straw → Wood → Brick → House
 * (or vendor-specific state ladder), payouts gated by current state, grid-wide
 * RTP = N·M · E[per-cell payout].
 *
 * Distinct od **P-058 (W132) Multi-Level Wild Tier Markov** (SINGLE wild's
 * 4-state chain, not N×M grid replication).
 *
 * ── Math (Independent Per-Cell K-State Markov on Grid) ─────────────────────
 *
 * Each cell c ∈ {1..N·M} has independent K-state Markov chain:
 *   - States: 0 = Idle, 1 = Straw, 2 = Wood, 3 = Brick, 4 = House (vendor-specific K)
 *   - Transition matrix P[K×K]: P[i][j] = P(state_i → state_j per spin)
 *   - Initial state distribution π_0 (typically [1, 0, 0, ..., 0] = all cells Idle)
 *   - Per-state payout multiplier m_k (in × bet units)
 *
 * **Per-cell state distribution after t spins**:
 *   π_t = π_0 · P^t   (vector-matrix product, K-dim)
 *
 * **Per-cell E[payout per spin at time t]**:
 *   E[Y_c(t)] = Σ_{k=0..K-1} π_t(k) · m_k
 *
 * **Stationary distribution** (long-run, if P is ergodic):
 *   π_∞ = left eigenvector of P sa eigenvalue 1, normalized to sum=1
 *
 * **Grid-aggregate over T spinova** (E[total payout from feature]):
 *   E[S_T] = N·M · Σ_{t=0..T-1} E[Y_c(t)]
 *
 * **Variance** under per-cell independence:
 *   Var[S_T] = N·M · Var_{single cell over T spinova}
 *
 * **P(at least one cell reaches max state ≥ k_target after T spinova)**:
 *   = 1 − (1 − P(cell ≥ k_target @ T))^(N·M)
 *
 * **Mean-reaching-time-to-state-k** (per-cell expected first-hit):
 *   E[τ_k] = expected time until state ≥ k from Idle (first-passage time
 *            via fundamental matrix N = (I − Q)^(-1) of absorbing chain)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-058 (W132) Multi-Level Wild Tier Markov** — SINGLE wild 4-state chain,
 *     ne N×M independent grid
 *   - **P-067 (W150) Voltage Meter Multi-Tier** — geometric tail K-threshold,
 *     ne Markov chain advancement
 *   - **P-082 (W181) Reel-Bound Mystery Progressive** — per-reel Bernoulli scatter,
 *     ne per-cell state chain
 *   - **P-083 (W182) Dynamic Grid-Expansion H&S** — grid evolves, ne per-cell state
 *
 * Compliance:
 *   - UKGC RTS 14 (frame-state feature mechanic disclosure)
 *   - MGA PPD §11 (per-cell evolution transparency)
 *   - eCOGRA Generic Slots Audit (Markov-chain audit trail per cell)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "frame upgrade", "per-cell Markov", "state ladder" = generic
 * slot-design terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface MultiStateFrameUpgradeConfig {
  /** Number of reels N ≥ 1 (grid width). */
  numReels: number;
  /** Number of rows M ≥ 1 (grid height). */
  numRows: number;
  /** Number of states K ≥ 2 (e.g. 5 za Idle/Straw/Wood/Brick/House). */
  numStates: number;
  /**
   * Transition matrix P[K][K] sa P[i][j] = P(state_i → state_j per spin).
   * Each row must sum to 1 (within 1e-9 tolerance).
   */
  transitionMatrix: number[][];
  /**
   * Initial state distribution π_0[K] sa sum = 1.
   * Typically [1, 0, 0, ...] = all cells start at state 0 (Idle).
   */
  initialDistribution: number[];
  /** Payout multiplier per state m_k in × bet units, length K. */
  payoutMultiplierPerState: number[];
  /** Number of spins T per feature ≥ 1. */
  numSpins: number;
  /** Target state k for "at least one cell reaches k_target" disclosure (0..K-1). */
  targetStateForReachabilityDisclosure: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface MultiStateFrameUpgradeResult {
  /** Per-cell state distribution after T spinova π_T[K]. */
  finalStateDistributionPerCell: number[];
  /** Stationary distribution π_∞[K] (power-iteration). */
  stationaryDistribution: number[];
  /** E[payout per cell per spin] time-averaged over T spinova. */
  expectedPayoutPerCellPerSpin: number;
  /** E[total payout from feature] = N·M · Σ_t E[Y_c(t)]. */
  expectedTotalPayoutPerFeature: number;
  /** Var[total payout] under per-cell independence (lower bound). */
  varianceTotalPayoutPerFeature: number;
  /** StdDev[total payout]. */
  stdDevTotalPayoutPerFeature: number;
  /** P(per-cell state ≥ k_target after T spinova). */
  perCellProbReachTargetStateAtT: number;
  /** P(at least one cell reaches k_target across grid). */
  probAtLeastOneCellReachesTargetAtT: number;
  /** 1 / per-cell prob reach target. */
  oneInNCellsReachesTarget: number;
  /** E[# cells at state ≥ k_target at time T]. */
  expectedCellsAtOrAboveTargetAtT: number;
  /** Commercial uplift ratio vs all-Idle baseline = E[payout] / (N·M·T·m_0). */
  commercialUpliftVsIdleBaseline: number;
  /** Effective per-spin grid RTP (in × bet, time-averaged). */
  effectiveGridRtpPerSpin: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: MultiStateFrameUpgradeConfig): void {
  if (!Number.isInteger(cfg.numReels) || cfg.numReels < 1) {
    throw new Error(`numReels must be integer ≥ 1, got ${cfg.numReels}`);
  }
  if (!Number.isInteger(cfg.numRows) || cfg.numRows < 1) {
    throw new Error(`numRows must be integer ≥ 1, got ${cfg.numRows}`);
  }
  if (!Number.isInteger(cfg.numStates) || cfg.numStates < 2) {
    throw new Error(`numStates must be integer ≥ 2, got ${cfg.numStates}`);
  }
  if (!Array.isArray(cfg.transitionMatrix) || cfg.transitionMatrix.length !== cfg.numStates) {
    throw new Error(
      `transitionMatrix must be ${cfg.numStates}×${cfg.numStates}, got ${cfg.transitionMatrix?.length}× rows`,
    );
  }
  for (let i = 0; i < cfg.numStates; i++) {
    const row = cfg.transitionMatrix[i];
    if (!Array.isArray(row) || row.length !== cfg.numStates) {
      throw new Error(
        `transitionMatrix[${i}] must have length ${cfg.numStates}, got ${row?.length}`,
      );
    }
    let s = 0;
    for (let j = 0; j < cfg.numStates; j++) {
      const p = row[j];
      if (!Number.isFinite(p) || p < 0 || p > 1) {
        throw new Error(`transitionMatrix[${i}][${j}] must be ∈ [0, 1], got ${p}`);
      }
      s += p;
    }
    if (Math.abs(s - 1) > 1e-9) {
      throw new Error(`transitionMatrix row ${i} must sum to 1 (within 1e-9), got ${s}`);
    }
  }
  if (
    !Array.isArray(cfg.initialDistribution) ||
    cfg.initialDistribution.length !== cfg.numStates
  ) {
    throw new Error(
      `initialDistribution must have length ${cfg.numStates}, got ${cfg.initialDistribution?.length}`,
    );
  }
  let initSum = 0;
  for (let k = 0; k < cfg.numStates; k++) {
    const p = cfg.initialDistribution[k];
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`initialDistribution[${k}] must be ∈ [0, 1], got ${p}`);
    }
    initSum += p;
  }
  if (Math.abs(initSum - 1) > 1e-9) {
    throw new Error(`initialDistribution must sum to 1 (within 1e-9), got ${initSum}`);
  }
  if (
    !Array.isArray(cfg.payoutMultiplierPerState) ||
    cfg.payoutMultiplierPerState.length !== cfg.numStates
  ) {
    throw new Error(
      `payoutMultiplierPerState must have length ${cfg.numStates}, got ${cfg.payoutMultiplierPerState?.length}`,
    );
  }
  for (let k = 0; k < cfg.numStates; k++) {
    if (!Number.isFinite(cfg.payoutMultiplierPerState[k]) || cfg.payoutMultiplierPerState[k] < 0) {
      throw new Error(
        `payoutMultiplierPerState[${k}] must be ≥ 0, got ${cfg.payoutMultiplierPerState[k]}`,
      );
    }
  }
  if (!Number.isInteger(cfg.numSpins) || cfg.numSpins < 1) {
    throw new Error(`numSpins must be integer ≥ 1, got ${cfg.numSpins}`);
  }
  if (
    !Number.isInteger(cfg.targetStateForReachabilityDisclosure) ||
    cfg.targetStateForReachabilityDisclosure < 0 ||
    cfg.targetStateForReachabilityDisclosure >= cfg.numStates
  ) {
    throw new Error(
      `targetStateForReachabilityDisclosure must be integer ∈ [0, ${cfg.numStates - 1}], got ${cfg.targetStateForReachabilityDisclosure}`,
    );
  }
}

/** ── Linear algebra helpers ───────────────────────────────────────────────── */

/** π · P (row vector × matrix), in-place result. */
function vecMatMul(pi: number[], P: number[][]): number[] {
  const K = pi.length;
  const out = new Array(K).fill(0);
  for (let j = 0; j < K; j++) {
    let s = 0;
    for (let i = 0; i < K; i++) s += pi[i] * P[i][j];
    out[j] = s;
  }
  return out;
}

/** Power-iteration stationary distribution (left eigenvector of P, eigenvalue 1). */
function stationaryDistribution(P: number[][], maxIter = 1000, tol = 1e-12): number[] {
  const K = P.length;
  let pi = new Array(K).fill(1 / K);
  for (let it = 0; it < maxIter; it++) {
    const next = vecMatMul(pi, P);
    let diff = 0;
    for (let k = 0; k < K; k++) diff += Math.abs(next[k] - pi[k]);
    pi = next;
    if (diff < tol) break;
  }
  // Renormalize defensively
  let sum = 0;
  for (let k = 0; k < K; k++) sum += pi[k];
  if (sum > 0) for (let k = 0; k < K; k++) pi[k] /= sum;
  return pi;
}

/** Vector dot product. */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeMultiStateFrameUpgrade(
  cfg: MultiStateFrameUpgradeConfig,
): MultiStateFrameUpgradeResult {
  validate(cfg);

  const N = cfg.numReels;
  const M = cfg.numRows;
  const K = cfg.numStates;
  const T = cfg.numSpins;
  const P = cfg.transitionMatrix;
  const piInit = cfg.initialDistribution;
  const m = cfg.payoutMultiplierPerState;
  const kTarget = cfg.targetStateForReachabilityDisclosure;
  const cells = N * M;

  // ── 1. Per-cell trajectory π(0), π(1), ..., π(T)
  const trajectory: number[][] = new Array(T + 1);
  trajectory[0] = piInit.slice();
  for (let t = 1; t <= T; t++) {
    trajectory[t] = vecMatMul(trajectory[t - 1], P);
  }

  // ── 2. Stationary distribution (power iteration)
  const stationary = stationaryDistribution(P);

  // ── 3. Time-averaged per-cell E[payout per spin]
  //    E[Y_c per spin avg] = (1/T) Σ_{t=0..T-1} dot(π_t, m)
  let sumPayoutPerCell = 0;
  let sumPayoutSq = 0;
  for (let t = 0; t < T; t++) {
    const ePerSpin = dot(trajectory[t], m);
    sumPayoutPerCell += ePerSpin;
    // E[Y² | state k] is m_k² (deterministic per state). E[Y²] = Σ π_t(k) · m_k².
    let eSq = 0;
    for (let k = 0; k < K; k++) eSq += trajectory[t][k] * m[k] * m[k];
    sumPayoutSq += eSq;
  }
  const expectedPayoutPerCellPerSpin = sumPayoutPerCell / T;
  const expectedTotalPayoutPerFeature = cells * sumPayoutPerCell;

  // Variance: per-cell, sum of Var[Y_c(t)] over t (assumes spins independent
  // conditional on state — Markov chain provides the dependence structure).
  // Approximation: under per-cell independence, Var[grid] = N·M · per-cell Var.
  // Per-cell Var (T-sum aggregated): Var_per_cell ≈ Σ_t (E[Y²(t)] − E[Y(t)]²)
  let perCellVar = 0;
  for (let t = 0; t < T; t++) {
    const eY = dot(trajectory[t], m);
    let eY2 = 0;
    for (let k = 0; k < K; k++) eY2 += trajectory[t][k] * m[k] * m[k];
    perCellVar += Math.max(0, eY2 - eY * eY);
  }
  const varianceTotalPayoutPerFeature = cells * perCellVar;
  const stdDevTotalPayoutPerFeature = Math.sqrt(varianceTotalPayoutPerFeature);

  // ── 4. P(per-cell state ≥ kTarget at time T)
  let perCellProbReach = 0;
  for (let k = kTarget; k < K; k++) perCellProbReach += trajectory[T][k];

  // ── 5. P(at least one cell reaches kTarget) = 1 − (1 − P)^(N·M)
  // Use log for numerical stability.
  let probAtLeastOne = 0;
  if (perCellProbReach >= 1 - 1e-15) probAtLeastOne = 1;
  else if (perCellProbReach <= 1e-15) probAtLeastOne = 0;
  else probAtLeastOne = 1 - Math.pow(1 - perCellProbReach, cells);

  // ── 6. E[# cells at state ≥ kTarget at T] = cells · perCellProb
  const expectedCellsAtOrAboveTarget = cells * perCellProbReach;

  // ── 7. Commercial uplift vs all-Idle baseline (m_0 only)
  const baseline = cells * T * m[0];
  const commercialUplift =
    baseline > 1e-9 ? expectedTotalPayoutPerFeature / baseline : Number.POSITIVE_INFINITY;

  const effectiveGridRtpPerSpin = expectedPayoutPerCellPerSpin * cells;

  return {
    finalStateDistributionPerCell: trajectory[T],
    stationaryDistribution: stationary,
    expectedPayoutPerCellPerSpin,
    expectedTotalPayoutPerFeature,
    varianceTotalPayoutPerFeature,
    stdDevTotalPayoutPerFeature,
    perCellProbReachTargetStateAtT: perCellProbReach,
    probAtLeastOneCellReachesTargetAtT: probAtLeastOne,
    oneInNCellsReachesTarget:
      perCellProbReach > 1e-15 ? 1 / perCellProbReach : Number.POSITIVE_INFINITY,
    expectedCellsAtOrAboveTargetAtT: expectedCellsAtOrAboveTarget,
    commercialUpliftVsIdleBaseline: commercialUplift,
    effectiveGridRtpPerSpin,
  };
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solveMultiStateFrameUpgrade = analyzeMultiStateFrameUpgrade;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateMultiStateFrameUpgrade(
  cfg: MultiStateFrameUpgradeConfig,
  numFeatures: number,
  seed = 0xface0183,
): {
  meanTotalPayoutPerFeature: number;
  stdDevTotalPayoutPerFeature: number;
  meanFinalStateDistributionPerCell: number[];
  meanCellsAtOrAboveTarget: number;
  probAtLeastOneCellReachesTarget: number;
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

  const N = cfg.numReels;
  const M = cfg.numRows;
  const K = cfg.numStates;
  const T = cfg.numSpins;
  const P = cfg.transitionMatrix;
  const piInit = cfg.initialDistribution;
  const m = cfg.payoutMultiplierPerState;
  const kTarget = cfg.targetStateForReachabilityDisclosure;
  const cells = N * M;

  // Precompute cumulative transition probabilities for fast sampling.
  const cumP: number[][] = P.map((row) => {
    const c = new Array(K);
    let acc = 0;
    for (let j = 0; j < K; j++) {
      acc += row[j];
      c[j] = acc;
    }
    return c;
  });
  const cumInit: number[] = new Array(K);
  {
    let acc = 0;
    for (let k = 0; k < K; k++) {
      acc += piInit[k];
      cumInit[k] = acc;
    }
  }
  const sampleFromCum = (cum: number[]): number => {
    const u = rng();
    for (let k = 0; k < K; k++) if (u <= cum[k]) return k;
    return K - 1;
  };

  let sumPayout = 0;
  let sumPayoutSq = 0;
  const finalStateCounts = new Array(K).fill(0);
  let sumCellsAtTarget = 0;
  let countAtLeastOneReaches = 0;

  for (let f = 0; f < numFeatures; f++) {
    // Initialize all cells to a draw from initial distribution
    const cellStates = new Array(cells);
    for (let c = 0; c < cells; c++) cellStates[c] = sampleFromCum(cumInit);

    // Simulate T spinova
    let featurePayout = 0;
    for (let t = 0; t < T; t++) {
      // Accumulate payout for this spin (before transition)
      for (let c = 0; c < cells; c++) {
        featurePayout += m[cellStates[c]];
      }
      // Apply per-cell transition
      for (let c = 0; c < cells; c++) {
        cellStates[c] = sampleFromCum(cumP[cellStates[c]]);
      }
    }

    sumPayout += featurePayout;
    sumPayoutSq += featurePayout * featurePayout;
    let cellsAtTarget = 0;
    for (let c = 0; c < cells; c++) {
      finalStateCounts[cellStates[c]]++;
      if (cellStates[c] >= kTarget) cellsAtTarget++;
    }
    sumCellsAtTarget += cellsAtTarget;
    if (cellsAtTarget > 0) countAtLeastOneReaches++;
  }

  const meanPayout = sumPayout / numFeatures;
  const varPayout = Math.max(0, sumPayoutSq / numFeatures - meanPayout * meanPayout);
  const meanFinalDist = finalStateCounts.map((c) => c / (numFeatures * cells));

  return {
    meanTotalPayoutPerFeature: meanPayout,
    stdDevTotalPayoutPerFeature: Math.sqrt(varPayout),
    meanFinalStateDistributionPerCell: meanFinalDist,
    meanCellsAtOrAboveTarget: sumCellsAtTarget / numFeatures,
    probAtLeastOneCellReachesTarget: countAtLeastOneReaches / numFeatures,
  };
}
