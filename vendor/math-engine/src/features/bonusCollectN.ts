/**
 * W152 Wave 118 — Bonus Collect-N Trigger Tracker (Faza 4.6 ext, post-W100 roadmap).
 *
 * Closed-form solver za "skupi N coina pa trigger bonus" mehaniku — Pragmatic
 * Money Cart / Money Train / Stake Logic Wild Swarm / Hacksaw Money Hunt /
 * Push Gaming Razor Shark collector counters. Per spin scatter / coin
 * lands sa independent prob p; bonus triggers kada cumulative count
 * reaches threshold N.
 *
 * Naming policy (clean-room): "collect", "trigger", "tracker" = generic
 * industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W110 Bonus Trigger Wait Time — single-shot Geometric trigger (N=1)
 *   • W101 Symbol Upgrade Chain — Binomial PMF over fixed window
 *   • W84 FS Retrigger Compound — multiplicative retrigger inside FS
 *   • W91 Coin Accumulator — value accumulation, no fixed trigger threshold
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin: collect event lands sa Bernoulli prob p (iid across spins).
 * Threshold N ≥ 1 → bonus triggers when cumulative count C_t reaches N.
 *
 * Wait time T_N = number of spins to N-th success:
 *   T_N ~ NegativeBinomial(N, p) sa support {N, N+1, N+2, ...}
 *
 * PMF (k ≥ N):
 *   P(T_N = k) = C(k−1, N−1) · p^N · (1−p)^(k−N)
 *
 * Moments (closed-form):
 *   E[T_N]    = N / p
 *   Var[T_N]  = N · (1−p) / p²
 *   stdT_N    = √Var
 *
 * Tail / disclosure:
 *   P(T_N ≤ k) = Σ_{j=N..k} P(T_N = j)            — CDF
 *   P(T_N > k) = P(C_k < N) = Σ_{j=0..N-1} C(k,j)·p^j·(1−p)^(k−j)
 *
 * Asymptotic rate:
 *   Triggers per spin (long-run) = p / N
 *   E[triggers in K spins]       = K · p / N
 *
 * Median / percentile q (0 < q < 1):
 *   smallest k ≥ N such that P(T_N ≤ k) ≥ q
 *   Computed numerically (monotone CDF search).
 *
 * Numerical stability:
 *   PMF C(k−1, N−1) explodes for large k — compute in log-space
 *   (log-gamma) and aggregate after exponentiation.
 *
 * Industry compliance:
 *   • UKGC RTS 14 — median + 95th percentile wait time disclosure
 *   • MGA PPD §11.f — operator-facing collect-rate disclosure
 *   • eCOGRA Generic Slots Audit — verifies E[T_N], P(T_N≤k) match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateBonusCollectN() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface BonusCollectNConfig {
  /** Per-spin probability that a collect symbol lands (0 < p ≤ 1). */
  collectProbabilityPerSpin: number;
  /** Threshold N — number of collects to trigger bonus (positive integer ≥ 1). */
  triggerThreshold: number;
  /** Percentile targets to compute (default [0.5, 0.75, 0.95]). */
  percentileTargets?: number[];
  /** Operator-facing horizon K (spins) for P(trigger within K) disclosure. */
  horizonSpins?: number;
}

export interface BonusCollectNResult {
  triggerThreshold: number;
  collectProbabilityPerSpin: number;
  expectedWaitTime: number;
  varianceWaitTime: number;
  stdWaitTime: number;
  medianWaitTime: number;
  /** Map of percentile q (e.g. '0.95') → k_q wait time. */
  percentileWaitTimes: Record<string, number>;
  /** P(T_N ≤ k) for horizonSpins (if provided). */
  probTriggerWithinHorizon?: number;
  /** Long-run trigger rate per spin = p / N. */
  triggerRatePerSpin: number;
  /** E[triggers in horizonSpins spins] = K · p / N (if horizonSpins provided). */
  expectedTriggersInHorizon?: number;
}

export interface BonusCollectNMCResult {
  episodes: number;
  observedMeanWaitTime: number;
  observedVarianceWaitTime: number;
  observedMaxObserved: number;
  /** Fraction of episodes triggered within horizonSpins (if horizon provided). */
  observedTriggerWithinHorizonFraction?: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: BonusCollectNConfig): void {
  const p = cfg.collectProbabilityPerSpin;
  if (!Number.isFinite(p) || p <= 0 || p > 1) {
    throw new Error(`collectProbabilityPerSpin must be in (0, 1] (got ${p})`);
  }
  const N = cfg.triggerThreshold;
  if (!Number.isInteger(N) || N < 1) {
    throw new Error(`triggerThreshold must be positive integer ≥ 1 (got ${N})`);
  }
  if (cfg.percentileTargets !== undefined) {
    for (const q of cfg.percentileTargets) {
      if (!Number.isFinite(q) || q <= 0 || q >= 1) {
        throw new Error(`percentile target must be in (0, 1) (got ${q})`);
      }
    }
  }
  if (cfg.horizonSpins !== undefined) {
    if (!Number.isInteger(cfg.horizonSpins) || cfg.horizonSpins < 1) {
      throw new Error(`horizonSpins must be positive integer ≥ 1 (got ${cfg.horizonSpins})`);
    }
  }
}

