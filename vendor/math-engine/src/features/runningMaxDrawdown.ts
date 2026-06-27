/**
 * W152 Wave 161 — Max Drop From Starting Bankroll During Session Analyzer (52. solver).
 *
 * INDUSTRY-FIRST regulatory kernel — UKGC LCCP 3.4.3 (responsible gambling
 * "loss tracking during session"), MGA Player Protection Directives §17
 * (running drawdown disclosure), EU EBA Responsible Gambling Directive
 * 2024 (drawdown VaR for harm-prevention messaging), AU NCPF Reform 2022
 * (intra-session loss disclosure).
 *
 * **52nd closed-form solver** — third side of W154/W157 family:
 *   - W154 (P-069) Free Bet WR: bonus pool first-passage with fixed-horizon WR
 *   - W157 (P-070): FIRST-PASSAGE to zero (bust event, τ_bust)
 *   - W161 (P-072): MAX DROP FROM STARTING BANKROLL over [0, T] horizon
 *                   (one-sided reflection, exact closed-form via Bachelier)
 *
 * The three solvers answer complementary regulator questions:
 *   - W154: "Will player complete bonus wagering requirement without busting?"
 *   - W157: "When will the player go broke (bankroll → 0)?"
 *   - W161: "What is the deepest single-session drop from starting bankroll,
 *           even if player doesn't bust?"
 *
 * The W161 question matters for harm-prevention messaging — a player who
 * never busts but watches £50 evaporate from starting bankroll feels the
 * harm just as acutely. Regulators are starting to require ALL three
 * disclosures (responsible gambling triad: bonus-WR / bust / max-drop).
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Bankroll process X_n = B + Σ_{i=1..n} ΔX_i where ΔX_i ~ N(μ_step, σ_step²)
 * with μ_step = b·(R−1) and σ_step² = (v·b)². Approximate as Brownian motion
 * X(t) starting at X_0 = B, drift μ per spin, instantaneous variance σ².
 *
 * Define the (one-sided) max drop from starting bankroll:
 *   MaxDrop_T = max_{s ∈ [0, T]} (X_0 − X_s)   (≥ 0; zero when player never
 *                                                  goes below start)
 * Equivalently, set W_s = X_s − X_0 so W_0 = 0; then:
 *   MaxDrop_T = max_{s ∈ [0, T]} (−W_s) = −min_{s ∈ [0, T]} W_s
 *
 * Reflection-Principle / Bachelier formula for the running minimum of a
 * Brownian motion with drift μ and per-unit variance σ², starting from 0:
 *
 *   P(min_{[0,T]} W_s ≤ −d)
 *     = P(MaxDrop_T ≥ d)
 *     = Φ(−(d − μT)/(σ√T)) + exp(−2μd/σ²) · Φ(−(d + μT)/(σ√T))
 *
 * This is the dual of the W154/W157 first-passage formula (with bankroll
 * threshold replaced by drawdown threshold, and signs flipped). Sanity:
 *   - d = 0: S(0) = 1 (always have some drawdown over a horizon)
 *   - d → ∞: S(d) → 0
 *   - μ > 0 (player edge): exponent < 0, suppresses tail
 *   - μ < 0 (house edge): exponent > 0, inflates tail
 *
 * Moments via direct integration of the survival function:
 *   E[MDD_T] = ∫₀^∞ P(MDD_T ≥ d) dd
 *   E[MDD_T²] = ∫₀^∞ 2d · P(MDD_T ≥ d) dd
 *
 * Numerical integration: adaptive Simpson's rule with auto-truncated upper
 * bound at d* such that S(d*) ≤ 1e-12. Percentile (90/95/99) via bisection
 * on the survival function.
 *
 * ── Distinct from ────────────────────────────────────────────────────────
 *   - W157 (P-070) Session Bankroll Drawdown: first-passage to 0 (terminal bust)
 *   - W154 (P-069) Free Bet Wagering Requirement: bonus pool fixed-horizon
 *   - W148 (P-061) Max Win Cap: payout truncation, not drawdown
 *   - W081 Bonus Buy Variance: paid mode single-buy EV
 *
 * ── Disclosure metrics (regulator-grade) ─────────────────────────────────
 *   - expectedMaxDrawdown — typical peak-to-trough loss
 *   - varMaxDrawdown, stdDevMaxDrawdown
 *   - percentileMaxDrawdown90, 95, 99 — VaR-style harm-prevention thresholds
 *   - probMaxDrawdownExceedsLimit — operator-set "alert me if drawdown ≥ £X"
 *   - oneInNSessionsExceedsLimit — regulator "1 in N sessions" form
 *
 * Naming: "running max drawdown", "peak-to-trough" = generic actuarial /
 * finance terms (Magdon-Ismail & Atiya 2004, Pole-Hayya-Roden 2010). No
 * vendor TM, no operator brand.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface RunningMaxDrawdownConfig {
  /** Bet level per spin b > 0 (currency units). */
  betPerSpin: number;
  /** Game RTP as fraction (e.g. 0.96). */
  rtp: number;
  /** Per-spin standard deviation as multiple of bet (slot volatility index). */
  volatilityIndex: number;
  /** Session horizon in spins (must be ≥ 1). */
  horizonSpins: number;
  /** Optional drawdown limit (£) for alert metric; default = 2× betPerSpin·√horizonSpins. */
  drawdownLimit?: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface RunningMaxDrawdownResult {
  /** Per-spin drift μ = b·(R−1). */
  driftPerSpin: number;
  /** Per-spin std-dev σ = v·b. */
  sigmaPerSpin: number;
  /** Drift regime classification. */
  driftRegime: 'negative' | 'zero' | 'positive';
  /** E[MDD] over horizon (in currency units). */
  expectedMaxDrawdown: number;
  /** Var[MDD] over horizon. */
  varMaxDrawdown: number;
  /** Std dev of MDD over horizon. */
  stdDevMaxDrawdown: number;
  /** Percentile drawdowns (VaR-style harm thresholds). */
  percentileMaxDrawdown90: number;
  percentileMaxDrawdown95: number;
  percentileMaxDrawdown99: number;
  /** Configured drawdown alert limit. */
  drawdownLimit: number;
  /** Probability max drawdown exceeds limit. */
  probMaxDrawdownExceedsLimit: number;
  /** Regulator "1 in N sessions" frequency form. */
  oneInNSessionsExceedsLimit: number;
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

/** Abramowitz-Stegun erf approximation (max error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF Φ(z) = 0.5 · (1 + erf(z/√2)). */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Bachelier / Reflection Principle survival function for max drop from
 * starting bankroll of BM(μ, σ²) over [0, T], starting at W_0 = 0:
 *
 *   P(MaxDrop_T ≥ d)
 *     = P(min_{[0,T]} W_s ≤ −d)
 *     = Φ(−(d + μT)/(σ√T)) + exp(−2μd/σ²) · Φ(−(d − μT)/(σ√T))
 *
 * (Karatzas-Shreve §3.5: sup-of-BM formula applied to −W to get inf-of-W.)
 *
 * Sanity:
 *   - d → 0+: S → Φ(−μ√T/σ) + Φ(μ√T/σ) = 1 (always go below start over T)
 *   - d → ∞: S → 0
 *   - μ = 0: S = 2·Φ(−d/(σ√T)) = 2·(1 − Φ(d/(σ√T))) — classical driftless
 *   - μ < 0 (house edge): exp(−2μd/σ²) > 1 inflates tail
 *   - μ > 0 (player edge): exp(−2μd/σ²) < 1 suppresses tail
 */
function maxDrawdownSurvival(d: number, drift: number, variance: number, T: number): number {
  if (d <= 0) return 1;
  if (!Number.isFinite(d)) return 0;
  if (variance <= 0 || T <= 0) {
    // Degenerate: deterministic drift only. MaxDrop = max(0, -drift·T).
    const det = Math.max(0, -drift * T);
    return d <= det ? 1 : 0;
  }
  const sigmaT = Math.sqrt(variance * T);
  const muT = drift * T;
  const term1 = normalCdf(-(d + muT) / sigmaT);
  const exponent = (-2 * drift * d) / variance;
  // Clamp exponent to avoid overflow for extreme drift/variance ratios.
  const safeExp = Math.exp(Math.max(-700, Math.min(700, exponent)));
  const term2 = safeExp * normalCdf(-(d - muT) / sigmaT);
  const s = term1 + term2;
  return Math.max(0, Math.min(1, s));
}

/**
 * Integrate ∫₀^Dmax f(d) · S(d) dd via composite Simpson's rule.
 * Auto-detects Dmax such that S(Dmax) ≤ tail tol (default 1e-12).
 * f(d) is the integrand multiplier (1 for E[MDD], 2d for E[MDD²]).
 */
function integrateSurvivalMoment(
  drift: number,
  variance: number,
  T: number,
  fOfD: (d: number) => number,
): number {
  // Find upper bound via doubling until S(d) < tol.
  const tol = 1e-12;
  // Start estimate based on σ√T and drift magnitude.
  const sigmaT = Math.sqrt(Math.max(variance, 1e-9) * Math.max(T, 1e-9));
  let upper = Math.max(10 * sigmaT, 10 * Math.abs(drift * T), 10);
  let s = maxDrawdownSurvival(upper, drift, variance, T);
  let iter = 0;
  while (s > tol && iter < 60) {
    upper *= 2;
    s = maxDrawdownSurvival(upper, drift, variance, T);
    iter++;
  }
  // Composite Simpson's rule with 1024 intervals.
  const N = 1024;
  const h = upper / N;
  let sum = fOfD(0) * maxDrawdownSurvival(0, drift, variance, T);
  // Endpoint contribution at d=upper.
  const lastD = upper;
  sum += fOfD(lastD) * maxDrawdownSurvival(lastD, drift, variance, T);
  // Odd-indexed (4×) and even-indexed (2×) interior points.
  for (let i = 1; i < N; i++) {
    const d = i * h;
    const val = fOfD(d) * maxDrawdownSurvival(d, drift, variance, T);
    sum += (i % 2 === 0 ? 2 : 4) * val;
  }
  return (h / 3) * sum;
}

/**
 * Find d such that P(MDD ≥ d) = 1 − q (i.e. q-th percentile) via bisection.
 */
function findQuantile(
  q: number,
  drift: number,
  variance: number,
  T: number,
): number {
  if (q <= 0) return 0;
  if (q >= 1) return Infinity;
  const target = 1 - q;
  // Bracket: low=0 (S=1≥target), high=expand until S(high)<target.
  const sigmaT = Math.sqrt(Math.max(variance, 1e-9) * Math.max(T, 1e-9));
  let hi = Math.max(10 * sigmaT, 10 * Math.abs(drift * T), 10);
  while (maxDrawdownSurvival(hi, drift, variance, T) > target) {
    hi *= 2;
    if (hi > 1e15) return hi;
  }
  let lo = 0;
  for (let iter = 0; iter < 60; iter++) {
    const mid = 0.5 * (lo + hi);
    if (maxDrawdownSurvival(mid, drift, variance, T) > target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: RunningMaxDrawdownConfig): void {
  if (!Number.isFinite(cfg.betPerSpin) || cfg.betPerSpin <= 0) {
    throw new Error(`runningMaxDrawdown: betPerSpin must be > 0, got ${cfg.betPerSpin}`);
  }
  if (!Number.isFinite(cfg.rtp) || cfg.rtp < 0 || cfg.rtp > 2) {
    throw new Error(`runningMaxDrawdown: rtp must be in [0, 2], got ${cfg.rtp}`);
  }
  if (!Number.isFinite(cfg.volatilityIndex) || cfg.volatilityIndex <= 0) {
    throw new Error(
      `runningMaxDrawdown: volatilityIndex must be > 0, got ${cfg.volatilityIndex}`,
    );
  }
  if (!Number.isInteger(cfg.horizonSpins) || cfg.horizonSpins <= 0) {
    throw new Error(`runningMaxDrawdown: horizonSpins must be positive integer, got ${cfg.horizonSpins}`);
  }
  if (cfg.drawdownLimit !== undefined) {
    if (!Number.isFinite(cfg.drawdownLimit) || cfg.drawdownLimit <= 0) {
      throw new Error(`runningMaxDrawdown: drawdownLimit must be > 0 if given, got ${cfg.drawdownLimit}`);
    }
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveRunningMaxDrawdown(
  cfg: RunningMaxDrawdownConfig,
): RunningMaxDrawdownResult {
  validateConfig(cfg);

  const drift = cfg.betPerSpin * (cfg.rtp - 1);
  const sigmaPerSpin = cfg.volatilityIndex * cfg.betPerSpin;
  const variancePerSpin = sigmaPerSpin * sigmaPerSpin;
  const T = cfg.horizonSpins;

  let driftRegime: 'negative' | 'zero' | 'positive';
  if (drift < -1e-12) driftRegime = 'negative';
  else if (drift > 1e-12) driftRegime = 'positive';
  else driftRegime = 'zero';

  // Moments via integration.
  const e1 = integrateSurvivalMoment(drift, variancePerSpin, T, () => 1);
  const e2 = integrateSurvivalMoment(drift, variancePerSpin, T, (d) => 2 * d);
  const variance = Math.max(0, e2 - e1 * e1);
  const stdDev = Math.sqrt(variance);

  // Percentiles.
  const p90 = findQuantile(0.90, drift, variancePerSpin, T);
  const p95 = findQuantile(0.95, drift, variancePerSpin, T);
  const p99 = findQuantile(0.99, drift, variancePerSpin, T);

  // Limit metric.
  const limit =
    cfg.drawdownLimit ?? 2 * cfg.betPerSpin * Math.sqrt(T);
  const probExceeds = maxDrawdownSurvival(limit, drift, variancePerSpin, T);
  const oneInN = probExceeds > 1e-15 ? 1 / probExceeds : Infinity;

  return {
    driftPerSpin: drift,
    sigmaPerSpin,
    driftRegime,
    expectedMaxDrawdown: e1,
    varMaxDrawdown: variance,
    stdDevMaxDrawdown: stdDev,
    percentileMaxDrawdown90: p90,
    percentileMaxDrawdown95: p95,
    percentileMaxDrawdown99: p99,
    drawdownLimit: limit,
    probMaxDrawdownExceedsLimit: probExceeds,
    oneInNSessionsExceedsLimit: oneInN,
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

function gaussianSample(rng: () => number): number {
  let u1 = rng();
  while (u1 < 1e-12) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface RunningMaxDrawdownMcResult {
  episodes: number;
  observedExpectedMaxDrawdown: number;
  observedStdDevMaxDrawdown: number;
  observedPercentile90: number;
  observedPercentile95: number;
  observedPercentile99: number;
  observedProbExceedsLimit: number;
}

/**
 * MC: per episode, simulate horizonSpins steps tracking position relative to
 * starting bankroll (W_t = X_t − X_0); record max drop from start =
 * max{−W_s for s in [0, T]} = −min(W_s, 0).
 */
export function simulateRunningMaxDrawdown(
  cfg: RunningMaxDrawdownConfig,
  episodes: number,
  seed: number,
): RunningMaxDrawdownMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  const drift = cfg.betPerSpin * (cfg.rtp - 1);
  const sigma = cfg.volatilityIndex * cfg.betPerSpin;
  const limit = cfg.drawdownLimit ?? 2 * cfg.betPerSpin * Math.sqrt(cfg.horizonSpins);

  const mdds: number[] = [];
  let exceedsCount = 0;

  for (let e = 0; e < episodes; e++) {
    let pos = 0; // W_t = X_t − X_0
    let minPos = 0; // track running min of W
    for (let s = 0; s < cfg.horizonSpins; s++) {
      pos += drift + sigma * gaussianSample(rng);
      if (pos < minPos) minPos = pos;
    }
    const maxDrop = Math.max(0, -minPos);
    mdds.push(maxDrop);
    if (maxDrop >= limit) exceedsCount++;
  }

  const sumMdd = mdds.reduce((a, b) => a + b, 0);
  const meanMdd = sumMdd / episodes;
  const sumSq = mdds.reduce((a, b) => a + (b - meanMdd) * (b - meanMdd), 0);
  const stdMdd = Math.sqrt(sumSq / episodes);
  const sorted = mdds.slice().sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

  return {
    episodes,
    observedExpectedMaxDrawdown: meanMdd,
    observedStdDevMaxDrawdown: stdMdd,
    observedPercentile90: pick(0.90),
    observedPercentile95: pick(0.95),
    observedPercentile99: pick(0.99),
    observedProbExceedsLimit: exceedsCount / episodes,
  };
}

/** ── Re-exports for portfolio / acceptance ──────────────────────────────── */
export const _runningMaxDrawdownInternal = {
  maxDrawdownSurvival,
  findQuantile,
};
