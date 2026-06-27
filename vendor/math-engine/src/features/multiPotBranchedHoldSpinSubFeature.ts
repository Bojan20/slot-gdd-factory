/**
 * W152 Wave 193 — Multi-Pot Branched H&S Sub-Feature Selection Aggregator (74. solver).
 *
 * **L&W M15 P1 GAP CLOSURE** — covers LNW Bally Rich Little Piggies family
 * sa Piggy Bankin' Break In branched H&S (3 sub-modes Instant Win / Double Play /
 * Repeat Win) + World Class escalation + Hens variant.
 *
 * Iconic multi-pot branched H&S sub-feature mehanika:
 *   * LNW Bally Rich Little Piggies Piggy Bankin' Break In (2024 defining title,
 *     3-pot branched H&S — each pot triggers structurally different sub-game)
 *   * LNW Bally Rich Little Piggies World Class (2025, class-tier escalation
 *     variant)
 *   * LNW Bally Rich Little Hens World Class (2025, hen variant)
 *   * Future L&W multi-mode H&S flagship variants
 *
 * **74th closed-form solver.** First kernel modeling **branched sub-game
 * selection sa heterogeneous sub-mode distributions** — H&S triggers, then
 * categorical-selects ONE of M sub-modes, each sa distinct (μ_k, σ²_k) and
 * jurisdictional disclosure profile.
 *
 * ── Math (Trigger-gated Categorical Sub-Mode Mixture) ──────────────────────
 *
 * Per spin: H&S triggers with probability p_trigger (Bernoulli).
 * If triggered: pot index K ~ Categorical(p_1..p_M) (Σ p_k = 1).
 * Per-pot k: sub-feature payout V_k ~ iid sa (μ_k, σ²_k) distinct per pot.
 *
 * Per-spin payout:
 *   Y = T · V_K   where T ~ Bernoulli(p_trigger), K ~ Categorical, V_K iid
 *
 * **Mixture moments** (law of total expectation/variance):
 *
 *   E[V | triggered] = Σ_k p_k · μ_k             (mixture mean)
 *   E[V² | triggered] = Σ_k p_k · (σ²_k + μ²_k)
 *   Var[V | triggered] = E[V²] − (E[V])²         (mixture variance)
 *
 *   **E[Y per spin] = p_trigger · Σ_k p_k · μ_k**
 *
 *   Var[Y per spin] (law of total variance on trigger):
 *     = p_trigger · Var[V|trig] + p_trigger·(1−p_trigger)·(E[V|trig])²
 *
 * **Disclosure metrics**:
 *   - perPot.contributionShareOfBonus = p_k · μ_k / E[V|trig]
 *   - perPot.oneInNTriggersForPot = 1 / p_k (regulator "1 in X" form)
 *   - bestPotIndex = argmax_k μ_k (jackpot-dominant pot)
 *   - worstPotIndex = argmin_k μ_k
 *   - jackpotPotShare = max p_k · μ_k / E[V|trig]
 *   - bonusVariabilityIndex = std/mean = σ_V / μ_V (UKGC RTS-14 disclosure)
 *   - oneInNSpinsAnyTrigger = 1 / p_trigger
 *   - oneInNSpinsTopPotTrigger = 1 / (p_trigger · p_{best})
 *   - mixtureVarianceLift = Var[V|trig] / Σ p_k·σ²_k  (cross-pot diversity)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────
 *   - **P-089 (W188) Player-Elects Composition** — player CHOOSES subset
 *     m-of-N additively; ovde sub-mode je **vendor-selected** Categorical
 *     mixture (no player skill).
 *   - **P-091 (W190) Nested Mini-Slot Inside Bonus** — single nested mini-slot
 *     per outer-spin gated by Bernoulli; ovde **categorical branch** among
 *     M heterogeneous sub-modes (one wins).
 *   - **P-022 (W104) Wheel Bonus** — wheel categorical sa flat per-slice
 *     payouts; ovde each pot has **own distribution** (mean+variance), not
 *     flat slice values.
 *   - **P-093 (W192) Race/Competitive Pick Winner** — player-elects single
 *     candidate among N + categorical winner gating; ovde vendor-categorical
 *     pot selection bez player pick.
 *   - **P-068 (W155) Bonus Trigger Stratification** — scatter-count gates
 *     bonus tier; ovde single trigger then sub-mode categorical.
 *
 * Compliance:
 *   - **UKGC RTS-14** mandatory per-pot RTP contribution disclosure
 *   - **MGA PPD §11** branched-mode transparency
 *   - **eCOGRA** per-mode audit trail
 *   - **EU GA 2024** cross-jurisdiction baseline
 *
 * Naming: "multi-pot", "branched", "sub-mode", "trigger-gated mixture"
 * = generic slot-design + game-design terms. No vendor TM.
 */

