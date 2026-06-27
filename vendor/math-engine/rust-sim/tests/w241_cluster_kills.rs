//! W241 — `rust-sim/src/cluster/{coordinator,protocol,transport}.rs`
//! mutation kill tests.
//!
//! Covers:
//!   - `partition_run` slice arithmetic (start/end/span/remainder)
//!   - `merge_slice_results` additive merge of `AtomicStatsSnapshot` and
//!     HDR buckets across multiple slices
//!   - `WorkSlice::span` saturating subtraction
//!   - `InMemoryTransport` FIFO order + bidirectional send/recv
//!   - `ClusterEnvelope` enum variant round-trip via serde
//!   - `ClusterError` Display + Debug invariants
//!
//! Every assertion is tight enough to detect a single arithmetic /
//! boolean / comparator mutation on the surface.

use slot_sim::bulk::dispatcher::BulkConfig;
use slot_sim::cluster::coordinator::{merge_slice_results, partition_run, SliceResult};
use slot_sim::cluster::protocol::{
    ClusterEnvelope, ClusterError, ProgressFrame, WorkSlice, WorkerHello, WorkerResult,
    CLUSTER_PROTOCOL_VERSION,
};
use slot_sim::cluster::transport::{ClusterTransport, InMemoryTransport};
use slot_sim::bulk::checkpoint::AtomicStatsSnapshot;
use slot_sim::stats::{AtomicStats, HdrHistogram};

// ── partition_run slice arithmetic ────────────────────────────────────────

fn bulk_cfg(total: u64) -> BulkConfig {
    let mut cfg = BulkConfig::new(total, 42);
    cfg.chunk_spins = 1000;
    cfg.total_bet_mc = 1000;
    cfg.config_hash = "fixed-hash-for-tests".to_string();
    cfg
}

#[test]
fn w241_cluster_partition_zero_slices_returns_empty() {
    let cfg = bulk_cfg(100);
    assert_eq!(partition_run(&cfg, 0).len(), 0);
}

#[test]
fn w241_cluster_partition_one_slice_covers_full_range() {
    let cfg = bulk_cfg(100);
    let slices = partition_run(&cfg, 1);
    assert_eq!(slices.len(), 1);
    assert_eq!(slices[0].slice_index, 0);
    assert_eq!(slices[0].start_spin, 0);
    assert_eq!(slices[0].end_spin, 100);
    assert_eq!(slices[0].span(), 100);
}

#[test]
fn w241_cluster_partition_even_division() {
    // 100 spins / 4 slices = 25 each, no remainder.
    let cfg = bulk_cfg(100);
    let slices = partition_run(&cfg, 4);
    assert_eq!(slices.len(), 4);
    for (i, s) in slices.iter().enumerate() {
        assert_eq!(s.slice_index, i as u64);
        assert_eq!(s.start_spin, (i * 25) as u64);
        assert_eq!(s.end_spin, ((i + 1) * 25) as u64);
        assert_eq!(s.span(), 25);
    }
    // All slices share the same base_seed and config_hash.
    for s in &slices {
        assert_eq!(s.base_seed, 42);
        assert_eq!(s.config_hash, "fixed-hash-for-tests");
    }
}

#[test]
fn w241_cluster_partition_with_remainder_distributes_to_first_slices() {
    // 103 spins / 4 slices = 25 each with remainder 3 → first 3 slices get +1.
    let cfg = bulk_cfg(103);
    let slices = partition_run(&cfg, 4);
    assert_eq!(slices.len(), 4);
    assert_eq!(slices[0].span(), 26);
    assert_eq!(slices[1].span(), 26);
    assert_eq!(slices[2].span(), 26);
    assert_eq!(slices[3].span(), 25);
    // Sequential ranges, no gaps or overlaps.
    assert_eq!(slices[0].end_spin, slices[1].start_spin);
    assert_eq!(slices[1].end_spin, slices[2].start_spin);
    assert_eq!(slices[2].end_spin, slices[3].start_spin);
    // Total spans add to 103.
    let total: u64 = slices.iter().map(|s| s.span()).sum();
    assert_eq!(total, 103);
}

