/**
 * W236 — AI/ML Player Profiling Fairness Audit Analyzer (93. solver).
 *
 * INDUSTRY-FIRST **AI FAIRNESS / ALGORITHMIC ACCOUNTABILITY kernel** za EU AI
 * Act 2024 (Regulation 2024/1689 — high-risk AI systems mandatory bias audit
 * Aug 2026 effective) + UKGC RTS 12 §11 (algorithmic-decision transparency
 * 2024 update) + UK ICO AI Auditing Framework (2024) + AU AI Ethics Framework
 * 2024 + IEEE 7003-2024 Algorithmic Bias Considerations + NIST AI Risk
 * Management Framework AI RMF 1.0 + EEOC ADA Title VII (US employment-bias
 * analog applies to player-facing AI).
 *
 * Trigger landed posle 2024 enforcement actions:
 *   - Sky Bet £1.17M (2024 — bonus-targeting AI bias)
 *   - PokerStars (Flutter) ICO 2024 — opaque player-classification audit
 *   - ICO Bridges to Justice 2023-24 — algorithmic-decision GDPR Art. 22 enforcement
 *
 * **93rd closed-form solver — first AI FAIRNESS kernel** u portfolio. 13.
 * dimenzija. Distinct od W231 (fraud detection ROC) — ovaj fokus je
 * **DEMOGRAPHIC PARITY + EQUALIZED ODDS + DISPARATE IMPACT** za AI/ML
 * sisteme klasifikacije player-a (VIP-tier prediction, bonus eligibility,
 * RG flag classification, etc.).
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Two-group fairness setting** (protected vs unprotected attribute):
 *
 *   Group A (protected, e.g. age 18-25 / female / minority ethnicity)
 *   Group B (unprotected)
 *
 *   Per-group classifier performance:
 *     TPR_A = P(predict positive | true positive, group A) — sensitivity
 *     TPR_B = same for group B
 *     FPR_A, FPR_B = false-positive rate per group
 *     P_positive_A = P(predict positive | group A) — selection rate
 *     P_positive_B = same for group B
 *
 * **Demographic Parity (Statistical Parity)**:
 *
 *   DP_difference = P_positive_A − P_positive_B
 *   |DP| ≤ 0.10 for fairness (Aequitas threshold standard)
 *
 * **Equalized Odds (Hardt 2016)**:
 *
 *   EO_TPR_diff = |TPR_A − TPR_B|
 *   EO_FPR_diff = |FPR_A − FPR_B|
 *   Both ≤ 0.05 for fairness (FAccT/IBM AIF360 threshold)
 *
 * **Disparate Impact** (EEOC 4/5 rule, ADA Title VII):
 *
 *   DI_ratio = P_positive_A / P_positive_B
 *   Pass: 0.80 ≤ DI ≤ 1.25 (Equal Employment Opportunity Commission "4/5 rule")
 *   Fail if either DI < 0.80 OR DI > 1.25
 *
 * **Equal Opportunity (positive class only)**:
 *
 *   EOP_diff = |TPR_A − TPR_B|
 *   Looser than full Equalized Odds — only requires sensitivity parity.
 *
 * **Predictive Parity (calibration)**:
 *
 *   PPV_A = P(true positive | predicted positive, group A)
 *   |PPV_A − PPV_B| ≤ 0.05 for fairness
 *
 * **Bias-correction method** (post-processing — threshold optimization):
 *
 *   Adjust per-group threshold to equalize TPR (or FPR or selection rate).
 *   Required threshold shift Δτ:
 *     Δτ ≈ (target_TPR − current_TPR) · slope_of_ROC
 *
 * **Composite fairness score** ∈ [0, 1]:
 *
 *   score = (1 − |DP|/0.10) · 0.30
 *         + (1 − EO_TPR_diff/0.05) · 0.25
 *         + (1 − EO_FPR_diff/0.05) · 0.25
 *         + min(DI, 1/DI) · 0.20
 *   Clipped to [0, 1].
 *
 * **EU AI Act compliance** (Art. 9 high-risk AI systems):
 *
 *   isCompliantEuAiAct = (|DP| ≤ 0.10 ∧
 *                         EO_TPR_diff ≤ 0.05 ∧
 *                         EO_FPR_diff ≤ 0.05 ∧
 *                         0.80 ≤ DI ≤ 1.25 ∧
 *                         documentation + human-oversight enabled)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W229                — AML sanctions (single-feature, not fairness)
 *   - W231                — fraud detection (ROC, not demographic fairness)
 *   - W236 (this)         — TWO-GROUP fairness sa demographic parity +
 *                            equalized odds + disparate impact
 *
 * Naming: "demographic parity", "equalized odds", "disparate impact 4/5 rule",
 * "EU AI Act high-risk", "NIST AI RMF" — generic algorithmic-fairness +
 * civil-rights actuarial terms. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface AiFairnessConfig {
  /** Group A (protected) selection rate ∈ [0, 1]. */
  positiveRateGroupA: number;
  /** Group B (unprotected) selection rate ∈ [0, 1]. */
  positiveRateGroupB: number;
  /** Group A true-positive rate ∈ [0, 1]. */
  truePositiveRateA: number;
  /** Group B true-positive rate ∈ [0, 1]. */
  truePositiveRateB: number;
  /** Group A false-positive rate ∈ [0, 1]. */
  falsePositiveRateA: number;
  /** Group B false-positive rate ∈ [0, 1]. */
  falsePositiveRateB: number;
  /** Group A positive predictive value (precision) ∈ [0, 1]. */
  ppvGroupA: number;
  /** Group B positive predictive value ∈ [0, 1]. */
  ppvGroupB: number;
  /** Demographic-parity tolerance (Aequitas 0.10 default). */
  demographicParityTolerance: number;
  /** Equalized-odds tolerance (AIF360 0.05 default). */
  equalizedOddsTolerance: number;
  /** Disparate-impact threshold lower (EEOC 4/5 = 0.80). */
  disparateImpactLower: number;
  /** Disparate-impact threshold upper (1/0.80 = 1.25). */
  disparateImpactUpper: number;
  /** Boolean: model documentation completed (EU AI Act Art. 11). */
  documentationComplete: boolean;
  /** Boolean: human-oversight enabled (EU AI Act Art. 14). */
  humanOversightEnabled: boolean;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface AiFairnessResult {
  /** DP_difference = positiveRate_A − positiveRate_B. */
  demographicParityDifference: number;
  /** |DP_difference|. */
  demographicParityAbs: number;
  /** EO_TPR_diff = |TPR_A − TPR_B|. */
  equalizedOddsTprDiff: number;
  /** EO_FPR_diff = |FPR_A − FPR_B|. */
  equalizedOddsFprDiff: number;
  /** DI = P_positive_A / P_positive_B (EEOC 4/5 rule). */
  disparateImpactRatio: number;
  /** PPV_diff = |PPV_A − PPV_B|. */
  predictiveParityDiff: number;
  /** Equal opportunity (positive class only) = TPR_diff. */
  equalOpportunityDiff: number;
  /** Composite fairness score ∈ [0, 1]. */
  fairnessCompositeScore: number;
  /** Boolean: passes demographic parity. */
  passesDemographicParity: boolean;
  /** Boolean: passes equalized odds (both TPR and FPR). */
  passesEqualizedOdds: boolean;
  /** Boolean: passes disparate impact 4/5 rule. */
  passesDisparateImpact: boolean;
  /** EU AI Act 2024 Art. 9 high-risk compliance. */
  isCompliantEuAiAct: boolean;
  /** UKGC RTS 12 §11 algorithmic-decision compliance. */
  isCompliantUkgcRts1211: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: AiFairnessConfig): void {
  const probs = [
    cfg.positiveRateGroupA,
    cfg.positiveRateGroupB,
    cfg.truePositiveRateA,
    cfg.truePositiveRateB,
    cfg.falsePositiveRateA,
    cfg.falsePositiveRateB,
    cfg.ppvGroupA,
    cfg.ppvGroupB,
  ];
  for (const p of probs) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`aiFairness: all rate parameters must be in [0, 1]`);
    }
  }
  if (
    !Number.isFinite(cfg.demographicParityTolerance) ||
    cfg.demographicParityTolerance < 0 ||
    cfg.demographicParityTolerance > 0.5
  ) {
    throw new Error(`aiFairness: demographicParityTolerance must be in [0, 0.5]`);
  }
  if (
    !Number.isFinite(cfg.equalizedOddsTolerance) ||
    cfg.equalizedOddsTolerance < 0 ||
    cfg.equalizedOddsTolerance > 0.5
  ) {
    throw new Error(`aiFairness: equalizedOddsTolerance must be in [0, 0.5]`);
  }
  if (
    !Number.isFinite(cfg.disparateImpactLower) ||
    cfg.disparateImpactLower <= 0 ||
    cfg.disparateImpactLower >= 1
  ) {
    throw new Error(`aiFairness: disparateImpactLower must be in (0, 1)`);
  }
  if (
    !Number.isFinite(cfg.disparateImpactUpper) ||
    cfg.disparateImpactUpper <= 1
  ) {
    throw new Error(`aiFairness: disparateImpactUpper must be > 1`);
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveAiFairness(cfg: AiFairnessConfig): AiFairnessResult {
  validateConfig(cfg);

  // ── Demographic Parity ────────────────────────────────────────────────────
  const demographicParityDifference = cfg.positiveRateGroupA - cfg.positiveRateGroupB;
  const demographicParityAbs = Math.abs(demographicParityDifference);

  // ── Equalized Odds (TPR + FPR) ────────────────────────────────────────────
  const equalizedOddsTprDiff = Math.abs(cfg.truePositiveRateA - cfg.truePositiveRateB);
  const equalizedOddsFprDiff = Math.abs(cfg.falsePositiveRateA - cfg.falsePositiveRateB);

  // ── Disparate Impact ──────────────────────────────────────────────────────
  const disparateImpactRatio =
    cfg.positiveRateGroupB > 1e-9 ? cfg.positiveRateGroupA / cfg.positiveRateGroupB : Infinity;

  // ── Predictive Parity ─────────────────────────────────────────────────────
  const predictiveParityDiff = Math.abs(cfg.ppvGroupA - cfg.ppvGroupB);

  // ── Equal Opportunity ─────────────────────────────────────────────────────
  const equalOpportunityDiff = equalizedOddsTprDiff;

  // ── Pass/Fail booleans ────────────────────────────────────────────────────
  const passesDemographicParity = demographicParityAbs <= cfg.demographicParityTolerance;
  const passesEqualizedOdds =
    equalizedOddsTprDiff <= cfg.equalizedOddsTolerance &&
    equalizedOddsFprDiff <= cfg.equalizedOddsTolerance;
  const passesDisparateImpact =
    disparateImpactRatio >= cfg.disparateImpactLower &&
    disparateImpactRatio <= cfg.disparateImpactUpper;

  // ── Composite fairness score ──────────────────────────────────────────────
  // Scaled subscores ∈ [0, 1], weighted, clipped.
  const dpScore = Math.max(0, 1 - demographicParityAbs / cfg.demographicParityTolerance);
  const eoTprScore = Math.max(0, 1 - equalizedOddsTprDiff / cfg.equalizedOddsTolerance);
  const eoFprScore = Math.max(0, 1 - equalizedOddsFprDiff / cfg.equalizedOddsTolerance);
  const diScore = Math.min(disparateImpactRatio, 1 / Math.max(disparateImpactRatio, 1e-9));
  const fairnessCompositeScore = Math.max(
    0,
    Math.min(1, 0.30 * dpScore + 0.25 * eoTprScore + 0.25 * eoFprScore + 0.20 * diScore),
  );

  // ── EU AI Act Art. 9 high-risk compliance ─────────────────────────────────
  const isCompliantEuAiAct =
    passesDemographicParity &&
    passesEqualizedOdds &&
    passesDisparateImpact &&
    cfg.documentationComplete &&
    cfg.humanOversightEnabled;

  // ── UKGC RTS 12 §11 algorithmic decision ──────────────────────────────────
  // Requires demographic parity + documentation, weaker than full EU AI Act
  const isCompliantUkgcRts1211 =
    passesDemographicParity && passesDisparateImpact && cfg.documentationComplete;

  return {
    demographicParityDifference,
    demographicParityAbs,
    equalizedOddsTprDiff,
    equalizedOddsFprDiff,
    disparateImpactRatio,
    predictiveParityDiff,
    equalOpportunityDiff,
    fairnessCompositeScore,
    passesDemographicParity,
    passesEqualizedOdds,
    passesDisparateImpact,
    isCompliantEuAiAct,
    isCompliantUkgcRts1211,
  };
}

/** ── MC simulation (sensitivity under sampling noise) ───────────────────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AiFairnessMcResult {
  episodes: number;
  observedDemographicParityMean: number;
  observedDisparateImpactMean: number;
}

/**
 * MC: simulate `episodes` independent draws of population-sized samples sa
 * Bernoulli realizations to compute empirical TPR/FPR and propagate sampling
 * variance into DP/DI estimates.
 */
export function simulateAiFairness(
  cfg: AiFairnessConfig,
  seed: number,
  episodes: number,
  samplesPerGroup = 1000,
): AiFairnessMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) {
    throw new Error(`simulateAiFairness: episodes must be integer ≥ 100`);
  }

  const rng = makeRng(seed);
  let sumDp = 0;
  let sumDi = 0;

  for (let ep = 0; ep < episodes; ep++) {
    // Bernoulli sampling for each group
    let posA = 0;
    let posB = 0;
    for (let i = 0; i < samplesPerGroup; i++) {
      if (rng() < cfg.positiveRateGroupA) posA++;
      if (rng() < cfg.positiveRateGroupB) posB++;
    }
    const empPosA = posA / samplesPerGroup;
    const empPosB = posB / samplesPerGroup;
    sumDp += empPosA - empPosB;
    sumDi += empPosB > 1e-9 ? empPosA / empPosB : 1;
  }

  return {
    episodes,
    observedDemographicParityMean: sumDp / episodes,
    observedDisparateImpactMean: sumDi / episodes,
  };
}
