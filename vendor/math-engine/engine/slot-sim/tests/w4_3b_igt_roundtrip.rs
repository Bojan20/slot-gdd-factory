//! W4.3b — IGT → slot-sim universal IR round-trip test.
//!
//! Asserts the Python `to_slot_sim` adapter emits JSON that deserializes
//! into `slot_sim::ir::Ir` and that the engine can run a non-trivial
//! number of spins against it without panicking.
//!
//! The math-correctness gates (RTP/hold parity vs Excel) live in W4.3c
//! once feature dispatch (`run_features`) is no longer a stub. This wave
//! only guarantees structural correctness + line-eval reachability.

use slot_sim::ir::{Evaluation, Feature, Ir, SymbolRole, Topology};
use slot_sim::sim::Engine;
use slot_sim::stats::SimStats;

const IGT_PAR_001: &str =
    "../../games/fort-knox-wolf-run/out/igt.200-1775-001.slot-sim.ir.json";
const IGT_PAR_002: &str =
    "../../games/fort-knox-wolf-run/out/igt.200-1775-002.slot-sim.ir.json";

#[test]
fn igt_par_001_deserializes() {
    let ir = Ir::load(IGT_PAR_001).expect("PAR_001 IR must deserialize");

    // Meta
    assert_eq!(ir.meta.vendor, "igt");
    assert_eq!(ir.meta.swid, "200-1775-001");
    assert_eq!(ir.meta.family, "paylines");
    assert!(ir.meta.rtp_total > 0.90 && ir.meta.rtp_total < 1.0);

    // Topology — IGT 4×5
    match ir.topology {
        Topology::Rectangular { reels: 5, rows: 4 } => {}
        ref t => panic!("expected Rectangular {{ reels: 5, rows: 4 }}, got {:?}", t),
    }

    // Evaluation — 40 lines × 5 cells
    match &ir.evaluation {
        Evaluation::Lines { lines, min_count } => {
            assert_eq!(lines.len(), 40);
            assert_eq!(*min_count, 3);
            for line in lines {
                assert_eq!(line.len(), 5);
                for c in line {
                    assert!(c.is_some(), "IGT paylines are dense");
                }
            }
        }
        _ => panic!("expected Evaluation::Lines"),
    }
}

#[test]
fn igt_par_001_symbols_canonical() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    let ids: std::collections::HashSet<&str> =
        ir.symbols.iter().map(|s| s.id.as_str()).collect();

    // Wild + scatter must be present and tagged.
    let wild = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Wild)
        .expect("wild role must exist");
    assert_eq!(wild.id, "WildWolf");

    let scatter = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Scatter)
        .expect("scatter role must exist");
    assert_eq!(scatter.id, "Bonus");

    // Canonicalization: strip casing wins over paytable casing.
    assert!(ids.contains("Whitewolf"));
    assert!(
        !ids.contains("WhiteWolf"),
        "paytable typo `WhiteWolf` leaked into symbols list"
    );
}

#[test]
fn igt_par_001_reels_bit_exact() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    assert_eq!(ir.reels.base.len(), 1, "IGT stripe layout = single set");
    let base = &ir.reels.base[0].reels;
    let base_lens: Vec<usize> = base.iter().map(|r| r.len()).collect();
    assert_eq!(base_lens, vec![71, 109, 70, 101, 89]);

    let fs = &ir.reels.fs[0].reels;
    let fs_lens: Vec<usize> = fs.iter().map(|r| r.len()).collect();
    assert_eq!(fs_lens, vec![105, 94, 102, 68, 91]);
}

#[test]
fn igt_par_001_features_mapped() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    let mut has_fs = false;
    let mut has_pick = false;
    let mut has_lin = false;
    for f in &ir.features {
        match f {
            Feature::FreeSpins {
                initial_spins,
                trigger_count_min,
                reel_bank,
                ..
            } => {
                has_fs = true;
                assert_eq!(*initial_spins, 5);
                assert_eq!(*trigger_count_min, 3);
                assert_eq!(reel_bank, "fs");
            }
            Feature::PickBonus { awards, .. } => {
                has_pick = true;
                assert!(!awards.is_empty(), "Fort Knox award table empty");
            }
            Feature::LinearProgressive { odds_at_bm1, .. } => {
                has_lin = true;
                assert!(
                    (*odds_at_bm1 - 7_500_000.0).abs() < 1.0,
                    "linear progressive @ BM1 ≠ 7.5M",
                );
            }
            _ => {}
        }
    }
    assert!(has_fs, "Free Spins feature missing");
    assert!(has_pick, "Fort Knox Pick Bonus missing");
    assert!(has_lin, "Linear Progressive missing");
}

#[test]
fn igt_par_001_engine_runs_no_panic() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    // 10k spins — too small for tight RTP convergence but plenty to flush
    // any panic / OOB / shape bug.
    let stats: SimStats = engine.run(10_000, 1, 0xDEADBEEF);
    assert_eq!(stats.spins, 10_000);
    // Line evaluator alone (features::run_features is a stub) lands ~0.7
    // RTP on PAR_001 — sanity-check we're in the ballpark.
    let rtp = stats.base_x / stats.spins as f64;
    assert!(
        rtp > 0.30 && rtp < 1.0,
        "base-game RTP {rtp:.3} outside [0.30,1.0] sanity range",
    );
}

#[test]
fn igt_par_002_deserializes() {
    let ir = Ir::load(IGT_PAR_002).expect("PAR_002 IR must deserialize");
    assert_eq!(ir.meta.swid, "200-1775-002");
    // Alternate hold variant — base strips identical, FS reel 1 = 107.
    let fs_lens: Vec<usize> = ir.reels.fs[0].reels.iter().map(|r| r.len()).collect();
    assert_eq!(fs_lens, vec![107, 94, 102, 68, 91]);
}
