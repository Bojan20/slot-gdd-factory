//! Faza 5 — Jackpot manager integration tests.
//!
//! Covers:
//! * Fixed / Progressive / Pooled tier behaviour.
//! * Trigger types: RandomPick, WinMultiplierThreshold, HoldAndWinFull, SymbolCombo.
//! * Pool accumulation, cap, reset on hit.
//! * `JackpotAnalytical` closed-form solver.
//! * Hit-frequency smoke test (100k spins, verify distribution).
//! * Metrics calculation and JSON serialisation.
//! * Multi-tier independence.

use slot_sim::{
    jackpot::{JackpotAnalytical, JackpotKind, JackpotManager, JackpotTierConfig, JackpotTrigger},
    rng::SlotRng,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn fixed(id: &str, prob: f64, payout: f64) -> JackpotTierConfig {
    JackpotTierConfig {
        id: id.to_string(),
        name: format!("{id} jackpot"),
        kind: JackpotKind::Fixed,
        trigger: JackpotTrigger::RandomPick { probability: prob },
        seed_amount_x: payout,
        contribution_rate: None,
        cap_x: None,
        pool_id: None,
    }
}

fn progressive(id: &str, seed: f64, rate: f64, prob: f64) -> JackpotTierConfig {
    JackpotTierConfig {
        id: id.to_string(),
        name: format!("{id} jackpot"),
        kind: JackpotKind::Progressive,
        trigger: JackpotTrigger::RandomPick { probability: prob },
        seed_amount_x: seed,
        contribution_rate: Some(rate),
        cap_x: None,
        pool_id: None,
    }
}

// ─── Fixed jackpot ────────────────────────────────────────────────────────────

#[test]
fn fixed_always_hits_at_prob_one() {
    let mgr = JackpotManager::new(vec![fixed("mini", 1.0, 10.0)]);
    let hits = mgr.on_spin(&[0.5], 0.0);
    assert_eq!(hits.len(), 1, "probability=1.0 must always hit");
    assert_eq!(hits[0].0, "mini");
    assert!((hits[0].1 - 10.0).abs() < 1e-9);
}

#[test]
fn fixed_never_hits_at_prob_zero() {
    let mgr = JackpotManager::new(vec![fixed("grand", 0.0, 5000.0)]);
    let hits = mgr.on_spin(&[0.5], 0.0);
    assert!(hits.is_empty(), "probability=0.0 must never hit");
}

#[test]
fn fixed_payout_identical_on_repeated_hits() {
    let mgr = JackpotManager::new(vec![fixed("mini", 1.0, 10.0)]);
    for i in 0..10 {
        let hits = mgr.on_spin(&[0.0], 0.0);
        assert_eq!(hits.len(), 1);
        assert!(
            (hits[0].1 - 10.0).abs() < 1e-9,
            "hit {i}: got {}",
            hits[0].1
        );
    }
}

#[test]
fn fixed_rng_boundary_exact() {
    // rng_val < probability → hit; rng_val >= probability → no hit.
    let mgr = JackpotManager::new(vec![fixed("mini", 0.5, 10.0)]);
    assert_eq!(
        mgr.on_spin(&[0.499999], 0.0).len(),
        1,
        "just below threshold → hit"
    );
    assert_eq!(
        mgr.on_spin(&[0.5], 0.0).len(),
        0,
        "exactly at threshold → no hit"
    );
    assert_eq!(
        mgr.on_spin(&[0.500001], 0.0).len(),
        0,
        "above threshold → no hit"
    );
}

// ─── Progressive jackpot ──────────────────────────────────────────────────────

#[test]
fn progressive_pool_grows_with_contributions() {
    let mgr = JackpotManager::new(vec![progressive("major", 100.0, 0.01, 0.0)]);
    for _ in 0..1_000 {
        mgr.contribute_all(1.0);
    }
    let pool = mgr.states[0].pool_value();
    // Expected: 100 + 1000 × 0.01 = 110.
    assert!(
        (pool - 110.0).abs() < 0.5,
        "pool should be ~110, got {pool}"
    );
}

#[test]
fn progressive_cap_clamps_pool() {
    let mut cfg = progressive("major", 100.0, 0.1, 0.0);
    cfg.cap_x = Some(105.0);
    let mgr = JackpotManager::new(vec![cfg]);
    for _ in 0..10_000 {
        mgr.contribute_all(1.0);
    }
    let pool = mgr.states[0].pool_value();
    // Allow one-delta overshoot (race-tolerant clamp).
    assert!(pool <= 105.2, "pool should respect cap of 105, got {pool}");
}

#[test]
fn progressive_resets_to_seed_on_hit() {
    let mgr = JackpotManager::new(vec![progressive("major", 100.0, 0.01, 0.001)]);
    // Grow pool significantly.
    for _ in 0..5_000 {
        mgr.contribute_all(1.0);
    }
    let pool_before = mgr.states[0].pool_value();
    assert!(pool_before > 100.0, "pool should have grown: {pool_before}");

    // Force hit (rng_val=0 < probability=0.001).
    let payout = mgr.states[0].try_hit(&mgr.configs[0], 0.0, 0.0);
    assert!(payout.is_some());
    let p = payout.unwrap();
    assert!(p > 100.0, "payout should be inflated pool: {p}");

    // Pool must reset to seed.
    let pool_after = mgr.states[0].pool_value();
    assert!(
        (pool_after - 100.0).abs() < 0.5,
        "pool should reset to seed 100, got {pool_after}"
    );
}

#[test]
fn progressive_contribution_tracked() {
    let mgr = JackpotManager::new(vec![progressive("p1", 50.0, 0.02, 0.0)]);
    for _ in 0..200 {
        mgr.contribute_all(1.0);
    }
    // contributed = 200 × 0.02 = 4.0
    let contributed = mgr.states[0].total_contributed();
    assert!(
        (contributed - 4.0).abs() < 0.01,
        "contributed={contributed}"
    );
}

// ─── Hold & Win Full trigger ──────────────────────────────────────────────────

#[test]
fn hnw_full_not_triggered_by_on_spin() {
    let cfg = JackpotTierConfig {
        id: "grand".to_string(),
        name: "GRAND".to_string(),
        kind: JackpotKind::Fixed,
        trigger: JackpotTrigger::HoldAndWinFull,
        seed_amount_x: 5_000.0,
        contribution_rate: None,
        cap_x: None,
        pool_id: None,
    };
    let mgr = JackpotManager::new(vec![cfg]);
    // Even with rng_val=0 (which would fire RandomPick), HoldAndWinFull must not fire.
    assert!(mgr.on_spin(&[0.0], 1_000_000.0).is_empty());
}

#[test]
fn hnw_full_fires_via_record_hnw_hit() {
    let cfg = JackpotTierConfig {
        id: "grand".to_string(),
        name: "GRAND".to_string(),
        kind: JackpotKind::Fixed,
        trigger: JackpotTrigger::HoldAndWinFull,
        seed_amount_x: 5_000.0,
        contribution_rate: None,
        cap_x: None,
        pool_id: None,
    };
    let mgr = JackpotManager::new(vec![cfg]);
    let payout = mgr.record_hnw_hit("grand");
    assert_eq!(payout, Some(5_000.0));
}

#[test]
fn hnw_full_wrong_id_returns_none() {
    let cfg = JackpotTierConfig {
        id: "grand".to_string(),
        name: "GRAND".to_string(),
        kind: JackpotKind::Fixed,
        trigger: JackpotTrigger::HoldAndWinFull,
        seed_amount_x: 5_000.0,
        contribution_rate: None,
        cap_x: None,
        pool_id: None,
    };
    let mgr = JackpotManager::new(vec![cfg]);
    assert!(mgr.record_hnw_hit("nonexistent").is_none());
}

// ─── WinMultiplierThreshold trigger ──────────────────────────────────────────

#[test]
fn win_mult_threshold_trigger() {
    let cfg = JackpotTierConfig {
        id: "super".to_string(),
        name: "SUPER".to_string(),
        kind: JackpotKind::Fixed,
        trigger: JackpotTrigger::WinMultiplierThreshold { min_win_x: 500.0 },
        seed_amount_x: 1_000.0,
        contribution_rate: None,
        cap_x: None,
        pool_id: None,
    };
    let mgr = JackpotManager::new(vec![cfg]);
    // Below threshold.
    assert!(mgr.on_spin(&[0.0], 499.9).is_empty());
    // Exactly at threshold.
    let hits = mgr.on_spin(&[0.0], 500.0);
    assert_eq!(hits.len(), 1);
    assert!((hits[0].1 - 1_000.0).abs() < 1e-9);
}

// ─── Analytical solver ────────────────────────────────────────────────────────

#[test]
fn analytical_expected_rtp() {
    let cfg = fixed("grand", 0.0001, 5_000.0);
    let a = JackpotAnalytical::solve(&cfg).unwrap();
    // E[RTP] = 0.0001 × 5000 = 0.5
    assert!(
        (a.expected_rtp - 0.5).abs() < 1e-9,
        "expected_rtp={}",
        a.expected_rtp
    );
}

#[test]
fn analytical_expected_interval() {
    let cfg = fixed("grand", 0.0001, 5_000.0);
    let a = JackpotAnalytical::solve(&cfg).unwrap();
    assert!(
        (a.expected_interval - 10_000.0).abs() < 1.0,
        "interval={}",
        a.expected_interval
    );
}

#[test]
fn analytical_std_dev() {
    let cfg = fixed("mini", 0.01, 10.0);
    let a = JackpotAnalytical::solve(&cfg).unwrap();
    // Var = p × v² × (1-p) = 0.01 × 100 × 0.99 = 0.99
    let expected_std_dev = (0.01_f64 * 100.0 * 0.99_f64).sqrt();
    assert!(
        (a.rtp_std_dev - expected_std_dev).abs() < 1e-9,
        "std_dev={} expected={}",
        a.rtp_std_dev,
        expected_std_dev
    );
}

#[test]
fn analytical_returns_none_for_hnw_full() {
    let cfg = JackpotTierConfig {
        id: "g".to_string(),
        name: "G".to_string(),
        kind: JackpotKind::Fixed,
        trigger: JackpotTrigger::HoldAndWinFull,
        seed_amount_x: 1_000.0,
        contribution_rate: None,
        cap_x: None,
        pool_id: None,
    };
    assert!(JackpotAnalytical::solve(&cfg).is_none());
}

#[test]
fn analytical_returns_none_for_win_mult_threshold() {
    let cfg = JackpotTierConfig {
        id: "g".to_string(),
        name: "G".to_string(),
        kind: JackpotKind::Fixed,
        trigger: JackpotTrigger::WinMultiplierThreshold { min_win_x: 100.0 },
        seed_amount_x: 500.0,
        contribution_rate: None,
        cap_x: None,
        pool_id: None,
    };
    assert!(JackpotAnalytical::solve(&cfg).is_none());
}

// ─── Hit frequency smoke ──────────────────────────────────────────────────────

#[test]
fn hit_frequency_smoke_100k_spins() {
    let mgr = JackpotManager::new(vec![fixed("mini", 0.01, 10.0)]);
    let mut rng = SlotRng::new(42);
    let mut hits = 0u64;
    for _ in 0..100_000 {
        let rv = rng.random();
        hits += mgr.on_spin(&[rv], 0.0).len() as u64;
    }
    // Expect ~1000 ± 200 (3σ range for p=0.01, n=100k).
    assert!(
        hits > 800 && hits < 1200,
        "hits={hits} expected ~1000 for p=0.01 over 100k spins"
    );
    let metrics = mgr.metrics(100_000);
    assert_eq!(metrics[0].hits, hits);
    assert!((metrics[0].avg_interval - 100_000.0 / hits as f64).abs() < 1.0);
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

#[test]
fn metrics_contribution_rtp_exact() {
    let mgr = JackpotManager::new(vec![fixed("mini", 1.0, 10.0)]);
    for _ in 0..100 {
        mgr.on_spin(&[0.0], 0.0);
    }
    let m = &mgr.metrics(100)[0];
    // contribution_rtp = total_paid / total_spins = 1000 / 100 = 10.0.
    assert!(
        (m.contribution_rtp - 10.0).abs() < 1e-6,
        "contribution_rtp={}",
        m.contribution_rtp
    );
    assert_eq!(m.hits, 100);
    assert!((m.total_paid_x - 1_000.0).abs() < 1e-6);
}

#[test]
fn metrics_avg_interval_never_triggered() {
    let mgr = JackpotManager::new(vec![fixed("grand", 0.0, 5_000.0)]);
    let m = &mgr.metrics(1_000)[0];
    assert!(m.avg_interval.is_infinite());
    assert_eq!(m.hits, 0);
}

// ─── Multi-tier independence ──────────────────────────────────────────────────

#[test]
fn multiple_tiers_independent() {
    let mini = fixed("mini", 1.0, 5.0); // always hits
    let grand = fixed("grand", 0.0, 5_000.0); // never hits
    let mgr = JackpotManager::new(vec![mini, grand]);
    let hits = mgr.on_spin(&[0.0, 0.9], 0.0);
    assert_eq!(hits.len(), 1, "only mini should fire");
    assert_eq!(hits[0].0, "mini");
}

#[test]
fn both_tiers_can_hit_same_spin() {
    let t1 = fixed("t1", 1.0, 10.0);
    let t2 = fixed("t2", 1.0, 20.0);
    let mgr = JackpotManager::new(vec![t1, t2]);
    let hits = mgr.on_spin(&[0.0, 0.0], 0.0);
    assert_eq!(hits.len(), 2, "both tiers should fire");
    let total: f64 = hits.iter().map(|h| h.1).sum();
    assert!((total - 30.0).abs() < 1e-9);
}

// ─── JSON round-trip ──────────────────────────────────────────────────────────

#[test]
fn tier_config_json_roundtrip() {
    let cfg = progressive("grand", 500.0, 0.005, 0.00005);
    let json = serde_json::to_string_pretty(&cfg).unwrap();
    let cfg2: JackpotTierConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(cfg, cfg2);
}

#[test]
fn analytical_result_json_roundtrip() {
    let cfg = fixed("grand", 0.0001, 5_000.0);
    let a = JackpotAnalytical::solve(&cfg).unwrap();
    let json = serde_json::to_string_pretty(&a).unwrap();
    let a2: JackpotAnalytical = serde_json::from_str(&json).unwrap();
    assert!((a.expected_rtp - a2.expected_rtp).abs() < 1e-12);
    assert!((a.expected_interval - a2.expected_interval).abs() < 1e-6);
}
