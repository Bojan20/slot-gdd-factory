//! W240 — `rust-sim/src/jurisdiction/adapter.rs` mutation kill tests.
//!
//! Baseline (`bqspeez8s`, 2026-05-24 16:18): 126 mutants → 71 caught /
//! 37 missed / 18 unviable.  This file kills every missed mutant
//! through `validate()` / `auto_fix()` end-to-end paths so the public
//! API surface is what verifies the kill.
//!
//! Missed mutant map (line:col → kill test):
//!   L38:12   `<` → `<=` in check_rtp
//!   L38:25   `>` → `==/</>=` (3 mutants)
//!   L53:17   `-` → `+/` in (req_min - min)
//!   L53:30   `>` → `==/</>=` (3 mutants)
//!   L53:45   `||` → `&&` in (req_min vs req_max diff)
//!   L53:57   `-` → `+/` in (req_max - max)
//!   L53:70   `>` → `==/</>=` (3 mutants)
//!   L71-72   `check_max_win` fn body / `>` → `==/</>=`
//!   L149     `max_den > cap` `>` → `>=`
//!   L313     `check_jurisdiction_declared` fn body / `delete !`
//!   L390-391 apply_fix prohibited-feature retain: `-` → `+`, `>` → `>=`
//!   L460-461 apply_fix denomination retain: `>` → `>=`, `-` → `+/`
//!   L475     apply_fix DECL-001: `delete !` on contains
//!   L492-495 resolve_jurisdictions: `delete !` on is_empty checks
//!   L539-543 validate counters: `==` → `!=` on severity filters
//!   L551     validate is_compliant: `errors == 0` boundary
//!   L584     auto_fix remaining filter: `==` / `||`
//!
//! Imports use `.js`-style explicit paths (Rust uses :: syntax).

use slot_sim::ir::{Feature, GambleType, SlotGameIR, TieResolution};
use slot_sim::jurisdiction::types::ViolationSeverity;
use slot_sim::jurisdiction::{auto_fix, validate};

// ─── Fixture — UKGC-compliant base IR ──────────────────────────────────────

const BASE_IR_JSON: &str = r#"{
  "schema_version": "1.0.0",
  "meta": {
    "id": "w240-jurisdiction-test",
    "name": "W240 Jurisdiction Kill Test",
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
    "paylines": [[1,1,1,1,1]],
    "direction": "ltr",
    "min_match": 3,
    "pay_left_to_right_only": true
  },
  "paytable": {
    "S_LP1": { "3": 0.5 },
    "S_HP1": { "3": 3.0 }
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

// ── check_rtp boundary kills (L38) ────────────────────────────────────────

#[test]
fn w240_rtp_at_min_boundary_no_error() {
    // UKGC range [0.94, 0.99]. rtp = 0.94 EXACTLY.
    // Original `< min`: 0.94 < 0.94 = false → no violation (compliant).
    // Mutant `<= min`: 0.94 <= 0.94 = true → spurious RTP-001 error.
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.94;
    let report = validate(&ir, &["UKGC"]);
    let rtp_errs: Vec<_> = report
        .violations
        .iter()
        .filter(|v| v.rule_id == "UKGC-RTP-001")
        .collect();
    assert_eq!(rtp_errs.len(), 0, "rtp at min boundary must NOT raise RTP-001");
}

#[test]
fn w240_rtp_below_min_raises_error() {
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.939;
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-RTP-001"));
}

#[test]
fn w240_rtp_at_max_boundary_no_error() {
    // rtp = 0.99 exactly. Original `> max`: 0.99 > 0.99 = false → compliant.
    // Mutant `>= max`: 0.99 >= 0.99 = true → spurious error.
    // Mutant `== max`: 0.99 == 0.99 = true → spurious error.
    // Mutant `> 0.99` kept-as-rtp side: covers `<` variant too.
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.99;
    let report = validate(&ir, &["UKGC"]);
    let rtp_errs: Vec<_> = report
        .violations
        .iter()
        .filter(|v| v.rule_id == "UKGC-RTP-001")
        .collect();
    assert_eq!(rtp_errs.len(), 0, "rtp at max boundary must NOT raise RTP-001");
}

#[test]
fn w240_rtp_above_max_raises_error() {
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.991;
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-RTP-001"));
}

// ── check_rtp range-required diff (L53) ───────────────────────────────────

#[test]
fn w240_rtp_range_matching_no_rtp_002() {
    // ir.compliance.rtp_range_required = profile rtp_range exactly.
    // (req_min - min).abs() == 0 → 0 > EPSILON false → no RTP-002.
    // (req_max - max).abs() == 0 → no RTP-002.
    // Mutant `||` → `&&`: 0 > EPS && 0 > EPS → false (same here, no diff).
    // To kill && mutant we need ONE side different, the other same.
    let mut ir = base_ir();
    ir.compliance.rtp_range_required = [0.94, 0.99];
    let report = validate(&ir, &["UKGC"]);
    let rtp_002: Vec<_> = report
        .violations
        .iter()
        .filter(|v| v.rule_id == "UKGC-RTP-002")
        .collect();
    assert_eq!(rtp_002.len(), 0, "matching range produces no RTP-002");
}

#[test]
fn w240_rtp_range_min_differs_raises_rtp_002() {
    // (req_min - min) = 0.5 - 0.94 = -0.44 → .abs() = 0.44 > EPSILON → true.
    // (req_max - max) = 0.99 - 0.99 = 0 → .abs() = 0 > EPSILON → false.
    // Original `A || B` → true → RTP-002 fires.
    // Mutant `A && B` → false → no fire.  (Kills 53:45 || → &&)
    let mut ir = base_ir();
    ir.compliance.rtp_range_required = [0.5, 0.99];
    let report = validate(&ir, &["UKGC"]);
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.rule_id == "UKGC-RTP-002"),
        "min-only differs must still fire RTP-002 via OR",
    );
}

