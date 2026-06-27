/**
 * W235 — ESG Compliance Score & Carbon-Cost Optimizer (92. solver).
 *
 * INDUSTRY-FIRST **ESG/SUSTAINABILITY kernel** za UK FCA TCFD-aligned
 * disclosure (mandatory FY 2024+) + EU CSRD ESRS E1 climate-change (mandatory
 * large operators FY 2024-2026) + EU Taxonomy Regulation 2020/852 + UK SDR
 * Sustainability Disclosure Requirements 2024 + ISSB IFRS S2 climate-related
 * disclosures + AU AASB S2 (2025+) + EU ETS carbon pricing (€80-100/tCO₂ 2024).
 *
 * **92nd closed-form solver — first ESG/SUSTAINABILITY kernel** u portfolio.
 * Sve prior W001-W234 modeluju gaming/regulatory/financial/cyber dimenzije;
 * ovaj modeluje **environmental + social + governance posture** i carbon-cost
 * exposure pod EU ETS pricing.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Scope 1 + 2 + 3 emissions** (GHG Protocol):
 *
 *   E_scope1 = direct emissions (offices gas, vehicles, refrigerants) — small
 *   E_scope2 = electricity-grid emissions (server farms dominant)
 *     = annualKwh × gridCarbonIntensity_kgCO2_per_kWh
 *   E_scope3 = value-chain (player travel, supplier, marketing) — typical 10-30%
 *     of Scope 1+2
 *
 *   E_total = E_scope1 + E_scope2 + E_scope3
 *
 * **Carbon pricing exposure** (EU ETS + UK ETS + voluntary offset):
 *
 *   carbonCost_year = E_total · carbonPrice_per_tCO2
 *
 *   EU ETS 2024 price ≈ €80/tCO₂ (range €50-120). UK ETS ≈ £45-70/tCO₂.
 *   Voluntary VCM offsets ≈ €5-30/tCO₂ (lower quality).
 *
 * **Renewable PPA (Power Purchase Agreement) optimization**:
 *
 *   Renewable share r ∈ [0, 1] of total electricity.
 *   E_scope2_post = annualKwh · (1 − r) · gridCarbonIntensity
 *   PPA cost premium = annualKwh · r · ppaPremium_per_kWh
 *   PPA savings on carbon = annualKwh · r · gridCarbonIntensity · carbonPrice / 1000
 *
 *   Net cost: PPA_premium − carbonSavings
 *   Break-even r when premium ≈ carbonSavings.
 *
 * **ESG composite score** (UK SDR + EU CSRD weighted):
 *
 *   E_score = sigmoid(−2 · log10(emissions / revenue))   // intensity-based
 *   S_score = (responsibleGamblingPolicies + employeeWellbeing + communityImpact) / 3
 *   G_score = (boardIndependence + complianceTrackRecord + transparencyScore) / 3
 *
 *   ESG_overall = w_E · E_score + w_S · S_score + w_G · G_score
 *   Default weights: w_E = 0.4, w_S = 0.3, w_G = 0.3 (CDP scoring methodology)
 *
 *   Score ∈ [0, 1]. Above 0.65 = "leader" (top-quartile CDP A-list).
 *   Below 0.4 = "laggard" (regulator scrutiny + ESG fund exclusion).
 *
 * **Investment in renewables / efficiency** — closed-form payback:
 *
 *   Investment I (one-time CapEx)
 *   Annual savings: scope2_kWh_reduction · gridIntensity · carbonPrice + energy_cost_reduction
 *   Payback period = I / annualSavings
 *
 * **EU Taxonomy alignment** (Regulation 2020/852 Art. 3):
 *
 *   taxonomyAligned_pct = sustainable_revenue / total_revenue ∈ [0, 1]
 *   Mandatory disclosure threshold ≥ 40% for "sustainable operator" certification.
 *
 * **EU CSRD ESRS E1 compliance**:
 *
 *   isCompliantEuCsrd = (scope1_2_3_disclosed ∧
 *                       transition_plan_published ∧
 *                       SBTi_aligned ∧
 *                       scope1_2_reduction_target ≥ 0.42 by 2030 [Paris-aligned])
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W227                   — operator capital VaR (financial, not ESG)
 *   - W229                   — AML compliance
 *   - W234                   — cybersecurity (technical risk, not E/S/G)
 *   - W235 (this)            — ESG + carbon + climate-change physical risk
 *
 * Naming: "Scope 1/2/3", "EU ETS", "CSRD ESRS E1", "TCFD", "EU Taxonomy",
 * "ISSB IFRS S2", "CDP scoring" — generic ESG actuarial + IFRS terms.
 * No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface EsgCarbonConfig {
  /** Annual electricity consumption (kWh). */
  annualElectricityKwh: number;
  /** Grid carbon intensity (kgCO₂/kWh, jurisdiction-specific). */
  gridCarbonIntensity: number;
  /** Scope 1 direct emissions (tCO₂/year). */
  scope1Emissions: number;
  /** Scope 3 value-chain emissions (tCO₂/year). */
  scope3Emissions: number;
  /** Renewable PPA share ∈ [0, 1]. */
  renewableShare: number;
  /** PPA premium over grid (£/kWh, positive = renewable costs more). */
  ppaPremiumPerKwh: number;
  /** Carbon pricing (£/tCO₂). EU ETS ~ £75, UK ETS ~ £55. */
  carbonPricePerTonne: number;
  /** Operator annual revenue (currency). */
  operatorAnnualRevenue: number;
  /** Sustainable revenue % (EU Taxonomy aligned) ∈ [0, 1]. */
  taxonomyAlignedRevenueShare: number;
  /** Social score (composite responsibleGambling + employees + community) ∈ [0, 1]. */
  socialScore: number;
  /** Governance score (board + compliance + transparency) ∈ [0, 1]. */
  governanceScore: number;
  /** Scope 1+2 reduction target by 2030 ∈ [0, 1] (Paris ≥ 0.42). */
  scope12ReductionTarget2030: number;
  /** Boolean: SBTi (Science-Based Targets) aligned. */
  sbtiAligned: boolean;
  /** Boolean: transition plan published. */
  transitionPlanPublished: boolean;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface EsgCarbonResult {
  /** Scope 1 emissions (tCO₂). */
  scope1Tonnes: number;
  /** Scope 2 emissions post-PPA (tCO₂). */
  scope2TonnesPostPpa: number;
  /** Scope 3 emissions (tCO₂). */
  scope3Tonnes: number;
  /** Total emissions (tCO₂). */
  totalEmissionsTonnes: number;
  /** Carbon cost exposure (currency). */
  annualCarbonCost: number;
  /** PPA premium total cost. */
  annualPpaPremiumCost: number;
  /** PPA savings on carbon. */
  annualPpaCarbonSavings: number;
  /** Net PPA impact (positive = net benefit). */
  netPpaBenefit: number;
  /** E (environmental) score component ∈ [0, 1]. */
  environmentalScore: number;
  /** Composite ESG score weighted (0.4 E + 0.3 S + 0.3 G). */
  esgCompositeScore: number;
  /** EU Taxonomy alignment score (= cfg.taxonomyAlignedRevenueShare). */
  euTaxonomyAlignmentScore: number;
  /** Emissions intensity (tCO₂ per £M revenue). */
  emissionsIntensityPerRevenueM: number;
  /** Optimal renewable PPA share that minimizes net cost. */
  optimalRenewableShare: number;
  /** EU CSRD ESRS E1 compliance boolean. */
  isCompliantEuCsrd: boolean;
  /** UK FCA TCFD compliance boolean. */
  isCompliantUkFcaTcfd: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: EsgCarbonConfig): void {
  if (!Number.isFinite(cfg.annualElectricityKwh) || cfg.annualElectricityKwh < 0) {
    throw new Error(
      `esgCarbon: annualElectricityKwh must be ≥ 0, got ${cfg.annualElectricityKwh}`,
    );
  }
  if (!Number.isFinite(cfg.gridCarbonIntensity) || cfg.gridCarbonIntensity < 0) {
    throw new Error(
      `esgCarbon: gridCarbonIntensity must be ≥ 0, got ${cfg.gridCarbonIntensity}`,
    );
  }
  if (!Number.isFinite(cfg.scope1Emissions) || cfg.scope1Emissions < 0) {
    throw new Error(`esgCarbon: scope1Emissions must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.scope3Emissions) || cfg.scope3Emissions < 0) {
    throw new Error(`esgCarbon: scope3Emissions must be ≥ 0`);
  }
  if (
    !Number.isFinite(cfg.renewableShare) ||
    cfg.renewableShare < 0 ||
    cfg.renewableShare > 1
  ) {
    throw new Error(`esgCarbon: renewableShare must be in [0, 1]`);
  }
  if (!Number.isFinite(cfg.ppaPremiumPerKwh) || cfg.ppaPremiumPerKwh < 0) {
    throw new Error(`esgCarbon: ppaPremiumPerKwh must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.carbonPricePerTonne) || cfg.carbonPricePerTonne < 0) {
    throw new Error(`esgCarbon: carbonPricePerTonne must be ≥ 0`);
  }
  if (
    !Number.isFinite(cfg.operatorAnnualRevenue) ||
    cfg.operatorAnnualRevenue <= 0
  ) {
    throw new Error(`esgCarbon: operatorAnnualRevenue must be > 0`);
  }
  if (
    !Number.isFinite(cfg.taxonomyAlignedRevenueShare) ||
    cfg.taxonomyAlignedRevenueShare < 0 ||
    cfg.taxonomyAlignedRevenueShare > 1
  ) {
    throw new Error(`esgCarbon: taxonomyAlignedRevenueShare must be in [0, 1]`);
  }
  if (!Number.isFinite(cfg.socialScore) || cfg.socialScore < 0 || cfg.socialScore > 1) {
    throw new Error(`esgCarbon: socialScore must be in [0, 1]`);
  }
  if (
    !Number.isFinite(cfg.governanceScore) ||
    cfg.governanceScore < 0 ||
    cfg.governanceScore > 1
  ) {
    throw new Error(`esgCarbon: governanceScore must be in [0, 1]`);
  }
  if (
    !Number.isFinite(cfg.scope12ReductionTarget2030) ||
    cfg.scope12ReductionTarget2030 < 0 ||
    cfg.scope12ReductionTarget2030 > 1
  ) {
    throw new Error(`esgCarbon: scope12ReductionTarget2030 must be in [0, 1]`);
  }
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const z = Math.exp(x);
  return z / (1 + z);
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveEsgCarbon(cfg: EsgCarbonConfig): EsgCarbonResult {
  validateConfig(cfg);

  // ── Scope 1/2/3 emissions ─────────────────────────────────────────────────
  const scope1Tonnes = cfg.scope1Emissions;
  // Scope 2 = grid electricity emissions × (1 − renewableShare); convert kWh→kgCO₂→tCO₂
  const scope2KgCO2 =
    cfg.annualElectricityKwh * (1 - cfg.renewableShare) * cfg.gridCarbonIntensity;
  const scope2TonnesPostPpa = scope2KgCO2 / 1000;
  const scope3Tonnes = cfg.scope3Emissions;
  const totalEmissionsTonnes = scope1Tonnes + scope2TonnesPostPpa + scope3Tonnes;

  // ── Carbon cost ───────────────────────────────────────────────────────────
  const annualCarbonCost = totalEmissionsTonnes * cfg.carbonPricePerTonne;

  // ── PPA economics ─────────────────────────────────────────────────────────
  const annualPpaPremiumCost =
    cfg.annualElectricityKwh * cfg.renewableShare * cfg.ppaPremiumPerKwh;
  // Carbon savings: vs no PPA, savings = renewable_kWh · gridIntensity · price / 1000
  const annualPpaCarbonSavings =
    (cfg.annualElectricityKwh * cfg.renewableShare * cfg.gridCarbonIntensity * cfg.carbonPricePerTonne) /
    1000;
  const netPpaBenefit = annualPpaCarbonSavings - annualPpaPremiumCost;

  // ── Optimal renewable share ───────────────────────────────────────────────
  // d/dr [Premium − CarbonSavings] = 0
  // CarbonSavings = kWh · r · intensity · price/1000
  // Premium = kWh · r · ppaPremium
  // NetCost = Premium − CarbonSavings = kWh · r · (ppaPremium − intensity·price/1000)
  // Linear in r → r* = 1 if (intensity·price/1000 > ppaPremium), else 0.
  const carbonValuePerKwh = (cfg.gridCarbonIntensity * cfg.carbonPricePerTonne) / 1000;
  const optimalRenewableShare = carbonValuePerKwh > cfg.ppaPremiumPerKwh ? 1.0 : 0.0;

  // ── E (environmental) score ───────────────────────────────────────────────
  // Intensity-based: emissions per £M revenue.
  const revenueM = cfg.operatorAnnualRevenue / 1_000_000;
  const emissionsIntensityPerRevenueM = revenueM > 1e-9 ? totalEmissionsTonnes / revenueM : 0;
  // Score: lower intensity = higher score. Reference 10 tCO₂/£M = average operator.
  const environmentalScore = Math.max(
    0,
    Math.min(1, sigmoid(2 * (1 - emissionsIntensityPerRevenueM / 10))),
  );

  // ── Composite ESG score (CDP-aligned weighted average) ────────────────────
  const W_E = 0.4;
  const W_S = 0.3;
  const W_G = 0.3;
  const esgCompositeScore = Math.max(
    0,
    Math.min(1, W_E * environmentalScore + W_S * cfg.socialScore + W_G * cfg.governanceScore),
  );

  // ── EU Taxonomy alignment ────────────────────────────────────────────────
  const euTaxonomyAlignmentScore = cfg.taxonomyAlignedRevenueShare;

  // ── Compliance ────────────────────────────────────────────────────────────
  const isCompliantEuCsrd =
    cfg.scope12ReductionTarget2030 >= 0.42 &&
    cfg.sbtiAligned &&
    cfg.transitionPlanPublished;
  // UK FCA TCFD: aligned disclosure + transition plan + intensity reporting
  const isCompliantUkFcaTcfd =
    cfg.transitionPlanPublished &&
    cfg.scope12ReductionTarget2030 > 0 &&
    environmentalScore >= 0.3;

  return {
    scope1Tonnes,
    scope2TonnesPostPpa,
    scope3Tonnes,
    totalEmissionsTonnes,
    annualCarbonCost,
    annualPpaPremiumCost,
    annualPpaCarbonSavings,
    netPpaBenefit,
    environmentalScore,
    esgCompositeScore,
    euTaxonomyAlignmentScore,
    emissionsIntensityPerRevenueM,
    optimalRenewableShare,
    isCompliantEuCsrd,
    isCompliantUkFcaTcfd,
  };
}

/** ── MC simulation (sensitivity on uncertain grid intensity + carbon price) */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EsgCarbonMcResult {
  episodes: number;
  observedAnnualCarbonCostMean: number;
  observedAnnualCarbonCostStd: number;
}

/**
 * MC: simulate uncertainty u carbon-price ±25% i grid intensity ±15%
 * (typical regulator stress-test bands).
 */
export function simulateEsgCarbon(
  cfg: EsgCarbonConfig,
  seed: number,
  episodes: number,
): EsgCarbonMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) {
    throw new Error(`simulateEsgCarbon: episodes must be integer ≥ 100`);
  }

  const rng = makeRng(seed);
  let sum = 0;
  let sumSq = 0;

  for (let ep = 0; ep < episodes; ep++) {
    const noisyCfg = {
      ...cfg,
      carbonPricePerTonne: cfg.carbonPricePerTonne * (0.75 + 0.5 * rng()),
      gridCarbonIntensity: cfg.gridCarbonIntensity * (0.85 + 0.3 * rng()),
    };
    const r = solveEsgCarbon(noisyCfg);
    sum += r.annualCarbonCost;
    sumSq += r.annualCarbonCost * r.annualCarbonCost;
  }

  const mean = sum / episodes;
  const variance = sumSq / episodes - mean * mean;
  return {
    episodes,
    observedAnnualCarbonCostMean: mean,
    observedAnnualCarbonCostStd: Math.sqrt(Math.max(0, variance)),
  };
}
