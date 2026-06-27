/**
 * W152 Wave 107 — Pick Bonus N-Stage Tree (Faza 4.6 ext).
 *
 * Closed-form solver za "multi-stage pick bonus" mehaniku — NetEnt
 * classic / Microgaming "pick til pop" / Play'n GO style features
 * gde igrač prolazi kroz L stage-ova, sa per-stage outcomes:
 *   advance (idi na sledeći stage), collect_v_i (uzmi payout, end),
 *   end (terminate sa 0).
 *
 * Naming policy (clean-room): "pick bonus", "stage tree" = generic
 * industry terms. No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Stages 1..L (1-indexed for clarity).
 * Per stage i, outcome probabilities (must sum to 1):
 *   p_advance_i  : advance to stage i+1
 *   p_collect_i  : collect payout v_i (terminate)
 *   p_end_i      : terminate with 0 (no payout)
 *
 * Final stage L: p_advance_L = 0 (no further stage).
 *
 * Game starts at stage 1. Terminates at first "collect" or "end".
 *
 * Reach probability:
 *   P(reach stage i) = Π_{j=1..i-1} p_advance_j     (P(reach 1) = 1)
 *
 * Collect probability per stage:
 *   P(collect at stage i) = P(reach i) · p_collect_i
 *
 * Total expected payout:
 *   E[Y] = Σ_{i=1..L} P(collect at i) · v_i
 *
 * Variance:
 *   E[Y²] = Σ_{i=1..L} P(collect at i) · v_i²
 *   Var[Y] = E[Y²] − E[Y]²
 *
 * Tail probabilities:
 *   P(reach top stage)  = P(reach L)
 *   P(collect anywhere) = Σ P(collect at i)
 *   P(end with 0)       = 1 − P(collect anywhere)
 *
 * Per-base-spin contribution (optional):
 *   E[bonus payout per base spin] = q_trigger · E[Y]
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulatePickBonusNStageTree() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface PickStageConfig {
  /** Stage display label (e.g. 'tier_1', 'tier_2', 'grand'). */
  label: string;
  /** Probability of advancing to next stage (0 ≤ p ≤ 1). */
  advanceProbability: number;
  /** Probability of collecting payout (end with v_i). */
  collectProbability: number;
  /** Payout value if collect at this stage. */
  collectPayoutX: number;
}

export interface PickBonusNStageConfig {
  /** Stage sequence (length L ≥ 1). Final stage must have advance=0. */
  stages: PickStageConfig[];
  /** (Optional) Per-base-spin probability that the bonus is triggered. */
  baseTriggerProbabilityPerSpin?: number;
}

export interface PickBonusNStageResult {
  // Per-stage reach + collect probabilities
  reachProbabilities: number[];
  collectProbabilities: number[];
  // Total expected payout statistics
  expectedPayoutX: number;
  variancePayoutX: number;
  stdPayoutX: number;
  // Tail
  probReachTopStage: number;
  probCollectAnywhere: number;
  probEndWithZero: number;
  // Max payout reference
  maxPayoutX: number;
  // Per-base-spin
  expectedFeaturePayoutPerBaseSpin: number | null;
}

