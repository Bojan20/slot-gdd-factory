/**
 * W152 Wave 43 — Kimi K1 partial: ENT entropy battery (in-process).
 *
 * Implements the 5 statistics from John Walker's `ent` open-source RNG
 * analyzer (https://www.fourmilab.ch/random/) — a regulator-recognized
 * supplement to NIST SP 800-22. Closes Kimi K1 partial track:
 *
 *   "No slot engine vendor publishes TestU01 BigCrush + PractRand + ENT
 *    + Dieharder combined pipelines."
 *
 * Wave 43 lands the ENT piece (in-process JS, no external dep). Other
 * components stay external-runner gated (TestU01 + PractRand + Dieharder
 * via `.github/workflows/rng-cert.yml`).
 *
 * ## ENT Statistics (per-byte sample)
 *
 *   1. **Entropy bits per byte** — Shannon entropy. Target ≈ 8.0 (perfect).
 *   2. **Chi-square** — uniform goodness-of-fit. Target p-value ∈ [0.01, 0.99].
 *   3. **Arithmetic mean** — sample mean. Target ≈ 127.5 (uniform u8).
 *   4. **Monte Carlo π estimate** — pairs of bytes treated as (x,y) ∈ [0,255]².
 *      Counts in unit circle vs total → π estimate. Target ≈ 3.14159.
 *   5. **Serial correlation coefficient** — autocorrelation lag-1.
 *      Target |ρ| < 0.005 for good source.
 *
 * Each statistic returns a numeric value plus a PASS/FAIL flag against
 * conservative bounds. ENT is "diagnostic" not "binary pass/fail" by
 * tradition; we provide both modes.
 *
 * ## References
 *
 * - Walker, J. (2008) — *ENT: A Pseudorandom Number Sequence Test Program*
 *   https://www.fourmilab.ch/random/
 * - NIST SP 800-22 supplements ENT but does not replace it
 * - Danish Gambling Authority SCP.01.00 (2025) — accepts ENT as a "similar
 *   suite of the same level" alternative to NIST STS
 */

export interface EntResult {
  /** Sample size in bytes. */
  sampleBytes: number;
  /** Shannon entropy in bits per byte. Range [0, 8]. Higher = more uniform. */
  entropyBitsPerByte: number;
  /** Chi-square statistic against uniform u8 (256 buckets, df=255). */
  chiSquare: number;
  /** Chi-square p-value (probability random chi^2 ≥ observed). */
  chiSquarePValue: number;
  /** Arithmetic mean of bytes. Target ≈ 127.5. */
  arithmeticMean: number;
  /** Monte Carlo π estimate from (x,y) byte pairs in unit-circle test. */
  monteCarloPi: number;
  /** Relative error of π estimate vs true π. */
  monteCarloPiErrorPct: number;
  /** Lag-1 serial correlation coefficient. Target |ρ| < 0.005. */
  serialCorrelation: number;
  /** Per-stat pass flags using conservative bounds. */
  pass: {
    entropy: boolean;        // ≥ 7.95 bits/byte
    chiSquare: boolean;      // p ∈ [0.01, 0.99]
    arithmeticMean: boolean; // |mean - 127.5| < 1.0
    monteCarloPi: boolean;   // |error| < 1.0%
    serialCorrelation: boolean; // |ρ| < 0.05 (relaxed from ENT default for finite-N)
  };
  /** Overall pass — all 5 stats individually pass. */
  overallPass: boolean;
}

// ─── Statistic implementations ─────────────────────────────────────────────

function shannonEntropy(samples: Uint8Array): number {
  const counts = new Uint32Array(256);
  for (let i = 0; i < samples.length; i++) counts[samples[i]]++;
  const N = samples.length;
  let H = 0;
  for (let i = 0; i < 256; i++) {
    if (counts[i] === 0) continue;
    const p = counts[i] / N;
    H -= p * Math.log2(p);
  }
  return H;
}

function chiSquareUniform(samples: Uint8Array): number {
  const counts = new Uint32Array(256);
  for (let i = 0; i < samples.length; i++) counts[samples[i]]++;
  const expected = samples.length / 256;
  let chi2 = 0;
  for (let i = 0; i < 256; i++) {
    chi2 += ((counts[i] - expected) ** 2) / expected;
  }
  return chi2;
}

