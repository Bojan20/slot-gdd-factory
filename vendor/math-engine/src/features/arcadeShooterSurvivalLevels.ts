/**
 * W152 Wave 194 — Arcade-Shooter Survival Level Progression Aggregator (75. solver).
 *
 * **L&W M16 P1 GAP CLOSURE** — covers Lightning Box Stellar Jackpots wrapper
 * (Thundering Bison + Thundering Buffalo + Thundering Gorilla + Chicken Fox
 * + Astro Pug Stellar Jackpots + Lightning Horseman + 4+ stellar variants).
 *
 * Iconic arcade-shooter side bonus mehanika:
 *   * LNW Lightning Box Stellar Jackpots wrapper (random-trigger arcade-shooter
 *     mini-game over 6 challenge levels — each level survival Bernoulli, fail
 *     ends run; reach final → jackpot prize)
 *   * Thundering Bison / Thundering Buffalo / Thundering Gorilla (2018-2024)
 *   * Chicken Fox (2018) sa Stellar Jackpots side bonus
 *   * Lightning Horseman + 4+ Astro family titles
 *
 * **75th closed-form solver.** First kernel modeling **sequential survival
 * chain sa per-level Bernoulli pass + per-level reward + terminal jackpot
 * payout** — distinct od existing FS retrigger / cascade / bonus tree.
 *
 * ── Math (Sequential Survival Markov Chain sa Absorbing States) ────────────
 *
 * L levels (1..L). Per level i:
 *   - **p_i = P(pass level i | reached level i)** ∈ (0, 1]
 *   - **V_i = per-level reward** if passed (× bet, ≥ 0)
 *
 * Plus jackpot rewards on terminal-pass (reaching final level + winning):
 *   - **J_k = jackpot tier k** (mini, minor, major, grand) sa per-tier prob
 *     π_k, μ_J_k, σ²_J_k.
 *
 * **Survival probabilities** (chain rule):
 *
 *   S_k = P(reach level k) = ∏_{i=1..k-1} p_i      (k = 1, 2, ..., L+1)
 *   S_1 = 1, S_{L+1} = ∏_{i=1..L} p_i = P(complete run)
 *
 * **Pass-level distribution** (per-level "stop here" probabilities):
 *
 *   P(exit at level k) = P(reached level k but did NOT pass it)
 *                     = S_k · (1 − p_k)  for k = 1..L (early exit)
 *   P(complete) = S_{L+1}
 *   Σ P(exit at k) + P(complete) = 1 (sanity)
 *
 * **Expected per-level rewards collected**:
 *
 *   E[level rewards] = Σ_{k=1..L} S_{k+1} · V_k  (level k contributes
 *                                                 V_k iff player PASSES level k,
 *                                                 i.e. reaches level k+1)
 *
 * **Expected jackpot payout** (on complete):
 *
 *   E[jackpot] = S_{L+1} · Σ_k π_k · μ_J_k
 *   Var[jackpot] (within complete) = Σ_k π_k · (σ²_J_k + μ²_J_k) − (Σ_k π_k·μ_J_k)²
 *
 * **Total run payout** Y = Σ V_k·𝟙{pass k} + J·𝟙{complete}:
 *
 *   **E[Y per run] = Σ S_{k+1}·V_k + S_{L+1}·μ_J**
 *
 * where μ_J = Σ π_k · μ_J_k (jackpot mixture mean).
 *
 * Var[Y] via "Σ correlated Bernoulli" + jackpot mixture is non-trivial;
 * delivered via second-moment computation:
 *
 *   E[Y²] = Σ Σ S_{max(j,k)+1} · V_j · V_k                       [pairwise level cov]
 *          + 2·S_{L+1} · μ_J · (Σ V_k)                           [level × jackpot]
 *          + S_{L+1} · E[J²]                                     [jackpot self]
 *   Var[Y] = E[Y²] − E[Y]²
 *
 * **Disclosure metrics**:
 *   - perLevel.survivalProbReached = S_k
 *   - perLevel.survivalProbPassed = S_{k+1}
 *   - perLevel.exitProb = S_k · (1−p_k)
 *   - probabilityCompleteRun = S_{L+1}
 *   - expectedLevelReached = Σ k · P(exit at k) + (L+1) · S_{L+1}
 *   - oneInNRunsToComplete = 1 / S_{L+1}
 *   - jackpotMean = Σ π_k · μ_J_k
 *   - jackpotShareOfRtp = (S_{L+1} · μ_J) / E[Y per run]
 *   - probabilityGrandJackpot = S_{L+1} · π_grand (top-tier disclosure)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────
 *   - **P-024 (W107) Pick Bonus N-Stage Tree** — pick-stages bez sequential
 *     survival product; ovde **multiplicative ∏ p_i chain** w/ early-exit
 *     gating.
 *   - **P-090 (W189) Random Feature-Injection FS** — per-spin Bernoulli;
 *     ovde **sequential level chain**.
 *   - **P-091 (W190) Nested Mini-Slot** — single-level nested per outer-spin;
 *     ovde multi-level survival.
 *   - **P-094 (W193) Multi-Pot Branched** — categorical sub-mode mixture (one
 *     winner); ovde sequential chain (Bernoulli per stage).
 *   - **P-064 (W144) Trail Bonus Tracker** — meter-based trail; ovde
 *     **probabilistic survival** at each level (Bernoulli vs meter).
 *   - **P-046 (W118) Bonus Wheel Respin** — multi-wheel Markov; ovde
 *     **monotone forward** chain w/ absorbing failure.
 *
 * Compliance:
 *   - **UKGC RTS-14** mandatory per-stage probability disclosure
 *   - **MGA PPD §11** sequential-stage transparency
 *   - **eCOGRA** per-stage audit trail (level-by-level CDF)
 *   - **EU GA 2024** cross-jurisdiction baseline
 *
 * Naming: "level progression", "survival chain", "arcade-shooter", "stage"
 * = generic slot-design + game-design terms. No vendor TM.
 */

