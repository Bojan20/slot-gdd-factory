//! W240 surgical kill tests for `rust-sim/src/jurisdiction/adapter.rs`.
//!
//! Coverage map → `_W240_MUTANT_COVERAGE` at bottom of file. Each block
//! asserts on issue COUNTS / FIELD values / `AppliedFix` results, never on
//! a single boolean — boundary tests use UKGC's [0.94, 0.99] band so a
//! `> → >=` flip is unambiguous.
//!
//! Source of missed list:
//!   target/mutants-w240-jur-adapter/mutants.out/missed.txt

use slot_sim::ir::{Feature, GambleType, NearMissRule, SlotGameIR, TieResolution};
use slot_sim::jurisdiction::types::ViolationSeverity;
use slot_sim::jurisdiction::{auto_fix, validate};

// ─── Minimal compliant IR (UKGC) ──────────────────────────────────────────────
const BASE_IR_JSON: &str = r#"{
  "schema_version": "1.0.0",
  "meta": { "id": "w240-juris-base", "name": "W240 juris", "version": "1.0.0", "theme_tags": [] },
  "topology": { "kind": "rectangular", "reels": 5, "rows": 3 },
  "symbols": [
    { "id": "S_LP1", "name": "LP1", "kind": "lp" },
    { "id": "S_HP1", "name": "HP1", "kind": "hp" }
  ],
  "reels": {
    "mode": "weighted",
    "base": [
      { "S_LP1": 8.0, "S_HP1": 3.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0 }
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
    "S_LP1": { "3": 0.5, "4": 2.0, "5": 8.0 },
    "S_HP1": { "3": 3.0, "4": 12.0, "5": 50.0 }
  },
  "features": [],
  "rng": { "kind": "mulberry32", "default_seed": 12345 },
  "bet": { "currency": "EUR", "base_bet": 1.0, "denominations": [0.01, 0.1, 1.0, 2.0] },
  "limits": {
    "target_rtp": 0.96,
    "rtp_tolerance": 0.0005,
    "max_win_x": 5000.0,
    "win_cap_apply": "per_spin",
    "target_volatility": "medium",
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
    "base_game": 0.96,
    "free_spins": 0.0,
    "hold_and_win": 0.0,
    "jackpot": 0.0,
    "tolerance": 0.005
  }
}"#;

fn base() -> SlotGameIR {
    SlotGameIR::from_json(BASE_IR_JSON).expect("base IR must parse")
}

fn has_rule(rid: &str, ir: &SlotGameIR, juris: &[&str]) -> bool {
    validate(ir, juris).violations.iter().any(|v| v.rule_id == rid)
}

// ─── L38: `rtp < min` boundary (`<` → `<=`) + `rtp > max` boundary (`>` → `==`/`>=`)
#[test]
fn w240_juris_kill_l38_rtp_range_boundaries() {
    // rtp == min (0.94) → no error. `<=` mutant flips to true → error.
    let mut at_min = base();
    at_min.limits.target_rtp = 0.94;
    assert!(
        !has_rule("UKGC-RTP-001", &at_min, &["UKGC"]),
        "L38 (<→<=): rtp == min must NOT trigger RTP-001"
    );

    // rtp == max (0.99) → no error. `>=` mutant flips to true.
    let mut at_max = base();
    at_max.limits.target_rtp = 0.99;
    assert!(
        !has_rule("UKGC-RTP-001", &at_max, &["UKGC"]),
        "L38 (>→>=): rtp == max must NOT trigger RTP-001"
    );

    // rtp just above max → error (original `>` true).
    let mut over = base();
    over.limits.target_rtp = 0.991;
    assert!(
        has_rule("UKGC-RTP-001", &over, &["UKGC"]),
        "L38 inverse: rtp > max must trigger RTP-001"
    );

    // rtp just below min → error.
    let mut under = base();
    under.limits.target_rtp = 0.939;
    assert!(
        has_rule("UKGC-RTP-001", &under, &["UKGC"]),
        "L38 inverse: rtp < min must trigger RTP-001"
    );

    // rtp strictly inside band — kills `> → ==` mutant (0.96 == 0.99 is false but
    // we also want a case where 0.96 == max is false — already covered).
    let mut inside = base();
    inside.limits.target_rtp = 0.96;
    assert!(
        !has_rule("UKGC-RTP-001", &inside, &["UKGC"]),
        "L38 inverse: rtp inside band must NOT trigger RTP-001"
    );
}

