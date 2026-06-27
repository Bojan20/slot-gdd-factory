/**
 * W152 Wave 49 — N-tier H&W Jackpot Ladder closed-form solver.
 *
 * Closes Faza 5 sales-blocker:
 *   ⚠️ Money-symbol H&W + multi-tier jackpot ladder — coins+tier kombinovan.
 *   (generic 2-tier H&W coin ✅; full N-tier ladder coverage ❌)
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Pattern P-002 / P-003 from `docs/INDUSTRY_PATTERN_CATALOG.md`:
 * "Persistent-Grid Cash-Collect" combined with "Multi-Tier Pool Jackpot".
 * Money symbols land on cells, stay sticky, and the FINAL number of filled
 * cells maps onto a ladder of N tier payouts. Player additionally collects
 * the sum of cash values displayed on landed symbols.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * State: (respinsRemaining, filledPositions).
 * Initial state: (initialRespins, initialFilled), where initialFilled is the
 * trigger threshold (e.g. 6 bonus symbols on a 5×4 = 20 grid).
 *
 * Transition rule from (r, f) with empty = G − f positions:
 *
 *   k ~ Binomial(G − f, pLand)  — number of new money symbols this respin
 *
 *   • k = 0   → (r−1, f); absorbs to TERM(f) if r−1 = 0
 *   • k > 0 with resetOnLanding=true:
 *       — if f+k = G   → absorbs to TERM(G) (full-grid)
 *       — else          → (initialRespins, f+k)  (respins reset)
 *   • k > 0 with resetOnLanding=false:
 *       — if f+k = G   → absorbs to TERM(G)
 *       — else          → (r−1, f+k); absorbs to TERM(f+k) if r−1 = 0
 *
 * Cash value collected on a k-landing is k × E[V] where V is sampled from
 * the cashValueDistribution. Closed-form treats expected contributions
 * additively (linearity of expectation).
 *
 * ── The ladder ────────────────────────────────────────────────────────────
 * Tiers given as `[{id, threshold, payoutX}, ...]` ascending by threshold.
 * Player wins THE HIGHEST tier whose threshold ≤ final filled.
 *
 * For example with G = 20 and tiers
 *   [{MINI, 12, 25}, {MINOR, 15, 100}, {MAJOR, 18, 500}, {GRAND, 20, 2000}]:
 *
 *   final F = 19 → MAJOR (highest threshold ≤ 19 is 18 → 500×)
 *   final F = 11 → no tier
 *
 * Total feature payout = ladder_payout(F) + Σ collected cash values.
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * Forward propagate (probability, prob × E[cumulative_cash]) through state
 * graph in topological order (filled ascending; within same filled, respins
 * descending). All transitions are strictly forward (filled never decreases;
 * within same filled, respins strictly decrease) → no cycles.
 *
 * Output includes per-tier probabilities, filled-termination PMF, expected
 * cash value, expected ladder payout, composite expected feature payout,
 * expected respins consumed.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * `simulateLadderJackpot` MC reference solver included for cross-validation.
 * Acceptance script `scripts/hnw-ladder-acceptance.mjs` runs 6 synthetic
 * configs × 250K MC spinova and asserts MC vs closed-form within ±1.5%
 * relative error on every metric.
 *
 * ── Naming policy (clean-room) ────────────────────────────────────────────
 * "Ladder jackpot" is a generic descriptive term for mechanic class.
 * No vendor-marker symbols (verified by `check-reserved-terms.sh`).
 *
 * ── References ────────────────────────────────────────────────────────────
 * Cabot & Hannum 2002 (Practical Casino Math): jackpot pool theory.
 * Norris 1997 (Markov Chains): absorbing chains, first-passage distrib.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface LadderTier {
  /** Stable identifier (e.g. "MINI", "MINOR", "MAJOR", "GRAND"). */
  id: string;
  /** Minimum filled positions to qualify for this tier. 1 ≤ threshold ≤ gridSize. */
  threshold: number;
  /** Tier payout as multiplier of base bet (X). */
  payoutX: number;
}

export interface CashOutcome {
  /** Cash value displayed on landed symbol, as multiplier of base bet. */
  valueX: number;
  /** Weight in discrete distribution (any positive number). */
  weight: number;
}

