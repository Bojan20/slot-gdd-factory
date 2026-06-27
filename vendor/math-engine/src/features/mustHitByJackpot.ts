/**
 * W152 Wave 71 — Must-Hit-By Jackpot closed-form (Faza 12 ⚠️→✅).
 *
 * Closes Faza 12 scenario "⚠️ Must-hit-by jackpot" by adding analytical
 * solver for the Mystery / Must-Hit-By progressive jackpot family
 * (industry-standard pool that grows by per-spin contribution + has a
 * configured cap; trigger guaranteed before pool exceeds cap).
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Mystery progressive (no symbol trigger — pool grows + fires when
 * random-uniform threshold drawn from [seed, cap] is crossed by pool).
 * Industry standard since 1990s (Lightning Link / Dragon Link / etc.
 * mystery jackpots use this exact model). Math regime well-established
 * (Cabot & Hannum 2002 ch. 11).
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Must-hit-by" = generic industry term, NIGC + UKGC RTS use it
 *     in regulatory text.
 *   • No vendor-specific implementation details.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Trigger pool U ~ Uniform[poolSeedX, poolCapX] (drawn once per cycle).
 * Pool grows linearly: pool_n = poolSeedX + n × contributionPerSpinX.
 * Trigger fires on spin n* where pool_{n*} ≥ U (first crossing).
 *
 * Spins until trigger N* = ⌈(U − poolSeedX) / contributionPerSpinX⌉.
 * Since U is uniform on [poolSeedX, poolCapX]:
 *   E[N*] = (poolCapX − poolSeedX) / (2 × contributionPerSpinX)
 *   Var[N*] = (poolCapX − poolSeedX)² / (12 × contributionPerSpinX²)
 *
 * Pool at trigger:
 *   E[pool_trigger] = (poolSeedX + poolCapX) / 2
 *
 * Per-spin RTP contribution from this jackpot:
 *   contribution rate `c` builds pool; full pool eventually paid out.
 *   Long-run RTP = c (every contributed unit returns to a player).
 *
 *   But operator wants the "expected per-spin paid jackpot" metric:
 *     E[Y per spin] = E[pool_trigger] × (1 / E[N*])
 *                   = (seedX + capX)/2 × 2c/(capX − seedX)
 *                   = c × (seedX + capX) / (capX − seedX)
 *
 *   This is > c when seedX > 0 — operator "seeds" the jackpot from
 *   reserve, which inflates the paid-out value relative to contribution.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateMustHitByJackpot() MC reference. Acceptance integrated into
 * closed-form portfolio.
 *
 * ── References ────────────────────────────────────────────────────────────
 * Cabot & Hannum 2002 ch. 11 — mystery progressives.
 * NIGC 25 CFR 542.7(c) — must-hit-by regulatory definition.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface MustHitByConfig {
  /** Pool seed value in X (e.g. 500). */
  poolSeedX: number;
  /** Pool cap in X (e.g. 5000). */
  poolCapX: number;
  /** Per-spin contribution in X (e.g. 0.01). */
  contributionPerSpinX: number;
}

export interface MustHitByResult {
  expectedSpinsUntilTrigger: number;
  varianceSpinsUntilTrigger: number;
  stdDevSpinsUntilTrigger: number;
  expectedPoolAtTrigger: number;
  /** Long-run E[Y]/spin paid from jackpot (averaged over many cycles). */
  expectedPayoutPerSpin: number;
  /** Operator's effective RTP contribution from this jackpot. */
  effectiveRtpContribution: number;
  /** Operator-seeded portion (seed value paid from reserve, not contributions). */
  operatorSeedReturnPerCycle: number;
}

export interface MustHitByMCResult {
  observedCycles: number;
  observedMeanSpins: number;
  observedMeanPoolAtTrigger: number;
  observedMeanPayoutPerSpin: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: MustHitByConfig): void {
  if (!Number.isFinite(cfg.poolSeedX) || cfg.poolSeedX < 0) {
    throw new Error(`poolSeedX must be non-negative finite, got ${cfg.poolSeedX}`);
  }
  if (!Number.isFinite(cfg.poolCapX) || cfg.poolCapX <= cfg.poolSeedX) {
    throw new Error(`poolCapX must be > poolSeedX (${cfg.poolSeedX}), got ${cfg.poolCapX}`);
  }
  if (!Number.isFinite(cfg.contributionPerSpinX) || cfg.contributionPerSpinX <= 0) {
    throw new Error(`contributionPerSpinX must be positive finite, got ${cfg.contributionPerSpinX}`);
  }
}

// ── Closed-form solver ─────────────────────────────────────────────────────

export function solveMustHitByJackpot(config: MustHitByConfig): MustHitByResult {
  validate(config);
  const span = config.poolCapX - config.poolSeedX;
  const c = config.contributionPerSpinX;
  // U ~ Uniform[seed, cap], spins-to-trigger N* = (U − seed) / c
  // E[N*] = span/(2c), Var[N*] = span²/(12 c²)
  const eN = span / (2 * c);
  const varN = (span * span) / (12 * c * c);
  const ePool = (config.poolSeedX + config.poolCapX) / 2;
  // Long-run paid per spin = E[pool_trigger] / E[N*]
  // = ((seed+cap)/2) / (span/(2c))
  // = c × (seed+cap)/(cap−seed)
  const ePay = c * (config.poolSeedX + config.poolCapX) / span;
  // Operator seed return per cycle = poolSeedX (operator-funded portion paid back)
  return {
    expectedSpinsUntilTrigger: eN,
    varianceSpinsUntilTrigger: varN,
    stdDevSpinsUntilTrigger: Math.sqrt(varN),
    expectedPoolAtTrigger: ePool,
    expectedPayoutPerSpin: ePay,
    effectiveRtpContribution: ePay,
    operatorSeedReturnPerCycle: config.poolSeedX,
  };
}

// ── Monte Carlo reference solver ───────────────────────────────────────────

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

export function simulateMustHitByJackpot(
  config: MustHitByConfig,
  cycles: number,
  seed: number,
): MustHitByMCResult {
  validate(config);
  const rng = makePrng(seed);
  let totalSpins = 0;
  let totalPool = 0;
  const span = config.poolCapX - config.poolSeedX;
  for (let c = 0; c < cycles; c++) {
    const triggerPool = config.poolSeedX + rng() * span;
    const spins = Math.ceil((triggerPool - config.poolSeedX) / config.contributionPerSpinX);
    totalSpins += spins;
    totalPool += triggerPool;
  }
  return {
    observedCycles: cycles,
    observedMeanSpins: totalSpins / cycles,
    observedMeanPoolAtTrigger: totalPool / cycles,
    observedMeanPayoutPerSpin: totalPool / Math.max(totalSpins, 1),
  };
}
