/**
 * W152 Wave 72 — Pseudo-Must-Hit + Level Progression (Faza 12 ⚠️→✅).
 *
 * Closes Faza 12 scenario "⚠️ Pseudo-must-hit + level progression".
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Pseudo-must-hit = progressive jackpot WITHOUT a hard cap, instead
 * uses an ESCALATING hazard rate as the pool grows. Trigger is
 * probabilistic per spin; probability approaches 1 as pool nears the
 * "soft cap" reference value, but never strictly forces trigger.
 *
 * Level progression = each trigger advances a "level" counter; per-level
 * payout multiplier (e.g. 1× → 2× → 5× → 25×) escalates the prize tier.
 *
 * Math: discrete-time hazard model + Markov chain over levels.
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Pseudo-must-hit" + "level progression" = generic industry terms.
 *   • No vendor-specific marks.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Hazard rate (per-spin trigger probability) is linear in pool fraction:
 *
 *   λ(pool) = λ_min + (λ_max − λ_min) × (pool − seed) / (softCap − seed)
 *
 *   clipped to [λ_min, λ_max] for pool < seed or pool > softCap.
 *
 * Per-spin: pool += c (contribution). Trigger fires with prob λ(pool).
 * On trigger: payout = pool × levelMultipliers[currentLevel]; pool resets
 * to seed; level advances (capped at maxLevel).
 *
 * Long-run analysis (steady state):
 *   For constant-rate λ ≈ λ_avg = (λ_min + λ_max)/2 (approximation),
 *   E[spins between triggers] = 1/λ_avg
 *   E[pool at trigger] = seed + c/λ_avg (renewal mean residual)
 *   E[payout per trigger] = E[pool] × E[levelMult]
 *   E[Y per spin] = λ_avg × E[pool] × E[levelMult]
 *
 * Level distribution converges to stationary (Markov chain on level):
 *   On trigger: level → min(level+1, maxLevel)
 *   With reset probability (e.g. softReset after maxLevel reached):
 *     Customize via `resetProbabilityAtMax`.
 *
 *   Stationary: π_L = (1-r)^L / Σ (1-r)^k   if reset rate = r at max
 *   Mean level = depends on chain structure.
 *
 * For simplicity, we provide:
 *   • solveSteadyState — long-run average payout per spin (approx)
 *   • simulatePseudoMustHit — MC reference
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface PseudoMustHitConfig {
  /** Pool seed value in X. */
  poolSeedX: number;
  /** Pool soft-cap reference (no hard ceiling — just hazard scaling). */
  poolSoftCapX: number;
  /** Per-spin contribution to pool in X. */
  contributionPerSpinX: number;
  /** Per-spin trigger probability at pool=seed (lower bound). */
  lambdaMin: number;
  /** Per-spin trigger probability at pool=softCap (upper bound). */
  lambdaMax: number;
  /** Per-level payout multipliers (length = maxLevel+1). */
  levelMultipliers: number[];
  /** Probability of level RESET to 0 after a trigger at max level. */
  resetProbabilityAtMax: number;
}

export interface PseudoMustHitResult {
  averageLambda: number;
  expectedSpinsBetweenTriggers: number;
  expectedPoolAtTrigger: number;
  /** Stationary distribution of levels (steady state). */
  levelStationaryDistribution: number[];
  expectedLevelMultiplier: number;
  expectedPayoutPerTrigger: number;
  expectedPayoutPerSpin: number;
}

