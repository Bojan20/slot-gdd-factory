//! W152 P2-15 — Max-win cap math + EVT tail fit (Rust mirror).
//!
//! Mirror of `src/statistics/tailFit.ts`. Same three primitives:
//!   * `clip_distribution` — empirical PMF clip at a max-win cap.
//!   * `fit_pareto_tail`   — peaks-over-threshold MLE Pareto fit.
//!   * `evt_tail_quantile` — Pareto-inverse for projecting cap pressure.
//!
//! All maths in f64. Bootstrap KS p-value uses a deterministic Mulberry32-style
//! PRNG so the same `(samples, threshold, seed)` always produces the same
//! p-value (cross-platform regression-safe).

use serde::{Deserialize, Serialize};

// ─── clipDistribution ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WinDistEntry {
    pub value: f64,
    pub probability: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ClipResult {
    pub rtp_capped: f64,
    pub rtp_uncapped: f64,
    pub rtp_lost: f64,
    pub probability_mass_above: f64,
    pub conditional_mean_above: f64, // NaN if no mass above cap
    pub cap_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TailFitError {
    InvalidCap(f64),
    InvalidProbability(f64),
    InvalidThreshold(f64),
    TooFewTailSamples { threshold: f64, got: usize },
    DegenerateAlpha(f64),
}

impl std::fmt::Display for TailFitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidCap(v) => {
                write!(f, "cap must be a non-negative finite number, got {v}")
            }
            Self::InvalidProbability(v) => {
                write!(f, "negative or NaN probability for value {v}")
            }
            Self::InvalidThreshold(v) => write!(f, "threshold must be > 0, got {v}"),
            Self::TooFewTailSamples { threshold, got } => write!(
                f,
                "need at least 5 samples above threshold {threshold}, got {got}"
            ),
            Self::DegenerateAlpha(v) => write!(f, "degenerate MLE alpha={v}"),
        }
    }
}

impl std::error::Error for TailFitError {}

/// Clip an empirical win distribution at a max-win cap.
///
/// Strict-inequality semantics: `value > cap` is clipped, `value == cap` is
/// left untouched (matches UKGC SI 2025/215 inclusive-cap wording).
pub fn clip_distribution(wins: &[WinDistEntry], cap: f64) -> Result<ClipResult, TailFitError> {
    if !cap.is_finite() || cap < 0.0 {
        return Err(TailFitError::InvalidCap(cap));
    }
    if wins.is_empty() {
        return Ok(ClipResult {
            rtp_capped: 0.0,
            rtp_uncapped: 0.0,
            rtp_lost: 0.0,
            probability_mass_above: 0.0,
            conditional_mean_above: f64::NAN,
            cap_active: false,
        });
    }
    let mut total_p = 0.0_f64;
    for w in wins {
        // NaN-safe: only accept probabilities that are explicitly ≥ 0.
        if w.probability.is_nan() || w.probability < 0.0 {
            return Err(TailFitError::InvalidProbability(w.value));
        }
        total_p += w.probability;
    }
    if total_p <= 0.0 {
        return Ok(ClipResult {
            rtp_capped: 0.0,
            rtp_uncapped: 0.0,
            rtp_lost: 0.0,
            probability_mass_above: 0.0,
            conditional_mean_above: f64::NAN,
            cap_active: false,
        });
    }

    let mut rtp_uncapped = 0.0_f64;
    let mut rtp_capped = 0.0_f64;
    let mut mass_above = 0.0_f64;
    let mut sum_above = 0.0_f64;
    for w in wins {
        let p = w.probability / total_p;
        rtp_uncapped += p * w.value;
        if w.value > cap {
            rtp_capped += p * cap;
            mass_above += p;
            sum_above += p * w.value;
        } else {
            rtp_capped += p * w.value;
        }
    }
    let conditional = if mass_above > 0.0 {
        sum_above / mass_above
    } else {
        f64::NAN
    };

    Ok(ClipResult {
        rtp_uncapped,
        rtp_capped,
        rtp_lost: rtp_uncapped - rtp_capped,
        probability_mass_above: mass_above,
        conditional_mean_above: conditional,
        cap_active: mass_above > 0.0,
    })
}

// ─── Pareto tail fit (POT MLE) ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ParetoFit {
    pub alpha: f64,
    pub xm: f64,
    pub tail_count: usize,
    pub ks_statistic: f64,
    pub ks_p_value: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct ParetoFitOpts {
    pub bootstrap_reps: usize,
    pub bootstrap_seed: u64,
}

impl Default for ParetoFitOpts {
    fn default() -> Self {
        Self {
            bootstrap_reps: 200,
            bootstrap_seed: 0x_c0_ff_ee,
        }
    }
}

