/**
 * W152 Wave 132 — Multi-Level Wild Tier Markov (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form 4-state Markov stationary solver za "tier wild promocija"
 * mehaniku — NetEnt Vikings Berzerk (basic → super) / Push Gaming Mount
 * Magmas (3-tier wild upgrade) / Pragmatic Da Vinci's Mystery / Quickspin
 * Sakura Fortune sa wild progression. Wild lands kao basic, has p_up1
 * probability to upgrade to super, super has p_up2 to mega.
 *
 * Naming policy (clean-room): "wild tier", "Markov upgrade" = generic
 * industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W101 Symbol Upgrade Chain Markov — sequential count-based (k upgrades),
 *     NOT probabilistic per-level transition
 *   • W114 Sticky Wild Countdown — deterministic countdown timer, 2-state
 *   • W47 Walking Wild — position movement
 *   • W93 Multiplicative Wild Stack — product of co-active wilds
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * 4-state Markov chain: {idle, basic, super, mega}
 *
 * Per-spin transitions:
 *   idle  → idle     sa (1 − p_land)
 *   idle  → basic    sa p_land
 *   basic → mega     sa (p_up1 · p_up2)    [chained upgrade]   ← optional, when chainUpgrades
 *   basic → super    sa p_up1 · (1 − p_up2)                    ← optional split
 *   basic → basic    sa (1 − p_up1 − p_expire)
 *   basic → idle     sa p_expire
 *   super → mega     sa p_up2
 *   super → super    sa (1 − p_up2 − p_expire)
 *   super → idle     sa p_expire
 *   mega  → idle     sa p_expire
 *   mega  → mega     sa (1 − p_expire)
 *
 * Simpler default (independent per-step upgrades, no chained):
 *   basic → super  sa p_up1, basic stays sa (1 − p_up1 − p_expire), expires sa p_expire
 *   super → mega   sa p_up2, super stays sa (1 − p_up2 − p_expire), expires sa p_expire
 *
 * Stationary distribution π_idle, π_basic, π_super, π_mega via
 * 4×4 transition matrix balance equations:
 *   π_idle  · (1 − p_land) + π_basic · p_expire + π_super · p_expire + π_mega · p_expire = π_idle
 *   π_idle  · p_land + π_basic · (1 − p_up1 − p_expire) = π_basic
 *   π_basic · p_up1 + π_super · (1 − p_up2 − p_expire) = π_super
 *   π_super · p_up2 + π_mega · (1 − p_expire) = π_mega
 *   π_idle + π_basic + π_super + π_mega = 1
 *
 * Solve via linear algebra (4 unknowns, 5 equations sa normalization).
 *
 * Per-state multiplier: M_basic, M_super, M_mega (mega ≥ super ≥ basic ≥ 1)
 *
 * Per-spin expected multiplier:
 *   E[M] = π_idle · 1 + π_basic · M_basic + π_super · M_super + π_mega · M_mega
 *
 * Per-spin payout (V ~ baseWinPmf iid sa M):
 *   E[Y] = E[V] · E[M]
 *   E[Y²] = E[V²] · E[M²]
 *   Var[Y] = E[Y²] − E[Y]²
 *
 * Industry compliance:
 *   • UKGC RTS 14 — wild-tier variance + max-multiplier disclosure
 *   • MGA PPD §11.f — tier-upgrade rate disclosure
 *   • eCOGRA Generic Slots Audit — verifies stationary E[M], E[Y] match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateMultiLevelWildMarkov() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface MultiLevelBaseWinPmfEntry {
  /** Win value per spin (in betX, ≥ 0). */
  value: number;
  /** Probability of this value (0 ≤ p ≤ 1). */
  probability: number;
}

export interface MultiLevelWildMarkovConfig {
  /** Probability wild lands per spin when idle (0 < p_land ≤ 1). */
  landProbability: number;
  /** Probability basic → super upgrade (per spin in basic state, 0 ≤ p_up1 ≤ 1). */
  upgradeProbabilityBasicToSuper: number;
  /** Probability super → mega upgrade (per spin in super state, 0 ≤ p_up2 ≤ 1). */
  upgradeProbabilitySuperToMega: number;
  /** Probability wild expires per spin (0 < p_expire ≤ 1). */
  expireProbability: number;
  /** Multiplier for basic wild (≥ 1). */
  basicMultiplier: number;
  /** Multiplier for super wild (≥ basic). */
  superMultiplier: number;
  /** Multiplier for mega wild (≥ super). */
  megaMultiplier: number;
  /** Win-value PMF (independent of wild state). */
  baseWinPmf: MultiLevelBaseWinPmfEntry[];
}

