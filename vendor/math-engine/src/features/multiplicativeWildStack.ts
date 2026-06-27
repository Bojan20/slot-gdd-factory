/**
 * W152 Wave 93 — Multiplicative Wild Stack Bonus (Faza 4.5 ext).
 *
 * Closed-form solver za "wild stack with multiplier" mehaniku gde
 * svaki landed wild stack ima svoj multiplier, i SVI wild multiplikatori
 * se KOMBINUJU MULTIPLIKATIVNO kada se primenjuju na win:
 *
 *   Total wild multiplier W = Π_{i=1..N} M_i
 *
 * gde N ~ Binomial(R, p_wild) je broj wild reels koji se aktiviraju
 * i M_i iid je per-stack multiplier iz discrete distribucije.
 *
 * Industry standard mehanika (NetEnt Hotline / Lightning Roulette /
 * Push Gaming Wanted Dead, Hacksaw Multiplier Mayhem). Different from
 * additive multipliers (W89, W86) — these COMPOUND multiplicatively.
 *
 * Naming policy (clean-room): "wild stack", "multiplicative
 * multiplier" = generic industry terms. No vendor-specific
 * implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Inputs:
 *   R              = number of reels (positions where wild stack can land)
 *   p_wild         = per-reel probability of wild stack
 *   multiplierDist = discrete distribution {valueX, weight} for per-stack mult
 *   μ_B, σ²_B      = base win mean/variance (independent of wilds)
 *
 * Per spin:
 *   1. Each reel independently lands wild stack w.p. p_wild.
 *   2. Each landed wild gets multiplier M_i iid from distribution.
 *   3. Combined wild multiplier W = Π M_i (over landed wilds; W=1 if N=0).
 *   4. Base win B is determined (mean μ_B, var σ²_B).
 *   5. Total payout Y = B · W.
 *
 * Closed-form moments:
 *   N ~ Binomial(R, p_wild):
 *     E[N]   = R · p_wild
 *     Var[N] = R · p_wild · (1 - p_wild)
 *
 *   Combined wild multiplier (using per-reel "active vs inactive" structure):
 *     E[W]   = (p_wild · μ_M + (1 - p_wild))^R          (interchange product)
 *     E[W²]  = (p_wild · E[M²] + (1 - p_wild))^R
 *            = (p_wild · (σ²_M + μ²_M) + (1 - p_wild))^R
 *     Var[W] = E[W²] − E[W]²
 *
 *   Payout Y = B · W, B and W independent:
 *     E[Y]   = μ_B · E[W]
 *     E[Y²]  = E[B²] · E[W²] = (σ²_B + μ²_B) · E[W²]
 *     Var[Y] = E[Y²] − E[Y]²
 *
 * Tail risk:
 *   P(N = R) = p_wild^R                                 (all wilds active)
 *   P(N = 0) = (1 - p_wild)^R                           (no wilds)
 *   E[W | N = R] = μ_M^R                                (peak case mean)
 *   Max combined multiplier = m_max^R                   (deterministic peak)
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateMultiplicativeWildStack() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface WildMultiplierOutcome {
  /** Display label. */
  label: string;
  /** Per-stack multiplier value. */
  valueX: number;
  /** Weight (probability proportional to Σ weights). */
  weight: number;
}

export interface MultiplicativeWildStackConfig {
  /** Number of reels (integer ≥ 1). */
  reelsR: number;
  /** Per-reel wild-stack landing probability (0 ≤ p ≤ 1). */
  wildLandingProbabilityPerReel: number;
  /** Per-stack multiplier value distribution (non-empty). */
  multiplierDistribution: WildMultiplierOutcome[];
  /** Mean base win per spin (bet multiplier). */
  meanBaseWinX: number;
  /** Variance of base win per spin. */
  varianceBaseWinX: number;
}

export interface MultiplicativeWildStackResult {
  // Wild-count statistics
  expectedActiveWilds: number;
  varianceActiveWilds: number;
  // Per-stack multiplier moments
  expectedMultiplierPerStack: number;
  varianceMultiplierPerStack: number;
  maxMultiplierPerStack: number;
  // Combined wild multiplier moments
  expectedCombinedMultiplier: number;
  expectedCombinedMultiplierSquared: number;
  varianceCombinedMultiplier: number;
  // Total payout statistics
  expectedTotalPayoutX: number;
  varianceTotalPayoutX: number;
  stdTotalPayoutX: number;
  // Tail probabilities
  probAllWilds: number;
  probZeroWilds: number;
  // Peak case
  expectedMultiplierIfAllActive: number;
  /** m_max^R — deterministic max combined multiplier. */
  maxCombinedMultiplier: number;
}

