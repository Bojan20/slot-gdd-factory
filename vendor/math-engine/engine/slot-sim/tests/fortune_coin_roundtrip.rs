//! W4.10 — Fortune Coin Boost Classic (IGT 200-1581-001..004) → slot-sim IR
//! round-trip.
//!
//! Loads universal IR JSONs for all four SWID variants and asserts:
//!
//!   ▸ deserialize cleanly
//!   ▸ vendor = igt, family = ways, RTP in (0.89, 0.96)
//!   ▸ topology Rectangular 5x3
//!   ▸ evaluation Ways 243 with min_count=3
//!   ▸ symbols include Wild (substitutes_except: Bonus + Coin + "Coin Boost")
//!     and Bonus (scatter)
//!   ▸ ≥ 1 base reel set + ≥ 1 FS reel set
//!   ▸ Coin / Coin Boost symbols appear on at least one FS reel set
//!     (RS3_FG_CE_* variants carry the cascade trigger)
//!   ▸ paytable non-empty + ≥ 1 scatter entry (3+ Bonus)
//!   ▸ FreeSpins feature configured
//!   ▸ all 4 SWID RTPs strictly descending (lower hold = higher RTP)
//!
//! NOTE: Coin/Boost cascade evaluator and Jackpot Bonus tier resolver are
//! TODO(W4.10c) — full play-through arrives once `slot-sim::sim::Engine`
//! grows a Cascade pass. W4.10 acceptance is structural round-trip only.

use slot_sim::ir::{Evaluation, Feature, Ir, SymbolRole, Topology};

const FC_001: &str =
    "../../games/fortune-coin-boost-classic/out/fortune-coin-boost-classic.200-1581-001.slot-sim.ir.json";
const FC_002: &str =
    "../../games/fortune-coin-boost-classic/out/fortune-coin-boost-classic.200-1581-002.slot-sim.ir.json";
const FC_003: &str =
    "../../games/fortune-coin-boost-classic/out/fortune-coin-boost-classic.200-1581-003.slot-sim.ir.json";
const FC_004: &str =
    "../../games/fortune-coin-boost-classic/out/fortune-coin-boost-classic.200-1581-004.slot-sim.ir.json";

fn load_and_assert_meta(path: &str, swid: &str, rtp_min: f64, rtp_max: f64) -> Ir {
    let ir = Ir::load(path).unwrap_or_else(|e| panic!("load {path}: {e}"));
    assert_eq!(ir.meta.vendor, "igt", "vendor");
    assert_eq!(ir.meta.swid, swid, "swid");
    assert_eq!(ir.meta.family, "ways", "family");
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
fn fortune_coin_001_full_shape() {
    let ir = load_and_assert_meta(FC_001, "200-1581-001", 0.94, 0.96);

    // Topology — Rectangular 5x3.
    match ir.topology {
        Topology::Rectangular { reels: 5, rows: 3 } => {}
        ref t => panic!("expected Rectangular 5x3, got {:?}", t),
    }

    // Evaluation — Ways 243, min_count=3.
    match &ir.evaluation {
        Evaluation::Ways { ways, min_count } => {
            assert_eq!(*ways, 243);
            assert_eq!(*min_count, 3);
        }
        e => panic!("expected Ways/243, got {:?}", e),
    }

    // ≥ 1 base reel set + ≥ 1 FS reel set.
    assert!(!ir.reels.base.is_empty(), "no base reel sets");
    assert!(!ir.reels.fs.is_empty(), "no FS reel sets");
    for rs in ir.reels.base.iter().chain(ir.reels.fs.iter()) {
        assert_eq!(rs.reels.len(), 5, "reel set {} not 5 reels", rs.set);
        for reel in &rs.reels {
            assert!(!reel.is_empty(), "reel set {} has empty reel", rs.set);
            for stop in reel {
                assert!(stop.weight > 0);
            }
        }
    }

    // Wild + Bonus roles.
    let wild = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Wild)
        .expect("wild missing");
    assert_eq!(wild.id, "Wild");
    let except: std::collections::HashSet<&str> =
        wild.substitutes_except.iter().map(|s| s.as_str()).collect();
    assert!(except.contains("Bonus"), "Wild must not sub for Bonus");
    assert!(except.contains("Coin"), "Wild must not sub for Coin");
    assert!(
        except.contains("Coin Boost"),
        "Wild must not sub for Coin Boost"
    );
    let bonus = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Scatter)
        .expect("scatter missing");
    assert_eq!(bonus.id, "Bonus");

    // Coin / Coin Boost on at least one FS reel set.
    let mut coin_seen = false;
    for rs in &ir.reels.fs {
        for reel in &rs.reels {
            for stop in reel {
                if stop.symbol == "Coin" || stop.symbol == "Coin Boost" {
                    coin_seen = true;
                    break;
                }
            }
            if coin_seen {
                break;
            }
        }
        if coin_seen {
            break;
        }
    }
    assert!(coin_seen, "Coin / Coin Boost missing from all FS sets");

    // Paytable: non-empty + ≥ 1 scatter entry (3+ Bonus).
    assert!(!ir.paytable.is_empty(), "paytable empty");
    let mut has_scatter = false;
    for e in &ir.paytable {
        assert!(e.pays >= 0.0);
        if e.scope == "scatter" && e.combo.iter().all(|s| s == "Bonus") {
            has_scatter = true;
        }
    }
    assert!(has_scatter, "no Bonus scatter entry in paytable");

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
        .expect("FreeSpins missing");
    assert_eq!(fs.0, "Bonus");
    assert_eq!(fs.1, 3);
    assert!(fs.2 >= 5, "initial FS spins {} < 5", fs.2);
}

#[test]
fn fortune_coin_002_deserializes() {
    load_and_assert_meta(FC_002, "200-1581-002", 0.93, 0.95);
}

#[test]
fn fortune_coin_003_deserializes() {
    load_and_assert_meta(FC_003, "200-1581-003", 0.91, 0.93);
}

#[test]
fn fortune_coin_004_deserializes() {
    load_and_assert_meta(FC_004, "200-1581-004", 0.89, 0.91);
}

#[test]
fn fortune_coin_all_four_rtp_strictly_descending() {
    let r1 = Ir::load(FC_001).unwrap().meta.rtp_total;
    let r2 = Ir::load(FC_002).unwrap().meta.rtp_total;
    let r3 = Ir::load(FC_003).unwrap().meta.rtp_total;
    let r4 = Ir::load(FC_004).unwrap().meta.rtp_total;
    assert!(
        r1 > r2 && r2 > r3 && r3 > r4,
        "RTP order: {r1} > {r2} > {r3} > {r4}"
    );
    // Excel-claimed values (rounded): 0.9501, 0.9410, 0.9209, 0.9014.
    assert!((r1 - 0.9501).abs() < 0.001);
    assert!((r2 - 0.9410).abs() < 0.001);
    assert!((r3 - 0.9209).abs() < 0.001);
    assert!((r4 - 0.9014).abs() < 0.001);
}
