/**
 * W152 Wave 134 — Hold-and-Win Multi-Tier Value-Based Jackpot (Faza 5 ext, post-W100 roadmap).
 *
 * Closed-form solver za "Hold & Win sa TOTAL-VALUE tier jackpots" mehaniku
 * — Aristocrat Lightning Link / Buffalo Link / IGT Hold & Win / SG Money
 * Burst / Pragmatic Big Bass Hold & Spin. Grid sa K cells, respins R sa
 * reset-on-landing pravilo, money symbols dolaze sa value V ~ valuePmf.
 * Tieri se aktiviraju kada TOTAL accumulated value pređe threshold.
 *
 * Naming policy (clean-room): "hold and win", "money symbol", "tier
 * jackpot" = generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W49 N-tier H&W Ladder Jackpot — tier triggered by FILLED COUNT
 *     (e.g. "fill 12 cells = Major"); ovo je TOTAL VALUE-sum based
 *   • W71 Must-Hit-By Jackpot — fixed-trigger mystery progressive
 *   • W75 Multi-tier WAP — wheel-acceptance, not grid-based
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Grid sa K cells. Initial filled = F_init (typically 0 ili 6 from trigger).
 * Per respin: each EMPTY cell tries to land with probability p (independent).
 * If ANY cell lands → respins reset to R_max. Else → respins decrement by 1.
 * Game ends when respins = 0 (no landing in last respin).
 *
 * Each landed cell gets value V ~ valuePmf (discrete, ≥ 0 in betX units).
 *
 * Final state: (filledCount F_final, totalValue V_total)
 *   F_final ∈ [F_init, K]
 *   V_total | F_final = sum of F_final iid samples from valuePmf
 *
 * Tier triggers (sorted ascending by threshold):
 *   tier_t activates iff V_total ≥ T_t  (or ANY higher tier dominates)
 *
 * ── Math ─────────────────────────────────────────────────────────────────
 * Step 1: Compute P(F_final = k) for k = F_init..K via Markov chain on
 *         (filledCount, respinsRemaining):
 *
 *         transitions from (f, r):
 *           q_land = 1 − (1 − p)^(K − f)   # prob ≥ 1 cell lands this respin
 *           if no landing: → (f, r − 1)
 *           if landing (j ≥ 1 cells), j ~ Binomial(K − f, p) | j ≥ 1:
 *             → (f + j, R_max)             # reset respins
 *
 *         Absorbing state: (k, 0) ∀k — collect P(absorbed at filled = k).
 *
 * Step 2: Conditional value distribution given F_final = k:
 *         V_total | F_final = k ~ k-fold convolution of valuePmf
 *         Use discrete convolution sa Map<value, prob>.
 *
 * Step 3: For each tier T_t:
 *         P(tier t reached) = Σ_k P(F_final = k) · P(V_total ≥ T_t | F=k)
 *         P(EXACTLY tier t) = P(reach t) − P(reach t+1) (for sorted)
 *
 * Step 4: E[total value] = Σ_k P(F=k) · k · E[V]
 *                       (alternativno: E[V_total | F=k] · P(F=k))
 *
 * Industry compliance:
 *   • UKGC RTS 14 — per-tier hit probability + variance disclosure
 *   • MGA PPD §11.f — operator-facing jackpot hit rate
 *   • eCOGRA Generic Slots Audit — verifies tier probs match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateHoldWinValueJackpot() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface ValuePmfEntry {
  /** Money-symbol value in betX units (≥ 0). */
  value: number;
  /** Probability this value lands when symbol drops (0 ≤ p ≤ 1). */
  probability: number;
}

export interface JackpotTierConfig {
  /** Tier label (e.g. 'mini', 'major', 'mega'). */
  label: string;
  /** Threshold: total value V_total ≥ thresholdX activates this tier. */
  thresholdX: number;
  /** Optional bonus payout for this tier (separate from accumulated cash). */
  bonusPayoutX?: number;
}

export interface HoldWinValueJackpotConfig {
  /** Grid cell count (positive integer ≥ 1). */
  gridCells: number;
  /** Initial filled cells (typically 0 ili 6 for trigger preset). */
  initialFilledCells: number;
  /** Per-cell-per-respin landing probability (0 < p ≤ 1). */
  landingProbabilityPerCell: number;
  /** Max respins (resets on any landing). */
  maxRespins: number;
  /** Money-symbol value PMF (sum ≈ 1). */
  valuePmf: ValuePmfEntry[];
  /** Tier definitions (sorted ascending by threshold internally). */
  tiers: JackpotTierConfig[];
  /** Bonus payout when grid fully filled (typically Grand Jackpot). */
  fullGridBonusX?: number;
  /** Truncation cap for value convolution PMF (default 10× max threshold). */
  valueConvolutionCap?: number;
}

