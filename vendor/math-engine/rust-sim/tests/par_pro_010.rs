//! PAR-010 — Closed-form per-pay-rule RTP solver.

use slot_sim::ir::SlotGameIR;
use slot_sim::par::{solve_per_pay_rule_rtp, PaytableSection};
use std::path::PathBuf;

fn fixture(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p.push(name);
    p
}

fn load_ir() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture("parity-base-only.json")).unwrap();
    SlotGameIR::from_json(&raw).unwrap()
}

#[test]
fn solver_emits_one_entry_per_ir_paytable_cell() {
    let ir = load_ir();
    let solved = solve_per_pay_rule_rtp(&ir);
    // Fixture: 5 paying symbols × 3 n-of-a-kind cells = 15 entries.
    assert_eq!(solved.len(), 15);
    for k in solved.keys() {
        assert!(k.contains("oak"), "key {k} must use {{sym}}_{{n}}oak format");
    }
}

#[test]
fn solver_values_are_non_negative_and_finite() {
    let ir = load_ir();
    let solved = solve_per_pay_rule_rtp(&ir);
    for (k, v) in &solved {
        assert!(v.is_finite(), "{k} = {v} must be finite");
        assert!(*v >= 0.0, "{k} = {v} must be non-negative");
    }
}

#[test]
fn higher_symbol_weight_increases_its_pay_rule_contribution() {
    use slot_sim::ir::ReelSet;
    let mut ir = load_ir();
    let base_solved = solve_per_pay_rule_rtp(&ir);
    let base_lp1_3oak = base_solved["S_LP1_3oak"];

    // Double the LP1 weight on each reel — its 3oak contribution must rise.
    if let ReelSet::Weighted { base, .. } = &mut ir.reels {
        for dist in base.iter_mut() {
            if let Some(w) = dist.get_mut("S_LP1") {
                *w *= 2.0;
            }
        }
    }
    let boosted = solve_per_pay_rule_rtp(&ir);
    let boosted_lp1_3oak = boosted["S_LP1_3oak"];
    assert!(
        boosted_lp1_3oak > base_lp1_3oak,
        "doubling LP1 weight must raise LP1_3oak contribution: base={base_lp1_3oak} boosted={boosted_lp1_3oak}"
    );
}

#[test]
fn paytable_section_uses_solver_values_not_placebo_zero() {
    let ir = load_ir();
    let section = PaytableSection::from_ir(&ir);
    let nonzero = section.pay_rule_rtp.values().filter(|v| **v > 0.0).count();
    assert!(
        nonzero > 0,
        "at least some pay_rule_rtp entries must be > 0 after the solver runs"
    );
}
