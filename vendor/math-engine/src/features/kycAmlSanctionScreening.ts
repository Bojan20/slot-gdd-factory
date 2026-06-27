/**
 * W229 — Operator KYC/AML Sanction-Screening Risk Analyzer (86. solver).
 *
 * INDUSTRY-FIRST **AML/COMPLIANCE-side kernel** za UKGC LCCP 3.5.5 mandatory
 * sanctions screening (Oct 2024 update sa sens ≥ 99% mandate) + UK MLR 2017
 * (Money Laundering Regulations) + EU AMLD6 (Anti-Money-Laundering Directive
 * 6th iteration 2024) + AU AUSTRAC Act 2006 + DE Geldwäschegesetz §10 + FATF
 * Recommendation 10/11 (customer due diligence + suspicious transaction
 * reporting).
 *
 * Trigger landed posle 2024-2025 cascade UKGC enforcement actions:
 *   - Entain £18M AML failure (Oct 2024)
 *   - William Hill £19M AML failure (Aug 2023)
 *   - Betway £11M AML/RG failure (Mar 2023)
 *   - 888 £9.4M AML failure (Sep 2022)
 *
 * **86th closed-form solver — first AML/COMPLIANCE kernel** u portfolio. Sve
 * prior W001-W228 modeluju gaming-math/RG/operator-capital/CRM dimenzije; ovaj
 * modeluje **operator AML compliance economic exposure** — sanctioning hits,
 * false-positive/negative cost trade-off, Bayesian posterior on actual
 * match-rate, projected regulator fine exposure.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Daily new-player Poisson arrival**:
 *   λ_new = new player sign-ups per day (Poisson rate)
 *
 * **Sanction-list match base rate** (industry empirical ~ 0.01% to 0.1%):
 *   p_match = P(random new player is on OFAC/HMT/EU sanctions list)
 *
 * **Screening tool performance** (sensitivity, specificity):
 *   sens = P(screening flag | player IS on list)    -- typical 0.95-0.999
 *   spec = P(screening pass | player NOT on list)   -- typical 0.95-0.99
 *
 * **Daily False-Positive rate** (flags non-sanctioned, friction cost):
 *   FP_per_day = λ_new · (1 − p_match) · (1 − spec)
 *
 * **Daily False-Negative rate** (misses sanctioned, regulator fine exposure):
 *   FN_per_day = λ_new · p_match · (1 − sens)
 *
 * **Annual cost projection**:
 *   E[annual_FP_cost] = 365 · FP_per_day · cost_per_FP
 *   E[annual_FN_cost] = 365 · FN_per_day · cost_per_FN
 *   E[total_annual_AML_cost] = sum + recurring_screening_overhead
 *
 * **Bayesian posterior on actual match rate** (Beta-Binomial):
 *   Prior: p_match ~ Beta(α_prior, β_prior)
 *   Observed: k confirmed sanctions hits in n screenings
 *   Posterior: p_match | data ~ Beta(α_prior + k, β_prior + n − k)
 *   E[p_post] = (α + k) / (α + β + n)
 *
 * **Regulator fine exposure** (UKGC enforcement framework):
 *   Probability of detection by regulator given X true positives missed:
 *     P_detection_per_year = 1 − (1 − P_audit_per_year)^expected_missed
 *   Expected fine = P_detection · E[fine_per_violation]
 *
 * **UKGC LCCP 3.5.5 compliance**:
 *   isCompliantUkgcLccp35 = (sens ≥ 0.99 ∧ spec ≥ 0.95 ∧
 *                            screeningCadenceDays ≤ 1)
 *
 * **Composite AML risk score** ∈ [0, 1]:
 *   risk = 0.6 · normalized(FN_rate) + 0.4 · normalized(annual_fine_exposure)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148/W154/W157-W167   — player-side first-passage gaming math
 *   - W220-W226             — player-side responsible-gambling
 *   - W227                  — operator-side capital VaR/ES
 *   - W228                  — commercial LTV/CRM
 *   - W229 (this)           — operator-side AML/sanctions risk + compliance cost
 *
 * Naming: "sanctions screening", "KYC", "AML", "false positive/negative",
 * "Bayesian posterior", "UKGC LCCP 3.5.5" — generic FATF / UKGC / EU AMLD /
 * AU AUSTRAC compliance terminology. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface KycAmlConfig {
  /** Average new player sign-ups per day λ_new > 0. */
  expectedNewPlayersPerDay: number;
  /** Industry base sanctions match rate ∈ (0, 0.01). Typical 1e-4..1e-3. */
  sanctionsBaseMatchRate: number;
  /** Screening sensitivity ∈ (0, 1]. UKGC LCCP 3.5.5 ≥ 0.99. */
  screeningSensitivity: number;
  /** Screening specificity ∈ (0, 1]. */
  screeningSpecificity: number;
  /** Cost per false-positive (friction, agent time): typical £20-100. */
  costPerFalsePositive: number;
  /** Cost per false-negative (regulator fine + rep cost): typical £100K-£1M. */
  costPerFalseNegative: number;
  /** Recurring annual screening overhead (vendor cost). */
  annualScreeningOverhead: number;
  /** Beta prior α for match-rate Bayesian update. */
  betaPriorAlpha: number;
  /** Beta prior β for match-rate Bayesian update. */
  betaPriorBeta: number;
  /** Observed confirmed sanctions hits in screening history. */
  observedSanctionHits: number;
  /** Total screenings performed in same history (n). */
  totalScreeningsObserved: number;
  /** Regulator annual audit probability ∈ (0, 1]. UKGC typical 0.10-0.30. */
  regulatorAuditProbabilityPerYear: number;
  /** Expected fine per AML-violation (UKGC enforcement: £100K - £20M). */
  expectedFinePerViolation: number;
  /** Screening cadence in days (UKGC ≤ 1 mandatory; 1 = real-time). */
  screeningCadenceDays: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface KycAmlResult {
  /** FP screenings per day = λ_new · (1−p_match) · (1−spec). */
  falsePositivesPerDay: number;
  /** FN screenings per day = λ_new · p_match · (1−sens). */
  falseNegativesPerDay: number;
  /** Annual FP volume. */
  annualFalsePositives: number;
  /** Annual FN volume. */
  annualFalseNegatives: number;
  /** Annual FP cost = volume × c_fp. */
  annualFalsePositiveCost: number;
  /** Annual FN cost = volume × c_fn. */
  annualFalseNegativeCost: number;
  /** Total AML compliance cost = FP + FN + overhead. */
  totalAnnualComplianceCost: number;
  /** Posterior Beta mean on match rate. */
  posteriorMatchRateMean: number;
  /** Posterior projection of annual FN with refined match rate. */
  posteriorAnnualFalseNegatives: number;
  /** P(regulator detection per year) given expected missed sanctions. */
  probRegulatorDetectionPerYear: number;
  /** Expected annual regulator fine. */
  expectedAnnualFineExposure: number;
  /** Composite AML risk score ∈ [0, 1]. */
  amlRiskScore: number;
  /** UKGC LCCP 3.5.5 compliance boolean. */
  isCompliantUkgcLccp35: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: KycAmlConfig): void {
  if (!Number.isFinite(cfg.expectedNewPlayersPerDay) || cfg.expectedNewPlayersPerDay <= 0) {
    throw new Error(
      `kycAml: expectedNewPlayersPerDay must be > 0, got ${cfg.expectedNewPlayersPerDay}`,
    );
  }
  if (
    !Number.isFinite(cfg.sanctionsBaseMatchRate) ||
    cfg.sanctionsBaseMatchRate <= 0 ||
    cfg.sanctionsBaseMatchRate >= 0.1
  ) {
    throw new Error(
      `kycAml: sanctionsBaseMatchRate must be in (0, 0.1), got ${cfg.sanctionsBaseMatchRate}`,
    );
  }
  if (
    !Number.isFinite(cfg.screeningSensitivity) ||
    cfg.screeningSensitivity <= 0 ||
    cfg.screeningSensitivity > 1
  ) {
    throw new Error(
      `kycAml: screeningSensitivity must be in (0, 1], got ${cfg.screeningSensitivity}`,
    );
  }
  if (
    !Number.isFinite(cfg.screeningSpecificity) ||
    cfg.screeningSpecificity <= 0 ||
    cfg.screeningSpecificity > 1
  ) {
    throw new Error(
      `kycAml: screeningSpecificity must be in (0, 1], got ${cfg.screeningSpecificity}`,
    );
  }
  if (!Number.isFinite(cfg.costPerFalsePositive) || cfg.costPerFalsePositive < 0) {
    throw new Error(
      `kycAml: costPerFalsePositive must be ≥ 0, got ${cfg.costPerFalsePositive}`,
    );
  }
  if (!Number.isFinite(cfg.costPerFalseNegative) || cfg.costPerFalseNegative < 0) {
    throw new Error(
      `kycAml: costPerFalseNegative must be ≥ 0, got ${cfg.costPerFalseNegative}`,
    );
  }
  if (!Number.isFinite(cfg.annualScreeningOverhead) || cfg.annualScreeningOverhead < 0) {
    throw new Error(
      `kycAml: annualScreeningOverhead must be ≥ 0, got ${cfg.annualScreeningOverhead}`,
    );
  }
  if (!Number.isFinite(cfg.betaPriorAlpha) || cfg.betaPriorAlpha <= 0) {
    throw new Error(
      `kycAml: betaPriorAlpha must be > 0, got ${cfg.betaPriorAlpha}`,
    );
  }
  if (!Number.isFinite(cfg.betaPriorBeta) || cfg.betaPriorBeta <= 0) {
    throw new Error(
      `kycAml: betaPriorBeta must be > 0, got ${cfg.betaPriorBeta}`,
    );
  }
  if (
    !Number.isInteger(cfg.observedSanctionHits) ||
    cfg.observedSanctionHits < 0
  ) {
    throw new Error(
      `kycAml: observedSanctionHits must be integer ≥ 0, got ${cfg.observedSanctionHits}`,
    );
  }
  if (
    !Number.isInteger(cfg.totalScreeningsObserved) ||
    cfg.totalScreeningsObserved < cfg.observedSanctionHits
  ) {
    throw new Error(
      `kycAml: totalScreeningsObserved must be integer ≥ observedSanctionHits`,
    );
  }
  if (
    !Number.isFinite(cfg.regulatorAuditProbabilityPerYear) ||
    cfg.regulatorAuditProbabilityPerYear <= 0 ||
    cfg.regulatorAuditProbabilityPerYear > 1
  ) {
    throw new Error(
      `kycAml: regulatorAuditProbabilityPerYear must be in (0, 1], got ${cfg.regulatorAuditProbabilityPerYear}`,
    );
  }
  if (!Number.isFinite(cfg.expectedFinePerViolation) || cfg.expectedFinePerViolation < 0) {
    throw new Error(
      `kycAml: expectedFinePerViolation must be ≥ 0, got ${cfg.expectedFinePerViolation}`,
    );
  }
  if (
    !Number.isFinite(cfg.screeningCadenceDays) ||
    cfg.screeningCadenceDays <= 0
  ) {
    throw new Error(
      `kycAml: screeningCadenceDays must be > 0, got ${cfg.screeningCadenceDays}`,
    );
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveKycAml(cfg: KycAmlConfig): KycAmlResult {
  validateConfig(cfg);

  const pMatch = cfg.sanctionsBaseMatchRate;
  const sens = cfg.screeningSensitivity;
  const spec = cfg.screeningSpecificity;
  const lambda = cfg.expectedNewPlayersPerDay;

  // ── FP / FN rates ─────────────────────────────────────────────────────────
  const falsePositivesPerDay = lambda * (1 - pMatch) * (1 - spec);
  const falseNegativesPerDay = lambda * pMatch * (1 - sens);

  const annualFalsePositives = 365 * falsePositivesPerDay;
  const annualFalseNegatives = 365 * falseNegativesPerDay;

  // ── Cost projections ──────────────────────────────────────────────────────
  const annualFalsePositiveCost = annualFalsePositives * cfg.costPerFalsePositive;
  const annualFalseNegativeCost = annualFalseNegatives * cfg.costPerFalseNegative;
  const totalAnnualComplianceCost =
    annualFalsePositiveCost + annualFalseNegativeCost + cfg.annualScreeningOverhead;

  // ── Bayesian posterior on match rate ──────────────────────────────────────
  const posteriorAlpha = cfg.betaPriorAlpha + cfg.observedSanctionHits;
  const posteriorBeta =
    cfg.betaPriorBeta + (cfg.totalScreeningsObserved - cfg.observedSanctionHits);
  const posteriorMatchRateMean = posteriorAlpha / (posteriorAlpha + posteriorBeta);
  const posteriorFNPerDay = lambda * posteriorMatchRateMean * (1 - sens);
  const posteriorAnnualFalseNegatives = 365 * posteriorFNPerDay;

  // ── Regulator detection + fine exposure ───────────────────────────────────
  // P(detection given M missed sanctions over year) ≈ 1 − (1 − P_audit)^M
  // For small P_audit and small M, linear approx: M · P_audit.
  const expectedMissed = annualFalseNegatives;
  const auditProb = cfg.regulatorAuditProbabilityPerYear;
  const probRegulatorDetectionPerYear =
    expectedMissed > 0
      ? 1 - Math.pow(1 - auditProb, expectedMissed)
      : 0;
  const expectedAnnualFineExposure =
    probRegulatorDetectionPerYear * cfg.expectedFinePerViolation;

  // ── Composite AML risk score ──────────────────────────────────────────────
  // Heuristic: 0.6·norm(FN_rate) + 0.4·norm(fine_exposure_to_max_£20M)
  const normFn = Math.min(1, annualFalseNegatives / Math.max(1, expectedMissed + 10));
  const normFine = Math.min(1, expectedAnnualFineExposure / 20_000_000);
  const amlRiskScore = Math.max(0, Math.min(1, 0.6 * normFn + 0.4 * normFine));

  // ── UKGC LCCP 3.5.5 compliance ────────────────────────────────────────────
  const isCompliantUkgcLccp35 =
    sens >= 0.99 && spec >= 0.95 && cfg.screeningCadenceDays <= 1;

  return {
    falsePositivesPerDay,
    falseNegativesPerDay,
    annualFalsePositives,
    annualFalseNegatives,
    annualFalsePositiveCost,
    annualFalseNegativeCost,
    totalAnnualComplianceCost,
    posteriorMatchRateMean,
    posteriorAnnualFalseNegatives,
    probRegulatorDetectionPerYear,
    expectedAnnualFineExposure,
    amlRiskScore,
    isCompliantUkgcLccp35,
  };
}

/** ── MC simulation (cross-validates closed-form) ────────────────────────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonSampler(rng: () => number): (lambda: number) => number {
  return (lambda: number): number => {
    if (lambda <= 0) return 0;
    if (lambda > 30) {
      let u1 = 0;
      while (u1 < 1e-15) u1 = rng();
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
    }
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    while (p > L) {
      k++;
      p *= rng();
    }
    return k - 1;
  };
}

export interface KycAmlMcResult {
  episodes: number;
  observedAnnualFalsePositives: number;
  observedAnnualFalseNegatives: number;
  observedExpectedMissed: number;
}

/**
 * MC: simulate `episodes` independent year-long screening campaigns.
 * Per day: Poisson(λ_new) sign-ups, for each: Bernoulli(p_match), then
 * Bernoulli(sens) for true-positives or Bernoulli(1-spec) for false-positives.
 */
export function simulateKycAml(
  cfg: KycAmlConfig,
  seed: number,
  episodes: number,
  daysPerEpisode = 365,
): KycAmlMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 50) {
    throw new Error(`simulateKycAml: episodes must be integer ≥ 50, got ${episodes}`);
  }
  if (!Number.isInteger(daysPerEpisode) || daysPerEpisode < 1) {
    throw new Error(`simulateKycAml: daysPerEpisode must be integer ≥ 1`);
  }

  const rng = makeRng(seed);
  const poisson = poissonSampler(rng);

  const pMatch = cfg.sanctionsBaseMatchRate;
  const sens = cfg.screeningSensitivity;
  const spec = cfg.screeningSpecificity;

  let totalFP = 0;
  let totalFN = 0;

  for (let ep = 0; ep < episodes; ep++) {
    for (let day = 0; day < daysPerEpisode; day++) {
      const arrivals = poisson(cfg.expectedNewPlayersPerDay);
      for (let i = 0; i < arrivals; i++) {
        const isOnList = rng() < pMatch;
        if (isOnList) {
          // True positive iff screening flags
          if (rng() >= sens) totalFN++;
        } else {
          // False positive iff screening incorrectly flags
          if (rng() >= spec) totalFP++;
        }
      }
    }
  }

  return {
    episodes,
    observedAnnualFalsePositives: totalFP / episodes,
    observedAnnualFalseNegatives: totalFN / episodes,
    observedExpectedMissed: totalFN / episodes,
  };
}
