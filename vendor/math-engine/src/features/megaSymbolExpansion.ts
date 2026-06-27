/**
 * W152 Wave 123 — Mega Symbol Multi-Cell Expansion Aggregator (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "super-symbol multi-cell expansion" mehaniku —
 * NetEnt Mega Joker / Slot Mountain Megaways jumbo / Pragmatic Sweet
 * Bonanza super-symbols / Push Gaming Razor Shark jumbo blocks / BTG
 * Megaways multi-cell variants. Super-symbol drops sa probability,
 * pokriva S × S area na gridu, supstituira base simbol sa target
 * symbolom S ~ targetPmf.
 *
 * Naming policy (clean-room): "mega symbol", "multi-cell expansion",
 * "super-symbol" = generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W47 Walking Wild — single wild moves position-by-position
 *   • W91 Coin Accumulator — collected money symbols, no area coverage
 *   • W93 Multiplicative Wild Stack — product of wilds, no expansion
 *   • W101 Symbol Upgrade Chain — single symbol upgrades through stages
 *   • W114 Sticky Wild Countdown — single 1×1 sticky wild
 *   • W116 Mystery Symbol Reveal — K positions reveal same symbol, no area
 *   • W118 Bonus Collect-N — collect threshold, no area
 *   • W121 Cascade Multiplier Chain — multiplier on win chain, no area
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin, K independent super-symbol drops:
 *   K ~ countPmf (e.g. 0 with high prob, 1 with moderate, ≥2 rare)
 *
 * Per super-symbol (given drop):
 *   • Size S ~ sizePmf (1=normal cell, 2=2×2 block, 3=3×3, ...)
 *   • Target symbol T ~ targetPmf with payoutX per covered cell
 *
 * Independence assumption (cross-drop, drop-size-target):
 *   K ⊥ S_i ⊥ T_i (i.e. all three random variables independent)
 *
 * Per-spin payout:
 *   Y = Σ_{i=1..K} S_i² · paytable[T_i]
 *
 * Closed-form moments (cross-independence):
 *   E[S²]   = Σ s²·sizePmf[s]
 *   E[S⁴]   = Σ s⁴·sizePmf[s]
 *   E[paytable[T]] = Σ pmf[t]·payoutX[t]
 *   E[paytable[T]²] = Σ pmf[t]·payoutX[t]²
 *
 *   E[Y]   = E[K] · E[S²] · E[paytable[T]]
 *   E[Y²]  = E[(Σ S_i²·paytable[T_i])²]
 *          = E[K²·(S²·paytable)² avg] (NB: K is RV, S and T per-drop iid)
 *          = E[K]·E[S⁴·paytable²] + E[K(K-1)]·E[S²·paytable]²
 *          = E[K]·E[S⁴]·E[paytable²] + (E[K²]−E[K])·(E[S²]·E[paytable])²
 *   Var[Y] = E[Y²] − E[Y]²
 *
 * Tail / disclosure:
 *   • probZeroDrop = P(K=0)
 *   • maxSize = max(supp(sizePmf))
 *   • maxSymbolPay = max payoutX
 *   • maxCellsCovered = K_max · maxSize² (bounded by grid)
 *   • probMaxConfig = P(K=K_max) · P(S=maxSize)^K_max · P(T=maxSymbol)^K_max
 *
 * Industry compliance:
 *   • UKGC RTS 14 — variance + tail-coverage disclosure
 *   • MGA PPD §11.f — operator-facing super-symbol-rate disclosure
 *   • eCOGRA Generic Slots Audit — verifies E[Y] / Var[Y] match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateMegaSymbolExpansion() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface MegaCountPmfEntry {
  /** Number of super-symbol drops this spin (non-negative integer). */
  count: number;
  /** Probability of this count (0 ≤ p ≤ 1). */
  probability: number;
}

export interface SizePmfEntry {
  /** Side length of super-symbol (positive integer 1 = 1×1, 2 = 2×2, ...). */
  size: number;
  /** Probability of this size (0 ≤ p ≤ 1). */
  probability: number;
}

export interface TargetSymbolPmfEntry {
  /** Symbol label (e.g. 'wild', 'jackpot', 'multiplier_5x'). */
  label: string;
  /** Per-cell payout for this target symbol (≥ 0). */
  payoutX: number;
  /** Probability this symbol is the target (0 ≤ p ≤ 1). */
  probability: number;
}

