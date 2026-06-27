//! W4.8 — Skeleton Key (IGT 200-1517-001/002/003) → slot-sim IR round-trip.
//!
//! Loads the universal IR JSONs emitted by
//! `tools/par_extract_ultimate/build_ir.py` for all three SWID variants and
//! asserts structural correctness:
//!
//!   ▸ deserialize cleanly (serde schema parity)
//!   ▸ vendor = igt, family = megaways, RTP in (0.90, 1.0)
//!   ▸ topology = Megaways with reels=5, rows in [3, 6]
//!   ▸ evaluation = Megaways with min_count=3
//!   ▸ Wild + Bonus roles assigned; wild substitutes_except includes Bonus
//!   ▸ 8 base reel sets with 5 reels each + base_weights total >0
//!   ▸ ≥ 1 FS reel set in PAR-Bonus
//!   ▸ paytable non-empty + all pays ≥ 0; ≥ 1 scatter entry (3+ Bonus)
//!   ▸ Free Spins feature configured (trigger_symbol=Bonus, trigger_count_min=3)
//!
//! NOTE: Megaways engine evaluation (variable rows per reel × per-reel
//! windowed sampling) is **not yet** in `slot-sim::sim::Engine` — running
//! 100k spins is TODO(W4.8c). Structural round-trip is the W4.8 acceptance
//! gate; full play-through arrives in the engine wave.

use slot_sim::ir::{Evaluation, Feature, Ir, SymbolRole, Topology};

const SK_001: &str =
    "../../games/skeleton-key/out/skeleton-key.200-1517-001.slot-sim.ir.json";
const SK_002: &str =
    "../../games/skeleton-key/out/skeleton-key.200-1517-002.slot-sim.ir.json";
const SK_003: &str =
    "../../games/skeleton-key/out/skeleton-key.200-1517-003.slot-sim.ir.json";

fn load_and_assert_meta(path: &str, swid: &str, rtp_min: f64, rtp_max: f64) -> Ir {
    let ir = Ir::load(path).unwrap_or_else(|e| panic!("load {path}: {e}"));
    assert_eq!(ir.meta.vendor, "igt", "vendor");
    assert_eq!(ir.meta.swid, swid, "swid");
    assert_eq!(ir.meta.family, "megaways", "family");
    assert!(
        ir.meta.rtp_total > rtp_min && ir.meta.rtp_total < rtp_max,
        "RTP {} outside ({}, {})",
        ir.meta.rtp_total,
        rtp_min,
        rtp_max,
    );
    assert!(ir.meta.hit_frequency > 0.0 && ir.meta.hit_frequency < 1.0);
    assert!(ir.meta.win_frequency > 0.0 && ir.meta.win_frequency < 1.0);
    ir
}

#[test]
fn skeleton_key_001_full_shape() {
    let ir = load_and_assert_meta(SK_001, "200-1517-001", 0.96, 0.97);

    // Topology — Megaways 5 reels, rows ∈ [3,6].
    match ir.topology {
        Topology::Megaways {
            reels: 5,
            rows_min,
            rows_max,
            ref rows_weights,
        } => {
            assert!(rows_min >= 3 && rows_min <= 6);
            assert!(rows_max >= rows_min && rows_max <= 100);
            assert_eq!(rows_weights.len(), 5, "rows_weights must have 5 reels");
        }
        ref t => panic!("expected Megaways, got {:?}", t),
    }

    // Evaluation — Megaways min_count=3.
    match &ir.evaluation {
        Evaluation::Megaways { min_count } => assert_eq!(*min_count, 3),
        e => panic!("expected Evaluation::Megaways, got {:?}", e),
    }

    // 8 base reel sets.
    assert_eq!(
        ir.reels.base.len(),
        8,
        "Skeleton Key publishes 8 base reel sets"
    );
    for (i, rs) in ir.reels.base.iter().enumerate() {
        assert_eq!(rs.reels.len(), 5, "base set {i} must have 5 reels");
        for (j, reel) in rs.reels.iter().enumerate() {
            assert!(!reel.is_empty(), "base set {i} reel {j} empty");
            for stop in reel {
                assert!(stop.weight > 0, "weight must be positive");
            }
        }
    }

    // Base reel weights total > 0.
    assert!(
        ir.reels.base_weights.total > 0,
        "base_weights.total must be positive"
    );

    // FS reel sets present.
    assert!(!ir.reels.fs.is_empty(), "FS reel sets missing");

    // Wild + Bonus roles.
    let wild = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Wild)
        .expect("wild role missing");
    assert_eq!(wild.id, "Wild");
    let bonus = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Scatter)
        .expect("scatter role missing");
    assert_eq!(bonus.id, "Bonus");
    // Wild substitutes_except includes Bonus (per Excel notes).
    assert!(
        wild.substitutes_except
            .iter()
            .any(|s| s == "Bonus"),
        "wild must not substitute for Bonus"
    );

    // Paytable: non-empty, all pays ≥ 0, ≥ 1 scatter entry (3+ Bonus).
    assert!(!ir.paytable.is_empty(), "paytable empty");
    let mut has_scatter = false;
    for e in &ir.paytable {
        assert!(e.pays >= 0.0, "negative pay in paytable");
        if e.scope == "scatter" && e.combo.iter().all(|s| s == "Bonus") {
            has_scatter = true;
        }
    }
    assert!(has_scatter, "no scatter (3+ Bonus) paytable entry");

    // FS feature.
    let fs = ir
        .features
        .iter()
        .find_map(|f| {
            if let Feature::FreeSpins {
                trigger_symbol,
                trigger_count_min,
                initial_spins,
                ..
            } = f
            {
                Some((trigger_symbol.clone(), *trigger_count_min, *initial_spins))
            } else {
                None
            }
        })
        .expect("FreeSpins feature missing");
    assert_eq!(fs.0, "Bonus");
    assert_eq!(fs.1, 3);
    assert!(fs.2 >= 5, "initial FS spins too low: {}", fs.2);
}

#[test]
fn skeleton_key_002_deserializes() {
    let ir = load_and_assert_meta(SK_002, "200-1517-002", 0.94, 0.95);
    assert_eq!(ir.reels.base.len(), 8);
    // Hold variant: rtp_total < 001
    let ir1 = Ir::load(SK_001).unwrap();
    assert!(ir.meta.rtp_total < ir1.meta.rtp_total);
}

#[test]
fn skeleton_key_003_deserializes() {
    let ir = load_and_assert_meta(SK_003, "200-1517-003", 0.92, 0.93);
    assert_eq!(ir.reels.base.len(), 8);
    let ir2 = Ir::load(SK_002).unwrap();
    assert!(ir.meta.rtp_total < ir2.meta.rtp_total);
}

#[test]
fn skeleton_key_all_three_rtp_strictly_descending() {
    // SWID -001 is highest payout; -003 is lowest. Tightens hold rule.
    let r1 = Ir::load(SK_001).unwrap().meta.rtp_total;
    let r2 = Ir::load(SK_002).unwrap().meta.rtp_total;
    let r3 = Ir::load(SK_003).unwrap().meta.rtp_total;
    assert!(r1 > r2 && r2 > r3, "RTP order: {r1} > {r2} > {r3}");
    // Excel-claimed values (rounded): 0.9649 / 0.9446 / 0.9243.
    assert!((r1 - 0.9649).abs() < 0.001);
    assert!((r2 - 0.9446).abs() < 0.001);
    assert!((r3 - 0.9243).abs() < 0.001);
}
