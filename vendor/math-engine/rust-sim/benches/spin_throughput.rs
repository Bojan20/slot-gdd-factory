//! Faza 9 — Spin throughput benchmarks.
//!
//! Compares four pipelines on an identical 5×3 / 5-payline config:
//!
//! | Bench                    | Generator         | Evaluator            |
//! |--------------------------|-------------------|----------------------|
//! | `scalar_gen_only`        | GridGenerator     | —                    |
//! | `packed_gen_only`        | PackedGridGen     | —                    |
//! | `scalar_full_spin`       | GridGenerator     | Evaluator (Lines)    |
//! | `packed_full_spin`       | PackedGridGen     | ZeroAllocEvaluator   |
//! | `simd_scatter_count`     | PackedGridGen     | simd_count_scatter_bonus |
//! | `scalar_scatter_count`   | PackedGridGen     | scalar_count_symbol  |
//!
//! Run: `cargo bench --bench spin_throughput`
//! HTML report: `target/criterion/`

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use slot_sim::{
    config::{GameConfig, PayEntry, ReelWeight},
    evaluator::{EvalMode, Evaluator},
    grid::GridGenerator,
    rng::SlotRng,
    speed::{
        scalar_count_scatter_bonus, simd_count_scatter_bonus, PackedGridGenerator,
        ZeroAllocEvaluator,
    },
};
use std::collections::HashMap;

// ─── Config setup ─────────────────────────────────────────────────────────────

fn make_bench_config() -> GameConfig {
    let mut cfg = GameConfig::default();

    cfg.paylines = vec![
        vec![1, 1, 1, 1, 1], // middle row
        vec![0, 0, 0, 0, 0], // top row
        vec![2, 2, 2, 2, 2], // bottom row
        vec![0, 1, 2, 1, 0], // V-shape
        vec![2, 1, 0, 1, 2], // inverted V
    ];

    cfg.paytable = HashMap::from([
        (
            "W".to_string(),
            PayEntry {
                pay3: 10.0,
                pay4: 50.0,
                pay5: 200.0,
            },
        ),
        (
            "H1".to_string(),
            PayEntry {
                pay3: 5.0,
                pay4: 25.0,
                pay5: 100.0,
            },
        ),
        (
            "L1".to_string(),
            PayEntry {
                pay3: 2.0,
                pay4: 10.0,
                pay5: 40.0,
            },
        ),
    ]);

    let rw = vec![
        ReelWeight {
            symbol: "W".to_string(),
            weight: 2,
        },
        ReelWeight {
            symbol: "H1".to_string(),
            weight: 10,
        },
        ReelWeight {
            symbol: "L1".to_string(),
            weight: 30,
        },
        ReelWeight {
            symbol: "S".to_string(),
            weight: 3,
        },
        ReelWeight {
            symbol: "B".to_string(),
            weight: 5,
        },
    ];
    cfg.base_weights = vec![rw.clone(); 5];
    cfg.fs_weights = vec![rw; 5];

    cfg
}

// ─── Benchmarks ───────────────────────────────────────────────────────────────

fn bench_scalar_gen_only(c: &mut Criterion) {
    let cfg = make_bench_config();
    let gen = GridGenerator::new(&cfg);
    let mut rng = SlotRng::new(42);

    let mut group = c.benchmark_group("grid_generation");
    group.throughput(Throughput::Elements(1));
    group.bench_function("scalar_DynGrid", |b| {
        b.iter(|| black_box(gen.generate_base(&mut rng)))
    });
    group.finish();
}

fn bench_packed_gen_only(c: &mut Criterion) {
    let cfg = make_bench_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let mut rng = SlotRng::new(42);

    let mut group = c.benchmark_group("grid_generation");
    group.throughput(Throughput::Elements(1));
    group.bench_function("packed_u128_alias", |b| {
        b.iter(|| black_box(gen.generate_base(&mut rng)))
    });
    group.finish();
}

fn bench_scalar_full_spin(c: &mut Criterion) {
    let cfg = make_bench_config();
    let gen = GridGenerator::new(&cfg);
    let eval = Evaluator::with_mode(&cfg, &gen, EvalMode::Lines);
    let mut rng = SlotRng::new(42);
    let bet_mc = 1_000i64;

    let mut group = c.benchmark_group("full_spin");
    group.throughput(Throughput::Elements(1));
    group.bench_function("scalar_Evaluator", |b| {
        b.iter(|| {
            let grid = gen.generate_base(&mut rng);
            let result = eval.evaluate_spin(&grid, &mut rng, bet_mc, false, true);
            black_box(result.final_win)
        })
    });
    group.finish();
}

fn bench_packed_full_spin(c: &mut Criterion) {
    let cfg = make_bench_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let mut rng = SlotRng::new(42);
    let bet_mc = 1_000i64;

    let mut group = c.benchmark_group("full_spin");
    group.throughput(Throughput::Elements(1));
    group.bench_function("packed_ZeroAllocEvaluator", |b| {
        b.iter(|| {
            let grid = gen.generate_base(&mut rng);
            let result = eval.eval_lines(grid, bet_mc);
            black_box(result.base_win)
        })
    });
    group.finish();
}

fn bench_scatter_count_simd(c: &mut Criterion) {
    let cfg = make_bench_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let mut rng = SlotRng::new(42);
    let grid = gen.generate_base(&mut rng);
    let reels = gen.reels();
    let rows = gen.rows();

    let mut group = c.benchmark_group("scatter_count");
    group.throughput(Throughput::Elements(1));
    group.bench_function("simd_u8x16", |b| {
        b.iter(|| black_box(simd_count_scatter_bonus(grid, 3, 4, reels, rows)))
    });
    group.bench_function("scalar_loop", |b| {
        b.iter(|| black_box(scalar_count_scatter_bonus(grid, 3, 4, reels, rows)))
    });
    group.finish();
}

fn bench_1m_packed_spins(c: &mut Criterion) {
    let cfg = make_bench_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let bet_mc = 1_000i64;

    let mut group = c.benchmark_group("throughput_1M");
    group.throughput(Throughput::Elements(1_000_000));
    group.sample_size(10); // long bench — fewer samples
    group.bench_function("packed_1M_spins", |b| {
        b.iter(|| {
            let mut rng = SlotRng::new(12345);
            let mut total = 0i64;
            for _ in 0..1_000_000 {
                let grid = gen.generate_base(&mut rng);
                let res = eval.eval_lines(grid, bet_mc);
                total += res.base_win;
            }
            black_box(total)
        })
    });
    group.finish();
}

fn bench_1m_scalar_spins(c: &mut Criterion) {
    let cfg = make_bench_config();
    let gen = GridGenerator::new(&cfg);
    let eval = Evaluator::with_mode(&cfg, &gen, EvalMode::Lines);
    let bet_mc = 1_000i64;

    let mut group = c.benchmark_group("throughput_1M");
    group.throughput(Throughput::Elements(1_000_000));
    group.sample_size(10);
    group.bench_function("scalar_1M_spins", |b| {
        b.iter(|| {
            let mut rng = SlotRng::new(12345);
            let mut total = 0i64;
            for _ in 0..1_000_000 {
                let grid = gen.generate_base(&mut rng);
                let res = eval.evaluate_spin(&grid, &mut rng, bet_mc, false, true);
                total += res.final_win;
            }
            black_box(total)
        })
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_scalar_gen_only,
    bench_packed_gen_only,
    bench_scalar_full_spin,
    bench_packed_full_spin,
    bench_scatter_count_simd,
    bench_1m_packed_spins,
    bench_1m_scalar_spins,
);
criterion_main!(benches);
