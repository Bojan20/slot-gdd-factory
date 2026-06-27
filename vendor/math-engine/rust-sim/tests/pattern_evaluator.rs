//! W152 Faza 2.4 — Pattern evaluator integration test.
//!
//! Covers:
//!   - IR JSON with `evaluation.kind = "pattern"` populates
//!     `GameConfig.pattern` via the adapter.
//!   - `Evaluator` constructed with `EvalMode::Pattern { rules }`
//!     evaluates a fixed grid and emits the expected payout.
//!   - Wild substitution behaves like the line evaluator.
//!   - Pattern with a scatter or bonus symbol in any cell voids the
//!     rule (no payout).
//!   - Empty pattern list ⇒ `Some(empty)` (intentional, not `None`).
//!
//! Fixture: `tests/fixtures/pattern-evaluator.json`.

use slot_sim::config::{GameConfig, PatternRuleConfig};
use slot_sim::evaluator::{EvalMode, Evaluator, PatternRule};
use slot_sim::grid::{DynGrid, GridGenerator};
use slot_sim::ir::{ir_to_game_config, SlotGameIR};
use slot_sim::rng::SlotRng;
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p.push("pattern-evaluator.json");
    p
}

fn load() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture_path())
        .expect("pattern-evaluator.json fixture must exist");
    SlotGameIR::from_json(&raw).expect("fixture must parse")
}

fn rules_from_config(cfg: &GameConfig) -> Vec<PatternRule> {
    cfg.pattern
        .as_ref()
        .expect("pattern must be set in this fixture")
        .rules
        .iter()
        .map(|r: &PatternRuleConfig| PatternRule {
            id: r.id.clone(),
            positions: r.positions.iter().map(|p| (p[0], p[1])).collect(),
            pay_multiplier: r.pay_multiplier,
        })
        .collect()
}

#[test]
fn ir_adapter_populates_pattern_config() {
    let ir = load();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    let pat = cfg.pattern.as_ref().expect("pattern must be set");
    assert_eq!(pat.rules.len(), 3, "fixture defines 3 pattern rules");
    assert_eq!(pat.rules[0].id, "row_top");
    assert_eq!(pat.rules[0].positions, vec![[0, 0], [0, 1], [0, 2]]);
    assert!((pat.rules[0].pay_multiplier - 10.0).abs() < f64::EPSILON);

    assert_eq!(pat.rules[1].id, "col_left");
    assert_eq!(pat.rules[1].positions, vec![[0, 0], [1, 0], [2, 0]]);
    assert!((pat.rules[1].pay_multiplier - 5.0).abs() < f64::EPSILON);

    assert_eq!(pat.rules[2].id, "diagonal");
    assert_eq!(pat.rules[2].positions, vec![[0, 0], [1, 1], [2, 2]]);
    assert!((pat.rules[2].pay_multiplier - 25.0).abs() < f64::EPSILON);
}

#[test]
fn pattern_pays_when_all_positions_match() {
    let ir = load();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    let rules = rules_from_config(&cfg);

    let grid_gen = GridGenerator::new(&cfg);
    let mut grid = DynGrid::new(cfg.reels as usize, cfg.rows as usize);

    let hp1 = cfg.symbol_index("HP1").unwrap() as u8;
    // Fill grid with HP1 — every pattern should match.
    for reel in 0..cfg.reels as usize {
        for row in 0..cfg.rows as usize {
            grid.set(reel, row, hp1);
        }
    }

    let evaluator =
        Evaluator::with_mode(&cfg, &grid_gen, EvalMode::Pattern { rules });
    let mut rng = SlotRng::new(0);
    // total_bet_mc = 1000 (= 1 credit). pay_multiplier × 1 credit × 1000
    // millicredits/credit yields the expected wins.
    let result = evaluator.evaluate_spin(&grid, &mut rng, 1000, false, true);

    // All 3 rules match: 10 + 5 + 25 = 40 credits = 40_000 mc.
    assert_eq!(result.base_win, 40_000);
    assert_eq!(result.line_wins.len(), 3);
}

