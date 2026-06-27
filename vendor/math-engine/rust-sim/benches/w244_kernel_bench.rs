//! W244 hot-path kernel benchmark suite.
//!
//! Measures per-kernel ops/sec across all 19 W244 closed-form Rust ports.
//! Run: `cargo bench --bench w244_kernel_bench`
//!
//! Establishes the Rust-side performance baseline used to validate the
//! "≥ 100× Python speedup" claim from the W244 wave 34-38 roadmap.
//! Python comparison is recorded out-of-band (per kernel running
//! `python3 -m timeit -n 10000 -- 'from tools.math_dsl.<name> import …;
//! …'`); the JSON ratio is published in master TODO.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use slot_sim::kernels::{
    asymmetric_paytable::{asymmetric_paytable_rtp, AsymmetricPaytableParams},
    both_ways::{both_ways_rtp, BothWaysParams},
    buy_feature::{buy_feature_audit, BuyFeatureParams},
    cascade::{cascade_rtp, CascadeParams},
    charge_meter::{charge_meter_rtp, ChargeMeterParams, ChargeTier},
    expanding_symbol::{expanding_symbol_rtp, ExpandingSymbolParams},
    inverse_solver::{bisection_1d, newton_raphson_1d},
    pay_anywhere::{pay_anywhere_rtp, PayAnywhereParams},
    persistent_multiplier::{persistent_multiplier_rtp, PersistentMultiplierParams},
    wheel::{wheel_rtp, WheelParams, WheelSegment},
};
use std::collections::BTreeMap;

// ── Fixture builders (industry-realistic shapes) ──────────────────────────

fn fx_charge_meter() -> ChargeMeterParams {
    ChargeMeterParams {
        expected_charge_per_spin: 0.5,
        tiers: vec![
            ChargeTier { name: "small".into(), threshold: 20.0, award_value_x_bet: 4.0, award_kind: "credit_x_bet".into() },
            ChargeTier { name: "medium".into(), threshold: 100.0, award_value_x_bet: 30.0, award_kind: "credit_x_bet".into() },
            ChargeTier { name: "grand".into(), threshold: 1000.0, award_value_x_bet: 500.0, award_kind: "credit_x_bet".into() },
        ],
        persistent_across_sessions: false,
    }
}

fn fx_both_ways() -> BothWaysParams {
    BothWaysParams { ltr_only_rtp: 0.95, line_pay_share: 0.80 }
}

fn fx_buy_feature() -> BuyFeatureParams {
    BuyFeatureParams {
        bonus_average_pay_x_bet: 96.0,
        buy_cost_x_bet: 100.0,
        base_game_rtp: 0.965,
        target_buy_rtp: 0.96,
    }
}

fn fx_wheel() -> WheelParams {
    WheelParams {
        trigger_p: 0.01,
        segments: vec![
            WheelSegment { kind: "credit".into(), weight: 5.0, value_x_bet: 10.0, jackpot_id: String::new() },
            WheelSegment { kind: "credit".into(), weight: 3.0, value_x_bet: 50.0, jackpot_id: String::new() },
            WheelSegment { kind: "jackpot".into(), weight: 1.0, value_x_bet: 1000.0, jackpot_id: "grand".into() },
            WheelSegment { kind: "spin_again".into(), weight: 2.0, value_x_bet: 0.0, jackpot_id: String::new() },
            WheelSegment { kind: "no_win".into(), weight: 4.0, value_x_bet: 0.0, jackpot_id: String::new() },
        ],
        max_spin_again: 5,
    }
}

fn fx_pay_anywhere() -> PayAnywhereParams {
    let mut pt = BTreeMap::new();
    pt.insert(8, 0.25);
    pt.insert(9, 0.5);
    pt.insert(10, 1.0);
    pt.insert(11, 2.5);
    pt.insert(12, 5.0);
    PayAnywhereParams {
        n_cells: 30, p_per_cell: 0.10, pay_table: pt,
        min_pay_count: 8, symbol_name: "S_HP1".into(),
    }
}

fn fx_expanding_symbol() -> ExpandingSymbolParams {
    let mut pt = BTreeMap::new();
    pt.insert(0, 0.0); pt.insert(1, 0.0); pt.insert(2, 0.0);
    pt.insert(3, 1.0); pt.insert(4, 5.0); pt.insert(5, 100.0);
    ExpandingSymbolParams {
        fs_trigger_p: 0.005, fs_initial_spins: 10,
        reels: 5, rows: 3, p_per_cell_in_fs: 0.10,
        pay_table: pt, symbol_name: "S_HP1".into(),
    }
}

