/**
 * W152 Wave 52 — Sticky Cash + Reveal Multiplier hybrid (Faza 12 ⚠️→✅).
 *
 * Closes Faza 12 scenario "⚠️ Sticky cash + reveal multiplier" by adding a
 * clean-room closed-form solver for the hybrid mechanic where:
 *
 *   1. Each spin in an N-spin feature window, every still-empty cell
 *      independently has probability p of capturing a "cash symbol" with
 *      value drawn from a discrete distribution.
 *   2. Captured cells STAY sticky until end of window.
 *   3. At end of window, a single "reveal multiplier" M is sampled from
 *      a discrete distribution and applied to the total collected cash:
 *
 *           total payout = M × Σ_i cashValue_i
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Pattern P-002 + P-016 family in `docs/INDUSTRY_PATTERN_CATALOG`. The
 * "reveal-multiplier" finale is a high-engagement closer. Math model is
 * a hybrid of sticky-collect (per-cell independent capture with sticky
 * memory) and a single end-of-window scalar multiplier.
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Sticky cash" + "reveal multiplier" are generic descriptive terms.
 *   • No vendor-specific symbols / artwork / sequencing detail.
 *   • Verified by `check-reserved-terms.sh`.
 *
 * ── Closed-form math ──────────────────────────────────────────────────────
 * Let G = gridSize, p = pCapturePerEmptyPerSpin, N = spins in window.
 * After N spins, EACH cell independently:
 *
 *   P(cell still empty) = (1−p)^N
 *   P(cell occupied)    = 1 − (1−p)^N      [call this q]
 *
 * Cash value V drawn from CashOutcome dist. Cells are i.i.d. → per-cell
 * "captured cash" X_cell:
 *
 *   P(X_cell = 0) = 1 − q
 *   P(X_cell = v) = q × P(V = v)
 *
 *   E[X_cell]   = q × E[V]
 *   E[X_cell²]  = q × E[V²]
 *   Var[X_cell] = q × E[V²] − (q × E[V])²
 *               = q × E[V²] − q² × E[V]²
 *
 * Total cash T = Σ_{i=1..G} X_cell_i (i.i.d.):
 *
 *   E[T]   = G × q × E[V]
 *   Var[T] = G × Var[X_cell]
 *
 * Reveal mult M (independent of T):
 *
 *   E[M], Var[M] from RevealOutcome dist.
 *
 * Total payout Y = T × M:
 *
 *   E[Y]   = E[T] × E[M]
 *   Var[Y] = E[T]² × Var[M] + Var[T] × E[M]² + Var[T] × Var[M]
 *
 *          = Var[T·M] for independent T, M
 *
 * P(zero payout) = P(T=0) + P(M=0) − P(T=0)·P(M=0)
 *                = (1−q)^G + p_M0 − (1−q)^G · p_M0    [if M=0 is a value]
 *
 * Distribution of "captured cells" K = # occupied at end:
 *
 *   K ~ Binomial(G, q)
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateStickyCashReveal() MC reference. Acceptance script validates
 * 6 synthetic configs × 500K MC episodes against closed-form within
 * tolerance ±1.5% relative on E[Y].
 *
 * ── References ────────────────────────────────────────────────────────────
 * Cabot & Hannum 2002 (Practical Casino Math).
 * Norris 1997 (Markov Chains): independence + variance composition.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface CashOutcome {
  /** Cash value in X (multiplier of base bet). */
  valueX: number;
  /** Weight in discrete distribution. */
  weight: number;
}

export interface RevealOutcome {
  /** Reveal multiplier. */
  multiplier: number;
  /** Weight in discrete distribution. */
  weight: number;
}

export interface StickyCashRevealConfig {
  /** Total cells. */
  gridSize: number;
  /** Spins in feature window (N). */
  spinsInWindow: number;
  /** Per-empty-cell per-spin capture probability. */
  pCapturePerEmptyPerSpin: number;
  /** Cash value discrete distribution (drawn when a cell captures). */
  cashValueDistribution: CashOutcome[];
  /** Reveal multiplier discrete distribution (drawn once at end of window). */
  revealMultiplierDistribution: RevealOutcome[];
}

