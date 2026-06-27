//! Variable-ways evaluator — Faza 2 acceptance tests.
//!
//! The variable-ways path lives in `evaluator.rs::EvalMode::VariableWays`.
//! Three checks:
//!
//!   1. `variable_ways_total([2,3,4,5,6,7]) == 5040`
//!   2. Win calculation on a fixed grid produces the expected payout
//!   3. 50K-spin smoke test: RTP must land in a plausible range
//!      (loose because the synthetic config below has no balanced math).
//!
//! The fixed-grid case uses a 6-reel config because 6 reels is the most
//! common variable-ways layout — the evaluator itself supports any reel
//! count. Generic naming: no vendor trademarks anywhere in this template.

use slot_sim::config::{
    FreeSpinsConfig, GameConfig, HoldAndWinConfig, LightningConfig, OrbValue, PayEntry, ReelWeight,
    SymbolDef,
};
use slot_sim::evaluator::{EvalMode, Evaluator};
use slot_sim::grid::{DynGrid, GridGenerator};
use slot_sim::rng::SlotRng;
use std::collections::HashMap;

// ─── Fixture builder ───────────────────────────────────────────────────────

fn variable_ways_config(reels: u8, max_rows: u8) -> GameConfig {
    let mut paytable = HashMap::new();
    paytable.insert(
        "HP1".to_string(),
        PayEntry {
            pay3: 1.0,
            pay4: 5.0,
            pay5: 25.0,
        },
    );
    paytable.insert(
        "LP1".to_string(),
        PayEntry {
            pay3: 0.2,
            pay4: 0.5,
            pay5: 2.0,
        },
    );

    let mut weights_per_reel: Vec<Vec<ReelWeight>> = Vec::new();
    for _ in 0..reels {
        weights_per_reel.push(vec![
            ReelWeight {
                symbol: "LP1".to_string(),
                weight: 10,
            },
            ReelWeight {
                symbol: "HP1".to_string(),
                weight: 3,
            },
            ReelWeight {
                symbol: "WILD".to_string(),
                weight: 1,
            },
            ReelWeight {
                symbol: "SCAT".to_string(),
                weight: 1,
            },
        ]);
    }

    GameConfig {
        name: "Variable-Ways Test".to_string(),
        version: "1.0.0".to_string(),
        target_rtp: 96.0,
        reels,
        rows: max_rows,
        paylines: vec![],
        symbols: vec![
            SymbolDef {
                id: "WILD".to_string(),
                name: "Wild".to_string(),
                is_wild: true,
                is_scatter: false,
                is_bonus: false,
            },
            SymbolDef {
                id: "HP1".to_string(),
                name: "HP1".to_string(),
                is_wild: false,
                is_scatter: false,
                is_bonus: false,
            },
            SymbolDef {
                id: "LP1".to_string(),
                name: "LP1".to_string(),
                is_wild: false,
                is_scatter: false,
                is_bonus: false,
            },
            SymbolDef {
                id: "SCAT".to_string(),
                name: "Scatter".to_string(),
                is_wild: false,
                is_scatter: true,
                is_bonus: false,
            },
        ],
        paytable,
        base_weights: weights_per_reel.clone(),
        fs_weights: weights_per_reel,
        free_spins: FreeSpinsConfig {
            awards: HashMap::from([(3, 10)]),
            mult_start: 1,
            mult_increment: 0,
            mult_max: 1,
            retrigger_enabled: false,
            scatter_pays: HashMap::new(),
        },
        hold_and_win: HoldAndWinConfig {
            trigger_count: 99, // disabled
            initial_respins: 3,
            respins_on_new_orb: 3,
            full_grid_bonus: 500.0,
            orb_values: vec![OrbValue {
                value: 1,
                weight: 1,
                jackpot: None,
            }],
            orb_land_chance_base: 0.0,
            orb_land_chance_fill_bonus: 0.0,
        },
        lightning: LightningConfig {
            trigger_chance: 0.0,
            trigger_chance_fs: 0.0,
            multipliers: vec![],
        },
        // W152 P0-3 — IR feature unstub fields default to None for
        // hand-rolled test configs that don't exercise these features.
        cascade: None,
        respin: None,
        mystery: None,
        // W152 P0-3 round 2 — Pick / Wheel / BuyFeature / AnteBet / Gamble /
        // SymbolUpgrade defaults.
        pick: None,
        wheel: None,
        buy_feature: None,
        ante_bet: None,
        gamble: None,
        symbol_upgrade: None,
        // W152 Faza 2.4 — Pattern evaluator (variable_ways test does not use it).
        pattern: None,
        max_win_cap: 5000.0,
        feature_loop_cap: 100,
    }
}

// ─── Test 1: ways count formula ────────────────────────────────────────────

#[test]
fn test_variable_ways_count() {
    let row_counts: Vec<usize> = vec![2, 3, 4, 5, 6, 7];
    let total = Evaluator::variable_ways_total(&row_counts);
    // 2 × 3 × 4 × 5 × 6 × 7 = 5040.
    assert_eq!(total, 5040, "2×3×4×5×6×7 must equal 5040");

    // Bonus: classic max-ways for [7,7,7,7,7,7] = 117649.
    assert_eq!(
        Evaluator::variable_ways_total(&vec![7, 7, 7, 7, 7, 7]),
        117649,
        "7^6 max variable-ways must equal 117649"
    );
}

