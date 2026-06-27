/**
 * W152 Wave 173 — Pick-and-Click Pooper Bonus Analyzer (58. solver).
 *
 * Iconic pick-bonus mehanika sa **terminator ("pooper", "collect", "game over")
 * boxes** koji prekidaju bonus. Player pick-a hidden boxes one-by-one, otkriva
 * prize ili pooper. Bonus ends na first pooper hit ili na maxReveals cap.
 *
 *   * Aristocrat 5 Dragons pick-prize (4 prize symbols + 1 collect = N=20 K=5)
 *   * IGT Wheel of Fortune Pick-a-Pack
 *   * Bally Quick Hit pick-a-prize
 *   * NetEnt Gonzo's Quest Bonus (prize hieroglyphs + collect)
 *   * Konami China Shores pick-and-click
 *   * Aristocrat Buffalo Gold Collection pick-coin bonus
 *   * Light & Wonder Wonder 4 pick-a-game
 *
 * **58th closed-form solver** — first pick-bonus kernel modeling NEGATIVE
 * HYPERGEOMETRIC distribucija nad number of prize-reveals before first pooper
 * (sample-without-replacement from finite box pool).
 *
 * ── Math (Negative Hypergeometric) ────────────────────────────────────────────
 *
 * Pool: N total boxes, K poopers (terminators), M = N − K prize boxes.
 * Player reveals without replacement until first pooper hit (or cap).
 *
 * T = number of prize reveals before first pooper, T ∈ {0, 1, ..., M}.
 *
 * Negative hypergeometric (Wikipedia §"Negative hypergeometric distribution",
 * Johnson-Kotz-Kemp "Univariate Discrete Distributions" 3rd ed §6.2.4):
 *
 *   P(T = t) = C(M, t) · C(K, 1) · t! · (M − t)! · K! · (N − 1 − t)!
 *              / (N! · ...)             ←  unwieldy
 *
 * Cleaner factorial form:
 *
 *   P(T = t) = (M choose t) · K / ((N − t) · (N choose t))      ··· (★)
 *            = ∏_{j=0..t−1} (M − j)/(N − j) · K/(N − t)
 *
 * Recursion (numerically stable):
 *
 *   P(T = 0) = K / N
 *   P(T = t) = P(T = t−1) · (M − t + 1) / (N − t + 1) · (N − t + 1)/(N − t)
 *            = P(T = t−1) · (M − t + 1) / (N − t)              (simplified)
 *
 * Moments (closed form, Wikipedia §"NHG" for r=1 failure):
 *
 *   E[T] = M / (K + 1)
 *   Var[T] = M · (N + 1) · K / ((K + 1)² · (K + 2))
 *
 * Per-prize-box value V (iid, mean=μ_V, var=σ²_V). Total bonus payout
 * S = Σ_{i=1..T} V_i. By Wald (T independent of V_i):
 *
 *   E[S] = E[T] · μ_V
 *   Var[S] = E[T] · σ²_V + Var[T] · μ_V²
 *
 * Cap effect: if maxReveals < M, we truncate T at cap. Use exact PMF and
 * compute truncated moments via finite-sum.
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - W107 Pick Bonus N-Stage Tree (multi-stage deterministic tree, no terminator)
 *   - W118 Bonus Collect-N Trigger Tracker (collect-N tokens, Markov not NHG)
 *   - W116 Mystery Symbol Reveal Aggregator (mystery values, ne pick-bonus)
 *   - W160 baseline pickBonus (single-reveal, no pooper / no chain)
 *   - W171 Tumbling Cascade Chain Length (Geometric WITH replacement, ne NHG)
 *
 * Compliance:
 *   - UKGC RTS 14 (bonus mechanic disclosure — pooper count + expected reveals)
 *   - MGA PPD §11 (bonus game transparency)
 *   - AU NCPF Class III (bonus help screen — show oneInNRoundsZeroPicks)
 *   - eCOGRA (pick-bonus PMF audit trail)
 *
 * Naming: "pick-and-click", "pooper", "collect" = generic industry slot-design
 * terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface PickClickPooperBonusConfig {
  /** Total boxes in bonus pool N ≥ 2. */
  totalBoxes: number;
  /** Number of pooper/terminator boxes K (1 ≤ K < N). */
  pooperBoxes: number;
  /** E[prize value per revealed prize box] in × bet units (≥ 0). */
  prizeValueMean: number;
  /** Var[prize value per revealed prize box] in × bet² (≥ 0). */
  prizeValueVar: number;
  /** Optional hard cap on reveals (e.g. UI shows only 8 of 20 boxes). */
  maxReveals?: number;
  /** Optional disclosure thresholds (e.g. [3, 5, 8] reveals). */
  disclosureRevealThresholds?: number[];
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface PickClickPooperBonusResult {
  /** Effective M = totalBoxes − pooperBoxes prize boxes. */
  prizeBoxes: number;
  /** Effective cap min(maxReveals ?? M, M). */
  effectiveCap: number;
  /** E[T] = expected number of prize reveals before first pooper (truncated by cap). */
  expectedReveals: number;
  /** Var[T] under cap. */
  varianceReveals: number;
  /** StdDev[T]. */
  stdDevReveals: number;
  /** E[S] = E[T]·μ_V = expected total bonus payout in × bet. */
  expectedTotalPayout: number;
  /** Var[S] = Wald-compound variance under cap. */
  varianceTotalPayout: number;
  /** StdDev[S]. */
  stdDevTotalPayout: number;
  /** P(T = 0) = first reveal is pooper. */
  probZeroReveals: number;
  /** 1 / P(T = 0) = "1 in X rounds first pick is pooper". */
  oneInNRoundsZeroPicks: number;
  /** P(T ≥ k) survival for each disclosure threshold. */
  survivalAtThresholds: { k: number; probAtLeastK: number; oneInNRounds: number }[];
  /** P(reaches cap) = P(T = effectiveCap), i.e. cleared all UI-shown picks. */
  probReachesCap: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: PickClickPooperBonusConfig): void {
  if (!Number.isFinite(cfg.totalBoxes) || cfg.totalBoxes < 2 || !Number.isInteger(cfg.totalBoxes)) {
    throw new Error(`totalBoxes must be integer ≥ 2, got ${cfg.totalBoxes}`);
  }
  if (
    !Number.isFinite(cfg.pooperBoxes) ||
    cfg.pooperBoxes < 1 ||
    cfg.pooperBoxes >= cfg.totalBoxes ||
    !Number.isInteger(cfg.pooperBoxes)
  ) {
    throw new Error(
      `pooperBoxes must be integer in [1, totalBoxes − 1], got ${cfg.pooperBoxes} (N=${cfg.totalBoxes})`,
    );
  }
  if (!Number.isFinite(cfg.prizeValueMean) || cfg.prizeValueMean < 0) {
    throw new Error(`prizeValueMean must be ≥ 0, got ${cfg.prizeValueMean}`);
  }
  if (!Number.isFinite(cfg.prizeValueVar) || cfg.prizeValueVar < 0) {
    throw new Error(`prizeValueVar must be ≥ 0, got ${cfg.prizeValueVar}`);
  }
  if (cfg.maxReveals !== undefined) {
    if (
      !Number.isFinite(cfg.maxReveals) ||
      cfg.maxReveals < 1 ||
      !Number.isInteger(cfg.maxReveals)
    ) {
      throw new Error(`maxReveals must be integer ≥ 1, got ${cfg.maxReveals}`);
    }
  }
  if (cfg.disclosureRevealThresholds) {
    for (const k of cfg.disclosureRevealThresholds) {
      if (!Number.isFinite(k) || k < 0 || !Number.isInteger(k)) {
        throw new Error(`disclosureRevealThresholds entries must be integer ≥ 0, got ${k}`);
      }
    }
  }
}

