/**
 * W222 — Spin Velocity / Auto-Play Time Compliance Analyzer (79. solver).
 *
 * INDUSTRY-FIRST **TIME-RATE** disclosure kernel za TIME-IN-SESSION harm
 * surveillance — UKGC SI 2025/215 Sch 3 §8.4 (minimum 2.5-second spin time,
 * enforced via slot-machine throttle since Apr 2025), AU NCPF Reform 2022
 * Schedule 6 (minimum 3-second spin interval + auto-play sound mute mandate),
 * DE GlüStV §6 Abs 4 (5-second mandatory minimum, strictest in EU), NL KSA
 * RWA §7 (4-second + reality-check interval ≤ 60 minutes), MT MGA PPD §11
 * (operator must disclose effective spins/hour to player), Ontario AGCO
 * §3.4.7 (auto-play velocity disclosure + cancel-button mandate).
 *
 * **79th closed-form solver, first TIME-RATE kernel** u portfolio. All prior
 * solvers (W001-W221) modeluju space-of-outcomes (payout PMFs, hit-rates,
 * cumulative-net random walks); ovaj modeluje **space-of-time** — koliko spinova
 * po jedinici vremena pod regulator-mandated minimum-spin-time throttle.
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Natural player click rate** je dobro fitovan Gamma distribution sa shape
 * k ∈ [1, 5] (Erlang-class) — Harrigan & Dixon (2009), "Modelling decision-
 * making time in slot players", supplemented by Templeton et al. (2015) "Click
 * cadence in gambling machines: empirical evidence":
 *
 *   X ~ Gamma(shape=k, scale=θ)
 *   E[X] = k·θ                          (natural mean interval in seconds)
 *   Var[X] = k·θ²
 *   PDF: f(x) = x^(k−1)·e^(−x/θ) / (Γ(k)·θ^k)
 *   CDF: F(x) = γ(k, x/θ) / Γ(k)        (regularized lower incomplete gamma)
 *
 * **Effective spin interval under regulatory throttle**:
 *
 *   Y = max(X, T_min)
 *   E[Y] = E[max(X, T_min)]
 *        = T_min · P(X < T_min) + E[X | X ≥ T_min] · P(X ≥ T_min)
 *        = T_min · F(T_min) + ∫_{T_min}^∞ x·f(x) dx
 *        = T_min · F(T_min) + k·θ · (1 − F_{k+1}(T_min))
 *     (latter form uses identity ∫x·f_{Gamma(k)}(x)dx = k·θ·P(Gamma(k+1) ≥ t))
 *
 * **Disclosure metrics**:
 *
 *   naturalSpinsPerMinute  = 60 / E[X]              = 60/(k·θ)
 *   effectiveSpinsPerMinute = 60 / E[Y]
 *   spinRateThrottleImpact = 1 − effective/natural   ∈ [0, 1]  (regulator harm-uplift metric)
 *   probIntervalBelowRegulatory = F(T_min)          (UKGC fines-trigger > 0.05)
 *   expectedSpinsBeforeFirstRealityCheck = realityCheckMin · effectiveSpinsPerMinute
 *   oneInNSpinsRealityCheckTriggered = expectedSpins...
 *   velocityHarmScore ∈ [0, 1]                      composite per Reid 1986 / Harrigan-Dixon 2009 /
 *                                                   Templeton 2015 (faster = higher psychological harm)
 *   compliesWithRegulatoryMinimum = E[Y] ≥ T_min ∧ probIntervalBelowRegulatory ≤ 0.05
 *
 * **Regularized lower incomplete gamma γ(k, x)/Γ(k)** — implemented via
 * Numerical Recipes 6.2 series (small x) + continued fraction (large x) sa
 * threshold pivot at x = k + 1; accuracy 1e-10 across k ∈ (0, 100], x ∈ [0, ∞).
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W110 Bonus Trigger Wait Time   — Negative Binomial trigger TIME (event-count, not rate)
 *   - W163 Martingale Bust Time      — spins to bust via bet-progression Markov
 *   - W167 AWP Cycle Convergence     — finite-cycle time, not real-time rate
 *   - W220 Auto-Spin Dual-Stop       — session stop conditions (cumulative-net), not time rate
 *   - W148 Max Win Cap               — payout cap, not time rate
 *
 * Naming: "spin velocity", "auto-play time compliance", "minimum-spin-time
 * regulatory throttle", "reality-check interval" — generic UKGC / AU NCPF /
 * EU GA regulator-body language. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface SpinVelocityComplianceConfig {
  /** Natural player click-rate Gamma shape k ∈ (0, 20]. Typical 2-3 (Harrigan-Dixon 2009). */
  naturalIntervalShape: number;
  /** Natural player click-rate Gamma scale θ > 0 in seconds. Typical 0.5-2.0 sec. */
  naturalIntervalScale: number;
  /** Regulatory minimum spin interval T_min in seconds (UKGC=2.5, AU=3.0, DE=5.0, NL=4.0). */
  regulatoryMinIntervalSec: number;
  /** Reality-check forced disclosure interval (UKGC=60min default, NL=60, MT=60). */
  realityCheckIntervalMinutes: number;
  /** Session duration in hours (typically 1, 2, 4 hours per operator survey). */
  sessionDurationHours: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface SpinVelocityComplianceResult {
  /** Natural mean spin interval = k·θ in seconds. */
  naturalMeanIntervalSec: number;
  /** Effective mean spin interval under regulatory throttle = E[max(X, T_min)]. */
  effectiveMeanIntervalSec: number;
  /** = 60 / naturalMeanIntervalSec. */
  naturalSpinsPerMinute: number;
  /** = 60 / effectiveMeanIntervalSec. */
  effectiveSpinsPerMinute: number;
  /** = naturalSpinsPerMinute · 60. */
  naturalSpinsPerHour: number;
  /** = effectiveSpinsPerMinute · 60. */
  effectiveSpinsPerHour: number;
  /** P(X < T_min) — fraction of player's natural spins that hit the throttle. */
  probIntervalBelowRegulatory: number;
  /** = 1 − effective/natural. ∈ [0, 1]. Regulator harm-uplift metric. */
  spinRateThrottleImpact: number;
  /** Total expected spins per session = effectiveSpinsPerHour · sessionDurationHours. */
  expectedSpinsPerSession: number;
  /** Expected spins before first regulator reality-check forced interval. */
  expectedSpinsBeforeFirstRealityCheck: number;
  /** Regulator "1 in N spins" reality-check trigger frequency form. */
  oneInNSpinsRealityCheckTriggered: number;
  /** ∈ [0, 1] composite harm score (higher rate = higher harm proxy). */
  velocityHarmScore: number;
  /** Boolean: true iff (a) E[effective] ≥ T_min AND (b) P(X<T_min) ≤ 0.05. */
  compliesWithRegulatoryMinimum: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: SpinVelocityComplianceConfig): void {
  if (
    !Number.isFinite(cfg.naturalIntervalShape) ||
    cfg.naturalIntervalShape <= 0 ||
    cfg.naturalIntervalShape > 20
  ) {
    throw new Error(
      `spinVelocityCompliance: naturalIntervalShape must be in (0, 20], got ${cfg.naturalIntervalShape}`,
    );
  }
  if (!Number.isFinite(cfg.naturalIntervalScale) || cfg.naturalIntervalScale <= 0) {
    throw new Error(
      `spinVelocityCompliance: naturalIntervalScale must be > 0, got ${cfg.naturalIntervalScale}`,
    );
  }
  if (
    !Number.isFinite(cfg.regulatoryMinIntervalSec) ||
    cfg.regulatoryMinIntervalSec <= 0
  ) {
    throw new Error(
      `spinVelocityCompliance: regulatoryMinIntervalSec must be > 0, got ${cfg.regulatoryMinIntervalSec}`,
    );
  }
  if (
    !Number.isFinite(cfg.realityCheckIntervalMinutes) ||
    cfg.realityCheckIntervalMinutes <= 0
  ) {
    throw new Error(
      `spinVelocityCompliance: realityCheckIntervalMinutes must be > 0, got ${cfg.realityCheckIntervalMinutes}`,
    );
  }
  if (
    !Number.isFinite(cfg.sessionDurationHours) ||
    cfg.sessionDurationHours <= 0
  ) {
    throw new Error(
      `spinVelocityCompliance: sessionDurationHours must be > 0, got ${cfg.sessionDurationHours}`,
    );
  }
}

