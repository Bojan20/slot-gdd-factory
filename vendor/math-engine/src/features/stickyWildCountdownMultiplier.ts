/**
 * W152 Wave 114 — Sticky Wild Countdown Multiplier (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "sticky wild s rastucim multiplikatorom" mehaniku —
 * Pragmatic Hot Fiesta / NetEnt Vikings Berzerk / Push Gaming Wild Swarm /
 * Quickspin Sakura Fortune style. Wild se zalepi na N spinova, multiplikator
 * raste linearno ili geometrijski tokom aktive periode.
 *
 * Naming policy (clean-room): "sticky wild", "countdown", "multiplier" =
 * generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W93 Multiplicative Wild Stack — product of co-active wilds (instantaneous)
 *   • W89 Persistent Multiplier Accumulator — drop-chain Binomial growth (FS only)
 *   • W43/W97 FS Lookback — post-hoc aggregate over fixed K spins
 *   • W47 Walking Wild — wild moves position-by-position, multiplier static
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Discrete-time Markov chain sa stanjima S ∈ {0, 1, ..., N}:
 *   • S = 0    — no active wild
 *   • S = k    — k-th spin of active wild (1 ≤ k ≤ N)
 *
 * Per-spin transitions:
 *   S=0 → S=0 sa prob (1 − p_land)        (no wild lands)
 *   S=0 → S=1 sa prob p_land              (wild lands, activate)
 *   S=k → S=k+1 sa prob 1   (k = 1..N−1)  (deterministic countdown progress)
 *   S=N → S=0 sa prob 1                    (wild expires)
 *
 * Cycle length = expected_idle + N = (1/p_land) + N.
 *
 * Stationary distribution (closed-form):
 *   π_0 = 1 / (1 + N · p_land)
 *   π_k = p_land / (1 + N · p_land)   for k = 1..N
 *
 * Multiplier per active spin k (linear or geometric mode):
 *   linear:    M_k = baseMult + (k − 1) · step       (k = 1..N)
 *   geometric: M_k = baseMult · ratio^(k − 1)         (k = 1..N)
 *
 * Steady-state expected multiplier per spin:
 *   E[M_spin] = π_0 · 1 + Σ_{k=1..N} π_k · M_k
 *             = π_0 + π_1 · Σ_{k=1..N} M_k
 *
 *   Σ M_k (linear)    = N · baseMult + step · N · (N−1) / 2
 *   Σ M_k (geometric) = baseMult · (ratio^N − 1) / (ratio − 1)   for ratio ≠ 1
 *                     = baseMult · N                              for ratio = 1
 *
 * Steady-state per-spin payout (V iid per spin, independent of wild state):
 *   E[Y_spin] = E[V] · E[M_spin]
 *
 * Variance decomposition:
 *   E[M²_spin]  = π_0 + π_1 · Σ_{k=1..N} M_k²
 *   Var[M_spin] = E[M²_spin] − E[M_spin]²
 *   Var[Y_spin] = E[V²]·E[M²_spin] − E[V]²·E[M_spin]²
 *               = E[V²]·E[M²] − E[Y]²     (cross-independence)
 *
 * Per-cycle (one full activation) accumulated mult:
 *   total_mult_per_cycle = Σ_{k=1..N} M_k       (no idle multiplier counted)
 *   E[cycle_payout] = E[V_active_window] · Σ M_k = N · E[V] · (avg M)
 *
 * Tail / industry-disclosure metrics:
 *   • maxMultEver = M_N (linear: base + (N−1)·step; geom: base·ratio^(N−1))
 *   • probSpinIsActive = 1 − π_0 = N·p_land / (1 + N·p_land)
 *   • E[spins between activations] = 1/p_land
 *
 * Industry compliance:
 *   • UKGC RTS 14 — variance + tail-probability disclosure (M_N + active%)
 *   • MGA PPD §11.f — operator-facing volatility metric
 *   • eCOGRA Generic Slots Audit — verifies steady-state E[M] matches engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateStickyWildCountdownMultiplier() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export type MultiplierGrowthMode = 'linear' | 'geometric';

export interface BaseWinPmfEntry {
  /** Win value per spin (in betX units, ≥ 0). */
  value: number;
  /** Probability of this value (0 ≤ p ≤ 1). */
  probability: number;
}