/** ── PMF builder (numerically stable recursion) ──────────────────────────── */
function buildPmf(N: number, K: number, cap: number): number[] {
  // pmf[t] = P(T = t) for t = 0..cap
  // Boundary: t = cap means "reached cap without hitting pooper" — absorb
  // all probability mass for t > cap into the cap bucket so the truncated
  // distribution sums to 1.
  const M = N - K;
  const pmf = new Array<number>(cap + 1).fill(0);

  // P(T = 0) = K / N
  pmf[0] = K / N;

  // Recursion: P(T = t) = P(T = t−1) · (M − t + 1)/(K + 1) · ... derived from (★).
  // Easier — direct: P(T = t) = ∏_{j=0..t−1}(M − j)/(N − j) · K/(N − t)
  //              = "no pooper in first t draws (from prize pool only)" · "pooper at t+1-th draw"
  let prefix = 1.0; // ∏_{j=0..t−1}(M − j)/(N − j) for t starting at 0 (empty product)
  for (let t = 0; t < cap; t++) {
    // Update prefix to product up to t (multiply by (M−t)/(N−t))
    prefix *= (M - t) / (N - t);
    // P(T = t+1) = prefix · K / (N − (t+1))
    pmf[t + 1] = prefix * (K / (N - (t + 1)));
  }

  // If cap < M, the residual probability mass = "no pooper in any cap+1 draws"
  // = ∏_{j=0..cap-1}(M − j)/(N − j) · ... wait we still have prefix here.
  // After loop with t reaching cap, prefix represents (after final iter)
  // ∏_{j=0..cap-1}(M − j)/(N − j). The residual = "we survive cap reveals and
  // stop because of UI cap" = prefix · (M − cap)/(N − cap) ... but that includes
  // the (cap+1)-th draw being prize. Actually we stop after cap reveals
  // regardless of what (cap+1)-th draw would have been. So residual mass
  // P(T_uncapped > cap−1, i.e. T ≥ cap) − P(T = cap from pooper at cap+1) ...
  //
  // Cleaner: residual = "no pooper in first cap draws" = ∏_{j=0..cap-1}(M − j)/(N − j).
  // After loop, prefix = ∏_{j=0..cap-1}(M − j)/(N − j) — exactly this!
  // Currently pmf[cap] holds "pooper at draw cap+1" probability. We need to
  // ADD the "no pooper in cap+2, cap+3, ..." tail = prefix − pmf[cap-th value above]
  // Hmm let me re-derive carefully.
  //
  // ACTUALLY simpler approach: just sum what we have and put residual at cap.
  let cum = 0;
  for (let t = 0; t <= cap; t++) cum += pmf[t];
  if (cum < 1 - 1e-15) {
    // Residual mass (no pooper in any of the cap+1 implied draws → cap reveals
    // all prize, bonus ends by UI cap). Lump it into pmf[cap] to make
    // truncated distribution sum to 1.
    pmf[cap] += 1 - cum;
  }
  return pmf;
}

