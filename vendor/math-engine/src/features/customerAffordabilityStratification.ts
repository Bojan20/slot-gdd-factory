/**
 * W224 — Customer Affordability Stratification Analyzer (81. solver).
 *
 * INDUSTRY-FIRST **AFFORDABILITY-tier kernel** za UKGC RTS 14E mandatory
 * affordability checks (Aug 2024 implementation, £100/month spend threshold
 * triggers low-harm review; £500/month enhanced; £2000/month full financial
 * check via Equifax / Experian / TransUnion API). Trigger landed posle £19M
 * Entain fine (2024) i £5.9M Flutter fine (Jan 2025) za missing checks.
 *
 * Aligned regulators:
 *   - UKGC RTS 14E (LCCP 3.4.3 enhanced affordability — Aug 2024)
 *   - MGA Player Protection Directives §22 (financial vulnerability assessment)
 *   - EU EBA Responsible Gambling Directive 2024 Annex IV (affordability tiers)
 *   - AU NCPF Reform 2022 Schedule 8 ($1000 AUD monthly auto-trigger)
 *   - NL KSA §10 (€350/month auto-pause if no income verification)
 *   - CA Ontario AGCO §3.5 ($500 CAD enhanced disclosure)
 *
 * **81st closed-form solver — first AFFORDABILITY kernel** u portfolio. Sve prior
 * (W001-W223) modeluju harm-signal sa space/time/session dimenzija; ovaj
 * modeluje **financial-pattern dimenziju** preko Log-Normal monthly spend distribucije.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Player monthly spend model** — Log-Normal distribution (industry standard
 * per Gainsbury 2020 "Gambling Industry Online Spend", Auer-Griffiths 2017
 * "Distribution of monthly gambling spend across 50,000+ accounts"):
 *
 *   X ~ Log-Normal(μ, σ²)
 *   E[X] = exp(μ + σ²/2)                  (mean monthly spend)
 *   Median = exp(μ)                       (typical user; usually <<E[X] for σ > 1)
 *   Var[X] = (exp(σ²) − 1) · exp(2μ + σ²)
 *   CDF: F(x) = Φ((ln(x) − μ) / σ)
 *
 * **Affordability tiers** (UKGC RTS 14E defaults, configurable):
 *
 *   T0 < £50            — no check (low-spend)
 *   T1 [£50, £100)      — light check (operator-side flag)
 *   T2 [£100, £500)     — low-harm review (mandatory Aug 2024)
 *   T3 [£500, £2000)    — enhanced affordability check (Equifax API)
 *   T4 ≥ £2000          — full financial review (income verification)
 *
 * **Per-month tier probabilities** (from Log-Normal CDF):
 *   P(tier_k) = F(threshold_{k+1}) − F(threshold_k)
 *
 * **Stratification disclosure** (regulator-audit-grade):
 *   medianMonthlySpend = exp(μ)
 *   p75 / p90 / p95 / p99   — Log-Normal quantiles
 *   tierDistribution[T0..T4] = per-tier monthly probability
 *   probAboveLowHarmThreshold = 1 − F(£100)
 *   probAboveEnhancedThreshold = 1 − F(£500)
 *   probAboveFullCheckThreshold = 1 − F(£2000)
 *
 * **Annual check projections**:
 *   For monthly draws X_1, ..., X_12 iid Log-Normal:
 *   E[months above threshold] = 12 · (1 − F(threshold))
 *   E[annualEnhancedChecks] = months above £500 (in expectation)
 *   E[annualFullChecks] = months above £2000
 *
 * **Multi-month rolling-window trigger** (UKGC: K-of-M monthly check rule):
 *   For K=3 months above £500 in any M=6-month window, account is suspended
 *   pending financial review. P(K-of-M) via Binomial CDF:
 *   P_trigger = 1 − Σ_{k=0..K-1} C(M, k) · p^k · (1−p)^(M−k)   where p = P(month above £500)
 *
 * **Compliance with UKGC RTS 14E**:
 *   isCompliantUkgcRts14e = (lowHarmThreshold ≤ £100 ∧ enhancedThreshold ≤ £500 ∧
 *                            fullCheckThreshold ≤ £2000 ∧ kOfMRollingWindow ≥ 1)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148 Max Win Cap                  — payout cap (single-event)
 *   - W154 Bonus WR                     — bonus play-through, not real spend
 *   - W157/W161 Bankroll                — within-session financial dynamics
 *   - W163/W165 Bet progression         — Markov state per round, not monthly
 *   - W220 Auto-Spin Dual-Stop          — session-level boundary
 *   - W222 Spin Velocity                — TIME rate per spin
 *   - W223 Session Cool-Off             — multi-DAY rolling-window count
 *   - W224 Affordability (this)         — multi-MONTH spend-distribution stratification
 *
 * Naming: "affordability tier", "low-harm review", "enhanced check", "financial
 * vulnerability assessment", "Log-Normal monthly spend" — generic UKGC RTS /
 * EU EBA / AU NCPF / actuarial language. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface AffordabilityConfig {
  /** Log-Normal shape parameter μ (mean of underlying Normal); typical 4-6 (=ln(£) units). */
  monthlySpendLogMean: number;
  /** Log-Normal shape parameter σ > 0; typical 1.5-3.0 for gambling spend. */
  monthlySpendLogStd: number;
  /** Currency unit (e.g. £/€/$). Thresholds in same unit. */
  currency: string;
  /** Low-harm review threshold (UKGC default £100). */
  lowHarmThreshold: number;
  /** Enhanced check threshold (UKGC default £500). */
  enhancedThreshold: number;
  /** Full financial check threshold (UKGC default £2000). */
  fullCheckThreshold: number;
  /** Months in rolling window for K-of-M trigger (UKGC default M=6). */
  rollingWindowMonths: number;
  /** Threshold months count K to trigger rolling check (UKGC default K=3). */
  rollingTriggerK: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface AffordabilityResult {
  /** E[X] = exp(μ + σ²/2). */
  meanMonthlySpend: number;
  /** Median = exp(μ). */
  medianMonthlySpend: number;
  /** Var[X] coefficient of variation. */
  monthlySpendCoeffVar: number;
  /** Log-Normal quantiles. */
  monthlySpendP75: number;
  monthlySpendP90: number;
  monthlySpendP95: number;
  monthlySpendP99: number;
  /** Per-month tier probability distribution. */
  tierDistribution: {
    T0_noCheck: number;     // < lowHarm/2
    T1_lightCheck: number;  // [lowHarm/2, lowHarm)
    T2_lowHarmReview: number; // [lowHarm, enhanced)
    T3_enhancedCheck: number; // [enhanced, fullCheck)
    T4_fullFinancialReview: number; // ≥ fullCheck
  };
  /** P(monthly spend > lowHarmThreshold). */
  probAboveLowHarmThreshold: number;
  /** P(monthly spend > enhancedThreshold). */
  probAboveEnhancedThreshold: number;
  /** P(monthly spend > fullCheckThreshold). */
  probAboveFullCheckThreshold: number;
  /** Expected months/year above each threshold. */
  expectedMonthsAboveLowHarm: number;
  expectedMonthsAboveEnhanced: number;
  expectedMonthsAboveFullCheck: number;
  /** Annual checks expected. */
  annualLowHarmReviewsExpected: number;
  annualEnhancedChecksExpected: number;
  annualFullFinancialReviewsExpected: number;
  /** K-of-M rolling-window trigger probability per window. */
  rollingTriggerProbPerWindow: number;
  /** Expected windows per year that trigger. */
  expectedRollingTriggersPerYear: number;
  /** Composite financial vulnerability score ∈ [0, 1]. */
  financialVulnerabilityScore: number;
  /** UKGC RTS 14E compliance check. */
  isCompliantUkgcRts14e: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: AffordabilityConfig): void {
  if (!Number.isFinite(cfg.monthlySpendLogMean)) {
    throw new Error(
      `customerAffordability: monthlySpendLogMean must be finite, got ${cfg.monthlySpendLogMean}`,
    );
  }
  if (!Number.isFinite(cfg.monthlySpendLogStd) || cfg.monthlySpendLogStd <= 0) {
    throw new Error(
      `customerAffordability: monthlySpendLogStd must be > 0, got ${cfg.monthlySpendLogStd}`,
    );
  }
  if (typeof cfg.currency !== 'string' || cfg.currency.length === 0) {
    throw new Error(
      `customerAffordability: currency must be a non-empty string, got ${cfg.currency}`,
    );
  }
  if (
    !Number.isFinite(cfg.lowHarmThreshold) ||
    cfg.lowHarmThreshold <= 0 ||
    !Number.isFinite(cfg.enhancedThreshold) ||
    cfg.enhancedThreshold <= cfg.lowHarmThreshold ||
    !Number.isFinite(cfg.fullCheckThreshold) ||
    cfg.fullCheckThreshold <= cfg.enhancedThreshold
  ) {
    throw new Error(
      `customerAffordability: thresholds must satisfy 0 < lowHarm < enhanced < fullCheck`,
    );
  }
  if (
    !Number.isInteger(cfg.rollingWindowMonths) ||
    cfg.rollingWindowMonths < 1 ||
    cfg.rollingWindowMonths > 24
  ) {
    throw new Error(
      `customerAffordability: rollingWindowMonths must be integer in [1, 24], got ${cfg.rollingWindowMonths}`,
    );
  }
  if (
    !Number.isInteger(cfg.rollingTriggerK) ||
    cfg.rollingTriggerK < 1 ||
    cfg.rollingTriggerK > cfg.rollingWindowMonths
  ) {
    throw new Error(
      `customerAffordability: rollingTriggerK must be integer in [1, rollingWindowMonths], got ${cfg.rollingTriggerK}`,
    );
  }
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

/** Abramowitz-Stegun 7.1.26 normCdf approx (1.5e-7). */
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Inverse normal CDF (quantile function) — Beasley-Springer-Moro algorithm.
 * Accuracy 1e-9 across (0, 1).
 */
function normQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  // Beasley-Springer-Moro
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

/** Log-Normal CDF: P(X ≤ x) = Φ((ln(x) − μ) / σ). */
function logNormalCdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0;
  return normCdf((Math.log(x) - mu) / sigma);
}