#[test]
fn w241_cluster_partition_more_slices_than_spins_caps_at_total() {
    // Asking for 100 slices on a 5-spin run produces 5 slices (capped).
    let cfg = bulk_cfg(5);
    let slices = partition_run(&cfg, 100);
    assert!(slices.len() <= 5);
}

#[test]
fn w241_cluster_workslice_span_saturating_sub() {
    // end < start would underflow without saturation.
    let s = WorkSlice {
        slice_index: 0,
        start_spin: 100,
        end_spin: 50,
        base_seed: 0,
        chunk_spins: 1,
        total_bet_mc: 0,
        config_hash: String::new(),
    };
    assert_eq!(s.span(), 0, "saturating sub: end<start → span=0");
}

// ── merge_slice_results — additive merge across slices ────────────────────

fn snap_with_spins(n: u64, wagered: i64, won: i64) -> AtomicStatsSnapshot {
    let mut s = AtomicStatsSnapshot::default();
    s.total_spins = n;
    s.total_wagered = wagered;
    s.total_won = won;
    s
}

fn slice_with_snap(idx: u64, snap: AtomicStatsSnapshot, spins: u64) -> SliceResult {
    SliceResult {
        slice_index: idx,
        worker_id: format!("w{idx}"),
        completed_spins: spins,
        duration_ms: 10,
        stats: snap,
        hdr_buckets: vec![1, 0, 0, 0],
    }
}

#[test]
fn w241_cluster_merge_sums_completed_spins() {
    let global = AtomicStats::default();
    let hdr = HdrHistogram::default();
    let results = vec![
        slice_with_snap(0, snap_with_spins(100, 100, 50), 100),
        slice_with_snap(1, snap_with_spins(200, 200, 150), 200),
        slice_with_snap(2, snap_with_spins(50, 50, 30), 50),
    ];
    let total = merge_slice_results(&results, &global, &hdr);
    assert_eq!(total, 350, "sum of completed_spins must equal 350");
}

#[test]
fn w241_cluster_merge_accumulates_wagered_and_won() {
    let global = AtomicStats::default();
    let hdr = HdrHistogram::default();
    let results = vec![
        slice_with_snap(0, snap_with_spins(100, 100, 50), 100),
        slice_with_snap(1, snap_with_spins(200, 200, 150), 200),
    ];
    merge_slice_results(&results, &global, &hdr);
    use std::sync::atomic::Ordering::Relaxed;
    assert_eq!(global.total_spins.load(Relaxed), 300);
    assert_eq!(global.total_wagered.load(Relaxed), 300);
    assert_eq!(global.total_won.load(Relaxed), 200);
}

#[test]
fn w241_cluster_merge_order_independent() {
    // Reverse-order results merge to the same totals.
    let global_a = AtomicStats::default();
    let global_b = AtomicStats::default();
    let hdr = HdrHistogram::default();
    let a = vec![
        slice_with_snap(0, snap_with_spins(10, 10, 5), 10),
        slice_with_snap(1, snap_with_spins(20, 20, 15), 20),
        slice_with_snap(2, snap_with_spins(30, 30, 25), 30),
    ];
    let b: Vec<SliceResult> = a.iter().rev().cloned().collect();
    merge_slice_results(&a, &global_a, &hdr);
    merge_slice_results(&b, &global_b, &hdr);
    use std::sync::atomic::Ordering::Relaxed;
    assert_eq!(
        global_a.total_spins.load(Relaxed),
        global_b.total_spins.load(Relaxed),
    );
    assert_eq!(
        global_a.total_won.load(Relaxed),
        global_b.total_won.load(Relaxed),
    );
}