/** ── Per-pot config ───────────────────────────────────────────────────────── */
export interface SubModePotConfig {
  /** Optional pot label (audit trail only). */
  label?: string;
  /** Categorical selection weight w_k ≥ 0. p_k = w_k / Σ w_j. */
  selectionWeight: number;
  /** Mean payout if this pot is selected (× bet, ≥ 0). */
  meanPayout: number;
  /** Variance of payout (≥ 0). */
  variancePayout: number;
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface MultiPotBranchedHoldSpinSubFeatureConfig {
  /** Per-spin probability that H&S triggers ∈ (0, 1]. */
  probTrigger: number;
  /** Pot sub-modes (M ≥ 2). */
  pots: SubModePotConfig[];
}

/** ── Per-pot disclosure ───────────────────────────────────────────────────── */
export interface SubModePotDisclosure {
  index: number;
  label: string;
  /** p_k = w_k / Σ w_j (selection prob given trigger). */
  selectionProb: number;
  meanPayout: number;
  variancePayout: number;
  /** p_k · μ_k / E[V|trig] (share of bonus RTP). */
  contributionShareOfBonus: number;
  /** 1 / p_k Geometric expected triggers until this pot selected. */
  oneInNTriggersForPot: number;
  /** rank descending by meanPayout (1..M). */
  rankByMeanPayout: number;
  /** True if this pot has the highest meanPayout. */
  isBestPot: boolean;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface MultiPotBranchedHoldSpinSubFeatureResult {
  /** M (number of pots). */
  numPots: number;
  /** Per-pot disclosure rows. */
  perPot: SubModePotDisclosure[];
  /** E[V | triggered] = Σ p_k · μ_k. */
  expectedPayoutGivenTrigger: number;
  /** Var[V | triggered] mixture variance. */
  variancePayoutGivenTrigger: number;
  /** Std dev given trigger. */
  stdDevPayoutGivenTrigger: number;
  /** E[Y per spin] = p_trigger · E[V|trig]. */
  expectedPayoutPerSpin: number;
  /** Var[Y per spin] via law of total variance on trigger. */
  variancePayoutPerSpin: number;
  /** Std dev per spin. */
  stdDevPayoutPerSpin: number;
  /** argmax_k μ_k (jackpot-dominant pot index). */
  bestPotIndex: number;
  /** argmin_k μ_k. */
  worstPotIndex: number;
  /** max share of bonus RTP from a single pot. */
  jackpotPotShare: number;
  /** σ_V / μ_V (RTS-14 coefficient of variation disclosure). */
  bonusVariabilityIndex: number;
  /** 1 / p_trigger Geometric expected spins to any trigger. */
  oneInNSpinsAnyTrigger: number;
  /** 1 / (p_trigger · p_{best}) one-in-N spins until top pot. */
  oneInNSpinsTopPotTrigger: number;
  /** mixture-variance lift = Var[V|trig] / Σ p_k·σ²_k. */
  mixtureVarianceLift: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: MultiPotBranchedHoldSpinSubFeatureConfig): void {
  if (!Number.isFinite(cfg.probTrigger) || cfg.probTrigger <= 0 || cfg.probTrigger > 1) {
    throw new Error(`probTrigger must be ∈ (0, 1], got ${cfg.probTrigger}`);
  }
  if (!Array.isArray(cfg.pots) || cfg.pots.length < 2) {
    throw new Error(`pots must be array of length ≥ 2, got ${cfg.pots?.length ?? 0}`);
  }
  let sumW = 0;
  for (let i = 0; i < cfg.pots.length; i++) {
    const p = cfg.pots[i]!;
    if (!Number.isFinite(p.selectionWeight) || p.selectionWeight < 0) {
      throw new Error(`pots[${i}].selectionWeight must be ≥ 0, got ${p.selectionWeight}`);
    }
    if (!Number.isFinite(p.meanPayout) || p.meanPayout < 0) {
      throw new Error(`pots[${i}].meanPayout must be ≥ 0, got ${p.meanPayout}`);
    }
    if (!Number.isFinite(p.variancePayout) || p.variancePayout < 0) {
      throw new Error(`pots[${i}].variancePayout must be ≥ 0, got ${p.variancePayout}`);
    }
    sumW += p.selectionWeight;
  }
  if (sumW <= 0) {
    throw new Error(`sum of pot selection weights must be > 0, got ${sumW}`);
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeMultiPotBranchedHoldSpinSubFeature(
  cfg: MultiPotBranchedHoldSpinSubFeatureConfig,
): MultiPotBranchedHoldSpinSubFeatureResult {
  validate(cfg);

  const M = cfg.pots.length;
  const sumW = cfg.pots.reduce((acc, p) => acc + p.selectionWeight, 0);
  const probs = cfg.pots.map((p) => p.selectionWeight / sumW);
  const pT = cfg.probTrigger;

  // Mixture mean E[V | trig] = Σ p_k · μ_k
  const expectedPayoutGivenTrigger = cfg.pots.reduce(
    (acc, p, k) => acc + probs[k]! * p.meanPayout,
    0,
  );

  // E[V² | trig] = Σ p_k · (σ²_k + μ²_k)
  const eV2GivenTrig = cfg.pots.reduce(
    (acc, p, k) => acc + probs[k]! * (p.variancePayout + p.meanPayout * p.meanPayout),
    0,
  );
  const variancePayoutGivenTrigger = Math.max(
    0,
    eV2GivenTrig - expectedPayoutGivenTrigger * expectedPayoutGivenTrigger,
  );
  const stdDevPayoutGivenTrigger = Math.sqrt(variancePayoutGivenTrigger);

  // Per-spin (law of total variance on Bernoulli trigger)
  const expectedPayoutPerSpin = pT * expectedPayoutGivenTrigger;
  const variancePayoutPerSpin =
    pT * variancePayoutGivenTrigger +
    pT * (1 - pT) * expectedPayoutGivenTrigger * expectedPayoutGivenTrigger;
  const stdDevPayoutPerSpin = Math.sqrt(Math.max(0, variancePayoutPerSpin));

  // Best/worst pot by meanPayout
  let bestPotIndex = 0;
  let worstPotIndex = 0;
  for (let k = 1; k < M; k++) {
    if (cfg.pots[k]!.meanPayout > cfg.pots[bestPotIndex]!.meanPayout) bestPotIndex = k;
    if (cfg.pots[k]!.meanPayout < cfg.pots[worstPotIndex]!.meanPayout) worstPotIndex = k;
  }

  // Per-pot disclosure
  const sortedByMean = [...cfg.pots.keys()].sort(
    (a, b) => cfg.pots[b]!.meanPayout - cfg.pots[a]!.meanPayout,
  );
  const rankByMean = new Array<number>(M);
  for (let r = 0; r < M; r++) {
    rankByMean[sortedByMean[r]!] = r + 1;
  }
  const perPot: SubModePotDisclosure[] = cfg.pots.map((p, k) => {
    const contribution =
      expectedPayoutGivenTrigger > 1e-12
        ? (probs[k]! * p.meanPayout) / expectedPayoutGivenTrigger
        : 0;
    return {
      index: k,
      label: p.label ?? `pot_${k}`,
      selectionProb: probs[k]!,
      meanPayout: p.meanPayout,
      variancePayout: p.variancePayout,
      contributionShareOfBonus: contribution,
      oneInNTriggersForPot:
        probs[k]! > 1e-15 ? 1 / probs[k]! : Number.POSITIVE_INFINITY,
      rankByMeanPayout: rankByMean[k]!,
      isBestPot: k === bestPotIndex,
    };
  });

  // jackpotPotShare = max contributionShareOfBonus
  const jackpotPotShare = Math.max(...perPot.map((p) => p.contributionShareOfBonus));

  // Coefficient of variation σ/μ
  const bonusVariabilityIndex =
    expectedPayoutGivenTrigger > 1e-12
      ? stdDevPayoutGivenTrigger / expectedPayoutGivenTrigger
      : 0;

  const oneInNSpinsAnyTrigger = pT > 1e-15 ? 1 / pT : Number.POSITIVE_INFINITY;
  const pBest = probs[bestPotIndex]!;
  const oneInNSpinsTopPotTrigger =
    pT * pBest > 1e-15 ? 1 / (pT * pBest) : Number.POSITIVE_INFINITY;

  // Mixture-variance lift: Var[V|trig] / Σ p_k·σ²_k
  // (cross-pot diversity adds to within-pot variance; lift>1 indicates real mixture spread)
  const expectedWithinPotVar = cfg.pots.reduce(
    (acc, p, k) => acc + probs[k]! * p.variancePayout,
    0,
  );
  const mixtureVarianceLift =
    expectedWithinPotVar > 1e-12
      ? variancePayoutGivenTrigger / expectedWithinPotVar
      : Number.POSITIVE_INFINITY;

  return {
    numPots: M,
    perPot,
    expectedPayoutGivenTrigger,
    variancePayoutGivenTrigger,
    stdDevPayoutGivenTrigger,
    expectedPayoutPerSpin,
    variancePayoutPerSpin,
    stdDevPayoutPerSpin,
    bestPotIndex,
    worstPotIndex,
    jackpotPotShare,
    bonusVariabilityIndex,
    oneInNSpinsAnyTrigger,
    oneInNSpinsTopPotTrigger,
    mixtureVarianceLift,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveMultiPotBranchedHoldSpinSubFeature =
  analyzeMultiPotBranchedHoldSpinSubFeature;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateMultiPotBranchedHoldSpinSubFeature(
  cfg: MultiPotBranchedHoldSpinSubFeatureConfig,
  numSpins: number,
  seed = 0xface0193,
): {
  meanPayoutPerSpin: number;
  stdDevPayoutPerSpin: number;
  observedTriggerRate: number;
  meanPayoutGivenTrigger: number;
  observedPotSelectionRates: number[];
} {
  validate(cfg);
  if (!Number.isInteger(numSpins) || numSpins < 1) {
    throw new Error(`numSpins must be integer ≥ 1, got ${numSpins}`);
  }

  const M = cfg.pots.length;
  const sumW = cfg.pots.reduce((acc, p) => acc + p.selectionWeight, 0);
  const cdf: number[] = [];
  let cum = 0;
  for (const p of cfg.pots) {
    cum += p.selectionWeight / sumW;
    cdf.push(cum);
  }
  cdf[M - 1] = 1; // floating safety

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
  const samplePot = (): number => {
    const u = rng();
    for (let k = 0; k < M; k++) {
      if (u <= cdf[k]!) return k;
    }
    return M - 1;
  };

  let sumY = 0;
  let sumY2 = 0;
  let triggerCount = 0;
  let sumBonusPayout = 0;
  const potCounts = new Array<number>(M).fill(0);

  for (let i = 0; i < numSpins; i++) {
    let y = 0;
    if (rng() < cfg.probTrigger) {
      triggerCount++;
      const k = samplePot();
      potCounts[k]!++;
      const p = cfg.pots[k]!;
      const sig = Math.sqrt(p.variancePayout);
      y = Math.max(0, gaussian(p.meanPayout, sig));
      sumBonusPayout += y;
    }
    sumY += y;
    sumY2 += y * y;
  }

  const meanY = sumY / numSpins;
  const varY = Math.max(0, sumY2 / numSpins - meanY * meanY);

  return {
    meanPayoutPerSpin: meanY,
    stdDevPayoutPerSpin: Math.sqrt(varY),
    observedTriggerRate: triggerCount / numSpins,
    meanPayoutGivenTrigger: triggerCount > 0 ? sumBonusPayout / triggerCount : 0,
    observedPotSelectionRates: potCounts.map((c) => (triggerCount > 0 ? c / triggerCount : 0)),
  };
}