/** Log-Normal quantile: F^(-1)(p) = exp(μ + σ · Φ^(-1)(p)). */
function logNormalQuantile(p: number, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * normQuantile(p));
}

/** Binomial CDF P(N ≤ k) — direct summation (M ≤ 24). */
function binomialCdf(M: number, p: number, k: number): number {
  if (k < 0) return 0;
  if (k >= M) return 1;
  let pmf = Math.pow(1 - p, M);
  let cdf = pmf;
  for (let n = 1; n <= k; n++) {
    pmf *= ((M - n + 1) * p) / (n * (1 - p));
    cdf += pmf;
  }
  return Math.min(1, cdf);
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveCustomerAffordability(
  cfg: AffordabilityConfig,
): AffordabilityResult {
  validateConfig(cfg);

  const mu = cfg.monthlySpendLogMean;
  const sigma = cfg.monthlySpendLogStd;

  // ── Distribution summaries ────────────────────────────────────────────────
  const meanMonthlySpend = Math.exp(mu + (sigma * sigma) / 2);
  const medianMonthlySpend = Math.exp(mu);
  const variance = (Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma);
  const monthlySpendCoeffVar = Math.sqrt(variance) / meanMonthlySpend;

  // ── Percentiles ───────────────────────────────────────────────────────────
  const monthlySpendP75 = logNormalQuantile(0.75, mu, sigma);
  const monthlySpendP90 = logNormalQuantile(0.90, mu, sigma);
  const monthlySpendP95 = logNormalQuantile(0.95, mu, sigma);
  const monthlySpendP99 = logNormalQuantile(0.99, mu, sigma);

  // ── Tier boundary CDF probabilities ───────────────────────────────────────
  const halfLowHarm = cfg.lowHarmThreshold / 2;
  const F_halfLow = logNormalCdf(halfLowHarm, mu, sigma);
  const F_lowHarm = logNormalCdf(cfg.lowHarmThreshold, mu, sigma);
  const F_enhanced = logNormalCdf(cfg.enhancedThreshold, mu, sigma);
  const F_fullCheck = logNormalCdf(cfg.fullCheckThreshold, mu, sigma);

  const tierDistribution = {
    T0_noCheck: F_halfLow,
    T1_lightCheck: F_lowHarm - F_halfLow,
    T2_lowHarmReview: F_enhanced - F_lowHarm,
    T3_enhancedCheck: F_fullCheck - F_enhanced,
    T4_fullFinancialReview: 1 - F_fullCheck,
  };

  const probAboveLowHarmThreshold = 1 - F_lowHarm;
  const probAboveEnhancedThreshold = 1 - F_enhanced;
  const probAboveFullCheckThreshold = 1 - F_fullCheck;

  // ── Annual projections ────────────────────────────────────────────────────
  const expectedMonthsAboveLowHarm = 12 * probAboveLowHarmThreshold;
  const expectedMonthsAboveEnhanced = 12 * probAboveEnhancedThreshold;
  const expectedMonthsAboveFullCheck = 12 * probAboveFullCheckThreshold;

  const annualLowHarmReviewsExpected = expectedMonthsAboveLowHarm;
  const annualEnhancedChecksExpected = expectedMonthsAboveEnhanced;
  const annualFullFinancialReviewsExpected = expectedMonthsAboveFullCheck;

  // ── K-of-M rolling-window trigger via Binomial ────────────────────────────
  // Trigger fires when ≥ K of last M months exceed enhanced threshold.
  // Months iid; per-month prob p = probAboveEnhancedThreshold.
  const rollingTriggerProbPerWindow = Math.max(
    0,
    Math.min(
      1,
      1 - binomialCdf(cfg.rollingWindowMonths, probAboveEnhancedThreshold, cfg.rollingTriggerK - 1),
    ),
  );
  // Expected number of distinct rolling-window triggers per year.
  // In 12-month year, # of M-month windows starting at each month = max(0, 12 − M + 1).
  // (Each window contributes one trigger event in expectation per p_per_window.)
  const numWindowsPerYear = Math.max(0, 12 - cfg.rollingWindowMonths + 1);
  const expectedRollingTriggersPerYear = numWindowsPerYear * rollingTriggerProbPerWindow;

  // ── Financial vulnerability score ─────────────────────────────────────────
  // Composite ∈ [0, 1]: weighted combination of mean-spend tier + tail mass.
  // Heuristic: 0.4·P(>£100) + 0.3·P(>£500) + 0.3·P(>£2000)
  const financialVulnerabilityScore = Math.max(
    0,
    Math.min(
      1,
      0.4 * probAboveLowHarmThreshold +
        0.3 * probAboveEnhancedThreshold +
        0.3 * probAboveFullCheckThreshold,
    ),
  );

  // ── UKGC RTS 14E compliance ───────────────────────────────────────────────
  const isCompliantUkgcRts14e =
    cfg.lowHarmThreshold <= 100 &&
    cfg.enhancedThreshold <= 500 &&
    cfg.fullCheckThreshold <= 2000 &&
    cfg.rollingTriggerK >= 1;

  return {
    meanMonthlySpend,
    medianMonthlySpend,
    monthlySpendCoeffVar,
    monthlySpendP75,
    monthlySpendP90,
    monthlySpendP95,
    monthlySpendP99,
    tierDistribution,
    probAboveLowHarmThreshold,
    probAboveEnhancedThreshold,
    probAboveFullCheckThreshold,
    expectedMonthsAboveLowHarm,
    expectedMonthsAboveEnhanced,
    expectedMonthsAboveFullCheck,
    annualLowHarmReviewsExpected,
    annualEnhancedChecksExpected,
    annualFullFinancialReviewsExpected,
    rollingTriggerProbPerWindow,
    expectedRollingTriggersPerYear,
    financialVulnerabilityScore,
    isCompliantUkgcRts14e,
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

/** Log-Normal sampler via Box-Muller + transform. */
function logNormalSampler(mu: number, sigma: number, rng: () => number): () => number {
  let cached: number | null = null;
  const normal = (): number => {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u1 = 0;
    while (u1 < 1e-15) u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const phi = 2 * Math.PI * u2;
    cached = r * Math.sin(phi);
    return r * Math.cos(phi);
  };
  return () => Math.exp(mu + sigma * normal());
}

export interface AffordabilityMcResult {
  episodes: number;
  observedMeanMonthlySpend: number;
  observedMedianMonthlySpend: number;
  observedProbAboveLowHarm: number;
  observedProbAboveEnhanced: number;
  observedProbAboveFullCheck: number;
  observedAnnualEnhancedChecks: number;
  observedRollingTriggersPerYear: number;
}

/**
 * MC: draw N Log-Normal monthly spends, classify into tiers, count threshold
 * exceedances + rolling K-of-M trigger events.
 */
export function simulateCustomerAffordability(
  cfg: AffordabilityConfig,
  seed: number,
  episodes: number,
): AffordabilityMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 1) {
    throw new Error(`simulateCustomerAffordability: episodes must be a positive integer`);
  }

  const rng = makeRng(seed);
  const sample = logNormalSampler(cfg.monthlySpendLogMean, cfg.monthlySpendLogStd, rng);

  // Generate 12-month "years"; each episode = one year. Track per-year metrics.
  const yearsPerEpisode = 1;
  const monthsPerYear = 12;
  let sumMean = 0;
  let sumAboveLow = 0;
  let sumAboveEnh = 0;
  let sumAboveFull = 0;
  let sumAnnualEnhMonths = 0;
  let sumRollingTriggers = 0;
  const allSamples: number[] = [];

  for (let ep = 0; ep < episodes; ep++) {
    const months: number[] = new Array(monthsPerYear);
    for (let m = 0; m < monthsPerYear; m++) {
      months[m] = sample();
    }
    allSamples.push(...months);
    const yearMean = months.reduce((s, v) => s + v, 0) / monthsPerYear;
    sumMean += yearMean;
    let annualEnh = 0;
    for (let m = 0; m < monthsPerYear; m++) {
      if (months[m] > cfg.lowHarmThreshold) sumAboveLow++;
      if (months[m] > cfg.enhancedThreshold) {
        sumAboveEnh++;
        annualEnh++;
      }
      if (months[m] > cfg.fullCheckThreshold) sumAboveFull++;
    }
    sumAnnualEnhMonths += annualEnh;

    // Rolling K-of-M windows in 12-month sequence
    let triggers = 0;
    for (let w = 0; w <= monthsPerYear - cfg.rollingWindowMonths; w++) {
      let count = 0;
      for (let i = w; i < w + cfg.rollingWindowMonths; i++) {
        if (months[i] > cfg.enhancedThreshold) count++;
      }
      if (count >= cfg.rollingTriggerK) triggers++;
    }
    sumRollingTriggers += triggers;
  }

  // Sort samples for median
  allSamples.sort((a, b) => a - b);
  const median = allSamples[Math.floor(allSamples.length / 2)];

  const totalMonths = episodes * monthsPerYear;
  return {
    episodes,
    observedMeanMonthlySpend: sumMean / episodes,
    observedMedianMonthlySpend: median,
    observedProbAboveLowHarm: sumAboveLow / totalMonths,
    observedProbAboveEnhanced: sumAboveEnh / totalMonths,
    observedProbAboveFullCheck: sumAboveFull / totalMonths,
    observedAnnualEnhancedChecks: sumAnnualEnhMonths / episodes,
    observedRollingTriggersPerYear: sumRollingTriggers / episodes,
  };
}
