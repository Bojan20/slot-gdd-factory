/**
 * W152 Wave 110 — Bonus Trigger Wait Time Analyzer (Faza 4.6 ext, post-W100).
 *
 * Closed-form solver za "vreme do trigera bonus feature" — UKGC RTS 14
 * compliance disclosure mehanika. Per spin, K features sa per-feature
 * trigger probability p_i; closed-form computes wait time distribuciju,
 * median/percentile, P(any feature within k spins).
 *
 * Naming policy (clean-room): "bonus trigger", "wait time" = generic
 * industry terms. No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * K features, each with per-spin trigger probability p_i (independent
 * Bernoulli across spins, independent across features).
 *
 * Per-feature wait time T_i ~ shifted-Geometric(p_i), k ≥ 1:
 *   P(T_i = k)   = (1 - p_i)^(k-1) · p_i
 *   E[T_i]       = 1 / p_i
 *   Var[T_i]     = (1 - p_i) / p_i²
 *   P(T_i > k)   = (1 - p_i)^k    (survival function)
 *   P(T_i ≤ k)   = 1 - (1 - p_i)^k   (CDF)
 *   Median       = ⌈ log(0.5) / log(1 - p_i) ⌉
 *
 * Any-feature wait time T_any = min(T_1, ..., T_K):
 *   P(T_any > k)  = Π (1 - p_i)^k = (1 - p_any)^k
 *   where p_any   = 1 - Π (1 - p_i)
 *   E[T_any]      = 1 / p_any
 *   Var[T_any]    = (1 - p_any) / p_any²
 *
 * Multi-feature rate per spin:
 *   E[features triggered per spin] = Σ p_i
 *   (each feature can trigger independently within same spin)
 *
 * Percentile q (0 < q < 1) wait time for feature i:
 *   k_q = ⌈ log(1 - q) / log(1 - p_i) ⌉
 *   Smallest k for which P(T_i ≤ k) ≥ q.
 *
 * Industry compliance disclosure:
 *   • UKGC RTS 14 — required: median + 95th percentile wait time per feature.
 *   • MGA PPD §11.f — operator-facing trigger frequency for player protection.
 *   • eCOGRA Generic Slots Audit — verifies disclosure matches engine math.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateBonusTriggerWaitTime() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface BonusFeatureConfig {
  /** Display label (e.g. 'free_spins', 'wheel_bonus', 'pick_bonus'). */
  label: string;
  /** Per-spin probability of triggering this feature (0 < p ≤ 1). */
  triggerProbabilityPerSpin: number;
}

export interface BonusTriggerWaitTimeConfig {
  /** Feature configurations (length ≥ 1). */
  features: BonusFeatureConfig[];
  /** Percentile targets to compute (default [0.5, 0.75, 0.95]). */
  percentileTargets?: number[];
}

export interface FeatureWaitTimeStats {
  label: string;
  triggerProbabilityPerSpin: number;
  expectedWaitTime: number;
  varianceWaitTime: number;
  stdWaitTime: number;
  medianWaitTime: number;
  /** Map of percentile (e.g. 0.95) → k_q wait time. */
  percentileWaitTimes: Record<string, number>;
}

export interface BonusTriggerWaitTimeResult {
  perFeature: FeatureWaitTimeStats[];
  // Any-feature combined wait time
  anyFeatureTriggerProbability: number;
  expectedAnyFeatureWaitTime: number;
  varianceAnyFeatureWaitTime: number;
  medianAnyFeatureWaitTime: number;
  // Aggregate rate
  expectedFeaturesTriggeredPerSpin: number;
  // Multi-feature simultaneous-trigger probability
  probMultipleFeaturesPerSpin: number;
}

