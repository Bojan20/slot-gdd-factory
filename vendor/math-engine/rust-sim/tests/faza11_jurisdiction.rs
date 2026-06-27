//! Faza 11.9 — Jurisdiction Adapter Integration Tests.
//!
//! Tests validate() and auto_fix() against SlotGameIR instances
//! built from JSON via serde_json round-trip.

use slot_sim::ir::{Feature, GambleType, NearMissRule, SlotGameIR, TieResolution};
use slot_sim::jurisdiction::profiles::get_profile;
use slot_sim::jurisdiction::types::ViolationSeverity;
use slot_sim::jurisdiction::{auto_fix, validate};

// ─── Minimal compliant IR JSON ────────────────────────────────────────────────

const BASE_IR_JSON: &str = r#"{
  "schema_version": "1.0.0",
  "meta": {
    "id": "rust-jurisdiction-test",
    "name": "Rust Jurisdiction Test",
    "version": "1.0.0",
    "theme_tags": ["test"]
  },
  "topology": { "kind": "rectangular", "reels": 5, "rows": 3 },
  "symbols": [
    { "id": "S_LP1", "name": "LP1", "kind": "lp" },
    { "id": "S_HP1", "name": "HP1", "kind": "hp" },
    { "id": "S_WILD", "name": "Wild", "kind": "wild", "substitutes": "*" },
    { "id": "S_SCAT", "name": "Scatter", "kind": "scatter" }
  ],
  "reels": {
    "mode": "weighted",
    "base": [
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0 }
    ]
  },
  "evaluation": {
    "kind": "lines",
    "paylines": [[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2]],
    "direction": "ltr",
    "min_match": 3,
    "pay_left_to_right_only": true
  },
  "paytable": {
    "S_LP1": { "3": 0.5, "4": 2.0, "5": 8.0 },
    "S_HP1": { "3": 3.0, "4": 12.0, "5": 50.0 }
  },
  "features": [],
  "rng": { "kind": "mulberry32", "default_seed": 12345 },
  "bet": { "currency": "EUR", "base_bet": 1.0, "denominations": [0.01, 0.1, 1.0] },
  "limits": {
    "target_rtp": 0.96,
    "rtp_tolerance": 0.0005,
    "max_win_x": 5000.0,
    "win_cap_apply": "per_spin",
    "target_volatility": "high",
    "hit_freq_target": 0.3
  },
  "compliance": {
    "jurisdictions": ["UKGC", "MGA"],
    "rtp_range_required": [0.94, 0.99],
    "max_win_cap_required": 5000.0,
    "near_miss_rule": "must_be_random",
    "ldw_disclosure": true,
    "session_time_display": true
  },
  "rtp_allocation": {
    "base_game": 0.66,
    "free_spins": 0.30,
    "hold_and_win": 0.0,
    "jackpot": 0.0,
    "tolerance": 0.005
  }
}"#;