// ── Numerical helpers ──────────────────────────────────────────────────────

/** log Γ(x) using Lanczos approximation (Numerical Recipes §6.1, ~1e-10). */
function logGamma(x: number): number {
  const c = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -5.395239384953e-6,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Log binomial coefficient log C(n, k). */
function logBinom(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * P(C_k < N) = Σ_{j=0..N-1} C(k, j) · p^j · (1-p)^(k-j)
 * = P(T_N > k) by negative-binomial complement identity.
 *
 * Computed in log-space and aggregated to dodge huge intermediates for large k.
 */
function probWaitGreaterThanK(p: number, N: number, k: number): number {
  if (k < N) return 1; // can't have N successes in < N trials
  const logP = Math.log(p);
  const logQ = Math.log(1 - p);
  let sum = 0;
  for (let j = 0; j < N; j++) {
    const logTerm = logBinom(k, j) + j * logP + (k - j) * logQ;
    sum += Math.exp(logTerm);
  }
  return Math.max(0, Math.min(1, sum));
}

/** CDF: P(T_N ≤ k) = 1 − P(T_N > k). */
function cdfWait(p: number, N: number, k: number): number {
  return 1 - probWaitGreaterThanK(p, N, k);
}

/**
 * Smallest k ≥ N such that CDF(k) ≥ q. Search starts at E[T_N] and expands.
 * Guarantees termination because CDF → 1 monotonically.
 */
function percentileWait(p: number, N: number, q: number): number {
  if (q <= 0) return N;
  // Initial bound: 99.99th percentile ≈ N/p + 4·std/p; we just go big.
  const e = N / p;
  const std = Math.sqrt(N * (1 - p) / (p * p));
  let upper = Math.max(N, Math.ceil(e + 10 * std + 100));
  // Ensure CDF(upper) ≥ q; double if not
  let guard = 0;
  while (cdfWait(p, N, upper) < q) {
    upper *= 2;
    if (++guard > 50) break;
  }
  // Binary search lowest k ≥ N satisfying CDF(k) ≥ q
  let lo = N;
  let hi = upper;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdfWait(p, N, mid) >= q) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveBonusCollectN(config: BonusCollectNConfig): BonusCollectNResult {
  validate(config);
  const p = config.collectProbabilityPerSpin;
  const N = config.triggerThreshold;
  const targets = config.percentileTargets ?? [0.5, 0.75, 0.95];

  const eT = N / p;
  const varT = (N * (1 - p)) / (p * p);
  const stdT = Math.sqrt(varT);
  const median = percentileWait(p, N, 0.5);

  const percentileMap: Record<string, number> = {};
  for (const q of targets) {
    percentileMap[String(q)] = percentileWait(p, N, q);
  }

  let probWithin: number | undefined;
  let expectedTriggers: number | undefined;
  if (config.horizonSpins !== undefined) {
    probWithin = cdfWait(p, N, config.horizonSpins);
    expectedTriggers = (config.horizonSpins * p) / N;
  }

  return {
    triggerThreshold: N,
    collectProbabilityPerSpin: p,
    expectedWaitTime: eT,
    varianceWaitTime: varT,
    stdWaitTime: stdT,
    medianWaitTime: median,
    percentileWaitTimes: percentileMap,
    probTriggerWithinHorizon: probWithin,
    triggerRatePerSpin: p / N,
    expectedTriggersInHorizon: expectedTriggers,
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

export function simulateBonusCollectN(
  config: BonusCollectNConfig,
  episodes: number,
  seed: number,
): BonusCollectNMCResult {
  validate(config);
  const rng = makePrng(seed);
  const p = config.collectProbabilityPerSpin;
  const N = config.triggerThreshold;
  const horizon = config.horizonSpins;

  let sumT = 0;
  let sumT2 = 0;
  let maxObs = 0;
  let withinHorizonCount = 0;
  const safetyCap = Math.max(1_000_000, Math.ceil((100 * N) / p));

  for (let ep = 0; ep < episodes; ep++) {
    let collects = 0;
    let spins = 0;
    while (collects < N) {
      spins++;
      if (rng() < p) collects++;
      if (spins > safetyCap) break;
    }
    sumT += spins;
    sumT2 += spins * spins;
    if (spins > maxObs) maxObs = spins;
    if (horizon !== undefined && spins <= horizon) withinHorizonCount++;
  }

  const meanT = sumT / episodes;
  const varT = Math.max(0, sumT2 / episodes - meanT * meanT);

  const out: BonusCollectNMCResult = {
    episodes,
    observedMeanWaitTime: meanT,
    observedVarianceWaitTime: varT,
    observedMaxObserved: maxObs,
  };
  if (horizon !== undefined) {
    out.observedTriggerWithinHorizonFraction = withinHorizonCount / episodes;
  }
  return out;
}
