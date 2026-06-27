//! W152 P0-3 — IR adapter Cascade / Respin / MysterySymbol integration.
//!
//! Reads the same fixture as the TS counterpart
//! (`tests/ir_cascade_respin_mystery.test.ts`) so that the byte-level
//! parity gate stays honest: any drift in either adapter's mapping
//! shows up here as a failed equality assertion.
//!
//! Fixture lives in the workspace `tests/fixtures/` (TS-owned by
//! convention, shared via relative path).

use slot_sim::config::{CascadeReplacement, GameConfig};
use slot_sim::ir::{ir_to_game_config, SlotGameIR};
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p.push("cascade-respin-mystery.json");
    p
}

fn load() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture_path())
        .expect("cascade-respin-mystery.json fixture must exist");
    SlotGameIR::from_json(&raw).expect("fixture must parse")
}

fn convert() -> GameConfig {
    ir_to_game_config(&load()).expect("conversion must succeed")
}

#[test]
fn cascade_config_extracted_with_ladder() {
    let cfg = convert();
    let cascade = cfg.cascade.as_ref().expect("cascade config must be set");
    assert_eq!(cascade.replacement, CascadeReplacement::Drop);
    assert_eq!(cascade.max_chain, 7);
    assert_eq!(
        cascade.multiplier_progression,
        Some(vec![1.0, 2.0, 3.0, 5.0, 8.0])
    );
}

#[test]
fn respin_config_extracted_with_cost_and_cap() {
    let cfg = convert();
    let respin = cfg.respin.as_ref().expect("respin config must be set");
    assert!((respin.cost_x - 2.5).abs() < f64::EPSILON);
    assert_eq!(respin.max_uses_per_spin, 3);
}

#[test]
fn mystery_config_extracted_with_distribution() {
    let cfg = convert();
    let mystery = cfg.mystery.as_ref().expect("mystery config must be set");
    assert_eq!(mystery.symbol_id, "S_MYS");
    assert_eq!(mystery.reveal_distribution.len(), 6);
    assert_eq!(mystery.reveal_distribution.get("S_LP1"), Some(&25.0));
    assert_eq!(mystery.reveal_distribution.get("S_LP2"), Some(&20.0));
    assert_eq!(mystery.reveal_distribution.get("S_LP3"), Some(&20.0));
    assert_eq!(mystery.reveal_distribution.get("S_HP1"), Some(&15.0));
    assert_eq!(mystery.reveal_distribution.get("S_HP2"), Some(&15.0));
    assert_eq!(mystery.reveal_distribution.get("S_WILD"), Some(&5.0));
}

#[test]
fn mystery_distribution_is_byte_stable() {
    // BTreeMap iterates in lexicographic order. Encode and compare to
    // the expected canonical form so the parity comparator can rely on
    // bit-exact JSON output.
    let cfg = convert();
    let mystery = cfg.mystery.as_ref().expect("mystery present");
    let json = serde_json::to_string(&mystery.reveal_distribution).unwrap();
    assert_eq!(
        json,
        r#"{"S_HP1":15.0,"S_HP2":15.0,"S_LP1":25.0,"S_LP2":20.0,"S_LP3":20.0,"S_WILD":5.0}"#,
        "mystery reveal_distribution JSON must be lexicographically ordered"
    );
}

#[test]
fn legacy_feature_paths_still_work() {
    let cfg = convert();
    // Free spins came from the fixture too.
    assert_eq!(cfg.free_spins.awards.get(&3), Some(&8u8));
    assert_eq!(cfg.free_spins.awards.get(&4), Some(&12u8));
    assert_eq!(cfg.free_spins.awards.get(&5), Some(&15u8));
    // Hold & win absent from this fixture — defaults stay.
    assert_eq!(cfg.hold_and_win.trigger_count, 6);
}

#[test]
fn cascade_respin_mystery_are_none_when_ir_omits_them() {
    let mut ir = load();
    ir.features
        .retain(|f| matches!(f, slot_sim::ir::Feature::FreeSpins { .. }));
    let cfg = ir_to_game_config(&ir).expect("conversion must succeed");
    assert!(cfg.cascade.is_none());
    assert!(cfg.respin.is_none());
    assert!(cfg.mystery.is_none());
}