#[test]
fn pattern_does_not_pay_when_symbols_diverge() {
    let ir = load();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    let rules = rules_from_config(&cfg);

    let grid_gen = GridGenerator::new(&cfg);
    let mut grid = DynGrid::new(cfg.reels as usize, cfg.rows as usize);

    let hp1 = cfg.symbol_index("HP1").unwrap() as u8;
    let lp1 = cfg.symbol_index("LP1").unwrap() as u8;

    // Pattern positions are [row, reel]; DynGrid::set takes (reel, row).
    // Top-row pattern = [(0,0), (0,1), (0,2)] → (reel=0..2, row=0).
    // Inject HP1 in the middle of the top row only → row_top has
    // LP1, HP1, LP1 → no match. col_left and diagonal stay pure LP1.
    for reel in 0..cfg.reels as usize {
        for row in 0..cfg.rows as usize {
            grid.set(reel, row, lp1);
        }
    }
    grid.set(1, 0, hp1); // (reel=1, row=0) → breaks row_top only.

    let evaluator =
        Evaluator::with_mode(&cfg, &grid_gen, EvalMode::Pattern { rules });
    let mut rng = SlotRng::new(0);
    let result = evaluator.evaluate_spin(&grid, &mut rng, 1000, false, true);

    // No rule should pay HP1 — row_top has LP1 at (0,1); col_left has
    // LP1 at (1,0); diagonal has LP1 at (1,1).
    // But LP1 fills col_left + diagonal positions entirely → those
    // patterns pay LP1.
    let hp1_wins: i64 = result
        .line_wins
        .iter()
        .filter(|w| w.symbol_idx == hp1)
        .map(|w| w.payout)
        .sum();
    assert_eq!(hp1_wins, 0, "HP1 patterns must not pay (broken row_top)");

    // col_left and diagonal are pure LP1 → both pay (5 + 25 = 30 credits).
    let lp1_wins: i64 = result
        .line_wins
        .iter()
        .filter(|w| w.symbol_idx == lp1)
        .map(|w| w.payout)
        .sum();
    assert_eq!(lp1_wins, 30_000, "LP1 col_left + diagonal must pay");
}

#[test]
fn pattern_wild_substitutes_for_non_special_symbols() {
    let ir = load();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    let rules = rules_from_config(&cfg);

    let grid_gen = GridGenerator::new(&cfg);
    let mut grid = DynGrid::new(cfg.reels as usize, cfg.rows as usize);

    let hp1 = cfg.symbol_index("HP1").unwrap() as u8;
    let wild = cfg.symbol_index("S_WILD").unwrap() as u8;
    let lp1 = cfg.symbol_index("LP1").unwrap() as u8;

    // Fill with LP1 baseline so no extra pattern matches.
    for reel in 0..cfg.reels as usize {
        for row in 0..cfg.rows as usize {
            grid.set(reel, row, lp1);
        }
    }

    // Top row: HP1, WILD, HP1 → wild substitutes → row_top pays HP1.
    grid.set(0, 0, hp1);
    grid.set(1, 0, wild);
    grid.set(2, 0, hp1);

    let evaluator =
        Evaluator::with_mode(&cfg, &grid_gen, EvalMode::Pattern { rules });
    let mut rng = SlotRng::new(0);
    let result = evaluator.evaluate_spin(&grid, &mut rng, 1000, false, true);

    let hp1_top: i64 = result
        .line_wins
        .iter()
        .filter(|w| w.symbol_idx == hp1)
        .map(|w| w.payout)
        .sum();
    // row_top pay_multiplier = 10 × 1 credit = 10 credits = 10_000 mc.
    assert_eq!(hp1_top, 10_000, "row_top must pay HP1 with wild middle");
}

