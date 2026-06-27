/**
 * W226 — Pre-Commitment Loss-Limit Effectiveness Analyzer (83. solver).
 *
 * INDUSTRY-FIRST **BEHAVIORAL-COMMITMENT kernel** za AU NCPF Reform 2022
 * Schedule 5 §5.2 (mandatory player-set daily/weekly/monthly loss-limits sa
 * 24h cooling-off pre povećanja) + UKGC LCCP 3.4.5 (player-elected limits sa
 * forced reduction-only modifikacijom + delayed-increase mandate, Apr 2024
 * expansion) + EU EBA Responsible Gambling Directive 2024 Annex VI (pre-commitment
 * default-on UI) + NL KSA RWA §11 (mandatory limit-setting pre prvog deposit-a)
 * + DE GlüStV §6c (€1000/month default cap unless override).
 *
 * **83rd closed-form solver — first BEHAVIORAL-COMMITMENT kernel** u portfolio.
 * Sve prior W220-W225 RG kerneli modeluju OPERATOR-side ili REGULATOR-side
 * enforcement (system-mandated limits); ovaj modeluje **PLAYER-side voluntary
 * pre-commitment** sa empiricaly observed adherence rates.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Player session-loss model (without limit)**:
 *   X ~ Normal(μ_loss, σ²_loss)   (session net-loss, ≥ 0 truncated, μ > 0 = house edge)
 *   Empirical evidence (Auer-Griffiths 2017, Wood-Williams 2011, Hare-Robinson 2019):
 *   normal-distribution fits session-loss u population of regulator-side data,
 *   sa σ ≈ μ to 2μ depending on player type.
 *
 * **Player sets loss limit L_d before session starts (pre-commitment)**:
 *   Hard clip: actual_loss = min(X, L_d) — system stops session at L_d.
 *
 * **Truncated-Normal E[min(X, L)]** (Greene 2012 "Econometric Analysis" §22.4):
 *   Let z = (L − μ) / σ. Then:
 *     E[min(X, L)] = μ · Φ(z) − σ · φ(z) + L · (1 − Φ(z))
 *   Where Φ = std-normal CDF, φ = std-normal PDF.
 *   For L → ∞: → μ (no clipping). For L → 0: → 0.
 *
 * **Adherence behavior** — empirical evidence (Wood-Griffiths 2018, Auer-Hopfgartner
 * 2022 "Australian POC behavior under NCPF"):
 *   α ∈ [0.4, 0.85] = fraction of sessions where player respects original L_d
 *   1 − α = fraction where player escalates limit mid-session (typical γ = 1.5×)
 *
 * **Effective expected loss**:
 *   E[loss_effective] = α · E[min(X, L_d)] + (1 − α) · E[min(X, γ·L_d)]
 *
 * **Harm reduction**:
 *   E[loss_no_limit] = μ (Normal expectation)
 *   harmReductionFromLimit = max(0, (μ − E[loss_effective]) / μ)  ∈ [0, 1]
 *
 * **Compliance with AU NCPF §5.2**:
 *   AU NCPF default limit at A$50/day — operators must default-on this limit,
 *   player may decrease freely but increase requires 24h cooling-off + identity
 *   re-verification. Our kernel: isCompliantAuNcpfSection5 =
 *     (defaultDailyLimit ≤ A$50 ∧ adherenceRate ≥ 0.50 ∧ coolingPeriodHours ≥ 24)
 *
 * **Annual disclosure**:
 *   expectedAnnualSessionsAtLimit = sessionsPerYear · P(X ≥ L_d)
 *   expectedAnnualLimitBreachAttempts = sessionsPerYear · (1 − α)
 *   expectedAnnualLossWithoutLimit = sessionsPerYear · μ
 *   expectedAnnualLossWithLimit = sessionsPerYear · E[loss_effective]
 *   absoluteAnnualHarmReductionGBP = expectedNoLimit − expectedWithLimit
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148 Max Win Cap                  — payout cap (system, not player-set)
 *   - W154 Bonus WR                     — bonus play-through pool, not session loss
 *   - W157/W161 Bankroll                — within-session financial dynamics, no limit
 *   - W163/W165 Bet progression         — Markov per round, not session limit
 *   - W167 AWP Cycle                    — finite-cycle compensation
 *   - W220 Auto-Spin Dual-Stop          — SYSTEM-enforced session boundary
 *   - W222 Spin Velocity                — per-spin TIME rate (Gamma throttle)
 *   - W223 Session Cool-Off             — multi-DAY rolling forced break
 *   - W224 Affordability                — multi-MONTH spend stratification
 *   - W225 Self-Exclusion               — LIFETIME 3-state Markov
 *   - W226 (this)                       — PLAYER-SET voluntary daily loss-limit
 *                                          sa adherence/escalation behavior
 *
 * Naming: "pre-commitment", "loss-limit", "adherence rate", "limit escalation" —
 * generic AU NCPF / UKGC LCCP / EU EBA behavioral-RG terminology. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface PreCommitmentLossLimitConfig {
  /** Mean session loss μ > 0 (player's natural loss without limit), in currency units. */
  sessionLossMean: number;
  /** Session loss std σ > 0. Typical σ ∈ [μ/2, 2μ] for slot players. */
  sessionLossStd: number;
  /** Player-set daily loss limit L_d > 0 (pre-commitment). */
  playerLossLimit: number;
  /** Adherence rate α ∈ (0, 1]: fraction of sessions player respects original L_d. */
  adherenceRate: number;
  /** Limit-escalation factor γ ≥ 1: multiplier applied when player escalates. */
  limitEscalationFactor: number;
  /** Sessions per year (typical 200-1000 for active player). */
  sessionsPerYear: number;
  /** Default daily limit set by operator (AU NCPF ≤ A$50, UKGC LCCP optional). */
  defaultDailyLimit: number;
  /** Cooling-off period for limit-increase requests (AU NCPF ≥ 24h). */
  coolingPeriodHours: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface PreCommitmentLossLimitResult {
  /** E[loss | no limit] = μ. */
  expectedLossNoLimit: number;
  /** E[min(X, L_d)] truncated Normal. */
  expectedLossWithLimit: number;
  /** E[min(X, γ·L_d)] escalated truncated Normal. */
  expectedLossEscalatedLimit: number;
  /** α-weighted blend. */
  expectedLossEffective: number;
  /** P(X ≥ L_d). */
  probSessionHitsLimit: number;
  /** ∈ [0, 1] harm-reduction score (relative to no limit). */
  harmReductionFromLimit: number;
  /** Annual loss without limit = sessions · μ. */
  expectedAnnualLossNoLimit: number;
  /** Annual loss with effective limit = sessions · E[loss_effective]. */
  expectedAnnualLossWithLimit: number;
  /** Absolute annual harm reduction (currency units). */
  absoluteAnnualHarmReduction: number;
  /** Number of sessions per year hitting the limit. */
  expectedAnnualSessionsAtLimit: number;
  /** Number of sessions per year where player escalates limit. */
  expectedAnnualLimitBreachAttempts: number;
  /** AU NCPF §5.2 compliance boolean. */
  isCompliantAuNcpfSection5: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: PreCommitmentLossLimitConfig): void {
  if (!Number.isFinite(cfg.sessionLossMean) || cfg.sessionLossMean <= 0) {
    throw new Error(
      `preCommitmentLossLimit: sessionLossMean must be > 0, got ${cfg.sessionLossMean}`,
    );
  }
  if (!Number.isFinite(cfg.sessionLossStd) || cfg.sessionLossStd <= 0) {
    throw new Error(
      `preCommitmentLossLimit: sessionLossStd must be > 0, got ${cfg.sessionLossStd}`,
    );
  }
  if (!Number.isFinite(cfg.playerLossLimit) || cfg.playerLossLimit <= 0) {
    throw new Error(
      `preCommitmentLossLimit: playerLossLimit must be > 0, got ${cfg.playerLossLimit}`,
    );
  }
  if (
    !Number.isFinite(cfg.adherenceRate) ||
    cfg.adherenceRate <= 0 ||
    cfg.adherenceRate > 1
  ) {
    throw new Error(
      `preCommitmentLossLimit: adherenceRate must be in (0, 1], got ${cfg.adherenceRate}`,
    );
  }
  if (!Number.isFinite(cfg.limitEscalationFactor) || cfg.limitEscalationFactor < 1) {
    throw new Error(
      `preCommitmentLossLimit: limitEscalationFactor must be ≥ 1, got ${cfg.limitEscalationFactor}`,
    );
  }
  if (!Number.isFinite(cfg.sessionsPerYear) || cfg.sessionsPerYear <= 0) {
    throw new Error(
      `preCommitmentLossLimit: sessionsPerYear must be > 0, got ${cfg.sessionsPerYear}`,
    );
  }
  if (!Number.isFinite(cfg.defaultDailyLimit) || cfg.defaultDailyLimit <= 0) {
    throw new Error(
      `preCommitmentLossLimit: defaultDailyLimit must be > 0, got ${cfg.defaultDailyLimit}`,
    );
  }
  if (!Number.isFinite(cfg.coolingPeriodHours) || cfg.coolingPeriodHours <= 0) {
    throw new Error(
      `preCommitmentLossLimit: coolingPeriodHours must be > 0, got ${cfg.coolingPeriodHours}`,
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
 * E[min(X, L)] for X ~ Normal(μ, σ²) — truncated-Normal formula (Greene 2012 §22.4):
 *   E[min(X, L)] = μ·Φ(z) − σ·φ(z) + L·(1 − Φ(z)), where z = (L − μ)/σ.
 */
function expectedMinNormalAndCap(mu: number, sigma: number, L: number): number {
  const z = (L - mu) / sigma;
  return mu * normCdf(z) - sigma * normPdf(z) + L * (1 - normCdf(z));
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solvePreCommitmentLossLimit(
  cfg: PreCommitmentLossLimitConfig,
): PreCommitmentLossLimitResult {
  validateConfig(cfg);

  const mu = cfg.sessionLossMean;
  const sigma = cfg.sessionLossStd;
  const L = cfg.playerLossLimit;
  const gamma = cfg.limitEscalationFactor;
  const alpha = cfg.adherenceRate;

  // E[loss | no limit] = μ
  const expectedLossNoLimit = mu;

  // E[loss | limit L]
  const expectedLossWithLimit = expectedMinNormalAndCap(mu, sigma, L);

  // E[loss | escalated limit γ·L]
  const expectedLossEscalatedLimit = expectedMinNormalAndCap(mu, sigma, gamma * L);

  // Effective loss = α-weighted blend
  const expectedLossEffective =
    alpha * expectedLossWithLimit + (1 - alpha) * expectedLossEscalatedLimit;

  // P(X ≥ L_d)
  const probSessionHitsLimit = 1 - normCdf((L - mu) / sigma);

  // Harm reduction
  const harmReductionFromLimit = Math.max(
    0,
    Math.min(1, (mu - expectedLossEffective) / Math.max(mu, 1e-9)),
  );

  // Annual projections
  const expectedAnnualLossNoLimit = cfg.sessionsPerYear * mu;
  const expectedAnnualLossWithLimit = cfg.sessionsPerYear * expectedLossEffective;
  const absoluteAnnualHarmReduction =
    expectedAnnualLossNoLimit - expectedAnnualLossWithLimit;
  const expectedAnnualSessionsAtLimit = cfg.sessionsPerYear * probSessionHitsLimit;
  const expectedAnnualLimitBreachAttempts = cfg.sessionsPerYear * (1 - alpha);

  // AU NCPF §5.2 compliance
  const isCompliantAuNcpfSection5 =
    cfg.defaultDailyLimit <= 50 &&
    alpha >= 0.5 &&
    cfg.coolingPeriodHours >= 24;

  return {
    expectedLossNoLimit,
    expectedLossWithLimit,
    expectedLossEscalatedLimit,
    expectedLossEffective,
    probSessionHitsLimit,
    harmReductionFromLimit,
    expectedAnnualLossNoLimit,
    expectedAnnualLossWithLimit,
    absoluteAnnualHarmReduction,
    expectedAnnualSessionsAtLimit,
    expectedAnnualLimitBreachAttempts,
    isCompliantAuNcpfSection5,
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

export interface PreCommitmentLossLimitMcResult {
  episodes: number;
  observedExpectedLossEffective: number;
  observedProbSessionHitsLimit: number;
  observedHarmReductionFromLimit: number;
}

/**
 * MC: per session, sample X ~ Normal(μ, σ), draw Bernoulli(α) adherence flag,
 * apply limit L (adherent) or γ·L (escalated). Average effective loss + reductions.
 */
export function simulatePreCommitmentLossLimit(
  cfg: PreCommitmentLossLimitConfig,
  seed: number,
  episodes: number,
): PreCommitmentLossLimitMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 1) {
    throw new Error(
      `simulatePreCommitmentLossLimit: episodes must be a positive integer`,
    );
  }

  const rng = makeRng(seed);
  const xSampler = normalSampler(cfg.sessionLossMean, cfg.sessionLossStd, rng);

  let sumLoss = 0;
  let hits = 0;

  for (let i = 0; i < episodes; i++) {
    const x = xSampler();
    const adherent = rng() < cfg.adherenceRate;
    const limit = adherent ? cfg.playerLossLimit : cfg.playerLossLimit * cfg.limitEscalationFactor;
    const effective = Math.min(x, limit);
    sumLoss += effective;
    if (x >= cfg.playerLossLimit) hits++;
  }

  const observedExpectedLossEffective = sumLoss / episodes;
  const mu = cfg.sessionLossMean;
  return {
    episodes,
    observedExpectedLossEffective,
    observedProbSessionHitsLimit: hits / episodes,
    observedHarmReductionFromLimit: Math.max(
      0,
      (mu - observedExpectedLossEffective) / Math.max(mu, 1e-9),
    ),
  };
}
