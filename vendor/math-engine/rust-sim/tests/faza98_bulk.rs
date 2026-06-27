//! Faza 9.8 acceptance — `BulkDispatcher` semantics + parity vs.
//! single-machine simulator + cluster partition determinism.
//!
//! Tests in this file deliberately stay small (low-millions spins) so
//! they run inside CI's per-test wall-clock budget. The 1T end-to-end
//! benchmark lives in `benches/bulk_throughput.rs` and is invoked
//! separately by `cargo bench`.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use slot_sim::bulk::{
    parse_spin_count, BulkConfig, BulkDispatcher, NoOpProgress, ProgressReporter,
};
use slot_sim::cluster::{partition_run, ClusterCoordinator, SliceResult};
use slot_sim::config::GameConfig;
use slot_sim::stats::{AtomicStats, HdrHistogram};

fn cfg() -> GameConfig {
    GameConfig::default()
}

fn make_bulk(total: u64, base_seed: u64) -> BulkConfig {
    let mut b = BulkConfig::new(total, base_seed);
    b.chunk_spins = 25_000;
    b.spins_per_worker = 5_000;
    b.threads_per_chunk = 4;
    b.config_hash = "faza98-test".into();
    b
}

// ─── parse_spin_count ─────────────────────────────────────────────────

#[test]
fn parse_spin_count_handles_suffixes() {
    assert_eq!(parse_spin_count("1T").unwrap(), 1_000_000_000_000);
    assert_eq!(parse_spin_count("100B").unwrap(), 100_000_000_000);
    assert_eq!(parse_spin_count("1.5B").unwrap(), 1_500_000_000);
    assert_eq!(parse_spin_count("5M").unwrap(), 5_000_000);
    assert_eq!(parse_spin_count("1000").unwrap(), 1_000);
}

// ─── End-to-end small run ─────────────────────────────────────────────

#[test]
fn bulk_run_executes_all_spins() {
    let config = cfg();
    let dispatcher = BulkDispatcher::new(&config, make_bulk(100_000, 42), Arc::new(NoOpProgress));
    let r = dispatcher.run().unwrap();
    assert_eq!(r.total_spins, 100_000);
    assert_eq!(r.stats.total_spins.load(Ordering::Relaxed), 100_000);
    assert!(r.spins_per_sec > 0.0);
}

#[test]
fn bulk_run_is_deterministic_across_invocations() {
    let config = cfg();
    let r1 = BulkDispatcher::new(&config, make_bulk(50_000, 9999), Arc::new(NoOpProgress))
        .run()
        .unwrap();
    let r2 = BulkDispatcher::new(&config, make_bulk(50_000, 9999), Arc::new(NoOpProgress))
        .run()
        .unwrap();
    assert_eq!(
        r1.stats.total_won.load(Ordering::Relaxed),
        r2.stats.total_won.load(Ordering::Relaxed),
        "determinism: same seed + config → same total_won"
    );
    assert_eq!(r1.hdr.snapshot(), r2.hdr.snapshot());
}

// ─── Checkpoint + resume ──────────────────────────────────────────────

#[test]
fn checkpoint_resume_continues_from_disk() {
    let tmp = tempfile::tempdir().unwrap();
    let ckpt = tmp.path().join("run.ckpt");

    let mut first = make_bulk(40_000, 17);
    first.checkpoint_every_chunks = 1;
    first.checkpoint_path = Some(ckpt.clone());

    let r1 = BulkDispatcher::new(&cfg(), first, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    assert!(r1.checkpoints_written >= 1);

    // Now spin up a fresh dispatcher pointed at the same checkpoint.
    let mut second = make_bulk(40_000, 17);
    second.resume_path = Some(ckpt.clone());
    second.checkpoint_path = Some(ckpt);
    let r2 = BulkDispatcher::new(&cfg(), second, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    assert_eq!(r2.total_spins, 40_000);
    assert_eq!(r2.stats.total_spins.load(Ordering::Relaxed), 40_000);
}

// ─── Cluster partition + merge ────────────────────────────────────────

#[test]
fn cluster_partition_recovers_total() {
    let bulk = make_bulk(100_000, 31);
    let slices = partition_run(&bulk, 4);
    let span_sum: u64 = slices.iter().map(|s| s.span()).sum();
    assert_eq!(span_sum, 100_000);
    // Indices are unique + monotonic.
    let mut ids: Vec<u64> = slices.iter().map(|s| s.slice_index).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), 4);
}