export interface StickyCashRevealResult {
  /** P(any individual cell occupied at end of window) = 1 − (1−p)^N. */
  pCellOccupied: number;
  /** E[# occupied cells] = G × q. */
  expectedOccupiedCells: number;
  /** E[V]. */
  expectedCashPerOccupiedCell: number;
  /** E[V²]. */
  expectedCashSquaredPerOccupiedCell: number;
  /** E[reveal multiplier M]. */
  expectedRevealMultiplier: number;
  /** Var[M]. */
  varianceRevealMultiplier: number;
  /** E[total cash T] before reveal. */
  expectedTotalCash: number;
  /** Var[T]. */
  varianceTotalCash: number;
  /** E[Y] = E[T] × E[M] — main RTP contribution per episode. */
  expectedPayoutPerEpisode: number;
  /** Var[Y]. */
  variancePayoutPerEpisode: number;
  /** σ[Y] = sqrt(Var[Y]). */
  stdDevPayoutPerEpisode: number;
  /** P(Y = 0). */
  probZeroPayout: number;
  /** PMF over K = # occupied cells, K ~ Binomial(G, q). */
  occupiedCellsPmf: Array<{ k: number; probability: number }>;
}

export interface StickyCashRevealMCResult {
  observedEpisodes: number;
  observedMeanPayout: number;
  observedVariancePayout: number;
  observedStdDevPayout: number;
  observedMeanOccupiedCells: number;
  observedZeroPayoutFraction: number;
  observedMeanRevealMult: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: StickyCashRevealConfig): void {
  if (!Number.isInteger(cfg.gridSize) || cfg.gridSize <= 0) {
    throw new Error(`gridSize must be positive integer, got ${cfg.gridSize}`);
  }
  if (!Number.isInteger(cfg.spinsInWindow) || cfg.spinsInWindow <= 0) {
    throw new Error(`spinsInWindow must be positive integer, got ${cfg.spinsInWindow}`);
  }
  if (cfg.pCapturePerEmptyPerSpin <= 0 || cfg.pCapturePerEmptyPerSpin >= 1) {
    throw new Error(`pCapturePerEmptyPerSpin must be in (0,1), got ${cfg.pCapturePerEmptyPerSpin}`);
  }
  if (!Array.isArray(cfg.cashValueDistribution) || cfg.cashValueDistribution.length === 0) {
    throw new Error(`cashValueDistribution must be non-empty array`);
  }
  for (const o of cfg.cashValueDistribution) {
    if (!Number.isFinite(o.valueX) || o.valueX < 0) {
      throw new Error(`cashValueDistribution: valueX must be non-negative finite`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`cashValueDistribution: weight must be positive finite`);
    }
  }
  if (!Array.isArray(cfg.revealMultiplierDistribution) || cfg.revealMultiplierDistribution.length === 0) {
    throw new Error(`revealMultiplierDistribution must be non-empty array`);
  }
  for (const o of cfg.revealMultiplierDistribution) {
    if (!Number.isFinite(o.multiplier) || o.multiplier < 0) {
      throw new Error(`revealMultiplierDistribution: multiplier must be non-negative finite`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`revealMultiplierDistribution: weight must be positive finite`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function meanCash(dist: CashOutcome[]): number {
  let totalW = 0;
  let totalV = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalV += o.weight * o.valueX;
  }
  return totalV / totalW;
}

export function meanCashSquared(dist: CashOutcome[]): number {
  let totalW = 0;
  let totalSq = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalSq += o.weight * o.valueX * o.valueX;
  }
  return totalSq / totalW;
}

export function meanReveal(dist: RevealOutcome[]): number {
  let totalW = 0;
  let totalM = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalM += o.weight * o.multiplier;
  }
  return totalM / totalW;
}

export function varianceReveal(dist: RevealOutcome[]): number {
  const mean = meanReveal(dist);
  let totalW = 0;
  let totalSq = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalSq += o.weight * (o.multiplier - mean) ** 2;
  }
  return totalSq / totalW;
}

function probMultIsZero(dist: RevealOutcome[]): number {
  let totalW = 0;
  let zeroW = 0;
  for (const o of dist) {
    totalW += o.weight;
    if (o.multiplier === 0) zeroW += o.weight;
  }
  return zeroW / totalW;
}

function logBinomial(n: number, k: number): number {
  let lg = 0;
  for (let i = 0; i < k; i++) lg += Math.log(n - i) - Math.log(i + 1);
  return lg;
}

function binomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logBinomial(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

// ── Closed-form solver ─────────────────────────────────────────────────────

export function solveStickyCashReveal(config: StickyCashRevealConfig): StickyCashRevealResult {
  validate(config);

  const G = config.gridSize;
  const N = config.spinsInWindow;
  const p = config.pCapturePerEmptyPerSpin;
  const q = 1 - Math.pow(1 - p, N); // P(cell occupied at end)
  const eV = meanCash(config.cashValueDistribution);
  const eV2 = meanCashSquared(config.cashValueDistribution);
  const eM = meanReveal(config.revealMultiplierDistribution);
  const varM = varianceReveal(config.revealMultiplierDistribution);
  const pM0 = probMultIsZero(config.revealMultiplierDistribution);

  // Per-cell statistics
  const eXcell = q * eV;
  // E[X_cell²] = q × E[V²] (since with prob q the cell is occupied with value V, else 0)
  const eXcell2 = q * eV2;
  const varXcell = eXcell2 - eXcell * eXcell;

  // Total cash T = sum of G i.i.d. X_cell
  const eT = G * eXcell;
  const varT = G * varXcell;

  // Y = T × M (T ⊥ M)
  const eY = eT * eM;
  const varY = eT * eT * varM + varT * eM * eM + varT * varM;

  // P(Y = 0) = P(T = 0 OR M = 0) = P(T=0) + P(M=0)(1 - P(T=0))
  //         = (1 - q)^G + pM0 - (1 - q)^G × pM0
  const pT0 = Math.pow(1 - q, G);
  const pY0 = pT0 + pM0 - pT0 * pM0;

  // Binomial PMF over K = # occupied cells
  const occPmf: Array<{ k: number; probability: number }> = [];
  for (let k = 0; k <= G; k++) {
    const prob = binomialPmf(G, k, q);
    if (prob > 0) occPmf.push({ k, probability: prob });
  }

  return {
    pCellOccupied: q,
    expectedOccupiedCells: G * q,
    expectedCashPerOccupiedCell: eV,
    expectedCashSquaredPerOccupiedCell: eV2,
    expectedRevealMultiplier: eM,
    varianceRevealMultiplier: varM,
    expectedTotalCash: eT,
    varianceTotalCash: varT,
    expectedPayoutPerEpisode: eY,
    variancePayoutPerEpisode: varY,
    stdDevPayoutPerEpisode: Math.sqrt(varY),
    probZeroPayout: pY0,
    occupiedCellsPmf: occPmf,
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

function sampleCash(dist: CashOutcome[], rng: () => number): number {
  let total = 0;
  for (const o of dist) total += o.weight;
  let r = rng() * total;
  for (const o of dist) {
    r -= o.weight;
    if (r < 0) return o.valueX;
  }
  return dist[dist.length - 1].valueX;
}

function sampleReveal(dist: RevealOutcome[], rng: () => number): number {
  let total = 0;
  for (const o of dist) total += o.weight;
  let r = rng() * total;
  for (const o of dist) {
    r -= o.weight;
    if (r < 0) return o.multiplier;
  }
  return dist[dist.length - 1].multiplier;
}

/** Monte Carlo verification solver (deterministic mulberry32). */
export function simulateStickyCashReveal(
  config: StickyCashRevealConfig,
  episodes: number,
  seed: number,
): StickyCashRevealMCResult {
  validate(config);
  const rng = makePrng(seed);
  let sumPayout = 0;
  let sumPayoutSq = 0;
  let sumOccupied = 0;
  let zeroCount = 0;
  let sumReveal = 0;
  for (let e = 0; e < episodes; e++) {
    const occupiedCells = new Array<number>(config.gridSize).fill(0);
    const occupiedFlag = new Array<boolean>(config.gridSize).fill(false);
    for (let n = 0; n < config.spinsInWindow; n++) {
      for (let i = 0; i < config.gridSize; i++) {
        if (!occupiedFlag[i] && rng() < config.pCapturePerEmptyPerSpin) {
          occupiedFlag[i] = true;
          occupiedCells[i] = sampleCash(config.cashValueDistribution, rng);
        }
      }
    }
    let T = 0;
    let occ = 0;
    for (let i = 0; i < config.gridSize; i++) {
      T += occupiedCells[i];
      if (occupiedFlag[i]) occ++;
    }
    const M = sampleReveal(config.revealMultiplierDistribution, rng);
    const Y = T * M;
    sumPayout += Y;
    sumPayoutSq += Y * Y;
    sumOccupied += occ;
    sumReveal += M;
    if (Y === 0) zeroCount++;
  }
  const mean = sumPayout / episodes;
  const variance = sumPayoutSq / episodes - mean * mean;
  return {
    observedEpisodes: episodes,
    observedMeanPayout: mean,
    observedVariancePayout: variance,
    observedStdDevPayout: Math.sqrt(Math.max(0, variance)),
    observedMeanOccupiedCells: sumOccupied / episodes,
    observedZeroPayoutFraction: zeroCount / episodes,
    observedMeanRevealMult: sumReveal / episodes,
  };
}
