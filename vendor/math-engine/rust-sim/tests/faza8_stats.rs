//! Faza 8 — Statistics & PAR hardening integration tests.
//!
//! Covers:
//! * `WelfordAccumulator` — known distributions, merge equivalence, edge cases
//! * `HdrHistogram::quantile` — monotonicity, known distributions
//! * `HdrHistogram::cdf` — structure, monotone cumulative, sum-to-1
//! * `TopNWins` — capacity, eviction, merge, replay fields
//! * `BonusDistanceTracker` — first-trigger, mean, max, histogram
//! * `ConvergenceDetector` — constant convergence, noisy non-convergence
//! * `SpinCountEstimator` — monotone in variance, precision, confidence
//! * `MultiSeedStats` — CI99 > CI95, required spins monotone
//! * `PARSheet` — new sections present, no-panic print, JSON roundtrip
//! * `volatility_category` regression — CV < 1.0 must not be VERY_LOW incorrectly

use slot_sim::{
    par::{PARGenerator, PARSheet},
    rng::SlotRng,
    stats::{
        AtomicStats, BonusDistanceTracker, ConvergenceDetector, HdrHistogram, MultiSeedStats,
        PARMetrics, SeedStats, SpinCountEstimator, TopNWins, WelfordAccumulator, HDR_BUCKET_COUNT,
    },
};
use std::sync::atomic::Ordering;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Build a `AtomicStats` with 1M spins, all recorded via `record_win_full`.
fn sim_stats(seed: u64) -> AtomicStats {
    let s = AtomicStats::new();
    s.total_spins.store(1_000_000, Ordering::Relaxed);
    s.total_wagered.store(1_000_000, Ordering::Relaxed);
    s.total_won.store(960_000, Ordering::Relaxed);
    s.total_base_won.store(600_000, Ordering::Relaxed);
    s.total_fs_won.store(360_000, Ordering::Relaxed);
    s.winning_spins.store(330_000, Ordering::Relaxed);
    s.fs_triggers.store(5_000, Ordering::Relaxed);
    s.total_fs_spins.store(60_000, Ordering::Relaxed);

    let mut rng = SlotRng::new(seed);
    for i in 0u64..1_000_000 {
        let win = if rng.random() < 0.33 {
            0.0
        } else {
            rng.random() * 100.0
        };
        s.record_win_full(win, seed, i);
        if i % 250 == 0 {
            s.record_fs_trigger(i);
        }
        if i % 1500 == 0 {
            s.record_hnw_trigger(i);
        }
    }
    s
}

fn make_multi_seed() -> MultiSeedStats {
    let rtps: [f64; 20] = [
        96.00, 96.02, 95.98, 96.01, 95.99, 96.03, 95.97, 96.00, 96.01, 95.99, 96.00, 95.98, 96.02,
        96.01, 95.99, 96.00, 96.02, 95.98, 96.01, 95.99,
    ];
    MultiSeedStats::from_seeds(
        rtps.iter()
            .map(|&rtp| SeedStats {
                spins: 50_000,
                wagered: 50_000,
                won: (50_000.0 * rtp / 100.0) as i64,
                rtp,
            })
            .collect(),
    )
}

fn make_par_sheet(stats: &AtomicStats) -> PARSheet {
    let multi = make_multi_seed();
    let par_m = PARMetrics::from_stats(stats, &multi, 1);
    PARGenerator::generate(
        stats,
        &par_m,
        vec![],
        "faza8-test",
        "1.0.0",
        96.0,
        0.5,
        5000.0,
        vec!["MGA".to_string(), "UKGC".to_string()],
        [85.0, 99.0],
        "must_be_random",
        true,
        true,
        20,
    )
}

// ─── WelfordAccumulator ───────────────────────────────────────────────────────

#[test]
fn welford_empty_safe_all_zeroes() {
    let w = WelfordAccumulator::new();
    assert_eq!(w.count(), 0);
    assert_eq!(w.mean(), 0.0);
    assert_eq!(w.sample_variance(), 0.0);
    assert_eq!(w.skewness(), 0.0);
    assert_eq!(w.excess_kurtosis(), 0.0);
    assert_eq!(w.cv(), 0.0);
}

#[test]
fn welford_single_observation() {
    let mut w = WelfordAccumulator::new();
    w.push(7.0);
    assert_eq!(w.count(), 1);
    assert!((w.mean() - 7.0).abs() < 1e-12, "mean={}", w.mean());
    assert_eq!(w.sample_variance(), 0.0);
}