export interface MultiplicativeWildStackMCResult {
  episodes: number;
  totalWilds: number;
  totalPayoutX: number;
  observedMeanWilds: number;
  observedMeanCombinedMultiplier: number;
  observedMeanPayoutX: number;
  observedVariancePayoutX: number;
  observedMaxObservedMult: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: MultiplicativeWildStackConfig): void {
  if (!Number.isInteger(cfg.reelsR) || cfg.reelsR < 1) {
    throw new Error(`reelsR must be integer ≥ 1`);
  }
  const p = cfg.wildLandingProbabilityPerReel;
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error(`wildLandingProbabilityPerReel must be in [0, 1]`);
  }
  if (!Array.isArray(cfg.multiplierDistribution) || cfg.multiplierDistribution.length === 0) {
    throw new Error(`multiplierDistribution must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const o of cfg.multiplierDistribution) {
    if (typeof o.label !== 'string' || o.label.length === 0) {
      throw new Error(`multiplier outcome label must be non-empty`);
    }
    if (seen.has(o.label)) throw new Error(`duplicate multiplier label: ${o.label}`);
    seen.add(o.label);
    if (!Number.isFinite(o.valueX) || o.valueX <= 0) {
      throw new Error(`multiplier outcome ${o.label}: valueX must be > 0`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`multiplier outcome ${o.label}: weight must be > 0`);
    }
  }
  if (!Number.isFinite(cfg.meanBaseWinX) || cfg.meanBaseWinX < 0) {
    throw new Error(`meanBaseWinX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.varianceBaseWinX) || cfg.varianceBaseWinX < 0) {
    throw new Error(`varianceBaseWinX must be ≥ 0`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveMultiplicativeWildStack(
  config: MultiplicativeWildStackConfig,
): MultiplicativeWildStackResult {
  validate(config);
  const R = config.reelsR;
  const p = config.wildLandingProbabilityPerReel;
  const dist = config.multiplierDistribution;
  const muB = config.meanBaseWinX;
  const sigma2B = config.varianceBaseWinX;

  // Per-stack multiplier moments
  const sumW = dist.reduce((a, o) => a + o.weight, 0);
  let muM = 0;
  let eM2 = 0;
  let maxM = 0;
  for (const o of dist) {
    const prob = o.weight / sumW;
    muM += prob * o.valueX;
    eM2 += prob * o.valueX * o.valueX;
    if (o.valueX > maxM) maxM = o.valueX;
  }
  const varM = Math.max(0, eM2 - muM * muM);

  // Active wild count: N ~ Binomial(R, p)
  const eN = R * p;
  const varN = R * p * (1 - p);

  // Combined wild multiplier W = Π_{i=1..N} M_i
  //   E[W]  = (p·μ_M + 1-p)^R   (independent reels, "active or inactive")
  //   E[W²] = (p·E[M²] + 1-p)^R
  const eW = Math.pow(p * muM + (1 - p), R);
  const eW2 = Math.pow(p * eM2 + (1 - p), R);
  const varW = Math.max(0, eW2 - eW * eW);

  // Payout Y = B · W, B and W independent
  //   E[Y]   = μ_B · E[W]
  //   E[Y²]  = E[B²] · E[W²] = (σ²_B + μ²_B) · E[W²]
  const eY = muB * eW;
  const eY2 = (sigma2B + muB * muB) * eW2;
  const varY = Math.max(0, eY2 - eY * eY);
  const stdY = Math.sqrt(varY);

  // Tail probabilities
  const probAll = Math.pow(p, R);
  const probZero = Math.pow(1 - p, R);

  // Peak / max case
  const eIfAll = Math.pow(muM, R);
  const maxCombined = Math.pow(maxM, R);

  return {
    expectedActiveWilds: eN,
    varianceActiveWilds: varN,
    expectedMultiplierPerStack: muM,
    varianceMultiplierPerStack: varM,
    maxMultiplierPerStack: maxM,
    expectedCombinedMultiplier: eW,
    expectedCombinedMultiplierSquared: eW2,
    varianceCombinedMultiplier: varW,
    expectedTotalPayoutX: eY,
    varianceTotalPayoutX: varY,
    stdTotalPayoutX: stdY,
    probAllWilds: probAll,
    probZeroWilds: probZero,
    expectedMultiplierIfAllActive: eIfAll,
    maxCombinedMultiplier: maxCombined,
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

function samplePayoutTwoPoint(rng: () => number, mu: number, sigma2: number): number {
  if (mu === 0) return 0;
  if (sigma2 <= 0) return mu;
  const x = mu + sigma2 / mu;
  const probability = (mu * mu) / (mu * mu + sigma2);
  return rng() < probability ? x : 0;
}

export function simulateMultiplicativeWildStack(
  config: MultiplicativeWildStackConfig,
  episodes: number,
  seed: number,
): MultiplicativeWildStackMCResult {
  validate(config);
  const rng = makePrng(seed);
  const R = config.reelsR;
  const p = config.wildLandingProbabilityPerReel;
  const dist = config.multiplierDistribution;
  const muB = config.meanBaseWinX;
  const sigma2B = config.varianceBaseWinX;
  const sumW = dist.reduce((a, o) => a + o.weight, 0);
  const Nd = dist.length;
  const cum: number[] = new Array<number>(Nd);
  {
    let running = 0;
    for (let i = 0; i < Nd; i++) {
      running += dist[i].weight / sumW;
      cum[i] = running;
    }
    cum[Nd - 1] = 1;
  }

  let totalWilds = 0;
  let totalCombinedMult = 0;
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let maxObservedMult = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let wildsThisSpin = 0;
    let combinedW = 1;
    for (let r = 0; r < R; r++) {
      if (rng() < p) {
        wildsThisSpin++;
        const u = rng();
        let idx = Nd - 1;
        for (let j = 0; j < Nd; j++) {
          if (u < cum[j]) { idx = j; break; }
        }
        combinedW *= dist[idx].valueX;
      }
    }
    const b = samplePayoutTwoPoint(rng, muB, sigma2B);
    const payout = b * combinedW;
    totalWilds += wildsThisSpin;
    totalCombinedMult += combinedW;
    totalPayout += payout;
    totalPayoutSq += payout * payout;
    if (combinedW > maxObservedMult) maxObservedMult = combinedW;
  }

  const meanY = totalPayout / episodes;
  const variance = Math.max(0, totalPayoutSq / episodes - meanY * meanY);

  return {
    episodes,
    totalWilds,
    totalPayoutX: totalPayout,
    observedMeanWilds: totalWilds / episodes,
    observedMeanCombinedMultiplier: totalCombinedMult / episodes,
    observedMeanPayoutX: meanY,
    observedVariancePayoutX: variance,
    observedMaxObservedMult: maxObservedMult,
  };
}
