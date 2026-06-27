//! W4.5 — Hold-and-Win runner integration tests.
//!
//! Validates the L&W Cash Eruption RTP injection lands:
//!   * adapter populates `trigger_prob` + `avg_pay_per_trigger` on
//!     `Feature::HoldAndWin` from `cash_eruption_pages` JSON;
//!   * the runner actually fires at the configured rate;
//!   * resulting MC RTP closes the gap from base-only ~0.11 toward
//!     Excel ~0.96 (W4.5 lands at ~0.52; remaining 0.44 is Red7
//!     pattern-win + FS internal eval, tracked as W4.6).

use slot_sim::ir::{Feature, Ir};
use slot_sim::sim::Engine;

const LW_PAR_001: &str =
    "../../games/ce-copy-test/out/lw.200-1637-001.slot-sim.ir.json";

#[test]
fn hold_and_win_has_trigger_prob_and_avg_pay() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let how = ir
        .features
        .iter()
        .find_map(|f| match f {
            Feature::HoldAndWin {
                trigger_prob,
                avg_pay_per_trigger,
                ..
            } => Some((*trigger_prob, *avg_pay_per_trigger)),
            _ => None,
        })
        .expect("HoldAndWin must exist for L&W CE");
    let (prob, avg_pay) = how;
    let p = prob.expect("W4.5 adapter must emit trigger_prob");
    let ap = avg_pay.expect("W4.5 adapter must emit avg_pay_per_trigger");
    // Estimated trigger rate sits roughly 0.5 % - 5 % for CE-class
    // games (~6 fireballs on a 5×3 grid). Allow generous band.
    assert!(
        (0.001..0.10).contains(&p),
        "CE trigger_prob {p} outside reasonable [0.001, 0.10] band",
    );
    // avg_pay × trigger_prob ≈ ce_from_base_rtp ≈ 0.41
    let rtp_contribution = ap * p;
    assert!(
        (rtp_contribution - 0.41).abs() < 0.02,
        "CE RTP contribution {:.3} (= avg_pay {:.3} × trigger_prob {:.5}) \
         drifts from Excel 0.41",
        rtp_contribution, ap, p,
    );
}

#[test]
fn hold_and_win_fires_at_expected_rate() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(500_000, 1, 0xDEC0DE);
    let triggers: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("hold_and_win:triggered"))
        .map(|(_, v)| v)
        .sum();
    // 500k spins × ~0.0167 trigger_prob ≈ 8350 triggers, tolerance ±30 %
    let expected = 500_000.0 * 0.0167;
    let low = (expected * 0.7) as u64;
    let high = (expected * 1.3) as u64;
    assert!(
        triggers >= low && triggers <= high,
        "HoldAndWin triggers {} outside [{}, {}] (expected ~{:.0})",
        triggers, low, high, expected,
    );
}

#[test]
fn lw_rtp_lifted_by_hold_and_win() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(1_000_000, 1, 0xCAFED00D);
    // Pre-W4.5 baseline ~0.115 (base only). With CE runner active we
    // expect ~0.52 — accept anything ≥ 0.40 as proof CE is contributing.
    let rtp = stats.rtp();
    assert!(
        rtp >= 0.40,
        "L&W RTP {:.3} too low — Hold-and-Win runner appears inactive",
        rtp,
    );
}