export interface MultiLevelWildMarkovResult {
  // Stationary distribution
  probIdle: number;
  probBasic: number;
  probSuper: number;
  probMega: number;
  // Active probability
  probAnyActive: number;
  // Per-state metrics
  expectedMultiplierPerSpin: number;
  expectedMultiplierSquaredPerSpin: number;
  varianceMultiplierPerSpin: number;
  maxMultiplier: number;
  // Win value moments
  expectedBaseWin: number;
  expectedBaseWinSquared: number;
  // Payout
  expectedPayoutPerSpin: number;
  expectedPayoutSquaredPerSpin: number;
  variancePayoutPerSpin: number;
  // Tier rates (relative within active)
  conditionalProbBasicGivenActive: number;
  conditionalProbSuperGivenActive: number;
  conditionalProbMegaGivenActive: number;
}

export interface MultiLevelWildMarkovMCResult {
  spins: number;
  observedFractionIdle: number;
  observedFractionBasic: number;
  observedFractionSuper: number;
  observedFractionMega: number;
  observedMeanMultiplierPerSpin: number;
  observedMeanPayoutPerSpin: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: MultiLevelWildMarkovConfig): void {
  if (!Number.isFinite(cfg.landProbability) || cfg.landProbability <= 0 || cfg.landProbability > 1) {
    throw new Error(`landProbability must be in (0, 1] (got ${cfg.landProbability})`);
  }
  for (const [k, v] of [
    ['upgradeProbabilityBasicToSuper', cfg.upgradeProbabilityBasicToSuper],
    ['upgradeProbabilitySuperToMega', cfg.upgradeProbabilitySuperToMega],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`${k} must be in [0, 1] (got ${v})`);
    }
  }
  if (!Number.isFinite(cfg.expireProbability) || cfg.expireProbability <= 0 || cfg.expireProbability > 1) {
    throw new Error(`expireProbability must be in (0, 1] (got ${cfg.expireProbability})`);
  }
  // Constraint: per-state transition sums ≤ 1 (basic: p_up1 + p_expire ≤ 1, etc.)
  if (cfg.upgradeProbabilityBasicToSuper + cfg.expireProbability > 1) {
    throw new Error(
      `upgradeProbabilityBasicToSuper + expireProbability must be ≤ 1 (got ${cfg.upgradeProbabilityBasicToSuper + cfg.expireProbability})`,
    );
  }
  if (cfg.upgradeProbabilitySuperToMega + cfg.expireProbability > 1) {
    throw new Error(
      `upgradeProbabilitySuperToMega + expireProbability must be ≤ 1 (got ${cfg.upgradeProbabilitySuperToMega + cfg.expireProbability})`,
    );
  }
  if (!Number.isFinite(cfg.basicMultiplier) || cfg.basicMultiplier < 1) {
    throw new Error(`basicMultiplier must be ≥ 1 (got ${cfg.basicMultiplier})`);
  }
  if (!Number.isFinite(cfg.superMultiplier) || cfg.superMultiplier < cfg.basicMultiplier) {
    throw new Error(`superMultiplier must be ≥ basicMultiplier`);
  }
  if (!Number.isFinite(cfg.megaMultiplier) || cfg.megaMultiplier < cfg.superMultiplier) {
    throw new Error(`megaMultiplier must be ≥ superMultiplier`);
  }
  if (!Array.isArray(cfg.baseWinPmf) || cfg.baseWinPmf.length === 0) {
    throw new Error(`baseWinPmf must be non-empty`);
  }
  let sumP = 0;
  for (const e of cfg.baseWinPmf) {
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`baseWinPmf.value must be ≥ 0`);
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`baseWinPmf.probability must be in [0, 1]`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`baseWinPmf probabilities sum to ${sumP}, must be 1`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveMultiLevelWildMarkov(
  config: MultiLevelWildMarkovConfig,
): MultiLevelWildMarkovResult {
  validate(config);
  const p_land = config.landProbability;
  const p_up1 = config.upgradeProbabilityBasicToSuper;
  const p_up2 = config.upgradeProbabilitySuperToMega;
  const p_exp = config.expireProbability;

  // Balance equations:
  // π_idle (1−p_land) + (π_basic + π_super + π_mega) · p_exp = π_idle
  //   → π_idle · p_land = (π_basic + π_super + π_mega) · p_exp
  // π_idle · p_land + π_basic · (1 − p_up1 − p_exp) = π_basic
  //   → π_idle · p_land = π_basic · (p_up1 + p_exp)
  // π_basic · p_up1 + π_super · (1 − p_up2 − p_exp) = π_super
  //   → π_basic · p_up1 = π_super · (p_up2 + p_exp)
  // π_super · p_up2 + π_mega · (1 − p_exp) = π_mega
  //   → π_super · p_up2 = π_mega · p_exp
  //
  // Chain:
  //   π_basic = π_idle · p_land / (p_up1 + p_exp)
  //   π_super = π_basic · p_up1 / (p_up2 + p_exp) = π_idle · p_land · p_up1 / [(p_up1+p_exp)(p_up2+p_exp)]
  //   π_mega  = π_super · p_up2 / p_exp = π_idle · p_land · p_up1 · p_up2 / [(p_up1+p_exp)(p_up2+p_exp)·p_exp]
  //
  // Normalize: π_idle (1 + ratios) = 1

  const r_basic = p_land / (p_up1 + p_exp);
  const r_super = (r_basic * p_up1) / (p_up2 + p_exp);
  const r_mega = (r_super * p_up2) / p_exp;
  const norm = 1 + r_basic + r_super + r_mega;

  const pi_idle = 1 / norm;
  const pi_basic = r_basic / norm;
  const pi_super = r_super / norm;
  const pi_mega = r_mega / norm;

  const M_basic = config.basicMultiplier;
  const M_super = config.superMultiplier;
  const M_mega = config.megaMultiplier;

  // E[M]
  const eM = pi_idle * 1 + pi_basic * M_basic + pi_super * M_super + pi_mega * M_mega;
  const eM2 = pi_idle * 1 + pi_basic * M_basic * M_basic + pi_super * M_super * M_super + pi_mega * M_mega * M_mega;
  const varM = Math.max(0, eM2 - eM * eM);

  // Win value moments
  let eV = 0;
  let eV2 = 0;
  for (const { value, probability } of config.baseWinPmf) {
    eV += value * probability;
    eV2 += value * value * probability;
  }

  // Payout
  const eY = eV * eM;
  const eY2 = eV2 * eM2;
  const varY = Math.max(0, eY2 - eY * eY);

  const probActive = pi_basic + pi_super + pi_mega;
  const condBasic = probActive > 1e-12 ? pi_basic / probActive : 0;
  const condSuper = probActive > 1e-12 ? pi_super / probActive : 0;
  const condMega = probActive > 1e-12 ? pi_mega / probActive : 0;

  return {
    probIdle: pi_idle,
    probBasic: pi_basic,
    probSuper: pi_super,
    probMega: pi_mega,
    probAnyActive: probActive,
    expectedMultiplierPerSpin: eM,
    expectedMultiplierSquaredPerSpin: eM2,
    varianceMultiplierPerSpin: varM,
    maxMultiplier: M_mega,
    expectedBaseWin: eV,
    expectedBaseWinSquared: eV2,
    expectedPayoutPerSpin: eY,
    expectedPayoutSquaredPerSpin: eY2,
    variancePayoutPerSpin: varY,
    conditionalProbBasicGivenActive: condBasic,
    conditionalProbSuperGivenActive: condSuper,
    conditionalProbMegaGivenActive: condMega,
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

function sampleBaseWin(pmf: MultiLevelBaseWinPmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

type WildState = 'idle' | 'basic' | 'super' | 'mega';

export function simulateMultiLevelWildMarkov(
  config: MultiLevelWildMarkovConfig,
  spins: number,
  seed: number,
): MultiLevelWildMarkovMCResult {
  validate(config);
  const rng = makePrng(seed);
  const p_land = config.landProbability;
  const p_up1 = config.upgradeProbabilityBasicToSuper;
  const p_up2 = config.upgradeProbabilitySuperToMega;
  const p_exp = config.expireProbability;

  const counts: Record<WildState, number> = { idle: 0, basic: 0, super: 0, mega: 0 };
  let sumMult = 0;
  let sumPayout = 0;
  let state: WildState = 'idle';

  for (let t = 0; t < spins; t++) {
    // Reward at current state (top of spin)
    let mult: number;
    switch (state) {
      case 'idle': mult = 1; break;
      case 'basic': mult = config.basicMultiplier; break;
      case 'super': mult = config.superMultiplier; break;
      case 'mega': mult = config.megaMultiplier; break;
    }
    counts[state]++;
    sumMult += mult;
    const V = sampleBaseWin(config.baseWinPmf, rng());
    sumPayout += V * mult;

    // Transition at end of spin
    const u = rng();
    if (state === 'idle') {
      if (u < p_land) state = 'basic';
    } else if (state === 'basic') {
      if (u < p_exp) state = 'idle';
      else if (u < p_exp + p_up1) state = 'super';
      // else stay basic
    } else if (state === 'super') {
      if (u < p_exp) state = 'idle';
      else if (u < p_exp + p_up2) state = 'mega';
      // else stay super
    } else { // mega
      if (u < p_exp) state = 'idle';
      // else stay mega
    }
  }

  return {
    spins,
    observedFractionIdle: counts.idle / spins,
    observedFractionBasic: counts.basic / spins,
    observedFractionSuper: counts.super / spins,
    observedFractionMega: counts.mega / spins,
    observedMeanMultiplierPerSpin: sumMult / spins,
    observedMeanPayoutPerSpin: sumPayout / spins,
  };
}
