/**
 * W152 Wave 105 — Bonus Wheel + Respin Markov (Faza 4.6 ext).
 *
 * Closed-form solver za "wheel bonus sa respin segment" mehaniku —
 * NetEnt / Pragmatic / IGT wheel bonuses gde wheel ima N segments,
 * neki sa "respin" (vrati spin), ostali sa payout. Player nastavlja
 * dok ne pogodi non-respin segment.
 *
 * Naming policy (clean-room): "wheel bonus", "respin segment" =
 * generic industry terms. No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Wheel segments:
 *   Pay segments:    {p_i, v_i} for i=1..K  (probability p_i, payout v_i)
 *   Respin segments: probability p_respin total (sum across all respin slices)
 *
 * Constraint: Σ p_i + p_respin = 1
 *
 * Per spin: w.p. p_respin → respin; w.p. (1−p_respin) → terminate with payout V.
 *
 * Number of spins until terminate N ~ shifted-geometric (k ≥ 1):
 *   P(N = k) = p_respin^(k-1) · (1 − p_respin)
 *   E[N]   = 1 / (1 − p_respin)
 *   Var[N] = p_respin / (1 − p_respin)²
 *
 * Final payout V ~ pay segment distribution (renormalized):
 *   P(V = v_i | terminate) = p_i / (1 − p_respin)
 *   μ_V    = Σ p_i · v_i / (1 − p_respin)
 *   E[V²]  = Σ p_i · v_i² / (1 − p_respin)
 *   σ²_V   = E[V²] − μ²_V
 *
 * Final payout is independent of N (each respin draws independently).
 *
 * Tail probabilities:
 *   P(N ≥ k)         = p_respin^(k-1)
 *   P(2+ respins)    = p_respin^2
 *   E[V | hit max]   = max v_i across pay segments
 *
 * Per-base-spin contribution (optional):
 *   E[wheel payout per base spin] = q_trigger · μ_V
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateBonusWheelRespin() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface WheelPaySegment {
  /** Display label (e.g. 'cash_low', 'major', 'grand'). */
  label: string;
  /** Probability of landing on this segment (0 ≤ p ≤ 1). */
  probability: number;
  /** Payout value if this segment lands (bet multiplier). */
  payoutX: number;
}

export interface BonusWheelRespinConfig {
  /** Pay segments (non-respin). Σ probabilities + respinProbability must = 1. */
  paySegments: WheelPaySegment[];
  /** Total probability of respin segment(s). */
  respinProbability: number;
  /** (Optional) Per-base-spin probability that the wheel feature is triggered. */
  baseTriggerProbabilityPerSpin?: number;
}

export interface BonusWheelRespinResult {
  // Spin chain statistics
  expectedSpinsUntilTerminate: number;
  varianceSpinsUntilTerminate: number;
  // Final payout statistics (given terminate)
  expectedFinalPayoutX: number;
  varianceFinalPayoutX: number;
  stdFinalPayoutX: number;
  // Tail probabilities
  probAtLeastTwoSpins: number;
  probAtLeastFiveSpins: number;
  probAtLeastTenSpins: number;
  // Max payout reference
  maxPayoutX: number;
  probHitMax: number;
  // Per-base-spin contribution (optional)
  expectedFeaturePayoutPerBaseSpin: number | null;
}

