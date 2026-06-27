//! W4.6 — Pattern Win runner integration tests.
//!
//! Validates the L&W CE Red7 pattern feature:
//!   * adapter emits `Feature::PatternWin` with the correct anchor symbol
//!     and 1000× pays
//!   * runner fires only when grid has ≥ 3 anchor symbols on reel 0 +
//!     Wild on each of reels 1-4
//!   * MC RTP lifts beyond the W4.5 HoldAndWin contribution

use slot_sim::ir::{Feature, Ir};
use slot_sim::sim::Engine;

const LW_PAR_001: &str =
    "../../games/ce-copy-test/out/lw.200-1637-001.slot-sim.ir.json";

#[test]
fn pattern_win_emitted_with_red7_anchor() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let pw = ir
        .features
        .iter()
        .find_map(|f| match f {
            Feature::PatternWin {
                anchor_symbol,
                anchor_count,
                anchor_reel,
                required_wild_reels,
                pays,
            } => Some((
                anchor_symbol.clone(),
                *anchor_count,
                *anchor_reel,
                required_wild_reels.clone(),
                *pays,
            )),
            _ => None,
        })
        .expect("Feature::PatternWin must be emitted for L&W CE");

    assert_eq!(pw.0, "Red7");
    assert_eq!(pw.1, 3);
    assert_eq!(pw.2, 0);
    assert_eq!(pw.3, vec![1, 2, 3, 4]);
    assert!((pw.4 - 1000.0).abs() < 1e-9, "pattern pays must be 1000");
}

#[test]
fn pattern_win_fires_rarely() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(500_000, 1, 0xAFFE);
    let pw_triggers: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("pattern_win"))
        .map(|(_, v)| v)
        .sum();
    // Pattern is a specific geometric event — expect rare but not zero.
    // Below 5/500k it's likely a regression; above 5k/500k geometry is wrong.
    assert!(
        pw_triggers > 5 && pw_triggers < 5_000,
        "PatternWin triggers {} outside expected [5, 5000] band for 500k spins",
        pw_triggers,
    );
}

#[test]
fn lw_rtp_lifted_by_pattern_win() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(1_000_000, 1, 0xB16BEEF);
    // W4.5 baseline ~0.523, W4.6 adds ~0.04–0.05 → expect ≥ 0.55
    let rtp = stats.rtp();
    assert!(
        rtp >= 0.55,
        "L&W RTP {:.3} did not lift after PatternWin — runner inactive?",
        rtp,
    );
}

#[test]
fn lw_symbol_roles_calibrated() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let roles: std::collections::HashMap<&str, slot_sim::ir::SymbolRole> =
        ir.symbols.iter().map(|s| (s.id.as_str(), s.role)).collect();
    // Red7 / Blue7 / Bell / Melon are HP (was anchor for Red7 in earlier wave)
    for hp in ["Red7", "Blue7", "Bell", "Melon"] {
        assert_eq!(
            roles.get(hp).copied(),
            Some(slot_sim::ir::SymbolRole::Hp),
            "{} must be HP",
            hp,
        );
    }
    // Cherry / Lemon / Orange / Plum / Grapes are LP
    for lp in ["Cherry", "Lemon", "Orange", "Plum", "Grapes"] {
        assert_eq!(
            roles.get(lp).copied(),
            Some(slot_sim::ir::SymbolRole::Lp),
            "{} must be LP",
            lp,
        );
    }
}