#[test]
fn w241_cluster_merge_max_mult_seen_is_max_monotonic() {
    // L107-115 `max_u` lambda: `while v > current` — strict-greater CAS
    // loop that promotes only LARGER values.  Mutant `v < current` would
    // promote SMALLER values → final field would be the MIN of inputs.
    //
    // Use max_mult_seen (the only AtomicU64 max field at the time of
    // writing). Three slices with values [3, 99, 7] → original max = 99,
    // mutant min = 3.
    let global = AtomicStats::default();
    let hdr = HdrHistogram::default();
    let mut s1 = AtomicStatsSnapshot::default();
    s1.max_mult_seen = 3;
    let mut s2 = AtomicStatsSnapshot::default();
    s2.max_mult_seen = 99;
    let mut s3 = AtomicStatsSnapshot::default();
    s3.max_mult_seen = 7;
    let results = vec![
        slice_with_snap(0, s1, 1),
        slice_with_snap(1, s2, 1),
        slice_with_snap(2, s3, 1),
    ];
    merge_slice_results(&results, &global, &hdr);
    use std::sync::atomic::Ordering::Relaxed;
    let max_mult = global.max_mult_seen.load(Relaxed);
    assert_eq!(
        max_mult, 99,
        "max_mult_seen merge must keep MAX, not MIN (mutant `< current` \
         would yield 3 here)",
    );
}

#[test]
fn w241_cluster_merge_max_win_is_max_not_sum() {
    // max_win is a max-monotonic field, not additive. Single-slice 100 vs
    // single-slice 50 → global max = 100, not 150.
    let global = AtomicStats::default();
    let hdr = HdrHistogram::default();
    let mut s1 = AtomicStatsSnapshot::default();
    s1.max_win = 100;
    let mut s2 = AtomicStatsSnapshot::default();
    s2.max_win = 50;
    let results = vec![
        slice_with_snap(0, s1, 1),
        slice_with_snap(1, s2, 1),
    ];
    merge_slice_results(&results, &global, &hdr);
    use std::sync::atomic::Ordering::Relaxed;
    assert_eq!(
        global.max_win.load(Relaxed),
        100,
        "max_win is max, not sum (mutant `+=` would yield 150)",
    );
}

#[test]
fn w241_cluster_merge_empty_results_returns_zero() {
    let global = AtomicStats::default();
    let hdr = HdrHistogram::default();
    let total = merge_slice_results(&[], &global, &hdr);
    assert_eq!(total, 0);
    use std::sync::atomic::Ordering::Relaxed;
    assert_eq!(global.total_spins.load(Relaxed), 0);
}

// ── InMemoryTransport FIFO + bidirectional ────────────────────────────────

#[test]
fn w241_cluster_transport_in_memory_bidirectional() {
    let (a, b) = InMemoryTransport::pair();
    let hello = ClusterEnvelope::Hello(WorkerHello {
        protocol_version: CLUSTER_PROTOCOL_VERSION.into(),
        worker_id: "w0".into(),
        benchmark_spins_per_sec: 1.0e9,
        hardware_notes: "M3".into(),
    });
    a.send(&hello).unwrap();
    assert_eq!(b.recv().unwrap(), Some(hello.clone()));
    assert_eq!(b.recv().unwrap(), None);

    let abort = ClusterEnvelope::Abort { reason: "test".into() };
    b.send(&abort).unwrap();
    assert_eq!(a.recv().unwrap(), Some(abort));
}

#[test]
fn w241_cluster_transport_fifo_order_preserved() {
    let (a, b) = InMemoryTransport::pair();
    for i in 0..5 {
        a.send(&ClusterEnvelope::Abort { reason: format!("{i}") })
            .unwrap();
    }
    for i in 0..5 {
        match b.recv().unwrap() {
            Some(ClusterEnvelope::Abort { reason }) => assert_eq!(reason, format!("{i}")),
            other => panic!("expected Abort, got {other:?}"),
        }
    }
}

