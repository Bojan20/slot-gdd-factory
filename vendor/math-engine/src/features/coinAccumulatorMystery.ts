/**
 * W152 Wave 91 — Coin Accumulator with Mystery Values (Faza 12 ext).
 *
 * Closed-form solver za "Money Train" / "Money Cart" / "Wanted Dead or a Wild"
 * style coin-accumulation features where each free spin can land a coin
 * symbol on a random cell, and each landed coin has a mystery value
 * drawn from a discrete distribution (cash multiplier, mini/minor/major
 * jackpot, persist/collect/payer, etc).
 *
 * Naming policy (clean-room): "coin symbol", "mystery value", "money
 * symbol" = generic industry terms. No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per free spin (fixed K free spins):
 *   1. With prob q a coin symbol lands.
 *   2. If a coin lands, its value V is drawn from a discrete
 *      distribution: V ∈ {v_1, …, v_n} with weights {w_1, …, w_n}.
 *      Sample mean: μ_V = Σ p_i · v_i  where p_i = w_i / Σw.
 *      Sample variance: σ²_V = Σ p_i · v_i² − μ²_V.
 *
 * Number of coins collected over K spins: N ~ Binomial(K, q):
 *   E[N]   = K·q
 *   Var[N] = K·q·(1-q)
 *
 * Total payout Y = Σ_{i=1..N} V_i (compound sum, V iid):
 *   E[Y]   = E[N] · μ_V                            (Wald)
 *   Var[Y] = E[N] · σ²_V + Var[N] · μ²_V          (compound-sum)
 *          = K·q · σ²_V + K·q·(1-q) · μ²_V
 *
 * Tail risk:
 *   P(N = 0)        = (1 - q)^K       — feature ends with zero coins
 *   P(N = K)        = q^K             — all spins land coins
 *   P(grand)        = P(N ≥ 1) · (1 − (1 − p_grand)^E[N])
 *                                      — at least one grand coin lands
 *                                      (approximate when grand value v_grand
 *                                       is rare relative to coin landings)
 *
 *   Exact P(at least one v_max coin in N coins | N = n) = 1 − (1 − p_max)^n
 *   P(at least one v_max coin) = Σ P(N=n) · [1 − (1 − p_max)^n]
 *                              = 1 − Σ P(N=n) · (1 − p_max)^n
 *                              = 1 − (1 − q · p_max)^K
 *     (Bernoulli-Binomial nesting identity)
 *
 * Per-base-spin contribution (optional):
 *   E[feature payout per base spin] = q_trigger · E[Y]
 *   where q_trigger is per-base-spin probability of triggering this
 *   K-spin coin-collect feature.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateCoinAccumulatorMystery() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface CoinValueOutcome {
  /** Display label (e.g. 'cash_low', 'mini', 'minor', 'major', 'grand'). */
  label: string;
  /** Coin payout value (bet multiplier). */
  valueX: number;
  /** Weight (probability proportional to Σ weights). */
  weight: number;
}

export interface CoinAccumulatorMysteryConfig {
  /** Number of free spins (deterministic integer ≥ 1). */
  freeSpinsK: number;
  /** Probability per spin a coin lands. */
  coinLandingProbabilityPerSpin: number;
  /** Mystery value outcome distribution (non-empty). */
  coinValueOutcomes: CoinValueOutcome[];
  /** Per-base-spin probability that the feature is triggered (optional). */
  baseTriggerProbabilityPerSpin?: number;
}

export interface CoinAccumulatorMysteryResult {
  // Coin-count statistics
  expectedCoinsTotal: number;
  varianceCoinsTotal: number;
  // Value distribution moments
  expectedCoinValue: number;
  varianceCoinValue: number;
  // Total payout statistics
  expectedTotalPayoutX: number;
  varianceTotalPayoutX: number;
  stdTotalPayoutX: number;
  // Tail probabilities
  probZeroCoins: number;
  probAllCoins: number;
  /** P(at least one coin of the max-value outcome lands). */
  probAtLeastOneMaxValue: number;
  // Per-base-spin contribution
  expectedFeaturePayoutPerBaseSpin: number | null;
}