export interface TierProbabilityStats {
  label: string;
  thresholdX: number;
  probReachTier: number;     // P(V_total ≥ threshold)
  probExactlyTier: number;   // P(this is HIGHEST tier reached)
  bonusPayoutX?: number;
}

export interface HoldWinValueJackpotResult {
  gridCells: number;
  initialFilledCells: number;
  maxRespins: number;
  // Filled count distribution
  probFilledByEnd: number[];   // index k → P(F_final = k)
  expectedFilledCount: number;
  probFullGridReached: number;
  // Value moments (given any filling)
  expectedValuePerCell: number;
  expectedTotalValue: number;  // E[V_total] = E[F]·E[V]
  // Per-tier
  perTier: TierProbabilityStats[];
  probAnyTierReached: number;
  // Bonus
  fullGridBonusX?: number;
  expectedJackpotPayout: number; // E[V_total + tier bonuses + full-grid bonus]
}

export interface HoldWinValueJackpotMCResult {
  episodes: number;
  observedMeanFilledCount: number;
  observedMeanTotalValue: number;
  observedTierHits: Record<string, number>;
  observedFullGridFraction: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: HoldWinValueJackpotConfig): void {
  if (!Number.isInteger(cfg.gridCells) || cfg.gridCells < 1) {
    throw new Error(`gridCells must be integer ≥ 1 (got ${cfg.gridCells})`);
  }
  if (!Number.isInteger(cfg.initialFilledCells) || cfg.initialFilledCells < 0 || cfg.initialFilledCells > cfg.gridCells) {
    throw new Error(`initialFilledCells must be in [0, gridCells] (got ${cfg.initialFilledCells})`);
  }
  const p = cfg.landingProbabilityPerCell;
  if (!Number.isFinite(p) || p <= 0 || p > 1) {
    throw new Error(`landingProbabilityPerCell must be in (0, 1] (got ${p})`);
  }
  if (!Number.isInteger(cfg.maxRespins) || cfg.maxRespins < 1) {
    throw new Error(`maxRespins must be integer ≥ 1 (got ${cfg.maxRespins})`);
  }
  if (!Array.isArray(cfg.valuePmf) || cfg.valuePmf.length === 0) {
    throw new Error(`valuePmf must be non-empty`);
  }
  let sumP = 0;
  for (const e of cfg.valuePmf) {
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`valuePmf.value must be ≥ 0 (got ${e.value})`);
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`valuePmf.probability must be in [0, 1]`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`valuePmf probabilities sum to ${sumP}, must be 1`);
  }
  if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) {
    throw new Error(`tiers must be non-empty`);
  }
  const seenLabel = new Set<string>();
  for (const t of cfg.tiers) {
    if (typeof t.label !== 'string' || t.label.length === 0) {
      throw new Error(`tier.label must be non-empty`);
    }
    if (seenLabel.has(t.label)) throw new Error(`tiers: duplicate label ${t.label}`);
    seenLabel.add(t.label);
    if (!Number.isFinite(t.thresholdX) || t.thresholdX < 0) {
      throw new Error(`tier ${t.label}: thresholdX must be ≥ 0`);
    }
    if (t.bonusPayoutX !== undefined && (!Number.isFinite(t.bonusPayoutX) || t.bonusPayoutX < 0)) {
      throw new Error(`tier ${t.label}: bonusPayoutX must be ≥ 0`);
    }
  }
}

// ── Binomial helper ────────────────────────────────────────────────────────