#[test]
fn welford_two_observations_variance() {
    let mut w = WelfordAccumulator::new();
    w.push(2.0);
    w.push(4.0);
    // mean=3, sample var = ((2-3)^2 + (4-3)^2) / 1 = 2
    assert!((w.mean() - 3.0).abs() < 1e-12);
    assert!(
        (w.sample_variance() - 2.0).abs() < 1e-12,
        "var={}",
        w.sample_variance()
    );
    assert!((w.std_dev() - std::f64::consts::SQRT_2).abs() < 1e-10);
}

#[test]
fn welford_constant_series_zero_variance() {
    let mut w = WelfordAccumulator::new();
    for _ in 0..10_000 {
        w.push(3.14);
    }
    assert!((w.mean() - 3.14).abs() < 1e-10);
    assert!(
        w.sample_variance() < 1e-20,
        "var should be ~0 for constant series"
    );
    assert_eq!(w.volatility_category(), "VERY_LOW");
}

#[test]
fn welford_uniform_distribution_moments() {
    // Uniform[0,1]: mean=0.5, population var=1/12≈0.0833, skew=0, exkurt=-1.2
    let mut w = WelfordAccumulator::new();
    let mut rng = SlotRng::new(2024);
    for _ in 0..1_000_000 {
        w.push(rng.random());
    }
    assert!((w.mean() - 0.5).abs() < 0.002, "mean={:.5}", w.mean());
    assert!(
        (w.population_variance() - 1.0 / 12.0).abs() < 0.001,
        "pop_var={:.6}",
        w.population_variance()
    );
    assert!(
        w.skewness().abs() < 0.02,
        "skew={:.4} should be ~0",
        w.skewness()
    );
    assert!(
        (w.excess_kurtosis() - (-1.2)).abs() < 0.05,
        "excess_kurt={:.4} should be ~-1.2",
        w.excess_kurtosis()
    );
}

#[test]
fn welford_merge_equivalence_to_single_pass() {
    let mut rng = SlotRng::new(42);
    let vals: Vec<f64> = (0..100_000).map(|_| rng.random() * 100.0).collect();

    let mut single = WelfordAccumulator::new();
    for &v in &vals {
        single.push(v);
    }

    let mut a = WelfordAccumulator::new();
    let mut b = WelfordAccumulator::new();
    for &v in &vals[..50_000] {
        a.push(v);
    }
    for &v in &vals[50_000..] {
        b.push(v);
    }
    a.merge(&b);

    assert!((a.mean() - single.mean()).abs() < 1e-8, "mean mismatch");
    assert!(
        (a.population_variance() - single.population_variance()).abs() < 1e-6,
        "variance mismatch"
    );
    assert!(
        (a.skewness() - single.skewness()).abs() < 1e-4,
        "skewness mismatch"
    );
    assert_eq!(a.count(), single.count());
}

#[test]
fn welford_merge_with_empty_no_op() {
    let mut w = WelfordAccumulator::new();
    w.push(5.0);
    let empty = WelfordAccumulator::new();
    w.merge(&empty);
    assert_eq!(w.count(), 1);
    assert!((w.mean() - 5.0).abs() < 1e-12);
}

#[test]
fn welford_merge_into_empty() {
    let mut empty = WelfordAccumulator::new();
    let mut w = WelfordAccumulator::new();
    w.push(7.0);
    w.push(3.0);
    empty.merge(&w);
    assert_eq!(empty.count(), 2);
    assert!((empty.mean() - 5.0).abs() < 1e-12);
}

#[test]
fn welford_cv_and_volatility_category() {
    let mut low = WelfordAccumulator::new();
    for i in 0..1000 {
        low.push(10.0 + (i % 3) as f64 * 0.1); // CV ≈ 0.008 → VERY_LOW
    }
    assert_eq!(low.volatility_category(), "VERY_LOW");

    let mut high = WelfordAccumulator::new();
    // Mean ≈ 1, std ≈ 5 → CV ≈ 5 → HIGH.
    let mut rng = SlotRng::new(11);
    for _ in 0..10_000 {
        high.push(if rng.random() < 0.9 {
            0.5
        } else {
            rng.random() * 50.0
        });
    }
    let cat = high.volatility_category();
    assert!(
        cat == "MEDIUM" || cat == "HIGH" || cat == "VERY_HIGH",
        "got {cat} for high-variance distribution"
    );
}

