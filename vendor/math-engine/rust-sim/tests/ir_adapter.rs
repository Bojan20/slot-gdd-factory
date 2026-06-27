//! Integration tests for the IR → GameConfig adapter (Faza 1.2).
//!
//! Coverage:
//!   - Parity fixture converts correctly (reels=5, rows=3, 7 symbols)
//!   - Weighted reel conversion: sum of weights > 0 per reel
//!   - Lines evaluation → paylines count matches IR
//!   - Ways evaluation → synthetic paylines generated
//!   - Roundtrip smoke test: 10 K spins from parity.json IR → RTP in [0.5, 1.5]
//!   - Invalid IR (phantom symbol in paytable) → AdapterError

use slot_sim::ir::{cross_validate, ir_to_game_config, AdapterError, Evaluation, SlotGameIR};
use std::path::PathBuf;

// ─── Fixture helpers ────────────────────────────────────────────────────────

fn fixture_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p
}

fn load_parity() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture_dir().join("parity.json"))
        .expect("parity.json fixture must exist");
    SlotGameIR::from_json(&raw).expect("parity.json must parse")
}

// ─── Test 1: basic field mapping ────────────────────────────────────────────

#[test]
fn parity_ir_converts_to_game_config_fields() {
    let ir = load_parity();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");

    assert_eq!(cfg.reels, 5, "reels must be 5");
    assert_eq!(cfg.rows, 3, "rows must be 3");
    assert_eq!(cfg.symbols.len(), 7, "must have 7 symbols");

    // RTP: IR stores 0.96, GameConfig wants 96.0
    assert!(
        (cfg.target_rtp - 96.0).abs() < 0.001,
        "target_rtp should be 96.0, got {}",
        cfg.target_rtp
    );

    // Name should come from meta
    assert_eq!(cfg.name, "Parity Fixture");
}

// ─── Test 2: symbol kind mapping ────────────────────────────────────────────

#[test]
fn symbol_kind_mapping_correct() {
    let ir = load_parity();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");

    // Wild symbol: S_WILD
    let wild = cfg
        .symbols
        .iter()
        .find(|s| s.id == "S_WILD")
        .expect("S_WILD must exist");
    assert!(wild.is_wild, "S_WILD must be is_wild=true");
    assert!(!wild.is_scatter);
    assert!(!wild.is_bonus);

    // Scatter symbol: S_SCAT
    let scat = cfg
        .symbols
        .iter()
        .find(|s| s.id == "S_SCAT")
        .expect("S_SCAT must exist");
    assert!(scat.is_scatter, "S_SCAT must be is_scatter=true");
    assert!(!scat.is_wild);
    assert!(!scat.is_bonus);

    // LP symbol: all false
    let lp1 = cfg
        .symbols
        .iter()
        .find(|s| s.id == "S_LP1")
        .expect("S_LP1 must exist");
    assert!(!lp1.is_wild);
    assert!(!lp1.is_scatter);
    assert!(!lp1.is_bonus);
}

// ─── Test 3: weighted reel conversion ───────────────────────────────────────

#[test]
fn weighted_reel_conversion_positive_totals() {
    let ir = load_parity();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");

    assert_eq!(cfg.base_weights.len(), 5, "must have 5 reel weight vectors");

    for (reel, weights) in cfg.base_weights.iter().enumerate() {
        let total: u32 = weights.iter().map(|w| w.weight).sum();
        assert!(
            total > 0,
            "reel {} must have total weight > 0, got {}",
            reel,
            total
        );
    }
}

// ─── Test 4: Lines evaluation → paylines count ──────────────────────────────

#[test]
fn lines_evaluation_paylines_match_ir() {
    let ir = load_parity();

    // Capture the payline count from the IR before converting.
    let ir_payline_count = match &ir.evaluation {
        Evaluation::Lines { paylines, .. } => paylines.len(),
        _ => panic!("parity.json must use Lines evaluation"),
    };

    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");

    assert_eq!(
        cfg.paylines.len(),
        ir_payline_count,
        "GameConfig paylines count must match IR: expected {}, got {}",
        ir_payline_count,
        cfg.paylines.len()
    );
}

// ─── Test 5: Ways evaluation → synthetic paylines ──────────────────────────

#[test]
fn ways_evaluation_generates_synthetic_paylines() {
    // Build a minimal IR with Ways evaluation.
    let raw =
        std::fs::read_to_string(fixture_dir().join("parity.json")).expect("parity.json must exist");
    let mut ir = SlotGameIR::from_json(&raw).expect("parse");

    // Switch to Ways evaluation.
    ir.evaluation = slot_sim::ir::Evaluation::Ways {
        direction: slot_sim::ir::Direction::Ltr,
        min_match: 3,
        max_ways_per_spin: 243,
    };

    // cross_validate will warn about paytable key format for "ways" eval because
    // parity.json uses numeric keys — that is acceptable; we only require no errors.
    let report = cross_validate(&ir);
    // Ways + numeric paytable keys should produce zero errors.
    assert!(
        report.errors.is_empty(),
        "ways IR must have no validation errors: {:?}",
        report.errors
    );

    let cfg = ir_to_game_config(&ir).expect("ways conversion must succeed");

    // 5 reels, 3 rows → 3^5 = 243 synthetic paylines.
    assert_eq!(
        cfg.paylines.len(),
        243,
        "5×3 ways must generate 243 synthetic paylines, got {}",
        cfg.paylines.len()
    );

    // Every payline must have exactly 5 entries (one per reel).
    for (i, pl) in cfg.paylines.iter().enumerate() {
        assert_eq!(
            pl.len(),
            5,
            "synthetic payline {} must have 5 entries, got {}",
            i,
            pl.len()
        );
    }
}

