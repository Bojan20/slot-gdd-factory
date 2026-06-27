/**
 * W152 Wave 152 — Bonus Trigger Award Tier Stratification (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "scatter-count-driven bonus trigger sa multi-tier
 * FS award" mehaniku — STANDARD industry pattern across catalog:
 *   • Pragmatic Sweet Bonanza family (3 = 10 FS, 4 = 15 FS, 5 = 20 FS)
 *   • NetEnt Vikings (3/4/5 scatters → variable FS award)
 *   • Hacksaw RIP City scatter tiers
 *   • IGT Cleopatra family
 *   • Microgaming Mega Moolah (4 scatter → 25 FS)
 *   • BTG Megaways (3/4/5 → 10/15/25 FS standard)
 *   • Push Gaming Razor Shark (variable FS by scatter)
 *
 * Naming policy (clean-room): "scatter count", "FS award", "tier
 * stratification" = generic industry terms. No vendor TM.
 *
 * ── Difference vs prior Wxx solvers ───────────────────────────────────────
 *   • W110 Bonus Trigger Wait Time Analyzer — long-run wait time, ne award
 *     count breakdown
 *   • W118 Bonus Collect-N Trigger Tracker — token collection threshold;
 *     ovaj solver scatter count-driven (immediate trigger pri ≥ S_min)
 *   • W84 FS Retrigger Compound Variance — retrigger TOKOM FS, ne initial
 *     trigger
 *   • W130 FS Buy + Tier Trade-Off — PAID mode decision, ne natural scatter
 *   • W127 Anticipation/Tease Reel — Bayesian per-reel reveal, ne aggregate
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N reels, per reel P(scatter lands) = q (Bernoulli, independent).
 * Total scatters per spin S ~ Binomial(N, q).
 *
 * Trigger: S ≥ S_min (typically 3).
 * Award schedule: K(s) = awarded FS for s ∈ {S_min, ..., N} scatters.
 *
 * ── Closed form ───────────────────────────────────────────────────────────
 * P(S = s) = C(N, s) · q^s · (1−q)^(N−s)
 * P(trigger) = P(S ≥ S_min) = Σ_{s=S_min..N} P(S = s)
 *
 * Conditional on trigger:
 *   P(S = s | trigger) = P(S = s) / P(trigger) for s ≥ S_min
 *
 * E[K | trigger] = Σ_{s ≥ S_min} K(s) · P(S = s | trigger)
 *
 * Variance:
 *   E[K² | trigger] = Σ_{s ≥ S_min} K(s)² · P(S = s | trigger)
 *   Var[K | trigger] = E[K² | trigger] − E[K | trigger]²
 *
 * Per spin (long-run, unconditional):
 *   E[FS won per spin] = P(trigger) · E[K | trigger] = Σ_{s ≥ S_min} K(s) · P(S = s)
 *   Var[FS won per spin] = Σ K(s)² · P(S = s) − (Σ K(s) · P(S = s))²
 *                          (S < S_min contributes 0 to K, but to E[K^2 indicator] terms)
 *
 * Stratification metrics:
 *   probTierBreakdown[s] = P(S = s | trigger) for s ≥ S_min
 *   probMaxScatterTier = P(S = N | trigger) — "max scatter %"
 *
 * Trigger frequency disclosure:
 *   oneInNTriggerFrequency = 1 / P(trigger) — regulator "1 in X" form
 *
 * ── Compliance ────────────────────────────────────────────────────────────
 *   • UKGC RTS 14 — bonus trigger frequency + award tier disclosure
 *   • MGA PPD §11.f — operator-facing scatter mechanic + award schedule
 *   • eCOGRA Generic Slots Audit — verifies per-tier trigger rate matches engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateBonusTriggerAwardStratification() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface BonusTriggerAwardTierEntry {
  /** Scatter count for this tier. */
  scatterCount: number;
  /** FS award (free spins granted) when this scatter count is rolled. */
  freeSpinsAward: number;
}

export interface BonusTriggerAwardStratificationConfig {
  /** Number of reels (positive integer, ≥ 1). */
  reelCount: number;
  /** Per-reel scatter probability q ∈ (0, 1). */
  scatterProbabilityPerReel: number;
  /** Minimum scatters to trigger bonus (1 ≤ S_min ≤ N). */
  minScattersForTrigger: number;
  /**
   * Award tier list: K(s) for each scatter count s ∈ [S_min, N].
   * MUST cover all values in [S_min, N] (otherwise validation fails).
   */
  awardTiers: BonusTriggerAwardTierEntry[];
}

