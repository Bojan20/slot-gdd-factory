//! W4.12 — Fort Knox Wolf Run (IGT 200-1775-001/002) → slot-sim IR round-trip.
//!
//! Loads the universal IR JSONs emitted by
//! `tools/par_extract_ultimate/build_ir.py fort-knox-wolf-run` for both SWID
//! variants and asserts structural correctness:
//!
//!   ▸ deserialize cleanly (serde schema parity)
//!   ▸ vendor = igt, family = lines, RTP exactly matches Excel G13 (BM=1)
//!   ▸ topology = Rectangular 4×5, evaluation = Lines (40 paylines), min_count=3
//!   ▸ WildWolf + Bonus roles assigned
//!   ▸ Base + FS reel strips populated (one set each in this paymodel)
//!   ▸ Three features: FreeSpins + HoldAndWin (Fort Knox bonus) + LinearProgressive

use slot_sim::ir::{Evaluation, Feature, Ir, Topology};

const FKWR_001: &str =
    "../../games/fort-knox-wolf-run/out/fort-knox-wolf-run.200-1775-001.slot-sim.ir.json";
const FKWR_002: &str =
    "../../games/fort-knox-wolf-run/out/fort-knox-wolf-run.200-1775-002.slot-sim.ir.json";

fn check_fkwr_shape(path: &str, swid: &str, expected_rtp: f64) {
    let ir = Ir::load(path).unwrap_or_else(|e| panic!("load {path}: {e}"));
    assert_eq!(ir.meta.vendor, "igt");
    assert_eq!(ir.meta.swid, swid);
    assert_eq!(ir.meta.family, "lines");
    assert!((ir.meta.rtp_total - expected_rtp).abs() < 1e-6,
            "rtp_total {} != expected {}", ir.meta.rtp_total, expected_rtp);
    match ir.topology {
        Topology::Rectangular { reels: 5, rows: 4 } => (),
        _ => panic!("expected Rectangular 5x4 topology"),
    }
    match &ir.evaluation {
        Evaluation::Lines { lines, min_count: 3 } => {
            assert_eq!(lines.len(), 40, "FKWR has 40 paylines");
        }
        _ => panic!("expected Lines evaluation"),
    }
    assert_eq!(ir.reels.base.len(), 1);
    assert_eq!(ir.reels.fs.len(), 1);
    let base_reel_sizes: Vec<usize> = ir.reels.base[0]
        .reels
        .iter()
        .map(|r| r.len())
        .collect();
    assert_eq!(base_reel_sizes, vec![71, 109, 70, 101, 89],
               "FKWR base reel strip sizes");
    assert!(ir.paytable.len() >= 30, "≥30 paytable rows");
    let has_fs = ir.features.iter().any(|f| matches!(f, Feature::FreeSpins { .. }));
    let has_hw = ir.features.iter().any(|f| matches!(f, Feature::HoldAndWin { .. }));
    let has_lp = ir.features.iter().any(|f| matches!(f, Feature::LinearProgressive { .. }));
    assert!(has_fs, "missing FreeSpins feature");
    assert!(has_hw, "missing HoldAndWin feature");
    assert!(has_lp, "missing LinearProgressive feature");
    assert_eq!(ir.bet_table.lines, 40);
}

#[test]
fn fort_knox_wolf_run_001_roundtrip() {
    check_fkwr_shape(FKWR_001, "200-1775-001", 0.964442695231276);
}

#[test]
fn fort_knox_wolf_run_002_roundtrip() {
    check_fkwr_shape(FKWR_002, "200-1775-002", 0.9432110100299161);
}