export interface StickyWildCountdownMultiplierConfig {
  /** Probability a wild lands per spin when no wild is currently active (0 < p ≤ 1). */
  landProbability: number;
  /** Number of spins the wild stays sticky (positive integer ≥ 1). */
  stickyDuration: number;
  /** Multiplier on the first active spin (≥ 1). */
  baseMultiplier: number;
  /** Growth mode: linear (additive step) or geometric (multiplicative ratio). */
  growthMode: MultiplierGrowthMode;
  /** Linear step (only used when growthMode='linear'; default 0). */
  linearStep?: number;
  /** Geometric ratio (only used when growthMode='geometric'; default 1). */
  geometricRatio?: number;
  /** Discrete pmf of per-spin base-win value V (independent of wild state). */
  baseWinPmf: BaseWinPmfEntry[];
}

export interface StickyWildCountdownMultiplierResult {
  // Stationary distribution
  stationaryDistribution: number[]; // length N+1, index k = π_k
  probSpinIsActive: number;
  probSpinIsIdle: number;
  // Multiplier metrics
  perActiveSpinMultipliers: number[]; // length N, M_1..M_N
  maxMultiplier: number;
  expectedMultiplierPerSpin: number;
  expectedMultiplierSquaredPerSpin: number;
  varianceMultiplierPerSpin: number;
  // Win metrics (V × M composition)
  expectedBaseWin: number;
  expectedBaseWinSquared: number;
  expectedPayoutPerSpin: number;
  variancePayoutPerSpin: number;
  // Cycle metrics
  expectedCycleLength: number; // 1/p + N
  totalMultiplierPerActiveCycle: number; // Σ M_k
  expectedPayoutPerActiveCycle: number; // E[V] × Σ M_k
}

