//! PAR-004 — Per-feature time-to-trigger CDF.
//!
//! Atoms covered:
//!   A1 — `BonusDistanceTracker` already aggregates inter-trigger histograms;
//!         we reuse it (no new tracker required).
//!   A2 — `TimeToTriggerCdf { feature_id, n_samples, mean_distance, max_distance,
//!         points: Vec<CdfPoint> }` + `CdfPoint { spin_index, probability }`.
//!   A3 — `TimeToTriggerSection { features }` populated for every feature whose
//!         tracker recorded at least one inter-trigger interval.
//!   A4 — Pretty-print summary (P10/P50/P90 + mean/max) renders without panic.

use slot_sim::par::{CdfPoint, PARBuildContext, PARGenerator};
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::sync::atomic::Ordering;

fn build_sheet(fs_trigger_every: u64, hnw_trigger_every: u64, n_spins: u64) -> slot_sim::par::PARSheet {
    let stats = AtomicStats::new();
    stats.total_spins.store(n_spins, Ordering::Relaxed);
    stats.total_wagered.store(n_spins as i64, Ordering::Relaxed);
    stats.total_won.store((n_spins as f64 * 0.96) as i64, Ordering::Relaxed);
    if fs_trigger_every > 0 {
        for i in (0..n_spins).step_by(fs_trigger_every as usize) {
            stats.record_fs_trigger(i);
        }
    }
    if hnw_trigger_every > 0 {
        for i in (0..n_spins).step_by(hnw_trigger_every as usize) {
            stats.hnw_distance.record_trigger(i);
        }
    }

    let multi = MultiSeedStats::from_seeds(vec![SeedStats {
        spins: n_spins,
        wagered: n_spins as i64,
        won: (n_spins as f64 * 0.96) as i64,
        rtp: 96.0,
    }]);
    let par_m = PARMetrics::from_stats(&stats, &multi, 1);
    let ctx = PARBuildContext {
        stats: &stats,
        par: &par_m,
        jackpots: vec![],
        game_id: "par-004-test".to_string(),
        game_version: "1.0.0".to_string(),
        target_rtp: 96.0,
        rtp_tolerance: 0.5,
        max_win_cap: 5000.0,
        jurisdictions: vec!["MGA".to_string()],
        rtp_range_required: [85.0, 99.0],
        near_miss_rule: "must_be_random".to_string(),
        ldw_disclosure: true,
        session_time_display: true,
        seeds_used: 1,
        ir: None,
        sign_off: None,
    };
    PARGenerator::generate_with_context(ctx)
}

// ─── A1 + A3 — Section emits one entry per active feature ───────────────────

#[test]
fn time_to_trigger_section_emits_only_active_features() {
    // Both FS and H&W triggered.
    let par = build_sheet(200, 500, 100_000);
    let feat_ids: Vec<&str> = par
        .time_to_trigger
        .features
        .iter()
        .map(|f| f.feature_id.as_str())
        .collect();
    assert!(feat_ids.contains(&"free_spins"));
    assert!(feat_ids.contains(&"hold_and_win"));
    assert_eq!(par.time_to_trigger.features.len(), 2);

    // Only FS triggered, H&W must be absent (n_samples==0 dropped).
    let par2 = build_sheet(200, 0, 100_000);
    assert_eq!(par2.time_to_trigger.features.len(), 1);
    assert_eq!(par2.time_to_trigger.features[0].feature_id, "free_spins");

    // Nothing triggered — section is empty (no panic).
    let par3 = build_sheet(0, 0, 100_000);
    assert!(par3.time_to_trigger.features.is_empty());
}

// ─── A2 — CDF monotone non-decreasing in probability ────────────────────────

#[test]
fn cdf_monotone_non_decreasing() {
    let par = build_sheet(200, 0, 100_000);
    let fs = &par.time_to_trigger.features[0];
    let mut prev_p = 0.0_f64;
    let mut prev_x = 0_u64;
    for p in &fs.points {
        assert!(p.probability >= prev_p, "CDF must be monotone: {prev_p} → {}", p.probability);
        assert!(p.spin_index >= prev_x, "spin_index must be monotone: {prev_x} → {}", p.spin_index);
        assert!(
            (0.0..=1.0).contains(&p.probability),
            "probability {} out of [0,1]",
            p.probability
        );
        prev_p = p.probability;
        prev_x = p.spin_index;
    }
    // Terminal point ≈ 1.0 (all samples accounted for).
    let last = fs.points.last().unwrap();
    assert!(
        (last.probability - 1.0).abs() < 1e-9,
        "last CDF point must hit 1.0, got {}",
        last.probability
    );
}

// ─── A2 — P50 inter-trigger ≈ mean for periodic triggers ────────────────────

#[test]
fn p50_matches_period_for_periodic_triggers() {
    // FS triggered exactly every 200 spins — mean distance MUST = 200.
    let par = build_sheet(200, 0, 100_000);
    let fs = &par.time_to_trigger.features[0];
    assert!((fs.mean_distance - 200.0).abs() < 1e-9);
    // CDF puts P(X < 250) = 1.0 (distance is constant 200, all in 200..250 bucket).
    // P50 must thus be ≤ 250 (the bucket right of 200).
    let p50 = fs
        .points
        .iter()
        .find(|p| p.probability >= 0.5)
        .map(|p| p.spin_index)
        .unwrap();
    assert!(p50 <= 250, "P50 for period=200 must be ≤ 250, got {p50}");
}

// ─── A4 — Pretty-print does not panic with CDF block ───────────────────────

#[test]
fn print_with_cdf_block_does_not_panic() {
    let par = build_sheet(150, 300, 50_000);
    PARGenerator::print(&par);
}

// ─── JSON roundtrip preserves CDF points ────────────────────────────────────

#[test]
fn cdf_section_survives_json_roundtrip() {
    let par = build_sheet(200, 0, 50_000);
    let json = serde_json::to_string(&par).expect("must serialize");
    let back: slot_sim::par::PARSheet = serde_json::from_str(&json).expect("must deserialize");
    let fs = &back.time_to_trigger.features[0];
    assert_eq!(fs.feature_id, "free_spins");
    assert!(!fs.points.is_empty());
    let cmp: &CdfPoint = fs.points.last().unwrap();
    assert!((cmp.probability - 1.0).abs() < 1e-9);
}