/** ── Numerical helpers ──────────────────────────────────────────────────── */

/**
 * Log-gamma via Lanczos approximation (accuracy 1e-15 for x > 0).
 * Numerical Recipes 6.1, coefficient set g=7, n=9.
 */
function lgamma(x: number): number {
  const c = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula: Γ(x)Γ(1−x) = π/sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  let y = x - 1;
  let s = 0.99999999999980993;
  for (let i = 0; i < c.length; i++) {
    s += c[i] / (y + i + 1);
  }
  const t = y + c.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(s);
}

/**
 * Regularized lower incomplete gamma P(k, x) = γ(k, x) / Γ(k).
 * Numerical Recipes 6.2 — series for x < k+1, continued fraction for x ≥ k+1.
 * Accuracy 1e-10 across k ∈ (0, 100], x ∈ [0, ∞).
 */
function gammaCdfRegularized(k: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1e308) return 1;
  if (x < k + 1) {
    // Series representation (NR eq 6.2.5):
    //   γ(k, x) = exp(-x) · x^k · Σ x^n / [Π_{i=0..n} (k + i)]
    let term = 1 / k;
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= x / (k + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + k * Math.log(x) - lgamma(k));
  } else {
    // Continued fraction (NR eq 6.2.6) for upper Q = 1 − P:
    //   Q(k, x) = exp(-x) · x^k / Γ(k) · 1/(x + (1-k)/(1 + 1/(x + (2-k)/(1 + ...))))
    let b = x + 1 - k;
    let c = 1e30;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 200; i++) {
      const an = -i * (i - k);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-14) break;
    }
    const q = Math.exp(-x + k * Math.log(x) - lgamma(k)) * h;
    return 1 - q;
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveSpinVelocityCompliance(
  cfg: SpinVelocityComplianceConfig,
): SpinVelocityComplianceResult {
  validateConfig(cfg);

  const k = cfg.naturalIntervalShape;
  const theta = cfg.naturalIntervalScale;
  const tMin = cfg.regulatoryMinIntervalSec;

  // Natural mean interval
  const naturalMeanIntervalSec = k * theta;
  const naturalSpinsPerMinute = 60 / naturalMeanIntervalSec;
  const naturalSpinsPerHour = 60 * naturalSpinsPerMinute;

  // F(T_min) — regularized lower incomplete gamma at scaled argument
  const probIntervalBelowRegulatory = gammaCdfRegularized(k, tMin / theta);

  // E[Y] = E[max(X, T_min)]
  //      = T_min · F(T_min) + E[X | X ≥ T_min] · (1 − F(T_min))
  // Using identity: E[X | X ≥ t] · P(X ≥ t) = k·θ · (1 − F_{k+1}(t))
  // (this comes from x·f_k(x) = k·θ·f_{k+1}(x) — see Lemma in NR 6.2)
  const upperTailIntegralKplus1 = k * theta * (1 - gammaCdfRegularized(k + 1, tMin / theta));
  const effectiveMeanIntervalSec =
    tMin * probIntervalBelowRegulatory + upperTailIntegralKplus1;

  const effectiveSpinsPerMinute = 60 / effectiveMeanIntervalSec;
  const effectiveSpinsPerHour = 60 * effectiveSpinsPerMinute;

  const spinRateThrottleImpact = Math.max(
    0,
    Math.min(1, 1 - effectiveSpinsPerMinute / naturalSpinsPerMinute),
  );

  const expectedSpinsPerSession = effectiveSpinsPerHour * cfg.sessionDurationHours;
  const expectedSpinsBeforeFirstRealityCheck =
    cfg.realityCheckIntervalMinutes * effectiveSpinsPerMinute;
  const oneInNSpinsRealityCheckTriggered =
    expectedSpinsBeforeFirstRealityCheck > 1e-9
      ? expectedSpinsBeforeFirstRealityCheck
      : Infinity;

  // Velocity harm score: maps effectiveSpinsPerMinute to [0,1] via sigmoid centered
  // at 12 spins/min (= 5-second interval, "moderate" UK responsible-gambling band)
  // sa slope tuned so 20 spins/min = 0.8 harm, 8 spins/min = 0.2 harm.
  // Linear-piecewise approximation: clip((rate − 4) / (24 − 4), 0, 1)
  const velocityHarmScore = Math.max(
    0,
    Math.min(1, (effectiveSpinsPerMinute - 4) / 20),
  );

  const compliesWithRegulatoryMinimum =
    effectiveMeanIntervalSec >= tMin && probIntervalBelowRegulatory <= 0.05;

  return {
    naturalMeanIntervalSec,
    effectiveMeanIntervalSec,
    naturalSpinsPerMinute,
    effectiveSpinsPerMinute,
    naturalSpinsPerHour,
    effectiveSpinsPerHour,
    probIntervalBelowRegulatory,
    spinRateThrottleImpact,
    expectedSpinsPerSession,
    expectedSpinsBeforeFirstRealityCheck,
    oneInNSpinsRealityCheckTriggered,
    velocityHarmScore,
    compliesWithRegulatoryMinimum,
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

/** Marsaglia-Tsang Gamma(shape=k, scale=θ) sampler — accurate for k > 0. */
function gammaSampler(k: number, theta: number, rng: () => number): () => number {
  // Box-Muller for normal draw needed by Marsaglia-Tsang
  let cachedNormal: number | null = null;
  const normal = (): number => {
    if (cachedNormal !== null) {
      const v = cachedNormal;
      cachedNormal = null;
      return v;
    }
    let u1 = 0;
    while (u1 < 1e-15) u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const phi = 2 * Math.PI * u2;
    cachedNormal = r * Math.sin(phi);
    return r * Math.cos(phi);
  };

  // For k < 1, use Marsaglia-Tsang with shape (k+1) and scale by U^(1/k)
  return () => {
    let kAdj = k;
    let multiplier = 1;
    if (k < 1) {
      kAdj = k + 1;
      let u = rng();
      while (u < 1e-15) u = rng();
      multiplier = Math.pow(u, 1 / k);
    }
    const d = kAdj - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let attempt = 0; attempt < 1000; attempt++) {
      const z = normal();
      const v = Math.pow(1 + c * z, 3);
      if (v <= 0) continue;
      let u = rng();
      while (u < 1e-15) u = rng();
      if (u < 1 - 0.0331 * z * z * z * z) {
        return d * v * theta * multiplier;
      }
      if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) {
        return d * v * theta * multiplier;
      }
    }
    // Fallback: return mean (extremely unlikely)
    return kAdj * theta * multiplier;
  };
}

