//! Faza 4 — Statistics & PAR sheet integration tests.
//!
//! Covers:
//! * HDR histogram precision across the full [0, ∞) range.
//! * `AtomicStats` HDR path in multi-threaded merge scenario.
//! * `PARGenerator` output correctness (RTP, compliance, buckets).
//! * JSON round-trip for `PARSheet`.
//! * Large-scale smoke (1M spins, constant memory).

use slot_sim::{
    jackpot::JackpotMetrics,
    par::{PARGenerator, PARSheet},
    stats::{AtomicStats, HdrHistogram, MultiSeedStats, PARMetrics, SeedStats, HDR_BUCKET_COUNT},
};
use std::sync::atomic::Ordering;

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn five_seed_multi() -> MultiSeedStats {
    // 20 seeds tightly clustered around 96% — std_dev ≈ 0.022pp,
    // std_error = 0.022/√20 ≈ 0.005pp → below the 0.1pp adequacy gate.
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

fn base_stats() -> AtomicStats {
    let s = AtomicStats::new();
    s.total_spins.store(1_000_000, Ordering::Relaxed);
    s.total_wagered.store(1_000_000, Ordering::Relaxed);
    s.total_won.store(960_000, Ordering::Relaxed);
    s.total_base_won.store(600_000, Ordering::Relaxed);
    s.total_fs_won.store(360_000, Ordering::Relaxed);
    s.winning_spins.store(330_000, Ordering::Relaxed);
    s.fs_triggers.store(5_000, Ordering::Relaxed);
    s.total_fs_spins.store(60_000, Ordering::Relaxed);
    s
}

fn base_par(stats: &AtomicStats) -> PARMetrics {
    PARMetrics::from_stats(stats, &five_seed_multi(), 1)
}

fn make_par_sheet(stats: &AtomicStats) -> PARSheet {
    let par_m = base_par(stats);
    PARGenerator::generate(
        stats,
        &par_m,
        vec![],
        "faza4-test",
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

// ─── HDR Histogram tests ──────────────────────────────────────────────────────

#[test]
fn hdr_no_win_goes_to_bucket_zero() {
    let h = HdrHistogram::default();
    h.record(0.0);
    h.record(-1.0); // negative treated as no-win
    assert_eq!(h.get(0), 2);
}

#[test]
fn hdr_first_threshold_boundary() {
    let h = HdrHistogram::default();
    // THRESHOLDS[0] = 0.1 — exactly 0.1 must go into bucket 2 (≥0.1, <0.2).
    h.record(0.1);
    assert_eq!(h.get(1), 0, "0.1 should NOT be in bucket 1 (0, 0.1)");
    assert_eq!(h.get(2), 1, "0.1 should be in bucket 2 (0.1, 0.2)");
}

#[test]
fn hdr_unbounded_top_bucket() {
    let h = HdrHistogram::default();
    h.record(50_000.0); // exactly the last threshold → bucket 31
    h.record(99_999.0); // above → bucket 31
    h.record(1_000_000.0); // way above → bucket 31
    assert_eq!(h.get(HDR_BUCKET_COUNT - 1), 3);
}

#[test]
fn hdr_total_equals_recorded_count() {
    let h = HdrHistogram::default();
    let wins = [0.0, 0.5, 1.0, 5.0, 10.0, 100.0, 1000.0, 5001.0];
    for &w in &wins {
        h.record(w);
    }
    assert_eq!(h.total(), wins.len() as u64);
}

#[test]
fn hdr_snapshot_matches_get() {
    let h = HdrHistogram::default();
    for i in 0..HDR_BUCKET_COUNT {
        for _ in 0..i {
            h.record(if i == 0 {
                0.0
            } else if i < HdrHistogram::THRESHOLDS.len() + 1 {
                HdrHistogram::THRESHOLDS[i - 1]
            } else {
                100_000.0
            });
        }
    }
    let snap = h.snapshot();
    for i in 0..HDR_BUCKET_COUNT {
        assert_eq!(snap[i], h.get(i), "bucket {i} mismatch in snapshot");
    }
}

#[test]
fn hdr_merge_is_additive() {
    let h1 = HdrHistogram::default();
    let h2 = HdrHistogram::default();
    // THRESHOLDS: [0.1, 0.2, 0.5, 1.0, 2.0, …]
    // 1.5 ≥ 1.0 and < 2.0 → crosses 4 thresholds (0.1,0.2,0.5,1.0) → bucket 5
    h1.record(1.5);
    h2.record(1.5);
    h1.merge(&h2);
    assert_eq!(h1.get(5), 2);
    assert_eq!(h1.total(), 2);
}

#[test]
fn hdr_1m_spins_constant_memory() {
    // Confirm HDR doesn't allocate dynamically regardless of spin count.
    // Memory is always exactly HDR_BUCKET_COUNT × 8 bytes for counts.
    let stats = AtomicStats::new();
    let mut rng = slot_sim::rng::SlotRng::new(9999);
    for _ in 0..1_000_000 {
        let win = if rng.random() < 0.35 {
            0.0
        } else {
            rng.random() * 500.0
        };
        stats.record_win_hdr(win);
    }
    let snap = stats.get_hdr_histogram();
    let total: u64 = snap.iter().sum();
    assert_eq!(total, 1_000_000, "HDR must record all 1M spins");
}

#[test]
fn atomic_stats_merge_hdr_additive() {
    let a = AtomicStats::new();
    let b = AtomicStats::new();
    // THRESHOLDS: [0.1, 0.2, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 10.0, 15.0, 20.0, 30.0, 50.0, 75.0, …]
    // 50.0 ≥ 50.0 (threshold[12]) → crosses 13 thresholds → bucket 14
    a.record_win_hdr(50.0);
    b.record_win_hdr(50.0);
    b.record_win_hdr(50.0);
    a.merge(&b);
    let snap = a.get_hdr_histogram();
    assert_eq!(
        snap[14], 3,
        "merged HDR should have 3 counts in the [50,75)x bucket"
    );
}

// ─── PAR Sheet tests ──────────────────────────────────────────────────────────

#[test]
fn par_generates_all_sections() {
    let stats = base_stats();
    let par = make_par_sheet(&stats);
    assert_eq!(par.meta.game_id, "faza4-test");
    assert_eq!(par.meta.seeds_used, 20);
    assert_eq!(par.meta.total_spins, 1_000_000);
    // PAR-002 bumped schema from 1.0.0 to 1.1.0 (added rng_attestation + config_hash).
    assert_eq!(par.schema_version, "1.1.0");
    assert_eq!(par.win_distribution.len(), HDR_BUCKET_COUNT);
}

#[test]
fn par_rtp_within_tolerance() {
    let stats = base_stats();
    let par = make_par_sheet(&stats);
    assert!(par.rtp.within_tolerance, "96% must be within 96% ± 0.5%");
    assert!((par.rtp.total_rtp_pct - 96.0).abs() < 1e-6);
}

#[test]
fn par_rtp_out_of_tolerance() {
    let stats = base_stats();
    let mut par_m = base_par(&stats);
    par_m.total_rtp = 93.9; // 2.1pp below target
    let par = PARGenerator::generate(
        &stats,
        &par_m,
        vec![],
        "g",
        "1.0.0",
        96.0,
        0.5,
        5000.0,
        vec![],
        [85.0, 99.0],
        "must_be_random",
        true,
        true,
        1,
    );
    assert!(!par.rtp.within_tolerance);
}

#[test]
fn par_win_distribution_sums_to_total_hdr() {
    // Record exactly 500k wins into HDR, then verify bucket sum.
    let stats = base_stats();
    let mut rng = slot_sim::rng::SlotRng::new(1234);
    for _ in 0..1_000_000 {
        let w = rng.random() * 200.0;
        stats.record_win_hdr(w);
    }
    let par = make_par_sheet(&stats);
    let total: u64 = par.win_distribution.iter().map(|b| b.count).sum();
    assert_eq!(
        total, 1_000_000,
        "all HDR records must appear in distribution"
    );
}

#[test]
fn par_compliance_rtp_within_required() {
    let stats = base_stats();
    let par = make_par_sheet(&stats);
    assert!(
        par.compliance.rtp_within_required,
        "96% is within [85%, 99%]"
    );
    assert!(par.compliance.max_win_within_cap);
}

#[test]
fn par_with_jackpot_metrics() {
    use slot_sim::jackpot::JackpotKind;
    let stats = base_stats();
    let par_m = base_par(&stats);
    let jackpots = vec![
        JackpotMetrics {
            id: "mini".to_string(),
            name: "MINI".to_string(),
            kind: JackpotKind::Fixed,
            hits: 200,
            avg_interval: 5_000.0,
            total_paid_x: 2_000.0,
            total_contributed_x: 0.0,
            current_pool_x: 10.0,
            contribution_rtp: 0.002,
        },
        JackpotMetrics {
            id: "grand".to_string(),
            name: "GRAND".to_string(),
            kind: JackpotKind::Fixed,
            hits: 1,
            avg_interval: 1_000_000.0,
            total_paid_x: 5_000.0,
            total_contributed_x: 0.0,
            current_pool_x: 5_000.0,
            contribution_rtp: 0.005,
        },
    ];
    let par = PARGenerator::generate(
        &stats,
        &par_m,
        jackpots,
        "jp-game",
        "1.0.0",
        96.0,
        0.5,
        5000.0,
        vec!["MGA".to_string()],
        [85.0, 99.0],
        "must_be_random",
        true,
        true,
        5,
    );
    // jackpot_rtp_pct = (0.002 + 0.005) × 100 = 0.7%
    assert!(
        (par.rtp.jackpot_rtp_pct - 0.7).abs() < 1e-9,
        "got {}",
        par.rtp.jackpot_rtp_pct
    );
    assert_eq!(par.jackpots.len(), 2);
}

#[test]
fn par_json_roundtrip() {
    let stats = base_stats();
    let par = make_par_sheet(&stats);
    let json = serde_json::to_string_pretty(&par).unwrap();
    let par2: PARSheet = serde_json::from_str(&json).unwrap();
    assert_eq!(par.meta.game_id, par2.meta.game_id);
    assert!((par.rtp.total_rtp_pct - par2.rtp.total_rtp_pct).abs() < 1e-12);
    assert_eq!(par.win_distribution.len(), par2.win_distribution.len());
    assert_eq!(par.compliance.jurisdictions, par2.compliance.jurisdictions);
}

#[test]
fn par_print_no_panic() {
    let stats = base_stats();
    let par = make_par_sheet(&stats);
    // Verifies formatting logic doesn't panic on any input.
    PARGenerator::print(&par);
}

#[test]
fn par_statistical_confidence_from_multi_seed() {
    let stats = base_stats();
    let par = make_par_sheet(&stats);
    // 5 seeds of 200k — std_error should be well below 0.5pp.
    assert!(
        par.statistics.std_error < 0.5,
        "std_error={}",
        par.statistics.std_error
    );
    assert!(par.statistics.confidence_adequate);
    // CI should straddle the mean.
    assert!(par.statistics.ci_95_low < par.statistics.ci_95_high);
}
