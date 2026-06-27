//! Faza 1.1 acceptance gate (Rust side).
//!
//! Loads the same `tests/fixtures/parity.json` the TS test suite uses and
//! validates three claims:
//!   1. serde accepts the shape — every field deserializes cleanly.
//!   2. `cross_validate` reports zero errors on the canonical fixture.
//!   3. Roundtrip through `to_json_pretty` → `from_json` is structurally
//!      identical (BTreeMap key ordering + serde defaults stable).
//!
//! Negative tests mirror the TS suite line-for-line so a regression in
//! one engine fails both gates.

use slot_sim::ir::{cross_validate, SlotGameIR};
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    // CARGO_MANIFEST_DIR is `rust-sim`, fixture lives at `../tests/fixtures/`.
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p.push("parity.json");
    p
}

fn load() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture_path()).expect("fixture exists");
    SlotGameIR::from_json(&raw).expect("fixture parses")
}

#[test]
fn fixture_parses() {
    let ir = load();
    assert_eq!(ir.meta.id, "parity-fixture");
    assert_eq!(ir.schema_version, "1.0.0");
}

#[test]
fn fixture_passes_cross_validate() {
    let ir = load();
    let report = cross_validate(&ir);
    assert!(
        report.errors.is_empty(),
        "expected zero errors, got: {:#?}",
        report.errors
    );
}

#[test]
fn roundtrip_structurally_identical() {
    let ir = load();
    let json = ir.to_json_pretty().expect("serialize");
    let back = SlotGameIR::from_json(&json).expect("re-parse");
    assert_eq!(ir, back);
}

#[test]
fn unknown_paytable_symbol_is_error() {
    let mut ir = load();
    ir.paytable.insert(
        "S_PHANTOM".to_string(),
        std::collections::BTreeMap::from([("3".to_string(), 1.0)]),
    );
    let report = cross_validate(&ir);
    assert!(report.errors.iter().any(|e| e.path.contains("S_PHANTOM")));
}

#[test]
fn payline_length_mismatch_is_error() {
    let mut ir = load();
    if let slot_sim::ir::Evaluation::Lines { paylines, .. } = &mut ir.evaluation {
        paylines.push(vec![1, 1, 1, 1]); // 4 reels but topology says 5
    }
    let report = cross_validate(&ir);
    assert!(report
        .errors
        .iter()
        .any(|e| e.message.contains("payline length")));
}

#[test]
fn row_out_of_range_is_error() {
    let mut ir = load();
    if let slot_sim::ir::Evaluation::Lines { paylines, .. } = &mut ir.evaluation {
        paylines[0] = vec![9, 9, 9, 9, 9];
    }
    let report = cross_validate(&ir);
    assert!(report
        .errors
        .iter()
        .any(|e| e.message.contains("out of range")));
}

#[test]
fn rtp_allocation_sum_must_match_target() {
    let mut ir = load();
    ir.rtp_allocation.base_game = 0.1; // sum drifts well outside tolerance
    let report = cross_validate(&ir);
    assert!(report
        .errors
        .iter()
        .any(|e| e.path.contains("rtp_allocation")));
}

#[test]
fn rtp_outside_compliance_band_is_warning() {
    let mut ir = load();
    ir.compliance.rtp_range_required = [0.97, 0.98];
    let report = cross_validate(&ir);
    assert!(report
        .warnings
        .iter()
        .any(|w| w.path.contains("target_rtp")));
}

// ── PHASE 50 — duplicate symbol id detection (TS↔Rust parity) ──────────
#[test]
fn duplicate_symbol_id_is_error() {
    let mut ir = load();
    let dup = ir.symbols[0].clone();
    ir.symbols.push(dup);
    let report = cross_validate(&ir);
    let dup_errors: Vec<_> = report
        .errors
        .iter()
        .filter(|e| e.message.contains("duplicate symbol id"))
        .collect();
    assert!(
        !dup_errors.is_empty(),
        "expected at least one duplicate-id error, got: {:#?}",
        report.errors
    );
    assert!(
        dup_errors[0].path.starts_with("/symbols/"),
        "expected /symbols/N/id path, got: {}",
        dup_errors[0].path
    );
}

#[test]
fn hold_and_win_without_bonus_symbol_is_error() {
    let mut ir = load();
    ir.features.push(slot_sim::ir::Feature::HoldAndWin {
        trigger: slot_sim::ir::TriggerByCount {
            by: slot_sim::ir::TriggerBy::BonusCount,
            thresholds: None,
            min: Some(6),
        },
        respins_initial: 3,
        respin_reset_on_new: true,
        cash_value_distribution: vec![slot_sim::ir::CashValueDist {
            value: 1.0,
            weight: 1.0,
        }],
        jackpot_tiers: vec![slot_sim::ir::JackpotTier {
            id: "GRAND".into(),
            multiplier: 1000.0,
        }],
        grid_full_award: None,
    });
    let report = cross_validate(&ir);
    assert!(report
        .errors
        .iter()
        .any(|e| e.message.contains("hold_and_win")));
}