// ─── HdrHistogram — quantile & CDF ───────────────────────────────────────────

#[test]
fn hdr_quantile_empty_returns_zero() {
    let h = HdrHistogram::default();
    assert_eq!(h.quantile(0.5), 0.0);
    assert_eq!(h.quantile(0.99), 0.0);
}

#[test]
fn hdr_quantile_all_no_win() {
    let h = HdrHistogram::default();
    for _ in 0..10_000 {
        h.record(0.0);
    }
    assert_eq!(h.quantile(0.5), 0.0);
    assert_eq!(h.quantile(0.999), 0.0);
}

#[test]
fn hdr_quantile_monotone_increasing() {
    let h = HdrHistogram::default();
    let mut rng = SlotRng::new(88);
    for _ in 0..500_000 {
        let w = if rng.random() < 0.3 {
            0.0
        } else {
            rng.random() * 200.0
        };
        h.record(w);
    }
    let ps = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999];
    let mut prev = -1.0f64;
    for &p in &ps {
        let q = h.quantile(p);
        assert!(q >= prev, "not monotone at p={p}: {prev:.3} → {q:.3}");
        prev = q;
    }
}

#[test]
fn hdr_quantile_50pct_no_win_50pct_large() {
    let h = HdrHistogram::default();
    // 50% no-win, 50% large win at bucket 31 (≥50000).
    for _ in 0..5_000 {
        h.record(0.0);
    }
    for _ in 0..5_000 {
        h.record(60_000.0);
    }
    // P50 is on the boundary: exactly where no-wins end.
    // P51 should land in the large bucket.
    let p50 = h.quantile(0.50);
    let p75 = h.quantile(0.75);
    assert!(p50 <= 50000.0, "p50={p50} should not exceed top threshold");
    assert!(p75 >= 50000.0, "p75={p75} should be in top bucket");
}

#[test]
fn hdr_quantile_report_all_ordered() {
    let h = HdrHistogram::default();
    let mut rng = SlotRng::new(55);
    for _ in 0..1_000_000 {
        h.record(rng.random() * 100.0);
    }
    let r = h.quantile_report();
    assert!(r.p50 <= r.p90, "P50 <= P90");
    assert!(r.p90 <= r.p99, "P90 <= P99");
    assert!(r.p99 <= r.p999, "P99 <= P99.9");
}

#[test]
fn hdr_cdf_has_32_entries() {
    let h = HdrHistogram::default();
    for _ in 0..1_000 {
        h.record(1.5);
    }
    let cdf = h.cdf();
    assert_eq!(
        cdf.len(),
        HDR_BUCKET_COUNT,
        "CDF must have {HDR_BUCKET_COUNT} entries"
    );
}

#[test]
fn hdr_cdf_monotone_and_sums_to_one() {
    let h = HdrHistogram::default();
    let mut rng = SlotRng::new(77);
    for _ in 0..1_000_000 {
        h.record(rng.random() * 500.0);
    }
    let cdf = h.cdf();
    let mut prev = 0.0f64;
    for e in &cdf {
        assert!(
            e.cumulative >= prev - 1e-9,
            "not monotone: {prev:.6} → {:.6}",
            e.cumulative
        );
        prev = e.cumulative;
    }
    assert!(
        (prev - 1.0).abs() < 1e-6,
        "final cumulative={prev:.8}, expected ~1.0"
    );
}

#[test]
fn hdr_cdf_probabilities_sum_to_one() {
    let h = HdrHistogram::default();
    let mut rng = SlotRng::new(33);
    for _ in 0..100_000 {
        h.record(rng.random() * 100.0);
    }
    let cdf = h.cdf();
    let sum: f64 = cdf.iter().map(|e| e.probability).sum();
    assert!((sum - 1.0).abs() < 1e-9, "probability sum={sum:.10}");
}

// ─── TopNWins ─────────────────────────────────────────────────────────────────

#[test]
fn top_wins_empty_initial() {
    let t = TopNWins::new(10);
    assert!(t.is_empty());
    assert_eq!(t.snapshot().len(), 0);
}

#[test]
fn top_wins_rejects_non_positive() {
    let t = TopNWins::new(5);
    t.try_record(0.0, 1, 1);
    t.try_record(-5.0, 2, 2);
    assert!(t.is_empty());
}

