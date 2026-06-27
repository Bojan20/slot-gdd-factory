/**
 * Faza 10.5 — RTP acceptance harness (±0.001% precision target).
 *
 * The regulator-facing acceptance gate: prove that MC-simulated RTP
 * converges to the closed-form (analytical) RTP within **±0.001 %**
 * (= 1 part in 100 000) with 99 % confidence, across every reference
 * fixture. Tightened from the historic ±0.05 % bar — W152 Wave 13.
 *
 * # The convergence math
 *
 * For a slot with per-spin standard deviation `σ`, the Monte-Carlo
 * estimator for RTP has CI half-width
 *
 *     hw = z × σ / √N
 *
 * where `z` is the standard-normal quantile for the chosen
 * confidence level (z = 2.576 for 99 %).  Solving for N at the
 * ±0.001 % target gives
 *
 *     N ≥ (z × σ / 0.00001)²    =    (2.576 × σ)² × 10¹⁰
 *
 * For a typical slot with σ ≈ 5 × bet, this is N ≈ 1.66 × 10¹² spins
 * — which is exactly the "1 T spinova" target Faza 9.8 was built for.
 * For lower-volatility games (σ < 1) the required N drops to 10⁸–10⁹.
 *
 * # Acceptance modes
 *
 * - `'closed_form'`  — analytical RTP is the reference; MC must
 *                       converge inside ±0.001 %.
 * - `'reference_par'`— operator supplies a target RTP from a
 *                       published PAR sheet; MC must hit within
 *                       ±0.001 %.
 * - `'self_replay'` — replay-mode determinism check (Wave 9 Faza 10.5
 *                       golden snapshot); tolerance is exact 0 since the
 *                       same seed must produce bit-identical output.
 *
 * # API contract
 *
 * The harness is pure-math + IO-free.  Caller drives the MC engine
 * and feeds per-batch `{spinsSoFar, runningRtp, runningVariance}` to
 * `evaluateConvergence()`.  When CI half-width drops below the
 * target, the harness returns `'converged'`; if a hard spin cap is
 * exceeded without convergence, returns `'not_converged'`.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default precision target: ±0.001 % (= 1 part in 100 000). */
export const DEFAULT_RTP_PRECISION = 0.00001;

/** Default confidence: 99 % → z = 2.576. */
export const DEFAULT_CONFIDENCE = 0.99;