#[test]
fn cluster_merge_recovers_single_machine_stats() {
    // Run the same workload two ways:
    //   (a) single dispatcher
    //   (b) two dispatchers, each on half the seed range, merged via
    //       the cluster merger
    // and assert the aggregate counters match within additive ops.
    let bulk_single = make_bulk(60_000, 7);

    let r_single = BulkDispatcher::new(&cfg(), bulk_single.clone(), Arc::new(NoOpProgress))
        .run()
        .unwrap();

    // Two slices of equal size. To keep the test deterministic and
    // reproducible we don't reuse the dispatcher seed derivation here —
    // instead we run each slice through its own dispatcher with a
    // sub-config that mirrors the slice geometry, then merge.
    let mut left = bulk_single.clone();
    left.total_spins = 30_000;
    left.base_seed = bulk_single.base_seed;
    let mut right = bulk_single.clone();
    right.total_spins = 30_000;
    right.base_seed = bulk_single.base_seed.wrapping_add(1_000_000);

    let rl = BulkDispatcher::new(&cfg(), left, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    let rr = BulkDispatcher::new(&cfg(), right, Arc::new(NoOpProgress))
        .run()
        .unwrap();

    let global = AtomicStats::new();
    let hdr = HdrHistogram::default();
    let merger = ClusterCoordinator::new(vec![], &global, &hdr);
    use slot_sim::bulk::checkpoint::AtomicStatsSnapshot;
    let total = merger.finish(vec![
        SliceResult {
            slice_index: 0,
            worker_id: "a".into(),
            completed_spins: rl.total_spins,
            duration_ms: rl.duration.as_millis() as u64,
            stats: AtomicStatsSnapshot::from_atomic(&rl.stats),
            hdr_buckets: rl.hdr.snapshot().to_vec(),
        },
        SliceResult {
            slice_index: 1,
            worker_id: "b".into(),
            completed_spins: rr.total_spins,
            duration_ms: rr.duration.as_millis() as u64,
            stats: AtomicStatsSnapshot::from_atomic(&rr.stats),
            hdr_buckets: rr.hdr.snapshot().to_vec(),
        },
    ]);
    assert_eq!(total, 60_000);
    assert_eq!(global.total_spins.load(Ordering::Relaxed), 60_000);
    // Aggregate spins are additive — the merged total must match the
    // single-machine run's total_spins exactly. We don't assert
    // total_won equality because the merged run uses two distinct seed
    // schedules (left vs right), so the RNG stream — and therefore the
    // total payout — differs from the single contiguous run. The
    // contract under test here is "merge math doesn't lose spins".
    assert_eq!(
        global.total_spins.load(Ordering::Relaxed),
        r_single.stats.total_spins.load(Ordering::Relaxed)
    );
    // Merged total_won should equal the sum of the two slice totals.
    let expected_won =
        rl.stats.total_won.load(Ordering::Relaxed) + rr.stats.total_won.load(Ordering::Relaxed);
    assert_eq!(global.total_won.load(Ordering::Relaxed), expected_won);
}

// ─── Progress reporter wiring ─────────────────────────────────────────

#[test]
fn progress_reporter_receives_ticks() {
    use slot_sim::bulk::ProgressSnapshot;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Counting {
        ticks: Mutex<Vec<u64>>,
        finished: Mutex<bool>,
    }
    impl ProgressReporter for Counting {
        fn report(&self, snap: &ProgressSnapshot) {
            self.ticks.lock().unwrap().push(snap.completed_spins);
        }
        fn finish(&self, _: &ProgressSnapshot) {
            *self.finished.lock().unwrap() = true;
        }
    }

    let reporter = Arc::new(Counting::default());
    let r = BulkDispatcher::new(&cfg(), make_bulk(100_000, 1), reporter.clone())
        .run()
        .unwrap();
    assert_eq!(r.total_spins, 100_000);
    let ticks = reporter.ticks.lock().unwrap().clone();
    // 100k / 25k chunks = 4 chunks ⇒ 4 progress ticks.
    assert_eq!(ticks.len(), 4);
    assert_eq!(*ticks.last().unwrap(), 100_000);
    assert!(*reporter.finished.lock().unwrap());
}

// ─── 1T projection helper (acceptance gate canary) ────────────────────

#[test]
fn throughput_projects_one_trillion_runtime() {
    // Measure spins/sec on a 1M-spin sample and print the projected 1T
    // runtime for the operator to read. We don't gate on the 60s
    // acceptance target in this test — that's reserved for the criterion
    // bench (`cargo bench --bench bulk_throughput`) which runs in
    // release mode. Debug-build throughput is ~10× slower than release
    // and would produce a false negative here.
    //
    // What we DO gate: the dispatcher returns a positive throughput and
    // the run completes. Catches "dispatcher silently produced zero
    // spins" or "dispatcher hangs" classes of regressions.
    let config = cfg();
    let mut bulk = make_bulk(1_000_000, 4242);
    bulk.chunk_spins = 250_000;
    bulk.spins_per_worker = 50_000;
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .unwrap();
    let sps = r.spins_per_sec;
    let projected_1t_sec = 1.0e12_f64 / sps;
    eprintln!(
        "  faza98 throughput (debug build): {sps:.2e} spins/s, projected 1T = {:.1}s",
        projected_1t_sec
    );
    assert!(sps > 0.0, "dispatcher must report positive throughput");
    assert_eq!(r.total_spins, 1_000_000);
}

// ─── Path / config-hash safety on resume ──────────────────────────────

#[test]
fn resume_refuses_mismatched_total_spins() {
    let tmp = tempfile::tempdir().unwrap();
    let ckpt: PathBuf = tmp.path().join("run.ckpt");

    let mut first = make_bulk(20_000, 1);
    first.checkpoint_every_chunks = 1;
    first.checkpoint_path = Some(ckpt.clone());
    BulkDispatcher::new(&cfg(), first, Arc::new(NoOpProgress))
        .run()
        .unwrap();

    let mut second = make_bulk(40_000, 1); // different total
    second.resume_path = Some(ckpt);
    let r = BulkDispatcher::new(&cfg(), second, Arc::new(NoOpProgress)).run();
    assert!(r.is_err(), "expected refusal on total_spins mismatch");
}
