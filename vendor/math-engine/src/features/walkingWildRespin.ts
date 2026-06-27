/**
 * W152 Wave 53 — Walking-Wild Respin variant (Faza 12 ⚠️→✅).
 *
 * Closes Faza 12 scenario "⚠️ Walking-wild respin variant" by adding a
 * clean-room closed-form solver for the mechanic where a wild symbol lands
 * on the grid, walks one column per respin (with configurable step PMF),
 * and the feature ends when the wild leaves the grid. Per-respin payout
 * is drawn from a configurable reward distribution.
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Pattern P-007 family from `docs/INDUSTRY_PATTERN_CATALOG`. Some games
 * use a strict step (always left OR always right). Others randomize the
 * direction per respin. We support the general case: per-step PMF over
 * {LEFT, STAY, RIGHT} (extensible to UP/DOWN if needed for 2D walks).
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Walking-wild" + "respin" are generic descriptive terms.
 *   • No vendor-specific symbols / artwork / sequencing detail.
 *   • Verified by `check-reserved-terms.sh`.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Wild position c ∈ {0, 1, …, G−1}, absorbing state OUT (off-grid).
 * Per-respin step PMF: {pLeft, pStay, pRight}, summing to 1.
 * Transition:
 *   • LEFT  (prob pLeft):  c → c−1   (c=0 → OUT)
 *   • STAY  (prob pStay):  c → c
 *   • RIGHT (prob pRight): c → c+1   (c=G−1 → OUT)
 *
 * Initial position drawn from `startColumnPmf` (G-vector summing to 1).
 *
 * Walk is a finite-state absorbing Markov chain with G transient states
 * + 1 absorbing OUT. Standard absorbing-chain math:
 *
 *   Q = G×G transient sub-matrix
 *   N = (I − Q)^{-1} = fundamental matrix
 *   E[K | start at c] = (N · 1)_c     (expected respins before absorption)
 *   E[K] = π_start · (N · 1)
 *   Var[K | start at c] = (2N − I)·E[K|·] − E[K|·]²  (standard formula)
 *
 * Per-respin reward V ∼ rewardDistribution (i.i.d. across respins).
 * Total payout Y = Σ_{i=1..K} V_i.
 *
 *   E[Y]  = E[K] · E[V]   (Wald's identity)
 *   Var[Y] = E[K]·Var[V] + Var[K]·E[V]²   (compound-sum variance)
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateWalkingWildRespin() MC reference. Acceptance script validates
 * 6 synthetic configs against closed-form within ±2% relative on E[Y].
 *
 * ── References ────────────────────────────────────────────────────────────
 * Norris 1997 (Markov Chains): absorbing chains, fundamental matrix.
 * Grinstead & Snell: hitting time variance via fundamental matrix.
 * Ross 1996: compound sums and Wald's identity.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface StepPmf {
  /** Probability of LEFT step. */
  left: number;
  /** Probability of STAY (no movement). */
  stay: number;
  /** Probability of RIGHT step. */
  right: number;
}

export interface RewardOutcome {
  /** Per-respin reward in X (multiplier of base bet). */
  rewardX: number;
  /** Weight in discrete distribution. */
  weight: number;
}

export interface WalkingWildRespinConfig {
  /** Number of columns on the grid (G ≥ 2). */
  gridCols: number;
  /** P(start at col c), length = gridCols, must sum to 1. */
  startColumnPmf: number[];
  /** Per-respin step probabilities. */
  stepPmf: StepPmf;
  /** Reward distribution per respin (i.i.d.). */
  rewardDistribution: RewardOutcome[];
}

export interface WalkingWildResult {
  /** E[K] = expected number of respins (absorption time). */
  expectedRespins: number;
  /** Var[K]. */
  varianceRespins: number;
  /** E[K | start at col c]. */
  expectedRespinsByStart: Array<{ startCol: number; expectedRespins: number }>;
  /** PMF over respin count K up to some practical cap (truncated < 1e-12). */
  respinCountPmf: Array<{ k: number; probability: number }>;
  /** E[V]. */
  expectedRewardPerRespin: number;
  /** Var[V]. */
  varianceRewardPerRespin: number;
  /** E[Y] = E[K] × E[V] (Wald). */
  expectedPayoutPerEpisode: number;
  /** Var[Y] = E[K]·Var[V] + Var[K]·E[V]² (compound-sum). */
  variancePayoutPerEpisode: number;
  /** σ[Y]. */
  stdDevPayoutPerEpisode: number;
}