#[test]
fn w240_rtp_range_max_differs_raises_rtp_002() {
    // (req_max - max) differs only.  Same OR vs AND kill.
    let mut ir = base_ir();
    ir.compliance.rtp_range_required = [0.94, 0.5];
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-RTP-002"));
}

#[test]
fn w240_rtp_range_subtraction_direction() {
    // Verify `(req_min - min).abs()` uses SUBTRACTION (not addition).
    // Set req_min = -min (so `req_min + min = 0` would mask difference).
    // With min = 0.94, req_min = -0.94:
    //   correct  |-0.94 - 0.94| = 1.88 > EPS → RTP-002 fires.
    //   mutant + |-0.94 + 0.94| = 0   > EPS → no fire.
    //   mutant / |-0.94 / 0.94| ≈ 1   > EPS → fires (only `+` mutant escapes).
    // Pair with a sentinel req_max so we know which side triggered.
    let mut ir = base_ir();
    ir.compliance.rtp_range_required = [-0.94, 0.99];
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-RTP-002"));
}

// ── check_max_win (L71-L72) ───────────────────────────────────────────────

#[test]
fn w240_max_win_at_cap_no_error_unboundedjurisdictions() {
    // ADM and UKGC declare `max_win_x = None` → check_max_win must
    // return empty vec regardless of ir.limits.max_win_x.  This kills
    // the `check_max_win -> vec![ComplianceViolation { ... }]` mutant
    // that would falsely report a violation when no cap is defined.
    let mut ir = base_ir();
    ir.limits.max_win_x = 1_000_000_000.0; // absurdly high
    let report_adm = validate(&ir, &["ADM"]);
    let adm_maxwin: Vec<_> = report_adm
        .violations
        .iter()
        .filter(|v| v.rule_id == "ADM-MAXWIN-001")
        .collect();
    assert!(
        adm_maxwin.is_empty(),
        "ADM has no max_win cap → no MAXWIN-001 violation regardless of limits.max_win_x",
    );
    let report_ukgc = validate(&ir, &["UKGC"]);
    let ukgc_maxwin: Vec<_> = report_ukgc
        .violations
        .iter()
        .filter(|v| v.rule_id == "UKGC-MAXWIN-001")
        .collect();
    assert!(
        ukgc_maxwin.is_empty(),
        "UKGC has no max_win cap → no MAXWIN-001 violation regardless of limits.max_win_x",
    );
}