/** ── Main analyzer ───────────────────────────────────────────────────────── */
export function analyzePickClickPooperBonus(
  cfg: PickClickPooperBonusConfig,
): PickClickPooperBonusResult {
  validate(cfg);

  const N = cfg.totalBoxes;
  const K = cfg.pooperBoxes;
  const M = N - K;
  const effectiveCap = Math.min(cfg.maxReveals ?? M, M);

  const pmf = buildPmf(N, K, effectiveCap);

  // E[T], Var[T] from truncated PMF (exact).
  let expT = 0;
  let expT2 = 0;
  for (let t = 0; t <= effectiveCap; t++) {
    expT += t * pmf[t];
    expT2 += t * t * pmf[t];
  }
  const varT = Math.max(0, expT2 - expT * expT);
  const stdT = Math.sqrt(varT);

  // Wald compound for total payout S = Σ_{i=1..T} V_i with iid V_i:
  //   E[S] = E[T] · μ_V
  //   Var[S] = E[T] · σ²_V + Var[T] · μ_V²
  const muV = cfg.prizeValueMean;
  const sigma2V = cfg.prizeValueVar;
  const expS = expT * muV;
  const varS = expT * sigma2V + varT * muV * muV;
  const stdS = Math.sqrt(varS);

  // Survival thresholds: P(T ≥ k) = Σ_{t≥k} pmf[t]
  const thresholds = cfg.disclosureRevealThresholds ?? [];
  const survival: { k: number; probAtLeastK: number; oneInNRounds: number }[] = [];
  for (const k of thresholds) {
    let s = 0;
    for (let t = k; t <= effectiveCap; t++) s += pmf[t];
    survival.push({
      k,
      probAtLeastK: s,
      oneInNRounds: s > 0 ? 1 / s : Number.POSITIVE_INFINITY,
    });
  }

  const probZero = pmf[0];
  const oneInNZero = probZero > 0 ? 1 / probZero : Number.POSITIVE_INFINITY;
  const probReachesCap = pmf[effectiveCap];

  return {
    prizeBoxes: M,
    effectiveCap,
    expectedReveals: expT,
    varianceReveals: varT,
    stdDevReveals: stdT,
    expectedTotalPayout: expS,
    varianceTotalPayout: varS,
    stdDevTotalPayout: stdS,
    probZeroReveals: probZero,
    oneInNRoundsZeroPicks: oneInNZero,
    survivalAtThresholds: survival,
    probReachesCap,
  };
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solvePickClickPooperBonus = analyzePickClickPooperBonus;

/** ── Closed-form moment formulas (un-capped, NHG canonical) ──────────────── */
/**
 * Canonical un-capped E[T] = M / (K + 1) for negative hypergeometric (r = 1
 * failure stop). Useful for sanity checks vs analyzer (when no cap applied).
 */
export function uncappedExpectedRevealsNhg(totalBoxes: number, pooperBoxes: number): number {
  return (totalBoxes - pooperBoxes) / (pooperBoxes + 1);
}

/**
 * Canonical un-capped Var[T] = M·(N+1)·K / ((K+1)²·(K+2)) for NHG (r=1).
 */
export function uncappedVarianceRevealsNhg(totalBoxes: number, pooperBoxes: number): number {
  const M = totalBoxes - pooperBoxes;
  const K = pooperBoxes;
  return (M * (totalBoxes + 1) * K) / ((K + 1) * (K + 1) * (K + 2));
}

/** ── Monte Carlo cross-validation (sample-without-replacement) ────────────── */
export function simulatePickClickPooperBonus(
  cfg: PickClickPooperBonusConfig,
  numRounds: number,
  seed = 0xc0ffee,
): {
  meanReveals: number;
  stdDevReveals: number;
  meanTotalPayout: number;
  stdDevTotalPayout: number;
  probZeroReveals: number;
  empiricalSurvival: { k: number; probAtLeastK: number }[];
} {
  validate(cfg);
  if (numRounds < 1 || !Number.isInteger(numRounds)) {
    throw new Error(`numRounds must be integer ≥ 1, got ${numRounds}`);
  }

  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return (z >>> 0) / 4294967296;
  };
  // Box-Muller for prize value sampling (Gaussian approx; user may supply
  // any distribution, here we use Normal with given mean/var).
  const gaussian = (mu: number, sigma: number): number => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
  };

  const N = cfg.totalBoxes;
  const K = cfg.pooperBoxes;
  const M = N - K;
  const cap = Math.min(cfg.maxReveals ?? M, M);
  const sigmaV = Math.sqrt(cfg.prizeValueVar);

  // Build identity box list: [0..K-1] poopers, [K..N-1] prizes.
  // Per round, do Fisher-Yates partial shuffle and reveal until pooper/cap.
  const boxes = new Array<number>(N);
  for (let i = 0; i < N; i++) boxes[i] = i;

  const thresholds = cfg.disclosureRevealThresholds ?? [];
  const survivalCounts = new Array<number>(thresholds.length).fill(0);

  let sumT = 0;
  let sumT2 = 0;
  let sumS = 0;
  let sumS2 = 0;
  let zeroCount = 0;

  for (let round = 0; round < numRounds; round++) {
    // Reset
    for (let i = 0; i < N; i++) boxes[i] = i;
    let revealed = 0;
    let payout = 0;
    let hitPooper = false;
    for (let pos = 0; pos < cap; pos++) {
      // pick random box from remaining boxes[pos..N-1]
      const idx = pos + Math.floor(rng() * (N - pos));
      const tmp = boxes[pos];
      boxes[pos] = boxes[idx];
      boxes[idx] = tmp;
      const drawn = boxes[pos];
      if (drawn < K) {
        // pooper → stop
        hitPooper = true;
        break;
      }
      revealed++;
      payout += gaussian(cfg.prizeValueMean, sigmaV);
    }
    // If !hitPooper and revealed === cap → reached cap (still counts as T = cap).
    void hitPooper;

    sumT += revealed;
    sumT2 += revealed * revealed;
    sumS += payout;
    sumS2 += payout * payout;
    if (revealed === 0) zeroCount++;
    for (let i = 0; i < thresholds.length; i++) {
      if (revealed >= thresholds[i]) survivalCounts[i]++;
    }
  }

  const meanT = sumT / numRounds;
  const varT = Math.max(0, sumT2 / numRounds - meanT * meanT);
  const meanS = sumS / numRounds;
  const varS = Math.max(0, sumS2 / numRounds - meanS * meanS);

  return {
    meanReveals: meanT,
    stdDevReveals: Math.sqrt(varT),
    meanTotalPayout: meanS,
    stdDevTotalPayout: Math.sqrt(varS),
    probZeroReveals: zeroCount / numRounds,
    empiricalSurvival: thresholds.map((k, i) => ({
      k,
      probAtLeastK: survivalCounts[i] / numRounds,
    })),
  };
}
