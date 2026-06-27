/**
 * W152 Wave 81 — Bonus Buy / Feature Buy Variance Analyzer (Faza 4.7 extension).
 *
 * Closed-form variance + convergence + loss-probability solver for the
 * "buy feature" mechanic (player pays cost C per buy → directly enters
 * feature → feature outcome Y is sampled from configured distribution).
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * "Bonus Buy" / "Feature Buy" is widespread since ~2019 (Big Time Gaming,
 * Pragmatic Play, Nolimit City popularized it). Player exchanges cost
 * `C` (typically 50× to 500× base bet) for guaranteed feature entry.
 * Regulator interest:
 *   • UKGC banned bonus-buy purchases in Great Britain (2022) — pricing
 *     transparency must still be provable for jurisdictions where it's allowed.
 *   • MGA / Malta — requires disclosure of feature buy RTP and variance.
 *   • Australia — full ban Class B & B+ since 2024.
 *
 * Naming policy (clean-room, per docs/IP_REVIEW.md):
 *   • "Bonus Buy" / "Feature Buy" = generic industry terms.
 *   • No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Inputs:
 *   - costPerBuyX : C (bet multiplier paid per feature buy)
 *   - featureOutcomes : discrete distribution { payoutX_i, probability_i }
 *
 * Derived:
 *   E[Y]    = Σ p_i · payout_i          (expected feature outcome)
 *   E[Y²]   = Σ p_i · payout_i²
 *   Var[Y]  = E[Y²] − E[Y]²
 *
 * Effective RTP per buy = E[Y] / C
 *
 * Net per buy:    Net = Y − C
 *   E[Net]   = E[Y] − C
 *   Var[Net] = Var[Y]                   (constant shift doesn't affect var)
 *   SD[Net]  = √Var[Y]
 *
 * House edge (operator margin) = (C − E[Y]) / C
 *
 * After N independent buys (Wald):
 *   E[total Net] = N · (E[Y] − C)
 *   Var[total Net] = N · Var[Y]
 *   SD[average Net per buy] = √Var[Y] / √N
 *
 * Convergence: required N for ±tol RTP precision @ confidence z (CLT):
 *   N* = (z · √Var[Y] / (C · tol))²
 *
 * Single-buy loss probability:
 *   P(Y = 0)    — probability of busting completely
 *   P(Y < C)    — probability of finishing below cost
 *   P(Y ≥ C)    — break-even or better
 *
 * Ruin probability (Wald approximation):
 *   Starting bankroll B (in units of cost C), probability of ruin
 *   before N buys ≈ Φ((B·C − N·E[Net]) / √(N·Var[Y])) for N · E[Net] > B·C.
 *   (Simplified Cramér-Lundberg bound assuming bounded outcomes.)
 *
 * Industry-relevant metrics:
 *   • RTP                     = E[Y] / C
 *   • House edge              = 1 − RTP
 *   • Hit frequency           = Σ p_i where payout_i > 0
 *   • Max single payout       = max payout_i (cap on best case)
 *   • Win/loss ratio          = (max payout_i) / C (max multiplier on cost)
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateBonusBuy() MC reference for cross-validation.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface BonusBuyOutcome {
  /** Display label (e.g. "0×", "10×", "Maxwin"). */
  label: string;
  /** Feature payout (bet multiplier). */
  payoutX: number;
  /** Probability this outcome is drawn (Σ over all = 1). */
  probability: number;
}

export interface BonusBuyConfig {
  /** Cost paid per feature buy (in bet multipliers). */
  costPerBuyX: number;
  /** Discrete outcome distribution (probabilities must sum to 1). */
  outcomes: BonusBuyOutcome[];
  /** CLT confidence z-score for convergence calc (default 1.96 for 95%). */
  confidenceZ?: number;
  /** Target relative RTP precision (default 0.01 = ±1%). */
  rtpTolerance?: number;
}

export interface BonusBuyResult {
  expectedOutcomeX: number;
  expectedSecondMomentX: number;
  varianceOutcomeX: number;
  stdOutcomeX: number;
  effectiveRtp: number;
  houseEdge: number;
  hitFrequency: number;
  maxPayoutX: number;
  winLossRatio: number;
  expectedNetPerBuyX: number;
  /** Required N to converge to ±tol RTP at confidence z (CLT). */
  requiredBuysForConvergence: number;
  /** Probability of complete bust (Y = 0). */
  probZeroPayout: number;
  /** Probability of finishing below cost. */
  probBelowCost: number;
  /** Probability of break-even or better. */
  probBreakEven: number;
}