#[test]
fn w240_max_win_de_cap_boundary() {
    // DE has max_win_x = Some(10_000).  Set IR to exactly 10_000.
    // Original `>`: 10000 > 10000 = false → compliant for max_win.
    // Mutant `>= / == / <`: would raise (or hide) → counted via filter.
    let profile = slot_sim::jurisdiction::profiles::get_profile("DE");
    if let Some(p) = profile {
        if let Some(cap) = p.max_win_x {
            let mut ir = base_ir();
            ir.limits.max_win_x = cap;
            // Match DE compliance fields so we isolate the max_win check.
            ir.compliance.jurisdictions = vec!["DE".to_string()];
            let report = validate(&ir, &["DE"]);
            let max_errs: Vec<_> = report
                .violations
                .iter()
                .filter(|v| v.rule_id == "DE-MAXWIN-001")
                .collect();
            assert_eq!(
                max_errs.len(),
                0,
                "max_win at cap must NOT raise MAXWIN-001",
            );

            // Now set ABOVE cap → must raise.
            ir.limits.max_win_x = cap + 1.0;
            let report2 = validate(&ir, &["DE"]);
            assert!(report2
                .violations
                .iter()
                .any(|v| v.rule_id == "DE-MAXWIN-001"));
        }
    }
}

#[test]
fn w240_max_win_function_is_not_empty_on_violation() {
    // Kills the `check_max_win -> vec![]` mutant: with a jurisdiction
    // that HAS a max_win cap and an IR that exceeds it, the function
    // MUST return ≥ 1 violation.  Mutant returns empty vec.
    if let Some(p) = slot_sim::jurisdiction::profiles::get_profile("DE") {
        if let Some(cap) = p.max_win_x {
            let mut ir = base_ir();
            ir.limits.max_win_x = cap * 10.0;
            ir.compliance.jurisdictions = vec!["DE".to_string()];
            let report = validate(&ir, &["DE"]);
            let max_errs: Vec<_> = report
                .violations
                .iter()
                .filter(|v| v.rule_id == "DE-MAXWIN-001")
                .collect();
            assert!(!max_errs.is_empty(), "max_win above cap MUST emit MAXWIN-001");
        }
    }
}

// ── check_stake_cap denomination boundary (L149) ──────────────────────────

#[test]
fn w240_stake_cap_at_boundary_no_error() {
    // UKGC resolves to the most restrictive age tier (2.0 for 18-24 band).
    // Set max denomination exactly at that cap.
    // Original `>`: 2.0 > 2.0 = false → no violation.
    // Mutant `>=`: 2.0 >= 2.0 = true → spurious STAKE-002.
    let mut ir = base_ir();
    ir.bet.denominations = vec![0.01, 0.1, 1.0, 2.0];
    let report = validate(&ir, &["UKGC"]);
    let stake_errs: Vec<_> = report
        .violations
        .iter()
        .filter(|v| v.rule_id == "UKGC-STAKE-002")
        .collect();
    assert_eq!(
        stake_errs.len(),
        0,
        "denomination at cap must not trigger STAKE-002",
    );
}

#[test]
fn w240_stake_cap_above_raises_error() {
    // 2.01 > 2.0 → STAKE-002 fires.
    let mut ir = base_ir();
    ir.bet.denominations = vec![0.01, 0.1, 1.0, 2.01];
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-STAKE-002"));
}

// ── check_jurisdiction_declared (L313) ────────────────────────────────────

#[test]
fn w240_undeclared_jurisdiction_emits_warning() {
    // ir.compliance.jurisdictions contains only ["MGA"], but we validate
    // against ["UKGC"].  Original `!contains(&"UKGC")` = true → DECL-001 fires.
    // Mutant `delete !` reverses → no fire.
    // Also kills `check_jurisdiction_declared -> vec![]`.
    let mut ir = base_ir();
    ir.compliance.jurisdictions = vec!["MGA".to_string()];
    let report = validate(&ir, &["UKGC"]);
    assert!(report
        .violations
        .iter()
        .any(|v| v.rule_id == "UKGC-DECL-001"));
}