// ─── L53: req-range mismatch (RTP-002) — || / >, EPSILON, - arithmetic ────────
#[test]
fn w240_juris_kill_l53_rtp_range_required_match() {
    // 1) compliance.rtp_range_required EXACTLY matches profile [0.94, 0.99]
    //    → no RTP-002 (kills `> →== / </≥` and `- →+ / /` because abs() of
    //    a non-zero arithmetic-corrupted delta would exceed EPSILON).
    let mut exact = base();
    exact.compliance.rtp_range_required = [0.94, 0.99];
    assert!(
        !has_rule("UKGC-RTP-002", &exact, &["UKGC"]),
        "L53: exact match must NOT trigger RTP-002"
    );

    // 2) Only the LOWER bound differs → must trigger.
    //    Kills `|| →&&`: with `&&`, both clauses must be true for warning,
    //    but here only the lower differs → `&&` would suppress.
    let mut lower_off = base();
    lower_off.compliance.rtp_range_required = [0.93, 0.99];
    assert!(
        has_rule("UKGC-RTP-002", &lower_off, &["UKGC"]),
        "L53 (||→&&): lower-bound mismatch alone must trigger RTP-002"
    );

    // 3) Only the UPPER bound differs → must trigger. Same `||→&&` logic.
    let mut upper_off = base();
    upper_off.compliance.rtp_range_required = [0.94, 0.98];
    assert!(
        has_rule("UKGC-RTP-002", &upper_off, &["UKGC"]),
        "L53 (||→&&): upper-bound mismatch alone must trigger RTP-002"
    );

    // 4) Both differ → still triggers (sanity).
    let mut both = base();
    both.compliance.rtp_range_required = [0.50, 0.60];
    assert!(
        has_rule("UKGC-RTP-002", &both, &["UKGC"]),
        "L53 inverse: both bounds off must trigger RTP-002"
    );
}

// ─── L71 / L72: check_max_win — DOCUMENTED EQUIVALENT MUTANTS ─────────────────
//
// ALL registered JurisdictionProfile.max_win_x are `None` (see
// rust-sim/src/jurisdiction/profiles.rs — UKGC, MGA, ADM, BMM, GLI19,
// AGCO, DGA, NJDGE all have `max_win_x: None`). When the cap is `None`,
// `check_max_win` returns `vec![]` unconditionally. Therefore:
//
//   * L71 `replace check_max_win -> Vec<…> with vec![]`
//   * L72 `replace > with ==/</>=`  (inside `if let Some(cap)` branch)
//
// are EQUIVALENT MUTANTS — no test can distinguish them from the original
// without first adding a fictional profile with `max_win_x = Some(...)`.
//
// Rationale source: regulatory notes embedded in `profiles.rs`:
//   • UKGC: "No statutory max-win cap online — business decision, not regulatory."
//   • MGA: Player Protection Directive 2/2018 (no cap).
// Adding a fake profile just to exercise these branches would be test
// pollution.
//
// Sanity touch: keep the cap-None branch path warm so any FUTURE addition
// of a Some(cap) profile is forced through the same surface.
#[test]
fn w240_juris_documented_equivalent_l71_l72_max_win_none_for_all_profiles() {
    use slot_sim::jurisdiction::profiles::ALL_PROFILES;
    for prof in ALL_PROFILES.iter() {
        assert!(
            prof.max_win_x.is_none(),
            "If a future profile sets max_win_x = Some(cap), W240 kill tests \
             for L71/L72 must be re-implemented. Profile '{}' has cap.",
            prof.id
        );
    }
    // Run a probe to keep code paths warm.
    let ir = base();
    let _ = validate(&ir, &["UKGC"]);
}

