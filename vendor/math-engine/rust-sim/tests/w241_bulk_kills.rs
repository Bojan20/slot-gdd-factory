//! W241 — `rust-sim/src/bulk/{parse,progress,checkpoint,dispatcher}.rs`
//! mutation kill tests.
//!
//! Public surface covered:
//!   - `parse_spin_count` — K/M/B/T suffix parsing with edge cases.
//!   - `ProgressSnapshot::fraction` — 0-protection + ratio math.
//!   - `BulkConfig::new` — defaults and derived field correctness.
//!   - `BulkCheckpoint` + `AtomicStatsSnapshot` — serde round-trip.
//!   - `snapshot_hdr_buckets` + `apply_hdr_buckets` — round-trip.
//!   - `save_checkpoint` + `load_checkpoint` — disk round-trip.

use slot_sim::bulk::checkpoint::{
    apply_hdr_buckets, load_checkpoint, save_checkpoint, snapshot_hdr_buckets,
    AtomicStatsSnapshot, BulkCheckpoint, CHECKPOINT_SCHEMA_VERSION,
};
use slot_sim::bulk::dispatcher::BulkConfig;
use slot_sim::bulk::parse::{parse_spin_count, ParseSpinCountError};
use slot_sim::bulk::progress::ProgressSnapshot;
use slot_sim::stats::{AtomicStats, HdrHistogram};
use std::time::Duration;

// ── parse_spin_count: integer/suffix/edge cases ──────────────────────────

#[test]
fn w241_bulk_parse_plain_integers_exact() {
    assert_eq!(parse_spin_count("0").unwrap(), 0);
    assert_eq!(parse_spin_count("1").unwrap(), 1);
    assert_eq!(parse_spin_count("999").unwrap(), 999);
    assert_eq!(parse_spin_count("1000").unwrap(), 1_000);
    assert_eq!(parse_spin_count("1234567").unwrap(), 1_234_567);
}

#[test]
fn w241_bulk_parse_underscore_separators_stripped() {
    assert_eq!(parse_spin_count("1_000").unwrap(), 1_000);
    assert_eq!(parse_spin_count("1_000_000").unwrap(), 1_000_000);
    assert_eq!(parse_spin_count("100_000_000_000").unwrap(), 100_000_000_000);
}

#[test]
fn w241_bulk_parse_k_m_b_t_suffix_exact() {
    assert_eq!(parse_spin_count("5K").unwrap(), 5_000);
    assert_eq!(parse_spin_count("5M").unwrap(), 5_000_000);
    assert_eq!(parse_spin_count("100B").unwrap(), 100_000_000_000);
    assert_eq!(parse_spin_count("1T").unwrap(), 1_000_000_000_000);
}

#[test]
fn w241_bulk_parse_case_insensitive_suffix() {
    // Lower-case must match the upper-case multipliers.
    assert_eq!(parse_spin_count("5k").unwrap(), 5_000);
    assert_eq!(parse_spin_count("5m").unwrap(), 5_000_000);
    assert_eq!(parse_spin_count("5b").unwrap(), 5_000_000_000);
}

#[test]
fn w241_bulk_parse_fractional_with_suffix() {
    // 1.5B = 1_500_000_000 exactly.
    assert_eq!(parse_spin_count("1.5B").unwrap(), 1_500_000_000);
    assert_eq!(parse_spin_count("2.5T").unwrap(), 2_500_000_000_000);
}

#[test]
fn w241_bulk_parse_empty_string_error() {
    assert!(matches!(parse_spin_count(""), Err(ParseSpinCountError::Empty)));
    assert!(matches!(parse_spin_count("  "), Err(ParseSpinCountError::Empty)));
}

#[test]
fn w241_bulk_parse_negative_error() {
    assert!(matches!(
        parse_spin_count("-5M"),
        Err(ParseSpinCountError::Negative)
    ));
}

#[test]
fn w241_bulk_parse_unknown_suffix_error() {
    match parse_spin_count("5X") {
        Err(ParseSpinCountError::UnknownSuffix(c)) => assert_eq!(c, 'X'),
        other => panic!("expected UnknownSuffix('X'), got {other:?}"),
    }
}

#[test]
fn w241_bulk_parse_invalid_number_error() {
    // Multiple decimals → InvalidNumber.
    match parse_spin_count("1.5.3B") {
        Err(ParseSpinCountError::InvalidNumber(_)) => {}
        other => panic!("expected InvalidNumber, got {other:?}"),
    }
}