/** ── Per-level config ─────────────────────────────────────────────────────── */
export interface LevelConfig {
  /** Optional level label (audit trail only). */
  label?: string;
  /** Bernoulli pass probability ∈ (0, 1]. */
  probPass: number;
  /** Reward × bet ≥ 0 if level passed. */
  reward: number;
}

/** ── Per-jackpot-tier config ──────────────────────────────────────────────── */
export interface ArcadeJackpotTierConfig {
  /** Optional tier label (mini/minor/major/grand). */
  label?: string;
  /** Selection weight (normalized to prob within complete-run). */
  selectionWeight: number;
  /** Jackpot mean payout (× bet, ≥ 0). */
  meanPayout: number;
  /** Jackpot payout variance ≥ 0. */
  variancePayout: number;
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface ArcadeShooterSurvivalLevelsConfig {
  /** Sequential levels (L ≥ 1). */
  levels: LevelConfig[];
  /** Jackpot tiers on complete-run (≥ 1). */
  jackpotTiers: ArcadeJackpotTierConfig[];
}

/** ── Per-level disclosure ─────────────────────────────────────────────────── */
export interface LevelDisclosure {
  index: number;
  label: string;
  probPass: number;
  reward: number;
  /** S_k = P(reach level k). */
  probReached: number;
  /** S_{k+1} = P(pass level k) = P(reach level k) · p_k. */
  probPassed: number;
  /** P(exit at level k) = S_k · (1 − p_k). */
  probExitAtLevel: number;
  /** Expected reward contribution = S_{k+1} · V_k. */
  expectedRewardContribution: number;
}

/** ── Per-tier disclosure ──────────────────────────────────────────────────── */
export interface JackpotTierDisclosure {
  index: number;
  label: string;
  /** π_k = w_k / Σ w_j. */
  selectionProbWithinComplete: number;
  meanPayout: number;
  variancePayout: number;
  /** Unconditional P(grand-stack hit) = S_{L+1} · π_k. */
  probabilityHitThisTier: number;
  /** oneInNRuns = 1 / (S_{L+1} · π_k). */
  oneInNRunsForTier: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface ArcadeShooterSurvivalLevelsResult {
  /** L (number of levels). */
  numLevels: number;
  /** K (number of jackpot tiers). */
  numJackpotTiers: number;
  /** Per-level disclosure rows. */
  perLevel: LevelDisclosure[];
  /** Per-tier disclosure rows. */
  perJackpotTier: JackpotTierDisclosure[];
  /** Σ S_{k+1}·V_k expected sum of per-level rewards. */
  expectedLevelRewards: number;
  /** S_{L+1} · μ_J expected jackpot contribution. */
  expectedJackpotContribution: number;
  /** E[Y per run] = level rewards + jackpot contribution. */
  expectedPayoutPerRun: number;
  /** Var[Y per run] via correlated-Bernoulli + jackpot mixture. */
  variancePayoutPerRun: number;
  /** Std dev per run. */
  stdDevPayoutPerRun: number;
  /** S_{L+1} = ∏ p_i (complete-run probability). */
  probabilityCompleteRun: number;
  /** Σ k·P(exit at k) + (L+1)·S_{L+1} (E[level reached]). */
  expectedLevelReached: number;
  /** 1 / S_{L+1} (Geometric expected runs to first complete). */
  oneInNRunsToComplete: number;
  /** Σ π_k·μ_J_k (mixture jackpot mean given complete). */
  jackpotMeanGivenComplete: number;
  /** Jackpot share of total RTP. */
  jackpotShareOfRtp: number;
  /** Unconditional probability of completing run AND hitting "grand"-tier
   *  (largest meanPayout tier). */
  probabilityGrandJackpot: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: ArcadeShooterSurvivalLevelsConfig): void {
  if (!Array.isArray(cfg.levels) || cfg.levels.length < 1) {
    throw new Error(`levels must be array of length ≥ 1, got ${cfg.levels?.length ?? 0}`);
  }
  for (let i = 0; i < cfg.levels.length; i++) {
    const lv = cfg.levels[i]!;
    if (!Number.isFinite(lv.probPass) || lv.probPass <= 0 || lv.probPass > 1) {
      throw new Error(`levels[${i}].probPass must be ∈ (0, 1], got ${lv.probPass}`);
    }
    if (!Number.isFinite(lv.reward) || lv.reward < 0) {
      throw new Error(`levels[${i}].reward must be ≥ 0, got ${lv.reward}`);
    }
  }
  if (!Array.isArray(cfg.jackpotTiers) || cfg.jackpotTiers.length < 1) {
    throw new Error(`jackpotTiers must be array of length ≥ 1, got ${cfg.jackpotTiers?.length ?? 0}`);
  }
  let sumW = 0;
  for (let k = 0; k < cfg.jackpotTiers.length; k++) {
    const t = cfg.jackpotTiers[k]!;
    if (!Number.isFinite(t.selectionWeight) || t.selectionWeight < 0) {
      throw new Error(`jackpotTiers[${k}].selectionWeight must be ≥ 0, got ${t.selectionWeight}`);
    }
    if (!Number.isFinite(t.meanPayout) || t.meanPayout < 0) {
      throw new Error(`jackpotTiers[${k}].meanPayout must be ≥ 0, got ${t.meanPayout}`);
    }
    if (!Number.isFinite(t.variancePayout) || t.variancePayout < 0) {
      throw new Error(`jackpotTiers[${k}].variancePayout must be ≥ 0, got ${t.variancePayout}`);
    }
    sumW += t.selectionWeight;
  }
  if (sumW <= 0) {
    throw new Error(`sum of jackpot tier weights must be > 0, got ${sumW}`);
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeArcadeShooterSurvivalLevels(
  cfg: ArcadeShooterSurvivalLevelsConfig,
): ArcadeShooterSurvivalLevelsResult {
  validate(cfg);

  const L = cfg.levels.length;
  const K = cfg.jackpotTiers.length;

  // S[k] = P(reach level k), k = 1..L+1 (1-indexed); store 0-indexed as reach[k] for level k+1
  // We compute reach[0]=1 (reach level 1 = start), reach[i] = reach[i-1] · p_i for i=1..L
  // → reach[L] = S_{L+1} = P(complete)
  const reach: number[] = new Array(L + 1);
  reach[0] = 1;
  for (let i = 1; i <= L; i++) {
    reach[i] = reach[i - 1]! * cfg.levels[i - 1]!.probPass;
  }
  const probabilityCompleteRun = reach[L]!;

  // Per-level disclosure
  const perLevel: LevelDisclosure[] = cfg.levels.map((lv, k0) => {
    const k = k0 + 1; // 1-indexed level
    const reachK = reach[k - 1]!;       // S_k
    const passK = reach[k]!;            // S_{k+1}
    const exitK = reachK * (1 - lv.probPass);
    return {
      index: k0,
      label: lv.label ?? `level_${k}`,
      probPass: lv.probPass,
      reward: lv.reward,
      probReached: reachK,
      probPassed: passK,
      probExitAtLevel: exitK,
      expectedRewardContribution: passK * lv.reward,
    };
  });

  // Expected level rewards: Σ S_{k+1} · V_k
  const expectedLevelRewards = perLevel.reduce((acc, lv) => acc + lv.expectedRewardContribution, 0);

  // Jackpot mixture
  const sumW = cfg.jackpotTiers.reduce((acc, t) => acc + t.selectionWeight, 0);
  const tierProbs = cfg.jackpotTiers.map((t) => t.selectionWeight / sumW);
  const jackpotMeanGivenComplete = cfg.jackpotTiers.reduce(
    (acc, t, k) => acc + tierProbs[k]! * t.meanPayout,
    0,
  );
  const jackpotEJ2GivenComplete = cfg.jackpotTiers.reduce(
    (acc, t, k) => acc + tierProbs[k]! * (t.variancePayout + t.meanPayout * t.meanPayout),
    0,
  );

  // Per-tier disclosure
  let bestTierIdx = 0;
  for (let k = 1; k < K; k++) {
    if (cfg.jackpotTiers[k]!.meanPayout > cfg.jackpotTiers[bestTierIdx]!.meanPayout) {
      bestTierIdx = k;
    }
  }
  const perJackpotTier: JackpotTierDisclosure[] = cfg.jackpotTiers.map((t, k) => {
    const probHit = probabilityCompleteRun * tierProbs[k]!;
    return {
      index: k,
      label: t.label ?? `tier_${k}`,
      selectionProbWithinComplete: tierProbs[k]!,
      meanPayout: t.meanPayout,
      variancePayout: t.variancePayout,
      probabilityHitThisTier: probHit,
      oneInNRunsForTier: probHit > 1e-15 ? 1 / probHit : Number.POSITIVE_INFINITY,
    };
  });
  const probabilityGrandJackpot = perJackpotTier[bestTierIdx]!.probabilityHitThisTier;

  const expectedJackpotContribution = probabilityCompleteRun * jackpotMeanGivenComplete;
  const expectedPayoutPerRun = expectedLevelRewards + expectedJackpotContribution;

  // Variance via E[Y²] computation:
  //   Y = X_levels + X_jackpot, where:
  //     X_levels = Σ_k V_k·𝟙{pass k}; pass k indicator = 𝟙{reach k+1} so P=S_{k+1}
  //     X_jackpot = J · 𝟙{complete} (j-mixture within complete)
  //
  //   Key insight: 𝟙{pass j} · 𝟙{pass k} = 𝟙{pass max(j,k)} (nested)
  //   So Cov: E[𝟙{pass j}·𝟙{pass k}] = S_{max(j,k)+1}
  //
  //   E[X_levels²] = Σ_j Σ_k V_j·V_k · S_{max(j,k)+1}
  //
  //   E[X_jackpot²] = S_{L+1} · E[J²] (where E[J²] = jackpotEJ2GivenComplete)
  //
  //   Cross term: 2·E[X_levels · X_jackpot] = 2·Σ_k V_k · E[𝟙{pass k}·𝟙{complete}·J]
  //   But 𝟙{complete} ⊆ 𝟙{pass k} (complete implies pass k for all k),
  //   so 𝟙{pass k}·𝟙{complete} = 𝟙{complete}, and J⊥𝟙{complete} given complete:
  //     → E[V_k · 𝟙{pass k}·𝟙{complete}·J] = V_k · S_{L+1} · μ_J
  //   Cross = 2 · S_{L+1} · μ_J · Σ V_k
  let eY2Levels = 0;
  for (let j = 0; j < L; j++) {
    for (let k = 0; k < L; k++) {
      const mx = Math.max(j, k);
      eY2Levels += cfg.levels[j]!.reward * cfg.levels[k]!.reward * reach[mx + 1]!;
    }
  }
  const sumV = cfg.levels.reduce((acc, lv) => acc + lv.reward, 0);
  const eY2Jackpot = probabilityCompleteRun * jackpotEJ2GivenComplete;
  const eY2Cross = 2 * probabilityCompleteRun * jackpotMeanGivenComplete * sumV;
  const eY2 = eY2Levels + eY2Jackpot + eY2Cross;
  const variancePayoutPerRun = Math.max(0, eY2 - expectedPayoutPerRun * expectedPayoutPerRun);
  const stdDevPayoutPerRun = Math.sqrt(variancePayoutPerRun);

  // E[level reached] = Σ k · P(exit at k) + (L+1)·S_{L+1}
  let expectedLevelReached = 0;
  for (let k = 1; k <= L; k++) {
    expectedLevelReached += k * perLevel[k - 1]!.probExitAtLevel;
  }
  expectedLevelReached += (L + 1) * probabilityCompleteRun;

  const oneInNRunsToComplete =
    probabilityCompleteRun > 1e-15 ? 1 / probabilityCompleteRun : Number.POSITIVE_INFINITY;

  const jackpotShareOfRtp =
    expectedPayoutPerRun > 1e-12 ? expectedJackpotContribution / expectedPayoutPerRun : 0;

  return {
    numLevels: L,
    numJackpotTiers: K,
    perLevel,
    perJackpotTier,
    expectedLevelRewards,
    expectedJackpotContribution,
    expectedPayoutPerRun,
    variancePayoutPerRun,
    stdDevPayoutPerRun,
    probabilityCompleteRun,
    expectedLevelReached,
    oneInNRunsToComplete,
    jackpotMeanGivenComplete,
    jackpotShareOfRtp,
    probabilityGrandJackpot,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveArcadeShooterSurvivalLevels = analyzeArcadeShooterSurvivalLevels;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateArcadeShooterSurvivalLevels(
  cfg: ArcadeShooterSurvivalLevelsConfig,
  numRuns: number,
  seed = 0xface0194,
): {
  meanPayoutPerRun: number;
  stdDevPayoutPerRun: number;
  observedCompleteRate: number;
  observedExpectedLevelReached: number;
  observedJackpotTierFreqs: number[];
} {
  validate(cfg);
  if (!Number.isInteger(numRuns) || numRuns < 1) {
    throw new Error(`numRuns must be integer ≥ 1, got ${numRuns}`);
  }

  const L = cfg.levels.length;
  const K = cfg.jackpotTiers.length;
  const sumW = cfg.jackpotTiers.reduce((acc, t) => acc + t.selectionWeight, 0);
  const tierCdf: number[] = [];
  let cum = 0;
  for (const t of cfg.jackpotTiers) {
    cum += t.selectionWeight / sumW;
    tierCdf.push(cum);
  }
  tierCdf[K - 1] = 1;

  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return (z >>> 0) / 4294967296;
  };
  const gaussian = (mu: number, sigma: number): number => {
    if (sigma <= 0) return mu;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
  };
  const sampleTier = (): number => {
    const u = rng();
    for (let k = 0; k < K; k++) {
      if (u <= tierCdf[k]!) return k;
    }
    return K - 1;
  };

  let sumY = 0;
  let sumY2 = 0;
  let completeCount = 0;
  let sumLevelReached = 0;
  const tierCounts = new Array<number>(K).fill(0);

  for (let r = 0; r < numRuns; r++) {
    let y = 0;
    let lvReached = 1;
    let complete = true;
    for (let i = 0; i < L; i++) {
      lvReached = i + 1;
      if (rng() < cfg.levels[i]!.probPass) {
        y += cfg.levels[i]!.reward;
      } else {
        complete = false;
        break;
      }
    }
    if (complete) {
      lvReached = L + 1;
      completeCount++;
      const tierIdx = sampleTier();
      tierCounts[tierIdx]!++;
      const tier = cfg.jackpotTiers[tierIdx]!;
      const sig = Math.sqrt(tier.variancePayout);
      y += Math.max(0, gaussian(tier.meanPayout, sig));
    }
    sumY += y;
    sumY2 += y * y;
    sumLevelReached += lvReached;
  }

  const meanY = sumY / numRuns;
  const varY = Math.max(0, sumY2 / numRuns - meanY * meanY);

  return {
    meanPayoutPerRun: meanY,
    stdDevPayoutPerRun: Math.sqrt(varY),
    observedCompleteRate: completeCount / numRuns,
    observedExpectedLevelReached: sumLevelReached / numRuns,
    observedJackpotTierFreqs: tierCounts.map((c) => (completeCount > 0 ? c / completeCount : 0)),
  };
}