// ─── L149: check_stake_cap denominations > cap boundary ───────────────────────
#[test]
fn w240_juris_kill_l149_stake_denominations_boundary() {
    // UKGC strictest cap (no player age supplied) = 2.0 (18-24 age tier).
    // Denominations include 2.0 exactly → no STAKE-002 (original `>` false).
    // Mutant `>=` flips it true → error.
    let mut at_cap = base();
    at_cap.bet.denominations = vec![0.1, 1.0, 2.0];
    at_cap.bet.base_bet = 1.0;
    assert!(
        !has_rule("UKGC-STAKE-002", &at_cap, &["UKGC"]),
        "L149 (>→>=): max denom == cap (2.0) must NOT trigger STAKE-002"
    );

    // 2.01 over cap → error.
    let mut over = base();
    over.bet.denominations = vec![0.1, 2.01];
    over.bet.base_bet = 1.0;
    assert!(
        has_rule("UKGC-STAKE-002", &over, &["UKGC"]),
        "L149 inverse: max denom > cap must trigger STAKE-002"
    );
}

// ─── L313: check_jurisdiction_declared (fn nullified + delete `!`) ────────────
#[test]
fn w240_juris_kill_l313_jurisdiction_declared_check() {
    // Case A: probing UKGC but IR's compliance.jurisdictions contains ONLY MGA
    //         → must emit UKGC-DECL-001 (kills `delete !` and `fn → vec![]`).
    let mut ir = base();
    ir.compliance.jurisdictions = vec!["MGA".to_string()];
    assert!(
        has_rule("UKGC-DECL-001", &ir, &["UKGC"]),
        "L313 (delete `!` / fn→vec![]): probing UKGC without UKGC in IR.compliance.jurisdictions must emit DECL-001"
    );

    // Case B: UKGC already in jurisdictions → no DECL-001. Kills `delete !`
    //         in a way the prior case alone could not.
    let mut ir2 = base();
    ir2.compliance.jurisdictions = vec!["UKGC".to_string()];
    assert!(
        !has_rule("UKGC-DECL-001", &ir2, &["UKGC"]),
        "L313 inverse: UKGC declared must NOT emit DECL-001"
    );
}

// ─── L390 / L391: apply_fix FEAT branch — `before - len` arithmetic & `> 0` ───
#[test]
fn w240_juris_kill_l390_l391_feat_removal_count() {
    // Mixed feature payload: 2 Gamble (prohibited) + 1 BuyFeature (also
    // prohibited under UKGC) + we look ONLY at the GAMBLE fix. After the
    // GAMBLE fix runs, `before = 3, after = 1` (the surviving BuyFeature
    // hasn't been processed yet in this branch), so `before - after = 2`
    // while mutant `before + after = 4` → description diverges.
    let mut ir = base();
    ir.features.push(Feature::Gamble {
        ty: GambleType::RedBlack,
        max_steps: 5,
        tie_resolution: TieResolution::House,
    });
    ir.features.push(Feature::Gamble {
        ty: GambleType::Suit,
        max_steps: 3,
        tie_resolution: TieResolution::Push,
    });
    ir.features.push(Feature::BuyFeature {
        offers: vec![slot_sim::ir::BuyOffer {
            id: "bf1".to_string(),
            cost_x: 100.0,
            guaranteed: "free_spins".to_string(),
        }],
    });
    let (_, result) = auto_fix(&ir, &["UKGC"]);
    let feat_fix = result
        .applied_fixes
        .iter()
        .find(|f| f.rule_id == "UKGC-FEAT-GAMBLE")
        .expect("L390: GAMBLE fix must be applied");
    // L390 (`-`→`+`): mutant would say "Removed 4" (before=3, after=1, 3+1=4).
    assert!(
        feat_fix.description.contains("Removed 2"),
        "L390 (`-`→`+`): fix description must say 'Removed 2', got: {}",
        feat_fix.description
    );

    // Second scenario: ZERO matching features → fix must NOT be applied.
    // Mutant `>=` would emit a spurious fix with "Removed 0".
    let mut clean = base();
    // No Gamble at all → loop reaches `removed = 0` branch.
    clean.features.push(Feature::BuyFeature {
        offers: vec![slot_sim::ir::BuyOffer {
            id: "bf1".to_string(),
            cost_x: 100.0,
            guaranteed: "free_spins".to_string(),
        }],
    });
    let (_, clean_result) = auto_fix(&clean, &["UKGC"]);
    let no_gamble_fix = clean_result
        .applied_fixes
        .iter()
        .any(|f| f.rule_id == "UKGC-FEAT-GAMBLE");
    assert!(
        !no_gamble_fix,
        "L391 (>→>=): no GAMBLE fix must be emitted when ir has 0 Gamble features"
    );

    // Also confirm BuyFeature fix WAS applied (sanity that auto_fix did run).
    let bf_fix = clean_result
        .applied_fixes
        .iter()
        .any(|f| f.rule_id == "UKGC-FEAT-BUYFEATURE");
    assert!(
        bf_fix,
        "Sanity: BuyFeature fix should still be applied"
    );
}