export interface MegaSymbolExpansionConfig {
  /** Discrete PMF of drop count per spin (sum ≈ 1). */
  countPmf: MegaCountPmfEntry[];
  /** Discrete PMF of super-symbol side length (sum ≈ 1). */
  sizePmf: SizePmfEntry[];
  /** Discrete PMF of target symbol (sum ≈ 1). */
  targetPmf: TargetSymbolPmfEntry[];
}

export interface MegaSymbolExpansionResult {
  // Count moments
  expectedDropCount: number;
  varianceDropCount: number;
  probZeroDropCount: number;
  maxDropCount: number;
  // Size moments (S² is per-drop area)
  expectedSize: number;
  expectedSizeSquared: number;      // E[S²]
  expectedSizeFourth: number;       // E[S⁴]
  maxSize: number;
  maxArea: number;                  // maxSize²
  probHitMaxSize: number;
  // Target moments
  expectedPayoutPerCell: number;    // E[paytable[T]]
  expectedPayoutPerCellSquared: number; // E[paytable²]
  maxSymbolPayout: number;
  probHitMaxSymbol: number;
  // Per-spin aggregate
  expectedPayoutPerSpin: number;
  expectedPayoutPerSpinSquared: number;
  variancePayoutPerSpin: number;
  // Joint extreme
  probMaxConfig: number;            // P(K=K_max AND all drops are max-size + max-target)
  maxPossibleCellsCovered: number;  // K_max · maxSize²
}

export interface MegaSymbolExpansionMCResult {
  spins: number;
  observedMeanDropCount: number;
  observedMeanPayoutPerSpin: number;
  observedVariancePayoutPerSpin: number;
  observedZeroDropFraction: number;
  observedMaxSizeSeen: number;
  observedMaxPayoutSeen: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validatePmf<T extends { probability: number }>(
  pmf: T[],
  label: string,
): void {
  if (!Array.isArray(pmf) || pmf.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  let sum = 0;
  for (const e of pmf) {
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`${label}.probability must be in [0, 1] (got ${e.probability})`);
    }
    sum += e.probability;
  }
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`${label} probabilities sum to ${sum}, must be 1`);
  }
}

