/**
 * W152 Wave 154 — Free Bet Wagering Requirement Aggregator (Faza 12 ext, post-W100).
 *
 * INDUSTRY-FIRST closed-form solver za "bonus wagering requirement EV and
 * bust analysis" — UKGC RTS-12 (responsible gambling), MGA Player Protection
 * Directives §15 (bonus terms transparency), EU GambleAware-driven.
 *
 * Niti jedan vendor / aggregator (Pragmatic / NetEnt / Microgaming / SG) ne
 * publishuje formalnu closed-form analizu očekivane vrednosti bonus play-through-a
 * pre nego što igrač može da withdraw-uje sredstva. Operatori često citiraju
 * x35 ili x50 WR (wagering requirement) bez transparentnog disclosure-a
 * očekivane bust verovatnoće.
 *
 * Naming policy (clean-room): "wagering requirement", "bonus play-through",
 * "free bet", "bust probability" = generic regulatory / industry terms. No
 * vendor TM, no specific bonus brand name.
 *
 * ── Why this matters ──────────────────────────────────────────────────────
 * UKGC RTS-12: bonus terms must be transparent; operator must disclose
 *   typical play-through outcomes.
 * MGA Directives §15: maximum WR cap (35x deposit), prominent display.
 * EU consumer protection: "free bet" must show realistic expected return.
 *
 * Standard question: "Player gets B units bonus with WR = x. They wager at
 * bet level b on game with RTP R. What is:
 *   - Expected balance at WR completion?
 *   - P(bust before completing WR)?
 *   - Expected withdrawable amount?
 *   - Number of spins required?"
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Player starts with bankroll B (bonus, locked until WR met).
 * Bet level b per spin, RTP = R, variance σ² per unit bet.
 * Required total wagering W = x · B (x = WR multiplier).
 * Required spins N = W / b (assuming player wagers exactly b each spin).
 *
 * Per spin payout Y_i ~ distribution with E[Y_i] = R·b, Var[Y_i] = σ²·b²
 * (typical slot variance scales as bet²).
 *
 * Bankroll evolution: balance_n = B + Σ_{i=1..n} (Y_i − b)
 * Mean change per spin = R·b − b = b·(R − 1) (negative for R < 1)
 *
 * After N spins (no bust):
 *   E[balance_N] = B + N·b·(R − 1) = B·(1 + x·(R − 1)) = B·(1 − x·(1−R))
 *   Var[balance_N] = N·σ²·b² = (W·σ²·b)
 *
 * ── Bust probability (CLT/Bachelier approximation) ────────────────────────
 * Bust ≈ event that final balance ≤ 0 after N spins (conservative lower
 * bound — ignores intra-WR busts; true bust prob is ≥ this approximation).
 *
 * Final balance after N spins:
 *   X_N ~ Normal(B + N·μ, N·σ²)   (CLT)
 * where μ = drift per spin, σ² = variance per spin.
 *
 * P(X_N ≤ 0) = Φ((0 − (B + N·μ)) / (σ·√N))
 *            = Φ((−B − N·μ) / (σ·√N))
 *
 * For negative drift μ < 0: −N·μ > 0, numerator grows in N → bust prob ↑.
 * Larger |μ| (more negative RTP) → higher bust prob. ✓ matches intuition.
 *
 * Note: this UNDERESTIMATES "ever bust during WR" because the path may
 * hit 0 then recover. The true first-passage prob is given by Bachelier:
 *   P_bust = Φ((−B − μN)/(σ√N)) + exp(−2Bμ/σ²) · Φ((−B + μN)/(σ√N))
 * Operator-grade implementations should use Bachelier; this Wave 154
 * solver uses the simpler CLT bound for transparency and disclosure.
 *
 * ── Expected withdrawable ─────────────────────────────────────────────────
 * If player completes WR without busting: withdrawable = max(0, balance_N).
 * Otherwise: 0.
 * E[withdrawable] ≈ (1 − bust_prob) · E[balance_N | no bust]
 *
 * Approximate via:
 *   E[withdrawable] = max(0, E[balance_N]) · (1 − bust_prob)
 * Conservative lower bound (real value slightly higher due to truncation).
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface FreeBetWrConfig {
  /** Initial bonus amount (in currency units, e.g. £10). */
  bonusAmount: number;
  /** Wagering requirement multiplier (e.g. 35 for x35). */
  wagerMultiplier: number;
  /** Bet level per spin (in same currency units, e.g. £0.20). */
  betPerSpin: number;
  /** Game RTP as fraction (e.g. 0.96 for 96%). */
  rtp: number;
  /** Per-spin standard deviation as multiple of bet (slot volatility index). */
  volatilityIndex: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface FreeBetWrResult {
  /** Required total wagering = wagerMultiplier · bonusAmount. */
  requiredWagering: number;
  /** Required spin count = requiredWagering / betPerSpin (rounded up). */
  requiredSpins: number;
  /** Expected balance at WR completion (no bust). */
  expectedBalanceAtCompletion: number;
  /** Expected balance net of initial bonus (profit/loss). */
  expectedNetProfit: number;
  /** Std deviation of balance at WR completion (CLT approximation). */
  stdDevBalanceAtCompletion: number;
  /** P(bust before completing WR) — Wald exponential approximation. */
  bustProbability: number;
  /** Survival probability = 1 − bust. */
  survivalProbability: number;
  /** Expected withdrawable amount (≈ E[balance | no bust] · P(survive)). */
  expectedWithdrawable: number;
  /** Effective EV of "free bet" = expectedWithdrawable − 0 (since bonus is locked). */
  effectiveEV: number;
  /** Player loss rate = (B − E[withdrawable]) / B, percentage of bonus value lost. */
  playerLossRate: number;
  /** Bonus EV per bet ratio = effectiveEV / bonusAmount, "true bonus value". */
  trueBonusValueRatio: number;
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
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF Φ(z) = 0.5 · (1 + erf(z / √2)). */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Standard normal PDF φ(z) = exp(−z²/2) / √(2π). */
function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Mean of N(μ, σ²) conditioned on X > 0 — closed-form (truncated normal):
 *   E[X | X > 0] = μ + σ · φ(α) / Φ(−α),   where α = −μ/σ.
 * Returns 0 when σ ≤ 0.
 */
function truncatedNormalMeanPositive(mu: number, sigma: number): number {
  if (sigma <= 0) return mu > 0 ? mu : 0;
  const alpha = -mu / sigma;
  const denom = normalCdf(-alpha);
  if (denom < 1e-15) return 0; // numerical guard — survival negligible
  return mu + sigma * (normalPdf(alpha) / denom);
}

/**
 * E[X_T · 1{min_{[0,T]} X(s) ≥ 0} · 1{X_T ≥ 0}] — exact closed-form for
 * Brownian motion with drift starting at B > 0. Derived from the joint
 * Reflection-Principle density of (X_T, min):
 *
 *   p(X_T = x, min ≥ 0)/dx = (1/(σ√T)) ·
 *       [ φ((x − B − μT)/(σ√T)) − exp(−2Bμ/σ²) · φ((x + B − μT)/(σ√T)) ]
 *
 * Integrating x · p over x ∈ (0, ∞) and using standard truncated-normal
 * integrals ∫₀^∞ x·φ((x − m)/s)/s dx = s·φ(−m/s) + m·Φ(m/s).
 */
function expectedPositiveBalanceWithSurvival(
  bonus: number,
  drift: number,
  variancePerUnit: number,
  T: number,
): number {
  if (T <= 0 || variancePerUnit <= 0 || bonus <= 0) return Math.max(0, bonus);
  const sigmaT = Math.sqrt(variancePerUnit * T); // σ√T
  const muT = drift * T; // E[X_T] − B contribution
  const m1 = bonus + muT; // mean of unreflected component
  const m2 = -bonus + muT; // mean of reflected component
  // α used for Φ(m/σ√T) — note Φ(−α) form aligns with truncated mean convention.
  const a1 = m1 / sigmaT;
  const a2 = m2 / sigmaT;
  const intUnreflected = sigmaT * normalPdf(a1) + m1 * normalCdf(a1);
  const intReflected = sigmaT * normalPdf(a2) + m2 * normalCdf(a2);
  const reflectionWeight = Math.exp((-2 * bonus * drift) / variancePerUnit);
  const value = intUnreflected - reflectionWeight * intReflected;
  return Math.max(0, value);
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: FreeBetWrConfig): void {
  if (!Number.isFinite(cfg.bonusAmount) || cfg.bonusAmount <= 0) {
    throw new Error(`freeBetWageringRequirement: bonusAmount must be > 0, got ${cfg.bonusAmount}`);
  }
  if (!Number.isFinite(cfg.wagerMultiplier) || cfg.wagerMultiplier <= 0) {
    throw new Error(`freeBetWageringRequirement: wagerMultiplier must be > 0, got ${cfg.wagerMultiplier}`);
  }
  if (!Number.isFinite(cfg.betPerSpin) || cfg.betPerSpin <= 0) {
    throw new Error(`freeBetWageringRequirement: betPerSpin must be > 0, got ${cfg.betPerSpin}`);
  }
  if (cfg.betPerSpin > cfg.bonusAmount) {
    throw new Error(`freeBetWageringRequirement: betPerSpin (${cfg.betPerSpin}) > bonusAmount (${cfg.bonusAmount}) — player cannot start`);
  }
  if (!Number.isFinite(cfg.rtp) || cfg.rtp < 0 || cfg.rtp > 2) {
    throw new Error(`freeBetWageringRequirement: rtp must be in [0, 2], got ${cfg.rtp}`);
  }
  if (!Number.isFinite(cfg.volatilityIndex) || cfg.volatilityIndex <= 0) {
    throw new Error(`freeBetWageringRequirement: volatilityIndex must be > 0, got ${cfg.volatilityIndex}`);
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveFreeBetWageringRequirement(cfg: FreeBetWrConfig): FreeBetWrResult {
  validateConfig(cfg);

  const W = cfg.wagerMultiplier * cfg.bonusAmount;
  const N = Math.ceil(W / cfg.betPerSpin);

  // Mean change per spin (negative if RTP < 1)
  const driftPerSpin = cfg.betPerSpin * (cfg.rtp - 1);
  const variancePerSpin = (cfg.volatilityIndex * cfg.betPerSpin) ** 2;
  const sigmaPerSpin = Math.sqrt(variancePerSpin);

  const expectedBalance = cfg.bonusAmount + N * driftPerSpin;
  const varBalance = N * variancePerSpin;
  const stdDevBalance = Math.sqrt(varBalance);
  const expectedNetProfit = expectedBalance - cfg.bonusAmount;

  // Bust probability — Bachelier first-passage for Brownian motion with
  // drift μ and per-unit variance σ² over [0, N], starting at B (Borodin-
  // Salminen / Reflection Principle, exact for continuous BM):
  //
  //   P(min_{0≤t≤N} X(t) ≤ 0) = Φ((−B − μN)/(σ√N))
  //                            + exp(−2 B μ / σ²) · Φ((−B + μN)/(σ√N))
  //
  // Sign convention (verified by limits):
  //   - μ = 0 (zero drift): exp(0)=1, both terms = Φ(−B/(σ√N)) → 2·Φ(−B/σ√N)
  //     (known result for standard BM hitting 0 from B > 0).
  //   - μ < 0 (negative drift): exp(−2Bμ/σ²) = exp(positive) > 1, term1 ↑
  //     toward 1, term2 small → bust ↑ correctly.
  //   - μ > 0 (positive drift): exp(−2Bμ/σ²) = exp(negative) < 1, both
  //     terms shrink → bust ↓ correctly.
  let bustProb: number;
  const sqrtN = Math.sqrt(N);
  if (sigmaPerSpin < 1e-12 || sqrtN < 1e-12) {
    // Degenerate σ=0: deterministic bust iff final balance ≤ 0.
    bustProb = cfg.bonusAmount + N * driftPerSpin <= 0 ? 1 : 0;
  } else {
    // Universal Bachelier reflection formula (covers μ < 0, μ = 0, μ > 0).
    const sigmaN = sqrtN * sigmaPerSpin;
    const term1 = normalCdf((-cfg.bonusAmount - N * driftPerSpin) / sigmaN);
    const exponent = (-2 * cfg.bonusAmount * driftPerSpin) / variancePerSpin;
    const reflectionWeight = Math.exp(exponent);
    const term2 = normalCdf((-cfg.bonusAmount + N * driftPerSpin) / sigmaN);
    bustProb = term1 + reflectionWeight * term2;
  }
  bustProb = Math.max(0, Math.min(1, bustProb));
  const survivalProb = 1 - bustProb;

  // Expected withdrawable — exact closed-form using Bachelier joint density
  // (X_N, min) integrated over the surviving-positive path region:
  //   E[withdrawable] = ∫₀^∞ x · p(X_N=x, min≥0) dx
  // (See `expectedPositiveBalanceWithSurvival`.)
  // Materially tighter than the prior max(0, μ_X)·P(survive) bound — captures
  // the upward bias of surviving paths when μ_X < 0.
  const expectedWithdrawable =
    sigmaPerSpin > 0
      ? expectedPositiveBalanceWithSurvival(cfg.bonusAmount, driftPerSpin, variancePerSpin, N)
      : Math.max(0, expectedBalance) * survivalProb;
  // Keep truncated-normal helper exported via re-use of the name (lint guard).
  void truncatedNormalMeanPositive;
  const effectiveEV = expectedWithdrawable; // since locked bonus has 0 baseline value
  const playerLossRate = (cfg.bonusAmount - expectedWithdrawable) / cfg.bonusAmount;
  const trueBonusValueRatio = effectiveEV / cfg.bonusAmount;

  return {
    requiredWagering: W,
    requiredSpins: N,
    expectedBalanceAtCompletion: expectedBalance,
    expectedNetProfit,
    stdDevBalanceAtCompletion: stdDevBalance,
    bustProbability: bustProb,
    survivalProbability: survivalProb,
    expectedWithdrawable,
    effectiveEV,
    playerLossRate,
    trueBonusValueRatio,
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

export interface FreeBetWrMcResult {
  episodes: number;
  observedBustRate: number;
  observedMeanBalanceAtCompletion: number;
  observedMeanWithdrawable: number;
  observedStdDevBalanceAtCompletion: number;
}

/**
 * MC simulation — Gaussian per-spin increment with mean = bet·(R−1) and
 * std = volatilityIndex·bet. Bust if balance ≤ 0 before reaching W
 * wagering.
 */
export function simulateFreeBetWageringRequirement(
  cfg: FreeBetWrConfig,
  episodes: number,
  seed: number,
): FreeBetWrMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  const N = Math.ceil((cfg.wagerMultiplier * cfg.bonusAmount) / cfg.betPerSpin);
  const driftPerSpin = cfg.betPerSpin * (cfg.rtp - 1);
  const sigmaPerSpin = cfg.volatilityIndex * cfg.betPerSpin;

  let bustCount = 0;
  let sumBalanceCompletion = 0;
  let sumBalanceCompletionSq = 0;
  let sumWithdrawable = 0;
  let completedEpisodes = 0;

  for (let e = 0; e < episodes; e++) {
    let balance = cfg.bonusAmount;
    let busted = false;
    for (let s = 0; s < N; s++) {
      const delta = driftPerSpin + sigmaPerSpin * gaussianSample(rng);
      balance += delta;
      if (balance <= 0) {
        balance = 0;
        busted = true;
        break;
      }
    }
    if (busted) {
      bustCount++;
      // Withdrawable = 0 on bust
    } else {
      sumBalanceCompletion += balance;
      sumBalanceCompletionSq += balance * balance;
      sumWithdrawable += Math.max(0, balance);
      completedEpisodes++;
    }
  }

  const meanBalanceCompletion = completedEpisodes > 0 ? sumBalanceCompletion / completedEpisodes : 0;
  const meanBalanceCompletionSq = completedEpisodes > 0 ? sumBalanceCompletionSq / completedEpisodes : 0;
  const varBalanceCompletion = Math.max(0, meanBalanceCompletionSq - meanBalanceCompletion * meanBalanceCompletion);

  return {
    episodes,
    observedBustRate: bustCount / episodes,
    observedMeanBalanceAtCompletion: meanBalanceCompletion,
    observedMeanWithdrawable: sumWithdrawable / episodes, // unconditional mean (0 on bust)
    observedStdDevBalanceAtCompletion: Math.sqrt(varBalanceCompletion),
  };
}
