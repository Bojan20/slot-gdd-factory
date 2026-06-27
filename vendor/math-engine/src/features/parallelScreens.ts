/**
 * W152 Wave 58 — Parallel Screens aggregate distribution (Faza 12 ⚠️→✅).
 *
 * Closes Faza 12 scenario "⚠️ Parallel screens (N independent screens spun
 * together)" by adding a clean-room closed-form solver for the N-screen
 * aggregate-payout family — single bet drives N parallel game screens, each
 * with its own (or shared) outcome distribution, total payout = Σ screen_i.
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Multi-screen slot variants (also "split screen", "multi-window") have
 * been an established casino math pattern for 20+ years. Modern variants:
 *   • Independent screens with same paytable but separate reel strips
 *   • Correlated screens sharing a "common" symbol that auto-fills all
 *   • Asymmetric screens (e.g. one BIG screen + two smaller side screens)
 *
 * Math: aggregate distribution = convolution of per-screen PMFs (for
 * independent) or weighted sum (for correlated).
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Parallel screens" + "aggregate distribution" = generic terms.
 *   • No vendor-specific implementation marks.
 *   • Verified by `check-reserved-terms.sh`.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N screens; each screen i has discrete payout distribution P(Y_i = v).
 * Per spin, each screen draws independently (independent mode) or all
 * screens share a single draw (correlated mode, `pSharedOutcome`).
 *
 *   Independent: Y = Σ Y_i where Y_i ⊥ Y_j
 *     E[Y] = Σ E[Y_i]
 *     Var[Y] = Σ Var[Y_i]
 *     PMF[Y] = convolution of PMF[Y_i]
 *
 *   Correlated (mixture):
 *     With prob p_shared, all screens get the SAME value V (drawn once
 *     from the shared distribution).
 *     With prob 1 − p_shared, screens are independent.
 *
 *     E[Y_shared] = N × E[V]                  (if shared event)
 *     E[Y_indep]  = Σ E[Y_i]                  (if independent event)
 *     E[Y] = p_shared × N × E[V] + (1 − p_shared) × Σ E[Y_i]
 *
 *     Var[Y] requires care:
 *       E[Y²|shared] = N² × E[V²]
 *       E[Y²|indep]  = Σ Var[Y_i] + (Σ E[Y_i])²
 *       E[Y²] = p_shared × E[Y²|shared] + (1−p_shared) × E[Y²|indep]
 *       Var[Y] = E[Y²] − E[Y]²
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * Closed-form moments are O(N × |distMax|).
 * Full PMF (independent case) via convolution: O(N × M²) where
 * M = max value sum bound. For typical N ≤ 8 and discrete payouts
 * with ≤ 20 outcomes, M ≈ 200 → 8 × 40000 = 320K ops per PMF.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateParallelScreens() MC reference. Acceptance script validates
 * 6 configs (independent vs correlated, homogeneous vs heterogeneous)
 * against closed-form within ±2% relative on E[Y] and ±10% on Var[Y].
 *
 * ── References ────────────────────────────────────────────────────────────
 * Cabot & Hannum 2002 (Practical Casino Math): ch. 7 multi-screen math.
 * Convolution of discrete distributions: standard probability reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface ScreenOutcome {
  valueX: number;
  weight: number;
}

export interface ParallelScreensConfig {
  /** Number of parallel screens N ≥ 2. */
  numScreens: number;
  /**
   * Per-screen payout distributions. If `shared` is true, only `screenDistributions[0]`
   * is used (applied to all screens identically). Else length must equal numScreens.
   */
  screenDistributions: ScreenOutcome[][];
  /** If true, all N screens share the same distribution (length=1 array). */
  shared?: boolean;
  /**
   * Correlation: with this probability, ALL screens get the same outcome
   * (drawn once from a single shared distribution = screenDistributions[0]).
   * 0 = independent (default).
   */
  pSharedOutcome?: number;
}

export interface ParallelScreensResult {
  expectedPayoutPerSpin: number;
  variancePayoutPerSpin: number;
  stdDevPayoutPerSpin: number;
  /** σ / μ ratio. */
  volatilityIndex: number;
  /** Per-screen E[Y_i]. */
  perScreenExpected: number[];
  /** Per-screen Var[Y_i]. */
  perScreenVariance: number[];
  /** P(Y = 0) — full miss. */
  probZeroPayout: number;
  hitRate: number;
  /** Aggregate PMF (independent mode only; null for correlated). */
  aggregatePmf: Array<{ valueX: number; probability: number }> | null;
  pSharedOutcome: number;
}

