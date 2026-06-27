//! W212 Faza 600.1 — Pre-prod perf gauntlet (Agent C).
//!
//! Five-bench Criterion suite covering the hottest paths in `slot_sim`:
//!
//!   - `evaluator_grid_eval`   — single grid eval (paylines + RTP accumulator)
//!   - `evaluator_spin_full`   — full spin (generate + evaluate)
//!   - `evaluator_replay_1m`   — 1M spin replay loop
//!   - `evaluator_parity_check` — TS↔Rust outcome parity at 10K seeds
//!   - `alias_method_sample`   — Vose alias sample (RNG hot path)
//!
//! Run:
//!   cargo bench --bench W212_bench
//!
//! Output: default Criterion HTML under `target/criterion/`.

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use slot_sim::{
    config::{GameConfig, PayEntry, ReelWeight},
    evaluator::{EvalMode, Evaluator},
    grid::GridGenerator,
    rng::SlotRng,
    speed::{AliasTable, PackedGridGenerator, ZeroAllocEvaluator},
};
use std::collections::HashMap;

// ── Shared fixture ──────────────────────────────────────────────────────────
fn make_cfg() -> GameConfig {
    let mut cfg = GameConfig::default();
    cfg.paylines = vec![
        vec![1, 1, 1, 1, 1],
        vec![0, 0, 0, 0, 0],
        vec![2, 2, 2, 2, 2],
        vec![0, 1, 2, 1, 0],
        vec![2, 1, 0, 1, 2],
    ];
    cfg.paytable = HashMap::from([
        ("W".to_string(), PayEntry { pay3: 10.0, pay4: 50.0, pay5: 200.0 }),
        ("H1".to_string(), PayEntry { pay3: 5.0, pay4: 25.0, pay5: 100.0 }),
        ("L1".to_string(), PayEntry { pay3: 2.0, pay4: 10.0, pay5: 40.0 }),
    ]);
    let rw = vec![
        ReelWeight { symbol: "W".to_string(), weight: 2 },
        ReelWeight { symbol: "H1".to_string(), weight: 10 },
        ReelWeight { symbol: "L1".to_string(), weight: 30 },
        ReelWeight { symbol: "S".to_string(), weight: 3 },
        ReelWeight { symbol: "B".to_string(), weight: 5 },
    ];
    cfg.base_weights = vec![rw.clone(); 5];
    cfg.fs_weights = vec![rw; 5];
    cfg
}

// ── 1. Single grid eval ─────────────────────────────────────────────────────
fn bench_evaluator_grid_eval(c: &mut Criterion) {
    let cfg = make_cfg();
    let gen = PackedGridGenerator::from_config(&cfg);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let mut rng = SlotRng::new(0xDECAF);
    let grid = gen.generate_base(&mut rng);
    let bet_mc = 1_000i64;

    let mut g = c.benchmark_group("W212.evaluator_grid_eval");
    g.throughput(Throughput::Elements(1));
    g.bench_function("packed_eval_lines", |b| {
        b.iter(|| {
            let res = eval.eval_lines(black_box(grid), bet_mc);
            black_box(res.base_win)
        })
    });
    g.finish();
}

// ── 2. Full spin including paylines + RTP accumulator ───────────────────────
fn bench_evaluator_spin_full(c: &mut Criterion) {
    let cfg = make_cfg();
    let gen = GridGenerator::new(&cfg);
    let eval = Evaluator::with_mode(&cfg, &gen, EvalMode::Lines);
    let mut rng = SlotRng::new(0xC0FFEE);
    let bet_mc = 1_000i64;

    let mut g = c.benchmark_group("W212.evaluator_spin_full");
    g.throughput(Throughput::Elements(1));
    g.bench_function("scalar_full_spin", |b| {
        b.iter(|| {
            let grid = gen.generate_base(&mut rng);
            let res = eval.evaluate_spin(&grid, &mut rng, bet_mc, false, true);
            black_box(res.final_win)
        })
    });
    g.finish();
}

// ── 3. 1M spin replay ───────────────────────────────────────────────────────
fn bench_evaluator_replay_1m(c: &mut Criterion) {
    let cfg = make_cfg();
    let gen = PackedGridGenerator::from_config(&cfg);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let bet_mc = 1_000i64;

    let mut g = c.benchmark_group("W212.evaluator_replay_1m");
    g.throughput(Throughput::Elements(1_000_000));
    g.sample_size(10);
    g.bench_function("packed_replay_1m", |b| {
        b.iter(|| {
            let mut rng = SlotRng::new(0x12345);
            let mut total = 0i64;
            for _ in 0..1_000_000 {
                let grid = gen.generate_base(&mut rng);
                let res = eval.eval_lines(grid, bet_mc);
                total += res.base_win;
            }
            black_box(total)
        })
    });
    g.finish();
}

// ── 4. TS↔Rust parity check (10K seeds) ────────────────────────────────────
//
// We can't import TS in a Rust benchmark, so this bench measures the
// Rust-only cost of producing a parity-checkable payload — the same shape
// the TS side would consume in `cross-platform-rng-parity`. The throughput
// is the latency budget the parity gate must respect.
fn bench_evaluator_parity_check(c: &mut Criterion) {
    let cfg = make_cfg();
    let gen = PackedGridGenerator::from_config(&cfg);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let bet_mc = 1_000i64;
    const SEEDS: u64 = 10_000;

    let mut g = c.benchmark_group("W212.evaluator_parity_check");
    g.throughput(Throughput::Elements(SEEDS));
    g.sample_size(20);
    g.bench_function("rust_side_parity_payload", |b| {
        b.iter(|| {
            let mut digest: u64 = 0;
            for seed in 0..SEEDS {
                let mut rng = SlotRng::new(seed);
                let grid = gen.generate_base(&mut rng);
                let res = eval.eval_lines(grid, bet_mc);
                // Mix the result into a running u64 digest — deterministic
                // and order-sensitive (parity guard).
                digest = digest.wrapping_mul(0x100000001b3).wrapping_add(res.base_win as u64);
            }
            black_box(digest)
        })
    });
    g.finish();
}

// ── 5. Alias sample (RNG hot path) ──────────────────────────────────────────
fn bench_alias_method_sample(c: &mut Criterion) {
    let entries: Vec<(u8, u32)> = vec![
        (0, 30), (1, 25), (2, 20), (3, 15), (4, 10),
        (5, 8), (6, 6), (7, 4), (8, 3), (9, 2),
    ];
    let alias = AliasTable::build(&entries);
    let mut rng = SlotRng::new(0xA11A5);

    let mut g = c.benchmark_group("W212.alias_method_sample");
    g.throughput(Throughput::Elements(1));
    g.bench_function("alias_sample_single", |b| {
        b.iter(|| black_box(alias.sample(&mut rng)))
    });
    g.bench_function("alias_sample_batch_1k", |b| {
        b.iter(|| {
            let mut acc: u32 = 0;
            for _ in 0..1_000 {
                acc = acc.wrapping_add(alias.sample(&mut rng) as u32);
            }
            black_box(acc)
        })
    });
    g.finish();
}

criterion_group!(
    w212_benches,
    bench_evaluator_grid_eval,
    bench_evaluator_spin_full,
    bench_evaluator_replay_1m,
    bench_evaluator_parity_check,
    bench_alias_method_sample,
);
criterion_main!(w212_benches);