export interface PickBonusNStageMCResult {
  episodes: number;
  totalPayoutX: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
  observedReachHistogram: number[];
  observedCollectHistogram: number[];
  observedEndCount: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: PickBonusNStageConfig): void {
  if (!Array.isArray(cfg.stages) || cfg.stages.length === 0) {
    throw new Error(`stages must be non-empty`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < cfg.stages.length; i++) {
    const s = cfg.stages[i];
    if (typeof s.label !== 'string' || s.label.length === 0) {
      throw new Error(`stage label must be non-empty`);
    }
    if (seen.has(s.label)) throw new Error(`duplicate stage label: ${s.label}`);
    seen.add(s.label);
    const a = s.advanceProbability;
    const c = s.collectProbability;
    if (!Number.isFinite(a) || a < 0 || a > 1) {
      throw new Error(`stage ${s.label}: advanceProbability must be in [0, 1]`);
    }
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new Error(`stage ${s.label}: collectProbability must be in [0, 1]`);
    }
    if (!Number.isFinite(s.collectPayoutX) || s.collectPayoutX < 0) {
      throw new Error(`stage ${s.label}: collectPayoutX must be ≥ 0`);
    }
    if (a + c > 1 + 1e-9) {
      throw new Error(`stage ${s.label}: advance + collect probabilities > 1 (got ${a + c})`);
    }
    // Final stage must have advance = 0
    if (i === cfg.stages.length - 1 && a > 1e-9) {
      throw new Error(`final stage ${s.label}: advanceProbability must be 0 (no further stage)`);
    }
  }
  if (cfg.baseTriggerProbabilityPerSpin !== undefined) {
    const q = cfg.baseTriggerProbabilityPerSpin;
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      throw new Error(`baseTriggerProbabilityPerSpin must be in [0, 1]`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solvePickBonusNStageTree(
  config: PickBonusNStageConfig,
): PickBonusNStageResult {
  validate(config);
  const L = config.stages.length;
  const reach: number[] = new Array<number>(L).fill(0);
  const collect: number[] = new Array<number>(L).fill(0);

  reach[0] = 1; // always reach stage 1
  for (let i = 0; i < L; i++) {
    collect[i] = reach[i] * config.stages[i].collectProbability;
    if (i + 1 < L) {
      reach[i + 1] = reach[i] * config.stages[i].advanceProbability;
    }
  }

  // Compute payout moments
  let eY = 0;
  let eY2 = 0;
  let maxV = 0;
  for (let i = 0; i < L; i++) {
    const v = config.stages[i].collectPayoutX;
    eY += collect[i] * v;
    eY2 += collect[i] * v * v;
    if (v > maxV) maxV = v;
  }
  const varY = Math.max(0, eY2 - eY * eY);
  const stdY = Math.sqrt(varY);

  const probTop = reach[L - 1];
  const probCollect = collect.reduce((a, b) => a + b, 0);
  const probEnd = 1 - probCollect;

  const q = config.baseTriggerProbabilityPerSpin;
  const featurePerBase = q !== undefined ? q * eY : null;

  return {
    reachProbabilities: reach,
    collectProbabilities: collect,
    expectedPayoutX: eY,
    variancePayoutX: varY,
    stdPayoutX: stdY,
    probReachTopStage: probTop,
    probCollectAnywhere: probCollect,
    probEndWithZero: probEnd,
    maxPayoutX: maxV,
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

export function simulatePickBonusNStageTree(
  config: PickBonusNStageConfig,
  episodes: number,
  seed: number,
): PickBonusNStageMCResult {
  validate(config);
  const rng = makePrng(seed);
  const L = config.stages.length;
  const reachHist: number[] = new Array<number>(L).fill(0);
  const collectHist: number[] = new Array<number>(L).fill(0);
  let endCount = 0;
  let totalPayout = 0;
  let totalPayoutSq = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let payout = 0;
    let collected = false;
    let ended = false;
    for (let i = 0; i < L; i++) {
      reachHist[i]++;
      const u = rng();
      const a = config.stages[i].advanceProbability;
      const c = config.stages[i].collectProbability;
      if (u < c) {
        // Collect
        payout = config.stages[i].collectPayoutX;
        collectHist[i]++;
        collected = true;
        break;
      }
      if (u < c + a) {
        // Advance
        continue;
      }
      // End with 0
      ended = true;
      break;
    }
    if (!collected && !ended) {
      // Reached final stage with neither collect nor end — shouldn't happen
      // because final stage has advance=0, so all probability must go to collect+end
      endCount++;
    } else if (ended) {
      endCount++;
    }
    totalPayout += payout;
    totalPayoutSq += payout * payout;
  }

  const meanY = totalPayout / episodes;
  const variance = Math.max(0, totalPayoutSq / episodes - meanY * meanY);

  return {
    episodes,
    totalPayoutX: totalPayout,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: variance,
    observedReachHistogram: reachHist.map((c) => c / episodes),
    observedCollectHistogram: collectHist.map((c) => c / episodes),
    observedEndCount: endCount,
  };
}
