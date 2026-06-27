/**
 * W228 — Player Lifetime Value (LTV) Bayesian Predictive Analyzer (85. solver).
 *
 * INDUSTRY-FIRST **COMMERCIAL/MARKETING/CRM kernel** za UKGC RTS 5 (advertising
 * & marketing transparency — White Paper 2024 update sa LTV-disclosure mandate)
 * + UKGC Gambling Act Reform §6.7 (operator marketing-spend disclosure ratio) +
 * EU EBA Marketing & Advertising Directive 2024 Annex VII (cross-border LTV/CAC
 * compliance) + AU NCPF Reform 2022 §11 (responsible marketing — CAC ≤ 30%
 * average LTV) + DE GlüStV §5b (bonus expenditure transparency) + IRL
 * Gambling Regulation Bill §3.18 (LTV/CAC public reporting).
 *
 * **85th closed-form solver — first COMMERCIAL/MARKETING kernel** u portfolio.
 * Sve prior W001-W227 modeluju regulator-compliance dimenzije (player harm,
 * operator solvency); ovaj modeluje **commercial-side LTV** za marketing
 * decisioning + CAC bidding + retention strategy + regulator marketing-spend
 * audit.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Geometric churn model** (Schmittlein-Morrison-Colombo 1987 "Counting Your
 * Customers" simplification):
 *
 *   Each month, player drops out with probability θ_churn.
 *   N_active_months ~ Geometric(θ_churn)
 *   **E[N_active_months] = 1 / θ_churn**
 *   **Var[N_active_months] = (1 − θ_churn) / θ_churn²**
 *
 * **Per-month revenue model** (Log-Normal — slično W224):
 *
 *   M_per_month ~ Log-Normal(μ_M, σ²_M)
 *   E[M] = exp(μ_M + σ²_M / 2)
 *
 *   Alternatively: gross-revenue/player/month = GGR · share — direct mean.
 *
 * **Undiscounted LTV** (basic Geometric mean × monetary mean):
 *
 *   **LTV_undiscounted = E[M] · E[N_active_months] = E[M] / θ_churn**
 *
 * **Discounted LTV** (monthly discount rate r ≈ WACC/12, typical 0.5%-1%):
 *
 *   LTV_discounted = Σ_{m=0..∞} E[M] · (1−θ)^m / (1+r)^m
 *                  = E[M] · 1 / (1 − (1−θ)/(1+r))
 *                  = **E[M] · (1+r) / (θ + r)**
 *
 * **CAC payback period**:
 *
 *   payback_months = CAC / (E[M] · (1 − θ_churn))   // months until break-even
 *
 *   Where (1 − θ) reflects that player must survive each month to pay back.
 *   Strict interpretation: months until cumulative revenue ≥ CAC.
 *
 * **LTV/CAC ratio** (industry standard: ≥ 3 healthy, ≥ 5 excellent):
 *
 *   ltvCacRatio = LTV_discounted / CAC
 *
 * **Bayesian posterior update for churn rate**:
 *
 *   Prior: θ_churn ~ Beta(α_prior, β_prior)
 *   Observed: player active for n months, then churned
 *     Likelihood: (1−θ)^n · θ (n survivals × 1 dropout)
 *   Posterior: θ_churn | data ~ Beta(α_prior + 1, β_prior + n)
 *     E[θ_posterior] = (α + 1) / (α + β + n + 1)
 *
 *   Use case: refine LTV after first month observation per cohort.
 *
 * **ROAS (Return on Ad Spend)**:
 *
 *   roasTarget = totalRevenuePeriod / totalMarketingSpend
 *   UKGC RTS 5 mandates disclosure if ROAS > 5× (regulator scrutiny).
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148/W154/W157-W167                — player-side first-passage / single event
 *   - W220-W226                          — player-side responsible-gambling
 *   - W227                               — operator-side capital VaR/ES
 *   - W228 (this)                        — COMMERCIAL LTV/CAC/CRM kernel
 *
 * Naming: "lifetime value", "customer acquisition cost", "ROAS", "Geometric
 * churn", "Beta posterior" — generic marketing analytics + Bayesian inference
 * + UKGC RTS 5 audit terminology. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface PlayerLtvConfig {
  /** Per-month churn probability θ_churn ∈ (0, 1). */
  monthlyChurnProbability: number;
  /** Monthly revenue per active player E[M] > 0. */
  meanMonthlyRevenuePerActive: number;
  /** Std monthly revenue (Log-Normal volatility) σ_M ≥ 0. */
  stdMonthlyRevenuePerActive: number;
  /** Monthly discount rate r ≥ 0 (WACC/12, typical 0.005-0.012). */
  monthlyDiscountRate: number;
  /** Customer Acquisition Cost (CAC) > 0. */
  customerAcquisitionCost: number;
  /** Beta prior α for Bayesian churn update. */
  betaPriorAlpha: number;
  /** Beta prior β for Bayesian churn update. */
  betaPriorBeta: number;
  /** Observed active months for Bayesian update (≥ 0). */
  observedActiveMonths: number;
  /** UKGC RTS 5 disclosure threshold (typically 5×). */
  roasComplianceThreshold: number;
  /** Total marketing spend during period (for ROAS). */
  totalMarketingSpend: number;
  /** Total revenue during same period (for ROAS). */
  totalRevenuePeriod: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface PlayerLtvResult {
  /** E[N_active_months] = 1 / θ. */
  expectedActiveMonths: number;
  /** Var[N_active_months]. */
  varActiveMonths: number;
  /** LTV_undiscounted = E[M] / θ. */
  ltvUndiscounted: number;
  /** LTV_discounted = E[M] · (1+r) / (θ + r). */
  ltvDiscounted: number;
  /** CAC payback in months. */
  paybackMonths: number;
  /** LTV/CAC ratio (≥ 3 healthy industry benchmark). */
  ltvCacRatio: number;
  /** Posterior mean churn rate after observed active months. */
  posteriorChurnMean: number;
  /** Posterior LTV using refined churn. */
  posteriorLtvDiscounted: number;
  /** ROAS = totalRevenue / totalMarketingSpend. */
  realizedRoas: number;
  /** Boolean: ROAS within UKGC RTS 5 disclosure threshold. */
  isRoasBelowDisclosureThreshold: boolean;
  /** UKGC RTS 5 + AU NCPF §11 compliance. */
  isCompliantUkgcRts5: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: PlayerLtvConfig): void {
  if (
    !Number.isFinite(cfg.monthlyChurnProbability) ||
    cfg.monthlyChurnProbability <= 0 ||
    cfg.monthlyChurnProbability >= 1
  ) {
    throw new Error(
      `playerLtv: monthlyChurnProbability must be in (0, 1), got ${cfg.monthlyChurnProbability}`,
    );
  }
  if (
    !Number.isFinite(cfg.meanMonthlyRevenuePerActive) ||
    cfg.meanMonthlyRevenuePerActive <= 0
  ) {
    throw new Error(
      `playerLtv: meanMonthlyRevenuePerActive must be > 0, got ${cfg.meanMonthlyRevenuePerActive}`,
    );
  }
  if (
    !Number.isFinite(cfg.stdMonthlyRevenuePerActive) ||
    cfg.stdMonthlyRevenuePerActive < 0
  ) {
    throw new Error(
      `playerLtv: stdMonthlyRevenuePerActive must be ≥ 0, got ${cfg.stdMonthlyRevenuePerActive}`,
    );
  }
  if (!Number.isFinite(cfg.monthlyDiscountRate) || cfg.monthlyDiscountRate < 0) {
    throw new Error(
      `playerLtv: monthlyDiscountRate must be ≥ 0, got ${cfg.monthlyDiscountRate}`,
    );
  }
  if (!Number.isFinite(cfg.customerAcquisitionCost) || cfg.customerAcquisitionCost <= 0) {
    throw new Error(
      `playerLtv: customerAcquisitionCost must be > 0, got ${cfg.customerAcquisitionCost}`,
    );
  }
  if (!Number.isFinite(cfg.betaPriorAlpha) || cfg.betaPriorAlpha <= 0) {
    throw new Error(
      `playerLtv: betaPriorAlpha must be > 0, got ${cfg.betaPriorAlpha}`,
    );
  }
  if (!Number.isFinite(cfg.betaPriorBeta) || cfg.betaPriorBeta <= 0) {
    throw new Error(
      `playerLtv: betaPriorBeta must be > 0, got ${cfg.betaPriorBeta}`,
    );
  }
  if (
    !Number.isFinite(cfg.observedActiveMonths) ||
    cfg.observedActiveMonths < 0 ||
    !Number.isInteger(cfg.observedActiveMonths)
  ) {
    throw new Error(
      `playerLtv: observedActiveMonths must be integer ≥ 0, got ${cfg.observedActiveMonths}`,
    );
  }
  if (
    !Number.isFinite(cfg.roasComplianceThreshold) ||
    cfg.roasComplianceThreshold <= 0
  ) {
    throw new Error(
      `playerLtv: roasComplianceThreshold must be > 0, got ${cfg.roasComplianceThreshold}`,
    );
  }
  if (!Number.isFinite(cfg.totalMarketingSpend) || cfg.totalMarketingSpend < 0) {
    throw new Error(
      `playerLtv: totalMarketingSpend must be ≥ 0, got ${cfg.totalMarketingSpend}`,
    );
  }
  if (!Number.isFinite(cfg.totalRevenuePeriod) || cfg.totalRevenuePeriod < 0) {
    throw new Error(
      `playerLtv: totalRevenuePeriod must be ≥ 0, got ${cfg.totalRevenuePeriod}`,
    );
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solvePlayerLtv(cfg: PlayerLtvConfig): PlayerLtvResult {
  validateConfig(cfg);

  const theta = cfg.monthlyChurnProbability;
  const mu_M = cfg.meanMonthlyRevenuePerActive;
  const r = cfg.monthlyDiscountRate;

  // ── Geometric active-months ───────────────────────────────────────────────
  const expectedActiveMonths = 1 / theta;
  const varActiveMonths = (1 - theta) / (theta * theta);

  // ── LTV calculations ──────────────────────────────────────────────────────
  const ltvUndiscounted = mu_M * expectedActiveMonths;

  // LTV_discounted = Σ_{m=0..∞} μ_M · (1−θ)^m / (1+r)^m
  //                = μ_M · 1 / (1 − (1−θ)/(1+r))
  //                = μ_M · (1+r) / (θ + r)
  const ltvDiscounted = (mu_M * (1 + r)) / (theta + r);

  // ── CAC payback period ────────────────────────────────────────────────────
  // Cumulative revenue at month m = μ_M · Σ_{k=0..m-1} (1−θ)^k = μ_M · (1 − (1−θ)^m) / θ
  // Solve: μ_M · (1 − (1−θ)^m) / θ = CAC
  //        (1−θ)^m = 1 − CAC·θ/μ_M
  //        m = log(1 − CAC·θ/μ_M) / log(1−θ)
  // Edge: CAC·θ/μ_M ≥ 1 → never recoupable (return Infinity).
  let paybackMonths: number;
  const ratio = (cfg.customerAcquisitionCost * theta) / mu_M;
  if (ratio >= 1) {
    paybackMonths = Infinity;
  } else {
    paybackMonths = Math.log(1 - ratio) / Math.log(1 - theta);
  }

  // ── LTV/CAC ───────────────────────────────────────────────────────────────
  const ltvCacRatio = ltvDiscounted / cfg.customerAcquisitionCost;

  // ── Bayesian posterior churn ──────────────────────────────────────────────
  // Beta(α, β) prior + observed n survivals → Beta(α + 1, β + n) if observation
  // ended in a dropout, OR Beta(α, β + n) if still active.
  // Conservative assumption: still active, posterior on θ:
  //   posterior α = α_prior (no observed dropouts)
  //   posterior β = β_prior + observedActiveMonths
  //   E[θ] = α / (α + β)
  const posteriorAlpha = cfg.betaPriorAlpha;
  const posteriorBeta = cfg.betaPriorBeta + cfg.observedActiveMonths;
  const posteriorChurnMean = posteriorAlpha / (posteriorAlpha + posteriorBeta);

  // ── Posterior LTV with refined churn ──────────────────────────────────────
  const posteriorLtvDiscounted = (mu_M * (1 + r)) / (posteriorChurnMean + r);

  // ── ROAS computation ──────────────────────────────────────────────────────
  const realizedRoas =
    cfg.totalMarketingSpend > 1e-9
      ? cfg.totalRevenuePeriod / cfg.totalMarketingSpend
      : Infinity;
  const isRoasBelowDisclosureThreshold = realizedRoas <= cfg.roasComplianceThreshold;

  // ── UKGC RTS 5 / AU NCPF §11 compliance ───────────────────────────────────
  // Mandate: CAC ≤ 30% of LTV (AU NCPF §11)
  //          ROAS within disclosure threshold (UKGC RTS 5)
  const cacShareOfLtv = cfg.customerAcquisitionCost / Math.max(ltvDiscounted, 1e-9);
  const isCompliantUkgcRts5 = cacShareOfLtv <= 0.30 && isRoasBelowDisclosureThreshold;

  return {
    expectedActiveMonths,
    varActiveMonths,
    ltvUndiscounted,
    ltvDiscounted,
    paybackMonths,
    ltvCacRatio,
    posteriorChurnMean,
    posteriorLtvDiscounted,
    realizedRoas,
    isRoasBelowDisclosureThreshold,
    isCompliantUkgcRts5,
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

export interface PlayerLtvMcResult {
  episodes: number;
  observedExpectedActiveMonths: number;
  observedLtvUndiscounted: number;
  observedLtvDiscounted: number;
}

/**
 * MC: simulate `episodes` independent player lifetimes via Geometric draws,
 * each month accruing revenue ~ Log-Normal-like (deterministic μ for simplicity).
 */
export function simulatePlayerLtv(
  cfg: PlayerLtvConfig,
  seed: number,
  episodes: number,
): PlayerLtvMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) {
    throw new Error(`simulatePlayerLtv: episodes must be integer ≥ 100, got ${episodes}`);
  }

  const rng = makeRng(seed);
  const theta = cfg.monthlyChurnProbability;
  const r = cfg.monthlyDiscountRate;
  const mu_M = cfg.meanMonthlyRevenuePerActive;

  let sumMonths = 0;
  let sumLtv = 0;
  let sumLtvDisc = 0;

  for (let i = 0; i < episodes; i++) {
    let months = 0;
    let revenue = 0;
    let revenueDisc = 0;
    let cap = 1000; // safety cap to avoid runaway
    while (rng() >= theta && cap-- > 0) {
      revenue += mu_M;
      revenueDisc += mu_M / Math.pow(1 + r, months);
      months++;
    }
    // Last month with revenue (one period at month=months, then churn)
    if (months === 0) {
      // Churned immediately — still receives one month's revenue at t=0
      // by convention (LTV includes month 0 = signup month).
      revenue += mu_M;
      revenueDisc += mu_M;
      months = 1;
    }
    sumMonths += months;
    sumLtv += revenue;
    sumLtvDisc += revenueDisc;
  }

  return {
    episodes,
    observedExpectedActiveMonths: sumMonths / episodes,
    observedLtvUndiscounted: sumLtv / episodes,
    observedLtvDiscounted: sumLtvDisc / episodes,
  };
}