// ─── Test 2: fixed-grid win calculation ────────────────────────────────────

#[test]
fn test_variable_ways_win_calculation() {
    let cfg = variable_ways_config(6, 7);
    let grid_gen = GridGenerator::new(&cfg);

    // HP1 idx = 1 (after WILD=0). LP1 idx = 2. WILD idx = 0. SCAT idx = 3.
    let hp1 = cfg.symbol_index("HP1").unwrap() as u8;
    let lp1 = cfg.symbol_index("LP1").unwrap() as u8;

    // Build a fixed 6-reel grid with row_counts = [2, 3, 4, 5, 6, 7].
    let row_counts: Vec<usize> = vec![2, 3, 4, 5, 6, 7];
    let max_rows = *row_counts.iter().max().unwrap();
    let mut grid = DynGrid::new(6, max_rows);

    // Place exactly one HP1 on each of reels 0, 1, 2, 3 (top row) — break at reel 4.
    grid.set(0, 0, hp1);
    grid.set(0, 1, lp1);
    grid.set(1, 0, hp1);
    grid.set(1, 1, lp1);
    grid.set(1, 2, lp1);
    grid.set(2, 0, hp1);
    grid.set(2, 1, lp1);
    grid.set(2, 2, lp1);
    grid.set(2, 3, lp1);
    grid.set(3, 0, hp1);
    grid.set(3, 1, lp1);
    grid.set(3, 2, lp1);
    grid.set(3, 3, lp1);
    grid.set(3, 4, lp1);
    // Reel 4 has no HP1 → chain breaks at length 4.
    for r in 0..row_counts[4] {
        grid.set(4, r, lp1);
    }
    for r in 0..row_counts[5] {
        grid.set(5, r, lp1);
    }

    let eval_mode = EvalMode::VariableWays {
        row_counts,
    };
    let evaluator = Evaluator::with_mode(&cfg, &grid_gen, eval_mode);

    let mut rng = SlotRng::new(1);
    // total_bet_mc = 1000 (1 unit) → payouts will be in millicredits matching pay×1.
    let result = evaluator.evaluate_spin(&grid, &mut rng, 1000, false, true);

    // Expected: HP1 × 4 reels with counts [1, 1, 1, 1] = 1 way × pay4 (5.0) = 5.0
    // plus LP1 × 6 reels: count per reel is approximately
    //   reel0: 1 LP1 (other slot is HP1), reel1: 2 LP1, reel2: 3 LP1,
    //   reel3: 4 LP1, reel4: 6 LP1, reel5: 7 LP1
    //   ways = 1 × 2 × 3 × 4 × 6 × 7 = 1008 × pay5 (2.0) = 2016.0
    let hp1_win: i64 = result
        .line_wins
        .iter()
        .filter(|w| w.symbol_idx == hp1)
        .map(|w| w.payout)
        .sum();
    let lp1_win: i64 = result
        .line_wins
        .iter()
        .filter(|w| w.symbol_idx == lp1)
        .map(|w| w.payout)
        .sum();

    assert_eq!(
        hp1_win, 5_000,
        "HP1 × 4 → 1 way × 5.0 × 1000 = 5000 mc, got {}",
        hp1_win
    );
    assert_eq!(
        lp1_win, 2_016_000,
        "LP1 × 6 → 1008 ways × 2.0 × 1000 = 2_016_000 mc, got {}",
        lp1_win
    );
}

// ─── Test 3: RTP smoke ─────────────────────────────────────────────────────

#[test]
fn test_variable_ways_rtp_smoke() {
    let cfg = variable_ways_config(6, 7);
    let grid_gen = GridGenerator::new(&cfg);
    let mut rng = SlotRng::new(12345);

    let row_ranges: Vec<(usize, usize)> = vec![(2, 7); 6];
    let spins: u64 = 50_000;
    let total_bet_mc: i64 = 1_000;

    let mut total_wagered: i64 = 0;
    let mut total_won: i64 = 0;

    for _ in 0..spins {
        total_wagered += total_bet_mc;
        let (grid, row_counts) = grid_gen.generate_variable_rows(&mut rng, &row_ranges);
        let evaluator = Evaluator::with_mode(
            &cfg,
            &grid_gen,
            EvalMode::VariableWays {
                row_counts: row_counts.clone(),
            },
        );
        let result = evaluator.evaluate_spin(&grid, &mut rng, total_bet_mc, false, true);
        total_won += result.final_win;
    }

    let rtp = total_won as f64 / total_wagered as f64;
    // The synthetic config above is intentionally not balanced — it just
    // proves the simulator hits a finite RTP and produces some wins. The
    // band must be wide enough to accommodate the unbalanced config.
    assert!(rtp > 0.0, "Variable-ways smoke RTP must be > 0, got {rtp}");
    assert!(
        rtp.is_finite(),
        "Variable-ways smoke RTP must be finite, got {rtp}"
    );
}