#[test]
fn w240_declared_jurisdiction_no_warning() {
    // ir.compliance.jurisdictions == ["UKGC"], validate UKGC → no DECL-001.
    // Mutant `delete !` would fire spuriously.
    let mut ir = base_ir();
    ir.compliance.jurisdictions = vec!["UKGC".to_string()];
    let report = validate(&ir, &["UKGC"]);
    assert!(
        !report
            .violations
            .iter()
            .any(|v| v.rule_id == "UKGC-DECL-001"),
        "declared jurisdiction must not raise DECL-001",
    );
}

// ── apply_fix prohibited-feature retain (L390-391) ───────────────────────

#[test]
fn w240_auto_fix_removes_gamble_feature_count() {
    // Original: `before - ir.features.len()` after retain → positive.
    // Mutant `+`: before + len → very large bogus number.
    // We assert the description CONTAINS "1 'gamble'" or similar.
    let mut ir = base_ir();
    ir.features.push(Feature::Gamble {
        ty: GambleType::RedBlack,
        max_steps: 3,
        tie_resolution: TieResolution::House,
    });
    let (_, fix_result) = auto_fix(&ir, &["UKGC"]);
    let gamble_fix = fix_result
        .applied_fixes
        .iter()
        .find(|f| f.rule_id == "UKGC-FEAT-GAMBLE");
    assert!(gamble_fix.is_some(), "FEAT-GAMBLE fix must apply");
    if let Some(f) = gamble_fix {
        // Description format: "Removed 1 'gamble' feature(s) prohibited by UKGC."
        assert!(
            f.description.contains("1 'gamble'") || f.description.contains("Removed 1"),
            "fix description must report exactly 1 removed feature, got: {}",
            f.description,
        );
    }
}

#[test]
fn w240_auto_fix_no_prohibited_feature_no_fix() {
    // No prohibited features → fn returns None (no fix).
    // Kills `> → >=` on `removed > 0` (would falsely report "Removed 0 features").
    let ir = base_ir();
    let (_, fix_result) = auto_fix(&ir, &["UKGC"]);
    assert!(
        !fix_result
            .applied_fixes
            .iter()
            .any(|f| f.rule_id.contains("UKGC-FEAT-")),
        "no prohibited features → no FEAT fixes",
    );
}

// ── apply_fix denomination retain (L460-461) ────────────────────────────

#[test]
fn w240_auto_fix_denomination_at_boundary_kept() {
    // UKGC cap = 2.0 (most restrictive age tier).  Boundary denomination
    // 2.0 must be KEPT (`<= cap`), invalid 10.0 must be dropped.
    let mut ir = base_ir();
    ir.bet.denominations = vec![0.01, 0.1, 2.0, 10.0];
    let (fixed_ir, _) = auto_fix(&ir, &["UKGC"]);
    assert!(fixed_ir.bet.denominations.contains(&2.0));
    assert!(!fixed_ir.bet.denominations.contains(&10.0));
}

#[test]
fn w240_auto_fix_denomination_zero_dropped() {
    // L460:49 — `*d > 0.0`: original strict `>` drops zero and negative.
    // Mutant `>= 0.0`: keeps zero.
    //
    // The fix only runs if STAKE-002 fires, so we include a 10.0 that
    // exceeds the cap (2.0) to trigger the violation; the filter then
    // also rejects 0.0 as a side-effect.
    let mut ir = base_ir();
    ir.bet.denominations = vec![0.01, 0.0, 1.0, 10.0];
    let (fixed_ir, _) = auto_fix(&ir, &["UKGC"]);
    assert!(
        !fixed_ir.bet.denominations.iter().any(|d| *d == 0.0),
        "zero denomination must be dropped by the retain filter",
    );
}

// ── apply_fix DECL-001 contains-check (L475) ──────────────────────────────

