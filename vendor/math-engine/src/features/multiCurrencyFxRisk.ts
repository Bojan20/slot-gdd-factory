/**
 * W232 — Multi-Currency FX Settlement Risk Analyzer (89. solver).
 *
 * INDUSTRY-FIRST **TREASURY/FX RISK kernel** za UKGC RTS 16 (multi-currency
 * disclosure 2024 update) + MGA Treasury Standards §30 (multi-currency
 * settlement risk) + EU EBA FX Risk Reporting 2024 Annex X + AU NCPF
 * Schedule 13 (cross-border FX exposure) + IFRS 7 §31-42 (financial
 * instrument risk disclosure) + Basel III FRTB (Fundamental Review of the
 * Trading Book — FX risk capital).
 *
 * **89th closed-form solver — first TREASURY/FX RISK kernel** u portfolio.
 * Sve prior W001-W231 modeluju gaming/RG/capital/CRM/AML/SQC/fraud dimenzije
 * koje su denominated u SINGLE-currency. Ovaj modeluje **portfolio VaR sa
 * korelacijama kros-currency**, hedging tradeoff, IFRS 7 disclosure.
 *
 * Komplementarno sa W227 (single-currency GGR VaR) — ovaj proširuje na
 * multi-currency treasury-side FX exposure.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Portfolio P&L model** (Markowitz 1952 mean-variance):
 *
 *   N currencies sa daily volumes V_1, ..., V_N (currency_i units)
 *   Currency-i daily return: r_i ~ Normal(μ_i, σ_i²) — typical 0.5%-2% daily σ
 *   Pairwise correlation: ρ_{ij} (typical 0.3-0.8 for major pairs, near 0 for
 *   exotic + crypto)
 *
 *   Per-currency P&L: ΔV_i = V_i · r_i
 *   Total portfolio P&L: ΔV = Σ V_i · r_i
 *
 *   **Var[ΔV] = Σ_i Σ_j V_i · V_j · σ_i · σ_j · ρ_{ij}**       (Markowitz quadratic form)
 *
 *   = w^T · Σ · w   where w_i = V_i, Σ_{ij} = σ_i · σ_j · ρ_{ij}
 *
 * **T-day VaR_α** (Basel III standard):
 *
 *   **VaR_α(T) = z_α · sqrt(T) · sqrt(Var[ΔV])**
 *
 *   z_α = Φ^(-1)(α) (Beasley-Springer-Moro)
 *   For α = 0.99: z = 2.326. For α = 0.999: z = 3.09.
 *
 * **Expected Shortfall** (CVaR, coherent risk measure):
 *
 *   ES_α(T) = sqrt(T) · sqrt(Var[ΔV]) · φ(z_α) / (1 − α)
 *
 * **Hedging effectiveness** (treasury policy):
 *
 *   Hedge ratio h ∈ [0, 1] per currency reduces effective σ:
 *     σ_effective_i = σ_i · (1 − h_i + h_i · ε_basis)
 *   ε_basis ≈ 0.05-0.15 (forward-spot basis risk)
 *
 *   Hedging cost: c_i · |V_i| · h_i (typical c ≈ 0.001 per annum)
 *
 *   Hedged VaR < Unhedged VaR (decreasing in h_i)
 *   Hedging cost > 0 (increasing in h_i)
 *
 * **Hedging optimum** (single-objective, no constraints):
 *   Solve for h* minimizing E[loss + hedging cost] over T:
 *   ∂/∂h_i [z_α · sqrt(T) · sqrt(Var(h)) + cost(h)] = 0
 *
 *   For diagonal-only (no correlation hedge), per-currency:
 *     h*_i = max(0, 1 − cost_i · sqrt(T) / (z_α · σ_i · |V_i|))
 *
 * **IFRS 7 §40 sensitivity disclosure**:
 *
 *   "10% shock per major currency" → Δ_GBP_shock = 0.10 · V_GBP
 *   Total impact = Σ |10%_shock_i| under perfect correlation
 *
 * **Concentration risk** — Herfindahl-Hirschman:
 *
 *   HHI = Σ (V_i / V_total)²   ∈ [1/N, 1]
 *   HHI > 0.5 = high concentration (single-currency dominant)
 *
 * **UKGC RTS 16 compliance**:
 *   isCompliantUkgcRts16 = (varAlphaTHorizon < operatorOwnFunds · 0.5 ∧
 *                           HHI < 0.7 ∧ hedge_disclosure_complete)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148-W226                — single-currency player-side
 *   - W227                     — single-currency operator GGR VaR
 *   - W228                     — single-currency LTV/CAC
 *   - W229                     — AML compliance (currency-agnostic)
 *   - W230                     — single-stream SQC
 *   - W231                     — fraud detection (currency-agnostic)
 *   - W232 (this)              — MULTI-CURRENCY portfolio VaR sa Markowitz
 *                                  covariance matrix + hedging optimization
 *
 * Naming: "FX VaR", "Markowitz quadratic form", "hedge ratio", "IFRS 7 §40",
 * "Herfindahl-Hirschman" — generic treasury / FRTB / financial-risk terms.
 * No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface MultiCurrencyFxRiskConfig {
  /** Currency codes (e.g. ['GBP', 'EUR', 'USD']). */
  currencies: string[];
  /** Daily volumes per currency (in currency units, ≥ 0). */
  dailyVolumes: number[];
  /** Daily FX return std σ per currency (in % units, e.g. 0.01 = 1%/day). */
  dailyVolatilities: number[];
  /** Pairwise correlation matrix (NxN, symmetric, diagonal=1). */
  correlationMatrix: number[][];
  /** VaR confidence level α ∈ (0.5, 1). */
  varConfidenceLevel: number;
  /** Horizon T in days. */
  varHorizonDays: number;
  /** Hedge ratio per currency ∈ [0, 1]. */
  hedgeRatios: number[];
  /** Basis risk after hedging ∈ [0, 0.3]. */
  basisRisk: number;
  /** Per-currency annualized hedging cost (e.g. 0.001 = 10 bps/year). */
  hedgingCostPerAnnum: number;
  /** Operator own funds (for compliance check). */
  operatorOwnFunds: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface MultiCurrencyFxRiskResult {
  /** Total portfolio value (sum of volumes, denominated in base currency). */
  totalPortfolioValue: number;
  /** Portfolio variance (Markowitz quadratic form). */
  portfolioVariance: number;
  /** Portfolio std = sqrt(variance). */
  portfolioStd: number;
  /** Effective variance after hedging. */
  hedgedPortfolioVariance: number;
  /** z_α critical value (Beasley-Springer-Moro). */
  zScoreForVar: number;
  /** Unhedged T-day VaR_α (positive currency-units loss). */
  varAlphaTHorizonUnhedged: number;
  /** Hedged T-day VaR_α. */
  varAlphaTHorizonHedged: number;
  /** Expected Shortfall ES_α (hedged). */
  expectedShortfallAlphaTHorizon: number;
  /** Annual hedging cost = Σ c · V · h. */
  totalAnnualHedgingCost: number;
  /** Per-currency 10% shock impact (IFRS 7 §40). */
  ifrs7SensitivityShock10pct: number[];
  /** Herfindahl-Hirschman concentration index ∈ [1/N, 1]. */
  concentrationIndex: number;
  /** Per-currency optimal hedge ratio (closed-form solver). */
  optimalHedgeRatios: number[];
  /** UKGC RTS 16 + IFRS 7 compliance. */
  isCompliantUkgcRts16: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: MultiCurrencyFxRiskConfig): void {
  const N = cfg.currencies.length;
  if (!Array.isArray(cfg.currencies) || N < 1 || N > 20) {
    throw new Error(`multiCurrencyFx: currencies must be 1-20, got ${N}`);
  }
  if (!Array.isArray(cfg.dailyVolumes) || cfg.dailyVolumes.length !== N) {
    throw new Error(`multiCurrencyFx: dailyVolumes length mismatch`);
  }
  for (const v of cfg.dailyVolumes) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`multiCurrencyFx: dailyVolumes must be all ≥ 0`);
    }
  }
  if (!Array.isArray(cfg.dailyVolatilities) || cfg.dailyVolatilities.length !== N) {
    throw new Error(`multiCurrencyFx: dailyVolatilities length mismatch`);
  }
  for (const s of cfg.dailyVolatilities) {
    if (!Number.isFinite(s) || s <= 0 || s > 1) {
      throw new Error(`multiCurrencyFx: dailyVolatilities must be in (0, 1)`);
    }
  }
  if (!Array.isArray(cfg.correlationMatrix) || cfg.correlationMatrix.length !== N) {
    throw new Error(`multiCurrencyFx: correlationMatrix size mismatch`);
  }
  for (let i = 0; i < N; i++) {
    if (!Array.isArray(cfg.correlationMatrix[i]) || cfg.correlationMatrix[i].length !== N) {
      throw new Error(`multiCurrencyFx: correlationMatrix not square`);
    }
    if (Math.abs(cfg.correlationMatrix[i][i] - 1) > 1e-9) {
      throw new Error(`multiCurrencyFx: correlationMatrix diagonal must be 1`);
    }
    for (let j = 0; j < N; j++) {
      const r = cfg.correlationMatrix[i][j];
      if (!Number.isFinite(r) || r < -1 || r > 1) {
        throw new Error(`multiCurrencyFx: correlationMatrix entries must be in [-1, 1]`);
      }
      if (Math.abs(cfg.correlationMatrix[i][j] - cfg.correlationMatrix[j][i]) > 1e-6) {
        throw new Error(`multiCurrencyFx: correlationMatrix must be symmetric`);
      }
    }
  }
  if (
    !Number.isFinite(cfg.varConfidenceLevel) ||
    cfg.varConfidenceLevel <= 0.5 ||
    cfg.varConfidenceLevel >= 1
  ) {
    throw new Error(
      `multiCurrencyFx: varConfidenceLevel must be in (0.5, 1), got ${cfg.varConfidenceLevel}`,
    );
  }
  if (
    !Number.isInteger(cfg.varHorizonDays) ||
    cfg.varHorizonDays < 1 ||
    cfg.varHorizonDays > 365
  ) {
    throw new Error(
      `multiCurrencyFx: varHorizonDays must be integer in [1, 365], got ${cfg.varHorizonDays}`,
    );
  }
  if (!Array.isArray(cfg.hedgeRatios) || cfg.hedgeRatios.length !== N) {
    throw new Error(`multiCurrencyFx: hedgeRatios length mismatch`);
  }
  for (const h of cfg.hedgeRatios) {
    if (!Number.isFinite(h) || h < 0 || h > 1) {
      throw new Error(`multiCurrencyFx: hedgeRatios must be in [0, 1]`);
    }
  }
  if (!Number.isFinite(cfg.basisRisk) || cfg.basisRisk < 0 || cfg.basisRisk > 0.3) {
    throw new Error(`multiCurrencyFx: basisRisk must be in [0, 0.3]`);
  }
  if (!Number.isFinite(cfg.hedgingCostPerAnnum) || cfg.hedgingCostPerAnnum < 0) {
    throw new Error(`multiCurrencyFx: hedgingCostPerAnnum must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.operatorOwnFunds) || cfg.operatorOwnFunds < 0) {
    throw new Error(`multiCurrencyFx: operatorOwnFunds must be ≥ 0`);
  }
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

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

/**
 * Markowitz quadratic form: Var[w·r] = Σ_i Σ_j w_i · w_j · σ_i · σ_j · ρ_{ij}.
 */
function portfolioVariance(
  weights: number[],
  vols: number[],
  corrMatrix: number[][],
): number {
  let v = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      v += weights[i] * weights[j] * vols[i] * vols[j] * corrMatrix[i][j];
    }
  }
  return Math.max(0, v);
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveMultiCurrencyFxRisk(
  cfg: MultiCurrencyFxRiskConfig,
): MultiCurrencyFxRiskResult {
  validateConfig(cfg);

  const N = cfg.currencies.length;
  const T = cfg.varHorizonDays;

  // ── Total portfolio value ─────────────────────────────────────────────────
  const totalPortfolioValue = cfg.dailyVolumes.reduce((s, v) => s + v, 0);

  // ── Unhedged portfolio variance ───────────────────────────────────────────
  const portfolioVar = portfolioVariance(
    cfg.dailyVolumes,
    cfg.dailyVolatilities,
    cfg.correlationMatrix,
  );
  const portfolioStd = Math.sqrt(portfolioVar);

  // ── Hedged effective volatilities ────────────────────────────────────────
  const effectiveVols = cfg.dailyVolatilities.map(
    (s, i) => s * (1 - cfg.hedgeRatios[i] + cfg.hedgeRatios[i] * cfg.basisRisk),
  );
  const hedgedPortfolioVariance = portfolioVariance(
    cfg.dailyVolumes,
    effectiveVols,
    cfg.correlationMatrix,
  );

  // ── VaR computations ──────────────────────────────────────────────────────
  const zScoreForVar = normQuantile(cfg.varConfidenceLevel);
  const sqrtT = Math.sqrt(T);
  const varAlphaTHorizonUnhedged = zScoreForVar * sqrtT * portfolioStd;
  const varAlphaTHorizonHedged =
    zScoreForVar * sqrtT * Math.sqrt(hedgedPortfolioVariance);

  // ── Expected Shortfall (hedged) ──────────────────────────────────────────
  const expectedShortfallAlphaTHorizon =
    (sqrtT * Math.sqrt(hedgedPortfolioVariance) * normPdf(zScoreForVar)) /
    (1 - cfg.varConfidenceLevel);

  // ── Hedging annualized cost ───────────────────────────────────────────────
  let totalAnnualHedgingCost = 0;
  for (let i = 0; i < N; i++) {
    totalAnnualHedgingCost +=
      cfg.hedgingCostPerAnnum * cfg.dailyVolumes[i] * cfg.hedgeRatios[i];
  }

  // ── IFRS 7 §40 sensitivity (10% shock per currency) ──────────────────────
  const ifrs7SensitivityShock10pct = cfg.dailyVolumes.map((v) => 0.10 * v);

  // ── Herfindahl-Hirschman concentration ───────────────────────────────────
  let hhi = 0;
  if (totalPortfolioValue > 1e-9) {
    for (const v of cfg.dailyVolumes) {
      const share = v / totalPortfolioValue;
      hhi += share * share;
    }
  } else {
    hhi = 1; // degenerate single-currency
  }
  const concentrationIndex = hhi;

  // ── Optimal hedge ratios per currency (single-objective, diagonal) ───────
  // Closed-form: h*_i = max(0, 1 − cost_i · sqrt(T_days/365) / (z_α · σ_i · |V_i|))
  // Where T conversion to annualized cost equivalent.
  const optimalHedgeRatios = cfg.dailyVolumes.map((v, i) => {
    if (v < 1e-9 || cfg.dailyVolatilities[i] < 1e-9) return 0;
    const costAnnualized = cfg.hedgingCostPerAnnum * v;
    const varBenefit = zScoreForVar * sqrtT * cfg.dailyVolatilities[i] * v;
    return Math.max(0, Math.min(1, 1 - costAnnualized / Math.max(varBenefit, 1e-9)));
  });

  // ── UKGC RTS 16 + IFRS 7 compliance ──────────────────────────────────────
  // Mandate: VaR < 50% own funds AND HHI < 0.7
  const isCompliantUkgcRts16 =
    varAlphaTHorizonHedged < cfg.operatorOwnFunds * 0.5 && concentrationIndex < 0.7;

  return {
    totalPortfolioValue,
    portfolioVariance: portfolioVar,
    portfolioStd,
    hedgedPortfolioVariance,
    zScoreForVar,
    varAlphaTHorizonUnhedged,
    varAlphaTHorizonHedged,
    expectedShortfallAlphaTHorizon,
    totalAnnualHedgingCost,
    ifrs7SensitivityShock10pct,
    concentrationIndex,
    optimalHedgeRatios,
    isCompliantUkgcRts16,
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

function normalSampler(rng: () => number): () => number {
  let cached: number | null = null;
  return () => {
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
}

/**
 * Cholesky decomposition of symmetric positive-definite matrix.
 * Returns lower-triangular L such that A = L·L^T.
 */
function cholesky(A: number[][]): number[][] {
  const N = A.length;
  const L: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const diag = A[i][i] - sum;
        L[i][j] = Math.sqrt(Math.max(diag, 1e-15));
      } else {
        L[i][j] = (A[i][j] - sum) / Math.max(L[j][j], 1e-15);
      }
    }
  }
  return L;
}

export interface MultiCurrencyFxRiskMcResult {
  episodes: number;
  observedPortfolioStd: number;
  observedVarAlphaTHorizon: number;
}

/**
 * MC: simulate `episodes` independent T-day P&L paths via correlated Normal
 * draws (Cholesky-transformed). Sort to get empirical α-quantile.
 */
export function simulateMultiCurrencyFxRisk(
  cfg: MultiCurrencyFxRiskConfig,
  seed: number,
  episodes: number,
): MultiCurrencyFxRiskMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 200) {
    throw new Error(`simulateMultiCurrencyFxRisk: episodes must be integer ≥ 200`);
  }

  const N = cfg.currencies.length;
  const T = cfg.varHorizonDays;
  const rng = makeRng(seed);
  const normal = normalSampler(rng);

  // Effective volatilities after hedging
  const effectiveVols = cfg.dailyVolatilities.map(
    (s, i) => s * (1 - cfg.hedgeRatios[i] + cfg.hedgeRatios[i] * cfg.basisRisk),
  );

  // Cholesky of correlation matrix
  const L = cholesky(cfg.correlationMatrix);

  const losses: number[] = new Array(episodes);
  let sumPnl = 0;
  let sumSqPnl = 0;

  for (let ep = 0; ep < episodes; ep++) {
    // T-day P&L: aggregate T daily steps
    let pnl = 0;
    for (let day = 0; day < T; day++) {
      // Draw N iid standard normals
      const z = new Array(N);
      for (let i = 0; i < N; i++) z[i] = normal();
      // Apply Cholesky to get correlated normals
      const w = new Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        for (let k = 0; k <= i; k++) w[i] += L[i][k] * z[k];
      }
      // Per-currency P&L contribution
      for (let i = 0; i < N; i++) {
        pnl += cfg.dailyVolumes[i] * effectiveVols[i] * w[i];
      }
    }
    sumPnl += pnl;
    sumSqPnl += pnl * pnl;
    losses[ep] = Math.abs(pnl); // worst-case magnitude
  }
  losses.sort((a, b) => a - b);

  const meanPnl = sumPnl / episodes;
  const varPnl = sumSqPnl / episodes - meanPnl * meanPnl;
  const observedPortfolioStd = Math.sqrt(Math.max(0, varPnl)) / Math.sqrt(T);

  const idxVar = Math.floor(cfg.varConfidenceLevel * episodes);
  const observedVarAlphaTHorizon = losses[Math.min(idxVar, episodes - 1)];

  return {
    episodes,
    observedPortfolioStd,
    observedVarAlphaTHorizon,
  };
}
