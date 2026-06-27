/**
 * W152 Wave 169 — Drop-and-Stick Wild Expansion Analyzer (56. solver).
 *
 * INDUSTRY-PATTERN closed-form solver za "wild lands → stays sticky for S
 * subsequent re-spins, accumulating across the grid" mehaniku. Iconic za
 * NetEnt Witchcraft Academy (spreading sticky wilds), Pragmatic Wild West Gold
 * (money wilds collected at FS end), Hacksaw Tombstone (skull wilds), Pragmatic
 * Gates of Olympus 1000 (multiplier wilds during FS), Push Mount Magmas (sticky
 * lava wilds), Yggdrasil Vikings Go Berzerk (rage sticky wilds).
 *
 * **56th closed-form solver** — distinct from prior wild kernels:
 *   - W053 Walking Wild Respin    (single wild walks horizontally)
 *   - W093 Multiplicative Wild Stack (wild count multiplier per spin)
 *   - W114 Sticky Wild Countdown   (single wild w/ remaining-count Markov)
 *   - W132 Multi-Level Wild Tier   (probabilistic per-tier upgrade)
 *   - W169 Drop-and-Stick Expansion  ← per-cell sticky accumulation
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N×M grid. Each spin, each of the N·M cells independently has probability
 * q ∈ (0, 1) of landing a NEW wild on it. Once a wild lands on a cell, it
 * stays sticky for exactly S subsequent spins (including the spin it lands
 * on). After S spins, the wild expires and the cell becomes available for
 * a fresh wild to land again.
 *
 * Cell state at spin t: number of remaining sticky-active spins. At any
 * given time, a cell has a wild active iff at least one of the past S
 * spins (including current) landed a wild.
 *
 * Per cell, P(cell has wild active at spin t) =
 *   - For t < S:  1 − (1 − q)^t       (only t spins have happened)
 *   - For t ≥ S:  1 − (1 − q)^S       (saturated steady-state)
 *
 * Independence across cells (iid landing) → expected active wild count at
 * spin t:
 *
 *   E[W_t] = N·M · [1 − (1 − q)^min(t, S)]
 *   E[W_∞] = N·M · [1 − (1 − q)^S]                  (steady-state)
 *
 * Variance per cell (Bernoulli with parameter p_t = 1 − (1 − q)^min(t, S)):
 *   Var(per cell at t) = p_t · (1 − p_t)
 * Total Var[W_t] = N·M · p_t · (1 − p_t)   (independence)
 *
 * ── Time-averaged active wild count over horizon T ────────────────────────
 * For T ≥ S:
 *   E[mean W over [1, T]] = (1/T) Σ_{t=1..T} N·M·[1 − (1 − q)^min(t, S)]
 *
 *   For T ≥ S:
 *     Σ_{t=1..S} [1 − (1−q)^t] = S − [(1−q)·(1 − (1−q)^S)/q]   (geometric sum)
 *     Σ_{t=S+1..T} [1 − (1−q)^S] = (T − S)·[1 − (1−q)^S]
 *   Combine + divide by T.
 *
 * ── Per-spin payout proxy (linear-in-wilds approximation) ────────────────
 * payoutPerSpinProxy(t) = baselineWinPerSpin + perWildBonus · E[W_t]
 * Approximate for operator-grade ballpark; exact RTP requires paytable.
 *
 * ── Disclosure metrics ──────────────────────────────────────────────────
 * expectedActiveWildsSteadyState       = N·M · [1 − (1 − q)^S]
 * expectedActiveWildsAtSpin(t)         = per above formula
 * varianceActiveWildsSteadyState       = N·M · p_∞ · (1 − p_∞)
 * timeToSteadyState                    = S (deterministic)
 * fillFraction                         = E[W_∞] / (N·M)
 * expectedSpinsToFullGridFill          = approximate via geometric (full grid = NM wilds)
 * gridFillProbAtSpin(t)                = P(W_t = N·M) = p_t^(N·M) (independence)
 *
 * ── Distinct from ────────────────────────────────────────────────────────
 *   - W053 Walking Wild Respin (deterministic walk, not iid sticky)
 *   - W093 Multiplicative Wild Stack (no temporal stickiness)
 *   - W114 Sticky Wild Countdown (single wild w/ Markov chain, not per-cell iid)
 *   - W132 Multi-Level Wild Tier (probabilistic upgrade, not sticky expansion)
 *   - W050 Charge Meter (steady-state but no per-cell)
 *
 * Naming: "drop-and-stick wild expansion", "sticky duration", "fill fraction"
 * = generic slot-design terms. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface DropStickWildExpansionConfig {
  /** Grid rows (≥ 1). */
  gridRows: number;
  /** Grid columns (≥ 1). */
  gridCols: number;
  /** Per-cell, per-spin probability of NEW wild landing ∈ (0, 1). */
  probWildLandPerCellPerSpin: number;
  /** Sticky duration (spins) — wild stays for exactly S subsequent spins (≥ 1). */
  stickyDurationSpins: number;
  /** Optional time horizon for time-averaged stats (default = 3·S). */
  horizonSpins?: number;
  /** Optional baseline payout per spin (for payoutPerSpinProxy). */
  baselineWinPerSpin?: number;
  /** Optional bonus per active wild (linear approximation). */
  perWildBonus?: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface DropStickWildExpansionResult {
  gridCellCount: number;
  /** Per-cell P(wild active) at steady-state = 1 − (1−q)^S. */
  perCellActiveProbSteadyState: number;
  /** E[active wild cells] at steady-state. */
  expectedActiveWildsSteadyState: number;
  /** Var[active wild cells] at steady-state (Bernoulli iid). */
  varianceActiveWildsSteadyState: number;
  /** stdDev. */
  stdDevActiveWildsSteadyState: number;
  /** Fill fraction = E[W_∞] / (N·M). */
  fillFraction: number;
  /** Spins until reach saturation = stickyDurationSpins (deterministic). */
  timeToSteadyState: number;
  /** E[active wilds] trajectory at t = 1, ⌈S/2⌉, S (sampled). */
  expectedActiveWildsAtSpin: Array<{ spin: number; expected: number }>;
  /** Time-averaged active wilds over horizon. */
  timeAveragedActiveWildsOverHorizon: number;
  /** P(grid fully filled = all N·M wilds active) at steady-state. */
  gridFillProbSteadyState: number;
  /** Approx expected spins to first full grid fill via inverse of fill prob. */
  expectedSpinsToFullGridFill: number;
  /** Payout per spin proxy at steady-state (if perWildBonus given). */
  payoutPerSpinProxySteadyState: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: DropStickWildExpansionConfig): void {
  if (!Number.isInteger(cfg.gridRows) || cfg.gridRows < 1) {
    throw new Error(`dropStickWildExpansion: gridRows must be positive integer, got ${cfg.gridRows}`);
  }
  if (!Number.isInteger(cfg.gridCols) || cfg.gridCols < 1) {
    throw new Error(`dropStickWildExpansion: gridCols must be positive integer, got ${cfg.gridCols}`);
  }
  if (
    !Number.isFinite(cfg.probWildLandPerCellPerSpin) ||
    cfg.probWildLandPerCellPerSpin <= 0 ||
    cfg.probWildLandPerCellPerSpin >= 1
  ) {
    throw new Error(`dropStickWildExpansion: probWildLandPerCellPerSpin must be in (0, 1), got ${cfg.probWildLandPerCellPerSpin}`);
  }
  if (!Number.isInteger(cfg.stickyDurationSpins) || cfg.stickyDurationSpins < 1) {
    throw new Error(`dropStickWildExpansion: stickyDurationSpins must be positive integer, got ${cfg.stickyDurationSpins}`);
  }
  if (cfg.horizonSpins !== undefined && (!Number.isInteger(cfg.horizonSpins) || cfg.horizonSpins < 1)) {
    throw new Error(`dropStickWildExpansion: horizonSpins must be positive integer if given, got ${cfg.horizonSpins}`);
  }
  if (cfg.baselineWinPerSpin !== undefined && (!Number.isFinite(cfg.baselineWinPerSpin) || cfg.baselineWinPerSpin < 0)) {
    throw new Error(`dropStickWildExpansion: baselineWinPerSpin must be ≥ 0 if given`);
  }
  if (cfg.perWildBonus !== undefined && (!Number.isFinite(cfg.perWildBonus) || cfg.perWildBonus < 0)) {
    throw new Error(`dropStickWildExpansion: perWildBonus must be ≥ 0 if given`);
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveDropStickWildExpansion(
  cfg: DropStickWildExpansionConfig,
): DropStickWildExpansionResult {
  validateConfig(cfg);

  const q = cfg.probWildLandPerCellPerSpin;
  const S = cfg.stickyDurationSpins;
  const NM = cfg.gridRows * cfg.gridCols;
  const T = cfg.horizonSpins ?? 3 * S;
  const baseline = cfg.baselineWinPerSpin ?? 0;
  const bonus = cfg.perWildBonus ?? 0;

  // Per-cell P(wild active at time t)
  const perCellActiveAtSpin = (t: number) => 1 - Math.pow(1 - q, Math.min(t, S));

  const perCellSteady = perCellActiveAtSpin(S); // == perCellActiveAtSpin(>=S)
  const expectedActiveSteady = NM * perCellSteady;
  const varianceSteady = NM * perCellSteady * (1 - perCellSteady);
  const stdDevSteady = Math.sqrt(varianceSteady);
  const fillFraction = perCellSteady;

  // Sample trajectory at t = 1, ⌈S/2⌉, S
  const halfS = Math.max(1, Math.ceil(S / 2));
  const trajectorySpins = Array.from(new Set([1, halfS, S]))
    .sort((a, b) => a - b)
    .map((spin) => ({ spin, expected: NM * perCellActiveAtSpin(spin) }));

  // Time-averaged active wilds over horizon T (closed-form sum):
  //   For t ≤ S: Σ_{t=1..min(T, S)} [1 − (1−q)^t]
  //              = min(T, S) − (1 − q)·(1 − (1 − q)^min(T, S))/q
  //   For t > S (only if T > S): (T − S)·[1 − (1−q)^S]
  let timeAvgSum: number;
  const a = 1 - q;
  const upper1 = Math.min(T, S);
  const phase1Sum = upper1 - (a * (1 - Math.pow(a, upper1))) / q;
  if (T <= S) {
    timeAvgSum = phase1Sum;
  } else {
    const phase2Sum = (T - S) * perCellSteady;
    timeAvgSum = phase1Sum + phase2Sum;
  }
  const timeAveragedActiveWildsOverHorizon = (NM * timeAvgSum) / T;

  // P(grid fully filled at steady-state) = perCellSteady^(N·M) by iid
  // (each cell independently active w.p. perCellSteady)
  const gridFillProbSteadyState = Math.pow(perCellSteady, NM);

  // Expected spins to first full grid fill (approximate via Geometric):
  //   ~ 1 / gridFillProbSteadyState (if non-zero), else Infinity
  const expectedSpinsToFullGridFill =
    gridFillProbSteadyState > 1e-300 ? 1 / gridFillProbSteadyState : Infinity;

  // Payout per spin proxy
  const payoutPerSpinProxySteadyState = baseline + bonus * expectedActiveSteady;

  return {
    gridCellCount: NM,
    perCellActiveProbSteadyState: perCellSteady,
    expectedActiveWildsSteadyState: expectedActiveSteady,
    varianceActiveWildsSteadyState: varianceSteady,
    stdDevActiveWildsSteadyState: stdDevSteady,
    fillFraction,
    timeToSteadyState: S,
    expectedActiveWildsAtSpin: trajectorySpins,
    timeAveragedActiveWildsOverHorizon,
    gridFillProbSteadyState,
    expectedSpinsToFullGridFill,
    payoutPerSpinProxySteadyState,
  };
}

/** ── MC simulation (cross-validates closed-form) ────────────────────────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DropStickWildExpansionMcResult {
  episodes: number;
  observedActiveWildsAtSteadyState: number;
  observedStdDevActiveWildsAtSteadyState: number;
  observedTimeAveragedActiveWildsOverHorizon: number;
}

/**
 * MC: simulate `episodes` independent episodes, each running for ≥ 3·S spins.
 * Records active wild count at spin = 3·S (steady-state) and time-averaged over
 * full horizon. Per-cell remaining-stick counter tracked discretely.
 */
export function simulateDropStickWildExpansion(
  cfg: DropStickWildExpansionConfig,
  episodes: number,
  seed: number,
): DropStickWildExpansionMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  const q = cfg.probWildLandPerCellPerSpin;
  const S = cfg.stickyDurationSpins;
  const NM = cfg.gridRows * cfg.gridCols;
  const T = cfg.horizonSpins ?? 3 * S;

  const steadyStateSpin = T; // sample at end of horizon (≥ S)
  const steadyCounts: number[] = [];
  let totalTimeAvgSum = 0;

  for (let e = 0; e < episodes; e++) {
    const cellRemaining = new Uint16Array(NM); // remaining sticky spins per cell
    let episodeTimeAvgSum = 0;
    for (let t = 1; t <= T; t++) {
      // Decrement remaining counters and refresh on new landings.
      for (let c = 0; c < NM; c++) {
        if (cellRemaining[c] > 0) cellRemaining[c]--;
        if (rng() < q) cellRemaining[c] = S;
      }
      // Count active wilds at this spin.
      let active = 0;
      for (let c = 0; c < NM; c++) {
        if (cellRemaining[c] > 0) active++;
      }
      episodeTimeAvgSum += active;
      if (t === steadyStateSpin) {
        steadyCounts.push(active);
      }
    }
    totalTimeAvgSum += episodeTimeAvgSum / T;
  }

  const meanSteady = steadyCounts.reduce((a, b) => a + b, 0) / episodes;
  const sumSqSteady = steadyCounts.reduce((acc, x) => acc + (x - meanSteady) * (x - meanSteady), 0);
  const stdSteady = Math.sqrt(sumSqSteady / episodes);

  return {
    episodes,
    observedActiveWildsAtSteadyState: meanSteady,
    observedStdDevActiveWildsAtSteadyState: stdSteady,
    observedTimeAveragedActiveWildsOverHorizon: totalTimeAvgSum / episodes,
  };
}
