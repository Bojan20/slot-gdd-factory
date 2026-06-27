//! Internal helper for W240 snapshot generation — run with
//! `cargo test --manifest-path rust-sim/Cargo.toml --test w240_snapshot_seeds`
//! to print the exact f64/u32/i64 numbers that current implementations
//! produce.  Copy those numbers into the strict assertions in
//! `w240_markov_kills.rs` / `w240_features_kills.rs` to create
//! snapshot-based mutation kills.
//!
//! This file is a one-shot generator; the printed values are wired into
//! the test bodies as `assert!((res.expected_payout - X).abs() < 1e-12)`.
//! No runtime invariants here — the snapshot lives in the other files.

use slot_sim::config::{FreeSpinsConfig, GameConfig, ReelWeight, SymbolDef};
use slot_sim::evaluator::Evaluator;
use slot_sim::features::FeatureSim;
use slot_sim::grid::GridGenerator;
use slot_sim::markov::{solve_hold_and_win, HoldAndWinConfig};
use slot_sim::rng::SlotRng;
use std::collections::HashMap;

fn build_features_config() -> GameConfig {
    let mut cfg = GameConfig::default();
    cfg.reels = 3;
    cfg.rows = 3;
    cfg.feature_loop_cap = 1000;
    cfg.max_win_cap = 5000.0;
    cfg.symbols = vec![
        SymbolDef { id: "LP1".into(), name: "Low pay".into(), is_wild: false, is_scatter: false, is_bonus: false },
        SymbolDef { id: "HP1".into(), name: "High pay".into(), is_wild: false, is_scatter: false, is_bonus: false },
        SymbolDef { id: "WILD".into(), name: "Wild".into(), is_wild: true, is_scatter: false, is_bonus: false },
        SymbolDef { id: "SCAT".into(), name: "Scatter".into(), is_wild: false, is_scatter: true, is_bonus: false },
        SymbolDef { id: "BONUS".into(), name: "Bonus".into(), is_wild: false, is_scatter: false, is_bonus: true },
    ];
    let weights = vec![
        ReelWeight { symbol: "LP1".into(), weight: 8 },
        ReelWeight { symbol: "HP1".into(), weight: 3 },
        ReelWeight { symbol: "WILD".into(), weight: 1 },
        ReelWeight { symbol: "SCAT".into(), weight: 1 },
        ReelWeight { symbol: "BONUS".into(), weight: 2 },
    ];
    cfg.base_weights = vec![weights.clone(), weights.clone(), weights];
    let mut awards = HashMap::new();
    awards.insert(3u8, 10u8);
    awards.insert(4u8, 12u8);
    awards.insert(5u8, 15u8);
    let mut scatter_pays = HashMap::new();
    scatter_pays.insert(3u8, 10.0);
    cfg.free_spins = FreeSpinsConfig {
        awards, mult_start: 1, mult_increment: 1, mult_max: 5,
        retrigger_enabled: true, scatter_pays,
    };
    cfg
}