export interface CoinAccumulatorMysteryMCResult {
  episodes: number;
  totalCoins: number;
  totalPayoutX: number;
  observedMeanCoins: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
  observedMaxValueCount: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: CoinAccumulatorMysteryConfig): void {
  if (!Number.isInteger(cfg.freeSpinsK) || cfg.freeSpinsK < 1) {
    throw new Error(`freeSpinsK must be integer ≥ 1`);
  }
  const q = cfg.coinLandingProbabilityPerSpin;
  if (!Number.isFinite(q) || q < 0 || q > 1) {
    throw new Error(`coinLandingProbabilityPerSpin must be in [0, 1]`);
  }
  if (!Array.isArray(cfg.coinValueOutcomes) || cfg.coinValueOutcomes.length === 0) {
    throw new Error(`coinValueOutcomes must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const o of cfg.coinValueOutcomes) {
    if (typeof o.label !== 'string' || o.label.length === 0) {
      throw new Error(`coin outcome label must be non-empty string`);
    }
    if (seen.has(o.label)) throw new Error(`duplicate coin outcome label: ${o.label}`);
    seen.add(o.label);
    if (!Number.isFinite(o.valueX) || o.valueX < 0) {
      throw new Error(`coin outcome ${o.label}: valueX must be ≥ 0`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`coin outcome ${o.label}: weight must be > 0`);
    }
  }
  if (cfg.baseTriggerProbabilityPerSpin !== undefined) {
    const b = cfg.baseTriggerProbabilityPerSpin;
    if (!Number.isFinite(b) || b < 0 || b > 1) {
      throw new Error(`baseTriggerProbabilityPerSpin must be in [0, 1]`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveCoinAccumulatorMystery(
  config: CoinAccumulatorMysteryConfig,
): CoinAccumulatorMysteryResult {
  validate(config);
  const K = config.freeSpinsK;
  const q = config.coinLandingProbabilityPerSpin;
  const outcomes = config.coinValueOutcomes;
  const sumW = outcomes.reduce((a, o) => a + o.weight, 0);

  // Coin value distribution moments
  let muV = 0;
  let eV2 = 0;
  let maxValue = -Infinity;
  let pMax = 0;
  for (const o of outcomes) {
    const p = o.weight / sumW;
    muV += p * o.valueX;
    eV2 += p * o.valueX * o.valueX;
    if (o.valueX > maxValue) {
      maxValue = o.valueX;
      pMax = p;
    } else if (o.valueX === maxValue) {
      pMax += p;
    }
  }
  const varV = Math.max(0, eV2 - muV * muV);

  // Coin-count statistics: N ~ Binomial(K, q)
  const eN = K * q;
  const varN = K * q * (1 - q);

  // Compound-sum: Y = Σ_{i=1..N} V_i
  const eY = eN * muV;
  const varY = eN * varV + varN * muV * muV;
  const stdY = Math.sqrt(varY);

  // Tail probabilities
  const probZero = Math.pow(1 - q, K);
  const probAll = Math.pow(q, K);
  // P(at least one max-value coin) = 1 − (1 − q·p_max)^K  (Bernoulli-Binomial nesting)
  const probMax = 1 - Math.pow(1 - q * pMax, K);

  // Per-base-spin contribution
  const baseTrig = config.baseTriggerProbabilityPerSpin;
  const featurePerBase = baseTrig !== undefined ? baseTrig * eY : null;

  return {
    expectedCoinsTotal: eN,
    varianceCoinsTotal: varN,
    expectedCoinValue: muV,
    varianceCoinValue: varV,
    expectedTotalPayoutX: eY,
    varianceTotalPayoutX: varY,
    stdTotalPayoutX: stdY,
    probZeroCoins: probZero,
    probAllCoins: probAll,
    probAtLeastOneMaxValue: probMax,
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

export function simulateCoinAccumulatorMystery(
  config: CoinAccumulatorMysteryConfig,
  episodes: number,
  seed: number,
): CoinAccumulatorMysteryMCResult {
  validate(config);
  const rng = makePrng(seed);
  const K = config.freeSpinsK;
  const q = config.coinLandingProbabilityPerSpin;
  const outcomes = config.coinValueOutcomes;
  const sumW = outcomes.reduce((a, o) => a + o.weight, 0);
  // Cumulative outcome probabilities for inverse-CDF sampling
  const N = outcomes.length;
  const cum: number[] = new Array<number>(N);
  {
    let running = 0;
    for (let i = 0; i < N; i++) {
      running += outcomes[i].weight / sumW;
      cum[i] = running;
    }
    cum[N - 1] = 1;
  }
  // Find max value index for "max-value count" stat
  let maxValueIdx = 0;
  for (let i = 1; i < N; i++) {
    if (outcomes[i].valueX > outcomes[maxValueIdx].valueX) maxValueIdx = i;
  }

  let totalCoins = 0;
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let totalMaxValueCount = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let coinsThisEp = 0;
    let payoutThisEp = 0;
    let maxCountThisEp = 0;
    for (let s = 0; s < K; s++) {
      if (rng() < q) {
        coinsThisEp++;
        // Sample value
        const u = rng();
        let idx = N - 1;
        for (let j = 0; j < N; j++) {
          if (u < cum[j]) {
            idx = j;
            break;
          }
        }
        payoutThisEp += outcomes[idx].valueX;
        if (idx === maxValueIdx) maxCountThisEp++;
      }
    }
    totalCoins += coinsThisEp;
    totalPayout += payoutThisEp;
    totalPayoutSq += payoutThisEp * payoutThisEp;
    totalMaxValueCount += maxCountThisEp;
  }

  const meanY = totalPayout / episodes;
  const variance = Math.max(0, totalPayoutSq / episodes - meanY * meanY);

  return {
    episodes,
    totalCoins,
    totalPayoutX: totalPayout,
    observedMeanCoins: totalCoins / episodes,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: variance,
    observedMaxValueCount: totalMaxValueCount,
  };
}