export interface BonusWheelRespinMCResult {
  episodes: number;
  totalSpins: number;
  totalPayoutX: number;
  observedMeanSpins: number;
  observedMeanFinalPayoutX: number;
  observedVarianceFinalPayoutX: number;
  observedMaxSpinsObserved: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: BonusWheelRespinConfig): void {
  if (!Array.isArray(cfg.paySegments) || cfg.paySegments.length === 0) {
    throw new Error(`paySegments must be a non-empty array`);
  }
  if (
    !Number.isFinite(cfg.respinProbability) ||
    cfg.respinProbability < 0 ||
    cfg.respinProbability >= 1
  ) {
    throw new Error(`respinProbability must be in [0, 1)`);
  }
  const seen = new Set<string>();
  let sumP = cfg.respinProbability;
  for (const s of cfg.paySegments) {
    if (typeof s.label !== 'string' || s.label.length === 0) {
      throw new Error(`pay segment label must be non-empty`);
    }
    if (seen.has(s.label)) throw new Error(`duplicate pay segment label: ${s.label}`);
    seen.add(s.label);
    if (!Number.isFinite(s.probability) || s.probability < 0 || s.probability > 1) {
      throw new Error(`pay segment ${s.label}: probability must be in [0, 1]`);
    }
    if (!Number.isFinite(s.payoutX) || s.payoutX < 0) {
      throw new Error(`pay segment ${s.label}: payoutX must be ≥ 0`);
    }
    sumP += s.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`Σ probabilities (pay + respin) must = 1 (got ${sumP})`);
  }
  if (cfg.baseTriggerProbabilityPerSpin !== undefined) {
    const q = cfg.baseTriggerProbabilityPerSpin;
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      throw new Error(`baseTriggerProbabilityPerSpin must be in [0, 1]`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveBonusWheelRespin(
  config: BonusWheelRespinConfig,
): BonusWheelRespinResult {
  validate(config);
  const pRespin = config.respinProbability;
  const pTerm = 1 - pRespin;

  // Spin count moments (shifted-geometric)
  const eN = 1 / pTerm;
  const varN = pRespin / (pTerm * pTerm);

  // Final payout moments (conditional on terminate)
  let muV = 0;
  let eV2 = 0;
  let maxV = 0;
  let pMax = 0;
  for (const s of config.paySegments) {
    const cond = s.probability / pTerm;
    muV += cond * s.payoutX;
    eV2 += cond * s.payoutX * s.payoutX;
    if (s.payoutX > maxV) {
      maxV = s.payoutX;
      pMax = cond;
    } else if (s.payoutX === maxV) {
      pMax += cond;
    }
  }
  const varV = Math.max(0, eV2 - muV * muV);
  const stdV = Math.sqrt(varV);

  // Tail probabilities
  const prob2 = pRespin;             // P(N ≥ 2) = p_respin
  const prob5 = Math.pow(pRespin, 4); // P(N ≥ 5) = p_respin^4
  const prob10 = Math.pow(pRespin, 9); // P(N ≥ 10) = p_respin^9

  // Per-base-spin contribution
  const q = config.baseTriggerProbabilityPerSpin;
  const featurePerBase = q !== undefined ? q * muV : null;

  return {
    expectedSpinsUntilTerminate: eN,
    varianceSpinsUntilTerminate: varN,
    expectedFinalPayoutX: muV,
    varianceFinalPayoutX: varV,
    stdFinalPayoutX: stdV,
    probAtLeastTwoSpins: prob2,
    probAtLeastFiveSpins: prob5,
    probAtLeastTenSpins: prob10,
    maxPayoutX: maxV,
    probHitMax: pMax,
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

export function simulateBonusWheelRespin(
  config: BonusWheelRespinConfig,
  episodes: number,
  seed: number,
): BonusWheelRespinMCResult {
  validate(config);
  const rng = makePrng(seed);
  const pRespin = config.respinProbability;
  // Cumulative probabilities for pay segment sampling (conditional on terminate)
  const pTerm = 1 - pRespin;
  const cumCond: number[] = new Array<number>(config.paySegments.length);
  {
    let running = 0;
    for (let i = 0; i < config.paySegments.length; i++) {
      running += config.paySegments[i].probability / pTerm;
      cumCond[i] = running;
    }
    cumCond[cumCond.length - 1] = 1;
  }

  let totalSpins = 0;
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let maxSpinsObserved = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let spins = 0;
    let payout = 0;
    // Keep spinning until non-respin
    // eslint-disable-next-line no-constant-condition
    while (true) {
      spins++;
      const u = rng();
      if (u < pRespin) {
        continue; // respin, no payout, spin again
      }
      // Terminate: sample pay segment (conditional on non-respin)
      // Re-roll uniform for segment selection
      const u2 = rng();
      let idx = config.paySegments.length - 1;
      for (let i = 0; i < config.paySegments.length; i++) {
        if (u2 < cumCond[i]) {
          idx = i;
          break;
        }
      }
      payout = config.paySegments[idx].payoutX;
      break;
    }
    totalSpins += spins;
    totalPayout += payout;
    totalPayoutSq += payout * payout;
    if (spins > maxSpinsObserved) maxSpinsObserved = spins;
  }

  const meanPayout = totalPayout / episodes;
  const variance = Math.max(0, totalPayoutSq / episodes - meanPayout * meanPayout);

  return {
    episodes,
    totalSpins,
    totalPayoutX: totalPayout,
    observedMeanSpins: totalSpins / episodes,
    observedMeanFinalPayoutX: meanPayout,
    observedVarianceFinalPayoutX: variance,
    observedMaxSpinsObserved: maxSpinsObserved,
  };
}