/// MLE Pareto fit on samples above a threshold.
///
/// Estimator: `α̂ = n / Σ ln(x_i / xm)`, KS p-value via bootstrap.
pub fn fit_pareto_tail(
    samples: &[f64],
    threshold: f64,
    opts: ParetoFitOpts,
) -> Result<ParetoFit, TailFitError> {
    if !threshold.is_finite() || threshold <= 0.0 {
        return Err(TailFitError::InvalidThreshold(threshold));
    }
    let tail: Vec<f64> = samples
        .iter()
        .copied()
        .filter(|s| s.is_finite() && *s > threshold)
        .collect();
    if tail.len() < 5 {
        return Err(TailFitError::TooFewTailSamples {
            threshold,
            got: tail.len(),
        });
    }

    let mut sum_log = 0.0_f64;
    for v in &tail {
        sum_log += (*v / threshold).ln();
    }
    let alpha = tail.len() as f64 / sum_log;
    if !alpha.is_finite() || alpha <= 0.0 {
        return Err(TailFitError::DegenerateAlpha(alpha));
    }

    let ks = ks_pareto_statistic(&tail, alpha, threshold);
    let p_value = bootstrap_ks_p_value(
        tail.len(),
        alpha,
        threshold,
        ks,
        opts.bootstrap_reps,
        opts.bootstrap_seed,
    );

    Ok(ParetoFit {
        alpha,
        xm: threshold,
        tail_count: tail.len(),
        ks_statistic: ks,
        ks_p_value: p_value,
    })
}

// ─── EVT quantile inverse ─────────────────────────────────────────────────────

/// Inverse Pareto CDF — returns the win level `x` such that `P(X > x) = q`.
///
/// Clamps to `xm` if `q > 1` to keep callers safe from invalid inputs.
pub fn evt_tail_quantile(alpha: f64, xm: f64, q: f64) -> Result<f64, TailFitError> {
    if alpha.is_nan() || alpha <= 0.0 {
        return Err(TailFitError::DegenerateAlpha(alpha));
    }
    if xm.is_nan() || xm <= 0.0 {
        return Err(TailFitError::InvalidThreshold(xm));
    }
    if q.is_nan() || q <= 0.0 || q > 1.0 {
        return Ok(xm);
    }
    Ok(xm * q.powf(-1.0 / alpha))
}

// ─── Internals ────────────────────────────────────────────────────────────────

fn ks_pareto_statistic(tail: &[f64], alpha: f64, xm: f64) -> f64 {
    let mut sorted: Vec<f64> = tail.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len() as f64;
    let mut d_max = 0.0_f64;
    for (i, x) in sorted.iter().enumerate() {
        let cdf = 1.0 - (xm / *x).powf(alpha);
        let emp_low = (i as f64) / n;
        let emp_high = ((i + 1) as f64) / n;
        let d_low = (cdf - emp_low).abs();
        let d_high = (emp_high - cdf).abs();
        if d_low > d_max {
            d_max = d_low;
        }
        if d_high > d_max {
            d_max = d_high;
        }
    }
    d_max
}

