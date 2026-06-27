/**
 * W152 Wave 116 — Mystery Symbol Reveal Aggregator (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "mystery symbol reveal" mehaniku — Pragmatic Big Bass
 * Bonanza / Wolf Gold / Bigger Bass / NetEnt Wild-O-Tron 3000 / Yggdrasil
 * Vault of Anubis style. Pre-spin, K mystery positions land na grid (K ~
 * discrete PMF); kada spin se otkrije, SVE K se transformišu u IST simbol
 * S ~ symbol PMF (drawn once per spin).
 *
 * Naming policy (clean-room): "mystery symbol", "reveal", "aggregator" =
 * generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W47 Walking Wild — single wild moves position-by-position
 *   • W91 Coin Accumulator — money symbols carry independent values
 *   • W93 Multiplicative Wild Stack — product of co-active wilds
 *   • W101 Symbol Upgrade Chain — single symbol upgrades through stages
 *   • W114 Sticky Wild Countdown — single wild persists with growing mult
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin:
 *   • K ~ countPmf: count of mystery positions landing on grid (k = 0..K_max)
 *   • S ~ symbolPmf: revealed symbol, drawn ONCE per spin (independent of K)
 *   • Per position contribution = paytable[S] (assume each position pays
 *     independently in this simplified model — closed-form upper bound for
 *     line/ways/cluster mechanics; actual grid topology multiplier handled
 *     by composing solver with downstream win-counter).
 *
 * Per-spin payout Y = K · paytable[S].
 *
 * Closed-form moments via cross-independence (K ⊥ S):
 *   E[Y]    = E[K] · E[paytable[S]]
 *   E[Y²]   = E[K²] · E[paytable[S]²]
 *   Var[Y]  = E[K²] · E[paytable[S]²] − E[K]² · E[paytable[S]]²
 *
 * Tail / industry-disclosure metrics:
 *   • P(K = 0)             — probability of no mystery this spin
 *   • P(K = K_max)         — probability of FULL-GRID reveal
 *   • maxSymbolPay         — max payout symbol
 *   • probHitMaxSymbol     — P(S = max payout symbol)
 *   • probFullGridMaxSymbol — P(K = K_max AND S = max) joint
 *   • E[Y | S = s]         — conditional expected payout per revealed symbol
 *
 * Industry compliance:
 *   • UKGC RTS 14 — variance + tail-probability disclosure (P(K=0), P(max))
 *   • MGA PPD §11.f — operator-facing reveal-rate disclosure
 *   • eCOGRA Generic Slots Audit — verifies steady-state E[Y] / Var[Y]
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateMysterySymbolReveal() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface CountPmfEntry {
  /** Number of mystery positions landing this spin (non-negative integer). */
  count: number;
  /** Probability of this count (0 ≤ p ≤ 1). */
  probability: number;
}

export interface SymbolPmfEntry {
  /** Symbol label (e.g. 'fish_10x', 'fish_100x', 'jackpot'). */
  label: string;
  /** Per-position payout for this symbol (in betX units, ≥ 0). */
  payoutX: number;
  /** Probability this symbol is the revealed value (0 ≤ p ≤ 1). */
  probability: number;
}

export interface MysterySymbolRevealConfig {
  /** Discrete PMF of mystery positions per spin (sum ≈ 1). */
  countPmf: CountPmfEntry[];
  /** Discrete PMF of revealed symbol (sum ≈ 1). */
  symbolPmf: SymbolPmfEntry[];
}

export interface MysterySymbolRevealResult {
  // Count metrics
  expectedCount: number;
  varianceCount: number;
  expectedCountSquared: number;
  maxCount: number;
  probZeroCount: number;
  probMaxCount: number;
  // Symbol metrics
  expectedPayoutPerPosition: number;
  expectedPayoutPerPositionSquared: number;
  variancePayoutPerPosition: number;
  maxSymbolPayout: number;
  probHitMaxSymbol: number;
  // Joint payout per spin
  expectedPayoutPerSpin: number;
  expectedPayoutPerSpinSquared: number;
  variancePayoutPerSpin: number;
  // Joint tail
  probFullGridMaxSymbol: number;
  /** Conditional E[Y | S=s] = E[K] · paytable[s], per symbol. */
  conditionalExpectedPayoutBySymbol: Record<string, number>;
}