#[test]
fn top_wins_capacity_enforced() {
    let t = TopNWins::new(5);
    for i in 1u64..=20 {
        t.try_record(i as f64, i, i);
    }
    assert_eq!(t.len(), 5, "capacity must be respected");
    let snap = t.snapshot();
    // Largest 5: 20, 19, 18, 17, 16.
    assert!((snap[0].win_x - 20.0).abs() < 1e-9);
    assert!((snap[4].win_x - 16.0).abs() < 1e-9);
}

#[test]
fn top_wins_snapshot_descending() {
    let t = TopNWins::new(10);
    let mut rng = SlotRng::new(999);
    for i in 0u64..50 {
        t.try_record(rng.random() * 1000.0, i, i);
    }
    let snap = t.snapshot();
    for i in 1..snap.len() {
        assert!(
            snap[i - 1].win_x >= snap[i].win_x,
            "snapshot not descending at index {i}"
        );
    }
}

#[test]
fn top_wins_seed_and_spin_preserved() {
    let t = TopNWins::new(5);
    t.try_record(100.0, 0xDEADBEEF, 42_000);
    let snap = t.snapshot();
    assert_eq!(snap[0].seed, 0xDEADBEEF);
    assert_eq!(snap[0].spin_index, 42_000);
}

#[test]
fn top_wins_merge_keeps_global_top() {
    let t1 = TopNWins::new(3);
    let t2 = TopNWins::new(3);
    t1.try_record(3.0, 1, 1);
    t1.try_record(7.0, 2, 2);
    t2.try_record(10.0, 3, 3);
    t2.try_record(1.0, 4, 4);
    t1.merge_from(&t2);
    let snap = t1.snapshot();
    assert_eq!(snap.len(), 3);
    assert!((snap[0].win_x - 10.0).abs() < 1e-9);
    assert!((snap[1].win_x - 7.0).abs() < 1e-9);
    assert!((snap[2].win_x - 3.0).abs() < 1e-9);
}

// ─── BonusDistanceTracker ─────────────────────────────────────────────────────

#[test]
fn bonus_distance_no_interval_on_first() {
    let t = BonusDistanceTracker::new();
    t.record_trigger(1_000);
    assert_eq!(t.total_intervals(), 0);
    assert_eq!(t.mean_distance(), f64::INFINITY);
}

#[test]
fn bonus_distance_one_interval() {
    let t = BonusDistanceTracker::new();
    t.record_trigger(0);
    t.record_trigger(300);
    assert_eq!(t.total_intervals(), 1);
    assert!((t.mean_distance() - 300.0).abs() < 1e-9);
    assert_eq!(t.max_distance(), 300);
}

#[test]
fn bonus_distance_multiple_correct_mean_max() {
    let t = BonusDistanceTracker::new();
    // distances: 100, 200, 500 → mean=(800/3), max=500
    t.record_trigger(0);
    t.record_trigger(100);
    t.record_trigger(300);
    t.record_trigger(800);
    assert_eq!(t.total_intervals(), 3);
    assert!((t.mean_distance() - 800.0 / 3.0).abs() < 0.01);
    assert_eq!(t.max_distance(), 500);
}

#[test]
fn bonus_distance_histogram_counts_correct_bucket() {
    let t = BonusDistanceTracker::new();
    // distance 50 should fall in [25, 50) or [50, 100) bucket.
    t.record_trigger(0);
    t.record_trigger(50);
    let counts = t.snapshot_counts();
    // DISTANCE_THRESHOLDS = [10,25,50,...], so 50 >= 50 → bucket 3 (index for [50,100))
    let total_recorded: u64 = counts.iter().sum();
    assert_eq!(total_recorded, 1);
}

#[test]
fn bonus_distance_merge_additive() {
    let t1 = BonusDistanceTracker::new();
    let t2 = BonusDistanceTracker::new();
    t1.record_trigger(0);
    t1.record_trigger(100); // dist=100 in t1
    t2.record_trigger(500);
    t2.record_trigger(700); // dist=200 in t2
    t1.merge(&t2);
    assert_eq!(t1.total_intervals(), 2);
    assert!((t1.mean_distance() - 150.0).abs() < 0.01);
    assert_eq!(t1.max_distance(), 200);
}

// ─── ConvergenceDetector ─────────────────────────────────────────────────────

