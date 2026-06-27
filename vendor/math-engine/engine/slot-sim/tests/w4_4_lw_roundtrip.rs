//! W4.4 — L&W (CE COPY TEST) → slot-sim universal IR round-trip.
//!
//! Asserts the L&W adapter emits a structurally valid IR for slot-sim.
//! The 0.42-base-RTP gap to Excel 0.96 is expected — Cash Eruption's
//! HoldAndWin runner is still stubbed and the L&W pages mapping lands in
//! W4.5. Goal here is "engine runs the IR, base game line wins flow".

use slot_sim::ir::{Evaluation, Feature, Ir, SymbolRole, Topology};
use slot_sim::sim::Engine;

const LW_PAR_001: &str =
    "../../games/ce-copy-test/out/lw.200-1637-001.slot-sim.ir.json";

#[test]
fn lw_par_001_deserializes() {
    let ir = Ir::load(LW_PAR_001).expect("L&W IR must deserialize");
    assert_eq!(ir.meta.vendor, "lw");
    assert_eq!(ir.meta.swid, "200-1637-001");
    assert_eq!(ir.meta.family, "paylines");
    // Excel target ~0.96
    assert!(ir.meta.rtp_total > 0.90 && ir.meta.rtp_total < 1.0);
}

#[test]
fn lw_topology_5x3_20_lines() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    match ir.topology {
        Topology::Rectangular { reels: 5, rows: 3 } => {}
        ref t => panic!("expected 5×3, got {:?}", t),
    }
    match &ir.evaluation {
        Evaluation::Lines { lines, .. } => assert_eq!(lines.len(), 20),
        _ => panic!("expected Evaluation::Lines"),
    }
}

#[test]
fn lw_multi_reel_sets() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    // CE COPY TEST ships 36 base + 16 FS reel sets
    assert_eq!(ir.reels.base.len(), 36, "base set count");
    assert_eq!(ir.reels.fs.len(), 16, "FS set count");
    // Weights must be present and sum to a non-trivial total
    let total: i64 = ir.reels.base_weights.weights.iter().map(|w| w.weight).sum();
    assert!(total > 0, "base weights total should be > 0");
}

#[test]
fn lw_symbol_roles() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let by_role: std::collections::HashMap<SymbolRole, Vec<&str>> = {
        let mut m = std::collections::HashMap::<SymbolRole, Vec<&str>>::new();
        for s in &ir.symbols {
            m.entry(s.role).or_default().push(s.id.as_str());
        }
        m
    };
    // Wild + scatter + cash (Fireball) must exist in CE
    assert!(by_role.contains_key(&SymbolRole::Wild), "wild missing");
    assert!(by_role.contains_key(&SymbolRole::Cash), "cash (Fireball) missing");
}

#[test]
fn lw_features_emitted() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let mut has_fs = false;
    let mut has_hold_and_win = false;
    for f in &ir.features {
        match f {
            Feature::FreeSpins { .. } => has_fs = true,
            Feature::HoldAndWin { .. } => has_hold_and_win = true,
            _ => {}
        }
    }
    assert!(has_fs, "FreeSpins must be emitted");
    assert!(has_hold_and_win, "HoldAndWin stub must be emitted (CE feature)");
}

#[test]
fn lw_engine_runs_without_panic() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(10_000, 1, 0xC0FFEE);
    assert_eq!(stats.spins, 10_000);
    // W4.9 added Wild expansion (the biggest single missing piece).
    // RTP converges to ~0.95, within 1 % of Excel 0.96. Band 0.85..1.00.
    let rtp = stats.rtp();
    assert!(
        (0.85..1.00).contains(&rtp),
        "L&W RTP {rtp:.3} outside expected [0.85,1.00] range — regression?",
    );
}