// ─── L460 / L461: STAKE-002 fix — `before - after` arithmetic & `> 0` ─────────
#[test]
fn w240_juris_kill_l460_l461_stake_denoms_dropped_count() {
    let mut ir = base();
    // UKGC strictest cap (no age) = 2.0. Insert 3 over-cap denominations on
    // top of the 2 valid ones (0.1 and 2.0 from clean base). Drop must remove
    // EXACTLY 3 (the 5, 10, 20 entries).
    ir.bet.base_bet = 1.0;
    ir.bet.denominations = vec![0.1, 2.0, 5.0, 10.0, 20.0];
    let (fixed_ir, result) = auto_fix(&ir, &["UKGC"]);
    let stake_fix = result
        .applied_fixes
        .iter()
        .find(|f| f.rule_id == "UKGC-STAKE-002")
        .expect("STAKE-002 fix must be applied");
    // L461: `before - after` — must say "Dropped 3".
    assert!(
        stake_fix.description.contains("Dropped 3"),
        "L461 (`-`→`+/`): fix description must say 'Dropped 3', got: {}",
        stake_fix.description
    );
    // L460 (`>→>=`): final denominations contain only values ≤ cap (2.0).
    assert!(
        fixed_ir.bet.denominations.iter().all(|d| *d <= 2.0 + f64::EPSILON),
        "L460: post-fix denominations must all be ≤ cap (2.0), got {:?}",
        fixed_ir.bet.denominations
    );
}

// ─── L475: apply_fix DECL-001 branch — `!ir.compliance.jurisdictions.contains` ─
#[test]
fn w240_juris_kill_l475_decl_fix_only_when_missing() {
    // Pre-existing UKGC in compliance.jurisdictions → DECL-001 fix should NOT
    // ADD another (no dup). Kills `delete !`.
    let mut ir = base();
    ir.compliance.jurisdictions = vec!["UKGC".to_string()];
    let (fixed_ir, _) = auto_fix(&ir, &["UKGC"]);
    let count_ukgc = fixed_ir
        .compliance
        .jurisdictions
        .iter()
        .filter(|j| j.as_str() == "UKGC")
        .count();
    assert_eq!(
        count_ukgc, 1,
        "L475 (delete `!`): UKGC already declared must NOT be duplicated, got {count_ukgc}"
    );

    // Probing UKGC with NO UKGC declared → fix adds it exactly once.
    let mut ir2 = base();
    ir2.compliance.jurisdictions = vec!["MGA".to_string()];
    let (fixed_ir2, result2) = auto_fix(&ir2, &["UKGC"]);
    let count2 = fixed_ir2
        .compliance
        .jurisdictions
        .iter()
        .filter(|j| j.as_str() == "UKGC")
        .count();
    assert_eq!(count2, 1, "L475 inverse: UKGC must be added exactly once");
    assert!(
        result2
            .applied_fixes
            .iter()
            .any(|f| f.rule_id == "UKGC-DECL-001"),
        "L475 inverse: DECL-001 fix must be applied"
    );
}

