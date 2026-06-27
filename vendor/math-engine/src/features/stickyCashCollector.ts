/**
 * W152 Wave 60 — Sticky-Cash Collector variant (Faza 12 ⚠️→✅).
 *
 * Closes Faza 12 scenario "⚠️ Sticky-cash variant" (line 745 — different
 * geometry vs Wave 52 reveal-mult). This is the "cash-collect symbol"
 * mechanic where:
 *
 *   1. Cash symbols deposit sticky values on the grid as they land.
 *   2. A separate "collector symbol" lands with probability p_collect per
 *      spin. When it lands, it multiplies the CURRENT sticky total by a
 *      multiplier M (drawn from a multiplier distribution) and RESETS the
 *      grid. The (M × current_total) is paid.
 *   3. At end of N-spin window, any cash deposited since last collector
 *      is LOST (variant: "without collector, money is gone").
 *
 * ── Different from Wave 52 (Sticky Cash + Reveal Multiplier) ──────────────
 * Wave 52 = sticky cash + SINGLE end-of-window reveal multiplier (always).
 * Wave 60 = sticky cash + RANDOM-ARRIVAL collector events that reset between.
 *
 * Math regime differs:
 *   • W52: deterministic single multiplier event at end → simple Wald-product.
 *   • W60: random arrival times → renewal-reward theory + stranded-cash
 *     correction.
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Cash-collect with multiplier-collector is a P-002 / P-005 family
 * mechanic (`docs/INDUSTRY_PATTERN_CATALOG.md`). Multiple multi-vendor
 * implementations; math is independent of specific symbol art.
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Sticky cash" + "collector" + "multiplier" = generic descriptive.
 *   • No vendor-specific marks.
 *   • Verified by `check-reserved-terms.sh`.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin, exactly ONE of three events fires:
 *   • cash deposit (prob p_cash, value V ~ cashDist)
 *   • collector (prob p_collect, mult M ~ multDist) → pay M × current_total, reset
 *   • neither (prob 1 − p_cash − p_collect)
 *
 * State at spin n: T_n = current sticky total. T_0 = 0.
 * Transition:
 *   T_{n+1} = T_n + V    (cash event)
 *   T_{n+1} = 0          (collector event — payout = M × T_n)
 *   T_{n+1} = T_n         (no event)
 *
 * Total payout Y over N-spin window = sum of (M × T) at each collector event.
 * Stranded cash at end (no collector before N) is LOST.
 *
 * ── Closed-form long-run RTP per spin ─────────────────────────────────────
 * In steady state:
 *   collector rate per spin = p_collect
 *   E[T at collector trigger] = p_cash · E[V] / p_collect   (renewal-residual)
 *   E[payout per collector] = E[M] · p_cash · E[V] / p_collect
 *   E[# collectors in N spins] = N · p_collect (asymptotic)
 *   ⇒ E[payout from collectors] ≈ N · p_cash · E[V] · E[M]
 *      (long-run RTP per spin = p_cash · E[V] · E[M])
 *
 * Note: this is independent of p_collect in infinite horizon. Each unit
 * of cash deposited will eventually be collected (geometric expected
 * wait time 1/p_collect for next collector).
 *
 * ── Finite-horizon correction ─────────────────────────────────────────────
 * For N spins, expected payout has a stranded-cash deduction:
 *   E[Y] = N · p_cash · E[V] · E[M] − E[stranded · M_residual]
 *
 * Stranded cash = cash deposited after the LAST collector event.
 * Expected residual time (spins since last collector) at time N:
 *   ≈ 1/p_collect (renewal-residual theorem for geometric)
 *
 * Closed-form exact for finite N via direct forward propagation:
 *   pi_n(T) = P(sticky total = T at spin n)
 *   E[Y_n] = E[Y_{n-1}] + p_collect · E[M] · sum_T T · pi_{n-1}(T)
 *
 * Implementation uses moment tracking: only need E[T_n] over time (not
 * full PMF), since payout = M × E[T] is linear.
 *
 * ── References ────────────────────────────────────────────────────────────
 * Ross 1996 ch. 7 — renewal-reward theorem
 * Cabot & Hannum 2002 ch. 12 — cash-collect mechanics
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface CollectorCashOutcome {
  valueX: number;
  weight: number;
}

export interface CollectorMultOutcome {
  multiplier: number;
  weight: number;
}

export interface StickyCashCollectorConfig {
  /** P(cash deposit per spin). */
  pCash: number;
  /** P(collector triggers per spin). */
  pCollect: number;
  /** Cash value distribution per deposit event. */
  cashDistribution: CollectorCashOutcome[];
  /** Collector multiplier distribution per collector event. */
  multDistribution: CollectorMultOutcome[];
}

