/**
 * W152 Wave 20 — Feature Purchase EV Validator (Faza 15.C.3).
 *
 * Buy-feature ("instant bonus") pricing validation. Regulator concern
 * (UKGC RTS 12.4 + MGA Player Protection Directive 2018 §11.f): a
 * mispriced buy-feature creates EV asymmetry between regular play and
 * the purchase path. Specifically:
 *
 *   * If `priceMultiplier × baseGameRtp` > `expectedBuyPath_rtp` →
 *     player is OVERPAYING (regulator: deceptive marketing).
 *
 *   * If `priceMultiplier × baseGameRtp` < `expectedBuyPath_rtp` →
 *     player is GETTING DEAL (regulator: encouraging excessive bet,
 *     ALSO a problem for problem-gambling vector).
 *
 * Industry tolerance: ±2 percentage-points (operator policy varies;
 * UKGC + MGA scrutinise mispricing > 5pp).
 *
 * Naming policy: `featurePurchaseEV` engine-generic. NOT a vendor term
 * (per `docs/glossary.md`).
 *
 * Pure module — no I/O, no clock, no RNG. Same input → same verdict.
 */

export type PurchaseVerdictStatus = 'aligned' | 'overpriced' | 'underpriced' | 'invalid';

export interface PurchasePricingInput {
  /** Cost to buy as a multiple of base bet (e.g. 100× = "100x ante"). */
  priceMultiplier: number;
  /** Base game RTP (0–1, e.g. 0.96). */
  baseGameRtp: number;
  /** Measured / closed-form RTP of the bonus path being purchased. */
  expectedBuyPathRtp: number;
  /** Tolerance in percentage points (default 0.02 = 2pp). */
  tolerancePercentagePoints?: number;
  /** Tag for the buy-feature variant (operator label). */
  variantId?: string;
}

export interface PurchaseVerdict {
  variantId: string | null;
  status: PurchaseVerdictStatus;
  /** Predicted total RTP under purchase path = priceMultiplier × baseGameRtp. */
  predictedTotalRtp: number;
  /** Δ in percentage-points: expectedBuyPathRtp − predictedTotalRtp. */
  deltaPercentagePoints: number;
  /** Tolerance used. */
  tolerancePercentagePoints: number;
  /** Diagnostic message for regulator review. */
  diagnostic: string;
}

/**
 * Evaluate whether a buy-feature is fairly priced.
 *
 * Returns one of:
 *   * `aligned`     — within tolerance, fair price
 *   * `overpriced`  — player pays more than EV (predicted > expected by tolerance)
 *   * `underpriced` — player gets advantage (expected > predicted by tolerance)
 *   * `invalid`     — input out of range (NaN, negative, etc.)
 */