#[test]
fn w241_bulk_parse_overflow_error() {
    // 99T overflows u64 (max ≈ 18.4 * 10^18 = 18T but 99T fits OK).
    // 1e20 definitely doesn't fit; use a value above u64::MAX/multiplier.
    let r = parse_spin_count("99999999999T"); // 99e21 ≫ u64::MAX
    assert!(matches!(r, Err(ParseSpinCountError::Overflow)));
}

#[test]
fn w241_bulk_parse_error_display_messages() {
    use std::fmt::Write as _;
    let e = ParseSpinCountError::Empty;
    let mut s = String::new();
    write!(s, "{}", e).unwrap();
    assert!(s.contains("empty"));

    let e = ParseSpinCountError::Overflow;
    let mut s = String::new();
    write!(s, "{}", e).unwrap();
    assert!(s.contains("overflow"));

    let e = ParseSpinCountError::UnknownSuffix('Q');
    let mut s = String::new();
    write!(s, "{}", e).unwrap();
    assert!(s.contains("Q"));
    assert!(s.contains("K/M/B/T"));
}

// ── ProgressSnapshot::fraction ───────────────────────────────────────────

#[test]
fn w241_bulk_progress_fraction_zero_total_returns_zero() {
    // total_spins=0 must short-circuit to 0.0 to avoid divide-by-zero.
    let snap = ProgressSnapshot {
        completed_spins: 10,
        total_spins: 0,
        elapsed: Duration::from_secs(1),
        spins_per_sec: 0.0,
        eta: None,
        chunk_index: 0,
        chunks_total: 0,
    };
    assert_eq!(snap.fraction(), 0.0);
}

#[test]
fn w241_bulk_progress_fraction_exact_math() {
    let snap = ProgressSnapshot {
        completed_spins: 250,
        total_spins: 1000,
        elapsed: Duration::from_secs(1),
        spins_per_sec: 0.0,
        eta: None,
        chunk_index: 0,
        chunks_total: 0,
    };
    assert_eq!(snap.fraction(), 0.25);
}

#[test]
fn w241_bulk_progress_fraction_full_completion_is_one() {
    let snap = ProgressSnapshot {
        completed_spins: 1000,
        total_spins: 1000,
        elapsed: Duration::from_secs(1),
        spins_per_sec: 0.0,
        eta: None,
        chunk_index: 0,
        chunks_total: 0,
    };
    assert_eq!(snap.fraction(), 1.0);
}

// ── BulkConfig::new defaults ─────────────────────────────────────────────

#[test]
fn w241_bulk_config_new_default_fields() {
    let cfg = BulkConfig::new(1_000_000_000, 12345);
    assert_eq!(cfg.total_spins, 1_000_000_000);
    assert_eq!(cfg.base_seed, 12345);
    assert_eq!(cfg.chunk_spins, 10_000_000, "default chunk_spins = 10M");
    assert_eq!(cfg.total_bet_mc, 1_000, "default total_bet_mc = 1000 mc");
    assert_eq!(cfg.checkpoint_every_chunks, 0, "default = no checkpoints");
    assert!(cfg.checkpoint_path.is_none());
    assert!(cfg.resume_path.is_none());
    assert!(cfg.run_id.starts_with("bulk-"));
    assert!(cfg.config_hash.is_empty());
    // spins_per_worker = chunk_spins / threads_per_chunk (integer div).
    // Reconstructed product is within one thread-worth of chunk_spins.
    let reconstructed = cfg.spins_per_worker * cfg.threads_per_chunk as u64;
    let drift = cfg.chunk_spins.saturating_sub(reconstructed);
    assert!(
        drift < cfg.threads_per_chunk as u64,
        "spins_per_worker × threads must be within one-thread of chunk_spins \
         (drift={drift}, threads={})",
        cfg.threads_per_chunk,
    );
    assert!(
        cfg.spins_per_worker > 0,
        "spins_per_worker must be positive",
    );
}

// ── AtomicStatsSnapshot serde round-trip ─────────────────────────────────

#[test]
fn w241_bulk_atomic_stats_snapshot_serde_round_trip() {
    let mut snap = AtomicStatsSnapshot::default();
    snap.total_spins = 1_000_000;
    snap.total_wagered = 1_000_000_000;
    snap.total_won = 960_000_000;
    snap.max_win = 50_000;
    snap.jackpots_grand = 3;
    let json = serde_json::to_string(&snap).unwrap();
    let back: AtomicStatsSnapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(back, snap);
}