export interface CollectorSteadyStateResult {
  /** E[V] per cash event. */
  expectedCashPerEvent: number;
  /** E[M] per collector event. */
  expectedMultiplierPerCollector: number;
  /** E[# collectors per spin] = p_collect. */
  collectorRatePerSpin: number;
  /** E[# cash events per spin] = p_cash. */
  cashRatePerSpin: number;
  /** E[T] at collector trigger (renewal-residual). */
  expectedStickyTotalAtCollector: number;
  /** E[payout per collector event]. */
  expectedPayoutPerCollector: number;
  /** Long-run RTP per spin = p_cash · E[V] · E[M]. */
  longRunRtpPerSpin: number;
}

export interface CollectorFiniteHorizonResult {
  spinsN: number;
  /** E[Y_N] — total expected payout over N spins. */
  expectedPayoutInN: number;
  /** E[Y_N] / N — per-spin average. */
  expectedPayoutPerSpinInN: number;
  /** Long-run RTP × N (asymptotic benchmark). */
  asymptoticRtpInN: number;
  /** E[Y_N] / asymptoticRtpInN (efficiency). */
  efficiencyVsAsymptotic: number;
  /** Trace of E[T_n] over time (length N+1). */
  expectedStickyTotalTrace: number[];
  /** Expected stranded cash at end of N (T_N). */
  expectedStrandedAtEnd: number;
}

