//! W7.10 — Anomaly Self-Play Detector.
//!
//! Sweeps the parameter space of a slot configuration looking for
//! **un-seen RTP holes** — combinations of (anchor_weight, paylines,
//! bet_multiplier, ...) that drift the simulated RTP > k·σ from the
//! closed-form target. Surface the worst-offenders to the designer as
//! "anomaly candidates" with auto-fix suggestions (which knob to turn
//! and by how much).
//!
//! Why this matters: traditional QA runs ONE config × N seeds. The
//! self-play detector runs N × M configs × K seeds and uses Bayesian
//! outlier scoring (z-score relative to the per-config fan + global
//! drift surface) to find combos a human would never have probed.
//! Cross-checked with the W6.3 fault-injection harness — that catches
//! RNG-side anomalies; this catches **spec-side** anomalies (the math
//! itself has a hole nobody noticed).
//!
//! Design:
//!
//! * Reuse [`crate::qmc_estimator::LinesEvalSpec`] as the spec shape.
//! * Build a parameter sweep over a base spec by varying one or more
//!   `Knob` axes (anchor weight, paylines, bet multiplier).
//! * For each parameter combination, run a 5-seed RTP fan via
//!   [`crate::fault_injection::seed_sweep_rtp_fan`], compute the delta
//!   between fan mean and closed-form target, and z-score that delta
//!   relative to the global distribution of deltas across all configs.
//! * Emit ranked anomalies (top-K by |z|) with a structured `cause`
//!   field naming the suspect knob.

use crate::fault_injection::seed_sweep_rtp_fan;
use crate::qmc_estimator::LinesEvalSpec;
use crate::rng::RngKind;
use serde::{Deserialize, Serialize};

/// Single configurable knob in the sweep.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Knob {
    pub name: String,
    pub values: Vec<f64>,
}

/// One probed configuration in the sweep.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeConfig {
    pub knob_values: Vec<(String, f64)>,
    pub closed_form_rtp: f64,
    pub measured_mean_rtp: f64,
    pub measured_stddev_rtp: f64,
    /// (measured_mean - closed_form) in RTP units.
    pub delta: f64,
}

/// One detected anomaly = high |z| probe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anomaly {
    pub probe: ProbeConfig,
    pub z_score: f64,
    /// The knob whose value sits closest to either tail of the sweep
    /// range — the suggested "knob to dial down" first.
    pub suspect_knob: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyReport {
    pub probe_count: u32,
    pub anomalies: Vec<Anomaly>,
    pub global_delta_mean: f64,
    pub global_delta_stddev: f64,
}

// ─── Spec mutation helpers ──────────────────────────────────────────

/// Apply a single (knob, value) override to a clone of `base`.
///
/// Supported knob names:
/// * `"anchor_weight"` — set the anchor symbol's weight on every reel.
/// * `"paylines"` — set the paylines field.
/// * `"bet"` — set the bet basis.
pub fn apply_knob(base: &LinesEvalSpec, name: &str, value: f64) -> LinesEvalSpec {
    let mut spec = base.clone();
    match name {
        "anchor_weight" => {
            for reel in spec.reels.iter_mut() {
                if let Some(slot) = reel.get_mut(spec.anchor) {
                    *slot = value.max(0.01);
                }
            }
        }
        "paylines" => {
            spec.paylines = value.round().max(1.0) as usize;
        }
        "bet" => {
            spec.bet = value.max(0.01);
        }
        _ => {
            // Unknown knob — no-op; the caller is responsible for filtering.
        }
    }
    spec
}

// ─── Self-play sweep ────────────────────────────────────────────────

