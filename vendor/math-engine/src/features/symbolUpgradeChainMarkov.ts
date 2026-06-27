/**
 * W152 Wave 101 — Symbol Upgrade Chain Markov (Faza 12 ext).
 *
 * Closed-form solver za "symbol upgrade chain" mehaniku — Pragmatic /
 * BTG / Push Gaming style features gde simbol prolazi kroz LADDER
 * upgrade-ova tokom feature trajanja, sa per-state payout multiplier-om.
 *
 * Naming policy (clean-room): "symbol upgrade", "level ladder",
 * "tier advance" = generic industry terms. No vendor-specific
 * implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * States: S_0, S_1, …, S_L  (S_0 = base, S_L = max)
 * Per spin transition:
 *   With prob p_advance, advance current state (S_i → S_{i+1}, clipped at S_L).
 *   Else stay at current state.
 *
 * Per-state payout value v_i (typically increasing in i).
 *
 * Episode = K spins. Starting state = S_0.
 *
 * Advances A in K spins ~ Binomial(K, p):
 *   E[A]   = K · p
 *   Var[A] = K · p · (1 - p)
 *
 * Final state F = min(A, L):
 *   For i < L: P(F = i) = P(A = i) = C(K,i) · p^i · (1-p)^(K-i)
 *   P(F = L) = P(A ≥ L) = 1 − Σ_{i=0..L-1} P(A = i)
 *
 * Payout: Y = v_{F}
 *   E[Y]    = Σ_{i=0..L} P(F = i) · v_i
 *   E[Y²]   = Σ_{i=0..L} P(F = i) · v_i²
 *   Var[Y]  = E[Y²] − E[Y]²
 *
 * Tail probabilities:
 *   P(F = L)    = P(A ≥ L)  — reach top tier
 *   P(F = 0)    = (1-p)^K   — never advance (worst case)
 *   P(F ≥ k)    = Σ_{i=k..L} P(F = i)  for any threshold k
 *
 * Per-base-spin contribution (optional):
 *   E[feature payout per base spin] = q_trigger · E[Y]
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateSymbolUpgradeChain() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface SymbolUpgradeChainConfig {
  /** Number of free spins / feature spins (integer ≥ 1). */
  freeSpinsK: number;
  /** Per-spin advance probability (0 ≤ p ≤ 1). */
  advanceProbabilityPerSpin: number;
  /** Per-state payout values (length = L+1, including state 0). */
  payoutValuesPerState: number[];
  /** (Optional) Per-base-spin feature trigger probability. */
  baseTriggerProbabilityPerSpin?: number;
}

export interface SymbolUpgradeChainResult {
  // Advance statistics
  expectedAdvances: number;
  varianceAdvances: number;
  // State distribution after K spins
  finalStateDistribution: number[]; // P(F = i) for i = 0..L
  // Final-state payout statistics
  expectedPayoutX: number;
  variancePayoutX: number;
  stdPayoutX: number;
  // Tail probabilities
  probReachTopState: number;
  probStayAtBase: number;
  probReachHalfway: number;
  // Per-base-spin contribution
  expectedFeaturePayoutPerBaseSpin: number | null;
}

export interface SymbolUpgradeChainMCResult {
  episodes: number;
  totalPayoutX: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
  observedStateHistogram: number[];
  observedMaxState: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: SymbolUpgradeChainConfig): void {
  if (!Number.isInteger(cfg.freeSpinsK) || cfg.freeSpinsK < 1) {
    throw new Error(`freeSpinsK must be integer ≥ 1`);
  }
  const p = cfg.advanceProbabilityPerSpin;
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error(`advanceProbabilityPerSpin must be in [0, 1]`);
  }
  if (!Array.isArray(cfg.payoutValuesPerState) || cfg.payoutValuesPerState.length < 2) {
    throw new Error(`payoutValuesPerState must have at least 2 entries (S_0 + S_max)`);
  }
  for (const v of cfg.payoutValuesPerState) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`payout value must be ≥ 0`);
    }
  }
  if (cfg.baseTriggerProbabilityPerSpin !== undefined) {
    const q = cfg.baseTriggerProbabilityPerSpin;
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      throw new Error(`baseTriggerProbabilityPerSpin must be in [0, 1]`);
    }
  }
}

