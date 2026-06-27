/**
 * W152 Wave 142 — Symbol Multiplier on Reel-Stop (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "random multiplier symbol landing" mehaniku —
 * Pragmatic Sweet Bonanza (tumble multiplier symbols sum aggregation) /
 * Pragmatic Bigger Bass Bonanza (fish multiplier symbols additive) /
 * Hacksaw RIP City (sum multipliers) / Push Wild Swarm (sum) / NetEnt
 * Asgardian Stones avalanche multipliers / Yggdrasil Reactoonz multipliers.
 *
 * Naming policy (clean-room): "multiplier symbol", "reel-stop multiplier",
 * "land aggregation" = generic industry terms. No vendor TM.
 *
 * ── Difference vs prior Wxx solvers ───────────────────────────────────────
 *   • W138 Tumble Multiplier with Cap — cascade ladder (M_k determined by
 *     cascade level k, deterministic per level); ovaj solver random POSITION-
 *     based multiplier landings sa random VALUES (no cascade chain)
 *   • W93 Multiplicative Wild Stack — wilds substitute & multiply, ne random
 *     symbol with multiplier value
 *   • W114 Sticky Wild Countdown — time-based persistence, ne per-spin
 *   • W123 Mega Symbol — block expansion, ne multiplier
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N total positions on grid (N = reels × rows, or N = reel count for line games).
 * Per position, independently P(multiplier symbol lands) = q.
 * If landed, value V ~ multiplierValuePmf (positive integer or rational).
 *
 * Aggregation mode (configurable):
 *   ADDITIVE: T = max(1, Σ v_i) where sum is over landed positions
 *     (T = 1 if no multipliers land — baseline identity)
 *   MULTIPLICATIVE: T = Π v_i (positions without multiplier contribute 1×)
 *
 * Base win W (independent of T) ~ baseWinPmf.
 * Total payout Y = T · W.
 *
 * ── Closed form ───────────────────────────────────────────────────────────
 * Let μ_V = E[V], σ_V² = Var[V], μ_W = E[W], σ_W² = Var[W].
 * Let K ~ Binomial(N, q) be the number of landed positions.
 *
 * ADDITIVE:
 *   E[T] = (1−q)^N · 1 + Σ_{k=1..N} C(N,k)·q^k·(1−q)^(N−k) · k·μ_V
 *        = (1−q)^N + N·q·μ_V
 *
 *   E[T²] = (1−q)^N · 1
 *         + Σ_{k≥1} C(N,k)·q^k·(1−q)^(N−k) · (k·σ_V² + k²·μ_V²)
 *
 *   Using Binomial moments: E[K] = N·q, Var[K] = N·q·(1−q),
 *   E[K²] = N·q·(1−q) + N²·q² = N·q·(1 + (N−1)·q)
 *   Σ_{k≥1} P(k)·k·σ_V² = σ_V² · N·q
 *   Σ_{k≥1} P(k)·k²·μ_V² = μ_V² · E[K²]
 *
 *   E[T²] = (1−q)^N + σ_V²·N·q + μ_V²·N·q·(1 + (N−1)·q)
 *   Var[T] = E[T²] − E[T]²
 *
 * MULTIPLICATIVE:
 *   Per cell contributes V (w.p. q) or 1 (w.p. 1−q):
 *   E[T] = (q·μ_V + (1−q))^N
 *   E[T²] = (q·E[V²] + (1−q))^N = (q·(σ_V² + μ_V²) + (1−q))^N
 *   Var[T] = E[T²] − E[T]²
 *
 * Payout:
 *   E[Y] = E[T] · μ_W
 *   Var[Y] = E[T²]·E[W²] − (E[T]·μ_W)²
 *          = E[T²]·(σ_W² + μ_W²) − E[T]²·μ_W²
 *          = σ_W² · E[T²] + μ_W² · Var[T]
 *
 * ── Compliance ────────────────────────────────────────────────────────────
 *   • UKGC RTS 14 — multiplier distribution disclosure
 *   • MGA PPD §11.f — symbol-landing rule transparency
 *   • eCOGRA Generic Slots Audit — verifies multiplier aggregation matches engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateSymbolMultiplierReelStop() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export type MultiplierAggregationMode = 'additive' | 'multiplicative';

export interface MultiplierValuePmfEntry {
  value: number;       // multiplier value (e.g., 2, 3, 5, 10)
  probability: number; // PMF weight
}

export interface SymbolMultiplierStopBaseWinPmfEntry {
  value: number;       // base win amount (X bet units)
  probability: number;
}

export interface SymbolMultiplierReelStopConfig {
  /** Total grid positions (e.g., 30 for 5×6 grid, or N for N-reel line game). */
  positionCount: number;
  /** Per-position probability of multiplier symbol landing (0 < q < 1). */
  multiplierLandingProbability: number;
  /** Aggregation mode: 'additive' (Sweet Bonanza-style) or 'multiplicative' (Asgardian Stones-style). */
  aggregationMode: MultiplierAggregationMode;
  /** PMF for multiplier value when symbol lands. Must sum to 1. */
  multiplierValuePmf: MultiplierValuePmfEntry[];
  /** PMF for base win amount (independent of multiplier). Must sum to 1. */
  baseWinPmf: SymbolMultiplierStopBaseWinPmfEntry[];
}