export interface BonusTriggerWaitTimeMCResult {
  episodes: number;
  totalAnyFeatureWaitTime: number;
  observedMeanAnyFeatureWaitTime: number;
  observedVarianceAnyFeatureWaitTime: number;
  observedMaxObserved: number;
  observedPerFeatureMeanWaitTime: number[];
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: BonusTriggerWaitTimeConfig): void {
  if (!Array.isArray(cfg.features) || cfg.features.length === 0) {
    throw new Error(`features must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const f of cfg.features) {
    if (typeof f.label !== 'string' || f.label.length === 0) {
      throw new Error(`feature label must be non-empty`);
    }
    if (seen.has(f.label)) throw new Error(`duplicate feature label: ${f.label}`);
    seen.add(f.label);
    const p = f.triggerProbabilityPerSpin;
    if (!Number.isFinite(p) || p <= 0 || p > 1) {
      throw new Error(`feature ${f.label}: triggerProbabilityPerSpin must be in (0, 1]`);
    }
  }
  if (cfg.percentileTargets !== undefined) {
    for (const q of cfg.percentileTargets) {
      if (!Number.isFinite(q) || q <= 0 || q >= 1) {
        throw new Error(`percentile target must be in (0, 1) (got ${q})`);
      }
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

/** Median = smallest k such that P(T ≤ k) ≥ 0.5. */
function medianGeometric(p: number): number {
  if (p >= 1) return 1;
  // ⌈ log(0.5) / log(1-p) ⌉
  return Math.ceil(Math.log(0.5) / Math.log(1 - p));
}

/** k-th percentile of shifted-geometric: smallest k such that P(T ≤ k) ≥ q. */
function percentileGeometric(p: number, q: number): number {
  if (p >= 1) return 1;
  if (q <= 0) return 1;
  return Math.ceil(Math.log(1 - q) / Math.log(1 - p));
}

export function solveBonusTriggerWaitTime(
  config: BonusTriggerWaitTimeConfig,
): BonusTriggerWaitTimeResult {
  validate(config);
  const targets = config.percentileTargets ?? [0.5, 0.75, 0.95];

  const perFeature: FeatureWaitTimeStats[] = config.features.map((f) => {
    const p = f.triggerProbabilityPerSpin;
    const eT = 1 / p;
    const varT = (1 - p) / (p * p);
    const stdT = Math.sqrt(varT);
    const median = medianGeometric(p);
    const percentileMap: Record<string, number> = {};
    for (const q of targets) {
      percentileMap[String(q)] = percentileGeometric(p, q);
    }
    return {
      label: f.label,
      triggerProbabilityPerSpin: p,
      expectedWaitTime: eT,
      varianceWaitTime: varT,
      stdWaitTime: stdT,
      medianWaitTime: median,
      percentileWaitTimes: percentileMap,
    };
  });

  // Any-feature: p_any = 1 - Π (1 - p_i)
  let oneMinusP = 1;
  let sumP = 0;
  for (const f of config.features) {
    oneMinusP *= 1 - f.triggerProbabilityPerSpin;
    sumP += f.triggerProbabilityPerSpin;
  }
  const pAny = 1 - oneMinusP;
  const eAny = 1 / pAny;
  const varAny = (1 - pAny) / (pAny * pAny);
  const medianAny = medianGeometric(pAny);

  // P(multiple features per spin): 1 - P(0 trigger) - P(exactly 1 trigger)
  // P(exactly 1 trigger) = Σ p_i · Π_{j≠i} (1 - p_j)
  const p0 = oneMinusP; // P(no triggers this spin)
  let p1 = 0;
  for (let i = 0; i < config.features.length; i++) {
    let term = config.features[i].triggerProbabilityPerSpin;
    for (let j = 0; j < config.features.length; j++) {
      if (i !== j) term *= 1 - config.features[j].triggerProbabilityPerSpin;
    }
    p1 += term;
  }
  const probMulti = Math.max(0, 1 - p0 - p1);

  return {
    perFeature,
    anyFeatureTriggerProbability: pAny,
    expectedAnyFeatureWaitTime: eAny,
    varianceAnyFeatureWaitTime: varAny,
    medianAnyFeatureWaitTime: medianAny,
    expectedFeaturesTriggeredPerSpin: sumP,
    probMultipleFeaturesPerSpin: probMulti,
  };
}

// ── MC reference solver ────────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateBonusTriggerWaitTime(
  config: BonusTriggerWaitTimeConfig,
  episodes: number,
  seed: number,
): BonusTriggerWaitTimeMCResult {
  validate(config);
  const rng = makePrng(seed);
  const K = config.features.length;
  const perFeatureWaitSums: number[] = new Array<number>(K).fill(0);
  let totalAnyWait = 0;
  let totalAnyWaitSq = 0;
  let maxObserved = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let anyWait = 0;
    const perFeatureWait: number[] = new Array<number>(K).fill(-1);
    let foundAny = false;

    // Spin until ALL features have triggered (so we record per-feature wait
    // for any feature observed in this episode). For "any feature" wait
    // time, we record the FIRST trigger.
    let spinCount = 0;
    while (true) {
      spinCount++;
      let anyTriggered = false;
      for (let i = 0; i < K; i++) {
        if (perFeatureWait[i] < 0 && rng() < config.features[i].triggerProbabilityPerSpin) {
          perFeatureWait[i] = spinCount;
          anyTriggered = true;
          if (!foundAny) {
            anyWait = spinCount;
            foundAny = true;
          }
        }
      }
      // Stop when all features triggered OR safety cap
      let allDone = true;
      for (let i = 0; i < K; i++) {
        if (perFeatureWait[i] < 0) {
          allDone = false;
          break;
        }
      }
      if (allDone) break;
      // Safety cap to avoid runaway with very small p
      if (spinCount > 1_000_000) break;
    }

    for (let i = 0; i < K; i++) {
      perFeatureWaitSums[i] += perFeatureWait[i];
    }
    totalAnyWait += anyWait;
    totalAnyWaitSq += anyWait * anyWait;
    if (anyWait > maxObserved) maxObserved = anyWait;
  }

  const meanAny = totalAnyWait / episodes;
  const varAny = Math.max(0, totalAnyWaitSq / episodes - meanAny * meanAny);

  return {
    episodes,
    totalAnyFeatureWaitTime: totalAnyWait,
    observedMeanAnyFeatureWaitTime: meanAny,
    observedVarianceAnyFeatureWaitTime: varAny,
    observedMaxObserved: maxObserved,
    observedPerFeatureMeanWaitTime: perFeatureWaitSums.map((s) => s / episodes),
  };
}