export function evaluatePurchasePricing(input: PurchasePricingInput): PurchaseVerdict {
  const tol = input.tolerancePercentagePoints ?? 0.02;
  const variantId = input.variantId ?? null;

  if (!Number.isFinite(input.priceMultiplier) || input.priceMultiplier <= 0) {
    return invalidVerdict(variantId, tol, `priceMultiplier must be positive finite (got ${input.priceMultiplier})`);
  }
  if (!Number.isFinite(input.baseGameRtp) || input.baseGameRtp < 0 || input.baseGameRtp > 1.5) {
    return invalidVerdict(variantId, tol, `baseGameRtp out of [0, 1.5] (got ${input.baseGameRtp})`);
  }
  if (
    !Number.isFinite(input.expectedBuyPathRtp) ||
    input.expectedBuyPathRtp < 0 ||
    input.expectedBuyPathRtp > 1.5
  ) {
    return invalidVerdict(variantId, tol, `expectedBuyPathRtp out of [0, 1.5] (got ${input.expectedBuyPathRtp})`);
  }
  if (tol < 0) {
    return invalidVerdict(variantId, tol, `tolerance must be non-negative (got ${tol})`);
  }

  // Predicted total RTP under purchase path.
  // The contract is: paying `priceMultiplier × stake` should yield an
  // expected return of `expectedBuyPathRtp × (priceMultiplier × stake)`.
  // For fair pricing, that EV should equal what `priceMultiplier` rounds
  // of base game would have returned: `priceMultiplier × baseGameRtp × stake`.
  // So fair iff `expectedBuyPathRtp ≈ baseGameRtp` (NOT × priceMultiplier).
  const predictedTotalRtp = input.baseGameRtp;
  const delta = input.expectedBuyPathRtp - predictedTotalRtp;

  let status: PurchaseVerdictStatus;
  let diagnostic: string;
  if (Math.abs(delta) <= tol) {
    status = 'aligned';
    diagnostic = `Buy-feature RTP ${pct(input.expectedBuyPathRtp)} aligned with base RTP ${pct(input.baseGameRtp)} within ±${pct(tol)} tolerance`;
  } else if (delta < 0) {
    status = 'overpriced';
    diagnostic = `Buy-feature underpays vs base game by ${pct(-delta)} pp (regulator may flag as deceptive marketing)`;
  } else {
    status = 'underpriced';
    diagnostic = `Buy-feature overpays vs base game by ${pct(delta)} pp (regulator may flag as encouraging excessive bet)`;
  }

  return {
    variantId,
    status,
    predictedTotalRtp,
    deltaPercentagePoints: delta,
    tolerancePercentagePoints: tol,
    diagnostic,
  };
}

function pct(x: number): string {
  return (x * 100).toFixed(3) + '%';
}

function invalidVerdict(variantId: string | null, tol: number, reason: string): PurchaseVerdict {
  return {
    variantId,
    status: 'invalid',
    predictedTotalRtp: NaN,
    deltaPercentagePoints: NaN,
    tolerancePercentagePoints: tol,
    diagnostic: reason,
  };
}

/**
 * Closed-form expected purchase-path RTP based on operator analytical
 * model. Useful when caller has component RTPs:
 *   * `triggerProb` — probability of triggering the feature on one spin
 *     (typically the buy guarantees trigger, so this is ~1.0).
 *   * `featureRtpInTriggeredState` — RTP of the feature once entered.
 *   * `priceMultiplier` — purchase cost as multiple of base bet.
 */
export function expectedPurchasePathRtp(
  triggerProb: number,
  featureRtpInTriggeredState: number,
  priceMultiplier: number,
): number {
  if (triggerProb < 0 || triggerProb > 1) {
    throw new RangeError(`expectedPurchasePathRtp: triggerProb out of [0, 1]`);
  }
  if (featureRtpInTriggeredState < 0) {
    throw new RangeError(`expectedPurchasePathRtp: featureRtpInTriggeredState must be >= 0`);
  }
  if (priceMultiplier <= 0) {
    throw new RangeError(`expectedPurchasePathRtp: priceMultiplier must be > 0`);
  }
  // EV = (triggerProb × featureRtp) × stake_paid. Normalised by stake_paid
  // (= priceMultiplier × stake) gives back triggerProb × featureRtp.
  return triggerProb * featureRtpInTriggeredState;
}

/** Batch evaluate multiple variants and aggregate. */
export interface BatchEvaluation {
  results: PurchaseVerdict[];
  aligned: number;
  overpriced: number;
  underpriced: number;
  invalid: number;
}

export function batchEvaluatePricing(inputs: PurchasePricingInput[]): BatchEvaluation {
  const results = inputs.map(evaluatePurchasePricing);
  return {
    results,
    aligned: results.filter((r) => r.status === 'aligned').length,
    overpriced: results.filter((r) => r.status === 'overpriced').length,
    underpriced: results.filter((r) => r.status === 'underpriced').length,
    invalid: results.filter((r) => r.status === 'invalid').length,
  };
}