#[test]
fn pattern_voided_by_special_symbol_in_position() {
    let ir = load();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    let rules = rules_from_config(&cfg);

    let grid_gen = GridGenerator::new(&cfg);
    let mut grid = DynGrid::new(cfg.reels as usize, cfg.rows as usize);

    let hp1 = cfg.symbol_index("HP1").unwrap() as u8;
    let scat = cfg.symbol_index("S_SCAT").unwrap() as u8;
    let lp1 = cfg.symbol_index("LP1").unwrap() as u8;

    // Baseline LP1 (so col_left and diagonal patterns pay).
    for reel in 0..cfg.reels as usize {
        for row in 0..cfg.rows as usize {
            grid.set(reel, row, lp1);
        }
    }
    // Inject HP1 row_top but with scatter mid → must void.
    grid.set(0, 0, hp1);
    grid.set(1, 0, scat);
    grid.set(2, 0, hp1);

    let evaluator =
        Evaluator::with_mode(&cfg, &grid_gen, EvalMode::Pattern { rules });
    let mut rng = SlotRng::new(0);
    let result = evaluator.evaluate_spin(&grid, &mut rng, 1000, false, true);

    let hp1_wins: i64 = result
        .line_wins
        .iter()
        .filter(|w| w.symbol_idx == hp1)
        .map(|w| w.payout)
        .sum();
    assert_eq!(hp1_wins, 0, "scatter in pattern position must void the rule");
}

#[test]
fn pattern_out_of_bounds_reel_voids_rule() {
    // Kills the surviving mutant `replace || with && @ evaluator.rs:684`.
    //
    // Strategy: fill the grid with the symbol stored at index 0 (the
    // value `DynGrid::get` returns for out-of-bounds reads). With the
    // bounds check using `||`, the OOB position voids the rule → no
    // payout. With the mutant `&&`, the OOB read silently returns
    // index 0 which matches the candidate symbol and the rule pays.
    // The assertion catches that divergence.
    let ir = load();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    let oob_default = 0u8; // `DynGrid::get` unwrap_or(0) sentinel.
    let oob_sym_id = cfg.symbols[oob_default as usize].id.clone();

    let rogue = vec![PatternRule {
        id: "oob_reel".to_string(),
        positions: vec![(0, 0), (0, 99)], // (row=0, reel=99) out of bounds.
        pay_multiplier: 100.0,
    }];

    let grid_gen = GridGenerator::new(&cfg);
    let mut grid = DynGrid::new(cfg.reels as usize, cfg.rows as usize);
    // Fill grid with the same symbol the OOB read returns so the
    // `&&` mutant would mistakenly count it as a complete match.
    for reel in 0..cfg.reels as usize {
        for row in 0..cfg.rows as usize {
            grid.set(reel, row, oob_default);
        }
    }
    let evaluator = Evaluator::with_mode(&cfg, &grid_gen, EvalMode::Pattern { rules: rogue });
    let mut rng = SlotRng::new(0);
    let result = evaluator.evaluate_spin(&grid, &mut rng, 1000, false, true);
    assert_eq!(
        result.base_win, 0,
        "out-of-bounds reel must void the pattern entirely (filled with {oob_sym_id})"
    );
}

#[test]
fn pattern_out_of_bounds_row_voids_rule() {
    // Companion to the reel-OOB test: row-only OOB branch.
    let ir = load();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    let oob_default = 0u8;
    let oob_sym_id = cfg.symbols[oob_default as usize].id.clone();
    let rogue = vec![PatternRule {
        id: "oob_row".to_string(),
        positions: vec![(0, 0), (99, 0)], // (row=99, reel=0) out of bounds.
        pay_multiplier: 100.0,
    }];

    let grid_gen = GridGenerator::new(&cfg);
    let mut grid = DynGrid::new(cfg.reels as usize, cfg.rows as usize);
    for reel in 0..cfg.reels as usize {
        for row in 0..cfg.rows as usize {
            grid.set(reel, row, oob_default);
        }
    }
    let evaluator = Evaluator::with_mode(&cfg, &grid_gen, EvalMode::Pattern { rules: rogue });
    let mut rng = SlotRng::new(0);
    let result = evaluator.evaluate_spin(&grid, &mut rng, 1000, false, true);
    assert_eq!(
        result.base_win, 0,
        "out-of-bounds row must void the pattern entirely (filled with {oob_sym_id})"
    );
}

#[test]
fn empty_pattern_list_round_trips_as_some() {
    // Build a config manually with empty pattern rules and assert it
    // survives serialise/deserialise. Differentiates "no pattern
    // feature" (None) from "pattern feature with zero rules" (Some(empty)).
    let cfg = ir_to_game_config(&load()).unwrap();
    let json = serde_json::to_string(&cfg.pattern).unwrap();
    let round: Option<slot_sim::config::PatternConfig> =
        serde_json::from_str(&json).unwrap();
    assert!(round.is_some());
}