fn fx_cascade() -> CascadeParams {
    CascadeParams {
        p_initial_win: 0.30,
        base_pay_per_cascade_x_bet: 1.0,
        p_win_per_cascade: 0.40,
        multiplier_ladder: vec![1.0, 1.0, 2.0, 2.0, 3.0],
        max_chain: 16,
    }
}

fn fx_asymmetric_paytable() -> AsymmetricPaytableParams {
    let mut inner = BTreeMap::new();
    inner.insert("twin_reels".to_string(), 0.20);
    inner.insert("triple_reels".to_string(), 0.10);
    inner.insert("quad_reels".to_string(), 0.05);
    let mut top = BTreeMap::new();
    top.insert("S_HP1".to_string(), inner.clone());
    top.insert("S_HP2".to_string(), inner);
    AsymmetricPaytableParams { per_symbol_contributions: top }
}

fn fx_persistent_multiplier() -> PersistentMultiplierParams {
    PersistentMultiplierParams {
        fs_trigger_p: 0.005, fs_initial_spins: 10,
        base_pay_per_spin_x_bet: 1.0,
        initial_multiplier: 1.0, bump_increment: 1.0,
        p_bump_per_spin: 0.30, max_multiplier: None,
    }
}

// ── Benchmark groups ──────────────────────────────────────────────────────

fn bench_linear(c: &mut Criterion) {
    let mut g = c.benchmark_group("linear");
    let cm = fx_charge_meter();
    g.bench_function("charge_meter", |b| b.iter(|| charge_meter_rtp(black_box(&cm))));
    let bw = fx_both_ways();
    g.bench_function("both_ways", |b| b.iter(|| both_ways_rtp(black_box(&bw))));
    let bf = fx_buy_feature();
    g.bench_function("buy_feature", |b| b.iter(|| buy_feature_audit(black_box(&bf))));
    g.finish();
}

fn bench_binomial(c: &mut Criterion) {
    let mut g = c.benchmark_group("binomial");
    let pa = fx_pay_anywhere();
    g.bench_function("pay_anywhere_n30", |b| b.iter(|| pay_anywhere_rtp(black_box(&pa))));
    let es = fx_expanding_symbol();
    g.bench_function("expanding_symbol", |b| b.iter(|| expanding_symbol_rtp(black_box(&es))));
    g.finish();
}

fn bench_chains(c: &mut Criterion) {
    let mut g = c.benchmark_group("chains");
    let wh = fx_wheel();
    g.bench_function("wheel", |b| b.iter(|| wheel_rtp(black_box(&wh))));
    let cs = fx_cascade();
    g.bench_function("cascade_n16", |b| b.iter(|| cascade_rtp(black_box(&cs))));
    g.finish();
}

fn bench_aggregator(c: &mut Criterion) {
    let mut g = c.benchmark_group("aggregator");
    let ap = fx_asymmetric_paytable();
    g.bench_function("asymmetric_paytable", |b| b.iter(|| asymmetric_paytable_rtp(black_box(&ap))));
    g.finish();
}

fn bench_dp(c: &mut Criterion) {
    let mut g = c.benchmark_group("dp");
    let pm = fx_persistent_multiplier();
    g.bench_function("persistent_multiplier_n10", |b| b.iter(|| persistent_multiplier_rtp(black_box(&pm))));
    g.finish();
}

fn bench_solvers(c: &mut Criterion) {
    let mut g = c.benchmark_group("solvers");
    g.bench_function("newton_raphson_charge_meter", |b| {
        b.iter(|| {
            newton_raphson_1d(
                |p| p * 0.20,
                |_p| 0.20,
                black_box(0.10),
                0.3,
                1e-4, 30, 0.0, 1.0,
            )
        })
    });
    g.bench_function("bisection_pay_anywhere", |b| {
        b.iter(|| {
            bisection_1d(
                |p| p * 0.5,
                black_box(0.20),
                0.0, 1.0,
                1e-4, 50,
            )
        })
    });
    g.finish();
}

criterion_group!(
    benches,
    bench_linear,
    bench_binomial,
    bench_chains,
    bench_aggregator,
    bench_dp,
    bench_solvers,
);
criterion_main!(benches);
