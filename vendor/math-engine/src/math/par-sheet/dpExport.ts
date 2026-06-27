/**
 * Faza 13.14 — Differential privacy PAR export (Laplace mechanism).
 *
 * Operators sometimes want to publish a PAR sheet for transparency
 * without revealing precise paytable / RTP values that competitors
 * could reverse-engineer the game from. Differential privacy provides
 * a principled noise budget: each numeric field gets Laplace noise
 * with scale `Δf/ε`, where `Δf` is the field sensitivity and `ε` the
 * privacy budget.
 *
 * Use-case envelope:
 *   - Operator publishes one "public PAR" per game per quarter.
 *   - Privacy budget per publication: ε = 0.1–0.3 (strong-to-moderate).
 *   - Fields published: RTP, hit rate, volatility class, top-10 win
 *     buckets, feature trigger rates.
 *
 * Threat model:
 *   - Competitor counts published PAR sheets across N games and tries
 *     to infer reel weights / paytable from RTP + hit rate joint
 *     distribution. With ε ≤ 0.3 noise, the reconstruction error
 *     dwarfs the design-relevant signal.
 *
 * This module is **pure math** — emits the noisy values + DP audit
 * record. The actual export pipeline (PDF / Excel) is separate.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParField {
  /** Stable identifier — keeps the audit record deterministic. */
  readonly key: string;
  /** Sensitivity Δf: max change in the field over any single-spin diff. */
  readonly sensitivity: number;
  /** Raw value (before DP noise). */
  readonly value: number;
}

export interface DpExportConfig {
  /** Privacy budget for this publication.  0.1–0.3 typical. */
  readonly epsilon: number;
  /** Fields to publish. */
  readonly fields: ReadonlyArray<ParField>;
  /**
   * RNG for the noise draws.  MUST be a real RNG in production —
   * leaking the seed defeats DP entirely.
   */
  readonly rng: () => number;
}

/** Result of DP-noising one field. */
export interface DpExportField {
  readonly key: string;
  readonly originalValue: number;
  readonly noisedValue: number;
  readonly noiseAdded: number;
  readonly laplaceScale: number;
}

export interface DpExportResult {
  /** Per-field noisy values. */
  readonly fields: ReadonlyArray<DpExportField>;
  /** Total epsilon used (= input epsilon, accumulator field). */
  readonly epsilonUsed: number;
  /** When this export was generated (ISO 8601; caller supplies via `at`). */
  readonly generatedAt: string;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Draw a sample from Laplace(0, scale).  Standard inverse-CDF trick:
 * `b × sgn(u) × ln(1 − 2|u|)` where `u ~ U(−0.5, 0.5)`.
 */
export function laplaceSample(scale: number, rng: () => number): number {
  if (!(scale > 0)) {
    throw new RangeError(`laplaceSample: scale must be > 0, got ${scale}`);
  }
  // Map uniform [0,1) → (-0.5, 0.5), avoiding the exact 0.5 edge.
  let u = rng();
  // Defensive clamp; u must be in (0, 1).  Most RNGs emit [0, 1) so
  // u=0 is possible.  Push it to a tiny positive number.
  if (u <= 0) u = Number.EPSILON;
  if (u >= 1) u = 1 - Number.EPSILON;
  u = u - 0.5;
  const sign = u < 0 ? -1 : 1;
  // ln(1 - 2*|u|) is defined for |u| < 0.5; ε-clip prevents NaN at the edge.
  const inner = Math.max(Number.EPSILON, 1 - 2 * Math.abs(u));
  return -scale * sign * Math.log(inner);
}

/**
 * Apply the Laplace mechanism to each field. Field `i` gets noise with
 * scale `sensitivity_i / (epsilon / k)`, where `k` is the number of
 * fields (basic sequential composition). The total ε used equals the
 * input ε.
 */
export function dpExport(cfg: DpExportConfig, at: string): DpExportResult {
  if (!(cfg.epsilon > 0)) {
    throw new RangeError(`dpExport: epsilon must be > 0, got ${cfg.epsilon}`);
  }
  if (cfg.fields.length === 0) {
    throw new RangeError('dpExport: must provide at least one field');
  }
  if (typeof cfg.rng !== 'function') {
    throw new TypeError('dpExport: rng must be a function');
  }
  const k = cfg.fields.length;
  const perField = cfg.epsilon / k;
  const fields: DpExportField[] = cfg.fields.map((f) => {
    if (!(f.sensitivity > 0)) {
      throw new RangeError(
        `dpExport: field ${f.key} sensitivity must be > 0, got ${f.sensitivity}`
      );
    }
    if (!Number.isFinite(f.value)) {
      throw new RangeError(`dpExport: field ${f.key} value must be finite`);
    }
    const scale = f.sensitivity / perField;
    const noise = laplaceSample(scale, cfg.rng);
    return {
      key: f.key,
      originalValue: f.value,
      noisedValue: f.value + noise,
      noiseAdded: noise,
      laplaceScale: scale,
    };
  });
  return {
    fields,
    epsilonUsed: cfg.epsilon,
    generatedAt: at,
  };
}

/**
 * Recommended sensitivities for common slot-math PAR fields.
 *
 * Source: derived from the "one-spin neighbouring dataset" definition
 * (Dwork & Roth, "The Algorithmic Foundations of Differential Privacy",
 * 2014, §2.3). For a single-spin removal, the max change in RTP across
 * 10⁶ spins is `(maxWinX − 0) / N` for `N = 10⁶`.
 */
export const TYPICAL_SENSITIVITIES: Readonly<Record<string, number>> = Object.freeze({
  // RTP is a ratio of (win sum / bet sum); a single spin can change it
  // by at most maxWinX/N. With N=1e6 and maxWinX=5000, Δrtp ≈ 5e-3.
  rtp: 5e-3,
  // Hit rate is bounded by 1/N for one spin's hit toggle. Δ = 1e-6 at N=1e6.
  hit_rate: 1e-6,
  // Volatility class is ordinal — caller bins it post-DP; raw σ has
  // sensitivity proportional to maxWinX (use 1.0 as a conservative default).
  volatility: 1.0,
  // Bucket count probabilities for binned histograms; sensitivity 1/N.
  bucket_frequency: 1e-6,
  // Feature trigger rate: 1 add/remove flips 1/N.
  feature_trigger_rate: 1e-6,
});