export interface MysterySymbolRevealMCResult {
  spins: number;
  observedMeanCount: number;
  observedMeanPayoutPerSpin: number;
  observedVariancePayoutPerSpin: number;
  observedZeroCountFraction: number;
  observedMaxCountFraction: number;
  observedMaxPayoutSeen: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: MysterySymbolRevealConfig): void {
  if (!Array.isArray(cfg.countPmf) || cfg.countPmf.length === 0) {
    throw new Error(`countPmf must be non-empty`);
  }
  const seenCount = new Set<number>();
  let sumCountP = 0;
  for (const e of cfg.countPmf) {
    if (!Number.isInteger(e.count) || e.count < 0) {
      throw new Error(`countPmf.count must be non-negative integer (got ${e.count})`);
    }
    if (seenCount.has(e.count)) throw new Error(`countPmf: duplicate count ${e.count}`);
    seenCount.add(e.count);
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`countPmf.probability must be in [0, 1] (got ${e.probability})`);
    }
    sumCountP += e.probability;
  }
  if (Math.abs(sumCountP - 1) > 1e-9) {
    throw new Error(`countPmf probabilities sum to ${sumCountP}, must be 1`);
  }

  if (!Array.isArray(cfg.symbolPmf) || cfg.symbolPmf.length === 0) {
    throw new Error(`symbolPmf must be non-empty`);
  }
  const seenLabel = new Set<string>();
  let sumSymP = 0;
  for (const e of cfg.symbolPmf) {
    if (typeof e.label !== 'string' || e.label.length === 0) {
      throw new Error(`symbolPmf.label must be non-empty string`);
    }
    if (seenLabel.has(e.label)) throw new Error(`symbolPmf: duplicate label ${e.label}`);
    seenLabel.add(e.label);
    if (!Number.isFinite(e.payoutX) || e.payoutX < 0) {
      throw new Error(`symbolPmf.payoutX must be ≥ 0 (got ${e.payoutX})`);
    }
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new Error(`symbolPmf.probability must be in [0, 1] (got ${e.probability})`);
    }
    sumSymP += e.probability;
  }
  if (Math.abs(sumSymP - 1) > 1e-9) {
    throw new Error(`symbolPmf probabilities sum to ${sumSymP}, must be 1`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveMysterySymbolReveal(
  config: MysterySymbolRevealConfig,
): MysterySymbolRevealResult {
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
  let pMaxK = 0;
  for (const { count, probability } of config.countPmf) {
    if (count === maxK) pMaxK += probability;
  }

  // Symbol payout moments
  let eP = 0;
  let eP2 = 0;
  let maxPayout = -Infinity;
  for (const { payoutX, probability } of config.symbolPmf) {
    eP += payoutX * probability;
    eP2 += payoutX * payoutX * probability;
    if (payoutX > maxPayout) maxPayout = payoutX;
  }
  const varP = Math.max(0, eP2 - eP * eP);
  let pHitMaxSym = 0;
  for (const { payoutX, probability } of config.symbolPmf) {
    if (payoutX === maxPayout) pHitMaxSym += probability;
  }

  // Joint payout per spin (K ⊥ S, by-design independence)
  const eY = eK * eP;
  const eY2 = eK2 * eP2;
  const varY = Math.max(0, eY2 - eY * eY);

  // Joint tail: P(K=max AND S=max-symbol) = pMaxK · pHitMaxSym
  const probFullGridMaxSymbol = pMaxK * pHitMaxSym;

  // Conditional E[Y | S=s] = E[K] · paytable[s]
  const conditionalExpectedPayoutBySymbol: Record<string, number> = {};
  for (const { label, payoutX } of config.symbolPmf) {
    conditionalExpectedPayoutBySymbol[label] = eK * payoutX;
  }

  return {
    expectedCount: eK,
    varianceCount: varK,
    expectedCountSquared: eK2,
    maxCount: maxK,
    probZeroCount: pZeroK,
    probMaxCount: pMaxK,
    expectedPayoutPerPosition: eP,
    expectedPayoutPerPositionSquared: eP2,
    variancePayoutPerPosition: varP,
    maxSymbolPayout: maxPayout,
    probHitMaxSymbol: pHitMaxSym,
    expectedPayoutPerSpin: eY,
    expectedPayoutPerSpinSquared: eY2,
    variancePayoutPerSpin: varY,
    probFullGridMaxSymbol,
    conditionalExpectedPayoutBySymbol,
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

function sampleCount(pmf: CountPmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.count;
  }
  return pmf[pmf.length - 1].count;
}

function sampleSymbol(pmf: SymbolPmfEntry[], u: number): SymbolPmfEntry {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e;
  }
  return pmf[pmf.length - 1];
}

export function simulateMysterySymbolReveal(
  config: MysterySymbolRevealConfig,
  spins: number,
  seed: number,
): MysterySymbolRevealMCResult {
  validate(config);
  const rng = makePrng(seed);

  // Precompute max count
  let maxK = -Infinity;
  for (const e of config.countPmf) if (e.count > maxK) maxK = e.count;

  let sumK = 0;
  let sumY = 0;
  let sumY2 = 0;
  let zeroCountHits = 0;
  let maxCountHits = 0;
  let maxPayoutSeen = 0;

  for (let t = 0; t < spins; t++) {
    const K = sampleCount(config.countPmf, rng());
    const S = sampleSymbol(config.symbolPmf, rng());
    const Y = K * S.payoutX;

    sumK += K;
    sumY += Y;
    sumY2 += Y * Y;
    if (K === 0) zeroCountHits += 1;
    if (K === maxK) maxCountHits += 1;
    if (Y > maxPayoutSeen) maxPayoutSeen = Y;
  }

  const meanY = sumY / spins;
  const varY = Math.max(0, sumY2 / spins - meanY * meanY);

  return {
    spins,
    observedMeanCount: sumK / spins,
    observedMeanPayoutPerSpin: meanY,
    observedVariancePayoutPerSpin: varY,
    observedZeroCountFraction: zeroCountHits / spins,
    observedMaxCountFraction: maxCountHits / spins,
    observedMaxPayoutSeen: maxPayoutSeen,
  };
}