export interface ParallelScreensMCResult {
  observedSpins: number;
  observedMeanPayout: number;
  observedVariancePayout: number;
  observedStdDevPayout: number;
  observedHitRate: number;
  observedZeroPayoutFraction: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: ParallelScreensConfig): void {
  if (!Number.isInteger(cfg.numScreens) || cfg.numScreens < 2) {
    throw new Error(`numScreens must be integer ≥ 2, got ${cfg.numScreens}`);
  }
  if (!Array.isArray(cfg.screenDistributions) || cfg.screenDistributions.length === 0) {
    throw new Error(`screenDistributions must be non-empty array`);
  }
  const expectLen = cfg.shared ? 1 : cfg.numScreens;
  if (cfg.screenDistributions.length !== expectLen) {
    throw new Error(`screenDistributions length must equal ${expectLen} (shared=${!!cfg.shared}, N=${cfg.numScreens})`);
  }
  for (let i = 0; i < cfg.screenDistributions.length; i++) {
    const dist = cfg.screenDistributions[i];
    if (!Array.isArray(dist) || dist.length === 0) {
      throw new Error(`screenDistributions[${i}] must be non-empty array`);
    }
    for (const o of dist) {
      if (!Number.isFinite(o.valueX) || o.valueX < 0) {
        throw new Error(`screenDistributions[${i}]: valueX must be non-negative finite`);
      }
      if (!Number.isFinite(o.weight) || o.weight <= 0) {
        throw new Error(`screenDistributions[${i}]: weight must be positive finite`);
      }
    }
  }
  if (cfg.pSharedOutcome !== undefined) {
    if (!Number.isFinite(cfg.pSharedOutcome) || cfg.pSharedOutcome < 0 || cfg.pSharedOutcome > 1) {
      throw new Error(`pSharedOutcome must be in [0, 1], got ${cfg.pSharedOutcome}`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function distMean(dist: ScreenOutcome[]): number {
  let totalW = 0;
  let totalV = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalV += o.weight * o.valueX;
  }
  return totalV / totalW;
}

function distMeanSquared(dist: ScreenOutcome[]): number {
  let totalW = 0;
  let totalSq = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalSq += o.weight * o.valueX * o.valueX;
  }
  return totalSq / totalW;
}

function distVariance(dist: ScreenOutcome[]): number {
  const m = distMean(dist);
  return distMeanSquared(dist) - m * m;
}

function distProbZero(dist: ScreenOutcome[]): number {
  let totalW = 0;
  let zeroW = 0;
  for (const o of dist) {
    totalW += o.weight;
    if (o.valueX === 0) zeroW += o.weight;
  }
  return zeroW / totalW;
}

/** Convert dist (weights → probabilities). */
function distToPmf(dist: ScreenOutcome[]): Array<{ value: number; prob: number }> {
  let totalW = 0;
  for (const o of dist) totalW += o.weight;
  return dist.map((o) => ({ value: o.valueX, prob: o.weight / totalW }));
}

/** Discrete convolution of two PMFs. */
function convolve(
  a: Array<{ value: number; prob: number }>,
  b: Array<{ value: number; prob: number }>,
): Array<{ value: number; prob: number }> {
  const merged = new Map<number, number>();
  for (const aE of a) {
    for (const bE of b) {
      const v = aE.value + bE.value;
      merged.set(v, (merged.get(v) ?? 0) + aE.prob * bE.prob);
    }
  }
  return Array.from(merged.entries())
    .map(([value, prob]) => ({ value, prob }))
    .sort((x, y) => x.value - y.value);
}

// ── Closed-form solver ─────────────────────────────────────────────────────

export function solveParallelScreens(config: ParallelScreensConfig): ParallelScreensResult {
  validate(config);
  const N = config.numScreens;
  const pShared = config.pSharedOutcome ?? 0;
  const shared = config.shared ?? false;

  // Per-screen distributions
  const dists: ScreenOutcome[][] = shared
    ? new Array<ScreenOutcome[]>(N).fill(config.screenDistributions[0])
    : config.screenDistributions;

  const perE: number[] = [];
  const perVar: number[] = [];
  const perPZero: number[] = [];
  for (let i = 0; i < N; i++) {
    perE.push(distMean(dists[i]));
    perVar.push(distVariance(dists[i]));
    perPZero.push(distProbZero(dists[i]));
  }

  // Independent components
  const eIndep = perE.reduce((a, b) => a + b, 0);
  const varIndep = perVar.reduce((a, b) => a + b, 0);
  // E[Y²|indep] = Var[Y|indep] + E[Y|indep]²
  const eIndep2 = varIndep + eIndep * eIndep;

  // Shared-event components (use shared distribution = dists[0])
  const sharedDist = dists[0];
  const eV = distMean(sharedDist);
  const eV2 = distMeanSquared(sharedDist);
  const eShared = N * eV;
  const eShared2 = N * N * eV2; // E[(N·V)²] = N² E[V²]
  const pV0 = distProbZero(sharedDist);

  // Mixture
  const eY = pShared * eShared + (1 - pShared) * eIndep;
  const eY2 = pShared * eShared2 + (1 - pShared) * eIndep2;
  const varY = Math.max(0, eY2 - eY * eY);

  // P(Y = 0)
  // For independent: P(all zero) = Π P(Y_i = 0)
  // For correlated: P(Y = 0) = p_shared × P(V = 0) + (1 − p_shared) × Π P(Y_i = 0)
  const pY0Indep = perPZero.reduce((a, b) => a * b, 1);
  const pY0 = pShared * pV0 + (1 - pShared) * pY0Indep;

  // Aggregate PMF only for independent mode (no shared event)
  let aggregatePmf: Array<{ valueX: number; probability: number }> | null = null;
  if (pShared === 0) {
    let pmf = distToPmf(dists[0]);
    for (let i = 1; i < N; i++) {
      pmf = convolve(pmf, distToPmf(dists[i]));
    }
    aggregatePmf = pmf.map((e) => ({ valueX: e.value, probability: e.prob }));
  }

  return {
    expectedPayoutPerSpin: eY,
    variancePayoutPerSpin: varY,
    stdDevPayoutPerSpin: Math.sqrt(varY),
    volatilityIndex: eY > 0 ? Math.sqrt(varY) / eY : Infinity,
    perScreenExpected: perE,
    perScreenVariance: perVar,
    probZeroPayout: pY0,
    hitRate: 1 - pY0,
    aggregatePmf,
    pSharedOutcome: pShared,
  };
}

// ── Monte Carlo reference solver ───────────────────────────────────────────

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

function sample(dist: ScreenOutcome[], rng: () => number): number {
  let total = 0;
  for (const o of dist) total += o.weight;
  let r = rng() * total;
  for (const o of dist) {
    r -= o.weight;
    if (r < 0) return o.valueX;
  }
  return dist[dist.length - 1].valueX;
}

export function simulateParallelScreens(
  config: ParallelScreensConfig,
  spins: number,
  seed: number,
): ParallelScreensMCResult {
  validate(config);
  const rng = makePrng(seed);
  const N = config.numScreens;
  const pShared = config.pSharedOutcome ?? 0;
  const shared = config.shared ?? false;
  const dists: ScreenOutcome[][] = shared
    ? new Array<ScreenOutcome[]>(N).fill(config.screenDistributions[0])
    : config.screenDistributions;
  const sharedDist = dists[0];

  let sumY = 0;
  let sumY2 = 0;
  let hits = 0;
  let zeros = 0;
  for (let s = 0; s < spins; s++) {
    let y = 0;
    if (pShared > 0 && rng() < pShared) {
      const v = sample(sharedDist, rng);
      y = N * v;
    } else {
      for (let i = 0; i < N; i++) y += sample(dists[i], rng);
    }
    sumY += y;
    sumY2 += y * y;
    if (y > 0) hits++;
    else zeros++;
  }
  const meanY = sumY / spins;
  const varY = sumY2 / spins - meanY * meanY;
  return {
    observedSpins: spins,
    observedMeanPayout: meanY,
    observedVariancePayout: varY,
    observedStdDevPayout: Math.sqrt(Math.max(0, varY)),
    observedHitRate: hits / spins,
    observedZeroPayoutFraction: zeros / spins,
  };
}