export interface PseudoMustHitMCResult {
  spins: number;
  triggers: number;
  totalPayout: number;
  observedTriggersPerSpin: number;
  observedMeanPayoutPerTrigger: number;
  observedMeanPoolAtTrigger: number;
  observedLevelHistogram: number[];
  observedPayoutPerSpin: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: PseudoMustHitConfig): void {
  if (cfg.poolSeedX < 0) throw new Error(`poolSeedX must be ≥ 0`);
  if (cfg.poolSoftCapX <= cfg.poolSeedX) throw new Error(`poolSoftCapX must be > poolSeedX`);
  if (cfg.contributionPerSpinX <= 0) throw new Error(`contributionPerSpinX must be > 0`);
  if (cfg.lambdaMin < 0 || cfg.lambdaMin > 1) throw new Error(`lambdaMin must be in [0,1]`);
  if (cfg.lambdaMax <= cfg.lambdaMin || cfg.lambdaMax > 1) {
    throw new Error(`lambdaMax must be in (lambdaMin, 1]`);
  }
  if (!Array.isArray(cfg.levelMultipliers) || cfg.levelMultipliers.length === 0) {
    throw new Error(`levelMultipliers must be non-empty array`);
  }
  for (const m of cfg.levelMultipliers) {
    if (!Number.isFinite(m) || m < 0) throw new Error(`level multiplier must be ≥ 0`);
  }
  if (cfg.resetProbabilityAtMax < 0 || cfg.resetProbabilityAtMax > 1) {
    throw new Error(`resetProbabilityAtMax must be in [0,1]`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solvePseudoMustHit(config: PseudoMustHitConfig): PseudoMustHitResult {
  validate(config);
  const lambdaAvg = (config.lambdaMin + config.lambdaMax) / 2;
  const spinsBetween = 1 / lambdaAvg;
  const ePool = config.poolSeedX + config.contributionPerSpinX * spinsBetween;

  // Level Markov chain: states 0..maxLevel
  // On trigger at level L < maxLevel: L → L+1
  // On trigger at level maxLevel: L → 0 w.p. r, stay at maxLevel w.p. 1-r
  // Steady-state stationary distribution:
  const maxLevel = config.levelMultipliers.length - 1;
  const r = config.resetProbabilityAtMax;
  // For r > 0: chain is recurrent with stationary π
  //   Balance: π_L (L < maxL) = π_{L-1} for L > 0; π_0 = r × π_maxL
  //   This gives π_0 = π_1 = ... = π_{maxL-1}, and π_maxL = (1-r) × π_maxL + ... wait let me think
  //
  // Let's analyze. Transitions (on trigger):
  //   0 → 1, 1 → 2, ..., (maxL-1) → maxL, maxL → 0 w.p. r, maxL → maxL w.p. 1-r
  //
  // Stationary balance equations:
  //   π_0 = r π_maxL
  //   π_1 = π_0 = r π_maxL
  //   π_2 = π_1 = r π_maxL
  //   ...
  //   π_{maxL-1} = π_{maxL-2} = r π_maxL
  //   π_maxL = π_{maxL-1} + (1-r) π_maxL
  //   ⇒ r π_maxL = π_{maxL-1} = r π_maxL ✓ (consistent)
  //
  // So π_0 = π_1 = ... = π_{maxL-1} = r π_maxL.
  // Normalization: maxL × r π_maxL + π_maxL = 1
  //   π_maxL (1 + maxL × r) = 1
  //   π_maxL = 1 / (1 + maxL × r)
  //   π_i = r / (1 + maxL × r)  for i < maxL
  const piMaxL = 1 / (1 + maxLevel * r);
  const piOther = r * piMaxL;
  const levelPi: number[] = [];
  for (let i = 0; i <= maxLevel; i++) {
    levelPi.push(i === maxLevel ? piMaxL : piOther);
  }
  // Edge case: r = 0 → chain is absorbing at maxLevel
  if (r === 0) {
    for (let i = 0; i < maxLevel; i++) levelPi[i] = 0;
    levelPi[maxLevel] = 1;
  }

  // E[level mult] under stationary dist
  let eMult = 0;
  for (let i = 0; i <= maxLevel; i++) eMult += levelPi[i] * config.levelMultipliers[i];

  const ePayoutPerTrigger = ePool * eMult;
  const ePayoutPerSpin = lambdaAvg * ePayoutPerTrigger;

  return {
    averageLambda: lambdaAvg,
    expectedSpinsBetweenTriggers: spinsBetween,
    expectedPoolAtTrigger: ePool,
    levelStationaryDistribution: levelPi,
    expectedLevelMultiplier: eMult,
    expectedPayoutPerTrigger: ePayoutPerTrigger,
    expectedPayoutPerSpin: ePayoutPerSpin,
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

export function simulatePseudoMustHit(
  config: PseudoMustHitConfig,
  spins: number,
  seed: number,
): PseudoMustHitMCResult {
  validate(config);
  const rng = makePrng(seed);
  const maxLevel = config.levelMultipliers.length - 1;
  let pool = config.poolSeedX;
  let level = 0;
  let triggers = 0;
  let totalPayout = 0;
  let totalPoolAtTrigger = 0;
  const levelHist = new Array<number>(maxLevel + 1).fill(0);
  const span = config.poolSoftCapX - config.poolSeedX;
  for (let s = 0; s < spins; s++) {
    pool += config.contributionPerSpinX;
    // Compute hazard rate
    let frac = (pool - config.poolSeedX) / span;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    const lambda = config.lambdaMin + (config.lambdaMax - config.lambdaMin) * frac;
    if (rng() < lambda) {
      triggers++;
      const payout = pool * config.levelMultipliers[level];
      totalPayout += payout;
      totalPoolAtTrigger += pool;
      levelHist[level]++;
      // Advance level
      if (level < maxLevel) {
        level++;
      } else {
        if (rng() < config.resetProbabilityAtMax) level = 0;
      }
      pool = config.poolSeedX;
    }
  }
  return {
    spins,
    triggers,
    totalPayout,
    observedTriggersPerSpin: triggers / spins,
    observedMeanPayoutPerTrigger: triggers > 0 ? totalPayout / triggers : 0,
    observedMeanPoolAtTrigger: triggers > 0 ? totalPoolAtTrigger / triggers : 0,
    observedLevelHistogram: levelHist.map((c) => (triggers > 0 ? c / triggers : 0)),
    observedPayoutPerSpin: totalPayout / spins,
  };
}