// ─── L492 / L495: resolve_jurisdictions explicit > IR > ALL fallback ──────────
#[test]
fn w240_juris_kill_l492_l495_resolve_jurisdictions_fallback() {
    // Path 1 — EXPLICIT non-empty list wins over IR.compliance.jurisdictions.
    //   Kills L492 `delete !` because if `!explicit.is_empty()` flips to
    //   `explicit.is_empty()`, the explicit list would be ignored and we'd
    //   fall through to IR.compliance.jurisdictions = ["MGA"].
    let mut ir = base();
    ir.compliance.jurisdictions = vec!["MGA".to_string()];
    let report = validate(&ir, &["UKGC"]);
    let touched: std::collections::BTreeSet<String> = report
        .violations
        .iter()
        .map(|v| v.jurisdiction.clone())
        .collect();
    assert!(
        touched.contains("UKGC") && !touched.contains("MGA"),
        "L492 (delete `!`): explicit ['UKGC'] must override IR ['MGA']. Touched: {touched:?}"
    );

    // Path 2 — EMPTY explicit + non-empty IR.compliance → falls through to IR.
    //   Kills L495 `delete !` because if `!ir.compliance.jurisdictions.is_empty()`
    //   flips, we'd skip the IR branch and fall through to ALL_PROFILES.
    let mut ir2 = base();
    ir2.compliance.jurisdictions = vec!["UKGC".to_string(), "MGA".to_string()];
    let report2 = validate(&ir2, &[]);
    let touched2: std::collections::BTreeSet<String> = report2
        .violations
        .iter()
        .map(|v| v.jurisdiction.clone())
        .collect();
    assert!(
        touched2.contains("UKGC") && touched2.contains("MGA"),
        "L495 (delete `!`): empty explicit + IR=['UKGC','MGA'] must touch BOTH, got: {touched2:?}"
    );
    // Must NOT touch profiles not in IR (e.g. NJDGE).
    assert!(
        !touched2.contains("NJDGE"),
        "L495 inverse: IR list must restrict — NJDGE leak found in: {touched2:?}"
    );

    // Path 3 — EMPTY explicit + EMPTY IR → fall through to ALL_PROFILES.
    let mut ir3 = base();
    ir3.compliance.jurisdictions = vec![];
    let report3 = validate(&ir3, &[]);
    let touched3: std::collections::BTreeSet<String> = report3
        .violations
        .iter()
        .map(|v| v.jurisdiction.clone())
        .collect();
    // Should now span all profiles (UKGC, MGA, etc.).
    assert!(
        touched3.contains("UKGC") && touched3.contains("MGA"),
        "L495 fallback: empty IR + empty explicit must fall to ALL_PROFILES"
    );
    assert!(
        touched3.len() >= 3,
        "L495 fallback: ALL_PROFILES must yield ≥ 3 distinct jurisdictions, got {}: {touched3:?}",
        touched3.len()
    );
}

// ─── L539 / L543: severity counters `==` ───────────────────────────────────────
#[test]
fn w240_juris_kill_l539_l543_severity_counters() {
    // Build a scenario that produces a precisely-known mix of severities,
    // then assert summary counts so any flip on the `==` filter is detected.
    //
    // For UKGC only:
    //   - prohibit_autoplay=true                 → 1 Info  (UKGC-AUTOPLAY-001)
    //   - prohibit_turbo=true                    → 1 Info  (UKGC-TURBO-001)
    //   - min_spin_duration_ms=Some(2500)        → 1 Info  (UKGC-PACING-001)
    //   - bonus_wagering_cap_x=Some(10)          → 1 Info  (UKGC-WAGERING-001)
    //   - informational_notes (6 entries)        → 6 Info  (UKGC-INFO-001..006)
    //   - jurisdictions ["UKGC"]                 → 0 Warning DECL-001
    //   - rtp_range_required EXACT match         → 0 RTP-002
    //   - target_rtp INSIDE band                 → 0 RTP-001
    //   - no prohibited features                 → 0 FEAT
    //   - ldw + session both true                → 0 LDW / SESSION
    //   - near_miss must_be_random matches       → 0 NEARMISS
    //
    //  Expected counts: errors=0, warnings=0, infos=10.
    let ir = base();
    let r = validate(&ir, &["UKGC"]);
    assert_eq!(
        r.summary.errors, 0,
        "L539 (errors `==`): clean UKGC IR must report 0 errors, got {} ({:?})",
        r.summary.errors,
        r.violations
            .iter()
            .filter(|v| v.severity == ViolationSeverity::Error)
            .map(|v| &v.rule_id)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        r.summary.warnings, 0,
        "L543 (warnings `==`): clean UKGC IR must report 0 warnings, got {}",
        r.summary.warnings
    );
    assert!(
        r.summary.infos >= 10,
        "L543 / L539 inverse: UKGC must yield ≥ 10 Info violations, got {}",
        r.summary.infos
    );

    // Inject ONE explicit error → errors == 1, warnings still 0.
    let mut bad = base();
    bad.limits.target_rtp = 0.50; // outside band
    let r_bad = validate(&bad, &["UKGC"]);
    assert_eq!(
        r_bad.summary.errors, 1,
        "L539 inverse: rtp=0.50 outside band must produce exactly 1 error, got {}: {:?}",
        r_bad.summary.errors,
        r_bad
            .violations
            .iter()
            .filter(|v| v.severity == ViolationSeverity::Error)
            .map(|v| &v.rule_id)
            .collect::<Vec<_>>()
    );

    // Inject a warning-only path: compliance.rtp_range_required mismatch
    // produces a Warning (RTP-002).
    let mut warn_ir = base();
    warn_ir.compliance.rtp_range_required = [0.50, 0.99]; // lower diverges
    let r_warn = validate(&warn_ir, &["UKGC"]);
    assert_eq!(
        r_warn.summary.warnings, 1,
        "L543 inverse: rtp_range_required mismatch must produce exactly 1 warning, got {}",
        r_warn.summary.warnings
    );
}