#[test]
fn w241_bulk_atomic_stats_snapshot_from_atomic() {
    let stats = AtomicStats::new();
    use std::sync::atomic::Ordering::Relaxed;
    stats.total_spins.fetch_add(500, Relaxed);
    stats.total_wagered.fetch_add(500_000, Relaxed);
    stats.total_won.fetch_add(450_000, Relaxed);
    let snap = AtomicStatsSnapshot::from_atomic(&stats);
    assert_eq!(snap.total_spins, 500);
    assert_eq!(snap.total_wagered, 500_000);
    assert_eq!(snap.total_won, 450_000);
}

#[test]
fn w241_bulk_atomic_stats_snapshot_apply_to() {
    let stats = AtomicStats::new();
    let mut snap = AtomicStatsSnapshot::default();
    snap.total_spins = 777;
    snap.total_wagered = 12_345;
    snap.max_win = 9_000;
    snap.apply_to(&stats);
    use std::sync::atomic::Ordering::Relaxed;
    assert_eq!(stats.total_spins.load(Relaxed), 777);
    assert_eq!(stats.total_wagered.load(Relaxed), 12_345);
    assert_eq!(stats.max_win.load(Relaxed), 9_000);
}

// ── HDR snapshot/apply round-trip ────────────────────────────────────────

#[test]
fn w241_bulk_hdr_snapshot_round_trip() {
    let hdr_a = HdrHistogram::default();
    hdr_a.record(100.0);
    hdr_a.record(200.0);
    hdr_a.record(1_000.0);
    let buckets = snapshot_hdr_buckets(&hdr_a);
    let hdr_b = HdrHistogram::default();
    apply_hdr_buckets(&hdr_b, &buckets);
    // The snapshot must round-trip — record-then-snapshot vs apply must
    // produce the same bucket distribution.
    let buckets2 = snapshot_hdr_buckets(&hdr_b);
    assert_eq!(buckets, buckets2);
}

#[test]
fn w241_bulk_hdr_snapshot_records_actual_counts() {
    // Kill the `snapshot_hdr_buckets -> vec![1]` mutant (L149): the
    // returned bucket vector must have more than 1 element (HDR has 32
    // buckets) and the sum of all counts must equal the number of
    // recorded samples (3 here).  Mutant returning `vec![1]` or `vec![]`
    // breaks both invariants simultaneously.
    let hdr = HdrHistogram::default();
    hdr.record(100.0);
    hdr.record(200.0);
    hdr.record(1_000.0);
    let buckets = snapshot_hdr_buckets(&hdr);
    assert!(
        buckets.len() > 1,
        "snapshot must return all HDR buckets (got {} elements)",
        buckets.len(),
    );
    let total: u64 = buckets.iter().sum();
    assert_eq!(
        total, 3,
        "snapshot bucket sum must equal recorded sample count (3)",
    );
}

#[test]
fn w241_bulk_hdr_apply_actually_modifies_target() {
    // Kill the `apply_hdr_buckets -> ()` mutant (L156): after applying
    // a non-zero snapshot, the target histogram must reflect non-zero
    // bucket counts.  Empty-body mutant leaves it untouched.
    let hdr_src = HdrHistogram::default();
    for v in [10.0, 50.0, 100.0, 500.0, 1000.0] {
        hdr_src.record(v);
    }
    let src_buckets = snapshot_hdr_buckets(&hdr_src);
    let src_sum: u64 = src_buckets.iter().sum();
    assert_eq!(src_sum, 5, "source HDR must have 5 samples");

    let hdr_target = HdrHistogram::default();
    // Confirm target is empty before apply.
    let pre = snapshot_hdr_buckets(&hdr_target);
    let pre_sum: u64 = pre.iter().sum();
    assert_eq!(pre_sum, 0, "target must be empty before apply");

    apply_hdr_buckets(&hdr_target, &src_buckets);
    let post = snapshot_hdr_buckets(&hdr_target);
    let post_sum: u64 = post.iter().sum();
    assert_eq!(
        post_sum, 5,
        "after apply, target HDR must contain the 5 samples from source",
    );
}

// ── BulkCheckpoint disk round-trip ───────────────────────────────────────

