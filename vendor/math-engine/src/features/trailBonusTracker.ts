/**
 * W152 Wave 144 — Trail/Board Bonus Progression Tracker (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "trail/board bonus sequential progression" mehaniku —
 * Konami Stairway to Heaven / IGT Wheel of Fortune Multi-Tier Trail /
 * Microgaming Lord of the Rings: Return of the King trail / Inspired
 * "ladder climb" series / Bally Quick Hit Cash trail / IGT Mystical
 * Mermaid trail bonus.
 *
 * Naming policy (clean-room): "trail", "board progression", "step-based
 * bonus", "position reward" = generic industry terms. No vendor TM.
 *
 * ── Difference vs prior Wxx solvers ───────────────────────────────────────
 *   • W101 Symbol Upgrade Chain Markov — count-based upgrades; ovaj solver
 *     STEP-based linear advance sa per-position reward
 *   • W105 Bonus Wheel + Respin Markov — single wheel spin sa stationary
 *     segment distribution; trail je MULTI-STEP advance sa terminal end
 *   • W107 Pick Bonus N-Stage Tree — tree branching; trail je LINEAR
 *     advance sa fixed end position
 *   • W118 Bonus Collect-N — collect-N threshold count; trail je position-
 *     state with termination at endPosition ili bustPosition
 *   • W134 Hold-and-Win Value Jackpot — grid filling; trail je 1-D advance
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Linear trail of N+1 positions {0, 1, ..., N}. Player starts at position 0.
 * Per pick (max `maxPicks`), advance by step Δ ~ stepPmf (Δ ≥ 1).
 *   - If new position ≥ N (endPosition): reach end, award endBonusX, terminate
 *   - If new position is in `bustPositions`: bust, terminate WITHOUT reward
 *   - Else: collect positionRewardX[new position], continue
 *
 * Closed-form via DP over (position, picksRemaining):
 *   - State value V(p, r) = E[total reward | starting at position p with r picks]
 *   - Transitions: per step Δ → new position p' = min(p + Δ, N)
 *   - If p' = N: V = endBonusX
 *   - If p' ∈ bustPositions: V = 0
 *   - Else: V = positionRewardX[p'] + V(p', r-1)
 *   - Boundary r=0: V = 0 (no more picks → terminate without reaching end)
 *
 * Probability of reaching end:
 *   P_reach(p, r) = Σ_Δ stepPmf[Δ] · [Δ ≥ N - p ? 1 : (p+Δ ∈ bustPositions ? 0 : P_reach(p+Δ, r-1))]
 *
 * Probability of busting (terminating without end):
 *   P_bust(p, r) = Σ_Δ stepPmf[Δ] · [p+Δ ∈ bustPositions ? 1 : (Δ ≥ N - p ? 0 : P_bust(p+Δ, r-1))]
 *
 * Probability of timeout (run out of picks without end or bust):
 *   P_timeout = 1 − P_reach − P_bust
 *
 * Variance via second moment:
 *   E[Y²(p, r)] computed in same DP pass.
 *   Var[Y] = E[Y²] − E[Y]²
 *
 * ── Compliance ────────────────────────────────────────────────────────────
 *   • UKGC RTS 14 — trail progression disclosure (step distribution + bust
 *     positions visibility)
 *   • MGA PPD §11.f — operator-facing bonus-game rule transparency
 *   • eCOGRA Generic Bonus Audit — verifies trail math matches engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateTrailBonusTracker() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface TrailStepPmfEntry {
  /** Step size (positive integer, ≥ 1). */
  step: number;
  /** Probability of this step size (in [0, 1]). */
  probability: number;
}

export interface TrailBonusTrackerConfig {
  /** Trail length: positions 0..N (end at N). */
  trailLength: number;
  /** Maximum picks allowed before timeout. */
  maxPicks: number;
  /** Step size PMF. Probabilities must sum to 1. */
  stepPmf: TrailStepPmfEntry[];
  /** Per-position cumulative reward (length = trailLength + 1; positionRewardX[0] ignored). */
  positionRewardX: number[];
  /** Bonus paid for reaching end position. */
  endBonusX: number;
  /** Positions that cause "bust" (terminate without reward). */
  bustPositions?: number[];
}

export interface TrailBonusTrackerResult {
  trailLength: number;
  maxPicks: number;
  expectedTotalRewardX: number;
  varianceTotalRewardX: number;
  probReachEnd: number;
  probBust: number;
  probTimeout: number;
  expectedFinalPosition: number;
  expectedPicksUsed: number;
}