export interface SymbolMultiplierReelStopResult {
  positionCount: number;
  multiplierLandingProbability: number;
  aggregationMode: MultiplierAggregationMode;
  expectedMultiplierValue: number;       // μ_V
  varianceMultiplierValue: number;       // σ_V²
  expectedBaseWin: number;               // μ_W
  varianceBaseWin: number;               // σ_W²
  expectedTotalMultiplier: number;       // E[T]
  varianceTotalMultiplier: number;       // Var[T]
  expectedPayoutPerSpin: number;         // E[Y] = E[T]·μ_W
  variancePayoutPerSpin: number;         // Var[Y]
  probAnyMultiplierLands: number;        // 1 − (1−q)^N
  expectedLandedCount: number;           // N·q
}

export interface SymbolMultiplierReelStopMcResult {
  spins: number;
  observedMeanPayoutPerSpin: number;
  observedMeanTotalMultiplier: number;
  observedMeanLandedCount: number;
  observedAnyMultiplierLandsFraction: number;
  observedMaxMultiplierSeen: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validatePmf(pmf: Array<{ value: number; probability: number }>, name: string): void {
  if (!Array.isArray(pmf) || pmf.length === 0) {
    throw new Error(`${name} must be non-empty array`);
  }
  let sum = 0;
  for (const e of pmf) {
    if (!Number.isFinite(e.value)) {
      throw new Error(`${name} entry value must be finite`);
    }
    if (!(e.probability >= 0 && e.probability <= 1)) {
      throw new Error(`${name} entry probability must be in [0, 1]`);
    }
    sum += e.probability;
  }
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`${name} probabilities must sum to 1 (got ${sum})`);
  }
}

function validateConfig(cfg: SymbolMultiplierReelStopConfig): void {
  if (!Number.isInteger(cfg.positionCount) || cfg.positionCount < 1) {
    throw new Error(`positionCount must be positive integer (got ${cfg.positionCount})`);
  }
  if (!(cfg.multiplierLandingProbability > 0 && cfg.multiplierLandingProbability < 1)) {
    throw new Error(`multiplierLandingProbability must be in (0, 1) (got ${cfg.multiplierLandingProbability})`);
  }
  if (cfg.aggregationMode !== 'additive' && cfg.aggregationMode !== 'multiplicative') {
    throw new Error(`aggregationMode must be 'additive' or 'multiplicative' (got ${cfg.aggregationMode})`);
  }
  validatePmf(cfg.multiplierValuePmf, 'multiplierValuePmf');
  validatePmf(cfg.baseWinPmf, 'baseWinPmf');
  for (const e of cfg.multiplierValuePmf) {
    if (e.value <= 0) throw new Error(`multiplier value must be positive (got ${e.value})`);
  }
  for (const e of cfg.baseWinPmf) {
    if (e.value < 0) throw new Error(`base win value must be non-negative (got ${e.value})`);
  }
}

// ── PMF moments ─────────────────────────────────────────────────────────────

function pmfMoments(pmf: Array<{ value: number; probability: number }>): { mean: number; variance: number; secondMoment: number } {
  let m1 = 0;
  let m2 = 0;
  for (const e of pmf) {
    m1 += e.value * e.probability;
    m2 += e.value * e.value * e.probability;
  }
  const variance = m2 - m1 * m1;
  return { mean: m1, variance: variance > 0 ? variance : 0, secondMoment: m2 };
}