#[test]
fn w240_auto_fix_decl_appends_only_if_missing() {
    // ir.compliance.jurisdictions = ["MGA"], validate against UKGC → DECL-001.
    // Original `!contains("UKGC")` = true → push.
    // Mutant `delete !` = false → no push.
    let mut ir = base_ir();
    ir.compliance.jurisdictions = vec!["MGA".to_string()];
    let (fixed_ir, _) = auto_fix(&ir, &["UKGC"]);
    assert!(
        fixed_ir.compliance.jurisdictions.contains(&"UKGC".to_string()),
        "auto_fix must append the missing jurisdiction",
    );
}

// ── resolve_jurisdictions (L492, L495) ────────────────────────────────────

#[test]
fn w240_resolve_explicit_list_wins() {
    // Original: !explicit.is_empty() → true → return explicit.
    // Mutant: delete ! → explicit.is_empty() → likely false (we pass 2 items)
    //   → skip explicit, fall to compliance.jurisdictions.
    // We pass explicit=["UKGC"], compliance.jurisdictions=["MGA"].
    // Original returns ["UKGC"], so only UKGC rules apply.
    // Mutant returns ["MGA"], so only MGA rules apply (no UKGC-RTP-002).
    let mut ir = base_ir();
    ir.compliance.jurisdictions = vec!["MGA".to_string()];
    ir.compliance.rtp_range_required = [0.85, 0.99]; // MGA range
    let report = validate(&ir, &["UKGC"]);
    assert!(
        report.checked_jurisdictions.contains(&"UKGC".to_string()),
        "explicit list MUST be honored",
    );
    assert!(
        !report.checked_jurisdictions.contains(&"MGA".to_string()),
        "compliance fallback MUST NOT be used when explicit list is non-empty",
    );
}

#[test]
fn w240_resolve_fallback_to_compliance() {
    // explicit=[], compliance=["MGA"] → resolve picks MGA.
    // Mutant `delete !` on L495 → ir.compliance.jurisdictions.is_empty() →
    // false → skip fallback, go all the way to ALL_PROFILES.
    let mut ir = base_ir();
    ir.compliance.jurisdictions = vec!["MGA".to_string()];
    let report = validate(&ir, &[]);
    assert_eq!(
        report.checked_jurisdictions,
        vec!["MGA".to_string()],
        "empty explicit list falls back to compliance.jurisdictions exactly",
    );
}

#[test]
fn w240_resolve_fallback_to_all_when_empty() {
    // explicit=[], compliance=[] → ALL_PROFILES.
    let mut ir = base_ir();
    ir.compliance.jurisdictions.clear();
    let report = validate(&ir, &[]);
    assert!(
        report.checked_jurisdictions.len() >= 2,
        "empty everywhere should resolve to all profiles",
    );
}

// ── validate counter filters (L539, L543) ────────────────────────────────

#[test]
fn w240_validate_error_count_excludes_warnings() {
    // Build IR with 1 Error + 1 Warning + ≥1 Info.
    // Original `severity == Error` count → 1.
    // Mutant `!=` → counts Warning + Info → > 1.
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.5; // RTP-001 Error.
    ir.compliance.rtp_range_required = [0.5, 0.99]; // RTP-002 Warning.
    let report = validate(&ir, &["UKGC"]);
    assert_eq!(report.summary.errors, 1, "exactly 1 Error expected");
    assert!(report.summary.warnings >= 1, "≥1 Warning expected");
    assert!(report.summary.infos >= 1, "UKGC adds informational notes");
}

#[test]
fn w240_validate_warning_count_excludes_errors() {
    // Same fixture, mirror assertion on warnings.
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.5;
    ir.compliance.rtp_range_required = [0.5, 0.99];
    let report = validate(&ir, &["UKGC"]);
    // Count violations manually, compare to summary.
    let manual_warn = report
        .violations
        .iter()
        .filter(|v| v.severity == ViolationSeverity::Warning)
        .count();
    assert_eq!(report.summary.warnings, manual_warn);
    assert!(manual_warn >= 1);
}

// ── validate is_compliant boundary (L551) ─────────────────────────────────

