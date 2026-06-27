/**
 * W152 Wave 190 — Nested Mini-Slot Inside Bonus Compositional Aggregator (71. solver).
 *
 * **L&W M14 P1 GAP CLOSURE** — covers LOTR Two Towers + Star Trek family.
 *
 * Iconic nested-slot-inside-bonus mehanika:
 *   * LNW WMS Lord of the Rings Two Towers (2013, defining title — Tower Spin
 *     nested mini-slot inside main bonus)
 *   * LNW WMS Lord of the Rings Return of the King (2013, similar nested)
 *   * Star Trek variants sa nested-slot sub-game (Trek Through the Stars)
 *
 * **71st closed-form solver.** First kernel modeling **compositional parent-
 * child slot sa law-of-total-variance**. Distinct od P-024 (W107) Pick Bonus
 * N-Stage Tree — pick tree NO sub-spinner; ovde nested slot has separate reel
 * set + paytable + variance which then contributes to parent bonus.
 *
 * ── Math (Hierarchical Composition sa Law of Total Variance) ───────────────
 *
 * Parent bonus has:
 *   - Per-spin trigger prob p_bonus (Bernoulli)
 *   - When triggered: K_outer outer-bonus spins
 *   - Per outer-spin: contributes either base outer-payout X_outer ili
 *     triggers nested-mini-slot sa probability p_nested
 *
 * Nested mini-slot (when triggered):
 *   - N_inner spinova in nested sub-game
 *   - Per inner-spin: payout Y_inner ~ iid (μ_inner, σ²_inner)
 *   - Nested total: T_inner = Σ_{k=1..N_inner} Y_inner_k
 *     E[T_inner] = N_inner · μ_inner
 *     Var[T_inner] = N_inner · σ²_inner
 *
 * Outer-bonus contribution per outer-spin:
 *   - I_nested ~ Bernoulli(p_nested)
 *   - X_outer ~ (μ_outer, σ²_outer) iid base outer
 *   - Per outer-spin payout: Z = X_outer + I_nested · T_inner
 *     E[Z] = μ_outer + p_nested · N_inner · μ_inner
 *     Var[Z] (law of total variance) = σ²_outer + p_nested·N_inner·σ²_inner
 *                                     + p_nested·(1−p_nested)·(N_inner·μ_inner)²
 *
 * Outer bonus aggregate (K_outer iid outer spins):
 *   E[B] = K_outer · E[Z]
 *   Var[B] = K_outer · Var[Z]
 *
 * Per-parent-spin aggregate:
 *   - Y = I_bonus · B, I_bonus ~ Bernoulli(p_bonus)
 *   - E[Y per spin] = p_bonus · E[B] = p_bonus · K_outer · E[Z]
 *   - Var[Y per spin] = p_bonus · Var[B] + p_bonus · (1−p_bonus) · (E[B])²
 *
 * **Disclosure metrics**:
 *   - E[B | bonus triggered]
 *   - E[Y per spin]
 *   - P(nested triggers given bonus) = 1 − (1−p_nested)^K_outer
 *   - E[# nested triggers per bonus] = K_outer · p_nested
 *   - nested-slot contribution share to total RTP =
 *       (K_outer · p_nested · N_inner · μ_inner) / E[B]
 *   - commercialUpliftVsNoNestedSlot = E[B] / (K_outer · μ_outer)
 *   - oneInNSpinsAnyBonus = 1 / p_bonus
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-024 (W107) Pick Bonus N-Stage Tree** — pick tree bez sub-spinner
 *   - **P-090 (W189) Random Feature-Injection During FS** — per-spin Bernoulli
 *     injection (single payoff), ne nested mini-slot sa K_outer spinova
 *   - **P-005/P-014 FS retrigger** — same FS engine, ne nested independent slot
 *   - **P-053 (W095) Ante Bet** — single-bet decision, ne bonus composition
 *
 * Compliance:
 *   - UKGC RTS-14 (nested-feature compositional disclosure)
 *   - MGA PPD §11 (parent-child slot transparency)
 *   - eCOGRA Generic Slots Audit (compositional variance audit trail)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "nested slot", "mini-slot inside bonus", "parent-child composition"
 * = generic slot-design terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface NestedMiniSlotInsideBonusConfig {
  /** Per-parent-spin probability that bonus triggers ∈ (0, 1]. */
  probBonusTriggerPerParentSpin: number;
  /** Number of outer-bonus spins K_outer ≥ 1 when bonus triggered. */
  numOuterBonusSpins: number;
  /** Mean of base outer-bonus per-spin payout (× bet, ≥ 0). */
  outerBaseMean: number;
  /** Variance of base outer-bonus per-spin payout (≥ 0). */
  outerBaseVar: number;
  /** Per outer-spin probability that nested mini-slot triggers ∈ (0, 1]. */
  probNestedTriggerPerOuterSpin: number;
  /** Number of nested-mini-slot spins N_inner ≥ 1 when nested triggered. */
  numNestedInnerSpins: number;
  /** Mean of nested-slot per-spin payout (≥ 0). */
  nestedInnerMean: number;
  /** Variance of nested-slot per-spin payout (≥ 0). */
  nestedInnerVar: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface NestedMiniSlotInsideBonusResult {
  /** E[T_inner] = N_inner · μ_inner per nested-slot trigger. */
  expectedNestedSlotPayout: number;
  /** Var[T_inner] = N_inner · σ²_inner per nested-slot trigger. */
  varianceNestedSlotPayout: number;
  /** E[Z] per-outer-spin payout (base + nested). */
  expectedOuterSpinPayout: number;
  /** Var[Z] per-outer-spin variance (law of total variance). */
  varianceOuterSpinPayout: number;
  /** E[B | bonus triggered] = K_outer · E[Z]. */
  expectedBonusPayoutGivenTrigger: number;
  /** Var[B | bonus triggered] = K_outer · Var[Z] (iid outer spins). */
  varianceBonusPayoutGivenTrigger: number;
  /** Std dev given trigger. */
  stdDevBonusPayoutGivenTrigger: number;
  /** E[Y per parent spin] = p_bonus · E[B]. */
  expectedPayoutPerParentSpin: number;
  /** Var[Y per parent spin] via law of total variance on bonus trigger. */
  variancePayoutPerParentSpin: number;
  /** Std dev per parent spin. */
  stdDevPayoutPerParentSpin: number;
  /** P(at least one nested triggers | bonus). */
  probAtLeastOneNestedGivenBonus: number;
  /** E[# nested triggers per bonus] = K_outer · p_nested. */
  expectedNestedTriggersPerBonus: number;
  /** Nested-slot contribution share to bonus E[B]. */
  nestedSlotContributionShare: number;
  /** Commercial uplift vs no-nested-slot baseline. */
  commercialUpliftVsNoNestedSlot: number;
  /** 1 / p_bonus regulator "1 in X" form. */
  oneInNSpinsAnyBonus: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: NestedMiniSlotInsideBonusConfig): void {
  if (
    !Number.isFinite(cfg.probBonusTriggerPerParentSpin) ||
    cfg.probBonusTriggerPerParentSpin <= 0 ||
    cfg.probBonusTriggerPerParentSpin > 1
  ) {
    throw new Error(
      `probBonusTriggerPerParentSpin must be ∈ (0, 1], got ${cfg.probBonusTriggerPerParentSpin}`,
    );
  }
  if (!Number.isInteger(cfg.numOuterBonusSpins) || cfg.numOuterBonusSpins < 1) {
    throw new Error(`numOuterBonusSpins must be integer ≥ 1, got ${cfg.numOuterBonusSpins}`);
  }
  if (!Number.isFinite(cfg.outerBaseMean) || cfg.outerBaseMean < 0) {
    throw new Error(`outerBaseMean must be ≥ 0, got ${cfg.outerBaseMean}`);
  }
  if (!Number.isFinite(cfg.outerBaseVar) || cfg.outerBaseVar < 0) {
    throw new Error(`outerBaseVar must be ≥ 0, got ${cfg.outerBaseVar}`);
  }
  if (
    !Number.isFinite(cfg.probNestedTriggerPerOuterSpin) ||
    cfg.probNestedTriggerPerOuterSpin <= 0 ||
    cfg.probNestedTriggerPerOuterSpin > 1
  ) {
    throw new Error(
      `probNestedTriggerPerOuterSpin must be ∈ (0, 1], got ${cfg.probNestedTriggerPerOuterSpin}`,
    );
  }
  if (!Number.isInteger(cfg.numNestedInnerSpins) || cfg.numNestedInnerSpins < 1) {
    throw new Error(`numNestedInnerSpins must be integer ≥ 1, got ${cfg.numNestedInnerSpins}`);
  }
  if (!Number.isFinite(cfg.nestedInnerMean) || cfg.nestedInnerMean < 0) {
    throw new Error(`nestedInnerMean must be ≥ 0, got ${cfg.nestedInnerMean}`);
  }
  if (!Number.isFinite(cfg.nestedInnerVar) || cfg.nestedInnerVar < 0) {
    throw new Error(`nestedInnerVar must be ≥ 0, got ${cfg.nestedInnerVar}`);
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeNestedMiniSlotInsideBonus(
  cfg: NestedMiniSlotInsideBonusConfig,
): NestedMiniSlotInsideBonusResult {
  validate(cfg);

  const pB = cfg.probBonusTriggerPerParentSpin;
  const kOuter = cfg.numOuterBonusSpins;
  const muO = cfg.outerBaseMean;
  const sig2O = cfg.outerBaseVar;
  const pN = cfg.probNestedTriggerPerOuterSpin;
  const nInner = cfg.numNestedInnerSpins;
  const muI = cfg.nestedInnerMean;
  const sig2I = cfg.nestedInnerVar;

  // ── 1. Nested-slot per-trigger
  const expectedNestedSlotPayout = nInner * muI;
  const varianceNestedSlotPayout = nInner * sig2I;

  // ── 2. Per-outer-spin Z = X_outer + I_nested · T_inner
  //   E[Z] = μ_O + p_N · E[T_inner]
  //   Var[Z] (law of total variance):
  //     = σ²_O + p_N·Var[T_inner] + p_N·(1−p_N)·(E[T_inner])²
  const expectedOuterSpinPayout = muO + pN * expectedNestedSlotPayout;
  const varianceOuterSpinPayout =
    sig2O +
    pN * varianceNestedSlotPayout +
    pN * (1 - pN) * expectedNestedSlotPayout * expectedNestedSlotPayout;

  // ── 3. Bonus aggregate (K_outer iid outer spins under independence)
  const expectedBonusPayoutGivenTrigger = kOuter * expectedOuterSpinPayout;
  const varianceBonusPayoutGivenTrigger = kOuter * varianceOuterSpinPayout;
  const stdDevBonusPayoutGivenTrigger = Math.sqrt(
    Math.max(0, varianceBonusPayoutGivenTrigger),
  );

  // ── 4. Per-parent-spin Y = I_bonus · B
  //   E[Y] = p_B · E[B]
  //   Var[Y] = p_B · Var[B] + p_B · (1 − p_B) · (E[B])²
  const expectedPayoutPerParentSpin = pB * expectedBonusPayoutGivenTrigger;
  const variancePayoutPerParentSpin =
    pB * varianceBonusPayoutGivenTrigger +
    pB * (1 - pB) * expectedBonusPayoutGivenTrigger * expectedBonusPayoutGivenTrigger;
  const stdDevPayoutPerParentSpin = Math.sqrt(Math.max(0, variancePayoutPerParentSpin));

  // ── 5. Disclosure
  const probAtLeastOneNestedGivenBonus = 1 - Math.pow(1 - pN, kOuter);
  const expectedNestedTriggersPerBonus = kOuter * pN;

  // Nested contribution share to E[B]
  const nestedContribToEB = kOuter * pN * expectedNestedSlotPayout;
  const nestedSlotContributionShare =
    expectedBonusPayoutGivenTrigger > 1e-12
      ? nestedContribToEB / expectedBonusPayoutGivenTrigger
      : 0;

  // Commercial uplift vs no-nested baseline (E[B_no_nested] = K_outer · μ_O)
  const baselineNoNested = kOuter * muO;
  const commercialUpliftVsNoNestedSlot =
    baselineNoNested > 1e-12
      ? expectedBonusPayoutGivenTrigger / baselineNoNested
      : Number.POSITIVE_INFINITY;

  const oneInNSpinsAnyBonus = pB > 1e-15 ? 1 / pB : Number.POSITIVE_INFINITY;

  return {
    expectedNestedSlotPayout,
    varianceNestedSlotPayout,
    expectedOuterSpinPayout,
    varianceOuterSpinPayout,
    expectedBonusPayoutGivenTrigger,
    varianceBonusPayoutGivenTrigger,
    stdDevBonusPayoutGivenTrigger,
    expectedPayoutPerParentSpin,
    variancePayoutPerParentSpin,
    stdDevPayoutPerParentSpin,
    probAtLeastOneNestedGivenBonus,
    expectedNestedTriggersPerBonus,
    nestedSlotContributionShare,
    commercialUpliftVsNoNestedSlot,
    oneInNSpinsAnyBonus,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveNestedMiniSlotInsideBonus = analyzeNestedMiniSlotInsideBonus;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateNestedMiniSlotInsideBonus(
  cfg: NestedMiniSlotInsideBonusConfig,
  numParentSpins: number,
  seed = 0xface0190,
): {
  meanPayoutPerParentSpin: number;
  stdDevPayoutPerParentSpin: number;
  observedBonusTriggerRate: number;
  meanBonusPayoutGivenTrigger: number;
  observedProbAtLeastOneNestedGivenBonus: number;
} {
  validate(cfg);
  if (!Number.isInteger(numParentSpins) || numParentSpins < 1) {
    throw new Error(`numParentSpins must be integer ≥ 1, got ${numParentSpins}`);
  }

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

  const sigO = Math.sqrt(cfg.outerBaseVar);
  const sigI = Math.sqrt(cfg.nestedInnerVar);

  let sumY = 0;
  let sumY2 = 0;
  let countBonus = 0;
  let sumBonusPayout = 0;
  let countAtLeastOneNested = 0;

  for (let spin = 0; spin < numParentSpins; spin++) {
    let y = 0;
    if (rng() < cfg.probBonusTriggerPerParentSpin) {
      countBonus++;
      let bonusPayout = 0;
      let nestedCount = 0;
      for (let o = 0; o < cfg.numOuterBonusSpins; o++) {
        bonusPayout += gaussian(cfg.outerBaseMean, sigO);
        if (rng() < cfg.probNestedTriggerPerOuterSpin) {
          nestedCount++;
          for (let i = 0; i < cfg.numNestedInnerSpins; i++) {
            bonusPayout += gaussian(cfg.nestedInnerMean, sigI);
          }
        }
      }
      sumBonusPayout += bonusPayout;
      if (nestedCount > 0) countAtLeastOneNested++;
      y = bonusPayout;
    }
    sumY += y;
    sumY2 += y * y;
  }

  const meanY = sumY / numParentSpins;
  const varY = Math.max(0, sumY2 / numParentSpins - meanY * meanY);
  return {
    meanPayoutPerParentSpin: meanY,
    stdDevPayoutPerParentSpin: Math.sqrt(varY),
    observedBonusTriggerRate: countBonus / numParentSpins,
    meanBonusPayoutGivenTrigger: countBonus > 0 ? sumBonusPayout / countBonus : 0,
    observedProbAtLeastOneNestedGivenBonus:
      countBonus > 0 ? countAtLeastOneNested / countBonus : 0,
  };
}