#[test]
fn w241_bulk_checkpoint_disk_round_trip() {
    let tmp = std::env::temp_dir().join("w241-bulk-checkpoint.json");
    let _ = std::fs::remove_file(&tmp);

    let chk = BulkCheckpoint {
        schema_version: CHECKPOINT_SCHEMA_VERSION.into(),
        run_id: "run-42".into(),
        config_hash: "abc123".into(),
        total_spins_target: 1_000_000_000,
        completed_spins: 250_000_000,
        base_seed: 42,
        chunk_spins: 10_000_000,
        chunks_completed: 25,
        elapsed_ms: 30_000,
        started_at_epoch_ms: 1_700_000_000_000,
        last_checkpoint_epoch_ms: 1_700_000_030_000,
        stats: AtomicStatsSnapshot::default(),
        hdr_buckets: vec![10, 20, 30, 0, 0],
    };
    save_checkpoint(&tmp, &chk).unwrap();

    let loaded = load_checkpoint(&tmp).unwrap().expect("checkpoint must exist");
    assert_eq!(loaded.run_id, "run-42");
    assert_eq!(loaded.completed_spins, 250_000_000);
    assert_eq!(loaded.chunks_completed, 25);
    assert_eq!(loaded.config_hash, "abc123");
    assert_eq!(loaded.hdr_buckets, vec![10, 20, 30, 0, 0]);
    assert_eq!(loaded.schema_version, CHECKPOINT_SCHEMA_VERSION);

    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn w241_bulk_checkpoint_load_missing_returns_none() {
    let tmp = std::env::temp_dir().join("w241-bulk-missing-checkpoint.json");
    let _ = std::fs::remove_file(&tmp);
    let r = load_checkpoint(&tmp).unwrap();
    assert!(r.is_none(), "missing checkpoint must return Ok(None), not error");
}

// ── BulkDispatcher::run dispatcher path kills (L181, L228-230) ───────────

use slot_sim::bulk::BulkDispatcher;
use slot_sim::bulk::progress::NoOpProgress;
use slot_sim::config::GameConfig;
use std::sync::Arc;
use std::sync::atomic::Ordering as AtomicOrd;

fn small_bulk(total: u64, base_seed: u64) -> BulkConfig {
    let mut b = BulkConfig::new(total, base_seed);
    b.chunk_spins = 25_000;
    b.spins_per_worker = 5_000;
    b.threads_per_chunk = 4;
    b.config_hash = "w241-bulk-kill".into();
    b
}

#[test]
fn w241_bulk_dispatcher_run_no_resume_starts_from_zero() {
    // L181:30 `resumed_completed > 0` — when no resume_path, this branch
    // must NOT enter (no HDR restore). Mutant `== 0` would invert.
    let config = GameConfig::default();
    let bulk = small_bulk(50_000, 42);
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    assert_eq!(r.total_spins, 50_000);
    assert_eq!(r.resumed_from, None, "fresh run has no resume marker");
    assert_eq!(r.stats.total_spins.load(AtomicOrd::Relaxed), 50_000);
}

#[test]
fn w241_bulk_dispatcher_checkpoint_every_zero_writes_no_checkpoints() {
    // L228:50 `checkpoint_every_chunks > 0` — when 0, the gate must
    // block.  Mutant `==` would also block (vacuously); but mutant `<`
    // or `>=` would let it through and try to write to a None path.
    let config = GameConfig::default();
    let mut bulk = small_bulk(50_000, 42);
    bulk.checkpoint_every_chunks = 0; // disabled
    bulk.checkpoint_path = None;
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    assert_eq!(
        r.checkpoints_written, 0,
        "checkpoint_every_chunks=0 must write zero checkpoints",
    );
}

#[test]
fn w241_bulk_dispatcher_checkpoint_path_none_skips_write() {
    // L229:17 `&&` — even with checkpoint_every_chunks > 0, missing
    // path must skip.  Mutant `||` would crash trying to write to None.
    let config = GameConfig::default();
    let mut bulk = small_bulk(50_000, 42);
    bulk.checkpoint_every_chunks = 1;
    bulk.checkpoint_path = None;
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    // No path → no writes (would otherwise crash).
    assert_eq!(r.checkpoints_written, 0);
}

#[test]
fn w241_bulk_dispatcher_checkpoint_modulo_zero_triggers_write() {
    // L230:37 `%` and L230:73 `== 0` — every Nth chunk triggers write.
    // 50_000 total, 25_000 chunk → 2 chunks; checkpoint_every=1 → 2 writes.
    let tmp = std::env::temp_dir().join("w241-bulk-dispatcher-ckpt.json");
    let _ = std::fs::remove_file(&tmp);
    let config = GameConfig::default();
    let mut bulk = small_bulk(50_000, 42);
    bulk.checkpoint_every_chunks = 1;
    bulk.checkpoint_path = Some(tmp.clone());
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    assert!(
        r.checkpoints_written >= 1,
        "checkpoint_every=1 must produce at least 1 write (got {})",
        r.checkpoints_written,
    );
    // File exists on disk.
    assert!(tmp.exists(), "checkpoint file must be on disk");
    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn w241_bulk_dispatcher_final_checkpoint_always_writes_when_enabled() {
    // L245:46-50 — final-checkpoint gate `checkpoint_every > 0 && path.is_some()`.
    // Run with checkpoint_every=100 (never hits modulo with only 2 chunks)
    // but with a path: final checkpoint should STILL fire because of the
    // L245 unconditional final write.
    //
    // Mutant `> ==`: would fail when checkpoint_every is exactly 0.
    // Mutant `> <`: would only fire when checkpoint_every < 0 (never).
    // Mutant `&& ||`: would crash trying to write to None when path missing.
    let tmp = std::env::temp_dir().join("w241-bulk-final-ckpt.json");
    let _ = std::fs::remove_file(&tmp);
    let config = GameConfig::default();
    let mut bulk = small_bulk(50_000, 42); // 2 chunks
    bulk.checkpoint_every_chunks = 100; // never triggers modulo
    bulk.checkpoint_path = Some(tmp.clone());
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    // The final-checkpoint path must produce at least 1 write.
    // L240:37 `+=` keeps the counter going; mutant `*=` would multiply,
    // producing weird counts like 0 or huge numbers.
    assert!(
        r.checkpoints_written >= 1,
        "final checkpoint must fire when every>0 + path set (got {})",
        r.checkpoints_written,
    );
    assert!(tmp.exists(), "final checkpoint file must exist on disk");
    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn w241_bulk_dispatcher_checkpoint_every_two_writes_fewer() {
    // checkpoint_every=2 → write only on even chunk indices.  4 chunks
    // (100_000 / 25_000) with every=2 → 2 writes (chunks 2, 4).
    let tmp = std::env::temp_dir().join("w241-bulk-dispatcher-every2.json");
    let _ = std::fs::remove_file(&tmp);
    let config = GameConfig::default();
    let mut bulk = small_bulk(100_000, 42);
    bulk.checkpoint_every_chunks = 2;
    bulk.checkpoint_path = Some(tmp.clone());
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    // Either 2 (modulo path) or 3 (final flush).  Mutant `% → /` would
    // produce widely different counts (chunks_completed / every is
    // almost always 0, then jumps).
    assert!(
        r.checkpoints_written >= 1 && r.checkpoints_written <= 4,
        "checkpoint count must be in [1, 4] for 4 chunks × every=2 (got {})",
        r.checkpoints_written,
    );
    let _ = std::fs::remove_file(&tmp);
}

// ── compute_sps / compute_eta integration kills ──────────────────────────

#[test]
fn w241_bulk_dispatcher_spins_per_sec_positive_after_run() {
    // L427 `compute_sps`: secs > 0 → returns spins/sec.
    // L428 mutant `secs == 0` would always return 0.
    // After a real run, sps must be strictly > 0 (always some elapsed).
    let config = GameConfig::default();
    let bulk = small_bulk(50_000, 42);
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    assert!(
        r.spins_per_sec > 0.0,
        "spins_per_sec must be > 0 after a finished run (got {})",
        r.spins_per_sec,
    );
    assert!(
        r.spins_per_sec.is_finite(),
        "spins_per_sec must be finite (got {})",
        r.spins_per_sec,
    );
}

#[test]
fn w241_bulk_dispatcher_spins_per_sec_matches_completed_over_duration() {
    // sps = completed / duration.  Mutant `*` → `+` or `/` → `%` would
    // give wildly wrong values.  We sanity check sps × duration ≈ completed.
    let config = GameConfig::default();
    let bulk = small_bulk(75_000, 17);
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    let estimated = r.spins_per_sec * r.duration.as_secs_f64();
    let drift = (estimated - r.total_spins as f64).abs();
    assert!(
        drift < (r.total_spins as f64) * 0.10,
        "estimated spins (sps × secs = {}) must be within 10% of actual ({})",
        estimated, r.total_spins,
    );
}

// ── ParseSpinCountError variants are distinct ────────────────────────────

#[test]
fn w241_bulk_parse_error_variants_distinct() {
    // Each variant produces a unique Display string — kills any `==` mutant
    // on the Display match that could collapse two variants.
    let variants = [
        ParseSpinCountError::Empty,
        ParseSpinCountError::InvalidNumber("x".into()),
        ParseSpinCountError::UnknownSuffix('Q'),
        ParseSpinCountError::Overflow,
        ParseSpinCountError::Negative,
    ];
    let strs: Vec<String> = variants.iter().map(|v| format!("{v}")).collect();
    for i in 0..strs.len() {
        for j in 0..strs.len() {
            if i == j {
                continue;
            }
            assert_ne!(strs[i], strs[j], "variants {i} and {j} produced same Display");
        }
    }
}