// ─── Test 6: Roundtrip smoke test ───────────────────────────────────────────

#[test]
fn roundtrip_smoke_10k_spins_rtp_in_bounds() {
    use slot_sim::evaluator::Evaluator;
    use slot_sim::grid::GridGenerator;
    use slot_sim::rng::SlotRng;

    let ir = load_parity();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");

    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let mut rng = SlotRng::new(12345);

    let total_bet_mc: i64 = 1000; // 1.0 credit = 1000 mc
    let spins = 10_000u64;

    let mut total_wagered: i64 = 0;
    let mut total_won: i64 = 0;

    for _ in 0..spins {
        total_wagered += total_bet_mc;
        let grid = grid_gen.generate_base(&mut rng);
        let result = evaluator.evaluate_spin(&grid, &mut rng, total_bet_mc, false, true);
        total_won += result.final_win;
    }

    let rtp = total_won as f64 / total_wagered as f64;

    assert!(
        rtp >= 0.5 && rtp <= 1.5,
        "smoke-test RTP must be in [0.5, 1.5], got {:.4} over {} spins",
        rtp,
        spins
    );
}

// ─── Test 7: Invalid IR → AdapterError ──────────────────────────────────────

#[test]
fn invalid_ir_bad_symbol_reel_missing_weights() {
    // Build an IR where a reel has no valid symbols (empty weighted map).
    let raw =
        std::fs::read_to_string(fixture_dir().join("parity.json")).expect("parity.json must exist");
    let mut ir = SlotGameIR::from_json(&raw).expect("parse");

    // Replace base reel 0 with an empty weight map.
    if let slot_sim::ir::ReelSet::Weighted { ref mut base, .. } = ir.reels {
        base[0] = std::collections::BTreeMap::new();
    }

    let result = ir_to_game_config(&ir);
    assert!(result.is_err(), "empty reel must produce AdapterError");

    match result.unwrap_err() {
        AdapterError::MissingWeights { reel } => {
            assert_eq!(reel, 0, "error must point to reel 0");
        }
        other => panic!("expected MissingWeights, got {:?}", other),
    }
}

// ─── Test 8: Paytable conversion ────────────────────────────────────────────

#[test]
fn paytable_conversion_correct_values() {
    let ir = load_parity();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");

    // parity.json: S_HP1 → "3": 3.0, "4": 12.0, "5": 63.0
    let hp1 = cfg
        .paytable
        .get("S_HP1")
        .expect("S_HP1 must be in paytable");
    assert!(
        (hp1.pay3 - 3.0).abs() < 0.001,
        "pay3 should be 3.0, got {}",
        hp1.pay3
    );
    assert!(
        (hp1.pay4 - 12.0).abs() < 0.001,
        "pay4 should be 12.0, got {}",
        hp1.pay4
    );
    assert!(
        (hp1.pay5 - 63.0).abs() < 0.001,
        "pay5 should be 63.0, got {}",
        hp1.pay5
    );

    // S_LP1 → "3": 0.5, "4": 2.0, "5": 8.0
    let lp1 = cfg
        .paytable
        .get("S_LP1")
        .expect("S_LP1 must be in paytable");
    assert!(
        (lp1.pay3 - 0.5).abs() < 0.001,
        "pay3 mismatch: {}",
        lp1.pay3
    );
    assert!(
        (lp1.pay4 - 2.0).abs() < 0.001,
        "pay4 mismatch: {}",
        lp1.pay4
    );
    assert!(
        (lp1.pay5 - 8.0).abs() < 0.001,
        "pay5 mismatch: {}",
        lp1.pay5
    );
}

// ─── Test 9: FreeSpins feature conversion ───────────────────────────────────

#[test]
fn free_spins_feature_converted() {
    let ir = load_parity();
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");

    // parity.json: free_spins trigger thresholds "3"→8, "4"→12, "5"→15
    assert_eq!(
        cfg.free_spins.awards.get(&3),
        Some(&8u8),
        "3 scatters must award 8 spins"
    );
    assert_eq!(
        cfg.free_spins.awards.get(&4),
        Some(&12u8),
        "4 scatters must award 12 spins"
    );
    assert_eq!(
        cfg.free_spins.awards.get(&5),
        Some(&15u8),
        "5 scatters must award 15 spins"
    );
}

// ─── Test 10: AdapterError Display ──────────────────────────────────────────

#[test]
fn adapter_error_display() {
    let err_topo = AdapterError::UnsupportedTopology("foobar".to_string());
    assert!(err_topo.to_string().contains("foobar"));

    let err_eval = AdapterError::UnsupportedEvaluation("pattern".to_string());
    assert!(err_eval.to_string().contains("pattern"));

    let err_wt = AdapterError::MissingWeights { reel: 3 };
    assert!(err_wt.to_string().contains("3"));
}