export interface TrailBonusTrackerMcResult {
  episodes: number;
  observedMeanTotalRewardX: number;
  observedReachEndFraction: number;
  observedBustFraction: number;
  observedTimeoutFraction: number;
  observedMeanFinalPosition: number;
  observedMeanPicksUsed: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateConfig(cfg: TrailBonusTrackerConfig): void {
  if (!Number.isInteger(cfg.trailLength) || cfg.trailLength < 2) {
    throw new Error(`trailLength must be integer ≥ 2 (got ${cfg.trailLength})`);
  }
  if (!Number.isInteger(cfg.maxPicks) || cfg.maxPicks < 1) {
    throw new Error(`maxPicks must be positive integer (got ${cfg.maxPicks})`);
  }
  if (!Array.isArray(cfg.stepPmf) || cfg.stepPmf.length === 0) {
    throw new Error('stepPmf must be non-empty array');
  }
  let sumP = 0;
  for (const e of cfg.stepPmf) {
    if (!Number.isInteger(e.step) || e.step < 1) {
      throw new Error(`stepPmf step must be positive integer (got ${e.step})`);
    }
    if (!(e.probability >= 0 && e.probability <= 1)) {
      throw new Error(`stepPmf probability must be in [0, 1] (got ${e.probability})`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`stepPmf probabilities must sum to 1 (got ${sumP})`);
  }
  if (!Array.isArray(cfg.positionRewardX) || cfg.positionRewardX.length !== cfg.trailLength + 1) {
    throw new Error(`positionRewardX must have length ${cfg.trailLength + 1}`);
  }
  for (const v of cfg.positionRewardX) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`positionRewardX entries must be finite non-negative (got ${v})`);
    }
  }
  if (!Number.isFinite(cfg.endBonusX) || cfg.endBonusX < 0) {
    throw new Error(`endBonusX must be finite non-negative (got ${cfg.endBonusX})`);
  }
  if (cfg.bustPositions !== undefined) {
    if (!Array.isArray(cfg.bustPositions)) {
      throw new Error('bustPositions must be array');
    }
    for (const p of cfg.bustPositions) {
      if (!Number.isInteger(p) || p < 1 || p >= cfg.trailLength) {
        throw new Error(`bustPosition must be integer in [1, ${cfg.trailLength - 1}] (got ${p})`);
      }
    }
  }
}

// ── Closed-form solver ──────────────────────────────────────────────────────

interface DpEntry {
  expectedReward: number;
  expectedRewardSq: number;
  probReachEnd: number;
  probBust: number;
  expectedFinalPosition: number;
  expectedPicksUsed: number;
}