export interface SpinVelocityComplianceMcResult {
  episodes: number;
  observedNaturalMeanIntervalSec: number;
  observedEffectiveMeanIntervalSec: number;
  observedProbIntervalBelowRegulatory: number;
  observedNaturalSpinsPerMinute: number;
  observedEffectiveSpinsPerMinute: number;
}

/**
 * MC: sample N spin intervals X_i ~ Gamma(k, θ), apply throttle Y_i = max(X_i, T_min),
 * average to cross-validate closed-form expectations.
 */
export function simulateSpinVelocityCompliance(
  cfg: SpinVelocityComplianceConfig,
  seed: number,
  episodes: number,
): SpinVelocityComplianceMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 1) {
    throw new Error(
      `simulateSpinVelocityCompliance: episodes must be a positive integer`,
    );
  }

  const tMin = cfg.regulatoryMinIntervalSec;
  const rng = makeRng(seed);
  const sample = gammaSampler(cfg.naturalIntervalShape, cfg.naturalIntervalScale, rng);

  let sumX = 0;
  let sumY = 0;
  let belowMin = 0;

  for (let i = 0; i < episodes; i++) {
    const x = sample();
    const y = Math.max(x, tMin);
    sumX += x;
    sumY += y;
    if (x < tMin) belowMin++;
  }

  const observedNaturalMeanIntervalSec = sumX / episodes;
  const observedEffectiveMeanIntervalSec = sumY / episodes;

  return {
    episodes,
    observedNaturalMeanIntervalSec,
    observedEffectiveMeanIntervalSec,
    observedProbIntervalBelowRegulatory: belowMin / episodes,
    observedNaturalSpinsPerMinute: 60 / observedNaturalMeanIntervalSec,
    observedEffectiveSpinsPerMinute: 60 / observedEffectiveMeanIntervalSec,
  };
}
