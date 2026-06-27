//! W4.11 — Cash Eruption (IGT 200-1637-001/002/003) → slot-sim IR round-trip.
//!
//! Loads the universal IR JSONs emitted by
//! `tools/par_extract_ultimate/build_ir.py cash-eruption` for all three
//! SWID variants and asserts structural correctness against the slot-sim
//! schema (serde-deserialize succeeds + key fields populated).
//!
//! See also: games/ce-copy-test/* for the reference paymodel evaluator.

use slot_sim::ir::{Evaluation, Feature, Ir, Topology};

const CE_001: &str =
    "../../games/cash-eruption/out/cash-eruption.200-1637-001.slot-sim.ir.json";
const CE_002: &str =
    "../../games/cash-eruption/out/cash-eruption.200-1637-002.slot-sim.ir.json";
const CE_003: &str =
    "../../games/cash-eruption/out/cash-eruption.200-1637-003.slot-sim.ir.json";

fn check_ce_shape(path: &str, swid: &str, expected_rtp: f64) {
    let ir = Ir::load(path).unwrap_or_else(|e| panic!("load {path}: {e}"));
    assert_eq!(ir.meta.vendor, "igt");
    assert_eq!(ir.meta.swid, swid);
    assert_eq!(ir.meta.family, "lines");
    assert!((ir.meta.rtp_total - expected_rtp).abs() < 1e-6,
            "rtp_total {} != expected {}", ir.meta.rtp_total, expected_rtp);
    match ir.topology {
        Topology::Rectangular { reels: 5, rows: 3 } => (),
        _ => panic!("expected Rectangular 5x3 topology"),
    }
    match &ir.evaluation {
        Evaluation::Lines { lines, min_count: 3 } => {
            assert_eq!(lines.len(), 20, "CE has 20 paylines");
        }
        _ => panic!("expected Lines evaluation"),
    }
    assert_eq!(ir.reels.base.len(), 36, "36 BG reel sets");
    assert_eq!(ir.reels.fs.len(), 16, "16 FS reel sets");
    assert!(ir.paytable.len() >= 28, "≥28 paytable rows");
    // ≥1 free_spins + ≥1 hold_and_win
    let has_fs = ir.features.iter().any(|f| matches!(f, Feature::FreeSpins { .. }));
    let has_hw = ir.features.iter().any(|f| matches!(f, Feature::HoldAndWin { .. }));
    assert!(has_fs, "missing FreeSpins feature");
    assert!(has_hw, "missing HoldAndWin feature");
    assert_eq!(ir.bet_table.lines, 20);
}

#[test]
fn cash_eruption_001_roundtrip() {
    check_ce_shape(CE_001, "200-1637-001", 0.960000018370437);
}

#[test]
fn cash_eruption_002_roundtrip() {
    check_ce_shape(CE_002, "200-1637-002", 0.950000015007889);
}

#[test]
fn cash_eruption_003_roundtrip() {
    check_ce_shape(CE_003, "200-1637-003", 0.931000016534967);
}