/**
 * Approximate p-value for chi-square distribution with df=255.
 * Uses Wilson–Hilferty cube-root transformation to standard normal:
 *   Z = ((χ²/df)^(1/3) − (1 − 2/(9df))) / sqrt(2/(9df))
 *   p = 1 − Φ(Z)   (right-tail)
 */
function chiSquarePValueDf255(chi2: number): number {
  const df = 255;
  const z = (Math.cbrt(chi2 / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 1 - normalCdf(z);
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 approximation, max error ~1.5e-7.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

function arithmeticMean(samples: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  return sum / samples.length;
}

/**
 * Monte Carlo π estimate per ENT spec:
 *   - Take consecutive 6 bytes as 24-bit X coord, then 24-bit Y coord
 *     (this is what fourmilab ent uses for high-precision π).
 *   - Test if (X / max)² + (Y / max)² ≤ 1 (point in unit circle).
 *   - π_est = 4 × (in_circle / total).
 *
 * Conservative variant: use 2 bytes per coord (16-bit precision) which
 * still gives π estimate accurate to ~0.5% at N=50K. Use 6-byte groups
 * for higher precision when sample is large enough.
 */
function monteCarloPi(samples: Uint8Array): number {
  const PER_COORD = 3; // 24-bit
  const PER_PAIR = PER_COORD * 2;
  const max24 = (1 << 24) - 1;
  let inCircle = 0;
  let total = 0;
  for (let i = 0; i + PER_PAIR <= samples.length; i += PER_PAIR) {
    const x = (samples[i] << 16) | (samples[i + 1] << 8) | samples[i + 2];
    const y = (samples[i + 3] << 16) | (samples[i + 4] << 8) | samples[i + 5];
    const xn = x / max24;
    const yn = y / max24;
    if (xn * xn + yn * yn <= 1) inCircle++;
    total++;
  }
  if (total === 0) return NaN;
  return 4 * (inCircle / total);
}

/**
 * Lag-1 serial correlation coefficient.
 *   ρ = Σ(x_i − x̄)(x_{i+1} − x̄) / Σ(x_i − x̄)²
 */
function serialCorrelation(samples: Uint8Array): number {
  const N = samples.length;
  if (N < 2) return 0;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += samples[i];
  const mean = sum / N;
  let cov = 0, var0 = 0;
  for (let i = 0; i < N - 1; i++) {
    const a = samples[i] - mean;
    const b = samples[i + 1] - mean;
    cov += a * b;
    var0 += a * a;
  }
  // Include last sample's variance contribution
  var0 += (samples[N - 1] - mean) ** 2;
  if (var0 === 0) return 0;
  return cov / var0;
}

// ─── Public API ────────────────────────────────────────────────────────────

export function entAssess(samples: Uint8Array): EntResult {
  if (samples.length < 1024) {
    throw new Error(`entAssess: need ≥1024 samples, got ${samples.length}`);
  }
  const H = shannonEntropy(samples);
  const chi2 = chiSquareUniform(samples);
  const chiP = chiSquarePValueDf255(chi2);
  const mean = arithmeticMean(samples);
  const piEst = monteCarloPi(samples);
  const piErrPct = Math.abs((piEst - Math.PI) / Math.PI) * 100;
  const rho = serialCorrelation(samples);

  const pass = {
    entropy: H >= 7.95,
    chiSquare: chiP >= 0.01 && chiP <= 0.99,
    arithmeticMean: Math.abs(mean - 127.5) < 1.0,
    monteCarloPi: piErrPct < 1.0,
    serialCorrelation: Math.abs(rho) < 0.05,
  };
  const overallPass = pass.entropy && pass.chiSquare && pass.arithmeticMean && pass.monteCarloPi && pass.serialCorrelation;

  return {
    sampleBytes: samples.length,
    entropyBitsPerByte: H,
    chiSquare: chi2,
    chiSquarePValue: chiP,
    arithmeticMean: mean,
    monteCarloPi: piEst,
    monteCarloPiErrorPct: piErrPct,
    serialCorrelation: rho,
    pass,
    overallPass,
  };
}
