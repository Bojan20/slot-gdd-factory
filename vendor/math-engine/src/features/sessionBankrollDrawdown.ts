/**
 * W152 Wave 157 — Session Bankroll Drawdown Analyzer (Faza 12 ext, post-W100).
 *
 * INDUSTRY-FIRST closed-form solver za "real-money session bankroll first-
 * passage analysis" — UKGC LCCP 3.4.3 (responsible gambling, player-protection
 * messaging), MGA Player Protection Directives §16 (realistic time-to-loss
 * disclosure), EU EBA Responsible Gambling Directive 2024 (harm-prevention
 * metrics including median bust time and 1-in-N hourly loss frequency).
 *
 * **50. solver MILESTONE** — distinct from W154 Free Bet Wagering Requirement:
 *   - W154: BONUS pool sa explicit WR target N = ⌈W/b⌉ spins, terminal event
 *           at bonus completion or zero crossing.
 *   - W157: REAL-MONEY session bankroll, OPEN horizon (player decides to stop),
 *           first-passage time analysis sa Inverse Gaussian distribution,
 *           drawdown probability over arbitrary horizon H, session length
 *           and per-hour loss disclosure metrics.
 *
 * Distinct from:
 *   - W148 Max Win Cap Truncation (payout cap, not bust event).
 *   - W95  Ante Bet Trade-Off (single-bet decision EV, no bankroll dynamics).
 *   - W57  Crash Multiplier (target multiplier hit, not bankroll first-passage).
 *   - W81  Bonus Buy Variance (paid mode single-buy EV, no bankroll dynamics).
 *
 * Naming policy (clean-room): "session bankroll", "first-passage", "drawdown",
 * "time-to-bust", "responsible gambling disclosure" = generic regulatory /
 * actuarial / probability-theory terms. No vendor TM, no operator brand.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Player starts with bankroll B (real money, no wagering requirement).
 * Bets b per spin on game with RTP R, volatility index v (per-spin stdev /
 * bet ratio — same convention as W154).
 *
 * Per-spin balance change ΔX has E[ΔX] = b·(R − 1) ≡ μ_step (negative for R<1)
 * and Var[ΔX] = (v·b)² ≡ σ_step². Over N spins, by CLT-Bachelier limit, the
 * bankroll process is approximated as Brownian motion sa drift μ = μ_step
 * per spin (per-spin time unit) and instantaneous variance σ² = σ_step² per
 * spin. Starting at X(0) = B > 0.
 *
 * Bust event: τ_bust = inf{n ≥ 0 : X_n ≤ 0}.
 *
 * ── Closed-form τ_bust distribution (Inverse Gaussian, μ < 0) ─────────────
 * For Brownian motion sa drift μ < 0 starting at B > 0, the first-passage
 * time to 0 has Inverse Gaussian (Wald) distribution:
 *
 *   τ ~ IG(μ_IG = B/|μ|,  λ = B²/σ²)
 *
 * Density:    f(t) = √(λ/(2π t³)) · exp(−λ (t − μ_IG)² / (2 μ_IG² t))
 * CDF:        F(t) = Φ(√(λ/t)·(t/μ_IG − 1)) + exp(2λ/μ_IG) · Φ(−√(λ/t)·(t/μ_IG + 1))
 *
 * Standard IG moments (μ_IG = B/|μ|, λ = B²/σ²):
 *   E[τ]      = μ_IG          =  B/|μ|
 *   Var[τ]    = μ_IG³/λ       =  B σ² / |μ|³
 *   Mode      = μ_IG ((1 + 9μ_IG²/(4λ²))^{1/2} − 3μ_IG/(2λ))
 *
 * Probability of EVER busting:
 *   μ < 0  (house edge):   P(τ < ∞)  = 1                          (sure bust)
 *   μ = 0  (fair game):    P(τ < ∞)  = 1                          (sure bust, infinite mean)
 *   μ > 0  (player edge):  P(τ < ∞)  = exp(2 B μ / σ²) with μ < 0 sign,
 *                                  i.e. exp(−2 B |μ| / σ²) where μ_signed > 0.
 *
 * ── Drawdown probability over finite horizon H ────────────────────────────
 * P(bust by spin H) = F(H) — direct IG CDF evaluation.
 * P(survive H)      = 1 − F(H).
 *
 * Expected bankroll after H spins conditional on no bust:
 *   E[X_H | min_{[0,H]} X > 0]    using truncated joint density (W154 helper).
 *
 * Expected loss over horizon H (unconditional):
 *   E[L_H]            = B − E[X_H · 1{survive}] − 0 · P(bust)
 *                     = B − Bachelier-positive-balance helper from W154.
 *
 * ── Session-length / loss-rate disclosure metrics ─────────────────────────
 * Industry convention: 600 spins/hour for slots (10/min). Configurable.
 *
 *   medianSpinsToBust   = numerical inversion of IG CDF at 0.5.
 *   medianMinutesToBust = medianSpins / spinsPerHour · 60.
 *   expectedHoursPlayed = E[τ] / spinsPerHour.
 *   oneInNHoursBust     = 1 / P(bust within 1 hour).
 *   probSurviveHorizonH = 1 − F(spinsPerHour · H_hours) for H ∈ {1, 2, 4, 8}.
 *   expectedLossPerHour = spinsPerHour · |μ_step|  (deterministic mean rate).
 *
 * Sign convention: "loss" reported as POSITIVE number (player perspective).
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface SessionBankrollDrawdownConfig {
  /** Initial real-money bankroll B > 0. */
  bankroll: number;
  /** Bet level per spin b > 0 (same currency units). */
  betPerSpin: number;
  /** Game RTP as fraction (e.g. 0.96 for 96%). */
  rtp: number;
  /** Per-spin standard deviation as multiple of bet (slot volatility index). */
  volatilityIndex: number;
  /** Spin rate convention (industry default 600/hour for slots, 60 for table). */
  spinsPerHour?: number;
  /** Horizons (hours) for survival probability grid (default [1, 2, 4, 8]). */
  horizonHours?: number[];
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface SessionBankrollDrawdownResult {
  /** Per-spin mean balance change (negative for RTP<1). */
  driftPerSpin: number;
  /** Per-spin balance change std-dev. */
  sigmaPerSpin: number;
  /** Drift class: "negative" (house edge), "zero" (fair), "positive" (player edge). */
  driftRegime: 'negative' | 'zero' | 'positive';
  /** Probability of EVER busting (over infinite horizon). */
  probEverBust: number;
  /** E[τ_bust] expected spin count to bust (μ<0 only; +∞ for μ≥0). */
  expectedSpinsToBust: number;
  /** Std-dev of τ_bust (μ<0 only; NaN for μ≥0). */
  stdDevSpinsToBust: number;
  /** Median spins to bust (numerical IG CDF inversion). */
  medianSpinsToBust: number;
  /** Median minutes to bust = medianSpins / spinsPerHour · 60. */
  medianMinutesToBust: number;
  /** Expected hours played to bust = E[τ] / spinsPerHour. */
  expectedHoursPlayed: number;
  /** Expected loss per hour (deterministic mean rate, positive for player loss). */
  expectedLossPerHour: number;
  /** Survival probability grid: { hours, probSurvive }. */
  survivalProbByHorizon: Array<{ hours: number; spins: number; probSurvive: number }>;
  /** Regulator "1-in-N" hourly bust frequency = 1 / P(bust within 1 hour). */
  oneInNHoursBust: number;
  /** Expected bankroll after 1 hour of play conditional on survival. */
  expectedBankrollAfter1Hour: number;
  /** Expected bankroll after 1 hour unconditional (includes 0 on bust paths). */
  expectedBankrollAfter1HourUnconditional: number;
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

/** Standard normal PDF φ(z) = exp(−z²/2)/√(2π). */
function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Inverse Gaussian CDF F(t; μ_IG, λ).
 *
 * Closed form via two-term Normal CDF combination (Chhikara-Folks 1989,
 * Wald 1947 original):
 *
 *   F(t) = Φ(√(λ/t) · (t/μ − 1)) + exp(2λ/μ) · Φ(−√(λ/t) · (t/μ + 1))
 *
 * Returns 0 for t≤0, 1 in limit t→∞.
 */
function inverseGaussianCdf(t: number, mu: number, lambda: number): number {
  if (t <= 0) return 0;
  if (!Number.isFinite(t)) return 1;
  if (mu <= 0 || lambda <= 0) return NaN;
  const sqrtLambdaOverT = Math.sqrt(lambda / t);
  const term1Arg = sqrtLambdaOverT * (t / mu - 1);
  const term2Arg = -sqrtLambdaOverT * (t / mu + 1);
  const phi1 = normalCdf(term1Arg);
  const phi2 = normalCdf(term2Arg);
  const expCoeff = Math.exp((2 * lambda) / mu);
  let cdf = phi1 + expCoeff * phi2;
  // Numerical guard: clamp into [0, 1].
  if (cdf < 0) cdf = 0;
  if (cdf > 1) cdf = 1;
  return cdf;
}

/**
 * Inverse Gaussian CDF inversion (find t such that F(t) = q) via bisection.
 * Robust default for q ∈ (0, 1). Returns NaN on degenerate input.
 */
function inverseGaussianQuantile(q: number, mu: number, lambda: number): number {
  if (q <= 0) return 0;
  if (q >= 1) return Infinity;
  if (mu <= 0 || lambda <= 0) return NaN;
  // Bracket: start from [eps, 1000·μ_IG] and expand if needed.
  let lo = 1e-9;
  let hi = Math.max(10, 1000 * mu);
  while (inverseGaussianCdf(hi, mu, lambda) < q) {
    hi *= 2;
    if (hi > 1e18) return hi; // unreasonably large, bail
  }
  // Bisection — 60 iterations gives ≥ 18 decimal digits.
  for (let iter = 0; iter < 60; iter++) {
    const mid = 0.5 * (lo + hi);
    if (inverseGaussianCdf(mid, mu, lambda) < q) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

/**
 * E[X_T · 1{min ≥ 0} · 1{X_T ≥ 0}] for BM(X_0=B, drift=μ, var/unit=σ²)
 * — exact via Reflection Principle joint density (reused from W154 conventions).
 */
function expectedPositiveBalanceWithSurvival(
  start: number,
  drift: number,
  variancePerUnit: number,
  T: number,
): number {
  if (T <= 0 || variancePerUnit <= 0 || start <= 0) return Math.max(0, start);
  const sigmaT = Math.sqrt(variancePerUnit * T);
  const muT = drift * T;
  const m1 = start + muT;
  const m2 = -start + muT;
  const a1 = m1 / sigmaT;
  const a2 = m2 / sigmaT;
  const intUnreflected = sigmaT * normalPdf(a1) + m1 * normalCdf(a1);
  const intReflected = sigmaT * normalPdf(a2) + m2 * normalCdf(a2);
  const reflectionWeight = Math.exp((-2 * start * drift) / variancePerUnit);
  const value = intUnreflected - reflectionWeight * intReflected;
  return Math.max(0, value);
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: SessionBankrollDrawdownConfig): void {
  if (!Number.isFinite(cfg.bankroll) || cfg.bankroll <= 0) {
    throw new Error(
      `sessionBankrollDrawdown: bankroll must be > 0, got ${cfg.bankroll}`,
    );
  }
  if (!Number.isFinite(cfg.betPerSpin) || cfg.betPerSpin <= 0) {
    throw new Error(
      `sessionBankrollDrawdown: betPerSpin must be > 0, got ${cfg.betPerSpin}`,
    );
  }
  if (cfg.betPerSpin > cfg.bankroll) {
    throw new Error(
      `sessionBankrollDrawdown: betPerSpin (${cfg.betPerSpin}) > bankroll (${cfg.bankroll}) — player cannot start a spin`,
    );
  }
  if (!Number.isFinite(cfg.rtp) || cfg.rtp < 0 || cfg.rtp > 2) {
    throw new Error(
      `sessionBankrollDrawdown: rtp must be in [0, 2], got ${cfg.rtp}`,
    );
  }
  if (!Number.isFinite(cfg.volatilityIndex) || cfg.volatilityIndex <= 0) {
    throw new Error(
      `sessionBankrollDrawdown: volatilityIndex must be > 0, got ${cfg.volatilityIndex}`,
    );
  }
  if (cfg.spinsPerHour !== undefined && (!Number.isFinite(cfg.spinsPerHour) || cfg.spinsPerHour <= 0)) {
    throw new Error(
      `sessionBankrollDrawdown: spinsPerHour must be > 0 if given, got ${cfg.spinsPerHour}`,
    );
  }
  if (cfg.horizonHours !== undefined) {
    if (!Array.isArray(cfg.horizonHours) || cfg.horizonHours.length === 0) {
      throw new Error(`sessionBankrollDrawdown: horizonHours must be non-empty array if given`);
    }
    for (const h of cfg.horizonHours) {
      if (!Number.isFinite(h) || h <= 0) {
        throw new Error(`sessionBankrollDrawdown: horizonHours must contain only positive numbers, got ${h}`);
      }
    }
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveSessionBankrollDrawdown(
  cfg: SessionBankrollDrawdownConfig,
): SessionBankrollDrawdownResult {
  validateConfig(cfg);

  const spinsPerHour = cfg.spinsPerHour ?? 600;
  const horizonHours = cfg.horizonHours ?? [1, 2, 4, 8];

  const driftPerSpin = cfg.betPerSpin * (cfg.rtp - 1);
  const sigmaPerSpin = cfg.volatilityIndex * cfg.betPerSpin;
  const variancePerSpin = sigmaPerSpin * sigmaPerSpin;

  let driftRegime: 'negative' | 'zero' | 'positive';
  if (driftPerSpin < -1e-12) driftRegime = 'negative';
  else if (driftPerSpin > 1e-12) driftRegime = 'positive';
  else driftRegime = 'zero';

  // Probability of EVER busting (infinite-horizon hit prob for BM with drift).
  let probEverBust: number;
  if (driftRegime === 'positive') {
    // P(τ<∞) = exp(−2 B |μ| / σ²) for positive drift — drift here in same sign.
    probEverBust = Math.exp((-2 * cfg.bankroll * driftPerSpin) / variancePerSpin);
  } else {
    probEverBust = 1;
  }
  probEverBust = Math.max(0, Math.min(1, probEverBust));

  // Inverse-Gaussian moments (for μ<0).
  let expectedSpins = Infinity;
  let stdSpins = NaN;
  let medianSpins = Infinity;
  if (driftRegime === 'negative') {
    const absDrift = -driftPerSpin; // > 0
    const muIG = cfg.bankroll / absDrift;
    const lambdaIG = (cfg.bankroll * cfg.bankroll) / variancePerSpin;
    expectedSpins = muIG;
    const varSpins = (muIG * muIG * muIG) / lambdaIG; // = B σ² / |μ|³
    stdSpins = Math.sqrt(varSpins);
    medianSpins = inverseGaussianQuantile(0.5, muIG, lambdaIG);
  } else if (driftRegime === 'zero') {
    // For driftless BM, hitting-time mean is infinite. Median has known
    // closed form via half-normal: P(max_{[0,t]} W ≥ B) = 2(1 − Φ(B/(σ√t))).
    // Setting this = 0.5 → B/(σ·√t_med) = Φ⁻¹(0.75) = 0.6745 (approx).
    // t_med ≈ B² / (σ · 0.6745)² = B² / (σ² · 0.4549).
    const zHalf = 0.674489750196082; // Φ⁻¹(0.75)
    medianSpins = (cfg.bankroll * cfg.bankroll) / (variancePerSpin * zHalf * zHalf);
  }
  // For positive drift (driftRegime === 'positive'), expectedSpins, stdSpins,
  // medianSpins remain at their initial sentinel values (Infinity, NaN, Infinity).
  // This is mathematically correct — busting-conditional moments require a
  // size-biased distribution beyond this disclosure metric's scope.

  // Survival probability grid over horizons.
  const survivalProbByHorizon = horizonHours.map((hours) => {
    const spins = spinsPerHour * hours;
    let probSurvive: number;
    if (driftRegime === 'negative') {
      const absDrift = -driftPerSpin;
      const muIG = cfg.bankroll / absDrift;
      const lambdaIG = (cfg.bankroll * cfg.bankroll) / variancePerSpin;
      probSurvive = 1 - inverseGaussianCdf(spins, muIG, lambdaIG);
    } else if (driftRegime === 'zero') {
      // For driftless BM hitting B from 0 (or equivalently 0 from B), use
      //   P(τ ≤ t) = 2 · (1 − Φ(B/(σ·√t)))
      const z = cfg.bankroll / Math.sqrt(variancePerSpin * spins);
      probSurvive = 1 - 2 * (1 - normalCdf(z));
    } else {
      // Positive drift — finite-time bust prob has Bachelier closed form:
      //   P(min_{[0,T]} X ≤ 0) = Φ((−B − μT)/(σ√T)) + exp(−2Bμ/σ²)·Φ((−B + μT)/(σ√T))
      const sigmaT = Math.sqrt(variancePerSpin * spins);
      const term1 = normalCdf((-cfg.bankroll - driftPerSpin * spins) / sigmaT);
      const term2 = normalCdf((-cfg.bankroll + driftPerSpin * spins) / sigmaT);
      const expCoeff = Math.exp((-2 * cfg.bankroll * driftPerSpin) / variancePerSpin);
      const bustProb = Math.max(0, Math.min(1, term1 + expCoeff * term2));
      probSurvive = 1 - bustProb;
    }
    return { hours, spins, probSurvive: Math.max(0, Math.min(1, probSurvive)) };
  });

  // 1-in-N hourly bust frequency.
  const probBust1Hour = (() => {
    const row = survivalProbByHorizon.find((r) => Math.abs(r.hours - 1) < 1e-9);
    if (row) return 1 - row.probSurvive;
    // Compute on demand if 1h not in horizon list.
    const spins = spinsPerHour;
    if (driftRegime === 'negative') {
      const absDrift = -driftPerSpin;
      const muIG = cfg.bankroll / absDrift;
      const lambdaIG = (cfg.bankroll * cfg.bankroll) / variancePerSpin;
      return inverseGaussianCdf(spins, muIG, lambdaIG);
    } else if (driftRegime === 'zero') {
      const z = cfg.bankroll / Math.sqrt(variancePerSpin * spins);
      return 2 * (1 - normalCdf(z));
    } else {
      const sigmaT = Math.sqrt(variancePerSpin * spins);
      const term1 = normalCdf((-cfg.bankroll - driftPerSpin * spins) / sigmaT);
      const term2 = normalCdf((-cfg.bankroll + driftPerSpin * spins) / sigmaT);
      const expCoeff = Math.exp((-2 * cfg.bankroll * driftPerSpin) / variancePerSpin);
      return Math.max(0, Math.min(1, term1 + expCoeff * term2));
    }
  })();
  const oneInNHoursBust = probBust1Hour > 1e-15 ? 1 / probBust1Hour : Infinity;

  // Expected bankroll after 1 hour.
  const spins1h = spinsPerHour;
  const expectedBankroll1hSurvive = expectedPositiveBalanceWithSurvival(
    cfg.bankroll,
    driftPerSpin,
    variancePerSpin,
    spins1h,
  );
  const survival1h = (() => {
    const row = survivalProbByHorizon.find((r) => Math.abs(r.hours - 1) < 1e-9);
    return row ? row.probSurvive : 1 - probBust1Hour;
  })();
  // E[X_H · 1{survive}] / P(survive) — conditional mean given no bust.
  const expectedBankrollAfter1Hour =
    survival1h > 1e-12 ? expectedBankroll1hSurvive / survival1h : 0;
  // Unconditional E[X_H] over all paths (0 on bust paths).
  const expectedBankrollAfter1HourUnconditional = expectedBankroll1hSurvive;

  // Deterministic loss-per-hour rate (mean drift × spins/hour, sign-flipped to
  // positive "loss").
  const expectedLossPerHour =
    driftRegime === 'negative' ? -driftPerSpin * spinsPerHour : Math.max(0, -driftPerSpin * spinsPerHour);

  const medianMinutesToBust =
    Number.isFinite(medianSpins) ? (medianSpins / spinsPerHour) * 60 : Infinity;
  const expectedHoursPlayed =
    Number.isFinite(expectedSpins) ? expectedSpins / spinsPerHour : Infinity;

  return {
    driftPerSpin,
    sigmaPerSpin,
    driftRegime,
    probEverBust,
    expectedSpinsToBust: expectedSpins,
    stdDevSpinsToBust: stdSpins,
    medianSpinsToBust: medianSpins,
    medianMinutesToBust,
    expectedHoursPlayed,
    expectedLossPerHour,
    survivalProbByHorizon,
    oneInNHoursBust,
    expectedBankrollAfter1Hour,
    expectedBankrollAfter1HourUnconditional,
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

/** Box-Muller standard-normal sample. */
function gaussianSample(rng: () => number): number {
  let u1 = rng();
  while (u1 < 1e-12) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface SessionBankrollDrawdownMcResult {
  episodes: number;
  /** Observed bust rate within maxSpinsCap horizon. */
  observedBustRateInHorizon: number;
  /** Observed mean time to bust (only over busted paths). */
  observedMeanSpinsToBustGivenBust: number;
  /** Median observed spins to bust (only over busted paths). */
  observedMedianSpinsToBustGivenBust: number;
  /** Observed P(survive 1 hour). */
  observedSurvive1Hour: number;
  /** Observed expected bankroll after 1 hour (conditional on survival). */
  observedExpectedBankroll1HourGivenSurvive: number;
}

/**
 * MC: simulate Gaussian-per-spin bankroll walk up to maxSpinsCap. Records
 * first-passage-to-zero time and bankroll at 1-hour mark.
 */
export function simulateSessionBankrollDrawdown(
  cfg: SessionBankrollDrawdownConfig,
  episodes: number,
  seed: number,
  maxSpinsCap?: number,
): SessionBankrollDrawdownMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  const spinsPerHour = cfg.spinsPerHour ?? 600;
  // Default cap = max(2·E[τ], 4·spinsPerHour) bounded for compute budget.
  const driftPerSpin = cfg.betPerSpin * (cfg.rtp - 1);
  const sigmaPerSpin = cfg.volatilityIndex * cfg.betPerSpin;
  const variancePerSpin = sigmaPerSpin * sigmaPerSpin;
  const meanTau = driftPerSpin < 0 ? cfg.bankroll / -driftPerSpin : Infinity;
  const cap =
    maxSpinsCap ??
    Math.min(
      100_000,
      Math.max(spinsPerHour * 8, Math.ceil(Number.isFinite(meanTau) ? 3 * meanTau : spinsPerHour * 8)),
    );

  let bustsInHorizon = 0;
  const bustTimes: number[] = [];
  let survive1hCount = 0;
  let bankroll1hSurvivors = 0;
  let bankroll1hSurvivorsCount = 0;

  for (let e = 0; e < episodes; e++) {
    let balance = cfg.bankroll;
    let busted = false;
    let bustTime = -1;
    let recordedAt1h = false;
    let balanceAt1h = 0;
    let survivedAt1h = false;

    for (let s = 1; s <= cap; s++) {
      const delta = driftPerSpin + sigmaPerSpin * gaussianSample(rng);
      balance += delta;
      if (balance <= 0) {
        balance = 0;
        busted = true;
        bustTime = s;
        // If 1h not yet recorded and this happens at or before 1h, mark not-survived.
        if (!recordedAt1h && s <= spinsPerHour) {
          recordedAt1h = true;
          survivedAt1h = false;
          balanceAt1h = 0;
        }
        break;
      }
      if (!recordedAt1h && s === spinsPerHour) {
        recordedAt1h = true;
        survivedAt1h = true;
        balanceAt1h = balance;
      }
    }
    if (!recordedAt1h) {
      // Cap is shorter than 1h or balance survived all spins without hitting bust
      // and the cap was ≥ spinsPerHour: this shouldn't happen because we record
      // at s === spinsPerHour. If cap < spinsPerHour, treat as survived (unfinished).
      // Sanity: only mark survive if we actually reached 1h.
      if (cap >= spinsPerHour) {
        recordedAt1h = true;
        survivedAt1h = true;
        balanceAt1h = balance;
      }
    }
    if (busted) {
      bustsInHorizon++;
      bustTimes.push(bustTime);
    }
    if (recordedAt1h && survivedAt1h) {
      survive1hCount++;
      bankroll1hSurvivors += balanceAt1h;
      bankroll1hSurvivorsCount++;
    }
  }

  const meanBustTime =
    bustTimes.length > 0 ? bustTimes.reduce((a, b) => a + b, 0) / bustTimes.length : NaN;
  const sortedBustTimes = bustTimes.slice().sort((a, b) => a - b);
  const medianBustTime =
    sortedBustTimes.length > 0
      ? sortedBustTimes[Math.floor(sortedBustTimes.length / 2)]
      : NaN;

  return {
    episodes,
    observedBustRateInHorizon: bustsInHorizon / episodes,
    observedMeanSpinsToBustGivenBust: meanBustTime,
    observedMedianSpinsToBustGivenBust: medianBustTime,
    observedSurvive1Hour: survive1hCount / episodes,
    observedExpectedBankroll1HourGivenSurvive:
      bankroll1hSurvivorsCount > 0 ? bankroll1hSurvivors / bankroll1hSurvivorsCount : 0,
  };
}

/** ── Re-exports for portfolio runner / acceptance ───────────────────────── */
export const _internal = {
  inverseGaussianCdf,
  inverseGaussianQuantile,
  expectedPositiveBalanceWithSurvival,
};