export interface WalkingWildMCResult {
  observedEpisodes: number;
  observedMeanRespins: number;
  observedVarianceRespins: number;
  observedMeanPayout: number;
  observedVariancePayout: number;
  observedStdDevPayout: number;
  observedMaxRespins: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: WalkingWildRespinConfig): void {
  if (!Number.isInteger(cfg.gridCols) || cfg.gridCols < 2) {
    throw new Error(`gridCols must be integer ≥ 2, got ${cfg.gridCols}`);
  }
  if (!Array.isArray(cfg.startColumnPmf) || cfg.startColumnPmf.length !== cfg.gridCols) {
    throw new Error(`startColumnPmf must be array of length gridCols=${cfg.gridCols}`);
  }
  let pSum = 0;
  for (const p of cfg.startColumnPmf) {
    if (!Number.isFinite(p) || p < 0) {
      throw new Error(`startColumnPmf entries must be non-negative finite`);
    }
    pSum += p;
  }
  if (Math.abs(pSum - 1) > 1e-9) {
    throw new Error(`startColumnPmf must sum to 1, got ${pSum}`);
  }
  const { left, stay, right } = cfg.stepPmf;
  for (const [name, val] of Object.entries({ left, stay, right })) {
    if (!Number.isFinite(val) || val < 0) {
      throw new Error(`stepPmf.${name} must be non-negative finite`);
    }
  }
  const stepSum = left + stay + right;
  if (Math.abs(stepSum - 1) > 1e-9) {
    throw new Error(`stepPmf must sum to 1, got ${stepSum}`);
  }
  if (stay === 1) {
    throw new Error(`stepPmf.stay = 1 ⇒ non-absorbing chain (walk never exits grid)`);
  }
  if (!Array.isArray(cfg.rewardDistribution) || cfg.rewardDistribution.length === 0) {
    throw new Error(`rewardDistribution must be non-empty array`);
  }
  for (const o of cfg.rewardDistribution) {
    if (!Number.isFinite(o.rewardX) || o.rewardX < 0) {
      throw new Error(`rewardDistribution: rewardX must be non-negative finite`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`rewardDistribution: weight must be positive finite`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function meanReward(dist: RewardOutcome[]): number {
  let totalW = 0;
  let totalV = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalV += o.weight * o.rewardX;
  }
  return totalV / totalW;
}

export function varianceReward(dist: RewardOutcome[]): number {
  const mean = meanReward(dist);
  let totalW = 0;
  let totalSq = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalSq += o.weight * (o.rewardX - mean) ** 2;
  }
  return totalSq / totalW;
}

// ── Linear algebra: solve (I − Q)·x = b ────────────────────────────────────

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-14) return null;
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Compute fundamental matrix N = (I − Q)^{-1} via column-by-column linear solves. */
function fundamentalMatrix(Q: number[][]): number[][] {
  const n = Q.length;
  const ImQ: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - Q[i][j]),
  );
  // Solve (I−Q) X = I column by column
  const N: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let col = 0; col < n; col++) {
    const e = new Array<number>(n).fill(0);
    e[col] = 1;
    const x = solveLinear(ImQ.map((row) => [...row]), e);
    if (!x) throw new Error(`fundamental matrix solve failed at col ${col}`);
    for (let r = 0; r < n; r++) N[r][col] = x[r];
  }
  return N;
}

// ── Closed-form solver ─────────────────────────────────────────────────────