export interface LadderJackpotConfig {
  /** Total cells in the grid (rows × cols). */
  gridSize: number;
  /** Respins awarded on trigger AND awarded on landing if resetOnLanding=true. */
  initialRespins: number;
  /** Per-cell per-respin probability a money symbol lands on an empty cell. */
  pLand: number;
  /** Number of cells already filled at the moment of trigger. */
  initialFilled: number;
  /** Discrete distribution of cash values on landed symbols. */
  cashValueDistribution: CashOutcome[];
  /** Tier ladder, ascending by threshold. */
  tiers: LadderTier[];
  /** When true, respins are reset to initialRespins on any landing. */
  resetOnLanding: boolean;
  /** Cash value (in X) already collected by trigger symbols at start (default 0). */
  initialCashValueX?: number;
}

export interface LadderJackpotResult {
  expectedCashValueX: number;
  expectedTierPayoutX: number;
  expectedTotalX: number;
  expectedFilled: number;
  expectedRespins: number;
  /** P(final tier = id), for every tier + "NONE" pseudo-tier. */
  tierProbabilities: Array<{ id: string; threshold: number; probability: number }>;
  /** PMF of final filled count, indexed by `filled` value. */
  filledTerminationPmf: Array<{ filled: number; probability: number }>;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validate(cfg: LadderJackpotConfig): void {
  if (!Number.isInteger(cfg.gridSize) || cfg.gridSize <= 0) {
    throw new Error(`gridSize must be positive integer, got ${cfg.gridSize}`);
  }
  if (!Number.isInteger(cfg.initialRespins) || cfg.initialRespins <= 0) {
    throw new Error(`initialRespins must be positive integer, got ${cfg.initialRespins}`);
  }
  if (cfg.pLand <= 0 || cfg.pLand >= 1) {
    throw new Error(`pLand must be in (0,1), got ${cfg.pLand}`);
  }
  if (!Number.isInteger(cfg.initialFilled) || cfg.initialFilled < 0 || cfg.initialFilled > cfg.gridSize) {
    throw new Error(`initialFilled must be integer in [0,gridSize=${cfg.gridSize}], got ${cfg.initialFilled}`);
  }
  if (cfg.initialFilled === cfg.gridSize) {
    throw new Error(`initialFilled equals gridSize — feature already terminal`);
  }
  if (!Array.isArray(cfg.cashValueDistribution) || cfg.cashValueDistribution.length === 0) {
    throw new Error(`cashValueDistribution must be non-empty array`);
  }
  for (const o of cfg.cashValueDistribution) {
    if (!Number.isFinite(o.valueX) || o.valueX < 0) {
      throw new Error(`cashValueDistribution: every valueX must be non-negative finite`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`cashValueDistribution: every weight must be positive finite`);
    }
  }
  if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) {
    throw new Error(`tiers must be non-empty array`);
  }
  let prevTh = 0;
  const seenIds = new Set<string>();
  for (const t of cfg.tiers) {
    if (typeof t.id !== 'string' || t.id.length === 0) {
      throw new Error(`tier.id must be non-empty string`);
    }
    if (seenIds.has(t.id)) {
      throw new Error(`duplicate tier id "${t.id}"`);
    }
    seenIds.add(t.id);
    if (t.id === 'NONE') {
      throw new Error(`tier.id "NONE" is reserved`);
    }
    if (!Number.isInteger(t.threshold) || t.threshold <= 0 || t.threshold > cfg.gridSize) {
      throw new Error(`tier "${t.id}": threshold must be integer in [1,gridSize=${cfg.gridSize}], got ${t.threshold}`);
    }
    if (t.threshold <= prevTh) {
      throw new Error(`tier "${t.id}": threshold ${t.threshold} must be strictly greater than previous (${prevTh})`);
    }
    prevTh = t.threshold;
    if (!Number.isFinite(t.payoutX) || t.payoutX < 0) {
      throw new Error(`tier "${t.id}": payoutX must be non-negative finite`);
    }
  }
  if (cfg.initialCashValueX !== undefined) {
    if (!Number.isFinite(cfg.initialCashValueX) || cfg.initialCashValueX < 0) {
      throw new Error(`initialCashValueX must be non-negative finite`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mean of the cash value distribution. */
export function expectedCashPerSymbol(dist: CashOutcome[]): number {
  let totalW = 0;
  let totalV = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalV += o.weight * o.valueX;
  }
  return totalV / totalW;
}

/** Tier payout for a given final filled count (highest threshold ≤ F). */
export function tierPayoutForFilled(filled: number, tiers: LadderTier[]): { id: string; payoutX: number } {
  let best: { id: string; payoutX: number } = { id: 'NONE', payoutX: 0 };
  for (const t of tiers) {
    if (filled >= t.threshold) best = { id: t.id, payoutX: t.payoutX };
  }
  return best;
}

/** Binomial PMF: P(K = k | n trials, p success). */
function binomPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (n === 0) return k === 0 ? 1 : 0;
  // Use log-space for stability on larger n
  let logC = 0;
  for (let i = 0; i < k; i++) {
    logC += Math.log(n - i) - Math.log(i + 1);
  }
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

// ── Closed-form solver ─────────────────────────────────────────────────────

/**
 * Solve the N-tier ladder closed-form via forward propagation on
 * (respins, filled) state graph. Returns expected EV split by tier
 * vs cash component, with full PMFs.
 */
export function solveLadderJackpot(config: LadderJackpotConfig): LadderJackpotResult {
  validate(config);

  const G = config.gridSize;
  const R0 = config.initialRespins;
  const p = config.pLand;
  const fInit = config.initialFilled;
  const eV = expectedCashPerSymbol(config.cashValueDistribution);
  const initCash = config.initialCashValueX ?? 0;

  // State key: r * (G+1) + f
  const key = (r: number, f: number) => r * (G + 1) + f;
  // prob[key] = P(reach state (r,f))
  // ev[key]   = E[cumulative cash collected × indicator(reach (r,f))]
  const prob = new Float64Array((R0 + 1) * (G + 1));
  const ev = new Float64Array((R0 + 1) * (G + 1));
  // termFilledProb[f] = P(terminate with exactly f filled)
  const termFilledProb = new Float64Array(G + 1);
  // termFilledEV[f] = E[cash collected × indicator(terminate at f)]
  const termFilledEV = new Float64Array(G + 1);
  // Expected respins consumed (each visit to (r,f) for r ∈ [1..R0], f ∈ [fInit..G-1] consumes 1 respin)
  let expectedRespinsConsumed = 0;

  prob[key(R0, fInit)] = 1;
  ev[key(R0, fInit)] = initCash;

  // Iterate filled ascending, within same filled iterate respins descending
  for (let f = fInit; f < G; f++) {
    for (let r = R0; r >= 1; r--) {
      const k0 = key(r, f);
      const pHere = prob[k0];
      if (pHere === 0) continue;
      const eHere = ev[k0];

      // Each respin consumed at this state
      expectedRespinsConsumed += pHere;

      const empty = G - f;

      // k = 0 (no landing)
      const p0 = binomPmf(empty, 0, p);
      const flow0 = pHere * p0;
      const evFlow0 = eHere * p0; // no value added
      if (r === 1) {
        termFilledProb[f] += flow0;
        termFilledEV[f] += evFlow0;
      } else {
        const k1 = key(r - 1, f);
        prob[k1] += flow0;
        ev[k1] += evFlow0;
      }

      // k > 0 (landings)
      for (let kLand = 1; kLand <= empty; kLand++) {
        const pK = binomPmf(empty, kLand, p);
        if (pK === 0) continue;
        const flow = pHere * pK;
        const evContrib = kLand * eV; // expected cash added this transition
        // Expected cumulative cash on path: eHere + evContrib (per unit prob)
        const evFlow = eHere * pK + pHere * pK * evContrib;
        const fNew = f + kLand;
        if (fNew === G) {
          termFilledProb[G] += flow;
          termFilledEV[G] += evFlow;
        } else if (config.resetOnLanding) {
          const kReset = key(R0, fNew);
          prob[kReset] += flow;
          ev[kReset] += evFlow;
        } else {
          if (r === 1) {
            termFilledProb[fNew] += flow;
            termFilledEV[fNew] += evFlow;
          } else {
            const kNext = key(r - 1, fNew);
            prob[kNext] += flow;
            ev[kNext] += evFlow;
          }
        }
      }
    }
  }

  // Compose outputs
  const filledTerminationPmf: Array<{ filled: number; probability: number }> = [];
  let totalCashEV = 0;
  let totalTierEV = 0;
  let expectedFilled = 0;
  const tierProbAcc: Record<string, number> = { NONE: 0 };
  for (const t of config.tiers) tierProbAcc[t.id] = 0;

  for (let f = fInit; f <= G; f++) {
    const pf = termFilledProb[f];
    if (pf === 0) continue;
    filledTerminationPmf.push({ filled: f, probability: pf });
    expectedFilled += f * pf;
    totalCashEV += termFilledEV[f];
    const { id, payoutX } = tierPayoutForFilled(f, config.tiers);
    tierProbAcc[id] += pf;
    totalTierEV += pf * payoutX;
  }

  const tierProbabilities: LadderJackpotResult['tierProbabilities'] = [
    { id: 'NONE', threshold: 0, probability: tierProbAcc.NONE },
    ...config.tiers.map((t) => ({ id: t.id, threshold: t.threshold, probability: tierProbAcc[t.id] })),
  ];

  return {
    expectedCashValueX: totalCashEV,
    expectedTierPayoutX: totalTierEV,
    expectedTotalX: totalCashEV + totalTierEV,
    expectedFilled,
    expectedRespins: expectedRespinsConsumed,
    tierProbabilities,
    filledTerminationPmf,
  };
}

// ── Monte Carlo reference solver (for cross-validation) ─────────────────────

/**
 * Mulberry32-based deterministic PRNG suitable for MC verification only.
 * Not for production RNG — production uses the engine's RNG framework.
 */
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

function sampleCashValue(dist: CashOutcome[], rng: () => number): number {
  let total = 0;
  for (const o of dist) total += o.weight;
  let r = rng() * total;
  for (const o of dist) {
    r -= o.weight;
    if (r < 0) return o.valueX;
  }
  return dist[dist.length - 1].valueX;
}

function sampleBinomial(n: number, p: number, rng: () => number): number {
  // For small n this is fastest as a direct sum of Bernoullis.
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}

export interface LadderMCResult {
  expectedCashValueX: number;
  expectedTierPayoutX: number;
  expectedTotalX: number;
  expectedFilled: number;
  expectedRespins: number;
  tierProbabilities: Record<string, number>;
  spins: number;
}

/** Monte Carlo simulator for the ladder feature (verification, NOT engine path). */
export function simulateLadderJackpot(config: LadderJackpotConfig, spins: number, seed: number): LadderMCResult {
  validate(config);
  const rng = makePrng(seed);
  let totalCash = 0;
  let totalTier = 0;
  let totalFilledSum = 0;
  let totalRespins = 0;
  const tierCounts: Record<string, number> = { NONE: 0 };
  for (const t of config.tiers) tierCounts[t.id] = 0;

  for (let s = 0; s < spins; s++) {
    let respins = config.initialRespins;
    let filled = config.initialFilled;
    let cash = config.initialCashValueX ?? 0;
    let respinsUsed = 0;
    while (respins > 0 && filled < config.gridSize) {
      const empty = config.gridSize - filled;
      const k = sampleBinomial(empty, config.pLand, rng);
      respinsUsed++;
      if (k > 0) {
        for (let i = 0; i < k; i++) cash += sampleCashValue(config.cashValueDistribution, rng);
        filled += k;
        if (filled >= config.gridSize) break;
        if (config.resetOnLanding) {
          respins = config.initialRespins;
        } else {
          respins--;
        }
      } else {
        respins--;
      }
    }
    totalCash += cash;
    totalFilledSum += filled;
    totalRespins += respinsUsed;
    const { id, payoutX } = tierPayoutForFilled(filled, config.tiers);
    totalTier += payoutX;
    tierCounts[id]++;
  }

  const tierProbabilities: Record<string, number> = {};
  for (const [id, c] of Object.entries(tierCounts)) tierProbabilities[id] = c / spins;

  return {
    expectedCashValueX: totalCash / spins,
    expectedTierPayoutX: totalTier / spins,
    expectedTotalX: (totalCash + totalTier) / spins,
    expectedFilled: totalFilledSum / spins,
    expectedRespins: totalRespins / spins,
    tierProbabilities,
    spins,
  };
}
