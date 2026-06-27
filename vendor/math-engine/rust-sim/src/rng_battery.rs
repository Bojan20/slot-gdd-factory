//! PAR-018 — NIST SP 800-22 + DIEHARDER statistical battery (essential subset).
//!
//! Full NIST SP 800-22 ships 15 tests; here we land the 4 most commonly
//! probed by US tribal regulators + GLI-19 §3.3:
//!
//!   1. **Monobit (frequency) test** — runs of 0/1 bits balanced
//!   2. **Block frequency** — proportion of 1-bits per M-bit block
//!   3. **Runs test** — number of monotone runs vs expectation
//!   4. **Chi-square uniformity** — DIEHARDER `birthdays`-style binning
//!
//! Each test returns a `BatteryVerdict { p_value, statistic, pass, name }`.
//! Pass threshold: `p_value ≥ 0.01` (NIST default). The PAR sheet aggregates
//! verdicts under `RngBatterySection` so a regulator sees the exact statistics.
//!
//! Implementations follow NIST SP 800-22 Rev 1a §2 closed-form formulas; we
//! deliberately avoid `erfc` from the standard library and use the rational
//! Numerical Recipes approximation so the suite is dependency-free.

use serde::{Deserialize, Serialize};

/// One battery verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryVerdict {
    pub name: String,
    pub statistic: f64,
    pub p_value: f64,
    pub pass: bool,
}

/// Group of NIST/DIEHARDER verdicts.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RngBatterySection {
    pub n_bits: u64,
    pub verdicts: Vec<BatteryVerdict>,
}

impl RngBatterySection {
    /// Pass threshold (NIST default α = 0.01).
    pub const PASS_ALPHA: f64 = 0.01;

    /// Run the essential battery over a slice of f64 samples in `[0, 1)`.
    /// Bits are extracted from the top 32 bits of each `(sample × 2^32)` cast.
    pub fn run_essential(samples: &[f64]) -> Self {
        let bits = samples_to_bits(samples);
        let verdicts: Vec<BatteryVerdict> = vec![
            monobit_test(&bits),
            block_frequency_test(&bits, 128),
            runs_test(&bits),
            chi_square_uniformity(samples, 16),
        ];
        Self {
            n_bits: bits.len() as u64,
            verdicts,
        }
    }
}

// ─── Bit extraction ─────────────────────────────────────────────────────────

fn samples_to_bits(samples: &[f64]) -> Vec<bool> {
    let mut bits: Vec<bool> = Vec::with_capacity(samples.len() * 32);
    for &s in samples {
        let u = (s.clamp(0.0, 1.0 - 1e-15) * (1u64 << 32) as f64) as u32;
        for i in 0..32 {
            bits.push(((u >> i) & 1) == 1);
        }
    }
    bits
}

// ─── NIST tests ──────────────────────────────────────────────────────────────

/// NIST SP 800-22 §2.1 — Monobit test.
pub fn monobit_test(bits: &[bool]) -> BatteryVerdict {
    let n = bits.len() as f64;
    let s: i64 = bits.iter().map(|&b| if b { 1 } else { -1 }).sum();
    let s_obs = (s.unsigned_abs() as f64) / n.sqrt();
    let p_value = erfc(s_obs / std::f64::consts::SQRT_2);
    BatteryVerdict {
        name: "monobit".to_string(),
        statistic: s_obs,
        p_value,
        pass: p_value >= RngBatterySection::PASS_ALPHA,
    }
}

/// NIST SP 800-22 §2.2 — Block frequency test (block size M).
pub fn block_frequency_test(bits: &[bool], m: usize) -> BatteryVerdict {
    let n_blocks = bits.len() / m;
    if n_blocks == 0 {
        return BatteryVerdict {
            name: "block_frequency".to_string(),
            statistic: 0.0,
            p_value: 0.0,
            pass: false,
        };
    }
    let mut chi_sq = 0.0_f64;
    for blk in 0..n_blocks {
        let mut ones = 0u32;
        for j in 0..m {
            if bits[blk * m + j] {
                ones += 1;
            }
        }
        let pi = (ones as f64) / (m as f64);
        chi_sq += (pi - 0.5).powi(2);
    }
    chi_sq *= 4.0 * m as f64;
    let p_value = igamc((n_blocks as f64) / 2.0, chi_sq / 2.0);
    BatteryVerdict {
        name: "block_frequency".to_string(),
        statistic: chi_sq,
        p_value,
        pass: p_value >= RngBatterySection::PASS_ALPHA,
    }
}