function validate(cfg: MegaSymbolExpansionConfig): void {
  validatePmf(cfg.countPmf, 'countPmf');
  for (const e of cfg.countPmf) {
    if (!Number.isInteger(e.count) || e.count < 0) {
      throw new Error(`countPmf.count must be non-negative integer (got ${e.count})`);
    }
  }
  const seenCount = new Set<number>();
  for (const e of cfg.countPmf) {
    if (seenCount.has(e.count)) throw new Error(`countPmf: duplicate count ${e.count}`);
    seenCount.add(e.count);
  }

  validatePmf(cfg.sizePmf, 'sizePmf');
  for (const e of cfg.sizePmf) {
    if (!Number.isInteger(e.size) || e.size < 1) {
      throw new Error(`sizePmf.size must be positive integer ≥ 1 (got ${e.size})`);
    }
  }
  const seenSize = new Set<number>();
  for (const e of cfg.sizePmf) {
    if (seenSize.has(e.size)) throw new Error(`sizePmf: duplicate size ${e.size}`);
    seenSize.add(e.size);
  }

  validatePmf(cfg.targetPmf, 'targetPmf');
  const seenLabel = new Set<string>();
  for (const e of cfg.targetPmf) {
    if (typeof e.label !== 'string' || e.label.length === 0) {
      throw new Error(`targetPmf.label must be non-empty string`);
    }
    if (seenLabel.has(e.label)) throw new Error(`targetPmf: duplicate label ${e.label}`);
    seenLabel.add(e.label);
    if (!Number.isFinite(e.payoutX) || e.payoutX < 0) {
      throw new Error(`targetPmf.payoutX must be ≥ 0 (got ${e.payoutX})`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveMegaSymbolExpansion(
  config: MegaSymbolExpansionConfig,
): MegaSymbolExpansionResult {
  validate(config);

  // Count moments
  let eK = 0;
  let eK2 = 0;
  let maxK = -Infinity;
  let pZeroK = 0;
  for (const { count, probability } of config.countPmf) {
    eK += count * probability;
    eK2 += count * count * probability;
    if (count > maxK) maxK = count;
    if (count === 0) pZeroK = probability;
  }
  const varK = Math.max(0, eK2 - eK * eK);

  // Size moments — including E[S²] and E[S⁴]
  let eS = 0;
  let eS2 = 0;
  let eS4 = 0;
  let maxSize = -Infinity;
  for (const { size, probability } of config.sizePmf) {
    eS += size * probability;
    eS2 += size * size * probability;
    eS4 += Math.pow(size, 4) * probability;
    if (size > maxSize) maxSize = size;
  }
  const maxArea = maxSize * maxSize;
  let pMaxSize = 0;
  for (const { size, probability } of config.sizePmf) {
    if (size === maxSize) pMaxSize += probability;
  }

  // Target moments
  let eP = 0;
  let eP2 = 0;
  let maxPayout = -Infinity;
  for (const { payoutX, probability } of config.targetPmf) {
    eP += payoutX * probability;
    eP2 += payoutX * payoutX * probability;
    if (payoutX > maxPayout) maxPayout = payoutX;
  }
  let pHitMaxSym = 0;
  for (const { payoutX, probability } of config.targetPmf) {
    if (payoutX === maxPayout) pHitMaxSym += probability;
  }

  // Per-spin payout aggregate:
  // Y = Σ_{i=1..K} S_i² · paytable[T_i]
  // E[Y] = E[K] · E[S²] · E[paytable[T]]
  const eY = eK * eS2 * eP;

  // E[Y²]:
  // For fixed K=k, E[Y² | K=k] = k·E[S⁴]·E[paytable²] + k(k-1)·(E[S²]·E[paytable])²
  // Taking expectation over K:
  // E[Y²] = E[K]·E[S⁴]·E[paytable²] + E[K(K-1)]·(E[S²]·E[paytable])²
  // E[K(K-1)] = E[K²] − E[K]
  const eY2 = eK * eS4 * eP2 + (eK2 - eK) * Math.pow(eS2 * eP, 2);
  const varY = Math.max(0, eY2 - eY * eY);

  // Joint extreme: P(K=K_max AND all K_max drops are max-size + max-target)
  // = P(K=K_max) · (P(S=maxSize)·P(T=maxSymbol))^K_max
  let pKMaxK = 0;
  for (const { count, probability } of config.countPmf) {
    if (count === maxK) pKMaxK += probability;
  }
  const probMaxConfig = pKMaxK * Math.pow(pMaxSize * pHitMaxSym, maxK);

  return {
    expectedDropCount: eK,
    varianceDropCount: varK,
    probZeroDropCount: pZeroK,
    maxDropCount: maxK,
    expectedSize: eS,
    expectedSizeSquared: eS2,
    expectedSizeFourth: eS4,
    maxSize,
    maxArea,
    probHitMaxSize: pMaxSize,
    expectedPayoutPerCell: eP,
    expectedPayoutPerCellSquared: eP2,
    maxSymbolPayout: maxPayout,
    probHitMaxSymbol: pHitMaxSym,
    expectedPayoutPerSpin: eY,
    expectedPayoutPerSpinSquared: eY2,
    variancePayoutPerSpin: varY,
    probMaxConfig,
    maxPossibleCellsCovered: maxK * maxArea,
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

function sampleCount(pmf: MegaCountPmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.count;
  }
  return pmf[pmf.length - 1].count;
}

function sampleSize(pmf: SizePmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.size;
  }
  return pmf[pmf.length - 1].size;
}

function sampleTarget(pmf: TargetSymbolPmfEntry[], u: number): TargetSymbolPmfEntry {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e;
  }
  return pmf[pmf.length - 1];
}

export function simulateMegaSymbolExpansion(
  config: MegaSymbolExpansionConfig,
  spins: number,
  seed: number,
): MegaSymbolExpansionMCResult {
  validate(config);
  const rng = makePrng(seed);
  let sumK = 0;
  let sumY = 0;
  let sumY2 = 0;
  let zeroCount = 0;
  let maxSizeSeen = 0;
  let maxPayoutSeen = 0;

  for (let t = 0; t < spins; t++) {
    const K = sampleCount(config.countPmf, rng());
    let Y = 0;
    for (let i = 0; i < K; i++) {
      const S = sampleSize(config.sizePmf, rng());
      const T = sampleTarget(config.targetPmf, rng());
      if (S > maxSizeSeen) maxSizeSeen = S;
      Y += S * S * T.payoutX;
    }
    sumK += K;
    sumY += Y;
    sumY2 += Y * Y;
    if (K === 0) zeroCount++;
    if (Y > maxPayoutSeen) maxPayoutSeen = Y;
  }

  const meanY = sumY / spins;
  const varY = Math.max(0, sumY2 / spins - meanY * meanY);

  return {
    spins,
    observedMeanDropCount: sumK / spins,
    observedMeanPayoutPerSpin: meanY,
    observedVariancePayoutPerSpin: varY,
    observedZeroDropFraction: zeroCount / spins,
    observedMaxSizeSeen: maxSizeSeen,
    observedMaxPayoutSeen: maxPayoutSeen,
  };
}