function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  const kEff = Math.min(k, n - k);
  for (let i = 0; i < kEff; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

function binomPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  return binomCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

// ── Solver ─────────────────────────────────────────────────────────────────

/**
 * Step 1: Markov chain on (filled, respinsRemaining) to compute final filled distribution.
 *
 * State space: filled ∈ [F_init, K], respins ∈ [0, R_max].
 * Forward propagation: start from (F_init, R_max), propagate prob mass.
 * Absorbing: respins = 0 → record P(filled = f).
 */
function computeFilledDistribution(
  cfg: HoldWinValueJackpotConfig,
): number[] {
  const K = cfg.gridCells;
  const R = cfg.maxRespins;
  const p = cfg.landingProbabilityPerCell;
  const F_init = cfg.initialFilledCells;

  // State prob: stateProb[filled][respinsRemaining]
  const stateProb: number[][] = Array.from({ length: K + 1 }, () =>
    new Array<number>(R + 1).fill(0),
  );
  stateProb[F_init][R] = 1;

  // Absorbed distribution (respins = 0)
  const absorbed = new Array<number>(K + 1).fill(0);

  // Process states in order of decreasing respins, increasing filled (topological)
  // Use BFS-style queue but for max R+1 levels × K+1 filled, total (R+1)·(K+1) ≤ ~1000.
  // Iterate until all states drained.
  let progress = true;
  let iter = 0;
  const maxIter = (R + 1) * (K + 1) * 10; // safety cap
  while (progress && iter < maxIter) {
    progress = false;
    iter++;
    for (let f = F_init; f <= K; f++) {
      for (let r = R; r >= 1; r--) {
        const pf = stateProb[f][r];
        if (pf <= 0) continue;
        progress = true;
        stateProb[f][r] = 0; // mark processed

        if (f === K) {
          // Full grid — no more cells to fill. Game continues without new landings.
          // Absorbed when respins reach 0 (or earlier; full grid usually triggers
          // immediate game end, but here we let it cascade to absorbed = (K, 0)).
          absorbed[K] += pf;
          continue;
        }

        const emptyCells = K - f;
        const probNoLanding = Math.pow(1 - p, emptyCells);

        // No-landing branch: → (f, r - 1)
        if (r - 1 === 0) {
          absorbed[f] += pf * probNoLanding;
        } else {
          stateProb[f][r - 1] += pf * probNoLanding;
        }

        // Landing branches: j = 1..emptyCells cells land
        // Each j-landing has prob C(emptyCells, j) · p^j · (1-p)^(emptyCells-j)
        // Then respins reset to R.
        for (let j = 1; j <= emptyCells; j++) {
          const probLandJ = binomPmf(emptyCells, j, p);
          if (probLandJ < 1e-15) continue;
          stateProb[f + j][R] += pf * probLandJ;
        }
      }
    }
  }
  // Sanity: any leftover prob at non-absorbed states (shouldn't happen)
  let totalAbsorbed = 0;
  for (let f = 0; f <= K; f++) totalAbsorbed += absorbed[f];
  if (Math.abs(totalAbsorbed - 1) > 1e-6) {
    // Normalize for numerical stability
    const norm = totalAbsorbed > 0 ? 1 / totalAbsorbed : 1;
    for (let f = 0; f <= K; f++) absorbed[f] *= norm;
  }
  return absorbed;
}

/**
 * Step 2: k-fold convolution of valuePmf. Returns sparse Map<value, prob>.
 * Capped at `cap` to bound state space.
 */
function convolveValuePmf(
  basePmf: ValuePmfEntry[],
  k: number,
  cap: number,
): Map<number, number> {
  if (k === 0) return new Map<number, number>([[0, 1]]);
  let acc = new Map<number, number>();
  for (const e of basePmf) acc.set(e.value, (acc.get(e.value) ?? 0) + e.probability);

  for (let i = 1; i < k; i++) {
    const next = new Map<number, number>();
    for (const [v1, p1] of acc) {
      for (const e of basePmf) {
        const v = v1 + e.value;
        if (v > cap) continue;
        next.set(v, (next.get(v) ?? 0) + p1 * e.probability);
      }
    }
    acc = next;
  }
  return acc;
}

/** Tail probability P(V ≥ threshold) from value pmf. */
function tailProb(pmf: Map<number, number>, threshold: number): number {
  let sum = 0;
  for (const [v, p] of pmf) if (v >= threshold) sum += p;
  return Math.max(0, Math.min(1, sum));
}

export function solveHoldWinValueJackpot(
  config: HoldWinValueJackpotConfig,
): HoldWinValueJackpotResult {
  validate(config);
  const K = config.gridCells;
  const F_init = config.initialFilledCells;

  // Sort tiers ascending by threshold for "exactly this tier" computation
  const sortedTiers = [...config.tiers].sort((a, b) => a.thresholdX - b.thresholdX);

  // Compute filled distribution
  const probFilled = computeFilledDistribution(config);

  // Expected filled count
  let eF = 0;
  for (let k = 0; k <= K; k++) eF += k * probFilled[k];
  const probFullGrid = probFilled[K];

  // Value PMF moments
  let eV = 0;
  for (const e of config.valuePmf) eV += e.value * e.probability;

  // For each tier, accumulate P(reach) = Σ_k P(F=k) · P(V_total ≥ T | k)
  const maxThreshold = sortedTiers[sortedTiers.length - 1].thresholdX;
  const cap = config.valueConvolutionCap ?? Math.max(maxThreshold * 10, 1000);

  // Precompute value convolution PMFs for newly-landed cells (k - F_init).
  // Industry semantics: only NEWLY landed cells in respin phase get money values;
  // trigger cells are positional, no cash value (or already collected pre-feature).
  const valuePmfByK: Map<number, Map<number, number>> = new Map();
  for (let k = F_init; k <= K; k++) {
    if (probFilled[k] > 1e-15) {
      const newlyLanded = k - F_init;
      valuePmfByK.set(k, convolveValuePmf(config.valuePmf, newlyLanded, cap));
    }
  }

  const tierReachProbs: number[] = [];
  for (const t of sortedTiers) {
    let p = 0;
    for (let k = F_init; k <= K; k++) {
      const pmfK = valuePmfByK.get(k);
      if (!pmfK) continue;
      p += probFilled[k] * tailProb(pmfK, t.thresholdX);
    }
    tierReachProbs.push(Math.max(0, Math.min(1, p)));
  }

  // P(EXACTLY tier t) = P(reach t) − P(reach t+1)
  const perTier: TierProbabilityStats[] = [];
  for (let i = 0; i < sortedTiers.length; i++) {
    const reach = tierReachProbs[i];
    const reachNext = i + 1 < sortedTiers.length ? tierReachProbs[i + 1] : 0;
    perTier.push({
      label: sortedTiers[i].label,
      thresholdX: sortedTiers[i].thresholdX,
      probReachTier: reach,
      probExactlyTier: Math.max(0, reach - reachNext),
      bonusPayoutX: sortedTiers[i].bonusPayoutX,
    });
  }

  const probAnyTier = tierReachProbs.length > 0 ? tierReachProbs[0] : 0;
  // E[V_total] = E[newlyLanded] · E[V] = (E[F] − F_init) · E[V]
  const totalValue = (eF - F_init) * eV;

  // E[jackpot payout] = E[V_total] + Σ_t P(exactly tier t) · bonusPayoutX_t + P(fullGrid) · fullGridBonusX
  let eJackpot = totalValue;
  for (const t of perTier) {
    if (t.bonusPayoutX) eJackpot += t.probExactlyTier * t.bonusPayoutX;
  }
  if (config.fullGridBonusX) eJackpot += probFullGrid * config.fullGridBonusX;

  return {
    gridCells: K,
    initialFilledCells: F_init,
    maxRespins: config.maxRespins,
    probFilledByEnd: probFilled,
    expectedFilledCount: eF,
    probFullGridReached: probFullGrid,
    expectedValuePerCell: eV,
    expectedTotalValue: totalValue,
    perTier,
    probAnyTierReached: probAnyTier,
    fullGridBonusX: config.fullGridBonusX,
    expectedJackpotPayout: eJackpot,
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

function sampleValue(pmf: ValuePmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

export function simulateHoldWinValueJackpot(
  config: HoldWinValueJackpotConfig,
  episodes: number,
  seed: number,
): HoldWinValueJackpotMCResult {
  validate(config);
  const rng = makePrng(seed);
  const K = config.gridCells;
  const p = config.landingProbabilityPerCell;
  const R = config.maxRespins;
  const sortedTiers = [...config.tiers].sort((a, b) => a.thresholdX - b.thresholdX);

  const tierHits: Record<string, number> = {};
  for (const t of sortedTiers) tierHits[t.label] = 0;

  let sumFilled = 0;
  let sumValue = 0;
  let fullGridCount = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let filled = config.initialFilledCells;
    let respins = R;
    let totalValue = 0;

    while (respins > 0 && filled < K) {
      // Try each empty cell
      let landedThisRespin = 0;
      const empty = K - filled;
      for (let i = 0; i < empty; i++) {
        if (rng() < p) {
          landedThisRespin++;
          totalValue += sampleValue(config.valuePmf, rng());
        }
      }
      if (landedThisRespin > 0) {
        filled += landedThisRespin;
        respins = R; // reset
      } else {
        respins--;
      }
    }

    sumFilled += filled;
    sumValue += totalValue;
    if (filled === K) fullGridCount++;

    // Tier achievements
    for (const t of sortedTiers) {
      if (totalValue >= t.thresholdX) tierHits[t.label]++;
    }
  }

  return {
    episodes,
    observedMeanFilledCount: sumFilled / episodes,
    observedMeanTotalValue: sumValue / episodes,
    observedTierHits: tierHits,
    observedFullGridFraction: fullGridCount / episodes,
  };
}