/// NIST SP 800-22 §2.3 — Runs test.
pub fn runs_test(bits: &[bool]) -> BatteryVerdict {
    let n = bits.len();
    if n < 2 {
        return BatteryVerdict {
            name: "runs".to_string(),
            statistic: 0.0,
            p_value: 0.0,
            pass: false,
        };
    }
    let ones = bits.iter().filter(|&&b| b).count() as f64;
    let pi = ones / n as f64;
    // Pre-test: π within 0.5 ± 2/√n.
    if (pi - 0.5).abs() > 2.0 / (n as f64).sqrt() {
        return BatteryVerdict {
            name: "runs".to_string(),
            statistic: pi,
            p_value: 0.0,
            pass: false,
        };
    }
    let v_obs: usize = 1 + (1..n).filter(|&i| bits[i] != bits[i - 1]).count();
    let v_obs_f = v_obs as f64;
    let n_f = n as f64;
    let numerator = (v_obs_f - 2.0 * n_f * pi * (1.0 - pi)).abs();
    let denominator = 2.0 * (2.0_f64 * n_f).sqrt() * pi * (1.0 - pi);
    let p_value = if denominator > 0.0 {
        erfc(numerator / denominator)
    } else {
        0.0
    };
    BatteryVerdict {
        name: "runs".to_string(),
        statistic: v_obs_f,
        p_value,
        pass: p_value >= RngBatterySection::PASS_ALPHA,
    }
}

/// DIEHARDER-style chi-square uniformity over `n_buckets` equal-width bins.
pub fn chi_square_uniformity(samples: &[f64], n_buckets: usize) -> BatteryVerdict {
    let n = samples.len();
    if n == 0 || n_buckets == 0 {
        return BatteryVerdict {
            name: "chi_square_uniformity".to_string(),
            statistic: 0.0,
            p_value: 0.0,
            pass: false,
        };
    }
    let mut counts = vec![0u64; n_buckets];
    for &s in samples {
        let idx = (s.clamp(0.0, 1.0 - 1e-15) * n_buckets as f64) as usize;
        counts[idx.min(n_buckets - 1)] += 1;
    }
    let expected = n as f64 / n_buckets as f64;
    let chi_sq: f64 = counts
        .iter()
        .map(|&c| {
            let d = c as f64 - expected;
            d * d / expected
        })
        .sum();
    let dof = (n_buckets - 1) as f64;
    let p_value = igamc(dof / 2.0, chi_sq / 2.0);
    BatteryVerdict {
        name: "chi_square_uniformity".to_string(),
        statistic: chi_sq,
        p_value,
        pass: p_value >= RngBatterySection::PASS_ALPHA,
    }
}

// ─── Public re-exports for sibling modules (PAR-020) ────────────────────────

/// PAR-020 use-site: public wrapper around the internal `erfc`.
pub fn erfc_pub(x: f64) -> f64 {
    erfc(x)
}

/// PAR-020 use-site: χ² upper-tail p-value with `dof` degrees of freedom.
pub fn chi_square_uniformity_p(chi_sq: f64, dof: f64) -> f64 {
    igamc(dof / 2.0, chi_sq / 2.0)
}

// ─── Numerical helpers (NIST SP 800-22 Appendix C) ──────────────────────────

/// Complementary error function (Numerical Recipes rational approximation).
fn erfc(x: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.5 * x.abs());
    let ans = t * (-x * x - 1.26551223
        + t * (1.00002368
            + t * (0.37409196
                + t * (0.09678418
                    + t * (-0.18628806
                        + t * (0.27886807
                            + t * (-1.13520398
                                + t * (1.48851587
                                    + t * (-0.82215223 + t * 0.17087277))))))))
        )
        .exp();
    if x >= 0.0 {
        ans
    } else {
        2.0 - ans
    }
}