/// Run a Cartesian-product sweep over `knobs` against `base`. Each
/// probe runs a small seed fan (default 5 seeds) and records
/// `(mean, stddev, delta)`. Aggregates the global delta distribution
/// to score anomalies.
pub fn run_self_play_sweep(
    base: &LinesEvalSpec,
    knobs: &[Knob],
    seeds_per_probe: u32,
    spins_per_seed: u64,
    rng_kind: RngKind,
    z_threshold: f64,
    top_k: usize,
) -> AnomalyReport {
    let combos = cartesian_product(knobs);
    let mut probes: Vec<ProbeConfig> = Vec::with_capacity(combos.len());

    for combo in &combos {
        let mut spec = base.clone();
        for (name, val) in combo {
            spec = apply_knob(&spec, name, *val);
        }
        let cf = spec.closed_form_rtp();
        let fan = seed_sweep_rtp_fan(&spec, seeds_per_probe, spins_per_seed, 1, rng_kind);
        let mean = fan.fan_mean_rtp;
        let stddev = fan.fan_stddev_rtp;
        let delta = mean - cf;
        probes.push(ProbeConfig {
            knob_values: combo.clone(),
            closed_form_rtp: cf,
            measured_mean_rtp: mean,
            measured_stddev_rtp: stddev,
            delta,
        });
    }

    let deltas: Vec<f64> = probes.iter().map(|p| p.delta).collect();
    let (gmean, gstd) = mean_and_sample_stddev(&deltas);

    let mut anomalies: Vec<Anomaly> = probes
        .iter()
        .filter_map(|p| {
            let z = if gstd > 0.0 { (p.delta - gmean) / gstd } else { 0.0 };
            if z.abs() < z_threshold || !z.is_finite() {
                return None;
            }
            let (suspect, suggestion) = pick_suspect_knob(p, knobs);
            Some(Anomaly {
                probe: p.clone(),
                z_score: z,
                suspect_knob: suspect,
                suggestion,
            })
        })
        .collect();
    anomalies.sort_by(|a, b| b.z_score.abs().partial_cmp(&a.z_score.abs()).unwrap());
    anomalies.truncate(top_k);

    AnomalyReport {
        probe_count: probes.len() as u32,
        anomalies,
        global_delta_mean: gmean,
        global_delta_stddev: gstd,
    }
}

fn cartesian_product(knobs: &[Knob]) -> Vec<Vec<(String, f64)>> {
    if knobs.is_empty() {
        return vec![vec![]];
    }
    let mut combos: Vec<Vec<(String, f64)>> = vec![vec![]];
    for knob in knobs {
        let mut next: Vec<Vec<(String, f64)>> = Vec::with_capacity(combos.len() * knob.values.len());
        for partial in &combos {
            for v in &knob.values {
                let mut copy = partial.clone();
                copy.push((knob.name.clone(), *v));
                next.push(copy);
            }
        }
        combos = next;
    }
    combos
}

fn pick_suspect_knob(probe: &ProbeConfig, knobs: &[Knob]) -> (String, String) {
    // Heuristic: identify the knob whose value sits at the extreme of
    // its sweep range (top or bottom 25%) — that's the most likely
    // culprit for any RTP-mean drift.
    let mut best: Option<(String, f64, String)> = None;
    for (name, val) in &probe.knob_values {
        let knob = match knobs.iter().find(|k| &k.name == name) {
            Some(k) => k,
            None => continue,
        };
        let vmin = knob.values.iter().cloned().fold(f64::INFINITY, f64::min);
        let vmax = knob.values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        if vmax == vmin {
            continue;
        }
        let pos = (val - vmin) / (vmax - vmin);
        let extremity = (pos - 0.5).abs() * 2.0;
        let suggestion = if pos > 0.75 {
            format!("dial knob `{name}` DOWN toward {vmin:.4}")
        } else if pos < 0.25 {
            format!("dial knob `{name}` UP toward {vmax:.4}")
        } else {
            format!("knob `{name}` ≈ midpoint; check interaction with neighbours")
        };
        match best.as_ref() {
            None => best = Some((name.clone(), extremity, suggestion)),
            Some((_, prev_e, _)) if extremity > *prev_e => {
                best = Some((name.clone(), extremity, suggestion))
            }
            _ => {}
        }
    }
    match best {
        Some((name, _, suggestion)) => (name, suggestion),
        None => ("<unknown>".to_string(), "no obvious extremity".to_string()),
    }
}

