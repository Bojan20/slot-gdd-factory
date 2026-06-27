//! PAR-015 / PAR-016 / PAR-017 — Variance decomp + Reach curves + Risk-of-Ruin.

use slot_sim::par::{PARBuildContext, PARGenerator, ReachCurveSection, RiskOfRuinSection, VarianceDecompSection};
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::sync::atomic::Ordering;

fn sheet(observed_rtp: f64) -> slot_sim::par::PARSheet {
    let stats = AtomicStats::new();
    stats.total_spins.store(1_000_000, Ordering::Relaxed);
    stats.total_wagered.store(1_000_000, Ordering::Relaxed);
    stats.total_won.store((1_000_000.0 * observed_rtp / 100.0) as i64, Ordering::Relaxed);
    stats.winning_spins.store(300_000, Ordering::Relaxed);

    let multi = MultiSeedStats::from_seeds(vec![SeedStats {
        spins: 50_000,
        wagered: 50_000,
        won: (50_000.0 * observed_rtp / 100.0) as i64,
        rtp: observed_rtp,
    }]);
    let par_m = PARMetrics::from_stats(&stats, &multi, 1);
    let ctx = PARBuildContext {
        stats: &stats,
        par: &par_m,
        jackpots: vec![],
        game_id: "par-15-17".to_string(),
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

// ─── PAR-015 ────────────────────────────────────────────────────────────────

#[test]
fn variance_decomp_shares_sum_to_one_hundred_or_zero() {
    let par = sheet(96.0);
    let sum: f64 = par.variance_decomp.share_pct.iter().sum();
    // Either no variance recorded (sum=0) or the proxy shares cover 100%.
    assert!(
        sum.abs() < 1e-9 || (sum - 100.0).abs() < 1e-6,
        "share_pct sum {sum} must be 0 or 100"
    );
}

#[test]
fn variance_decomp_section_constructor_zero_safe() {
    let par_m = PARMetrics::default();
    let v = VarianceDecompSection::from_metrics(&par_m);
    assert_eq!(v.total_variance, 0.0);
    assert_eq!(v.interaction_residual, 0.0);
}

// ─── PAR-016 ────────────────────────────────────────────────────────────────

#[test]
fn reach_curve_monotone_decreasing() {
    let r = ReachCurveSection::from_hit_rate(0.30);
    let mut prev = 1.0_f64;
    for (n, p) in &r.points {
        assert!(*p <= prev, "drought P at n={n} must be ≤ previous");
        assert!((0.0..=1.0).contains(p));
        prev = *p;
    }
}

#[test]
fn reach_curve_clamps_zero_hit_rate() {
    let r = ReachCurveSection::from_hit_rate(0.0);
    // With p clamped to 1e-9, drought ≈ 1.0 even at 10 spins.
    assert!(r.points[0].1 > 0.99);
}

// ─── PAR-017 ────────────────────────────────────────────────────────────────

#[test]
fn risk_of_ruin_monotone_in_bankroll() {
    let r = RiskOfRuinSection::from_edge(0.04); // 96% RTP
    let mut prev = 1.0_f64;
    for (n, p) in &r.points {
        assert!(*p <= prev, "RoR at bankroll={n} must be ≤ previous");
        assert!((0.0..=1.0).contains(p));
        prev = *p;
    }
}

#[test]
fn risk_of_ruin_zero_edge_returns_one() {
    let r = RiskOfRuinSection::from_edge(0.0);
    // ((1-0)/(1+0))^N = 1 for all N.
    for (_, p) in &r.points {
        assert!((p - 1.0).abs() < 1e-12);
    }
}

#[test]
fn sheet_carries_all_three_sections() {
    let par = sheet(96.0);
    assert!(par.variance_decomp.total_variance >= 0.0);
    assert_eq!(par.reach_curve.points.len(), 10);
    assert_eq!(par.risk_of_ruin.points.len(), 9);
    let json = serde_json::to_string(&par).unwrap();
    let _: slot_sim::par::PARSheet = serde_json::from_str(&json).unwrap();
}