/// Regularised upper incomplete gamma Q(a, x) — continued-fraction approximation
/// for x > a + 1, series otherwise. Sufficient accuracy for chi-square p-values.
fn igamc(a: f64, x: f64) -> f64 {
    if x < 0.0 || a <= 0.0 {
        return 1.0;
    }
    if x < a + 1.0 {
        1.0 - gser(a, x)
    } else {
        gcf(a, x)
    }
}

fn gser(a: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let mut ap = a;
    let mut sum = 1.0 / a;
    let mut del = sum;
    for _ in 0..200 {
        ap += 1.0;
        del *= x / ap;
        sum += del;
        if del.abs() < sum.abs() * 1e-12 {
            break;
        }
    }
    sum * (-x + a * x.ln() - gln(a)).exp()
}

fn gcf(a: f64, x: f64) -> f64 {
    let fpmin = 1e-300_f64;
    let mut b = x + 1.0 - a;
    let mut c = 1.0 / fpmin;
    let mut d = 1.0 / b;
    let mut h = d;
    for i in 1..200 {
        let an = -(i as f64) * (i as f64 - a);
        b += 2.0;
        d = an * d + b;
        if d.abs() < fpmin {
            d = fpmin;
        }
        c = b + an / c;
        if c.abs() < fpmin {
            c = fpmin;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 1e-12 {
            break;
        }
    }
    h * (-x + a * x.ln() - gln(a)).exp()
}

/// log Γ(x) via Lanczos approximation.
fn gln(x: f64) -> f64 {
    let coeffs = [
        76.18009172947146,
        -86.50532032941677,
        24.01409824083091,
        -1.231739572450155,
        1.208_650_973_866_18e-3,
        -5.395_239_384_953e-6,
    ];
    let mut y = x;
    let tmp = x + 5.5;
    let tmp = (x + 0.5) * tmp.ln() - tmp;
    let mut ser = 1.000000000190015_f64;
    for &c in &coeffs {
        y += 1.0;
        ser += c / y;
    }
    tmp + (2.5066282746310005 * ser / x).ln()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_rng_samples(n: usize) -> Vec<f64> {
        let mut samples = Vec::with_capacity(n);
        let mut s: u64 = 0x_DEAD_BEEF_C0FF_EE42;
        for _ in 0..n {
            // xorshift64*.
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            samples.push((s as f64 / u64::MAX as f64).clamp(0.0, 1.0 - 1e-15));
        }
        samples
    }

    #[test]
    fn monobit_passes_for_good_prng() {
        let samples = good_rng_samples(10_000);
        let bits = samples_to_bits(&samples);
        let v = monobit_test(&bits);
        assert!(v.pass, "monobit must pass for xorshift64* (p={})", v.p_value);
    }

    #[test]
    fn monobit_fails_for_all_zero_stream() {
        let bits = vec![false; 1_000_000];
        let v = monobit_test(&bits);
        assert!(!v.pass, "all-zero must fail monobit");
        assert!(v.p_value < 1e-12);
    }

    #[test]
    fn chi_square_passes_for_uniform_samples() {
        let samples = good_rng_samples(20_000);
        let v = chi_square_uniformity(&samples, 16);
        assert!(v.pass, "uniform samples must pass χ² (p={})", v.p_value);
    }

    #[test]
    fn chi_square_fails_for_constant_stream() {
        let samples = vec![0.5; 1000];
        let v = chi_square_uniformity(&samples, 16);
        // All mass in bucket 8 → huge χ² → tiny p.
        assert!(!v.pass);
    }

    #[test]
    fn run_essential_returns_four_verdicts() {
        let samples = good_rng_samples(5000);
        let battery = RngBatterySection::run_essential(&samples);
        assert_eq!(battery.verdicts.len(), 4);
    }
}
