/**
 * W225 — Self-Exclusion (GAMSTOP) Lifecycle Markov Analyzer (82. solver).
 *
 * INDUSTRY-FIRST **LIFECYCLE MARKOV kernel** za UKGC RTS 7B mandatory GAMSTOP
 * integration (effective Mar 2020, expanded scope Apr 2024 — multi-operator
 * cross-licensing data-share) + MGA Player Protection Directives §23 (national
 * self-exclusion register) + EU EBA Responsible Gambling Directive 2024 Annex
 * V (cross-border CRUKS / ROFUS / GAMSTOP harmonization) + AU NCPF Schedule 9
 * (BetStop national exclusion register, mandatory 2025) + DE OASIS national
 * register (mandatory all licensed operators 2021+).
 *
 * **82nd closed-form solver — first LIFECYCLE MARKOV kernel** u portfolio. Sve
 * prior (W001-W224) modeluju jedan harm-signal aspekt (payouts/rates/sessions/
 * affordability/temporal); ovaj modeluje **kompletan player-lifecycle** kao
 * 3-state Markov chain sa ACTIVE/EXCLUDED/PERMANENT terminal states.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **3-state continuous-time Markov chain**:
 *
 *   State A (ACTIVE)    — player aktivno igra, eligible za sve checks
 *   State E (EXCLUDED)  — u SE periodu (≥6 months UKGC mandatory, ≤5 years)
 *   State P (PERMANENT) — apsorbing: 5y SE expired OR 3+ failed re-applications
 *
 *   Transition rates (per day):
 *     A → E: λ_se        — self-exclusion onset rate (from upstream W224 vuln)
 *     E → A: 1/D_se      — SE expiry rate (deterministic mean SE duration)
 *     A → P: λ_perm      — direct permanent (rare, after multiple SE cycles)
 *     E → P: λ_perm_e    — permanent during SE (extension to 5y cap)
 *
 *   Q-matrix (generator):
 *      [ −(λ_se+λ_perm)        λ_se         λ_perm   ]
 *      [    1/D_se          −(1/D_se+λ_perm_e)   λ_perm_e ]
 *      [        0                 0                0       ]
 *
 * **Stationary distribution** (before permanent absorption, conditional on
 * transient — relative occupancy):
 *
 *   π_e / π_a = λ_se / (1/D_se)   =   λ_se · D_se
 *   π_a = 1 / (1 + λ_se · D_se)   — fraction of time ACTIVE
 *   π_e = (λ_se · D_se) / (1 + λ_se · D_se)
 *
 * **Time-to-absorption (PERMANENT)** via fundamental matrix:
 *   For 2-state transient {A, E}, sub-generator Q_trans:
 *     E[T_perm | start A] = closed-form via (−Q_trans)^(-1) · 1 vector
 *
 *   Simplified: if λ_perm = λ_perm_e = λ_p (uniform permanent rate):
 *     E[T_perm] = 1 / λ_p  (memoryless absorption)
 *
 * **Annual disclosure metrics**:
 *   annualSelfExclusionEpisodes = π_a · 365 · λ_se
 *   fractionOfYearInExclusion = π_e
 *   expectedDaysActivePerYear = π_a · 365
 *   expectedTimeToFirstSE = 1 / λ_se   (when ACTIVE)
 *   expectedTimeToPermanent = 1 / λ_perm (Geometric absorption)
 *   harmReductionScoreFromSE = π_e (fraction of harm-time blocked)
 *
 * **UKGC RTS 7B compliance**:
 *   isCompliantUkgcRts7b = (D_se_min_days ≥ 180 [6 months] ∧
 *                           D_se_max_days ≤ 1825 [5 years] ∧
 *                           coolingPeriodHours ≥ 24)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148/W154/W157/W161 — single-event/within-session payout dynamics
 *   - W163/W165            — bet-progression Markov per ROUND (not per day)
 *   - W167                 — finite-cycle compensation (deterministic period)
 *   - W220                 — single-session 2-sided dual-stop boundary
 *   - W222                 — per-spin TIME rate (Gamma throttle)
 *   - W223                 — multi-day Poisson rolling K-of-D cool-off count
 *   - W224                 — multi-month Log-Normal spend stratification
 *   - W225 (this)          — LIFETIME 3-state Markov sa absorbing PERMANENT
 *
 * Naming: "self-exclusion", "lifecycle Markov", "GAMSTOP/CRUKS/ROFUS/BetStop/
 * OASIS register" — generic UKGC RTS / EU EBA / national-register terminology.
 * No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface SelfExclusionLifecycleConfig {
  /** Self-exclusion onset rate per day λ_se ∈ (0, 1). Typical 0.001-0.01. */
  selfExclusionOnsetRatePerDay: number;
  /** Mean SE duration in days D_se. UKGC: min 180 (6mo), max 1825 (5y). */
  meanSelfExclusionDurationDays: number;
  /** Permanent absorption rate per day λ_p (from ACTIVE state). Typical 1e-5 .. 1e-4. */
  permanentAbsorptionRatePerDay: number;
  /** Mandatory cooling-off period in hours after SE expiry (UKGC ≥ 24). */
  coolingPeriodHours: number;
  /** Minimum SE duration in days (UKGC RTS 7B = 180). */
  minSelfExclusionDurationDays: number;
  /** Maximum SE duration in days (UKGC RTS 7B = 1825). */
  maxSelfExclusionDurationDays: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface SelfExclusionLifecycleResult {
  /** Stationary occupancy fraction in ACTIVE state. */
  stationaryFractionActive: number;
  /** Stationary occupancy fraction in EXCLUDED state. */
  stationaryFractionExcluded: number;
  /** Expected days per year ACTIVE (= π_a · 365). */
  expectedDaysActivePerYear: number;
  /** Expected days per year in EXCLUSION (= π_e · 365). */
  expectedDaysExcludedPerYear: number;
  /** Annual rate of SE episodes (excluding permanent absorption). */
  annualSelfExclusionEpisodes: number;
  /** E[days until first SE | starting ACTIVE] = 1/λ_se (Exponential mean). */
  expectedDaysToFirstSE: number;
  /** E[days until PERMANENT | starting ACTIVE] = 1/λ_p (Geometric absorption). */
  expectedDaysToPermanent: number;
  /** E[years until PERMANENT]. */
  expectedYearsToPermanent: number;
  /** Regulator 1-in-N years SE-onset form. */
  oneInNDaysFirstSE: number;
  /** ∈ [0, 1] composite SE-harm-reduction score. */
  harmReductionScoreFromSE: number;
  /** UKGC RTS 7B compliance boolean. */
  isCompliantUkgcRts7b: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: SelfExclusionLifecycleConfig): void {
  if (
    !Number.isFinite(cfg.selfExclusionOnsetRatePerDay) ||
    cfg.selfExclusionOnsetRatePerDay <= 0 ||
    cfg.selfExclusionOnsetRatePerDay >= 1
  ) {
    throw new Error(
      `selfExclusion: selfExclusionOnsetRatePerDay must be in (0, 1), got ${cfg.selfExclusionOnsetRatePerDay}`,
    );
  }
  if (
    !Number.isFinite(cfg.meanSelfExclusionDurationDays) ||
    cfg.meanSelfExclusionDurationDays <= 0
  ) {
    throw new Error(
      `selfExclusion: meanSelfExclusionDurationDays must be > 0, got ${cfg.meanSelfExclusionDurationDays}`,
    );
  }
  if (
    !Number.isFinite(cfg.permanentAbsorptionRatePerDay) ||
    cfg.permanentAbsorptionRatePerDay <= 0 ||
    cfg.permanentAbsorptionRatePerDay >= 1
  ) {
    throw new Error(
      `selfExclusion: permanentAbsorptionRatePerDay must be in (0, 1), got ${cfg.permanentAbsorptionRatePerDay}`,
    );
  }
  if (!Number.isFinite(cfg.coolingPeriodHours) || cfg.coolingPeriodHours <= 0) {
    throw new Error(
      `selfExclusion: coolingPeriodHours must be > 0, got ${cfg.coolingPeriodHours}`,
    );
  }
  if (
    !Number.isFinite(cfg.minSelfExclusionDurationDays) ||
    cfg.minSelfExclusionDurationDays <= 0
  ) {
    throw new Error(
      `selfExclusion: minSelfExclusionDurationDays must be > 0, got ${cfg.minSelfExclusionDurationDays}`,
    );
  }
  if (
    !Number.isFinite(cfg.maxSelfExclusionDurationDays) ||
    cfg.maxSelfExclusionDurationDays <= cfg.minSelfExclusionDurationDays
  ) {
    throw new Error(
      `selfExclusion: maxSelfExclusionDurationDays must be > min, got ${cfg.maxSelfExclusionDurationDays}`,
    );
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveSelfExclusionLifecycle(
  cfg: SelfExclusionLifecycleConfig,
): SelfExclusionLifecycleResult {
  validateConfig(cfg);

  const lambdaSE = cfg.selfExclusionOnsetRatePerDay;
  const dSE = cfg.meanSelfExclusionDurationDays;
  const lambdaP = cfg.permanentAbsorptionRatePerDay;

  // ── Stationary distribution (transient sub-chain {A, E}) ──────────────────
  // Balance: π_a · λ_se = π_e · (1/D_se)  ⇒  π_e / π_a = λ_se · D_se
  // Normalize: π_a + π_e = 1 (ignoring permanent occupancy at long times)
  const ratio = lambdaSE * dSE;
  const stationaryFractionActive = 1 / (1 + ratio);
  const stationaryFractionExcluded = ratio / (1 + ratio);

  // ── Annual time decomposition ─────────────────────────────────────────────
  const expectedDaysActivePerYear = stationaryFractionActive * 365;
  const expectedDaysExcludedPerYear = stationaryFractionExcluded * 365;

  // ── Annual SE episode rate ─────────────────────────────────────────────────
  // π_a fraction of time ACTIVE, each day fires SE w.p. λ_se → annual rate.
  const annualSelfExclusionEpisodes = stationaryFractionActive * 365 * lambdaSE;

  // ── First-passage times ───────────────────────────────────────────────────
  const expectedDaysToFirstSE = 1 / lambdaSE;
  const expectedDaysToPermanent = 1 / lambdaP;
  const expectedYearsToPermanent = expectedDaysToPermanent / 365;
  const oneInNDaysFirstSE = expectedDaysToFirstSE; // = 1/λ_se by definition

  // ── Harm reduction score ──────────────────────────────────────────────────
  // = π_e (fraction of player-time where harm signal is blocked by SE).
  const harmReductionScoreFromSE = stationaryFractionExcluded;

  // ── UKGC RTS 7B compliance ────────────────────────────────────────────────
  const isCompliantUkgcRts7b =
    cfg.minSelfExclusionDurationDays >= 180 &&
    cfg.maxSelfExclusionDurationDays <= 1825 &&
    cfg.coolingPeriodHours >= 24;

  return {
    stationaryFractionActive,
    stationaryFractionExcluded,
    expectedDaysActivePerYear,
    expectedDaysExcludedPerYear,
    annualSelfExclusionEpisodes,
    expectedDaysToFirstSE,
    expectedDaysToPermanent,
    expectedYearsToPermanent,
    oneInNDaysFirstSE,
    harmReductionScoreFromSE,
    isCompliantUkgcRts7b,
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

export interface SelfExclusionLifecycleMcResult {
  episodes: number;
  observedFractionActive: number;
  observedFractionExcluded: number;
  observedAnnualSelfExclusionEpisodes: number;
  observedExpectedDaysToFirstSE: number;
}

/**
 * MC: per episode simulate up to `horizonDays` of player-lifecycle as
 * discrete-time Markov chain with daily transition probabilities derived
 * from continuous-time rates. Record state occupancy + first-passage stats.
 */
export function simulateSelfExclusionLifecycle(
  cfg: SelfExclusionLifecycleConfig,
  seed: number,
  episodes: number,
  horizonDays = 1825,  // 5 years default
): SelfExclusionLifecycleMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 1) {
    throw new Error(`simulateSelfExclusionLifecycle: episodes must be a positive integer`);
  }
  if (!Number.isInteger(horizonDays) || horizonDays < 1) {
    throw new Error(`simulateSelfExclusionLifecycle: horizonDays must be a positive integer`);
  }

  const rng = makeRng(seed);
  const lambdaSE = cfg.selfExclusionOnsetRatePerDay;
  const dSE = cfg.meanSelfExclusionDurationDays;
  const lambdaP = cfg.permanentAbsorptionRatePerDay;

  // Daily transition probabilities (continuous → discrete approximation, valid
  // when all rates are small):
  //   P(A→E per day) = 1 − exp(−λ_se)        (Poisson hitting in 1 day)
  //   P(E→A per day) = 1/D_se                 (deterministic mean expiry, exponential approx)
  //   P(*→P per day) = 1 − exp(−λ_p)
  const pAtoE = 1 - Math.exp(-lambdaSE);
  const pEtoA = Math.min(1, 1 / dSE);
  const pToP = 1 - Math.exp(-lambdaP);

  let sumActive = 0;
  let sumExcluded = 0;
  let transientDays = 0;  // total {A, E} days only — excludes P
  let sumSEEpisodes = 0;
  let totalActiveDays = 0; // for annual-rate normalization
  let sumFirstSEDay = 0;
  let firstSEObserved = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let state: 'A' | 'E' | 'P' = 'A';
    let firstSEDay = -1;
    let seEpisodes = 0;
    let activeDays = 0;

    for (let day = 0; day < horizonDays; day++) {
      if (state === 'A') {
        sumActive++;
        transientDays++;
        activeDays++;
        // Check permanent first
        if (rng() < pToP) {
          state = 'P';
          continue;
        }
        // Check SE onset
        if (rng() < pAtoE) {
          state = 'E';
          if (firstSEDay < 0) firstSEDay = day;
          seEpisodes++;
          continue;
        }
      } else if (state === 'E') {
        sumExcluded++;
        transientDays++;
        // Check permanent (e.g. SE extends to 5y cap)
        if (rng() < pToP) {
          state = 'P';
          continue;
        }
        // Check SE expiry
        if (rng() < pEtoA) {
          state = 'A';
          continue;
        }
      }
      // PERMANENT — absorbing, do not count
    }

    if (firstSEDay >= 0) {
      sumFirstSEDay += firstSEDay;
      firstSEObserved++;
    }
    sumSEEpisodes += seEpisodes;
    totalActiveDays += activeDays;
  }

  return {
    episodes,
    observedFractionActive: transientDays > 0 ? sumActive / transientDays : 0,
    observedFractionExcluded: transientDays > 0 ? sumExcluded / transientDays : 0,
    // Annual rate = SE episodes per wall-clock year (matches CF: π_a·365·λ_se;
    // dilutes by permanent absorption since CF assumes transient-stationary average)
    observedAnnualSelfExclusionEpisodes:
      (sumSEEpisodes * 365) / (episodes * horizonDays),
    // Only average over episodes that actually observed an SE event (right-censoring fix)
    observedExpectedDaysToFirstSE:
      firstSEObserved > 0 ? sumFirstSEDay / firstSEObserved : Infinity,
  };
}