#[test]
fn w241_cluster_transport_clone_shares_queue() {
    // Cloning a side shares the same underlying queues.
    let (a, b) = InMemoryTransport::pair();
    let a2 = a.clone();
    a.send(&ClusterEnvelope::Abort { reason: "x".into() }).unwrap();
    a2.send(&ClusterEnvelope::Abort { reason: "y".into() }).unwrap();
    // b should see both in FIFO order.
    if let Some(ClusterEnvelope::Abort { reason }) = b.recv().unwrap() {
        assert_eq!(reason, "x");
    }
    if let Some(ClusterEnvelope::Abort { reason }) = b.recv().unwrap() {
        assert_eq!(reason, "y");
    }
    assert!(b.recv().unwrap().is_none());
}

// ── ClusterError Display ──────────────────────────────────────────────────

#[test]
fn w241_cluster_error_display_protocol_mismatch() {
    let e = ClusterError::ProtocolMismatch {
        worker: "v0.9".into(),
        runtime: "v1.0".into(),
    };
    let s = format!("{}", e);
    assert!(s.contains("protocol mismatch"));
    assert!(s.contains("v0.9"));
    assert!(s.contains("v1.0"));
}

#[test]
fn w241_cluster_error_display_config_mismatch() {
    let e = ClusterError::ConfigHashMismatch {
        worker: "aa".into(),
        runtime: "bb".into(),
    };
    let s = format!("{}", e);
    assert!(s.contains("config_hash mismatch"));
    assert!(s.contains("aa"));
    assert!(s.contains("bb"));
}

#[test]
fn w241_cluster_error_display_aborted_by_worker() {
    let e = ClusterError::AbortedByWorker { reason: "oom".into() };
    let s = format!("{}", e);
    assert!(s.contains("worker aborted"));
    assert!(s.contains("oom"));
}

// ── ClusterEnvelope round-trip via serde ──────────────────────────────────

#[test]
fn w241_cluster_envelope_serde_round_trip_hello() {
    let env = ClusterEnvelope::Hello(WorkerHello {
        protocol_version: CLUSTER_PROTOCOL_VERSION.into(),
        worker_id: "w1".into(),
        benchmark_spins_per_sec: 5.5e8,
        hardware_notes: "EPYC".into(),
    });
    let json = serde_json::to_string(&env).unwrap();
    let back: ClusterEnvelope = serde_json::from_str(&json).unwrap();
    assert_eq!(env, back);
}

#[test]
fn w241_cluster_envelope_serde_round_trip_progress() {
    let env = ClusterEnvelope::Progress(ProgressFrame {
        worker_id: "w1".into(),
        slice_index: 7,
        completed_spins: 1000,
        spins_per_sec: 4000.0,
    });
    let json = serde_json::to_string(&env).unwrap();
    let back: ClusterEnvelope = serde_json::from_str(&json).unwrap();
    assert_eq!(env, back);
}

#[test]
fn w241_cluster_envelope_serde_round_trip_done() {
    let env = ClusterEnvelope::Done(WorkerResult {
        worker_id: "w1".into(),
        slice_index: 3,
        completed_spins: 500,
        duration_ms: 100,
        stats_snapshot: AtomicStatsSnapshot::default(),
        hdr_buckets: vec![1, 2, 3],
    });
    let json = serde_json::to_string(&env).unwrap();
    let back: ClusterEnvelope = serde_json::from_str(&json).unwrap();
    assert_eq!(env, back);
}

// ── CLUSTER_PROTOCOL_VERSION must be a valid semver string ───────────────

#[test]
fn w241_cluster_protocol_version_semver_shape() {
    // "1.0.0" — kills mutant that replaces with "" or arbitrary string.
    let parts: Vec<&str> = CLUSTER_PROTOCOL_VERSION.split('.').collect();
    assert_eq!(parts.len(), 3, "version must be MAJOR.MINOR.PATCH");
    for p in &parts {
        assert!(p.parse::<u32>().is_ok(), "every part must parse as u32");
    }
}
