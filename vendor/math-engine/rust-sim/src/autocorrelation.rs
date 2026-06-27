//! PAR-020 — Autocorrelation tests (Ljung-Box + Wald-Wolfowitz runs).
//!
//! Regulators want statistical evidence that consecutive spin outcomes are
//! independent — otherwise the game can be claimed to support "hot/cold
//! streak chasing", which UKGC RTS 14 explicitly forbids. This module
//! implements two complementary tests:
//!
//!   * **Ljung-Box** — joint significance of autocorrelations at lags 1..h.
//!     Statistic Q is χ²(h) under H₀ (independence).
//!   * **Wald-Wolfowitz runs test** — sign-change count vs N(μ, σ²) under H₀.
//!
//! Pass criterion (GLI-19 §3.3 conventional): p-value ≥ 0.01.

use serde::{Deserialize, Serialize};

/// Verdict for a single autocorrelation test.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutocorrVerdict {
    pub name: String,
    pub statistic: f64,
    pub p_value: f64,
    pub pass: bool,
}

/// Bundled section emitted by the PAR sheet.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutocorrelationSection {
    pub n_samples: u64,
    pub verdicts: Vec<AutocorrVerdict>,
}

impl AutocorrelationSection {
    pub const PASS_ALPHA: f64 = 0.01;

    /// Run both Ljung-Box (h=20) and runs test on the supplied spin-win series.
    pub fn run_default(samples: &[f64]) -> Self {
        let verdicts = vec![ljung_box(samples, 20), wald_wolfowitz_runs(samples)];
        Self {
            n_samples: samples.len() as u64,
            verdicts,
        }
    }
}

/// Sample autocorrelation at lag `k`.
pub fn autocorrelation(samples: &[f64], k: usize) -> f64 {
    let n = samples.len();
    if k >= n {
        return 0.0;
    }
    let mean = samples.iter().sum::<f64>() / n as f64;
    let mut num = 0.0_f64;
    let mut den = 0.0_f64;
    for i in 0..n {
        let dev = samples[i] - mean;
        den += dev * dev;
        if i + k < n {
            num += dev * (samples[i + k] - mean);
        }
    }
    if den > 0.0 {
        num / den
    } else {
        0.0
    }
}

/// Ljung-Box statistic Q(h) = n(n+2) Σ ρ̂²_k / (n − k).
/// Q is χ²(h) under independence (H₀).
pub fn ljung_box(samples: &[f64], h: usize) -> AutocorrVerdict {
    let n = samples.len();
    if n < h + 5 {
        return AutocorrVerdict {
            name: format!("ljung_box_h{h}"),
            statistic: 0.0,
            p_value: 0.0,
            pass: false,
        };
    }
    let mut q = 0.0_f64;
    for k in 1..=h {
        let rho = autocorrelation(samples, k);
        q += rho * rho / (n - k) as f64;
    }
    q *= (n as f64) * (n as f64 + 2.0);
    let p_value = crate::rng_battery::chi_square_uniformity_p(q, h as f64);
    AutocorrVerdict {
        name: format!("ljung_box_h{h}"),
        statistic: q,
        p_value,
        pass: p_value >= AutocorrelationSection::PASS_ALPHA,
    }
}

/// Wald-Wolfowitz runs test on the sign of (x_i − median).
pub fn wald_wolfowitz_runs(samples: &[f64]) -> AutocorrVerdict {
    let n = samples.len();
    if n < 20 {
        return AutocorrVerdict {
            name: "ww_runs".to_string(),
            statistic: 0.0,
            p_value: 0.0,
            pass: false,
        };
    }
    let mut sorted: Vec<f64> = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = sorted[n / 2];
    let mut n_pos = 0usize;
    let mut n_neg = 0usize;
    let mut signs: Vec<bool> = Vec::with_capacity(n);
    for &s in samples {
        if s > median {
            signs.push(true);
            n_pos += 1;
        } else if s < median {
            signs.push(false);
            n_neg += 1;
        }
    }
    let n_total = (n_pos + n_neg) as f64;
    if n_total < 20.0 {
        return AutocorrVerdict {
            name: "ww_runs".to_string(),
            statistic: 0.0,
            p_value: 0.0,
            pass: false,
        };
    }
    let runs: usize = 1 + (1..signs.len()).filter(|&i| signs[i] != signs[i - 1]).count();
    let p = (n_pos as f64) / n_total;
    let q = (n_neg as f64) / n_total;
    let mean_runs = 2.0 * n_total * p * q + 1.0;
    let var_runs = 2.0 * n_total * p * q * (2.0 * n_total * p * q - 1.0) / (n_total - 1.0);
    if var_runs <= 0.0 {
        return AutocorrVerdict {
            name: "ww_runs".to_string(),
            statistic: runs as f64,
            p_value: 0.0,
            pass: false,
        };
    }
    let z = (runs as f64 - mean_runs) / var_runs.sqrt();
    // Two-sided p-value via complementary error function.
    let p_value = crate::rng_battery::erfc_pub(z.abs() / std::f64::consts::SQRT_2);
    AutocorrVerdict {
        name: "ww_runs".to_string(),
        statistic: z,
        p_value,
        pass: p_value >= AutocorrelationSection::PASS_ALPHA,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iid_samples(n: usize, seed: u64) -> Vec<f64> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                (s as f64 / u64::MAX as f64).clamp(0.0, 1.0)
            })
            .collect()
    }

    #[test]
    fn autocorrelation_at_lag_zero_is_one() {
        let samples = iid_samples(1000, 42);
        assert!((autocorrelation(&samples, 0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn ljung_box_passes_for_iid_samples() {
        let samples = iid_samples(2000, 12345);
        let v = ljung_box(&samples, 20);
        assert!(v.pass, "IID xorshift must pass Ljung-Box (p={})", v.p_value);
    }

    #[test]
    fn ljung_box_fails_for_perfectly_correlated_series() {
        // x_t = (t mod 2) — perfectly periodic.
        let samples: Vec<f64> = (0..1000).map(|i| (i % 2) as f64).collect();
        let v = ljung_box(&samples, 5);
        assert!(!v.pass, "periodic series must FAIL Ljung-Box");
    }

    #[test]
    fn runs_test_passes_for_iid_samples() {
        let samples = iid_samples(2000, 99);
        let v = wald_wolfowitz_runs(&samples);
        assert!(v.pass, "IID must pass WW runs (p={})", v.p_value);
    }

    #[test]
    fn run_default_emits_two_verdicts() {
        let samples = iid_samples(2000, 1);
        let section = AutocorrelationSection::run_default(&samples);
        assert_eq!(section.verdicts.len(), 2);
    }
}