fn mean_and_sample_stddev(xs: &[f64]) -> (f64, f64) {
    let n = xs.len() as f64;
    if n == 0.0 {
        return (0.0, 0.0);
    }
    let mean = xs.iter().sum::<f64>() / n;
    if n == 1.0 {
        return (mean, 0.0);
    }
    let var = xs
        .iter()
        .map(|x| {
            let d = x - mean;
            d * d
        })
        .sum::<f64>()
        / (n - 1.0);
    (mean, var.sqrt())
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn classic_spec() -> LinesEvalSpec {
        LinesEvalSpec {
            reels: vec![vec![4.0_f64, 6.0_f64]; 5],
            paytable: vec![vec![1.0_f64, 4.0_f64, 10.0_f64], vec![]],
            min_match: 3,
            paylines: 20,
            bet: 1.0,
            anchor: 0,
        }
    }

    #[test]
    fn apply_knob_anchor_weight_propagates_to_all_reels() {
        let base = classic_spec();
        let probed = apply_knob(&base, "anchor_weight", 9.0);
        for reel in &probed.reels {
            assert_eq!(reel[0], 9.0);
        }
    }

    #[test]
    fn apply_knob_paylines_clamps_to_at_least_one() {
        let base = classic_spec();
        let probed = apply_knob(&base, "paylines", 0.4);
        assert_eq!(probed.paylines, 1);
    }

    #[test]
    fn apply_knob_unknown_is_noop() {
        let base = classic_spec();
        let probed = apply_knob(&base, "no_such_knob", 999.0);
        assert_eq!(probed.paylines, base.paylines);
        assert_eq!(probed.reels[0][0], base.reels[0][0]);
    }

    #[test]
    fn cartesian_product_size_matches_factor_count() {
        let knobs = vec![
            Knob { name: "a".into(), values: vec![1.0, 2.0] },
            Knob { name: "b".into(), values: vec![10.0, 20.0, 30.0] },
        ];
        let combos = cartesian_product(&knobs);
        assert_eq!(combos.len(), 2 * 3);
    }

    #[test]
    fn cartesian_product_with_no_knobs_returns_single_empty_combo() {
        let combos = cartesian_product(&[]);
        assert_eq!(combos.len(), 1);
        assert!(combos[0].is_empty());
    }

    #[test]
    fn self_play_sweep_finishes_and_returns_finite_stats() {
        let base = classic_spec();
        let knobs = vec![
            Knob {
                name: "anchor_weight".into(),
                values: vec![1.0, 4.0, 9.0],
            },
            Knob {
                name: "paylines".into(),
                values: vec![10.0, 20.0],
            },
        ];
        let report = run_self_play_sweep(
            &base, &knobs, 3, 500, RngKind::Pcg64, 2.0, 5,
        );
        assert_eq!(report.probe_count, 6);
        assert!(report.global_delta_mean.is_finite());
        assert!(report.global_delta_stddev.is_finite());
    }

    #[test]
    fn self_play_sweep_no_anomalies_when_z_threshold_high() {
        let base = classic_spec();
        let knobs = vec![Knob {
            name: "anchor_weight".into(),
            values: vec![3.0, 4.0, 5.0],
        }];
        let report = run_self_play_sweep(
            &base, &knobs, 5, 800, RngKind::Pcg64, 10.0, 10,
        );
        assert!(report.anomalies.is_empty());
    }

    #[test]
    fn self_play_sweep_anomalies_sorted_by_abs_z() {
        let base = classic_spec();
        let knobs = vec![Knob {
            name: "anchor_weight".into(),
            values: vec![0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0],
        }];
        let report = run_self_play_sweep(
            &base, &knobs, 3, 500, RngKind::Pcg64, 0.1, 5,
        );
        for window in report.anomalies.windows(2) {
            assert!(window[0].z_score.abs() >= window[1].z_score.abs());
        }
    }

    #[test]
    fn suspect_knob_points_at_extreme_value() {
        let knobs = vec![Knob {
            name: "anchor_weight".into(),
            values: vec![1.0, 2.0, 4.0, 8.0, 16.0],
        }];
        let probe = ProbeConfig {
            knob_values: vec![("anchor_weight".into(), 16.0)],
            closed_form_rtp: 50.0,
            measured_mean_rtp: 60.0,
            measured_stddev_rtp: 1.0,
            delta: 10.0,
        };
        let (suspect, suggestion) = pick_suspect_knob(&probe, &knobs);
        assert_eq!(suspect, "anchor_weight");
        assert!(suggestion.contains("DOWN"));
    }

    #[test]
    fn run_full_report_is_deterministic() {
        let base = classic_spec();
        let knobs = vec![Knob {
            name: "anchor_weight".into(),
            values: vec![3.0, 4.0, 5.0],
        }];
        let a = run_self_play_sweep(&base, &knobs, 3, 400, RngKind::Pcg64, 1.0, 5);
        let b = run_self_play_sweep(&base, &knobs, 3, 400, RngKind::Pcg64, 1.0, 5);
        assert_eq!(a.probe_count, b.probe_count);
        assert_eq!(a.anomalies.len(), b.anomalies.len());
        for (x, y) in a.anomalies.iter().zip(b.anomalies.iter()) {
            assert_eq!(x.z_score, y.z_score);
        }
    }
}