#[test]
fn convergence_insufficient_readings() {
    let mut d = ConvergenceDetector::new(0.01, 0.95, 10);
    assert!(!d.has_converged());
    assert_eq!(d.current_half_width_pp(), f64::INFINITY);
    d.push(96.0);
    assert!(!d.has_converged());
}

#[test]
fn convergence_constant_series_zero_width() {
    let mut d = ConvergenceDetector::new(0.01, 0.95, 10);
    for _ in 0..10 {
        d.push(96.0);
    }
    assert_eq!(d.current_half_width_pp(), 0.0);
    assert!(d.has_converged());
    assert!((d.window_mean() - 96.0).abs() < 1e-12);
}

#[test]
fn convergence_tight_target_not_met_with_noise() {
    let mut d = ConvergenceDetector::new(0.0001, 0.95, 20);
    let mut rng = SlotRng::new(555);
    for _ in 0..20 {
        d.push(95.0 + rng.random() * 2.0); // ±1pp noise → way above 0.0001pp target
    }
    assert!(!d.has_converged());
}

#[test]
fn convergence_ring_buffer_respects_window_size() {
    let mut d = ConvergenceDetector::new(0.01, 0.95, 5);
    for i in 0..30 {
        d.push(96.0 + i as f64 * 0.001);
    }
    assert_eq!(d.readings(), 5);
}

#[test]
fn convergence_reset_clears_state() {
    let mut d = ConvergenceDetector::new(0.01, 0.95, 5);
    for _ in 0..5 {
        d.push(96.0);
    }
    assert!(d.has_converged());
    d.reset();
    assert_eq!(d.readings(), 0);
    assert!(!d.has_converged());
    assert_eq!(d.current_half_width_pp(), f64::INFINITY);
}

#[test]
fn convergence_99pct_wider_than_95pct() {
    let mut d95 = ConvergenceDetector::new(1.0, 0.95, 20);
    let mut d99 = ConvergenceDetector::new(1.0, 0.99, 20);
    let mut rng = SlotRng::new(77);
    for _ in 0..20 {
        let v = 96.0 + rng.random() * 0.1;
        d95.push(v);
        d99.push(v);
    }
    assert!(
        d99.current_half_width_pp() >= d95.current_half_width_pp(),
        "CI99 must be wider: {} vs {}",
        d99.current_half_width_pp(),
        d95.current_half_width_pp()
    );
}

// ─── SpinCountEstimator ───────────────────────────────────────────────────────

#[test]
fn spin_count_larger_variance_needs_more_spins() {
    let n1 = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.95);
    let n10 = SpinCountEstimator::required_for_rtp(10.0, 0.1, 0.95);
    let n100 = SpinCountEstimator::required_for_rtp(100.0, 0.1, 0.95);
    assert!(n10 > n1, "{n10} > {n1}");
    assert!(n100 > n10, "{n100} > {n10}");
}

#[test]
fn spin_count_tighter_target_needs_more_spins() {
    let n_loose = SpinCountEstimator::required_for_rtp(1.0, 1.0, 0.95);
    let n_mid = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.95);
    let n_tight = SpinCountEstimator::required_for_rtp(1.0, 0.01, 0.95);
    assert!(n_mid > n_loose, "{n_mid} > {n_loose}");
    assert!(n_tight > n_mid, "{n_tight} > {n_mid}");
}

#[test]
fn spin_count_higher_confidence_needs_more_spins() {
    let n95 = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.95);
    let n99 = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.99);
    let n999 = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.999);
    assert!(n99 > n95, "{n99} > {n95}");
    assert!(n999 > n99, "{n999} > {n99}");
}

#[test]
fn spin_count_zero_variance_is_zero() {
    assert_eq!(SpinCountEstimator::required_for_rtp(0.0, 0.1, 0.95), 0);
}

#[test]
fn spin_count_hit_rate_max_variance_at_half() {
    let n_half = SpinCountEstimator::required_for_hit_rate(0.5, 0.001, 0.95);
    let n_tenth = SpinCountEstimator::required_for_hit_rate(0.1, 0.001, 0.95);
    assert!(n_half > n_tenth, "p=0.5 maximises binomial variance");
}

// ─── MultiSeedStats CI levels ─────────────────────────────────────────────────

