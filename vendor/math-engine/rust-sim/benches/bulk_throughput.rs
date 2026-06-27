//! Faza 9.8 — 1T spinova/sec acceptance benchmark.
//!
//! Measures real (release-build) throughput of the `BulkDispatcher` so
//! we can project the 1T runtime and compare against the acceptance
//! targets in MASTER_TODO §9.8:
//!
//!   - CPU single-machine: ≤ 60s for 1T (M3/M4 stretch)
//!   - 4× M3 Ultra cluster: ≤ 15s for 1T
//!   - GPU + 8-instance cloud burst: ≤ 2s for 1T
//!
//! The benchmark itself runs a 10M-spin sample (~100ms in release) and
//! prints the projected 1T runtime to stderr alongside the criterion
//! statistics. Operators read the projection to decide whether to
//! green-light a 1T run on this hardware or whether SIMD / GPU / cluster
//! offload is required first.

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use std::sync::Arc;

use slot_sim::bulk::{BulkConfig, BulkDispatcher, NoOpProgress};
use slot_sim::config::GameConfig;

fn bulk_cpu_throughput(c: &mut Criterion) {
    let config = GameConfig::default();
    let mut group = c.benchmark_group("faza98_bulk_cpu");
    let sample = 10_000_000u64;
    group.throughput(Throughput::Elements(sample));
    group.sample_size(10);
    group.bench_function("10M_spins", |b| {
        b.iter(|| {
            let mut bulk = BulkConfig::new(sample, 4242);
            bulk.chunk_spins = 2_500_000;
            bulk.spins_per_worker = 250_000;
            let dispatcher = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress));
            let r = dispatcher.run().expect("bulk run");
            black_box(r.total_spins);
            black_box(r.stats.total_won.load(std::sync::atomic::Ordering::Relaxed));
        });
    });
    group.finish();
}

fn bulk_projection_marker(_c: &mut Criterion) {
    // Independent timer outside criterion to keep the projection line
    // clean. Criterion's repeated runs would otherwise fold the
    // projection into the per-iteration stats and confuse operators.
    use std::time::Instant;
    let config = GameConfig::default();
    let sample = 5_000_000u64;
    let mut bulk = BulkConfig::new(sample, 4242);
    bulk.chunk_spins = 1_000_000;
    bulk.spins_per_worker = 250_000;
    let started = Instant::now();
    let r = BulkDispatcher::new(&config, bulk, Arc::new(NoOpProgress))
        .run()
        .expect("bulk run");
    let elapsed = started.elapsed();
    let sps = r.spins_per_sec;
    let one_t_sec = 1.0e12_f64 / sps.max(1.0);
    let one_t_min = one_t_sec / 60.0;
    eprintln!("\n────────────────────────────────────────────────────────");
    eprintln!(" Faza 9.8 — 1T acceptance projection (CPU release build)");
    eprintln!("────────────────────────────────────────────────────────");
    eprintln!(" Sample size       : {} spins", sample);
    eprintln!(" Sample wall-clock : {:.3}s", elapsed.as_secs_f64());
    eprintln!(" Throughput        : {sps:.2e} spins/s");
    eprintln!(" Projected 1T time : {one_t_sec:.1}s ({one_t_min:.2} min)");
    eprintln!(
        " Acceptance target : ≤ 60s  → {}",
        if one_t_sec <= 60.0 {
            "PASS"
        } else {
            "needs SIMD/GPU/cluster (9.8b)"
        }
    );
    eprintln!("────────────────────────────────────────────────────────\n");
}

criterion_group!(benches, bulk_cpu_throughput, bulk_projection_marker);
criterion_main!(benches);