export interface StickyWildCountdownMultiplierMCResult {
  spins: number;
  observedActiveFraction: number;
  observedMeanMultiplierPerSpin: number;
  observedMeanPayoutPerSpin: number;
  observedVariancePayoutPerSpin: number;
  observedMaxMultiplierSeen: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: StickyWildCountdownMultiplierConfig): void {
  if (!Number.isFinite(cfg.landProbability) || cfg.landProbability <= 0 || cfg.landProbability > 1) {
    throw new Error(`landProbability must be in (0, 1] (got ${cfg.landProbability})`);
  }
  if (!Number.isInteger(cfg.stickyDuration) || cfg.stickyDuration < 1) {
    throw new Error(`stickyDuration must be a positive integer ≥ 1 (got ${cfg.stickyDuration})`);
  }
  if (!Number.isFinite(cfg.baseMultiplier) || cfg.baseMultiplier < 1) {
    throw new Error(`baseMultiplier must be ≥ 1 (got ${cfg.baseMultiplier})`);
  }
  if (cfg.growthMode !== 'linear' && cfg.growthMode !== 'geometric') {
    throw new Error(`growthMode must be 'linear' or 'geometric'`);
  }
  if (cfg.growthMode === 'linear') {
    const step = cfg.linearStep ?? 0;
    if (!Number.isFinite(step) || step < 0) {
      throw new Error(`linearStep must be ≥ 0 (got ${step})`);
    }
  } else {
    const r = cfg.geometricRatio ?? 1;
    if (!Number.isFinite(r) || r < 1) {
      throw new Error(`geometricRatio must be ≥ 1 (got ${r})`);
    }
  }
  if (!Array.isArray(cfg.baseWinPmf) || cfg.baseWinPmf.length === 0) {
    throw new Error(`baseWinPmf must be non-empty`);
  }
  let sumP = 0;
  for (const e of cfg.baseWinPmf) {
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`baseWinPmf.value must be ≥ 0 (got ${e.value})`);
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`baseWinPmf.probability must be in [0, 1] (got ${e.probability})`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`baseWinPmf probabilities sum to ${sumP}, must be 1`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

function computePerActiveSpinMultipliers(cfg: StickyWildCountdownMultiplierConfig): number[] {
  const N = cfg.stickyDuration;
  const base = cfg.baseMultiplier;
  const out: number[] = new Array<number>(N);
  if (cfg.growthMode === 'linear') {
    const step = cfg.linearStep ?? 0;
    for (let k = 0; k < N; k++) out[k] = base + k * step;
  } else {
    const r = cfg.geometricRatio ?? 1;
    let m = base;
    for (let k = 0; k < N; k++) {
      out[k] = m;
      m *= r;
    }
  }
  return out;
}

function pmfMoments(pmf: BaseWinPmfEntry[]): { e: number; e2: number } {
  let e = 0;
  let e2 = 0;
  for (const { value, probability } of pmf) {
    e += value * probability;
    e2 += value * value * probability;
  }
  return { e, e2 };
}

export function solveStickyWildCountdownMultiplier(
  config: StickyWildCountdownMultiplierConfig,
): StickyWildCountdownMultiplierResult {
  validate(config);
  const p = config.landProbability;
  const N = config.stickyDuration;

  // Stationary distribution
  const pi0 = 1 / (1 + N * p);
  const pik = p / (1 + N * p); // identical for k = 1..N
  const stationaryDistribution: number[] = [pi0];
  for (let k = 1; k <= N; k++) stationaryDistribution.push(pik);

  // Per-active-spin multipliers M_1..M_N
  const M = computePerActiveSpinMultipliers(config);
  const maxM = M[N - 1];
  const sumM = M.reduce((s, v) => s + v, 0);
  const sumM2 = M.reduce((s, v) => s + v * v, 0);

  // E[M_spin] = π_0 · 1 + π_k · Σ M_k
  const eM = pi0 + pik * sumM;
  // E[M²_spin] = π_0 · 1 + π_k · Σ M_k²
  const eM2 = pi0 + pik * sumM2;
  const varM = Math.max(0, eM2 - eM * eM);

  // Base-win moments
  const { e: eV, e2: eV2 } = pmfMoments(config.baseWinPmf);

  // Payout = V × M (independent: V iid, M depends only on state)
  const eY = eV * eM;
  const eY2 = eV2 * eM2;
  const varY = Math.max(0, eY2 - eY * eY);

  // Cycle metrics
  const cycleLen = 1 / p + N;
  const cyclePayout = eV * sumM;

  return {
    stationaryDistribution,
    probSpinIsActive: 1 - pi0,
    probSpinIsIdle: pi0,
    perActiveSpinMultipliers: M,
    maxMultiplier: maxM,
    expectedMultiplierPerSpin: eM,
    expectedMultiplierSquaredPerSpin: eM2,
    varianceMultiplierPerSpin: varM,
    expectedBaseWin: eV,
    expectedBaseWinSquared: eV2,
    expectedPayoutPerSpin: eY,
    variancePayoutPerSpin: varY,
    expectedCycleLength: cycleLen,
    totalMultiplierPerActiveCycle: sumM,
    expectedPayoutPerActiveCycle: cyclePayout,
  };
}

// ── MC reference solver ────────────────────────────────────────────────────

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

function sampleBaseWin(pmf: BaseWinPmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

export function simulateStickyWildCountdownMultiplier(
  config: StickyWildCountdownMultiplierConfig,
  spins: number,
  seed: number,
): StickyWildCountdownMultiplierMCResult {
  validate(config);
  const rng = makePrng(seed);
  const M = computePerActiveSpinMultipliers(config);
  const N = config.stickyDuration;
  const p = config.landProbability;

  let state = 0; // 0 = idle, 1..N = active spin index
  let activeCount = 0;
  let sumMult = 0;
  let sumPayout = 0;
  let sumPayoutSq = 0;
  let maxMultSeen = 0;

  for (let t = 0; t < spins; t++) {
    // Determine multiplier from CURRENT state at top of spin.
    // (Convention: state s_t reflects the spin's identity.
    //  s_t=0 → idle this spin, s_t=k>0 → k-th active spin.)
    let currentMult: number;
    let isActive: boolean;
    if (state === 0) {
      currentMult = 1;
      isActive = false;
    } else {
      currentMult = M[state - 1];
      isActive = true;
    }

    const V = sampleBaseWin(config.baseWinPmf, rng());
    const payout = V * currentMult;

    if (isActive) activeCount++;
    if (currentMult > maxMultSeen) maxMultSeen = currentMult;
    sumMult += currentMult;
    sumPayout += payout;
    sumPayoutSq += payout * payout;

    // Transition at end of spin (matches CF stationary derivation):
    //   state 0 → state 1 sa prob p, → state 0 sa prob (1-p)
    //   state k (1 ≤ k < N) → state k+1 (deterministic)
    //   state N → state 0 (deterministic expire)
    if (state === 0) {
      if (rng() < p) state = 1;
    } else if (state < N) {
      state += 1;
    } else {
      // state === N
      state = 0;
    }
  }

  const meanPay = sumPayout / spins;
  const varPay = Math.max(0, sumPayoutSq / spins - meanPay * meanPay);

  return {
    spins,
    observedActiveFraction: activeCount / spins,
    observedMeanMultiplierPerSpin: sumMult / spins,
    observedMeanPayoutPerSpin: meanPay,
    observedVariancePayoutPerSpin: varPay,
    observedMaxMultiplierSeen: maxMultSeen,
  };
}