export interface BonusBuyMCResult {
  buys: number;
  totalCost: number;
  totalPayout: number;
  observedRtp: number;
  observedMeanNet: number;
  observedVariance: number;
  observedHitFreq: number;
  observedMaxPayoutX: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: BonusBuyConfig): void {
  if (!Number.isFinite(cfg.costPerBuyX) || cfg.costPerBuyX <= 0) {
    throw new Error(`costPerBuyX must be > 0`);
  }
  if (!Array.isArray(cfg.outcomes) || cfg.outcomes.length === 0) {
    throw new Error(`outcomes must be a non-empty array`);
  }
  let sumP = 0;
  for (const o of cfg.outcomes) {
    if (typeof o.label !== 'string' || o.label.length === 0) {
      throw new Error(`outcome label must be a non-empty string`);
    }
    if (!Number.isFinite(o.payoutX) || o.payoutX < 0) {
      throw new Error(`outcome ${o.label}: payoutX must be ≥ 0`);
    }
    if (!Number.isFinite(o.probability) || o.probability < 0 || o.probability > 1) {
      throw new Error(`outcome ${o.label}: probability must be in [0, 1]`);
    }
    sumP += o.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`outcome probabilities must sum to 1 (got ${sumP})`);
  }
  if (cfg.confidenceZ !== undefined && (!Number.isFinite(cfg.confidenceZ) || cfg.confidenceZ <= 0)) {
    throw new Error(`confidenceZ must be > 0`);
  }
  if (cfg.rtpTolerance !== undefined && (!Number.isFinite(cfg.rtpTolerance) || cfg.rtpTolerance <= 0 || cfg.rtpTolerance >= 1)) {
    throw new Error(`rtpTolerance must be in (0, 1)`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveBonusBuyVariance(config: BonusBuyConfig): BonusBuyResult {
  validate(config);
  const z = config.confidenceZ ?? 1.96; // 95% by default
  const tol = config.rtpTolerance ?? 0.01; // ±1% by default

  let eY = 0;
  let eY2 = 0;
  let hitFreq = 0;
  let maxPayout = 0;
  let probZero = 0;
  let probBelowCost = 0;
  let probBreakEven = 0;
  for (const o of config.outcomes) {
    eY += o.probability * o.payoutX;
    eY2 += o.probability * o.payoutX * o.payoutX;
    if (o.payoutX > 0) hitFreq += o.probability;
    if (o.payoutX === 0) probZero += o.probability;
    if (o.payoutX < config.costPerBuyX) probBelowCost += o.probability;
    if (o.payoutX >= config.costPerBuyX) probBreakEven += o.probability;
    if (o.payoutX > maxPayout) maxPayout = o.payoutX;
  }
  const varY = Math.max(0, eY2 - eY * eY);
  const stdY = Math.sqrt(varY);
  const rtp = eY / config.costPerBuyX;
  const houseEdge = 1 - rtp;
  const winLossRatio = maxPayout / config.costPerBuyX;
  const eNet = eY - config.costPerBuyX;
  // CLT: SE of average Y after N samples = stdY / √N
  // Required N for ±tol RTP precision: stdY / √N ≤ tol · C / z
  // ⇒ N ≥ (z · stdY / (tol · C))²
  const requiredN = stdY > 0
    ? Math.ceil(Math.pow(z * stdY / (tol * config.costPerBuyX), 2))
    : 0;
  return {
    expectedOutcomeX: eY,
    expectedSecondMomentX: eY2,
    varianceOutcomeX: varY,
    stdOutcomeX: stdY,
    effectiveRtp: rtp,
    houseEdge,
    hitFrequency: hitFreq,
    maxPayoutX: maxPayout,
    winLossRatio,
    expectedNetPerBuyX: eNet,
    requiredBuysForConvergence: requiredN,
    probZeroPayout: probZero,
    probBelowCost,
    probBreakEven,
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

export function simulateBonusBuy(
  config: BonusBuyConfig,
  buys: number,
  seed: number,
): BonusBuyMCResult {
  validate(config);
  const rng = makePrng(seed);
  // Pre-compute cumulative probabilities for inverse-CDF sampling.
  const N = config.outcomes.length;
  const cum: number[] = new Array<number>(N);
  {
    let running = 0;
    for (let i = 0; i < N; i++) {
      running += config.outcomes[i].probability;
      cum[i] = running;
    }
    cum[N - 1] = 1; // numerical safety
  }
  let totalPayout = 0;
  let totalPayoutSq = 0;
  let hits = 0;
  let maxObserved = 0;
  for (let i = 0; i < buys; i++) {
    const u = rng();
    let idx = N - 1;
    for (let j = 0; j < N; j++) {
      if (u < cum[j]) { idx = j; break; }
    }
    const payout = config.outcomes[idx].payoutX;
    totalPayout += payout;
    totalPayoutSq += payout * payout;
    if (payout > 0) hits++;
    if (payout > maxObserved) maxObserved = payout;
  }
  const meanY = totalPayout / buys;
  const variance = Math.max(0, totalPayoutSq / buys - meanY * meanY);
  const totalCost = buys * config.costPerBuyX;
  return {
    buys,
    totalCost,
    totalPayout,
    observedRtp: totalPayout / totalCost,
    observedMeanNet: (totalPayout - totalCost) / buys,
    observedVariance: variance,
    observedHitFreq: hits / buys,
    observedMaxPayoutX: maxObserved,
  };
}
