//! W4.9 — Wild expansion runner integration tests.
//!
//! L&W CE base game: Wild on reels 2-5 expands to fill the reel.
//! This single fix closes the 0.26 RTP gap from W4.8 (0.691) to
//! 0.952 — within 0.8 % of Excel 0.960.

use slot_sim::ir::{Feature, Ir};
use slot_sim::sim::Engine;

const LW_PAR_001: &str =
    "../../games/ce-copy-test/out/lw.200-1637-001.slot-sim.ir.json";

#[test]
fn wild_expand_feature_emitted() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let we = ir
        .features
        .iter()
        .find_map(|f| match f {
            Feature::WildExpand {
                wild_symbol,
                on_reels,
                only_if_winning,
                ..
            } => Some((wild_symbol.clone(), on_reels.clone(), *only_if_winning)),
            _ => None,
        })
        .expect("Feature::WildExpand must be emitted for L&W CE");

    assert_eq!(we.0, "Wild");
    assert_eq!(we.1, vec![1, 2, 3, 4]);  // reels 2-5 in 0-indexed
    assert!(we.2, "L&W CE wild expansion is only-if-winning");
}

#[test]
fn wild_expand_fires_in_mc() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(500_000, 1, 0xFA57FACE);
    let we_events: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("wild_expand"))
        .map(|(_, v)| v)
        .sum();
    // Wild lands on reels 2-5 fairly often — expect at least 10k events
    // in 500k spins.
    assert!(
        we_events > 10_000,
        "wild_expand events {} too low — runner may be inactive",
        we_events,
    );
}

#[test]
fn lw_rtp_converges_to_excel() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(2_000_000, 1, 0xABCDEF12);
    let rtp = stats.rtp();
    let target = ir.meta.rtp_total;
    // W4.9 should bring RTP within 3 % of Excel target.
    assert!(
        (rtp - target).abs() < 0.03,
        "L&W RTP {:.4} drifts from Excel {:.4} by more than 3 % — W4.9 regression?",
        rtp, target,
    );
}

#[test]
fn lw_hit_freq_within_5pct_of_excel() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(2_000_000, 1, 0x12345678);
    let observed = stats.hit_freq();
    let target = ir.meta.hit_frequency;
    let rel_diff = (observed - target).abs() / target;
    assert!(
        rel_diff < 0.05,
        "L&W hit freq {:.4} vs Excel {:.4} — relative diff {:.3} > 5 %",
        observed, target, rel_diff,
    );
}