fn bootstrap_ks_p_value(
    n: usize,
    alpha: f64,
    xm: f64,
    observed: f64,
    reps: usize,
    seed: u64,
) -> f64 {
    let mut s = seed as u32;
    let mut next = || {
        s = s.wrapping_add(0x6d2b79f5);
        let mut t = s;
        t = t.wrapping_mul(t | 1) ^ (t.rotate_right(15));
        t = t.wrapping_add(t.wrapping_mul(t | 61) ^ (t.rotate_right(7)));
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    };
    let mut ge = 0_usize;
    for _ in 0..reps {
        let mut synth = vec![0.0_f64; n];
        for v in &mut synth {
            let u = (1.0 - next()).max(1e-12);
            *v = xm * u.powf(-1.0 / alpha);
        }
        let ks_r = ks_pareto_statistic(&synth, alpha, xm);
        if ks_r >= observed {
            ge += 1;
        }
    }
    (ge as f64) / (reps as f64)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() < tol
    }

    #[test]
    fn clip_no_op_when_cap_above_support() {
        let wins = vec![
            WinDistEntry {
                value: 0.0,
                probability: 0.7,
            },
            WinDistEntry {
                value: 1.0,
                probability: 0.2,
            },
            WinDistEntry {
                value: 10.0,
                probability: 0.1,
            },
        ];
        let r = clip_distribution(&wins, 1_000.0).unwrap();
        assert!(!r.cap_active);
        assert!(approx(r.rtp_lost, 0.0, 1e-12));
        assert!(approx(r.rtp_capped, r.rtp_uncapped, 1e-12));
    }

    #[test]
    fn clip_clips_tail_at_cap() {
        let wins = vec![
            WinDistEntry {
                value: 0.0,
                probability: 0.5,
            },
            WinDistEntry {
                value: 100.0,
                probability: 0.4,
            },
            WinDistEntry {
                value: 10_000.0,
                probability: 0.1,
            },
        ];
        let r = clip_distribution(&wins, 5_000.0).unwrap();
        assert!(r.cap_active);
        assert!(approx(r.probability_mass_above, 0.1, 1e-12));
        assert!(approx(r.conditional_mean_above, 10_000.0, 1e-9));
        assert!(approx(r.rtp_uncapped, 1040.0, 1e-9));
        assert!(approx(r.rtp_capped, 540.0, 1e-9));
        assert!(approx(r.rtp_lost, 500.0, 1e-9));
    }

    #[test]
    fn clip_normalises_un_normalised_input() {
        let wins = vec![
            WinDistEntry {
                value: 0.0,
                probability: 7.0,
            },
            WinDistEntry {
                value: 100.0,
                probability: 3.0,
            },
        ];
        let r = clip_distribution(&wins, 200.0).unwrap();
        assert!(approx(r.rtp_uncapped, 30.0, 1e-9));
    }

    #[test]
    fn clip_strict_inequality_at_boundary() {
        let wins = vec![WinDistEntry {
            value: 100.0,
            probability: 1.0,
        }];
        let r = clip_distribution(&wins, 100.0).unwrap();
        assert!(!r.cap_active);
        assert!(approx(r.rtp_capped, 100.0, 1e-12));
    }

    #[test]
    fn clip_rejects_negative_cap() {
        let err = clip_distribution(&[], -5.0).unwrap_err();
        matches!(err, TailFitError::InvalidCap(_));
    }

    fn synthetic_pareto(n: usize, alpha: f64, xm: f64, seed: u64) -> Vec<f64> {
        let mut s = seed as u32;
        let mut next = || {
            s = s.wrapping_add(0x6d2b79f5);
            let mut t = s;
            t = t.wrapping_mul(t | 1) ^ (t.rotate_right(15));
            t = t.wrapping_add(t.wrapping_mul(t | 61) ^ (t.rotate_right(7)));
            ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
        };
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            let u = (1.0 - next()).max(1e-9);
            out.push(xm * u.powf(-1.0 / alpha));
        }
        out
    }

    #[test]
    fn pareto_fit_recovers_alpha_within_10pct() {
        let samples = synthetic_pareto(5_000, 2.0, 10.0, 0xCAFE_BABE);
        let fit = fit_pareto_tail(&samples, 10.0, ParetoFitOpts::default()).unwrap();
        let rel = (fit.alpha - 2.0).abs() / 2.0;
        assert!(rel < 0.1, "rel={rel} alpha={}", fit.alpha);
        assert!(approx(fit.xm, 10.0, 1e-12));
    }

    #[test]
    fn pareto_fit_recovers_heavy_tail() {
        let samples = synthetic_pareto(3_000, 1.2, 5.0, 0xDEAD_BEEF);
        let fit = fit_pareto_tail(&samples, 5.0, ParetoFitOpts::default()).unwrap();
        let rel = (fit.alpha - 1.2).abs() / 1.2;
        assert!(rel < 0.15, "rel={rel} alpha={}", fit.alpha);
    }

    #[test]
    fn pareto_fit_rejects_too_few_samples() {
        let samples = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let err = fit_pareto_tail(&samples, 10.0, ParetoFitOpts::default()).unwrap_err();
        assert!(matches!(err, TailFitError::TooFewTailSamples { .. }));
    }

    #[test]
    fn pareto_fit_p_value_in_unit_interval() {
        let samples = synthetic_pareto(1_000, 2.0, 10.0, 0x1234_5678);
        let fit = fit_pareto_tail(
            &samples,
            10.0,
            ParetoFitOpts {
                bootstrap_reps: 100,
                bootstrap_seed: 0xfeed_face,
            },
        )
        .unwrap();
        assert!(fit.ks_p_value >= 0.0 && fit.ks_p_value <= 1.0);
    }

    #[test]
    fn evt_quantile_round_trip() {
        // alpha=2, xm=10, q=0.01 → 10 × 100 = 100
        let v = evt_tail_quantile(2.0, 10.0, 0.01).unwrap();
        assert!(approx(v, 100.0, 1e-9));
    }

    #[test]
    fn evt_quantile_clamps_for_q_gt_one() {
        assert!(approx(evt_tail_quantile(2.0, 50.0, 1.5).unwrap(), 50.0, 1e-12));
    }

    #[test]
    fn evt_quantile_rejects_bad_alpha() {
        assert!(evt_tail_quantile(0.0, 10.0, 0.1).is_err());
    }

    #[test]
    fn evt_quantile_rejects_bad_xm() {
        assert!(evt_tail_quantile(2.0, 0.0, 0.1).is_err());
    }
}