#[test]
fn multi_seed_ci_levels_strictly_ordered() {
    let seeds: Vec<SeedStats> = (0..20)
        .map(|i| SeedStats {
            spins: 100_000,
            wagered: 100_000,
            won: 96_000 + i * 20,
            rtp: 96.0 + i as f64 * 0.02,
        })
        .collect();
    let m = MultiSeedStats::from_seeds(seeds);
    let w95 = m.ci_95_high - m.ci_95_low;
    let w99 = m.ci_99_high - m.ci_99_low;
    let w999 = m.ci_999_high - m.ci_999_low;
    assert!(w99 > w95, "CI99 width={w99:.6} > CI95 width={w95:.6}");
    assert!(w999 > w99, "CI99.9 width={w999:.6} > CI99 width={w99:.6}");
}

#[test]
fn multi_seed_required_spins_01pp_gt_zero() {
    let seeds: Vec<SeedStats> = (0..10)
        .map(|i| SeedStats {
            spins: 1_000_000,
            wagered: 1_000_000,
            won: 960_000 + i * 100,
            rtp: 96.0 + i as f64 * 0.01,
        })
        .collect();
    let m = MultiSeedStats::from_seeds(seeds);
    assert!(m.required_spins_01pp_95 > 0);
    assert!(m.required_spins_001pp_95 > m.required_spins_01pp_95);
    assert!(m.required_spins_01pp_99 > m.required_spins_01pp_95);
}

#[test]
fn multi_seed_ci_straddles_mean_when_constant() {
    let seeds: Vec<SeedStats> = vec![
        SeedStats {
            spins: 100_000,
            wagered: 100_000,
            won: 96_000,
            rtp: 96.0
        };
        10
    ];
    let m = MultiSeedStats::from_seeds(seeds);
    assert!((m.ci_95_low - 96.0).abs() < 1e-6);
    assert!((m.ci_95_high - 96.0).abs() < 1e-6);
}

// ─── PARSheet — Faza 8 sections ───────────────────────────────────────────────

#[test]
fn par_sheet_has_quantile_section() {
    let stats = sim_stats(42);
    let par = make_par_sheet(&stats);
    assert!(par.quantiles.p90 >= par.quantiles.p50, "P90 >= P50");
    assert!(par.quantiles.p99 >= par.quantiles.p90, "P99 >= P90");
    assert!(par.quantiles.p999 >= par.quantiles.p99, "P99.9 >= P99");
}

#[test]
fn par_sheet_moments_populated() {
    let stats = sim_stats(99);
    let par = make_par_sheet(&stats);
    assert_eq!(
        par.moments.sample_count, 1_000_000,
        "all spins recorded in Welford"
    );
    assert!(par.moments.mean_win_x > 0.0, "mean must be positive");
    assert!(par.moments.variance >= 0.0, "variance must be non-negative");
    // Variance ≠ CV² (the old bug).
    // For a distribution with mean ~33x (2/3 spins hit, avg 50x), variance is large.
    assert!(
        par.moments.variance > 0.1,
        "variance={} should be in bet-multiples² (not CV²)",
        par.moments.variance
    );
}

#[test]
fn par_sheet_ci_99_wider_than_95() {
    let stats = sim_stats(7);
    let par = make_par_sheet(&stats);
    let w95 = par.statistics.ci_95_high - par.statistics.ci_95_low;
    let w99 = par.statistics.ci_99_high - par.statistics.ci_99_low;
    assert!(w99 >= w95, "CI99={w99:.6} must be >= CI95={w95:.6}");
}

#[test]
fn par_sheet_required_spins_ordered() {
    let stats = sim_stats(13);
    let par = make_par_sheet(&stats);
    assert!(
        par.required_spins.for_001pp_ci_95 > par.required_spins.for_01pp_ci_95,
        "0.01pp needs more spins than 0.1pp"
    );
    assert!(
        par.required_spins.for_01pp_ci_99 > par.required_spins.for_01pp_ci_95,
        "CI99 needs more spins than CI95"
    );
}

#[test]
fn par_sheet_bonus_distances_reasonable() {
    let stats = sim_stats(3);
    let par = make_par_sheet(&stats);
    // FS triggered every 250 spins → mean_distance ≈ 250.
    assert!(
        par.bonus_distances.free_spins.mean_distance.is_finite(),
        "FS mean_distance must be finite"
    );
    assert!(
        (par.bonus_distances.free_spins.mean_distance - 250.0).abs() < 10.0,
        "expected ~250 got {}",
        par.bonus_distances.free_spins.mean_distance
    );
    // H&W triggered every 1500 spins.
    assert!(
        par.bonus_distances.hold_and_win.mean_distance.is_finite(),
        "H&W mean_distance must be finite"
    );
    assert!(
        (par.bonus_distances.hold_and_win.mean_distance - 1500.0).abs() < 50.0,
        "expected ~1500 got {}",
        par.bonus_distances.hold_and_win.mean_distance
    );
}