// Binomial PMF P(X = k) = C(n, k) · p^k · (1-p)^(n-k)
function binomialPMF(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  // log-space for numerical stability with large n
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log((n - i + 1) / i);
  const logProb = logC + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logProb);
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveSymbolUpgradeChain(
  config: SymbolUpgradeChainConfig,
): SymbolUpgradeChainResult {
  validate(config);
  const K = config.freeSpinsK;
  const p = config.advanceProbabilityPerSpin;
  const values = config.payoutValuesPerState;
  const L = values.length - 1;

  // Advance count moments
  const eA = K * p;
  const varA = K * p * (1 - p);

  // Final-state distribution: F = min(A, L)
  // For i = 0..L-1: P(F=i) = P(A=i) = binomial PMF
  // P(F=L) = P(A ≥ L)
  const dist: number[] = new Array<number>(L + 1).fill(0);
  let cumLessThanL = 0;
  for (let i = 0; i < L; i++) {
    dist[i] = binomialPMF(i, K, p);
    cumLessThanL += dist[i];
  }
  dist[L] = Math.max(0, 1 - cumLessThanL);

  // Payout moments
  let eY = 0;
  let eY2 = 0;
  for (let i = 0; i <= L; i++) {
    eY += dist[i] * values[i];
    eY2 += dist[i] * values[i] * values[i];
  }
  const varY = Math.max(0, eY2 - eY * eY);
  const stdY = Math.sqrt(varY);

  // Tail probabilities
  const probTop = dist[L];
  const probBase = Math.pow(1 - p, K);
  const halfway = Math.floor(L / 2);
  let probHalf = 0;
  for (let i = halfway; i <= L; i++) probHalf += dist[i];

  // Per-base-spin contribution
  const q = config.baseTriggerProbabilityPerSpin;
  const featurePerBase = q !== undefined ? q * eY : null;

  return {
    expectedAdvances: eA,
    varianceAdvances: varA,
    finalStateDistribution: dist,
    expectedPayoutX: eY,
    variancePayoutX: varY,
    stdPayoutX: stdY,
    probReachTopState: probTop,
    probStayAtBase: probBase,
    probReachHalfway: probHalf,
    expectedFeaturePayoutPerBaseSpin: featurePerBase,
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

export function simulateSymbolUpgradeChain(
  config: SymbolUpgradeChainConfig,
  episodes: number,
  seed: number,
): SymbolUpgradeChainMCResult {
  validate(config);
  const rng = makePrng(seed);
  const K = config.freeSpinsK;
  const p = config.advanceProbabilityPerSpin;
  const values = config.payoutValuesPerState;
  const L = values.length - 1;

  let totalPayout = 0;
  let totalPayoutSq = 0;
  let maxStateObserved = 0;
  const stateHist: number[] = new Array<number>(L + 1).fill(0);

  for (let ep = 0; ep < episodes; ep++) {
    let state = 0;
    for (let i = 0; i < K; i++) {
      if (state < L && rng() < p) state++;
    }
    const payout = values[state];
    totalPayout += payout;
    totalPayoutSq += payout * payout;
    stateHist[state]++;
    if (state > maxStateObserved) maxStateObserved = state;
  }

  const meanY = totalPayout / episodes;
  const variance = Math.max(0, totalPayoutSq / episodes - meanY * meanY);

  return {
    episodes,
    totalPayoutX: totalPayout,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: variance,
    observedStateHistogram: stateHist.map((c) => c / episodes),
    observedMaxState: maxStateObserved,
  };
}
