//! Faza 11.10 — UKGC compliance integration tests (SI 2025/215 + RTS 14D).
//!
//! Covers:
//! * IR-level stake-cap detection (`UKGC-STAKE-001` / `-STAKE-002`).
//! * Auto-fix of over-cap base_bet + denominations.
//! * Runtime stake validator: 25+, 18-24 band, missing age, unknown band.
//! * Runtime pacing: RTS 14D minimum 2500ms.
//! * Auto-play / turbo blanket bans.
//! * Bonus wagering cap (10x).
//! * Profile flag surface — informational notes, regulator URL,
//!   effective_from.
//! * Hardening: NaN / infinite / negative stake; empty profile pass-through.
//! * Multi-jurisdiction interaction (UKGC + ADM both autoplay-prohibit).
//! * Compliance error serialisation round-trip (so daemon/HUD can ship them).

use slot_sim::ir::SlotGameIR;
use slot_sim::jurisdiction::profiles::get_profile;
use slot_sim::jurisdiction::types::{ComplianceError, ViolationSeverity};
use slot_sim::jurisdiction::{
    auto_fix, validate, validate_autoplay, validate_bonus_wagering, validate_spin,
    validate_spin_duration, validate_spin_full, validate_stake, validate_turbo, SpinContext,
};

// ─── Shared base IR ──────────────────────────────────────────────────────────