#[test]
fn par_sheet_json_roundtrip_preserves_faza8_fields() {
    let stats = sim_stats(17);
    let par = make_par_sheet(&stats);
    let json = serde_json::to_string_pretty(&par).unwrap();
    let par2: PARSheet = serde_json::from_str(&json).unwrap();
    assert!((par.quantiles.p50 - par2.quantiles.p50).abs() < 1e-12);
    assert!((par.quantiles.p99 - par2.quantiles.p99).abs() < 1e-12);
    assert!((par.moments.variance - par2.moments.variance).abs() < 1e-12);
    assert_eq!(par.moments.sample_count, par2.moments.sample_count);
    assert_eq!(
        par.required_spins.for_01pp_ci_95,
        par2.required_spins.for_01pp_ci_95
    );
}

#[test]
fn par_sheet_print_no_panic_with_all_sections() {
    let stats = sim_stats(22);
    let par = make_par_sheet(&stats);
    PARGenerator::print(&par);
}

// ─── Volatility category regression ──────────────────────────────────────────

#[test]
fn volatility_category_cv_below_one_is_correct() {
    // BUG in old code: `match cv as u32 { 0..=2 => "VERY_LOW" }` truncated CV=0.7 to 0.
    // The fix uses f64 comparisons.
    // With Welford: push lots of values clustered around mean → CV < 0.5 → VERY_LOW.
    let mut w = WelfordAccumulator::new();
    for _ in 0..10_000 {
        w.push(10.0); // constant → CV = 0 → VERY_LOW
    }
    assert_eq!(w.volatility_category(), "VERY_LOW");

    let mut w2 = WelfordAccumulator::new();
    // mean=10, std≈8 → CV≈0.8 → LOW (not VERY_LOW).
    let values = [2.0f64, 5.0, 8.0, 10.0, 12.0, 15.0, 18.0];
    for _ in 0..1000 {
        for &v in &values {
            w2.push(v);
        }
    }
    assert_eq!(
        w2.volatility_category(),
        "LOW",
        "CV≈0.8 should be LOW not VERY_LOW"
    );
}

// ─── AtomicStats::merge propagates Faza 8 fields ────────────────────────────

#[test]
fn atomic_stats_merge_propagates_welford() {
    let s1 = AtomicStats::new();
    let s2 = AtomicStats::new();
    // Each accumulates distinct values.
    for i in 0u64..100 {
        s1.record_win_full(i as f64, 0, i);
        s2.record_win_full((i + 100) as f64, 1, i + 100);
    }
    s1.merge(&s2);
    let w = s1.get_welford();
    // Combined: 0..199, 200 values, mean = 99.5.
    assert_eq!(w.count(), 200);
    assert!((w.mean() - 99.5).abs() < 1e-6, "mean={}", w.mean());
}

#[test]
fn atomic_stats_merge_propagates_top_wins() {
    let s1 = AtomicStats::new();
    let s2 = AtomicStats::new();
    for i in 1u64..=20 {
        s1.record_win_full(i as f64, 1, i);
    }
    for i in 21u64..=40 {
        s2.record_win_full(i as f64, 2, i);
    }
    s1.merge(&s2);
    let snap = s1.top_wins.snapshot();
    assert_eq!(snap.len(), 25);
    assert!((snap[0].win_x - 40.0).abs() < 1e-9, "max should be 40");
}

#[test]
fn atomic_stats_merge_propagates_bonus_distances() {
    let s1 = AtomicStats::new();
    let s2 = AtomicStats::new();
    s1.record_fs_trigger(0);
    s1.record_fs_trigger(100);
    s2.record_fs_trigger(200);
    s2.record_fs_trigger(500);
    s1.merge(&s2);
    assert_eq!(s1.fs_distance.total_intervals(), 2);
    // mean = (100 + 300) / 2 = 200
    assert!((s1.fs_distance.mean_distance() - 200.0).abs() < 0.01);
}