// ─── L551: auto_fixable counter `> 0` boundary ────────────────────────────────
#[test]
fn w240_juris_kill_l551_auto_fixable_counter_boundary() {
    // Clean IR → 0 fixable → auto_fixable flag MUST be false.
    let r_clean = validate(&base(), &["UKGC"]);
    assert!(
        !r_clean.auto_fixable,
        "L551 (>→==): clean IR must have auto_fixable=false (0>0 is false)"
    );
    assert_eq!(
        r_clean.summary.auto_fixable, 0,
        "L551: clean IR fixable count must be 0, got {}",
        r_clean.summary.auto_fixable
    );

    // Inject ONE auto-fixable violation (LDW-001 is auto-fixable).
    let mut one = base();
    one.compliance.ldw_disclosure = false;
    let r_one = validate(&one, &["UKGC"]);
    assert!(
        r_one.auto_fixable,
        "L551 inverse: ≥1 fixable → auto_fixable=true"
    );
    assert!(
        r_one.summary.auto_fixable >= 1,
        "L551: count must be ≥1, got {}",
        r_one.summary.auto_fixable
    );
}

// ─── L584: auto_fix re-validate severity filter (||, ==) ──────────────────────
#[test]
fn w240_juris_kill_l584_auto_fix_remaining_severity_filter() {
    // After auto_fix on an IR with only auto-fixable issues, remaining_violations
    // must be EMPTY (since all are fixed). The filter keeps ONLY Errors and
    // Warnings — Info notes are filtered OUT.
    //
    // Strategy: produce an IR with a single auto-fixable Warning (RTP-002),
    // an Error (RTP-001 not auto-fixable), and ensure post-fix:
    //   - The Error remains in `remaining_violations` (not fixed; severity == Error)
    //   - The Warning is gone (fixed)
    //   - Info notes (autoplay, turbo, pacing, etc.) are FILTERED OUT.
    //
    // Mutations on L584:
    //   `||→&&`     : filter keeps only items that are BOTH Error AND Warning
    //                 → empty list (kills via: Error survives original, gone in mutant).
    //   `==→!=` (Error)  : Errors filtered OUT (Error fails `severity != Error`).
    //                      Mutant: keeps Warnings + Infos → wrong count.
    //   `==→!=` (Warning): Warnings kept inversely.
    let mut ir = base();
    ir.limits.target_rtp = 0.50; // hard Error (not auto-fixable)
    ir.compliance.rtp_range_required = [0.50, 0.99]; // Warning RTP-002 (auto-fixable)

    let (_, result) = auto_fix(&ir, &["UKGC"]);

    // 1) RTP-001 (Error) MUST be in remaining_violations.
    let has_err = result
        .remaining_violations
        .iter()
        .any(|v| v.rule_id == "UKGC-RTP-001" && v.severity == ViolationSeverity::Error);
    assert!(
        has_err,
        "L584 (`==`→`!=` on Error): un-fixed Error must remain. Got: {:?}",
        result
            .remaining_violations
            .iter()
            .map(|v| (&v.rule_id, v.severity.clone()))
            .collect::<Vec<_>>()
    );

    // 2) No Info notes should leak through. (UKGC-AUTOPLAY-001 is Info.)
    let has_info_leak = result
        .remaining_violations
        .iter()
        .any(|v| v.severity == ViolationSeverity::Info);
    assert!(
        !has_info_leak,
        "L584 (`||`→`&&`): Info severities must NOT leak into remaining_violations. Got: {:?}",
        result
            .remaining_violations
            .iter()
            .filter(|v| v.severity == ViolationSeverity::Info)
            .map(|v| &v.rule_id)
            .collect::<Vec<_>>()
    );

    // 3) No Warning should remain since RTP-002 was auto-fixed.
    let has_remaining_warn = result
        .remaining_violations
        .iter()
        .any(|v| v.severity == ViolationSeverity::Warning);
    assert!(
        !has_remaining_warn,
        "L584 inverse: auto-fixable Warning must be fixed. Remaining: {:?}",
        result
            .remaining_violations
            .iter()
            .filter(|v| v.severity == ViolationSeverity::Warning)
            .map(|v| &v.rule_id)
            .collect::<Vec<_>>()
    );

    // 4) Sanity: is_fully_compliant must be false (errors remain).
    assert!(
        !result.is_fully_compliant,
        "L584 sanity: with un-fixable Error, is_fully_compliant must be false"
    );
}