export interface CollectorMCResult {
  observedSpins: number;
  observedMeanPayoutInN: number;
  observedVariancePayoutInN: number;
  observedStdDevPayoutInN: number;
  observedMeanCollectors: number;
  observedMeanStrandedAtEnd: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: StickyCashCollectorConfig): void {
  if (cfg.pCash < 0 || cfg.pCash > 1) {
    throw new Error(`pCash must be in [0,1], got ${cfg.pCash}`);
  }
  if (cfg.pCollect <= 0 || cfg.pCollect > 1) {
    throw new Error(`pCollect must be in (0,1], got ${cfg.pCollect}`);
  }
  if (cfg.pCash + cfg.pCollect > 1) {
    throw new Error(`pCash + pCollect must be ≤ 1, got ${cfg.pCash + cfg.pCollect}`);
  }
  if (!Array.isArray(cfg.cashDistribution) || cfg.cashDistribution.length === 0) {
    throw new Error(`cashDistribution must be non-empty array`);
  }
  for (const o of cfg.cashDistribution) {
    if (!Number.isFinite(o.valueX) || o.valueX < 0) throw new Error(`cash valueX must be ≥ 0`);
    if (!Number.isFinite(o.weight) || o.weight <= 0) throw new Error(`cash weight must be > 0`);
  }
  if (!Array.isArray(cfg.multDistribution) || cfg.multDistribution.length === 0) {
    throw new Error(`multDistribution must be non-empty array`);
  }
  for (const o of cfg.multDistribution) {
    if (!Number.isFinite(o.multiplier) || o.multiplier < 0) throw new Error(`mult must be ≥ 0`);
    if (!Number.isFinite(o.weight) || o.weight <= 0) throw new Error(`mult weight must be > 0`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function distMean(dist: Array<{ valueX?: number; multiplier?: number; weight: number }>): number {
  let totalW = 0;
  let totalV = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalV += o.weight * ((o.valueX ?? o.multiplier!) ?? 0);
  }
  return totalV / totalW;
}

// ── Closed-form solvers ────────────────────────────────────────────────────

export function solveStickyCashCollectorSteadyState(
  config: StickyCashCollectorConfig,
): CollectorSteadyStateResult {
  validate(config);
  const eV = distMean(config.cashDistribution);
  const eM = distMean(config.multDistribution);
  const rate = config.pCollect;
  // E[T at collector trigger] = p_cash · E[V] / p_collect (renewal-residual)
  const expectedTAtCollector = (config.pCash * eV) / rate;
  return {
    expectedCashPerEvent: eV,
    expectedMultiplierPerCollector: eM,
    collectorRatePerSpin: rate,
    cashRatePerSpin: config.pCash,
    expectedStickyTotalAtCollector: expectedTAtCollector,
    expectedPayoutPerCollector: eM * expectedTAtCollector,
    longRunRtpPerSpin: config.pCash * eV * eM,
  };
}

/**
 * Forward propagation of E[T_n] (moment, not full PMF):
 *
 *   T_{n+1} = T_n + V·1[cash] − T_n·1[collector]
 *   E[T_{n+1}] = E[T_n]·(1 − p_collect) + p_cash · E[V]
 *
 * Steady state: E[T_*] = p_cash · E[V] / p_collect (matches renewal-residual).
 *
 * Cumulative payout:
 *   E[Y_n] = E[Y_{n-1}] + p_collect · E[M] · E[T_n]
 *          (collector at spin n pays M × T_n)
 */
export function solveStickyCashCollectorFiniteHorizon(
  config: StickyCashCollectorConfig,
  spinsN: number,
): CollectorFiniteHorizonResult {
  validate(config);
  if (!Number.isInteger(spinsN) || spinsN <= 0) {
    throw new Error(`spinsN must be positive integer`);
  }
  const eV = distMean(config.cashDistribution);
  const eM = distMean(config.multDistribution);
  const eTtrace: number[] = [0];
  let eT = 0;
  let eY = 0;
  for (let n = 1; n <= spinsN; n++) {
    // Update E[T]
    eT = eT * (1 - config.pCollect) + config.pCash * eV;
    eTtrace.push(eT);
    // Cumulative payout: each spin's collector pays based on T AT collector time
    // E[collector payout at spin n] = p_collect × E[M] × E[T_{n-1} | not yet collected]
    // But E[T_{n-1}] above already accounts for past collectors. The payout occurs
    // BEFORE the reset; we need pre-collector E[T]:
    //   pre-collector E[T at n] = E[T_{n-1}] + p_cash·E[V]·(1 conditional on this not collector)
    // Simpler: per spin n, expected payout = p_collect × E[M] × E[T_{n-1}] + ...
    // Actually the recurrence I wrote already accounts for the reset.
    // For clean accounting, payout at spin n = p_collect × E[M] × E[T just before this spin's collector decision]
    // = p_collect × E[M] × (E[T_{n-1}] + p_cash·E[V]) [if cash and collector are independent]
    // But here we said exactly ONE event per spin, so conditional on collector at n, T did not change in spin n.
    // So payout = p_collect × E[M] × E[T_{n-1}].
    eY += config.pCollect * eM * eTtrace[n - 1];
  }
  const asymp = spinsN * config.pCash * eV * eM;
  return {
    spinsN,
    expectedPayoutInN: eY,
    expectedPayoutPerSpinInN: eY / spinsN,
    asymptoticRtpInN: asymp,
    efficiencyVsAsymptotic: asymp > 0 ? eY / asymp : 0,
    expectedStickyTotalTrace: eTtrace,
    expectedStrandedAtEnd: eTtrace[spinsN],
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

function sample(dist: Array<{ weight: number; valueX?: number; multiplier?: number }>, rng: () => number): number {
  let total = 0;
  for (const o of dist) total += o.weight;
  let r = rng() * total;
  for (const o of dist) {
    r -= o.weight;
    if (r < 0) return (o.valueX ?? o.multiplier!) ?? 0;
  }
  const last = dist[dist.length - 1];
  return (last.valueX ?? last.multiplier!) ?? 0;
}

export function simulateStickyCashCollector(
  config: StickyCashCollectorConfig,
  spins: number,
  episodes: number,
  seed: number,
): CollectorMCResult {
  validate(config);
  const rng = makePrng(seed);
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let totalCollectors = 0;
  let totalStranded = 0;
  for (let e = 0; e < episodes; e++) {
    let T = 0;
    let Y = 0;
    let collectors = 0;
    for (let n = 0; n < spins; n++) {
      const u = rng();
      if (u < config.pCash) {
        T += sample(config.cashDistribution, rng);
      } else if (u < config.pCash + config.pCollect) {
        const M = sample(config.multDistribution, rng);
        Y += M * T;
        T = 0;
        collectors++;
      }
    }
    totalPayout += Y;
    totalPayoutSq += Y * Y;
    totalCollectors += collectors;
    totalStranded += T;
  }
  const meanY = totalPayout / episodes;
  const varY = totalPayoutSq / episodes - meanY * meanY;
  return {
    observedSpins: spins,
    observedMeanPayoutInN: meanY,
    observedVariancePayoutInN: varY,
    observedStdDevPayoutInN: Math.sqrt(Math.max(0, varY)),
    observedMeanCollectors: totalCollectors / episodes,
    observedMeanStrandedAtEnd: totalStranded / episodes,
  };
}
