/**
 * W234 — Cybersecurity Breach Cost Quantification Analyzer (91. solver).
 *
 * INDUSTRY-FIRST **CYBERSECURITY/RESILIENCE kernel** za EU NIS2 Directive
 * 2022/2555 (mandatory 2024 — essential services za gambling-class operators)
 * + UK Cyber Resilience Act 2025 (planned, Q3 2025 effective) + UKGC LCCP 4.1
 * (data security mandate) + ICO GDPR enforcement (Marriott £18.4M + BA £20M
 * + Ticketmaster £1.25M data-breach fines) + AU Privacy Act 2024 amendments
 * + NIST SP 800-53 Rev 5 + FedRAMP cybersecurity baseline.
 *
 * **91st closed-form solver — first CYBERSECURITY kernel** u portfolio. Sve
 * prior W001-W233 modeluju gaming/regulatory/financial/operational dimenzije;
 * ovaj modeluje **digital-resilience economic exposure** — breach probability
 * × heavy-tail Pareto severity + investment ROI optimization + regulator
 * fine exposure.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Breach event arrival** (Poisson process, IBM Cost of Data Breach 2024):
 *
 *   N_breaches ~ Poisson(λ_annual)
 *   λ_annual = expected annual breach count (typical 0.05-0.5 per operator)
 *
 * **Per-breach cost** (Pareto heavy-tail, Eling-Schnell 2016 cybersecurity
 * actuarial study):
 *
 *   C ~ Pareto(α, x_m)
 *   PDF: f(c) = α · x_m^α / c^(α+1) for c ≥ x_m
 *   E[C] = α·x_m / (α−1) for α > 1
 *   Var[C] = α·x_m² / ((α−1)²·(α−2)) for α > 2
 *
 *   Industry empirical (IBM 2024):
 *     median breach cost = $4.88M
 *     α ≈ 1.5-2.5 (heavy-tail dominant)
 *     x_m = scale parameter (typical $500K-$2M)
 *
 * **Compound Poisson aggregate loss**:
 *
 *   S = Σ_{i=1..N} C_i  ~ Compound Poisson
 *   E[S] = λ · E[C]
 *   Var[S] = λ · E[C²] = λ · (Var[C] + E[C]²)
 *
 * **T-year VaR via CLT** (valid for λ·T ≥ 5):
 *
 *   E[S_T] = λ · T · E[C]
 *   sd[S_T] = sqrt(λ · T · E[C²])
 *   **VaR_α(T) = E[S_T] + z_α · sd[S_T]**
 *
 *   For heavy-tail Pareto (α < 2): CLT under-estimates tail; use Panjer
 *   recursion or POT-EVT for proper extreme-value bound.
 *
 * **Security investment ROI**:
 *
 *   Investment I reduces breach rate by factor f(I):
 *     λ_post = λ_pre · exp(−k · I)   (exponential decay model)
 *     k = effectiveness coefficient (operator-tunable, typical 1e-8 per £)
 *
 *   Expected loss reduction:
 *     ΔE[S] = (λ_pre − λ_post) · T · E[C]
 *
 *   ROI = (ΔE[S] − I) / I
 *
 * **ICO/UKGC fine exposure** (post-breach regulator action):
 *
 *   GDPR Art. 83(5): up to 4% of annual turnover (Marriott £18.4M from
 *   £4B revenue = ~0.46%; BA £20M from £13.5B = ~0.15%)
 *
 *   Probability of regulator fine given breach:
 *     P_fined = sigmoid(breachSeverity − threshold)
 *   Simplified: P_fined ≈ 0.30-0.70 for material breach.
 *
 *   E[annual_fine] = λ_annual · P_fined · E[fine | fined]
 *
 * **Compliance score**:
 *
 *   complianceScore = sigmoid(−log10(λ_post / λ_baseline)) ∈ [0, 1]
 *   higher = better cyber-resilience posture
 *
 * **NIS2 compliance**:
 *   NIS2 Art. 21 requires "appropriate technical and organisational measures":
 *     isCompliantNis2 = (λ_post ≤ 0.10/year ∧ investment ≥ 1% revenue ∧
 *                       breachResponseTimeHours ≤ 72)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W227                    — operator capital VaR (gaming variance, not cyber)
 *   - W229                    — AML compliance (not cybersecurity)
 *   - W232                    — FX risk (financial, not cyber)
 *   - W234 (this)             — CYBERSECURITY breach Poisson + Pareto severity
 *
 * Naming: "NIS2", "breach cost", "compound Poisson", "Pareto severity",
 * "ICO GDPR", "ROI" — generic cybersecurity actuarial + NIS2/GDPR terms.
 * No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface CybersecurityBreachConfig {
  /** Annual breach Poisson rate λ > 0. Typical 0.05-0.5. */
  annualBreachRate: number;
  /** Pareto α shape ∈ (1.1, 5). Industry typical 1.5-2.5. */
  paretoAlpha: number;
  /** Pareto x_m scale > 0 (currency). Typical $500K-$2M. */
  paretoScale: number;
  /** Security investment level (currency). */
  annualSecurityInvestment: number;
  /** Investment effectiveness coefficient k. Typical 1e-8 to 1e-7. */
  investmentEffectivenessCoeff: number;
  /** Operator annual revenue (for GDPR fine cap). */
  operatorAnnualRevenue: number;
  /** GDPR fine cap as fraction of revenue (Art. 83(5) default 0.04). */
  gdprFineCapFraction: number;
  /** P(regulator fines given breach) ∈ (0, 1). Typical 0.30-0.70. */
  probFineGivenBreach: number;
  /** Mean fine when fined (currency, conditional on fining). */
  expectedFineWhenFined: number;
  /** Time horizon (years). */
  horizonYears: number;
  /** VaR confidence level ∈ (0.5, 1). */
  varConfidenceLevel: number;
  /** Breach response time SLA (hours, NIS2 ≤ 72h). */
  breachResponseTimeHours: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface CybersecurityBreachResult {
  /** Pre-investment baseline breach rate (= cfg.annualBreachRate). */
  baselineBreachRate: number;
  /** Post-investment effective breach rate. */
  effectiveBreachRate: number;
  /** Pareto E[C] = α·x_m/(α−1). */
  expectedCostPerBreach: number;
  /** Pareto Var[C] = α·x_m²/((α−1)²·(α−2)) when α > 2. */
  varianceCostPerBreach: number;
  /** Compound Poisson E[S_T]. */
  expectedAnnualLoss: number;
  /** Compound Poisson sd[S_T]. */
  stdAnnualLoss: number;
  /** T-year aggregate VaR_α. */
  varAlphaTHorizon: number;
  /** Expected investment loss reduction over horizon. */
  expectedLossReduction: number;
  /** Security investment ROI = (ΔE[S] − I)/I. */
  securityInvestmentROI: number;
  /** Per-year expected regulator fine exposure. */
  expectedAnnualFineExposure: number;
  /** Capped fine = min(expected, GDPR 4% cap). */
  cappedAnnualFineExposure: number;
  /** Composite cyber-resilience compliance score ∈ [0, 1]. */
  cyberResilienceScore: number;
  /** NIS2 Art. 21 compliance. */
  isCompliantNis2: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: CybersecurityBreachConfig): void {
  if (!Number.isFinite(cfg.annualBreachRate) || cfg.annualBreachRate <= 0) {
    throw new Error(
      `cybersecurityBreach: annualBreachRate must be > 0, got ${cfg.annualBreachRate}`,
    );
  }
  if (
    !Number.isFinite(cfg.paretoAlpha) ||
    cfg.paretoAlpha <= 1.1 ||
    cfg.paretoAlpha > 5
  ) {
    throw new Error(
      `cybersecurityBreach: paretoAlpha must be in (1.1, 5], got ${cfg.paretoAlpha}`,
    );
  }
  if (!Number.isFinite(cfg.paretoScale) || cfg.paretoScale <= 0) {
    throw new Error(
      `cybersecurityBreach: paretoScale must be > 0, got ${cfg.paretoScale}`,
    );
  }
  if (
    !Number.isFinite(cfg.annualSecurityInvestment) ||
    cfg.annualSecurityInvestment < 0
  ) {
    throw new Error(
      `cybersecurityBreach: annualSecurityInvestment must be ≥ 0, got ${cfg.annualSecurityInvestment}`,
    );
  }
  if (
    !Number.isFinite(cfg.investmentEffectivenessCoeff) ||
    cfg.investmentEffectivenessCoeff < 0
  ) {
    throw new Error(
      `cybersecurityBreach: investmentEffectivenessCoeff must be ≥ 0, got ${cfg.investmentEffectivenessCoeff}`,
    );
  }
  if (!Number.isFinite(cfg.operatorAnnualRevenue) || cfg.operatorAnnualRevenue <= 0) {
    throw new Error(
      `cybersecurityBreach: operatorAnnualRevenue must be > 0, got ${cfg.operatorAnnualRevenue}`,
    );
  }
  if (
    !Number.isFinite(cfg.gdprFineCapFraction) ||
    cfg.gdprFineCapFraction <= 0 ||
    cfg.gdprFineCapFraction > 0.1
  ) {
    throw new Error(
      `cybersecurityBreach: gdprFineCapFraction must be in (0, 0.1], got ${cfg.gdprFineCapFraction}`,
    );
  }
  if (
    !Number.isFinite(cfg.probFineGivenBreach) ||
    cfg.probFineGivenBreach <= 0 ||
    cfg.probFineGivenBreach > 1
  ) {
    throw new Error(
      `cybersecurityBreach: probFineGivenBreach must be in (0, 1], got ${cfg.probFineGivenBreach}`,
    );
  }
  if (!Number.isFinite(cfg.expectedFineWhenFined) || cfg.expectedFineWhenFined < 0) {
    throw new Error(
      `cybersecurityBreach: expectedFineWhenFined must be ≥ 0, got ${cfg.expectedFineWhenFined}`,
    );
  }
  if (!Number.isFinite(cfg.horizonYears) || cfg.horizonYears <= 0) {
    throw new Error(
      `cybersecurityBreach: horizonYears must be > 0, got ${cfg.horizonYears}`,
    );
  }
  if (
    !Number.isFinite(cfg.varConfidenceLevel) ||
    cfg.varConfidenceLevel <= 0.5 ||
    cfg.varConfidenceLevel >= 1
  ) {
    throw new Error(
      `cybersecurityBreach: varConfidenceLevel must be in (0.5, 1), got ${cfg.varConfidenceLevel}`,
    );
  }
  if (!Number.isFinite(cfg.breachResponseTimeHours) || cfg.breachResponseTimeHours <= 0) {
    throw new Error(
      `cybersecurityBreach: breachResponseTimeHours must be > 0, got ${cfg.breachResponseTimeHours}`,
    );
  }
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

function normQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Numerically stable sigmoid. */
function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveCybersecurityBreach(
  cfg: CybersecurityBreachConfig,
): CybersecurityBreachResult {
  validateConfig(cfg);

  // ── Investment-adjusted breach rate ───────────────────────────────────────
  const baselineBreachRate = cfg.annualBreachRate;
  const effectiveBreachRate =
    baselineBreachRate * Math.exp(-cfg.investmentEffectivenessCoeff * cfg.annualSecurityInvestment);

  // ── Pareto moments ────────────────────────────────────────────────────────
  const alpha = cfg.paretoAlpha;
  const xm = cfg.paretoScale;
  const expectedCostPerBreach = (alpha * xm) / (alpha - 1);

  let varianceCostPerBreach: number;
  if (alpha > 2) {
    varianceCostPerBreach = (alpha * xm * xm) / ((alpha - 1) * (alpha - 1) * (alpha - 2));
  } else {
    // Heavy-tail: variance undefined. Use truncated upper bound for practical purposes.
    varianceCostPerBreach = (alpha * xm * xm) / Math.max(0.01, (alpha - 1) * (alpha - 1) * 0.01);
  }

  // ── Compound Poisson aggregate ────────────────────────────────────────────
  const T = cfg.horizonYears;
  const expectedAnnualLoss = effectiveBreachRate * T * expectedCostPerBreach;
  // E[S^2] = λ·T·E[C²] + (λ·T·E[C])² (variance + mean²)
  // Var[S] = λ·T·E[C²] = λ·T·(Var[C] + E[C]²)
  const eC2 = varianceCostPerBreach + expectedCostPerBreach * expectedCostPerBreach;
  const stdAnnualLoss = Math.sqrt(effectiveBreachRate * T * eC2);

  // ── T-year VaR via CLT ────────────────────────────────────────────────────
  const zAlpha = normQuantile(cfg.varConfidenceLevel);
  const varAlphaTHorizon = expectedAnnualLoss + zAlpha * stdAnnualLoss;

  // ── Investment ROI ────────────────────────────────────────────────────────
  // ΔE[S] = (λ_pre − λ_post) · T · E[C]
  const expectedLossReduction =
    (baselineBreachRate - effectiveBreachRate) * T * expectedCostPerBreach;
  const securityInvestmentROI =
    cfg.annualSecurityInvestment > 1e-9
      ? (expectedLossReduction - cfg.annualSecurityInvestment * T) /
        (cfg.annualSecurityInvestment * T)
      : 0;

  // ── Regulator fine exposure ──────────────────────────────────────────────
  const expectedAnnualFineExposure =
    effectiveBreachRate * cfg.probFineGivenBreach * cfg.expectedFineWhenFined;
  const fineCap = cfg.operatorAnnualRevenue * cfg.gdprFineCapFraction;
  const cappedAnnualFineExposure = Math.min(expectedAnnualFineExposure, fineCap);

  // ── Cyber resilience composite score ─────────────────────────────────────
  // higher = better posture (low breach rate, high investment relative to revenue)
  const investmentRatio = cfg.annualSecurityInvestment / cfg.operatorAnnualRevenue;
  const rateReductionScore = sigmoid(
    Math.log10(Math.max(baselineBreachRate / Math.max(effectiveBreachRate, 1e-9), 1.001)),
  );
  const investmentScore = sigmoid(50 * (investmentRatio - 0.01)); // 1% revenue baseline
  const cyberResilienceScore = Math.max(0, Math.min(1, 0.5 * rateReductionScore + 0.5 * investmentScore));

  // ── NIS2 Art. 21 compliance ───────────────────────────────────────────────
  const isCompliantNis2 =
    effectiveBreachRate <= 0.10 &&
    investmentRatio >= 0.01 &&
    cfg.breachResponseTimeHours <= 72;

  return {
    baselineBreachRate,
    effectiveBreachRate,
    expectedCostPerBreach,
    varianceCostPerBreach,
    expectedAnnualLoss,
    stdAnnualLoss,
    varAlphaTHorizon,
    expectedLossReduction,
    securityInvestmentROI,
    expectedAnnualFineExposure,
    cappedAnnualFineExposure,
    cyberResilienceScore,
    isCompliantNis2,
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
  return (lambda) => {
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

/** Pareto sampler via inverse-CDF: F^(-1)(u) = x_m / (1−u)^(1/α). */
function paretoSampler(alpha: number, xm: number, rng: () => number): () => number {
  return () => {
    let u = rng();
    while (u >= 0.999999) u = rng(); // avoid Infinity
    return xm / Math.pow(1 - u, 1 / alpha);
  };
}

export interface CybersecurityBreachMcResult {
  episodes: number;
  observedAnnualLossMean: number;
  observedAnnualLossStd: number;
  observedVarAlphaTHorizon: number;
}

/**
 * MC: simulate `episodes` independent T-year cybersecurity loss campaigns.
 * Compound Poisson: Poisson breach count × Pareto severities.
 */
export function simulateCybersecurityBreach(
  cfg: CybersecurityBreachConfig,
  seed: number,
  episodes: number,
): CybersecurityBreachMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) {
    throw new Error(
      `simulateCybersecurityBreach: episodes must be integer ≥ 100, got ${episodes}`,
    );
  }

  const rng = makeRng(seed);
  const poisson = poissonSampler(rng);
  const pareto = paretoSampler(cfg.paretoAlpha, cfg.paretoScale, rng);

  const effectiveRate =
    cfg.annualBreachRate * Math.exp(-cfg.investmentEffectivenessCoeff * cfg.annualSecurityInvestment);

  const losses: number[] = new Array(episodes);
  let sumLoss = 0;
  let sumSqLoss = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let totalLoss = 0;
    const n = poisson(effectiveRate * cfg.horizonYears);
    for (let i = 0; i < n; i++) {
      totalLoss += pareto();
    }
    losses[ep] = totalLoss;
    sumLoss += totalLoss;
    sumSqLoss += totalLoss * totalLoss;
  }
  losses.sort((a, b) => a - b);

  const observedAnnualLossMean = sumLoss / episodes;
  const obsVar = sumSqLoss / episodes - observedAnnualLossMean * observedAnnualLossMean;
  const observedAnnualLossStd = Math.sqrt(Math.max(0, obsVar));

  const idxVar = Math.floor(cfg.varConfidenceLevel * episodes);
  const observedVarAlphaTHorizon = losses[Math.min(idxVar, episodes - 1)];

  return {
    episodes,
    observedAnnualLossMean,
    observedAnnualLossStd,
    observedVarAlphaTHorizon,
  };
}