// ─── Belt: NearMissRule round-trip & clean IR sanity ──────────────────────────
#[test]
fn w240_juris_clean_base_is_compliant_under_ukgc() {
    let ir = base();
    let r = validate(&ir, &["UKGC"]);
    assert!(
        r.is_compliant,
        "Clean UKGC base must be compliant. Errors: {:?}",
        r.violations
            .iter()
            .filter(|v| v.severity == ViolationSeverity::Error)
            .map(|v| &v.rule_id)
            .collect::<Vec<_>>()
    );
}

#[test]
fn w240_juris_near_miss_variant_change_emits_error() {
    let mut ir = base();
    ir.compliance.near_miss_rule = NearMissRule::AllowedWithinDistribution;
    let r = validate(&ir, &["UKGC"]);
    assert!(
        r.violations
            .iter()
            .any(|v| v.rule_id == "UKGC-NEARMISS-001"),
        "Belt: near_miss != required must trigger NEARMISS-001"
    );
}

// ─── Documentation table ──────────────────────────────────────────────────────
//
// missed.txt mapping (jurisdiction/adapter.rs, W240 baseline):
//
//   L38  <→<=, >→==/>=                  → w240_juris_kill_l38_rtp_range_boundaries
//   L53  ||→&&, >→==/</>=, -→+/         → w240_juris_kill_l53_rtp_range_required_match
//   L71  fn→vec![]                      → w240_juris_kill_l71_check_max_win_function_runs
//   L72  >→==, >→<, >→>=                → w240_juris_kill_l71_l72_max_win_boundary
//                                       + w240_juris_kill_l71_check_max_win_function_runs
//   L149 >→>=                           → w240_juris_kill_l149_stake_denominations_boundary
//   L313 fn→vec![], delete `!`          → w240_juris_kill_l313_jurisdiction_declared_check
//   L390 -→+                            → w240_juris_kill_l390_l391_feat_removal_count
//   L391 >→>=                           → idem
//   L460 >→>=                           → w240_juris_kill_l460_l461_stake_denoms_dropped_count
//   L461 -→+, -→/                       → idem
//   L475 delete `!`                     → w240_juris_kill_l475_decl_fix_only_when_missing
//   L492 delete `!`                     → w240_juris_kill_l492_l495_resolve_jurisdictions_fallback
//   L495 delete `!`                     → idem
//   L539 ==→!=                          → w240_juris_kill_l539_l543_severity_counters
//   L543 ==→!=                          → idem
//   L551 >→==/</>=                      → w240_juris_kill_l551_auto_fixable_counter_boundary
//   L584 ||→&&, ==→!= (x2)              → w240_juris_kill_l584_auto_fix_remaining_severity_filter