#[test]
#[ignore = "Generates snapshot values for W240 markov/features kills"]
fn w240_snapshot_markov_hnw_seed_table() {
    // Configuration set 1: small p, non-trivial respins.
    let cfg = HoldAndWinConfig {
        total_cells: 9,
        init_locked_cells: 3,
        initial_respins: 4,
        expected_cell_value: 2.0,
        base_chance: 0.15,
        fill_bonus_cap: 0.05,
        respin_reset_on_new: true,
        grid_full_award: 50.0,
    };
    let res = solve_hold_and_win(&cfg);
    println!("SNAPSHOT_HNW_RESET_TRUE_v1:");
    println!("  expected_payout = {:.20}", res.expected_payout);
    println!("  expected_orb_count = {:.20}", res.expected_orb_count);
    println!("  grid_full_probability = {:.20}", res.grid_full_probability);
    println!("  expected_respins_used = {:.20}", res.expected_respins_used);

    // Configuration set 2: same fixture, respin_reset_on_new=false.
    let cfg2 = HoldAndWinConfig {
        respin_reset_on_new: false,
        ..cfg
    };
    let res2 = solve_hold_and_win(&cfg2);
    println!("SNAPSHOT_HNW_RESET_FALSE_v1:");
    println!("  expected_payout = {:.20}", res2.expected_payout);
    println!("  expected_orb_count = {:.20}", res2.expected_orb_count);
    println!("  grid_full_probability = {:.20}", res2.grid_full_probability);
    println!("  expected_respins_used = {:.20}", res2.expected_respins_used);

    // Configuration set 3: forces binom_pmf renormalisation (sum > 1.0 by f64 noise).
    let cfg3 = HoldAndWinConfig {
        total_cells: 40,
        init_locked_cells: 0,
        initial_respins: 10,
        expected_cell_value: 1.0,
        base_chance: 0.5,
        fill_bonus_cap: 0.0,
        respin_reset_on_new: false,
        grid_full_award: 0.0,
    };
    let res3 = solve_hold_and_win(&cfg3);
    println!("SNAPSHOT_HNW_RENORM_v1:");
    println!("  expected_payout = {:.20}", res3.expected_payout);
    println!("  expected_orb_count = {:.20}", res3.expected_orb_count);
    println!("  grid_full_probability = {:.20}", res3.grid_full_probability);
    println!("  expected_respins_used = {:.20}", res3.expected_respins_used);

    // Extra precision: ALL FOUR derived metrics for a config that
    // exercises both reset-on-orb and the non-reset paths.
    let mut configs = vec![
        ("VARY_RESPINS_2", HoldAndWinConfig {
            total_cells: 9, init_locked_cells: 0, initial_respins: 2,
            expected_cell_value: 5.0, base_chance: 0.2, fill_bonus_cap: 0.1,
            respin_reset_on_new: true, grid_full_award: 100.0,
        }),
        ("VARY_INIT_LOCKED_5", HoldAndWinConfig {
            total_cells: 9, init_locked_cells: 5, initial_respins: 3,
            expected_cell_value: 1.5, base_chance: 0.1, fill_bonus_cap: 0.05,
            respin_reset_on_new: true, grid_full_award: 25.0,
        }),
        ("BASE_CHANCE_HIGH", HoldAndWinConfig {
            total_cells: 12, init_locked_cells: 2, initial_respins: 4,
            expected_cell_value: 2.0, base_chance: 0.6, fill_bonus_cap: 0.2,
            respin_reset_on_new: false, grid_full_award: 75.0,
        }),
    ];
    for (label, cfg) in configs.drain(..) {
        let r = solve_hold_and_win(&cfg);
        println!("SNAPSHOT_HNW_{}:", label);
        println!("  expected_payout = {:.20}", r.expected_payout);
        println!("  expected_orb_count = {:.20}", r.expected_orb_count);
        println!("  grid_full_probability = {:.20}", r.grid_full_probability);
        println!("  expected_respins_used = {:.20}", r.expected_respins_used);
    }
}

#[test]
#[ignore = "Generates features snapshot for W240 mutation kills"]
fn w240_snapshot_features_fs_seed_table() {
    let cfg = build_features_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    for seed in [42u64, 1234, 99] {
        for (scatter, bet) in [(3u8, 1000i64), (4u8, 1000), (5u8, 2000)] {
            let mut rng = SlotRng::new(seed);
            let r = fsim.simulate_free_spins(&mut rng, scatter, bet);
            println!(
                "SNAPSHOT_FS seed={} scatter={} bet={}: payout={} spins={} retriggers={} scatter_wins={} max_mult={}",
                seed, scatter, bet, r.total_payout, r.spins_played, r.retriggers, r.scatter_wins, r.max_mult_reached,
            );
        }
    }

    // simulate_hnw snapshots — multiple seeds → deterministic payouts.
    for grid_seed in [42u64, 100, 999] {
        let mut grid_rng = SlotRng::new(grid_seed);
        let initial_grid = grid_gen.generate_base(&mut grid_rng);
        for hnw_seed in [7u64, 314, 42] {
            let mut rng = SlotRng::new(hnw_seed);
            let r = fsim.simulate_hnw(&mut rng, &initial_grid, 1000);
            println!(
                "SNAPSHOT_HNW grid_seed={} hnw_seed={}: payout={} respins={} final_orbs={} full_bonus={} mini={} minor={} major={} grand={}",
                grid_seed, hnw_seed, r.total_payout, r.total_respins, r.final_orb_count, r.full_grid_bonus,
                r.jackpots_mini, r.jackpots_minor, r.jackpots_major, r.jackpots_grand,
            );
        }
    }
}