export function solveWalkingWildRespin(config: WalkingWildRespinConfig): WalkingWildResult {
  validate(config);
  const G = config.gridCols;
  const { left, stay, right } = config.stepPmf;

  // Build transient transition matrix Q (G×G, OUT not included)
  const Q: number[][] = Array.from({ length: G }, () => new Array<number>(G).fill(0));
  for (let c = 0; c < G; c++) {
    // Left step
    if (c - 1 >= 0) Q[c][c - 1] = left;
    // else absorbed to OUT → not in Q
    // Stay
    Q[c][c] = stay;
    // Right
    if (c + 1 < G) Q[c][c + 1] = right;
    // else absorbed to OUT
  }

  // N = (I − Q)^{-1}
  const N = fundamentalMatrix(Q);

  // E[K | start at c] = (N · 1)_c
  const ones = new Array<number>(G).fill(1);
  const eK_by_c: number[] = new Array<number>(G).fill(0);
  for (let r = 0; r < G; r++) {
    for (let j = 0; j < G; j++) eK_by_c[r] += N[r][j] * ones[j];
  }

  // Marginalize by start PMF
  let eK = 0;
  for (let c = 0; c < G; c++) eK += config.startColumnPmf[c] * eK_by_c[c];

  // Var[K | start at c] using formula:
  //   (2N − I) E[K|·] − (E[K|·])²
  // — vector form. Var[K] then marginalized:
  //   Var[K] = E[Var[K|start]] + Var[E[K|start]]
  //          = Σ_c π_c × (Var[K|c]) + Σ_c π_c × (E[K|c] − E[K])²
  const varK_by_c = new Array<number>(G).fill(0);
  for (let r = 0; r < G; r++) {
    let v = 0;
    for (let j = 0; j < G; j++) {
      const coef = 2 * N[r][j] - (r === j ? 1 : 0);
      v += coef * eK_by_c[j];
    }
    varK_by_c[r] = v - eK_by_c[r] * eK_by_c[r];
  }
  let varK = 0;
  for (let c = 0; c < G; c++) {
    varK += config.startColumnPmf[c] * varK_by_c[c];
    varK += config.startColumnPmf[c] * (eK_by_c[c] - eK) ** 2;
  }

  // PMF of K — compute via iterative forward propagation π_n = π_{n-1} × P_with_absorbing
  // We track P(K = k) = P(at OUT at step k, given at start step 0)
  let pi = config.startColumnPmf.slice();
  const pmf: Array<{ k: number; probability: number }> = [];
  let pAbsorbed = 0;
  // Practical cap: propagate until cumulative pmf > 1 − 1e-12 OR k > 5000
  const MAX_K = Math.max(1000, 50 * G);
  for (let k = 1; k <= MAX_K; k++) {
    // New absorbed fraction this step
    let nextPi = new Array<number>(G).fill(0);
    let dAbs = 0;
    for (let c = 0; c < G; c++) {
      const pc = pi[c];
      if (pc === 0) continue;
      // LEFT
      if (c - 1 >= 0) nextPi[c - 1] += pc * left;
      else dAbs += pc * left;
      // STAY
      nextPi[c] += pc * stay;
      // RIGHT
      if (c + 1 < G) nextPi[c + 1] += pc * right;
      else dAbs += pc * right;
    }
    if (dAbs > 0) {
      pmf.push({ k, probability: dAbs });
      pAbsorbed += dAbs;
    }
    pi = nextPi;
    if (1 - pAbsorbed < 1e-12) break;
  }

  // Reward stats
  const eV = meanReward(config.rewardDistribution);
  const varV = varianceReward(config.rewardDistribution);

  // Wald & compound-sum
  const eY = eK * eV;
  const varY = eK * varV + varK * eV * eV;

  return {
    expectedRespins: eK,
    varianceRespins: varK,
    expectedRespinsByStart: eK_by_c.map((v, c) => ({ startCol: c, expectedRespins: v })),
    respinCountPmf: pmf,
    expectedRewardPerRespin: eV,
    varianceRewardPerRespin: varV,
    expectedPayoutPerEpisode: eY,
    variancePayoutPerEpisode: varY,
    stdDevPayoutPerEpisode: Math.sqrt(Math.max(0, varY)),
  };
}

// ── Monte Carlo reference solver ───────────────────────────────────────────

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

function sampleStart(pmf: number[], rng: () => number): number {
  let r = rng();
  let acc = 0;
  for (let i = 0; i < pmf.length; i++) {
    acc += pmf[i];
    if (r < acc) return i;
  }
  return pmf.length - 1;
}

function sampleStep(stepPmf: StepPmf, rng: () => number): -1 | 0 | 1 {
  const r = rng();
  if (r < stepPmf.left) return -1;
  if (r < stepPmf.left + stepPmf.stay) return 0;
  return 1;
}

function sampleReward(dist: RewardOutcome[], rng: () => number): number {
  let total = 0;
  for (const o of dist) total += o.weight;
  let r = rng() * total;
  for (const o of dist) {
    r -= o.weight;
    if (r < 0) return o.rewardX;
  }
  return dist[dist.length - 1].rewardX;
}

/** Monte Carlo verification solver (deterministic mulberry32). */
export function simulateWalkingWildRespin(
  config: WalkingWildRespinConfig,
  episodes: number,
  seed: number,
): WalkingWildMCResult {
  validate(config);
  const rng = makePrng(seed);
  let sumK = 0;
  let sumK2 = 0;
  let sumY = 0;
  let sumY2 = 0;
  let maxK = 0;
  for (let e = 0; e < episodes; e++) {
    let c = sampleStart(config.startColumnPmf, rng);
    let k = 0;
    let y = 0;
    // Walk until absorbed.
    // Every transition counts as a respin (reward awarded on every step,
    // including the final step that absorbs the wild off-grid).
    // This matches the closed-form K = absorption time of the Markov chain.
    while (true) {
      const step = sampleStep(config.stepPmf, rng);
      k++;
      y += sampleReward(config.rewardDistribution, rng);
      const newC = c + step;
      if (newC < 0 || newC >= config.gridCols) break; // absorbed after this respin
      c = newC;
    }
    sumK += k;
    sumK2 += k * k;
    sumY += y;
    sumY2 += y * y;
    if (k > maxK) maxK = k;
  }
  const meanK = sumK / episodes;
  const varK = sumK2 / episodes - meanK * meanK;
  const meanY = sumY / episodes;
  const varY = sumY2 / episodes - meanY * meanY;
  return {
    observedEpisodes: episodes,
    observedMeanRespins: meanK,
    observedVarianceRespins: varK,
    observedMeanPayout: meanY,
    observedVariancePayout: varY,
    observedStdDevPayout: Math.sqrt(Math.max(0, varY)),
    observedMaxRespins: maxK,
  };
}