/** Standard-normal quantiles for common confidence levels. */
export const Z_SCORES: Readonly<Record<string, number>> = Object.freeze({
  '0.90': 1.6449,
  '0.95': 1.96,
  '0.99': 2.5758,
  '0.999': 3.2905,
  '0.9999': 3.8906,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type AcceptanceMode = 'closed_form' | 'reference_par' | 'self_replay';

export interface AcceptanceTarget {
  /** Numeric reference (closed-form / published PAR / golden replay). */
  readonly referenceRtp: number;
  /** Precision target (default ±0.001 %). */
  readonly precision?: number;
  /** Confidence (default 99 %). */
  readonly confidence?: number;
  /** Mode — drives error semantics. */
  readonly mode: AcceptanceMode;
}

export interface MCSample {
  /** Spins run so far. */
  readonly spinsSoFar: number;
  /** Running RTP estimate (mean win / mean bet ratio). */
  readonly runningRtp: number;
  /** Running per-spin variance (population variance, not sample). */
  readonly runningVariance: number;
}

export type ConvergenceStatus =
  | 'converged'
  | 'too_few_spins'
  | 'not_converged'
  | 'diverged_from_reference';

export interface ConvergenceVerdict {
  readonly status: ConvergenceStatus;
  /** Current 99 % (or configured) CI half-width. */
  readonly ciHalfWidth: number;
  /** Delta from reference (runningRtp − referenceRtp). */
  readonly delta: number;
  /** Spins required to hit `precision` at current `σ` and confidence. */
  readonly requiredSpins: number;
  /** Required-spins margin: requiredSpins / spinsSoFar (≥1 = need more). */
  readonly spinsMargin: number;
  /** Free-form reason (for logs / dashboards). */
  readonly reason: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lookupZ(confidence: number): number {
  const key = confidence.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (Z_SCORES[key]) return Z_SCORES[key];
  // Round to the closest supported quantile.
  if (confidence >= 0.9999) return Z_SCORES['0.9999'];
  if (confidence >= 0.999) return Z_SCORES['0.999'];
  if (confidence >= 0.99) return Z_SCORES['0.99'];
  if (confidence >= 0.95) return Z_SCORES['0.95'];
  return Z_SCORES['0.90'];
}

/**
 * Required spin count to hit `precision` at `confidence` given per-spin
 * variance `σ²`.  Returns `Infinity` if `σ ≤ 0`.
 */
export function requiredSpinsForPrecision(input: {
  perSpinVariance: number;
  precision?: number;
  confidence?: number;
}): number {
  const precision = input.precision ?? DEFAULT_RTP_PRECISION;
  const confidence = input.confidence ?? DEFAULT_CONFIDENCE;
  const sigma = Math.sqrt(Math.max(0, input.perSpinVariance));
  if (sigma <= 0) {
    // A degenerate distribution — every spin pays exactly the same.
    // MC converges in 1 spin.
    return 1;
  }
  if (precision <= 0) return Number.POSITIVE_INFINITY;
  const z = lookupZ(confidence);
  // N ≥ (z × σ / precision)²
  return Math.ceil((z * sigma / precision) ** 2);
}

/**
 * Current CI half-width given a sample of `n` spins with per-spin
 * variance `σ²`.  hw = z × σ / √n.
 */
export function ciHalfWidth(input: {
  spins: number;
  perSpinVariance: number;
  confidence?: number;
}): number {
  if (input.spins <= 0) return Number.POSITIVE_INFINITY;
  const confidence = input.confidence ?? DEFAULT_CONFIDENCE;
  const sigma = Math.sqrt(Math.max(0, input.perSpinVariance));
  const z = lookupZ(confidence);
  return (z * sigma) / Math.sqrt(input.spins);
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Inspect a sample and decide whether convergence has been reached.
 *
 * Decision tree:
 *   1. `mode='self_replay'` — `delta` must be exactly 0 (no tolerance);
 *      otherwise return `'diverged_from_reference'`.
 *   2. For MC modes: if `|delta| > precision + ciHalfWidth`, return
 *      `'diverged_from_reference'` (the estimator is provably outside
 *      the target band even after accounting for sampling noise).
 *   3. Otherwise: if `ciHalfWidth ≤ precision`, return `'converged'`.
 *      Else if `spinsSoFar < requiredSpins`, return `'too_few_spins'`.
 *      Else return `'not_converged'`.
 */
export function evaluateConvergence(
  sample: MCSample,
  target: AcceptanceTarget
): ConvergenceVerdict {
  const precision = target.precision ?? DEFAULT_RTP_PRECISION;
  const confidence = target.confidence ?? DEFAULT_CONFIDENCE;
  const delta = sample.runningRtp - target.referenceRtp;

  // ── self_replay: zero tolerance ────────────────────────────────────
  if (target.mode === 'self_replay') {
    const status: ConvergenceStatus =
      delta === 0 ? 'converged' : 'diverged_from_reference';
    return {
      status,
      ciHalfWidth: 0,
      delta,
      requiredSpins: 1,
      spinsMargin: 1,
      reason:
        status === 'converged'
          ? 'self-replay exact match (zero tolerance)'
          : `self-replay drift detected — same seed must produce identical RTP, got delta=${delta}`,
    };
  }

  const hw = ciHalfWidth({
    spins: sample.spinsSoFar,
    perSpinVariance: sample.runningVariance,
    confidence,
  });
  const required = requiredSpinsForPrecision({
    perSpinVariance: sample.runningVariance,
    precision,
    confidence,
  });
  const spinsMargin =
    sample.spinsSoFar > 0 ? required / sample.spinsSoFar : Number.POSITIVE_INFINITY;

  // ── divergence check ──────────────────────────────────────────────
  // |delta| beyond (precision + ciHalfWidth) means: even if we shifted
  // the estimator by its full CI band, we still couldn't reach the
  // reference. Diverged.
  if (Math.abs(delta) > precision + hw) {
    return {
      status: 'diverged_from_reference',
      ciHalfWidth: hw,
      delta,
      requiredSpins: required,
      spinsMargin,
      reason: `|delta|=${Math.abs(delta).toExponential(3)} > precision+ciHalfWidth=${(precision + hw).toExponential(3)}; estimator is provably outside target band`,
    };
  }

  // ── convergence check ─────────────────────────────────────────────
  if (hw <= precision) {
    return {
      status: 'converged',
      ciHalfWidth: hw,
      delta,
      requiredSpins: required,
      spinsMargin,
      reason: `CI half-width ${hw.toExponential(3)} ≤ precision ${precision.toExponential(3)}; |delta|=${Math.abs(delta).toExponential(3)} within band`,
    };
  }

  // ── too_few_spins vs not_converged ────────────────────────────────
  if (sample.spinsSoFar < required) {
    return {
      status: 'too_few_spins',
      ciHalfWidth: hw,
      delta,
      requiredSpins: required,
      spinsMargin,
      reason: `${sample.spinsSoFar.toLocaleString()} spins so far; need ≈${required.toLocaleString()} for ±${precision} at ${(confidence * 100).toFixed(2)}%`,
    };
  }

  return {
    status: 'not_converged',
    ciHalfWidth: hw,
    delta,
    requiredSpins: required,
    spinsMargin,
    reason: `${sample.spinsSoFar.toLocaleString()} ≥ required ${required.toLocaleString()} but ciHalfWidth ${hw.toExponential(3)} still > precision ${precision.toExponential(3)} — variance estimate likely under-counts heavy tails`,
  };
}

/**
 * Aggregate verdict across many fixtures.  Returns `'converged'` only
 * if every fixture converged; otherwise reports the worst status.
 */
export interface AcceptanceFixtureResult {
  readonly fixtureId: string;
  readonly verdict: ConvergenceVerdict;
}

export interface AcceptanceSummary {
  readonly fixtures: ReadonlyArray<AcceptanceFixtureResult>;
  readonly overall: ConvergenceStatus;
  readonly convergedCount: number;
  readonly totalCount: number;
  readonly worstDelta: number;
  readonly worstCiHalfWidth: number;
}

/** Worst-of rollup; FAIL dominates WARN dominates PASS. */
export function aggregateAcceptance(
  fixtures: ReadonlyArray<AcceptanceFixtureResult>
): AcceptanceSummary {
  if (fixtures.length === 0) {
    return {
      fixtures: [],
      overall: 'too_few_spins',
      convergedCount: 0,
      totalCount: 0,
      worstDelta: 0,
      worstCiHalfWidth: 0,
    };
  }
  let convergedCount = 0;
  let anyDiverged = false;
  let anyNotConverged = false;
  let anyTooFew = false;
  let worstDelta = 0;
  let worstCi = 0;
  for (const f of fixtures) {
    if (f.verdict.status === 'converged') convergedCount += 1;
    else if (f.verdict.status === 'diverged_from_reference') anyDiverged = true;
    else if (f.verdict.status === 'not_converged') anyNotConverged = true;
    else anyTooFew = true;
    if (Math.abs(f.verdict.delta) > Math.abs(worstDelta)) worstDelta = f.verdict.delta;
    if (f.verdict.ciHalfWidth > worstCi) worstCi = f.verdict.ciHalfWidth;
  }
  let overall: ConvergenceStatus = 'converged';
  if (anyDiverged) overall = 'diverged_from_reference';
  else if (anyNotConverged) overall = 'not_converged';
  else if (anyTooFew) overall = 'too_few_spins';
  return {
    fixtures,
    overall,
    convergedCount,
    totalCount: fixtures.length,
    worstDelta,
    worstCiHalfWidth: worstCi,
  };
}