const BASE_IR_JSON: &str = r#"{
  "schema_version": "1.0.0",
  "meta": {
    "id": "rust-uk-compliance-test",
    "name": "UK Compliance Test",
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
  "bet": { "currency": "GBP", "base_bet": 1.0, "denominations": [0.10, 0.50, 1.0, 2.0] },
  "limits": {
    "target_rtp": 0.96,
    "rtp_tolerance": 0.0005,
    "max_win_x": 5000.0,
    "win_cap_apply": "per_spin",
    "target_volatility": "high",
    "hit_freq_target": 0.3
  },
  "compliance": {
    "jurisdictions": ["UKGC"],
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
    SlotGameIR::from_json(BASE_IR_JSON).expect("UK base IR JSON must parse")
}

// ─── Profile flag surface ────────────────────────────────────────────────────

#[test]
fn uk_profile_carries_si_2025_215_fields() {
    let p = get_profile("UKGC").expect("UKGC profile must exist");
    // Stake bands per SI 2025/215.
    assert_eq!(p.max_stake_default, Some(5.0));
    assert_eq!(p.age_tiered_stakes.len(), 2);
    assert_eq!(p.age_tiered_stakes[0].max_stake, 2.0); // 18-24
    assert_eq!(p.age_tiered_stakes[1].max_stake, 5.0); // 25+
                                                       // RTS 14D pacing.
    assert_eq!(p.min_spin_duration_ms, Some(2500));
    // Bans.
    assert!(p.prohibit_autoplay);
    assert!(p.prohibit_turbo);
    // Wagering.
    assert_eq!(p.bonus_wagering_cap_x, Some(10));
    // Provenance.
    assert_eq!(p.effective_from, Some("2025-04-09"));
    assert!(p.regulator_url.contains("gamblingcommission.gov.uk"));
}

#[test]
fn uk_profile_resolve_stake_cap_age_25_plus() {
    let p = get_profile("UKGC").unwrap();
    assert_eq!(p.resolve_stake_cap(Some(25)), Some(5.0));
    assert_eq!(p.resolve_stake_cap(Some(40)), Some(5.0));
    assert_eq!(p.resolve_stake_cap(Some(99)), Some(5.0));
}

#[test]
fn uk_profile_resolve_stake_cap_age_18_24() {
    let p = get_profile("UKGC").unwrap();
    assert_eq!(p.resolve_stake_cap(Some(18)), Some(2.0));
    assert_eq!(p.resolve_stake_cap(Some(20)), Some(2.0));
    assert_eq!(p.resolve_stake_cap(Some(24)), Some(2.0));
}

#[test]
fn uk_profile_resolve_stake_cap_no_age_returns_strictest() {
    // Without age, age-tiered profiles must return the strictest band (£2).
    let p = get_profile("UKGC").unwrap();
    assert_eq!(p.resolve_stake_cap(None), Some(2.0));
}

#[test]
fn uk_profile_resolve_stake_cap_unknown_band_is_none() {
    // Age below 18 — outside every UKGC band → None (caller MUST reject).
    let p = get_profile("UKGC").unwrap();
    assert_eq!(p.resolve_stake_cap(Some(17)), None);
}

#[test]
fn uk_profile_has_runtime_rules() {
    let p = get_profile("UKGC").unwrap();
    assert!(p.has_runtime_rules());
}

// ─── IR-level stake checker ──────────────────────────────────────────────────

#[test]
fn uk_ir_base_bet_passes_at_2_pounds() {
    let mut ir = base_ir();
    ir.bet.base_bet = 2.0;
    ir.bet.denominations = vec![0.10, 0.50, 1.0, 2.0];
    let report = validate(&ir, &["UKGC"]);
    assert!(
        report
            .violations
            .iter()
            .all(|v| v.rule_id != "UKGC-STAKE-001"),
        "base_bet £2 must not trigger STAKE-001 under conservative cap"
    );
}

#[test]
fn uk_ir_base_bet_3_pounds_flags_stake_001() {
    // Conservative cap is £2 (strictest tier) — £3 must flag.
    let mut ir = base_ir();
    ir.bet.base_bet = 3.0;
    let report = validate(&ir, &["UKGC"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-STAKE-001");
    assert!(v.is_some(), "Expected UKGC-STAKE-001 for over-cap base_bet");
    assert_eq!(v.unwrap().severity, ViolationSeverity::Error);
    assert!(v.unwrap().can_auto_fix);
}

#[test]
fn uk_ir_denominations_over_cap_flag_stake_002() {
    let mut ir = base_ir();
    ir.bet.base_bet = 1.0;
    ir.bet.denominations = vec![0.10, 1.0, 5.0, 25.0]; // £5 / £25 exceed strictest £2 cap
    let report = validate(&ir, &["UKGC"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-STAKE-002");
    assert!(
        v.is_some(),
        "Expected UKGC-STAKE-002 for over-cap denomination"
    );
    assert!(v.unwrap().can_auto_fix);
}

#[test]
fn uk_ir_negative_base_bet_flags_stake_003() {
    let mut ir = base_ir();
    ir.bet.base_bet = -1.0;
    let report = validate(&ir, &["UKGC"]);
    let v = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-STAKE-003");
    assert!(v.is_some(), "Negative base_bet must flag STAKE-003");
    assert!(!v.unwrap().can_auto_fix, "Invalid stake must not auto-fix");
}

#[test]
fn uk_ir_nan_base_bet_flags_stake_003() {
    let mut ir = base_ir();
    ir.bet.base_bet = f64::NAN;
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-STAKE-003"));
}

#[test]
fn uk_ir_auto_fix_caps_base_bet_to_strictest_band() {
    let mut ir = base_ir();
    ir.bet.base_bet = 10.0; // way over £2
    let (fixed, result) = auto_fix(&ir, &["UKGC"]);
    assert!(result
        .applied_fixes
        .iter()
        .any(|f| f.rule_id == "UKGC-STAKE-001"));
    assert!(
        (fixed.bet.base_bet - 2.0).abs() < 1e-9,
        "auto_fix must clamp base_bet to £2 (strictest), got {}",
        fixed.bet.base_bet
    );
}

#[test]
fn uk_ir_auto_fix_drops_over_cap_denominations() {
    let mut ir = base_ir();
    ir.bet.base_bet = 1.0;
    ir.bet.denominations = vec![0.10, 1.0, 5.0, 100.0];
    let (fixed, _) = auto_fix(&ir, &["UKGC"]);
    assert!(
        fixed.bet.denominations.iter().all(|d| *d <= 2.0),
        "auto_fix must drop denominations over £2: {:?}",
        fixed.bet.denominations
    );
    assert!(
        fixed.bet.denominations.contains(&1.0),
        "auto_fix must preserve legal denominations"
    );
}

// ─── Informational surface ───────────────────────────────────────────────────

#[test]
fn uk_ir_autoplay_info_emitted() {
    let ir = base_ir();
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-AUTOPLAY-001" && v.severity == ViolationSeverity::Info));
}

#[test]
fn uk_ir_turbo_info_emitted() {
    let ir = base_ir();
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-TURBO-001" && v.severity == ViolationSeverity::Info));
}

#[test]
fn uk_ir_pacing_info_emitted() {
    let ir = base_ir();
    let report = validate(&ir, &["UKGC"]);
    let p = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-PACING-001");
    assert!(p.is_some());
    assert!(p.unwrap().message.contains("2500"));
}

#[test]
fn uk_ir_wagering_info_emitted() {
    let ir = base_ir();
    let report = validate(&ir, &["UKGC"]);
    let w = report
        .violations
        .iter()
        .find(|v| v.rule_id == "UKGC-WAGERING-001");
    assert!(w.is_some());
    assert!(w.unwrap().message.contains("10x"));
}

// ─── Runtime: validate_stake ────────────────────────────────────────────────

#[test]
fn runtime_stake_25plus_5_pound_passes() {
    assert!(validate_stake("UKGC", 5.0, Some(25)).is_ok());
}

#[test]
fn runtime_stake_25plus_5_01_pound_rejected() {
    let err = validate_stake("UKGC", 5.01, Some(25)).unwrap_err();
    match err {
        ComplianceError::StakeOverCap { cap, stake, .. } => {
            assert!((cap - 5.0).abs() < 1e-9);
            assert!((stake - 5.01).abs() < 1e-9);
        }
        other => panic!("expected StakeOverCap, got {:?}", other),
    }
}

#[test]
fn runtime_stake_18_24_2_pound_passes() {
    assert!(validate_stake("UKGC", 2.0, Some(18)).is_ok());
    assert!(validate_stake("UKGC", 2.0, Some(24)).is_ok());
}

#[test]
fn runtime_stake_18_24_3_pound_rejected() {
    let err = validate_stake("UKGC", 3.0, Some(20)).unwrap_err();
    match err {
        ComplianceError::StakeOverCap { cap, .. } => assert!((cap - 2.0).abs() < 1e-9),
        other => panic!("expected StakeOverCap, got {:?}", other),
    }
}

#[test]
fn runtime_stake_no_age_in_tiered_jurisdiction_requires_age() {
    let err = validate_stake("UKGC", 1.0, None).unwrap_err();
    matches!(err, ComplianceError::AgeRequired { .. });
}

#[test]
fn runtime_stake_under_18_unknown_band_rejected() {
    let err = validate_stake("UKGC", 1.0, Some(17)).unwrap_err();
    match err {
        ComplianceError::UnknownAgeBand { age, .. } => assert_eq!(age, 17),
        other => panic!("expected UnknownAgeBand, got {:?}", other),
    }
}

#[test]
fn runtime_stake_invalid_values_rejected() {
    assert!(matches!(
        validate_stake("UKGC", 0.0, Some(25)),
        Err(ComplianceError::InvalidStake { .. })
    ));
    assert!(matches!(
        validate_stake("UKGC", -1.0, Some(25)),
        Err(ComplianceError::InvalidStake { .. })
    ));
    assert!(matches!(
        validate_stake("UKGC", f64::NAN, Some(25)),
        Err(ComplianceError::InvalidStake { .. })
    ));
    assert!(matches!(
        validate_stake("UKGC", f64::INFINITY, Some(25)),
        Err(ComplianceError::InvalidStake { .. })
    ));
}

#[test]
fn runtime_stake_unknown_jurisdiction_rejected() {
    let err = validate_stake("ZZGC", 1.0, None).unwrap_err();
    matches!(err, ComplianceError::UnknownJurisdiction { .. });
}

#[test]
fn runtime_stake_uncapped_jurisdiction_passes_any_amount() {
    // GLI19 has no stake cap.
    assert!(validate_stake("GLI19", 10_000.0, None).is_ok());
}

// ─── Runtime: pacing (RTS 14D) ──────────────────────────────────────────────

#[test]
fn runtime_pacing_under_2500ms_rejected() {
    let err = validate_spin_duration("UKGC", 2499).unwrap_err();
    match err {
        ComplianceError::SpinTooFast {
            min_ms, actual_ms, ..
        } => {
            assert_eq!(min_ms, 2500);
            assert_eq!(actual_ms, 2499);
        }
        other => panic!("expected SpinTooFast, got {:?}", other),
    }
}

#[test]
fn runtime_pacing_2500ms_exactly_passes() {
    assert!(validate_spin_duration("UKGC", 2500).is_ok());
}

#[test]
fn runtime_pacing_over_2500ms_passes() {
    assert!(validate_spin_duration("UKGC", 3000).is_ok());
}

#[test]
fn runtime_pacing_no_minimum_jurisdiction_passes_any_duration() {
    assert!(validate_spin_duration("MGA", 100).is_ok());
}

// ─── Runtime: autoplay / turbo ──────────────────────────────────────────────

#[test]
fn runtime_autoplay_rejected_in_ukgc() {
    assert!(matches!(
        validate_autoplay("UKGC"),
        Err(ComplianceError::AutoplayProhibited { .. })
    ));
}

#[test]
fn runtime_turbo_rejected_in_ukgc() {
    assert!(matches!(
        validate_turbo("UKGC"),
        Err(ComplianceError::TurboProhibited { .. })
    ));
}

#[test]
fn runtime_autoplay_allowed_in_adm_with_consent() {
    // ADM permits autoplay (2025 Technical Guidelines) provided the operator
    // gates it behind explicit consent + 20min inactivity logout. The
    // engine-level adapter doesn't enforce consent flow — that's UI.
    assert!(validate_autoplay("ADM").is_ok());
}

#[test]
fn runtime_autoplay_allowed_in_mga() {
    assert!(validate_autoplay("MGA").is_ok());
}

#[test]
fn runtime_turbo_allowed_in_adm() {
    assert!(validate_turbo("ADM").is_ok());
}

// ─── Runtime: bonus wagering ────────────────────────────────────────────────

#[test]
fn runtime_wagering_at_cap_passes() {
    assert!(validate_bonus_wagering("UKGC", 10).is_ok());
}

#[test]
fn runtime_wagering_over_cap_rejected() {
    let err = validate_bonus_wagering("UKGC", 35).unwrap_err();
    match err {
        ComplianceError::BonusWageringOverCap {
            wagering_x, cap_x, ..
        } => {
            assert_eq!(wagering_x, 35);
            assert_eq!(cap_x, 10);
        }
        other => panic!("expected BonusWageringOverCap, got {:?}", other),
    }
}

#[test]
fn runtime_wagering_no_cap_jurisdiction_passes_any() {
    assert!(validate_bonus_wagering("MGA", 100).is_ok());
}

// ─── Runtime: SpinContext aggregate ─────────────────────────────────────────

#[test]
fn runtime_spin_context_25plus_compliant_passes() {
    let ctx = SpinContext::new("UKGC", 5.0)
        .with_age(25)
        .with_duration_ms(2500);
    assert!(validate_spin(&ctx).is_ok());
}

#[test]
fn runtime_spin_context_18_24_compliant_passes() {
    let ctx = SpinContext::new("UKGC", 2.0)
        .with_age(20)
        .with_duration_ms(2500);
    assert!(validate_spin(&ctx).is_ok());
}

#[test]
fn runtime_spin_context_fails_fast_on_autoplay() {
    let ctx = SpinContext::new("UKGC", 1.0)
        .with_age(25)
        .with_duration_ms(2500)
        .with_autoplay(true);
    match validate_spin(&ctx) {
        Err(ComplianceError::AutoplayProhibited { .. }) => {}
        other => panic!("expected AutoplayProhibited, got {:?}", other),
    }
}

#[test]
fn runtime_spin_context_full_returns_all_violations() {
    let ctx = SpinContext::new("UKGC", 1000.0)
        .with_age(20) // forces £2 cap, so £1000 over-cap
        .with_duration_ms(100) // pacing fail
        .with_autoplay(true)
        .with_turbo(true);
    let errs = validate_spin_full(&ctx);
    // Should collect: autoplay, turbo, stake-over-cap, spin-too-fast.
    assert_eq!(errs.len(), 4, "expected 4 errors, got {:?}", errs);
    assert!(errs
        .iter()
        .any(|e| matches!(e, ComplianceError::AutoplayProhibited { .. })));
    assert!(errs
        .iter()
        .any(|e| matches!(e, ComplianceError::TurboProhibited { .. })));
    assert!(errs
        .iter()
        .any(|e| matches!(e, ComplianceError::StakeOverCap { .. })));
    assert!(errs
        .iter()
        .any(|e| matches!(e, ComplianceError::SpinTooFast { .. })));
}

// ─── Error serialisation (so HUD / daemon can carry them) ───────────────────

#[test]
fn compliance_error_roundtrips_through_json() {
    let err = ComplianceError::StakeOverCap {
        jurisdiction: "UKGC".to_string(),
        stake: 7.5,
        cap: 5.0,
    };
    let s = serde_json::to_string(&err).expect("serialize");
    let back: ComplianceError = serde_json::from_str(&s).expect("deserialize");
    assert_eq!(back, err);
}

#[test]
fn compliance_error_display_is_human_readable() {
    let err = ComplianceError::SpinTooFast {
        jurisdiction: "UKGC".to_string(),
        actual_ms: 1800,
        min_ms: 2500,
    };
    let msg = err.to_string();
    assert!(msg.contains("UKGC"));
    assert!(msg.contains("1800"));
    assert!(msg.contains("2500"));
}

// ─── Multi-jurisdiction interaction ─────────────────────────────────────────

#[test]
fn uk_flags_autoplay_but_adm_does_not() {
    // UKGC: blanket autoplay ban (RTS 14D). ADM: permitted with consent — no
    // blanket ban. The IR-level pipeline reflects this delta exactly.
    let ir = base_ir();
    let report = validate(&ir, &["UKGC", "ADM"]);
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.rule_id == "UKGC-AUTOPLAY-001"),
        "UKGC must emit AUTOPLAY-001 info"
    );
    assert!(
        report
            .violations
            .iter()
            .all(|v| v.rule_id != "ADM-AUTOPLAY-001"),
        "ADM must NOT emit AUTOPLAY-001 — consent-based, not banned"
    );
}

#[test]
fn uncapped_jurisdiction_emits_no_stake_violations() {
    // MGA currently has no stake cap, so a £125 base_bet must NOT flag.
    let mut ir = base_ir();
    ir.bet.base_bet = 125.0;
    let report = validate(&ir, &["MGA"]);
    assert!(report
        .violations
        .iter()
        .all(|v| !v.rule_id.starts_with("MGA-STAKE-")));
}