export interface BonusTriggerAwardStratificationResult {
  reelCount: number;
  scatterProbabilityPerReel: number;
  minScattersForTrigger: number;
  /** Marginal scatter count PMF [N+1 entries indexed by s]. */
  scatterCountPmf: number[];
  /** P(S ≥ S_min) per spin. */
  probTriggerPerSpin: number;
  /** 1 / P(trigger). Infinity if P(trigger) = 0. */
  oneInNTriggerFrequency: number;
  /** Conditional E[K | trigger]. */
  expectedAwardGivenTrigger: number;
  /** Conditional Var[K | trigger]. */
  varianceAwardGivenTrigger: number;
  /** Unconditional E[FS won per spin] = P(trigger) · E[K | trigger]. */
  expectedFreeSpinsAwardedPerSpin: number;
  /** Conditional tier stratification: P(S = s | trigger) for s ≥ S_min. */
  probTierBreakdownConditional: number[];
  /** P(S = N | trigger) — "max scatter %". */
  probMaxScatterTier: number;
}

export interface BonusTriggerAwardStratificationMcResult {
  spins: number;
  observedTriggerFraction: number;
  observedMeanScattersPerSpin: number;
  observedMeanAwardGivenTrigger: number;
  observedMeanFreeSpinsAwardedPerSpin: number;
  observedTierFractions: number[];
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateConfig(cfg: BonusTriggerAwardStratificationConfig): void {
  if (!Number.isInteger(cfg.reelCount) || cfg.reelCount < 1) {
    throw new Error(`reelCount must be positive integer (got ${cfg.reelCount})`);
  }
  if (!(cfg.scatterProbabilityPerReel > 0 && cfg.scatterProbabilityPerReel < 1)) {
    throw new Error(`scatterProbabilityPerReel must be in (0, 1) (got ${cfg.scatterProbabilityPerReel})`);
  }
  if (!Number.isInteger(cfg.minScattersForTrigger) ||
      cfg.minScattersForTrigger < 1 ||
      cfg.minScattersForTrigger > cfg.reelCount) {
    throw new Error(`minScattersForTrigger must be integer in [1, ${cfg.reelCount}] (got ${cfg.minScattersForTrigger})`);
  }
  if (!Array.isArray(cfg.awardTiers) || cfg.awardTiers.length === 0) {
    throw new Error('awardTiers must be non-empty array');
  }
  const N = cfg.reelCount;
  const Smin = cfg.minScattersForTrigger;
  const expectedTiers = N - Smin + 1;
  if (cfg.awardTiers.length !== expectedTiers) {
    throw new Error(`awardTiers must have exactly ${expectedTiers} entries (one per s in [${Smin}, ${N}]); got ${cfg.awardTiers.length}`);
  }
  const seen = new Set<number>();
  for (const t of cfg.awardTiers) {
    if (!Number.isInteger(t.scatterCount) || t.scatterCount < Smin || t.scatterCount > N) {
      throw new Error(`tier scatterCount must be integer in [${Smin}, ${N}] (got ${t.scatterCount})`);
    }
    if (seen.has(t.scatterCount)) {
      throw new Error(`duplicate tier scatterCount=${t.scatterCount}`);
    }
    seen.add(t.scatterCount);
    if (!Number.isFinite(t.freeSpinsAward) || t.freeSpinsAward < 0) {
      throw new Error(`freeSpinsAward must be finite non-negative (got ${t.freeSpinsAward})`);
    }
  }
  for (let s = Smin; s <= N; s++) {
    if (!seen.has(s)) {
      throw new Error(`awardTiers missing entry for scatterCount=${s}`);
    }
  }
}

// ── Binomial PMF helper ─────────────────────────────────────────────────────

function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

function binomialPmf(N: number, q: number, k: number): number {
  return binomCoeff(N, k) * Math.pow(q, k) * Math.pow(1 - q, N - k);
}

// ── Closed-form solver ──────────────────────────────────────────────────────

export function solveBonusTriggerAwardStratification(
  cfg: BonusTriggerAwardStratificationConfig,
): BonusTriggerAwardStratificationResult {
  validateConfig(cfg);
  const N = cfg.reelCount;
  const q = cfg.scatterProbabilityPerReel;
  const Smin = cfg.minScattersForTrigger;

  // Build sorted award map: scatterCount → freeSpinsAward
  const awardMap = new Map<number, number>();
  for (const t of cfg.awardTiers) {
    awardMap.set(t.scatterCount, t.freeSpinsAward);
  }

  // Scatter count PMF (length N+1, indexed by s = 0..N)
  const scatterPmf: number[] = new Array(N + 1).fill(0);
  for (let s = 0; s <= N; s++) {
    scatterPmf[s] = binomialPmf(N, q, s);
  }

  // P(trigger)
  let pTrigger = 0;
  for (let s = Smin; s <= N; s++) {
    pTrigger += scatterPmf[s];
  }

  // Conditional moments E[K | trigger] and Var[K | trigger]
  let eKgivenTrigger = 0;
  let eK2givenTrigger = 0;
  // Unconditional sum: Σ K(s) · P(S = s)
  let eKunconditional = 0;
  let eK2unconditional = 0;

  // Tier breakdown conditional
  const tierBreakdown: number[] = [];
  for (let s = Smin; s <= N; s++) {
    const K = awardMap.get(s) ?? 0;
    const pS = scatterPmf[s];
    const pSgivenTrigger = pTrigger > 1e-15 ? pS / pTrigger : 0;
    tierBreakdown.push(pSgivenTrigger);
    eKgivenTrigger += K * pSgivenTrigger;
    eK2givenTrigger += K * K * pSgivenTrigger;
    eKunconditional += K * pS;
    eK2unconditional += K * K * pS;
  }
  const varKgivenTrigger = Math.max(0, eK2givenTrigger - eKgivenTrigger * eKgivenTrigger);

  // probMaxScatterTier = P(S = N | trigger)
  const probMaxScatter = pTrigger > 1e-15 ? scatterPmf[N] / pTrigger : 0;

  return {
    reelCount: N,
    scatterProbabilityPerReel: q,
    minScattersForTrigger: Smin,
    scatterCountPmf: scatterPmf,
    probTriggerPerSpin: pTrigger,
    oneInNTriggerFrequency: pTrigger > 1e-15 ? 1 / pTrigger : Infinity,
    expectedAwardGivenTrigger: eKgivenTrigger,
    varianceAwardGivenTrigger: varKgivenTrigger,
    expectedFreeSpinsAwardedPerSpin: eKunconditional,
    probTierBreakdownConditional: tierBreakdown,
    probMaxScatterTier: probMaxScatter,
  };
}

// ── MC reference ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateBonusTriggerAwardStratification(
  cfg: BonusTriggerAwardStratificationConfig,
  spins: number,
  seed: number,
): BonusTriggerAwardStratificationMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(spins) || spins < 1) {
    throw new Error(`Invalid spins: ${spins}`);
  }
  const rng = mulberry32(seed);
  const N = cfg.reelCount;
  const q = cfg.scatterProbabilityPerReel;
  const Smin = cfg.minScattersForTrigger;

  const awardMap = new Map<number, number>();
  for (const t of cfg.awardTiers) {
    awardMap.set(t.scatterCount, t.freeSpinsAward);
  }

  const tierCounts: number[] = new Array(N - Smin + 1).fill(0);
  let triggerCount = 0;
  let totalScatters = 0;
  let totalAwardGivenTrigger = 0;
  let totalAwardUnconditional = 0;

  for (let spin = 0; spin < spins; spin++) {
    // Sample scatter count S ~ Binomial(N, q)
    let s = 0;
    for (let r = 0; r < N; r++) {
      if (rng() < q) s += 1;
    }
    totalScatters += s;
    if (s >= Smin) {
      triggerCount += 1;
      const K = awardMap.get(s) ?? 0;
      totalAwardGivenTrigger += K;
      totalAwardUnconditional += K;
      tierCounts[s - Smin] += 1;
    }
  }

  const tierFractions = tierCounts.map((c) => (triggerCount > 0 ? c / triggerCount : 0));

  return {
    spins,
    observedTriggerFraction: triggerCount / spins,
    observedMeanScattersPerSpin: totalScatters / spins,
    observedMeanAwardGivenTrigger: triggerCount > 0 ? totalAwardGivenTrigger / triggerCount : 0,
    observedMeanFreeSpinsAwardedPerSpin: totalAwardUnconditional / spins,
    observedTierFractions: tierFractions,
  };
}