fn base_ir() -> SlotGameIR {
    SlotGameIR::from_json(BASE_IR_JSON).expect("base IR JSON must parse")
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[test]
fn faza11_validate_compliant_ir_no_errors() {
    let ir = base_ir();
    let report = validate(&ir, &["UKGC", "MGA"]);
    assert!(report.is_compliant, "Compliant IR should have zero errors");
    assert_eq!(report.summary.errors, 0);
}

#[test]
fn faza11_validate_rtp_violation_ukgc() {
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.93; // below UKGC min 0.94
    let report = validate(&ir, &["UKGC"]);
    assert!(!report.is_compliant);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-RTP-001");
    assert!(v.is_some(), "Expected UKGC-RTP-001 violation");
    assert_eq!(v.unwrap().severity, ViolationSeverity::Error);
    assert!(!v.unwrap().can_auto_fix, "RTP-001 must not be auto-fixable");
}

#[test]
fn faza11_validate_gamble_violation_ukgc() {
    let mut ir = base_ir();
    ir.features.push(Feature::Gamble {
        ty: GambleType::RedBlack,
        max_steps: 5,
        tie_resolution: TieResolution::House,
    });
    let report = validate(&ir, &["UKGC"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-FEAT-GAMBLE");
    assert!(v.is_some(), "Expected UKGC-FEAT-GAMBLE violation");
    assert_eq!(v.unwrap().severity, ViolationSeverity::Error);
    assert!(v.unwrap().can_auto_fix);
}

#[test]
fn faza11_validate_buy_feature_violation_ukgc() {
    let mut ir = base_ir();
    ir.features.push(Feature::BuyFeature {
        offers: vec![slot_sim::ir::BuyOffer {
            id: "bf1".to_string(),
            cost_x: 100.0,
            guaranteed: "free_spins".to_string(),
        }],
    });
    let report = validate(&ir, &["UKGC"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-FEAT-BUYFEATURE");
    assert!(v.is_some(), "Expected UKGC-FEAT-BUYFEATURE violation");
    assert_eq!(v.unwrap().severity, ViolationSeverity::Error);
}

#[test]
fn faza11_validate_ldw_disclosure_violation() {
    let mut ir = base_ir();
    ir.compliance.ldw_disclosure = false;
    let report = validate(&ir, &["UKGC"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-LDW-001");
    assert!(v.is_some(), "Expected UKGC-LDW-001 violation");
    assert_eq!(v.unwrap().severity, ViolationSeverity::Error);
    assert!(v.unwrap().can_auto_fix);
}

#[test]
fn faza11_validate_max_win_mga_no_cap() {
    // Regression: MGA online has NO statutory max-win cap (Kimi research,
    // May 2026 — Player Protection Directive 2/2018). Any positive value
    // must validate without a MAXWIN error.
    let mut ir = base_ir();
    ir.limits.max_win_x = 1_000_000.0;
    let report = validate(&ir, &["MGA"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "MGA-MAXWIN-001");
    assert!(
        v.is_none(),
        "MGA online must not enforce a max-win cap (got: {:?})",
        v
    );
}

#[test]
fn faza11_auto_fix_removes_gamble() {
    let mut ir = base_ir();
    ir.features.push(Feature::Gamble {
        ty: GambleType::RedBlack,
        max_steps: 5,
        tie_resolution: TieResolution::House,
    });
    assert!(ir
        .features
        .iter()
        .any(|f| matches!(f, Feature::Gamble { .. })));

    let (fixed_ir, result) = auto_fix(&ir, &["UKGC"]);
    assert!(!fixed_ir
        .features
        .iter()
        .any(|f| matches!(f, Feature::Gamble { .. })));
    let fix = result
        .applied_fixes
        .iter()
        .find(|f| f.rule_id == "UKGC-FEAT-GAMBLE");
    assert!(fix.is_some(), "Expected UKGC-FEAT-GAMBLE fix applied");
}

#[test]
fn faza11_auto_fix_sets_ldw_disclosure() {
    let mut ir = base_ir();
    ir.compliance.ldw_disclosure = false;

    let (fixed_ir, result) = auto_fix(&ir, &["UKGC"]);
    assert!(fixed_ir.compliance.ldw_disclosure);
    let fix = result
        .applied_fixes
        .iter()
        .find(|f| f.rule_id == "UKGC-LDW-001");
    assert!(fix.is_some());
}

#[test]
fn faza11_auto_fix_max_win_mga_is_noop() {
    // Regression: MGA has no statutory online max-win cap, so the
    // auto-fixer must NOT clamp max_win_x.
    let mut ir = base_ir();
    ir.limits.max_win_x = 1_000_000.0;

    let (fixed_ir, result) = auto_fix(&ir, &["MGA"]);
    // Value untouched.
    assert_eq!(fixed_ir.limits.max_win_x, 1_000_000.0);
    // No MAXWIN fix recorded.
    assert!(
        result
            .applied_fixes
            .iter()
            .all(|f| f.rule_id != "MGA-MAXWIN-001"),
        "MGA-MAXWIN-001 must not auto-fix when no cap defined"
    );
}

#[test]
fn faza11_auto_fix_on_compliant_zero_fixes() {
    let ir = base_ir();
    let (_, result) = auto_fix(&ir, &["UKGC"]);
    // Should be fully compliant after fix (already was)
    assert!(result.is_fully_compliant);
    // No error-level fixes needed
    let error_fixes: Vec<_> = result
        .applied_fixes
        .iter()
        .filter(|f| f.rule_id.ends_with("-RTP-001") || f.rule_id.ends_with("-LDW-001"))
        .collect();
    assert!(
        error_fixes.is_empty(),
        "No error fixes should be needed for compliant IR"
    );
}

#[test]
fn faza11_get_profile_ukgc_some() {
    let profile = get_profile("UKGC");
    assert!(profile.is_some());
    let p = profile.unwrap();
    assert_eq!(p.id, "UKGC");
    assert_eq!(p.rtp_range, [0.94, 0.99]);
}

#[test]
fn faza11_get_profile_unknown_none() {
    let profile = get_profile("UNKNOWN_JUR");
    assert!(profile.is_none());
}

#[test]
fn faza11_multiple_jurisdiction_validation() {
    // Post-2025 ranges: UKGC ≥ 0.94, MGA ≥ 0.85. Pick 0.84 to break both.
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.84;
    ir.compliance.rtp_range_required = [0.94, 0.99];

    let report = validate(&ir, &["UKGC", "MGA"]);
    let ukgc_err = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-RTP-001");
    let mga_err = report
        .violations
        .iter()
        .find(|v| v.rule_id == "MGA-RTP-001");
    assert!(ukgc_err.is_some(), "Expected UKGC-RTP-001");
    assert!(mga_err.is_some(), "Expected MGA-RTP-001");
}

#[test]
fn faza11_auto_fix_does_not_modify_rtp_001() {
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.93; // below UKGC min — NOT auto-fixable

    let (fixed_ir, result) = auto_fix(&ir, &["UKGC"]);
    // The RTP should NOT have been changed
    assert_eq!(fixed_ir.limits.target_rtp, 0.93);
    // No fix for RTP-001
    let rtp_fix = result
        .applied_fixes
        .iter()
        .find(|f| f.rule_id == "UKGC-RTP-001");
    assert!(rtp_fix.is_none(), "RTP-001 must not be auto-fixed");
    // Not fully compliant since RTP error remains
    assert!(!result.is_fully_compliant);
}

#[test]
fn faza11_validate_informational_notes_count() {
    let ir = base_ir();
    let report = validate(&ir, &["UKGC"]);
    let info_count = report
        .violations
        .iter()
        .filter(|v| v.severity == ViolationSeverity::Info && v.jurisdiction == "UKGC")
        .count();
    // UKGC has 6 informational notes + 4 derived Info checks
    // (AUTOPLAY-001, TURBO-001, PACING-001, WAGERING-001) = 10.
    assert_eq!(info_count, 10);
}

#[test]
fn faza11_validate_session_time_violation() {
    let mut ir = base_ir();
    ir.compliance.session_time_display = false;
    let report = validate(&ir, &["UKGC"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-SESSION-001");
    assert!(v.is_some(), "Expected UKGC-SESSION-001");
    assert_eq!(v.unwrap().severity, ViolationSeverity::Error);
    assert!(v.unwrap().can_auto_fix);
}

#[test]
fn faza11_auto_fix_sets_near_miss_rule() {
    let mut ir = base_ir();
    ir.compliance.near_miss_rule = NearMissRule::AllowedWithinDistribution;

    let (fixed_ir, result) = auto_fix(&ir, &["UKGC"]);
    assert_eq!(
        fixed_ir.compliance.near_miss_rule,
        NearMissRule::MustBeRandom
    );
    let fix = result
        .applied_fixes
        .iter()
        .find(|f| f.rule_id == "UKGC-NEARMISS-001");
    assert!(fix.is_some());
}

#[test]
fn faza11_auto_fix_does_not_mutate_original() {
    let mut ir = base_ir();
    ir.features.push(Feature::Gamble {
        ty: GambleType::RedBlack,
        max_steps: 5,
        tie_resolution: TieResolution::House,
    });
    ir.compliance.ldw_disclosure = false;

    let original_feature_count = ir.features.len();
    let original_ldw = ir.compliance.ldw_disclosure;

    let _ = auto_fix(&ir, &["UKGC"]);

    // Original IR must be unchanged
    assert_eq!(ir.features.len(), original_feature_count);
    assert_eq!(ir.compliance.ldw_disclosure, original_ldw);
}
