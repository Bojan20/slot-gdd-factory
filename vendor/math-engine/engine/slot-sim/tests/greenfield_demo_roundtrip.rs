//! W5.7 — Greenfield Demo IR round-trip.
//!
//! Loads the universal IR emitted by `tools.greenfield_demo` (Python
//! pipeline) into `slot_sim::ir::Ir` and asserts metadata sanity.
//!
//! Companion to `tools/tests/test_w5_7_greenfield_demo.py::test_ir_roundtrips`
//! which invokes this test via `cargo test --test
//! greenfield_demo_roundtrip` after writing the IR to its canonical
//! location.

use slot_sim::ir::{Evaluation, Feature, Ir, Topology};

const DEMO_IR_PATH: &str =
    "../../reports/greenfield-demo/wolf-eruption-mythic.slot-sim.ir.json";

#[test]
fn greenfield_demo_ir_loads_in_rust() {
    // Skip-style: if the artefact isn't present (the Python pipeline
    // hasn't been run yet), bail out without failing — the Python
    // companion test always rebuilds the IR before invoking us.
    if !std::path::Path::new(DEMO_IR_PATH).exists() {
        eprintln!(
            "skipping: {DEMO_IR_PATH} not present (run \
            `python3 -m tools.greenfield_demo` first)",
        );
        return;
    }

    let ir = Ir::load(DEMO_IR_PATH)
        .unwrap_or_else(|e| panic!("Ir::load({DEMO_IR_PATH}): {e}"));

    // Synthetic SWID range (`200-9999-XXX` is reserved for demo games)
    assert_eq!(ir.meta.swid, "200-9999-001",
               "synthetic SWID 200-9999-001 expected");
    assert_eq!(ir.meta.family, "lines",
               "demo is a paylines slot");
    assert_eq!(ir.meta.vendor, "studio-internal",
               "demo vendor stamp");
    // Target RTP 0.96 — recorded into the universal `meta.rtp_total`
    assert!(
        (ir.meta.rtp_total - 0.96).abs() < 1e-9,
        "rtp_total {} ≠ target 0.96",
        ir.meta.rtp_total,
    );
    // Topology: rectangular 5×3 (matches the demo GDD).
    match ir.topology {
        Topology::Rectangular { reels: 5, rows: 3 } => (),
        ref other => panic!(
            "expected Rectangular 5×3, got {other:?}",
        ),
    }
    // Lines evaluation with min_count=3 and 20 paylines.
    match &ir.evaluation {
        Evaluation::Lines { lines, min_count } => {
            assert_eq!(*min_count, 3, "min_count = 3");
            assert_eq!(lines.len(), 20, "20 paylines");
            for line in lines {
                assert_eq!(line.len(), 5,
                           "each payline spans 5 reels");
            }
        }
        other => panic!("expected Lines evaluation, got {other:?}"),
    }
    // 10 symbols: 1 wild + 1 scatter + 4 HP + 4 LP.
    assert_eq!(ir.symbols.len(), 10,
               "demo declares exactly 10 symbols");
    let n_wild = ir.symbols.iter()
        .filter(|s| s.role == slot_sim::ir::SymbolRole::Wild).count();
    let n_scatter = ir.symbols.iter()
        .filter(|s| s.role == slot_sim::ir::SymbolRole::Scatter).count();
    let n_hp = ir.symbols.iter()
        .filter(|s| s.role == slot_sim::ir::SymbolRole::Hp).count();
    let n_lp = ir.symbols.iter()
        .filter(|s| s.role == slot_sim::ir::SymbolRole::Lp).count();
    assert_eq!(n_wild, 1, "exactly one wild");
    assert_eq!(n_scatter, 1, "exactly one scatter");
    assert_eq!(n_hp, 4, "four HP symbols");
    assert_eq!(n_lp, 4, "four LP symbols");

    // Single FreeSpins feature (the demo's only feature).
    let has_fs = ir.features.iter()
        .any(|f| matches!(f, Feature::FreeSpins { .. }));
    assert!(has_fs, "missing FreeSpins feature");

    // Bet table: 20 lines.
    assert_eq!(ir.bet_table.lines, 20, "20 paylines in bet_table");

    // Reels block: one base set with 5 reels, each with ≥ 1 stop.
    assert_eq!(ir.reels.base.len(), 1, "single base reel-set");
    let base_reels = &ir.reels.base[0].reels;
    assert_eq!(base_reels.len(), 5, "5 reels in base set");
    for reel in base_reels {
        assert!(!reel.is_empty(),
                "every reel must have at least one stop");
    }

    // Paytable: at least one entry per paying symbol (HP + LP) × 3
    // counts (3-, 4-, 5-of-a-kind) = at least 8 paying symbols × 3 = 24.
    // (Some entries may be filtered by the converter if pays == 0.)
    assert!(ir.paytable.len() >= 20,
            "paytable has fewer than 20 entries (got {})",
            ir.paytable.len());
}