export function solveTrailBonusTracker(cfg: TrailBonusTrackerConfig): TrailBonusTrackerResult {
  validateConfig(cfg);
  const N = cfg.trailLength;
  const R = cfg.maxPicks;
  const bustSet = new Set(cfg.bustPositions ?? []);

  // dp[p][r] computed via top-down (we'll use bottom-up DP).
  // Allocate (N+1) × (R+1) array of DpEntry.
  const dp: DpEntry[][] = Array.from({ length: N + 1 }, () =>
    Array.from({ length: R + 1 }, () => ({
      expectedReward: 0,
      expectedRewardSq: 0,
      probReachEnd: 0,
      probBust: 0,
      expectedFinalPosition: 0,
      expectedPicksUsed: 0,
    })),
  );

  // Boundary: r=0 → no more picks, V=0, position=p, picks=R-r=R
  for (let p = 0; p <= N; p++) {
    dp[p][0] = {
      expectedReward: 0,
      expectedRewardSq: 0,
      probReachEnd: p >= N ? 1 : 0,
      probBust: 0,
      expectedFinalPosition: p,
      expectedPicksUsed: 0,
    };
  }
  // Boundary: p=N → already at end (handled in transitions)
  for (let r = 0; r <= R; r++) {
    dp[N][r] = {
      expectedReward: 0, // Position N reward will be cfg.endBonusX added at transition site
      expectedRewardSq: 0,
      probReachEnd: 1,
      probBust: 0,
      expectedFinalPosition: N,
      expectedPicksUsed: 0,
    };
  }

  // Fill dp[p][r] for p < N, r ≥ 1.
  for (let r = 1; r <= R; r++) {
    for (let p = N - 1; p >= 0; p--) {
      let eR = 0;
      let eR2 = 0;
      let pEnd = 0;
      let pBust = 0;
      let eFinalPos = 0;
      let ePicksUsed = 0;

      for (const stepE of cfg.stepPmf) {
        const probStep = stepE.probability;
        if (probStep === 0) continue;
        const pNew = Math.min(p + stepE.step, N);

        if (pNew >= N) {
          // Reach end → award endBonusX + cumulative rewards up to here
          // For this transition we award endBonusX immediately
          const reward = cfg.endBonusX;
          eR += probStep * reward;
          eR2 += probStep * reward * reward;
          pEnd += probStep;
          eFinalPos += probStep * N;
          ePicksUsed += probStep * 1; // this pick consumed
        } else if (bustSet.has(pNew)) {
          // Bust → no reward, terminate
          pBust += probStep;
          eFinalPos += probStep * pNew;
          ePicksUsed += probStep * 1;
        } else {
          // Normal advance → collect positionReward + continue from (pNew, r-1)
          const stepReward = cfg.positionRewardX[pNew];
          const sub = dp[pNew][r - 1];
          // E[Y | advance] = stepReward + sub.expectedReward
          // E[Y² | advance] = (stepReward)² + 2·stepReward·sub.E[Y] + sub.E[Y²]
          const meanCond = stepReward + sub.expectedReward;
          const sqCond = stepReward * stepReward + 2 * stepReward * sub.expectedReward + sub.expectedRewardSq;
          eR += probStep * meanCond;
          eR2 += probStep * sqCond;
          pEnd += probStep * sub.probReachEnd;
          pBust += probStep * sub.probBust;
          eFinalPos += probStep * sub.expectedFinalPosition;
          ePicksUsed += probStep * (1 + sub.expectedPicksUsed);
        }
      }

      dp[p][r] = {
        expectedReward: eR,
        expectedRewardSq: eR2,
        probReachEnd: pEnd,
        probBust: pBust,
        expectedFinalPosition: eFinalPos,
        expectedPicksUsed: ePicksUsed,
      };
    }
  }

  const root = dp[0][R];
  const variance = Math.max(0, root.expectedRewardSq - root.expectedReward * root.expectedReward);

  return {
    trailLength: N,
    maxPicks: R,
    expectedTotalRewardX: root.expectedReward,
    varianceTotalRewardX: variance,
    probReachEnd: root.probReachEnd,
    probBust: root.probBust,
    probTimeout: Math.max(0, 1 - root.probReachEnd - root.probBust),
    expectedFinalPosition: root.expectedFinalPosition,
    expectedPicksUsed: root.expectedPicksUsed,
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

function sampleStep(pmf: TrailStepPmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.step;
  }
  return pmf[pmf.length - 1].step;
}

export function simulateTrailBonusTracker(
  cfg: TrailBonusTrackerConfig,
  episodes: number,
  seed: number,
): TrailBonusTrackerMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 1) {
    throw new Error(`episodes must be positive integer (got ${episodes})`);
  }
  const rng = mulberry32(seed);
  const N = cfg.trailLength;
  const R = cfg.maxPicks;
  const bustSet = new Set(cfg.bustPositions ?? []);

  let totalReward = 0;
  let totalReachEnd = 0;
  let totalBust = 0;
  let totalTimeout = 0;
  let totalFinalPos = 0;
  let totalPicksUsed = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let pos = 0;
    let picks = 0;
    let reward = 0;
    let reachEnd = false;
    let bust = false;

    while (picks < R) {
      picks += 1;
      const delta = sampleStep(cfg.stepPmf, rng());
      const newPos = Math.min(pos + delta, N);
      if (newPos >= N) {
        reward += cfg.endBonusX;
        pos = N;
        reachEnd = true;
        break;
      }
      if (bustSet.has(newPos)) {
        pos = newPos;
        bust = true;
        break;
      }
      // Normal advance
      reward += cfg.positionRewardX[newPos];
      pos = newPos;
    }

    totalReward += reward;
    if (reachEnd) totalReachEnd += 1;
    else if (bust) totalBust += 1;
    else totalTimeout += 1;
    totalFinalPos += pos;
    totalPicksUsed += picks;
  }

  return {
    episodes,
    observedMeanTotalRewardX: totalReward / episodes,
    observedReachEndFraction: totalReachEnd / episodes,
    observedBustFraction: totalBust / episodes,
    observedTimeoutFraction: totalTimeout / episodes,
    observedMeanFinalPosition: totalFinalPos / episodes,
    observedMeanPicksUsed: totalPicksUsed / episodes,
  };
}