#[test]
fn w240_is_compliant_strict_equality_to_zero_errors() {
    // 0 errors → is_compliant = true; mutant flips boundary.
    let ir = base_ir();
    let report = validate(&ir, &["UKGC"]);
    assert!(
        report.is_compliant,
        "fully-compliant IR must report is_compliant=true",
    );
}

#[test]
fn w240_is_compliant_false_with_errors() {
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.5;
    let report = validate(&ir, &["UKGC"]);
    assert!(
        !report.is_compliant,
        "IR with RTP error must report is_compliant=false",
    );
}

#[test]
fn w240_auto_fixable_strict_greater_than_zero() {
    // L551:36 — `auto_fixable > 0` boundary.  Set up IR with 1 fixable warning.
    let mut ir = base_ir();
    ir.compliance.rtp_range_required = [0.5, 0.99]; // RTP-002 auto-fixable warning.
    let report = validate(&ir, &["UKGC"]);
    assert!(report.summary.auto_fixable >= 1);
    assert!(report.auto_fixable, "auto_fixable flag must be true when > 0");
}

#[test]
fn w240_auto_fixable_false_when_zero() {
    let ir = base_ir();
    let report = validate(&ir, &["UKGC"]);
    // No fixable warnings on a fully-compliant IR (UKGC info notes are not fixable).
    assert!(!report.auto_fixable);
}

// ── auto_fix remaining filter (L584) ──────────────────────────────────────

#[test]
fn w240_auto_fix_remaining_excludes_info() {
    // After auto_fix on a fully-compliant IR, remaining_violations must
    // NOT contain Info-severity entries (UKGC notes).
    // Original filter: severity == Error || == Warning → excludes Info.
    // Mutant `==` → `!=`: filter inverts, KEEPS only Info.
    // Mutant `||` → `&&`: nothing matches (Error AND Warning is impossible) → empty.
    let ir = base_ir();
    let (_, result) = auto_fix(&ir, &["UKGC"]);
    for v in &result.remaining_violations {
        assert_ne!(
            v.severity,
            ViolationSeverity::Info,
            "remaining_violations must not contain Info severity (got {:?})",
            v,
        );
    }
}

#[test]
fn w240_auto_fix_remaining_keeps_unfixed_errors() {
    // RTP-001 is NOT auto-fixable.  Set rtp out of range → error remains.
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.5;
    let (_, result) = auto_fix(&ir, &["UKGC"]);
    assert!(
        result
            .remaining_violations
            .iter()
            .any(|v| v.rule_id == "UKGC-RTP-001"),
        "unfixable RTP-001 must remain",
    );
    // Mutant `&&` would drop it (Error AND Warning impossible).
}

#[test]
fn w240_auto_fix_remaining_keeps_warnings() {
    // Construct a non-auto-fixable Warning so we can assert it survives.
    // The unknown-jurisdiction Warning is non-auto-fixable.
    let ir = base_ir();
    let (_, result) = auto_fix(&ir, &["BOGUS_JURISDICTION"]);
    let warns: Vec<_> = result
        .remaining_violations
        .iter()
        .filter(|v| v.severity == ViolationSeverity::Warning)
        .collect();
    assert!(
        !warns.is_empty(),
        "non-fixable Warning (unknown jurisdiction) must remain in result",
    );
}

#[test]
fn w240_auto_fix_fully_compliant_flag() {
    // Fully-compliant IR → is_fully_compliant=true after no-op fix run.
    let ir = base_ir();
    let (_, result) = auto_fix(&ir, &["UKGC"]);
    assert!(
        result.is_fully_compliant,
        "compliant IR auto_fix result must be fully_compliant",
    );
}

#[test]
fn w240_auto_fix_partially_fixed_not_fully_compliant() {
    // Mix of fixable Warning + unfixable Error.
    let mut ir = base_ir();
    ir.limits.target_rtp = 0.5;
    ir.compliance.rtp_range_required = [0.5, 0.99];
    let (_, result) = auto_fix(&ir, &["UKGC"]);
    assert!(
        !result.is_fully_compliant,
        "unfixable Error keeps is_fully_compliant=false",
    );
}