// ── Closed-form solver ──────────────────────────────────────────────────────

export function solveSymbolMultiplierReelStop(cfg: SymbolMultiplierReelStopConfig): SymbolMultiplierReelStopResult {
  validateConfig(cfg);
  const { positionCount: N, multiplierLandingProbability: q, aggregationMode } = cfg;
  const { mean: muV, variance: varV, secondMoment: ev2 } = pmfMoments(cfg.multiplierValuePmf);
  const { mean: muW, variance: varW, secondMoment: ew2 } = pmfMoments(cfg.baseWinPmf);

  const probNoneLand = Math.pow(1 - q, N);
  const probAnyLand = 1 - probNoneLand;
  const expectedLandedCount = N * q;

  let eT: number;
  let eT2: number;

  if (aggregationMode === 'additive') {
    // E[T] = (1-q)^N + N·q·μ_V
    eT = probNoneLand + N * q * muV;
    // E[T²] = (1-q)^N + σ_V²·N·q + μ_V²·N·q·(1 + (N-1)·q)
    eT2 = probNoneLand + varV * N * q + muV * muV * N * q * (1 + (N - 1) * q);
  } else {
    // multiplicative
    // E[T] = (q·μ_V + (1-q))^N
    eT = Math.pow(q * muV + (1 - q), N);
    // E[T²] = (q·E[V²] + (1-q))^N
    eT2 = Math.pow(q * ev2 + (1 - q), N);
  }

  const varT = Math.max(0, eT2 - eT * eT);

  // E[Y] = E[T] · μ_W
  const expectedPayoutPerSpin = eT * muW;
  // Var[Y] = E[T²]·E[W²] − (E[T]·μ_W)²
  const variancePayoutPerSpin = Math.max(0, eT2 * ew2 - expectedPayoutPerSpin * expectedPayoutPerSpin);

  return {
    positionCount: N,
    multiplierLandingProbability: q,
    aggregationMode,
    expectedMultiplierValue: muV,
    varianceMultiplierValue: varV,
    expectedBaseWin: muW,
    varianceBaseWin: varW,
    expectedTotalMultiplier: eT,
    varianceTotalMultiplier: varT,
    expectedPayoutPerSpin,
    variancePayoutPerSpin,
    probAnyMultiplierLands: probAnyLand,
    expectedLandedCount,
  };
}

// ── MC reference ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleFromPmf(pmf: Array<{ value: number; probability: number }>, u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

export function simulateSymbolMultiplierReelStop(
  cfg: SymbolMultiplierReelStopConfig,
  spins: number,
  seed: number,
): SymbolMultiplierReelStopMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(spins) || spins < 1) {
    throw new Error(`Invalid spins: ${spins}`);
  }
  const rng = mulberry32(seed);
  const { positionCount: N, multiplierLandingProbability: q, aggregationMode } = cfg;

  let totalPayout = 0;
  let totalMultiplier = 0;
  let totalLanded = 0;
  let anyLandCount = 0;
  let maxMultSeen = 0;

  for (let spin = 0; spin < spins; spin++) {
    let landed = 0;
    let mult = aggregationMode === 'additive' ? 0 : 1;
    for (let pos = 0; pos < N; pos++) {
      if (rng() < q) {
        landed += 1;
        const v = sampleFromPmf(cfg.multiplierValuePmf, rng());
        if (aggregationMode === 'additive') {
          mult += v;
        } else {
          mult *= v;
        }
      }
    }
    // For additive: T = max(1, sum); if no landings, T=1
    // For multiplicative: T = product; if no landings, T=1 (initial)
    let T: number;
    if (aggregationMode === 'additive') {
      T = landed === 0 ? 1 : mult;
    } else {
      T = mult; // already 1 when no landings
    }
    const W = sampleFromPmf(cfg.baseWinPmf, rng());
    const Y = T * W;
    totalPayout += Y;
    totalMultiplier += T;
    totalLanded += landed;
    if (landed > 0) anyLandCount += 1;
    if (T > maxMultSeen) maxMultSeen = T;
  }

  return {
    spins,
    observedMeanPayoutPerSpin: totalPayout / spins,
    observedMeanTotalMultiplier: totalMultiplier / spins,
    observedMeanLandedCount: totalLanded / spins,
    observedAnyMultiplierLandsFraction: anyLandCount / spins,
    observedMaxMultiplierSeen: maxMultSeen,
  };
}
