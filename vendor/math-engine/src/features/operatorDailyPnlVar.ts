/**
 * W227 — Operator Daily P&L Value-at-Risk (VaR) Analyzer (84. solver).
 *
 * INDUSTRY-FIRST **OPERATOR-side risk-capital kernel** za UKGC Gambling Act 2005
 * §3 + Gambling Commission Capital Adequacy Guidance (2024 update — minimum
 * solvency ratio mandate posle Sportech £19M shortfall 2023) + MGA Capital
 * Requirement Directive §28 + EU EBA Solvency II analog Pillar 1 (own funds
 * vs market risk) + Basel III Operational Risk Capital Add-On + AU NCPF §10
 * (financial robustness — A$1M minimum reserve mandate).
 *
 * **84th closed-form solver — first OPERATOR-side capital kernel** u portfolio.
 * Sve prior W001-W226 modeluju PLAYER-side outcomes (payouts/sessions/limits/
 * commitment); ovaj **okreće objektiv** na operator-side daily P&L distribution
 * i required-reserve capital za regulatorno-mandated solvency.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Operator daily gross-gaming-revenue (GGR) model**:
 *
 *   GGR_d = N_sessions(d) · b_per_session · (1 − RTP) − Σ jackpot_payouts(d)
 *
 *   Per session house edge: b · (1 − RTP) per spin × spins/session.
 *   Sessions per day: Poisson(λ_sessions).
 *   Jackpot tail events: rare (P ≈ 1e-6 per session) but heavy payout (μ_jack).
 *
 * **Normal approximation** (CLT — valid kada N >> 1000 sessions/day):
 *   GGR_d ~ Normal(μ_GGR, σ²_GGR)
 *
 *   Per-session profit/loss:
 *     μ_per_session = b · spins · (1 − RTP) − jackpot_contrib_per_session
 *     σ²_per_session = b² · spins · v + jackpot_tail_var
 *
 *   Daily aggregate (independent sessions):
 *     μ_GGR = λ_sessions · μ_per_session
 *     σ²_GGR = λ_sessions · σ²_per_session
 *
 * **VaR_α(T) — α-percentile T-day worst-case loss** (Basel III convention):
 *   T-day P&L ~ Normal(T·μ_GGR, T·σ²_GGR)
 *   **VaR_α(T) = T·μ_GGR − z_α · σ_GGR · √T**       (α = 0.99 / 0.999 typical)
 *   where z_α = Φ^(-1)(α) (negative for losses).
 *
 *   By convention, **VaR reports loss as POSITIVE number**:
 *     VaR_α(T) = max(0, z_α · σ_GGR · √T − T·μ_GGR)
 *
 * **Expected Shortfall (CVaR_α)** — conditional mean loss beyond VaR:
 *   ES_α(T) = T·μ_GGR − σ_GGR·√T · φ(z_α) / (1 − α)
 *   (negative for losses; flip sign for "positive ES" reporting)
 *
 * **Jackpot tail-event reserve**:
 *   Single large jackpot trigger can dominate VaR. Mandatory buffer:
 *     jackpotTailReserve = jackpot_max_payout · jackpotTriggerProbPerDay · safetyFactor
 *
 * **Required regulatory reserve**:
 *   requiredReserveCapital = max(VaR_α(T_regulatory), jackpotTailReserve, minimumReserve)
 *
 * **Solvency ratio**:
 *   solvencyRatio = operatorOwnFunds / requiredReserveCapital
 *   Mandatory solvency ≥ 1.0 (UKGC RTS 16: ≥ 1.2 recommended).
 *
 * **UKGC GA 2005 §3 / Capital Adequacy compliance**:
 *   isCompliantUkgcGa2005 = (solvencyRatio ≥ 1.0 ∧
 *                            operatorOwnFunds ≥ minimumReserve)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148 Max Win Cap                  — single-event payout cap
 *   - W154/W157/W161/W163/W165/W167     — PLAYER-side first-passage
 *   - W167 AWP Cycle                    — finite-cycle RTP compensation (player)
 *   - W220-W226                         — PLAYER-side RG kernels
 *   - W227 (this)                       — OPERATOR-side risk-capital VaR/ES
 *
 * Naming: "Value-at-Risk", "Expected Shortfall", "solvency ratio", "capital
 * adequacy", "GGR", "operator daily P&L" — generic Basel III / Solvency II /
 * UKGC GA / regulator capital-adequacy terminology. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface OperatorVarConfig {
  /** Expected sessions per day λ_sessions ≥ 1. */
  expectedSessionsPerDay: number;
  /** Mean operator profit per session > 0 (= bet · spins · (1 − RTP) − jackpot_contrib). */
  meanProfitPerSession: number;
  /** Profit std dev per session σ_per_session > 0. */
  stdProfitPerSession: number;
  /** Max single-jackpot payout (heavy tail event). */
  jackpotMaxPayout: number;
  /** Jackpot trigger probability per day (e.g. 1e-3 = 1 in 1000 days). */
  jackpotTriggerProbPerDay: number;
  /** Operator-held own funds (regulatory capital). */
  operatorOwnFunds: number;
  /** Regulatory minimum-reserve floor (e.g. UKGC £100K, AU A$1M). */
  minimumReserve: number;
  /** Confidence level α ∈ (0.5, 1) for VaR (typically 0.99 / 0.999). */
  varConfidenceLevel: number;
  /** Horizon T in days for VaR computation (Basel default 10, MGA 1, UKGC 1). */
  varHorizonDays: number;
  /** Safety factor multiplier for jackpot tail reserve (≥ 1, typical 1.5-3.0). */
  jackpotSafetyFactor: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface OperatorVarResult {
  /** μ_GGR per day = λ_sessions · μ_per_session. */
  expectedDailyGgr: number;
  /** σ_GGR per day. */
  stdDailyGgr: number;
  /** Annualized GGR (365 days). */
  expectedAnnualGgr: number;
  /** z_α critical value. */
  zScoreForVar: number;
  /** VaR_α(T) — worst-case T-day loss as POSITIVE number. */
  varAlphaTHorizon: number;
  /** Expected Shortfall (CVaR_α) — conditional mean loss beyond VaR. */
  expectedShortfallAlphaTHorizon: number;
  /** Jackpot tail-event reserve = max_payout · trigger_prob · safety_factor. */
  jackpotTailReserve: number;
  /** Max of (VaR, jackpot reserve, regulatory floor). */
  requiredReserveCapital: number;
  /** = operatorOwnFunds / requiredReserveCapital. ≥ 1.0 mandatory. */
  solvencyRatio: number;
  /** UKGC GA 2005 + Capital Adequacy compliance. */
  isCompliantUkgcGa2005: boolean;
  /** Effective per-session "house edge profit margin" disclosure. */
  effectiveProfitMarginPerSession: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: OperatorVarConfig): void {
  if (!Number.isFinite(cfg.expectedSessionsPerDay) || cfg.expectedSessionsPerDay < 1) {
    throw new Error(
      `operatorVar: expectedSessionsPerDay must be ≥ 1, got ${cfg.expectedSessionsPerDay}`,
    );
  }
  if (!Number.isFinite(cfg.meanProfitPerSession) || cfg.meanProfitPerSession <= 0) {
    throw new Error(
      `operatorVar: meanProfitPerSession must be > 0, got ${cfg.meanProfitPerSession}`,
    );
  }
  if (!Number.isFinite(cfg.stdProfitPerSession) || cfg.stdProfitPerSession <= 0) {
    throw new Error(
      `operatorVar: stdProfitPerSession must be > 0, got ${cfg.stdProfitPerSession}`,
    );
  }
  if (!Number.isFinite(cfg.jackpotMaxPayout) || cfg.jackpotMaxPayout < 0) {
    throw new Error(
      `operatorVar: jackpotMaxPayout must be ≥ 0, got ${cfg.jackpotMaxPayout}`,
    );
  }
  if (
    !Number.isFinite(cfg.jackpotTriggerProbPerDay) ||
    cfg.jackpotTriggerProbPerDay < 0 ||
    cfg.jackpotTriggerProbPerDay > 1
  ) {
    throw new Error(
      `operatorVar: jackpotTriggerProbPerDay must be in [0, 1], got ${cfg.jackpotTriggerProbPerDay}`,
    );
  }
  if (!Number.isFinite(cfg.operatorOwnFunds) || cfg.operatorOwnFunds < 0) {
    throw new Error(
      `operatorVar: operatorOwnFunds must be ≥ 0, got ${cfg.operatorOwnFunds}`,
    );
  }
  if (!Number.isFinite(cfg.minimumReserve) || cfg.minimumReserve < 0) {
    throw new Error(
      `operatorVar: minimumReserve must be ≥ 0, got ${cfg.minimumReserve}`,
    );
  }
  if (
    !Number.isFinite(cfg.varConfidenceLevel) ||
    cfg.varConfidenceLevel <= 0.5 ||
    cfg.varConfidenceLevel >= 1
  ) {
    throw new Error(
      `operatorVar: varConfidenceLevel must be in (0.5, 1), got ${cfg.varConfidenceLevel}`,
    );
  }
  if (
    !Number.isInteger(cfg.varHorizonDays) ||
    cfg.varHorizonDays < 1 ||
    cfg.varHorizonDays > 365
  ) {
    throw new Error(
      `operatorVar: varHorizonDays must be integer in [1, 365], got ${cfg.varHorizonDays}`,
    );
  }
  if (!Number.isFinite(cfg.jackpotSafetyFactor) || cfg.jackpotSafetyFactor < 1) {
    throw new Error(
      `operatorVar: jackpotSafetyFactor must be ≥ 1, got ${cfg.jackpotSafetyFactor}`,
    );
  }
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

/** Std normal PDF φ(x). */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

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
 * Beasley-Springer-Moro inverse normal quantile (accuracy 1e-9).
 */
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

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveOperatorVar(cfg: OperatorVarConfig): OperatorVarResult {
  validateConfig(cfg);

  // ── Daily GGR distribution (CLT-aggregated) ───────────────────────────────
  const expectedDailyGgr = cfg.expectedSessionsPerDay * cfg.meanProfitPerSession;
  const varianceDailyGgr =
    cfg.expectedSessionsPerDay * cfg.stdProfitPerSession * cfg.stdProfitPerSession;
  const stdDailyGgr = Math.sqrt(varianceDailyGgr);
  const expectedAnnualGgr = expectedDailyGgr * 365;

  // ── VaR computation (Basel III stress-test convention: zero-drift) ───────
  // Standard Basel III + Solvency II + UKGC Capital Adequacy stress framework
  // assumes zero-drift volatility VaR (ignores expected profit margin for
  // conservative reserve sizing). Formula:
  //   VaR_α(T) = z_α · σ_GGR · √T
  // where z_α = Φ^(-1)(α) and σ_GGR is per-day std (CLT-aggregated).
  // This always reports a positive capital number regardless of profitability.
  const zScoreForVar = normQuantile(cfg.varConfidenceLevel);
  const lossDistStd = stdDailyGgr * Math.sqrt(cfg.varHorizonDays);
  const varAlphaTHorizon = zScoreForVar * lossDistStd;

  // ── Expected Shortfall (CVaR) ─────────────────────────────────────────────
  // ES_α = E[Loss | Loss > VaR_α]. For zero-drift Normal:
  //   ES_α = σ_loss · φ(z_α) / (1 − α)
  // Always ≥ VaR_α (coherent risk measure).
  const expectedShortfallAlphaTHorizon =
    (lossDistStd * normPdf(zScoreForVar)) / (1 - cfg.varConfidenceLevel);

  // ── Jackpot tail-event reserve ────────────────────────────────────────────
  // Conservative: assume max-payout jackpot triggers at rate cfg per day,
  // operator must hold reserve for ≥ safety_factor × expected_annual_payouts.
  const expectedAnnualJackpotPayouts =
    cfg.jackpotMaxPayout * cfg.jackpotTriggerProbPerDay * 365;
  const jackpotTailReserve = expectedAnnualJackpotPayouts * cfg.jackpotSafetyFactor;

  // ── Required reserve = max(VaR, jackpot, minimum) ─────────────────────────
  const requiredReserveCapital = Math.max(
    varAlphaTHorizon,
    jackpotTailReserve,
    cfg.minimumReserve,
  );

  // ── Solvency ratio ────────────────────────────────────────────────────────
  const solvencyRatio =
    requiredReserveCapital > 1e-9
      ? cfg.operatorOwnFunds / requiredReserveCapital
      : Infinity;

  // ── UKGC GA 2005 §3 compliance ────────────────────────────────────────────
  const isCompliantUkgcGa2005 =
    solvencyRatio >= 1.0 && cfg.operatorOwnFunds >= cfg.minimumReserve;

  // ── Effective margin disclosure ───────────────────────────────────────────
  const effectiveProfitMarginPerSession =
    cfg.meanProfitPerSession; // Direct read-through

  return {
    expectedDailyGgr,
    stdDailyGgr,
    expectedAnnualGgr,
    zScoreForVar,
    varAlphaTHorizon,
    expectedShortfallAlphaTHorizon,
    jackpotTailReserve,
    requiredReserveCapital,
    solvencyRatio,
    isCompliantUkgcGa2005,
    effectiveProfitMarginPerSession,
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

function normalSampler(mu: number, sigma: number, rng: () => number): () => number {
  let cached: number | null = null;
  return () => {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return mu + sigma * v;
    }
    let u1 = 0;
    while (u1 < 1e-15) u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const phi = 2 * Math.PI * u2;
    cached = r * Math.sin(phi);
    return mu + sigma * (r * Math.cos(phi));
  };
}

export interface OperatorVarMcResult {
  episodes: number;
  observedExpectedDailyGgr: number;
  observedStdDailyGgr: number;
  observedVarAlphaTHorizon: number;
  observedExpectedShortfallAlphaTHorizon: number;
}

/**
 * MC: simulate `episodes` independent T-day P&L paths. Aggregate session-level
 * Normal draws into daily GGR, then into T-day P&L. Sort to get empirical
 * α-quantile (VaR) and conditional mean above (ES).
 */
export function simulateOperatorVar(
  cfg: OperatorVarConfig,
  seed: number,
  episodes: number,
): OperatorVarMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) {
    throw new Error(
      `simulateOperatorVar: episodes must be integer ≥ 100, got ${episodes}`,
    );
  }

  const rng = makeRng(seed);
  // Basel III convention: zero-drift volatility samples (drop μ for stress test)
  const muHorizon = 0;
  const sigmaHorizon = Math.sqrt(
    cfg.varHorizonDays * cfg.expectedSessionsPerDay *
      cfg.stdProfitPerSession * cfg.stdProfitPerSession,
  );
  const pnlSampler = normalSampler(muHorizon, sigmaHorizon, rng);

  // For separate GGR mean/std diagnostics, also sample with full-drift Normal:
  const muDailyDiag = cfg.expectedSessionsPerDay * cfg.meanProfitPerSession;
  const sigmaDailyDiag = Math.sqrt(cfg.expectedSessionsPerDay) * cfg.stdProfitPerSession;
  const ggrSampler = normalSampler(muDailyDiag, sigmaDailyDiag, rng);

  const losses: number[] = new Array(episodes);
  let sumGgr = 0;
  let sumSqGgr = 0;
  for (let i = 0; i < episodes; i++) {
    const stressPnl = pnlSampler(); // zero-drift sample → losses are |pnl|-tail
    losses[i] = Math.abs(stressPnl);
    const ggr = ggrSampler();
    sumGgr += ggr;
    sumSqGgr += ggr * ggr;
  }
  losses.sort((a, b) => a - b);

  // For zero-drift stress test, take α-percentile of |P&L|-magnitudes (worst-case
  // volatility-driven loss magnitude regardless of sign).
  const idxVar = Math.floor(cfg.varConfidenceLevel * episodes);
  const observedVarAlphaTHorizon = losses[Math.min(idxVar, episodes - 1)];

  // Empirical ES = mean of |P&L|-magnitudes above VaR
  let sumTailLoss = 0;
  let tailCount = 0;
  for (let i = idxVar; i < episodes; i++) {
    sumTailLoss += losses[i];
    tailCount++;
  }
  const observedExpectedShortfallAlphaTHorizon =
    tailCount > 0 ? sumTailLoss / tailCount : 0;

  const observedExpectedDailyGgr = sumGgr / episodes;
  const obsVarGgrRaw =
    sumSqGgr / episodes - observedExpectedDailyGgr * observedExpectedDailyGgr;
  const observedStdDailyGgr = Math.sqrt(Math.max(0, obsVarGgrRaw));

  return {
    episodes,
    observedExpectedDailyGgr,
    observedStdDailyGgr,
    observedVarAlphaTHorizon,
    observedExpectedShortfallAlphaTHorizon,
  };
}
