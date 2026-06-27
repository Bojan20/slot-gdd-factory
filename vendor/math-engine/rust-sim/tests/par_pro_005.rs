//! PAR-005 — Markov transition matrix + stationary π.
//!
//! Atoms covered:
//!   A1 — `GameState` enum (5 states), `MarkovSection { states, transition_matrix,
//!         stationary_pi, expected_dwell }` derived from stats + PARMetrics.
//!   A2 — `MarkovSection::from_stats` populates BaseGame ↔ FreeSpins / H&W rows
//!         from FS / H&W trigger counts + avg session length.
//!   A3 — `stationary_distribution` (power iteration, 200 iter, ε=1e-12) returns
//!         a vector that sums to 1 and is invariant under the matrix.
//!   A4 — Pretty-print does not panic with the 5×5 matrix block.

use slot_sim::par::{PARBuildContext, PARGenerator, MARKOV_STATES};
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::sync::atomic::Ordering;

fn build_sheet(
    n_spins: u64,
    fs_period: u64,
    fs_dwell: u32,
    hnw_period: u64,
    hnw_dwell: u32,
) -> slot_sim::par::PARSheet {
    let stats = AtomicStats::new();
    stats.total_spins.store(n_spins, Ordering::Relaxed);
    stats.total_wagered.store(n_spins as i64, Ordering::Relaxed);
    stats.total_won.store((n_spins as f64 * 0.96) as i64, Ordering::Relaxed);
    if fs_period > 0 {
        let n_trig = n_spins / fs_period;
        stats.fs_triggers.store(n_trig, Ordering::Relaxed);
        stats.total_fs_spins.store(n_trig * fs_dwell as u64, Ordering::Relaxed);
    }
    if hnw_period > 0 {
        let n_trig = n_spins / hnw_period;
        stats.hnw_triggers.store(n_trig, Ordering::Relaxed);
        // total_hnw_orbs is derived later by PARMetrics — synthesise via stats hook.
        stats
            .total_hnw_respins
            .store(n_trig * hnw_dwell as u64, Ordering::Relaxed);
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
        game_id: "par-005-test".to_string(),
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

// ─── A1 — Section shape ─────────────────────────────────────────────────────

#[test]
fn markov_section_has_5_states() {
    let par = build_sheet(100_000, 200, 10, 500, 4);
    assert_eq!(par.markov.states.len(), MARKOV_STATES);
    assert_eq!(par.markov.transition_matrix.len(), MARKOV_STATES);
    assert_eq!(par.markov.stationary_pi.len(), MARKOV_STATES);
    assert_eq!(par.markov.expected_dwell.len(), MARKOV_STATES);
    assert_eq!(par.markov.states[0], "base_game");
    assert_eq!(par.markov.states[1], "free_spins");
}

// ─── A2 — Each row sums to ≈1.0 ─────────────────────────────────────────────

#[test]
fn each_transition_row_sums_to_one() {
    let par = build_sheet(100_000, 200, 10, 500, 4);
    for (i, row) in par.markov.transition_matrix.iter().enumerate() {
        let sum: f64 = row.iter().sum();
        assert!(
            (sum - 1.0).abs() < 1e-9,
            "row {i} sum {sum} must equal 1.0"
        );
    }
}

// ─── A3 — Stationary π sums to 1 and is invariant under P ───────────────────

#[test]
fn stationary_pi_sums_to_one_and_is_invariant() {
    let par = build_sheet(100_000, 200, 10, 500, 4);
    let sum: f64 = par.markov.stationary_pi.iter().sum();
    assert!((sum - 1.0).abs() < 1e-9, "π sum {sum} must equal 1.0");

    // π · P ≈ π — invariance check (5x5).
    let pi = &par.markov.stationary_pi;
    let p = &par.markov.transition_matrix;
    let mut next = vec![0.0_f64; MARKOV_STATES];
    for i in 0..MARKOV_STATES {
        for j in 0..MARKOV_STATES {
            next[j] += pi[i] * p[i][j];
        }
    }
    for i in 0..MARKOV_STATES {
        assert!(
            (next[i] - pi[i]).abs() < 1e-6,
            "π must be invariant at index {i}: π={} π·P={}",
            pi[i],
            next[i]
        );
    }
}

// ─── A3 — Higher FS trigger rate → higher π[FreeSpins] ──────────────────────

#[test]
fn higher_fs_trigger_rate_shifts_pi_to_free_spins() {
    let par_low = build_sheet(100_000, 1_000, 10, 0, 0); // 1/1000 base
    let par_high = build_sheet(100_000, 100, 10, 0, 0); // 1/100 base
    assert!(
        par_high.markov.stationary_pi[1] > par_low.markov.stationary_pi[1],
        "higher trigger frequency must increase π[free_spins]: high={} low={}",
        par_high.markov.stationary_pi[1],
        par_low.markov.stationary_pi[1]
    );
}

// ─── Expected dwell — FreeSpins dwell ≈ avg_fs_spins ────────────────────────

#[test]
fn expected_dwell_free_spins_matches_avg_session_length() {
    let par = build_sheet(100_000, 200, 10, 0, 0);
    // FS row self-loop p ≈ 1 − 1/avg_fs_spins → dwell = 1/(1−p) ≈ avg_fs_spins.
    let dwell_fs = par.markov.expected_dwell[1];
    assert!(
        (dwell_fs - 10.0).abs() < 1e-6,
        "expected_dwell[free_spins] should be ~10, got {dwell_fs}"
    );
}

// ─── A4 — Pretty-print does not panic ───────────────────────────────────────

#[test]
fn print_with_markov_block_does_not_panic() {
    let par = build_sheet(100_000, 200, 10, 500, 4);
    PARGenerator::print(&par);
}

// ─── JSON roundtrip ─────────────────────────────────────────────────────────

#[test]
fn markov_section_survives_json_roundtrip() {
    let par = build_sheet(100_000, 200, 10, 500, 4);
    let json = serde_json::to_string(&par).unwrap();
    let back: slot_sim::par::PARSheet = serde_json::from_str(&json).unwrap();
    assert_eq!(back.markov.states, par.markov.states);
    let pi_diff: f64 = back
        .markov
        .stationary_pi
        .iter()
        .zip(par.markov.stationary_pi.iter())
        .map(|(a, b)| (a - b).abs())
        .sum();
    assert!(pi_diff < 1e-12);
}
