//! W240 surgical kill tests for `rust-sim/src/ir/validate.rs`.
//!
//! Each test ships a minimal `SlotGameIR` that targets ONE arithmetic /
//! boundary / match-arm mutation surfaced by `cargo mutants` baseline. Tests
//! assert on `issue COUNTS` and `issue PATHS` rather than `is_compliant`, so
//! `delete !` and `replace > with >=` style mutations cannot survive by
//! silently flipping a boolean that the assertion never observes.
//!
//! Reference: target/mutants-w240-validate/mutants.out/missed.txt
//! Coverage table is documented at the bottom of this file.

use slot_sim::ir::{
    cross_validate, Feature, FsModifier, NearMissRule, RetriggerSpec, SlotGameIR, TriggerBy,
    TriggerByCount,
};
use std::collections::BTreeMap;

// ─── Base IR builders ─────────────────────────────────────────────────────────

/// Minimal *valid* lines-evaluation IR — no errors, no warnings.
const VALID_LINES_JSON: &str = r#"{
  "schema_version": "1.0.0",
  "meta": { "id": "w240-validate-base", "name": "W240 base", "version": "1.0.0", "theme_tags": ["mutation-kill"] },
  "topology": { "kind": "rectangular", "reels": 5, "rows": 3 },
  "symbols": [
    { "id": "S_LP1", "name": "LP1", "kind": "lp" },
    { "id": "S_HP1", "name": "HP1", "kind": "hp" },
    { "id": "S_WILD", "name": "Wild", "kind": "wild", "substitutes": "*" },
    { "id": "S_SCAT", "name": "Scatter", "kind": "scatter" },
    { "id": "S_BONUS", "name": "Bonus", "kind": "bonus" }
  ],
  "reels": {
    "mode": "weighted",
    "base": [
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0, "S_BONUS": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0, "S_BONUS": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0, "S_BONUS": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0, "S_BONUS": 1.0 },
      { "S_LP1": 8.0, "S_HP1": 3.0, "S_WILD": 1.0, "S_SCAT": 1.0, "S_BONUS": 1.0 }
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

/// Same base but using a `strips` reel set (for L78 strip-symbol coverage).
const VALID_STRIPS_JSON: &str = r#"{
  "schema_version": "1.0.0",
  "meta": { "id": "w240-validate-strips", "name": "W240 strips", "version": "1.0.0", "theme_tags": [] },
  "topology": { "kind": "rectangular", "reels": 3, "rows": 3 },
  "symbols": [
    { "id": "S_LP1", "name": "LP1", "kind": "lp" },
    { "id": "S_HP1", "name": "HP1", "kind": "hp" }
  ],
  "reels": {
    "mode": "strips",
    "base": [
      ["S_LP1", "S_HP1", "S_LP1"],
      ["S_LP1", "S_HP1", "S_LP1"],
      ["S_LP1", "S_HP1", "S_LP1"]
    ]
  },
  "evaluation": {
    "kind": "lines",
    "paylines": [[1,1,1]],
    "direction": "ltr",
    "min_match": 3,
    "pay_left_to_right_only": true
  },
  "paytable": {
    "S_LP1": { "3": 0.5 },
    "S_HP1": { "3": 3.0 }
  },
  "features": [],
  "rng": { "kind": "mulberry32", "default_seed": 1 },
  "bet": { "currency": "EUR", "base_bet": 1.0, "denominations": [1.0] },
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

fn base_lines() -> SlotGameIR {
    SlotGameIR::from_json(VALID_LINES_JSON).expect("base IR must parse")
}

fn base_strips() -> SlotGameIR {
    SlotGameIR::from_json(VALID_STRIPS_JSON).expect("strips IR must parse")
}

fn count_with_path_prefix(ir: &SlotGameIR, prefix: &str) -> usize {
    cross_validate(ir)
        .errors
        .iter()
        .filter(|e| e.path.starts_with(prefix))
        .count()
}

fn has_error_with_message_substr(ir: &SlotGameIR, sub: &str) -> bool {
    cross_validate(ir).errors.iter().any(|e| e.message.contains(sub))
}

fn has_warning_with_path(ir: &SlotGameIR, path: &str) -> bool {
    cross_validate(ir)
        .warnings
        .iter()
        .any(|w| w.path == path)
}

// ─── L62: delete `!` in weighted reels base symbol-id check ───────────────────
#[test]
fn w240_validate_kill_l62_weighted_base_unknown_symbol() {
    let mut ir = base_lines();
    // Inject unknown symbol id "S_GHOST" into a base-reel weighted map.
    let mut new_base = match &ir.reels {
        slot_sim::ir::ReelSet::Weighted { base, .. } => base.clone(),
        _ => panic!("expected weighted reels"),
    };
    new_base[0].insert("S_GHOST".to_string(), 0.5);
    ir.reels = slot_sim::ir::ReelSet::Weighted {
        base: new_base,
        free_spins: None,
    };

    let n = count_with_path_prefix(&ir, "/reels/base/0/");
    assert_eq!(
        n, 1,
        "L62 missing `!`: expected EXACTLY 1 error on unknown weighted-reel symbol, got {n}"
    );

    // Baseline (no unknown sym) must emit ZERO. Without this, mutant could
    // swallow the assertion by emitting an error on every key.
    let clean = base_lines();
    assert_eq!(
        count_with_path_prefix(&clean, "/reels/base/"),
        0,
        "L62 inverse: clean IR must have ZERO reel-base unknown-symbol errors"
    );
}

// ─── L78: delete `!` in strips base-reel symbol-id check ──────────────────────
#[test]
fn w240_validate_kill_l78_strips_unknown_symbol() {
    let mut ir = base_strips();
    if let slot_sim::ir::ReelSet::Strips { base, .. } = &mut ir.reels {
        base[1][2] = "S_PHANTOM".to_string();
    } else {
        panic!("expected strips reels");
    }

    let n = count_with_path_prefix(&ir, "/reels/base/1/2");
    assert_eq!(
        n, 1,
        "L78 missing `!`: expected 1 error on unknown strip symbol, got {n}"
    );
    let clean = base_strips();
    assert_eq!(
        count_with_path_prefix(&clean, "/reels/base/"),
        0,
        "L78 inverse: clean strips IR must emit ZERO unknown-symbol errors"
    );
}

// ─── L91: delete `!` in substitutes target check ──────────────────────────────
#[test]
fn w240_validate_kill_l91_substitute_unknown_target() {
    let mut ir = base_lines();
    // Replace S_WILD substitute "*" with a List containing an unknown id.
    for sym in ir.symbols.iter_mut() {
        if sym.id == "S_WILD" {
            sym.substitutes = Some(slot_sim::ir::Substitutes::List(vec![
                "S_LP1".to_string(),
                "S_NONEXISTENT".to_string(),
            ]));
        }
    }
    let n = count_with_path_prefix(&ir, "/symbols/S_WILD/substitutes");
    assert_eq!(
        n, 1,
        "L91 missing `!`: expected 1 error on unknown substitute target, got {n}"
    );
    // Inverse: list with only existing ids must NOT emit error.
    let mut ir_ok = base_lines();
    for sym in ir_ok.symbols.iter_mut() {
        if sym.id == "S_WILD" {
            sym.substitutes = Some(slot_sim::ir::Substitutes::List(vec!["S_LP1".to_string()]));
        }
    }
    assert_eq!(
        count_with_path_prefix(&ir_ok, "/symbols/S_WILD/substitutes"),
        0,
        "L91 inverse: known substitutes must not emit error"
    );
}

// ─── L109: `+` arithmetic in RTP-allocation sum (3 distinct mutations) ────────
#[test]
fn w240_validate_kill_l109_rtp_allocation_sum_arithmetic() {
    // Construct an IR where target_rtp = 0.96, tolerance = 0.005, and the
    // four components MUST add (not subtract, not multiply) to land near 0.96.
    // Components chosen so plus → 0.96, minus → ≈0.96 - large delta, times → ≈0.
    let mut ir = base_lines();
    ir.limits.target_rtp = 0.96;
    ir.rtp_allocation.base_game = 0.5;
    ir.rtp_allocation.free_spins = 0.3;
    ir.rtp_allocation.hold_and_win = 0.1;
    ir.rtp_allocation.jackpot = 0.06;
    ir.rtp_allocation.tolerance = 0.005;
    // ground truth: 0.5 + 0.3 + 0.1 + 0.06 = 0.96 ✓

    let issues_on_alloc = count_with_path_prefix(&ir, "/rtp_allocation");
    assert_eq!(
        issues_on_alloc, 0,
        "L109 (`+`→`-` or `+`→`*`): sum 0.5+0.3+0.1+0.06=0.96 must be within tolerance; got {issues_on_alloc} error(s)"
    );

    // Now break it deliberately and ensure original path still flags it.
    let mut bad = base_lines();
    bad.rtp_allocation.base_game = 0.10;
    bad.rtp_allocation.free_spins = 0.10;
    bad.rtp_allocation.hold_and_win = 0.10;
    bad.rtp_allocation.jackpot = 0.10;
    bad.rtp_allocation.tolerance = 0.005;
    // sum = 0.40, target 0.96, delta 0.56 ≫ 0.005 — must flag.
    assert_eq!(
        count_with_path_prefix(&bad, "/rtp_allocation"),
        1,
        "L109 inverse: sum 0.40 vs target 0.96 must emit exactly 1 error"
    );
}

// ─── L110: `> tolerance` boundary in RTP-allocation check ─────────────────────
#[test]
fn w240_validate_kill_l110_tolerance_strict_greater() {
    // Bit-exact boundary using tolerance = 0.0.
    // sum = target = 0.96 exactly → diff == 0.0.
    // Original `> 0.0`: false → no error.
    // Mutant `>= 0.0`: true → emits 1 error.
    let mut ir = base_lines();
    ir.limits.target_rtp = 0.96;
    ir.rtp_allocation.base_game = 0.96;
    ir.rtp_allocation.free_spins = 0.0;
    ir.rtp_allocation.hold_and_win = 0.0;
    ir.rtp_allocation.jackpot = 0.0;
    ir.rtp_allocation.tolerance = 0.0;

    let issues = count_with_path_prefix(&ir, "/rtp_allocation");
    assert_eq!(
        issues, 0,
        "L110 (`>` vs `>=`): diff==tolerance(=0.0) must NOT emit (original `>`); got {issues}"
    );

    // And ensure a delta-just-above-tolerance DOES flag — kills `> →== / < / >=` family.
    let mut bad = base_lines();
    bad.limits.target_rtp = 0.96;
    bad.rtp_allocation.base_game = 0.10;
    bad.rtp_allocation.free_spins = 0.10;
    bad.rtp_allocation.hold_and_win = 0.10;
    bad.rtp_allocation.jackpot = 0.10;
    bad.rtp_allocation.tolerance = 0.0;
    // sum=0.40, target=0.96, diff=0.56 > 0.0 → must emit.
    assert_eq!(
        count_with_path_prefix(&bad, "/rtp_allocation"),
        1,
        "L110 inverse: diff > 0 with tolerance=0 must emit exactly 1 error"
    );
}

// ─── L131: delete match arm Feature::FreeSpins{trigger} ───────────────────────
#[test]
fn w240_validate_kill_l131_freespins_scatter_missing() {
    // Goal: a FreeSpins feature whose trigger.by == ScatterCount, but no
    // scatter symbol in /symbols. Original emits 1 error at /features/0/trigger.
    // If L131's match arm is deleted, the arm never runs → no error.
    let mut ir = base_lines();
    ir.symbols.retain(|s| s.kind != slot_sim::ir::SymbolKind::Scatter);
    // Strip scatter weights from each reel.
    if let slot_sim::ir::ReelSet::Weighted { base, .. } = &mut ir.reels {
        for reel in base.iter_mut() {
            reel.remove("S_SCAT");
        }
    }
    let mut thresholds = BTreeMap::new();
    thresholds.insert("3".to_string(), 10.0);
    ir.features.push(Feature::FreeSpins {
        trigger: TriggerByCount {
            by: TriggerBy::ScatterCount,
            min: Some(3),
            thresholds: Some(thresholds),
        },
        global_multiplier: Some(1.0),
        retrigger: None,
        modifiers: Some(vec![FsModifier::MultiplierLadder]),
    });
    // Expect exactly 1 trigger error.
    let n = cross_validate(&ir)
        .errors
        .iter()
        .filter(|e| e.path == "/features/0/trigger")
        .count();
    assert_eq!(
        n, 1,
        "L131 deleted arm: expected 1 trigger error for FS+scatter+no-scatter-sym, got {n}"
    );
}

// ─── L133: `==` vs `!=` on trigger.by == ScatterCount ─────────────────────────
#[test]
fn w240_validate_kill_l133_trigger_by_equality() {
    // 1) Trigger.by == ScatterCount with no scatter symbol → ORIGINAL emits 1 error.
    //    Mutant flips `==` → `!=` so no error.
    {
        let mut ir = base_lines();
        ir.symbols.retain(|s| s.kind != slot_sim::ir::SymbolKind::Scatter);
        if let slot_sim::ir::ReelSet::Weighted { base, .. } = &mut ir.reels {
            for reel in base.iter_mut() {
                reel.remove("S_SCAT");
            }
        }
        let mut thresh = BTreeMap::new();
        thresh.insert("3".to_string(), 10.0);
        ir.features.push(Feature::FreeSpins {
            trigger: TriggerByCount {
                by: TriggerBy::ScatterCount,
                min: Some(3),
                thresholds: Some(thresh),
            },
            global_multiplier: Some(1.0),
            retrigger: None,
            modifiers: None,
        });
        assert!(
            cross_validate(&ir)
                .errors
                .iter()
                .any(|e| e.path == "/features/0/trigger"),
            "L133 (==): scatter-triggered FS with no scatter sym must emit error"
        );
    }
    // 2) Trigger.by == BonusCount with no scatter symbol → NO error (different trigger).
    //    Original: condition false → 0 errors.
    //    Mutant `!=`: condition true (because trigger.by != ScatterCount) → 1 spurious error.
    {
        let mut ir = base_lines();
        ir.symbols.retain(|s| s.kind != slot_sim::ir::SymbolKind::Scatter);
        if let slot_sim::ir::ReelSet::Weighted { base, .. } = &mut ir.reels {
            for reel in base.iter_mut() {
                reel.remove("S_SCAT");
            }
        }
        let mut thresh = BTreeMap::new();
        thresh.insert("3".to_string(), 10.0);
        ir.features.push(Feature::FreeSpins {
            trigger: TriggerByCount {
                by: TriggerBy::BonusCount,
                min: Some(3),
                thresholds: Some(thresh),
            },
            global_multiplier: Some(1.0),
            retrigger: None,
            modifiers: None,
        });
        assert_eq!(
            cross_validate(&ir)
                .errors
                .iter()
                .filter(|e| e.path == "/features/0/trigger")
                .count(),
            0,
            "L133 (==): BonusCount-triggered FS must NOT emit scatter error"
        );
    }
}

// ─── L141: delete match arm Feature::MysterySymbol ────────────────────────────
// ─── L145: delete `!` on mystery symbol_id check ──────────────────────────────
// ─── L152: delete `!` on reveal_distribution target check ─────────────────────
#[test]
fn w240_validate_kill_l141_l145_l152_mystery_symbol_paths() {
    // Two failures: symbol_id "S_GHOST" unknown AND reveal_distribution
    // entry "S_PHANTOM" unknown.
    let mut ir = base_lines();
    let mut dist = BTreeMap::new();
    dist.insert("S_LP1".to_string(), 0.5); // known target — must NOT emit
    dist.insert("S_PHANTOM".to_string(), 0.5); // unknown target — must emit
    ir.features.push(Feature::MysterySymbol {
        symbol_id: "S_GHOST".to_string(), // unknown — must emit
        reveal_distribution: dist,
    });
    let report = cross_validate(&ir);
    let sym_errs = report
        .errors
        .iter()
        .filter(|e| e.path == "/features/0/symbol_id")
        .count();
    let rd_errs = report
        .errors
        .iter()
        .filter(|e| e.path.starts_with("/features/0/reveal_distribution/"))
        .count();
    assert_eq!(sym_errs, 1, "L145 inverse: unknown mystery symbol_id must emit (got {sym_errs})");
    assert_eq!(rd_errs, 1, "L152 inverse: unknown reveal_distribution target must emit (got {rd_errs})");
    // Existence of those errors confirms L141 arm fires.

    // Inverse: known symbol_id + known reveal targets → zero mystery errors.
    let mut ir_ok = base_lines();
    let mut dist_ok = BTreeMap::new();
    dist_ok.insert("S_LP1".to_string(), 1.0);
    ir_ok.features.push(Feature::MysterySymbol {
        symbol_id: "S_HP1".to_string(),
        reveal_distribution: dist_ok,
    });
    let r2 = cross_validate(&ir_ok);
    assert!(
        r2.errors
            .iter()
            .all(|e| !e.path.starts_with("/features/0/")),
        "L145/L152 inverse: known refs must NOT emit feature errors"
    );
}

// ─── L166: `rtp_lo > rtp_hi` (`>` vs `==` / `>=`) ─────────────────────────────
#[test]
fn w240_validate_kill_l166_rtp_range_lo_hi_order() {
    // Case A: lo == hi → original `>` false → no error. Mutant `>=` true → 1 error.
    let mut ir = base_lines();
    ir.compliance.rtp_range_required = [0.96, 0.96];
    ir.limits.target_rtp = 0.96;
    let errs_a = cross_validate(&ir)
        .errors
        .iter()
        .filter(|e| e.path == "/compliance/rtp_range_required")
        .count();
    assert_eq!(errs_a, 0, "L166 (>=): lo==hi must NOT emit (original `>`); got {errs_a}");

    // Case B: lo > hi → original true → 1 error. Mutant `==` false → 0 errors.
    let mut ir2 = base_lines();
    ir2.compliance.rtp_range_required = [0.99, 0.94];
    ir2.limits.target_rtp = 0.96;
    let errs_b = cross_validate(&ir2)
        .errors
        .iter()
        .filter(|e| e.path == "/compliance/rtp_range_required")
        .count();
    assert_eq!(errs_b, 1, "L166 (==): lo>hi must emit (original); got {errs_b}");
}

// ─── L172: `target_rtp < lo` / `> hi` boundary (4 mutations) ──────────────────
#[test]
fn w240_validate_kill_l172_target_rtp_outside_band() {
    // A: target_rtp at exact lower bound → no warning (original `<`).
    //    `<=` mutant: emits warning (target_rtp <= lo true).
    let mut at_lo = base_lines();
    at_lo.compliance.rtp_range_required = [0.96, 0.99];
    at_lo.limits.target_rtp = 0.96;
    assert!(
        !has_warning_with_path(&at_lo, "/limits/target_rtp"),
        "L172 (`<` vs `<=`): target == lo must NOT warn"
    );

    // B: target_rtp at exact upper bound → no warning (original `>`).
    //    `>=` mutant: warns.
    let mut at_hi = base_lines();
    at_hi.compliance.rtp_range_required = [0.94, 0.96];
    at_hi.limits.target_rtp = 0.96;
    assert!(
        !has_warning_with_path(&at_hi, "/limits/target_rtp"),
        "L172 (`>` vs `>=`): target == hi must NOT warn"
    );

    // C: target_rtp strictly below band → warning emitted.
    //    Original `<` true; mutant `==` and `<` flipped to `>` change behaviour.
    let mut below = base_lines();
    below.compliance.rtp_range_required = [0.97, 0.99];
    below.limits.target_rtp = 0.96; // < lo
    assert!(
        has_warning_with_path(&below, "/limits/target_rtp"),
        "L172 inverse: target < lo must warn"
    );

    // D: target_rtp strictly above band → warning emitted (kills `>`==/</≥ family).
    let mut above = base_lines();
    above.compliance.rtp_range_required = [0.90, 0.95];
    above.limits.target_rtp = 0.96; // > hi
    assert!(
        has_warning_with_path(&above, "/limits/target_rtp"),
        "L172 inverse: target > hi must warn"
    );
}

// ─── L181: `max_win_x > cap` boundary (3 mutations) ───────────────────────────
#[test]
fn w240_validate_kill_l181_max_win_cap_boundary() {
    // Equal → no warning (original `>`).
    let mut eq = base_lines();
    eq.limits.max_win_x = 5000.0;
    eq.compliance.max_win_cap_required = 5000.0;
    assert!(
        !has_warning_with_path(&eq, "/limits/max_win_x"),
        "L181 (>=): max_win == cap must NOT warn"
    );

    // Above → warning (kills `==` / `<` mutations).
    let mut over = base_lines();
    over.limits.max_win_x = 6000.0;
    over.compliance.max_win_cap_required = 5000.0;
    assert!(
        has_warning_with_path(&over, "/limits/max_win_x"),
        "L181 inverse: max_win > cap must warn"
    );

    // Below → no warning.
    let mut below = base_lines();
    below.limits.max_win_x = 4000.0;
    below.compliance.max_win_cap_required = 5000.0;
    assert!(
        !has_warning_with_path(&below, "/limits/max_win_x"),
        "L181 inverse: max_win < cap must NOT warn"
    );
}

// ─── L234 + L235: `Evaluation::Cluster` arm + `!matches!(t, Cluster)` ─────────
#[test]
fn w240_validate_kill_l234_l235_cluster_evaluation_paths() {
    // Cluster evaluation + non-cluster topology → expects EXACTLY 1 error.
    let cluster_eval_lines_topo = r#"{
      "schema_version": "1.0.0",
      "meta": { "id": "w240-cluster", "name": "cluster", "version": "1.0.0", "theme_tags": [] },
      "topology": { "kind": "rectangular", "reels": 6, "rows": 5 },
      "symbols": [
        { "id": "S_A", "name": "A", "kind": "lp" }
      ],
      "reels": {
        "mode": "weighted",
        "base": [
          { "S_A": 1.0 },{ "S_A": 1.0 },{ "S_A": 1.0 },{ "S_A": 1.0 },{ "S_A": 1.0 },{ "S_A": 1.0 }
        ]
      },
      "evaluation": { "kind": "cluster", "min_cluster_size": 5, "cluster_pay_table": { "5": 1.0 } },
      "paytable": { "S_A": { "5": 1.0 } },
      "features": [],
      "rng": { "kind": "mulberry32", "default_seed": 1 },
      "bet": { "currency": "EUR", "base_bet": 1.0, "denominations": [1.0] },
      "limits": { "target_rtp": 0.96, "rtp_tolerance": 0.0005, "max_win_x": 5000.0, "win_cap_apply": "per_spin", "target_volatility": "medium", "hit_freq_target": 0.3 },
      "compliance": { "jurisdictions": ["UKGC"], "rtp_range_required": [0.94, 0.99], "max_win_cap_required": 5000.0, "near_miss_rule": "must_be_random", "ldw_disclosure": true, "session_time_display": true },
      "rtp_allocation": { "base_game": 0.96, "free_spins": 0.0, "hold_and_win": 0.0, "jackpot": 0.0, "tolerance": 0.005 }
    }"#;
    let ir = SlotGameIR::from_json(cluster_eval_lines_topo).expect("cluster IR parse");
    let evaluation_errs = cross_validate(&ir)
        .errors
        .iter()
        .filter(|e| e.path == "/evaluation")
        .count();
    assert_eq!(
        evaluation_errs, 1,
        "L234/L235: cluster evaluation w/ non-cluster topology must emit exactly 1 /evaluation error, got {evaluation_errs}"
    );

    // Inverse: cluster_grid + cluster eval → 0 errors. Kills L235 `!matches!`.
    let cluster_eval_cluster_topo = cluster_eval_lines_topo.replace(
        r#""topology": { "kind": "rectangular", "reels": 6, "rows": 5 }"#,
        r#""topology": { "kind": "cluster_grid", "columns": 6, "rows": 5, "adjacency": "orthogonal" }"#,
    );
    let ir_ok = SlotGameIR::from_json(&cluster_eval_cluster_topo).expect("ok cluster IR parse");
    let evaluation_errs_ok = cross_validate(&ir_ok)
        .errors
        .iter()
        .filter(|e| e.path == "/evaluation")
        .count();
    assert_eq!(
        evaluation_errs_ok, 0,
        "L235 inverse: cluster eval + cluster_grid topology must emit 0 errors, got {evaluation_errs_ok}"
    );
}

// ─── L242: `Evaluation::Ways` arm in topology coherence ───────────────────────
#[test]
fn w240_validate_kill_l242_ways_evaluation_path() {
    let ways_with_cluster_topo = r#"{
      "schema_version": "1.0.0",
      "meta": { "id": "w240-ways", "name": "ways", "version": "1.0.0", "theme_tags": [] },
      "topology": { "kind": "cluster_grid", "columns": 5, "rows": 3, "adjacency": "orthogonal" },
      "symbols": [{ "id": "S_A", "name": "A", "kind": "lp" }],
      "reels": { "mode": "weighted", "base": [{"S_A":1.0},{"S_A":1.0},{"S_A":1.0},{"S_A":1.0},{"S_A":1.0}] },
      "evaluation": { "kind": "ways", "direction": "ltr", "min_match": 3, "max_ways_per_spin": 243 },
      "paytable": { "S_A": { "3": 1.0 } },
      "features": [],
      "rng": { "kind": "mulberry32", "default_seed": 1 },
      "bet": { "currency": "EUR", "base_bet": 1.0, "denominations": [1.0] },
      "limits": { "target_rtp": 0.96, "rtp_tolerance": 0.0005, "max_win_x": 5000.0, "win_cap_apply": "per_spin", "target_volatility": "medium", "hit_freq_target": 0.3 },
      "compliance": { "jurisdictions": ["UKGC"], "rtp_range_required": [0.94, 0.99], "max_win_cap_required": 5000.0, "near_miss_rule": "must_be_random", "ldw_disclosure": true, "session_time_display": true },
      "rtp_allocation": { "base_game": 0.96, "free_spins": 0.0, "hold_and_win": 0.0, "jackpot": 0.0, "tolerance": 0.005 }
    }"#;
    let ir = SlotGameIR::from_json(ways_with_cluster_topo).expect("ways/cluster IR parse");
    let n = cross_validate(&ir)
        .errors
        .iter()
        .filter(|e| e.path == "/evaluation")
        .count();
    assert_eq!(
        n, 1,
        "L242: ways evaluation + cluster_grid topology must emit /evaluation error, got {n}"
    );

    // Inverse: ways + rectangular → 0 evaluation errors.
    let ways_rect = ways_with_cluster_topo.replace(
        r#""topology": { "kind": "cluster_grid", "columns": 5, "rows": 3, "adjacency": "orthogonal" }"#,
        r#""topology": { "kind": "rectangular", "reels": 5, "rows": 3 }"#,
    );
    let ir_ok = SlotGameIR::from_json(&ways_rect).expect("ways/rect IR parse");
    let n_ok = cross_validate(&ir_ok)
        .errors
        .iter()
        .filter(|e| e.path == "/evaluation")
        .count();
    assert_eq!(
        n_ok, 0,
        "L242 inverse: ways + rectangular must emit 0 /evaluation errors, got {n_ok}"
    );
}

// ─── L255, L260, L261: paytable_shape_check function + Lines/Ways arms ────────
#[test]
fn w240_validate_kill_l255_l260_l261_paytable_shape_check() {
    // Inject a non-numeric paytable key for a Lines-eval IR — must emit error.
    let mut ir = base_lines();
    {
        let mut hp_table = ir.paytable.get("S_HP1").cloned().unwrap_or_default();
        hp_table.insert("HIGH".to_string(), 10.0); // non-digit key
        ir.paytable.insert("S_HP1".to_string(), hp_table);
    }
    let n = cross_validate(&ir)
        .errors
        .iter()
        .filter(|e| e.path == "/paytable/S_HP1/HIGH")
        .count();
    assert_eq!(
        n, 1,
        "L255/L260: non-digit paytable key under Lines eval must emit exactly 1 error, got {n}"
    );
    assert!(
        has_error_with_message_substr(&ir, "lines"),
        "L260: message must mention 'lines' kind"
    );

    // Now a Ways-eval IR with a bad key.
    let ways_bad = r#"{
      "schema_version": "1.0.0",
      "meta": { "id": "w240-paytable-ways", "name": "ways", "version": "1.0.0", "theme_tags": [] },
      "topology": { "kind": "rectangular", "reels": 5, "rows": 3 },
      "symbols": [{ "id": "S_A", "name": "A", "kind": "lp" }],
      "reels": { "mode": "weighted", "base": [{"S_A":1.0},{"S_A":1.0},{"S_A":1.0},{"S_A":1.0},{"S_A":1.0}] },
      "evaluation": { "kind": "ways", "direction": "ltr", "min_match": 3, "max_ways_per_spin": 243 },
      "paytable": { "S_A": { "WEIRD": 1.0, "3": 1.0 } },
      "features": [],
      "rng": { "kind": "mulberry32", "default_seed": 1 },
      "bet": { "currency": "EUR", "base_bet": 1.0, "denominations": [1.0] },
      "limits": { "target_rtp": 0.96, "rtp_tolerance": 0.0005, "max_win_x": 5000.0, "win_cap_apply": "per_spin", "target_volatility": "medium", "hit_freq_target": 0.3 },
      "compliance": { "jurisdictions": ["UKGC"], "rtp_range_required": [0.94, 0.99], "max_win_cap_required": 5000.0, "near_miss_rule": "must_be_random", "ldw_disclosure": true, "session_time_display": true },
      "rtp_allocation": { "base_game": 0.96, "free_spins": 0.0, "hold_and_win": 0.0, "jackpot": 0.0, "tolerance": 0.005 }
    }"#;
    let ir_ways = SlotGameIR::from_json(ways_bad).expect("ways paytable IR parse");
    let n_ways = cross_validate(&ir_ways)
        .errors
        .iter()
        .filter(|e| e.path == "/paytable/S_A/WEIRD")
        .count();
    assert_eq!(
        n_ways, 1,
        "L261: non-digit paytable key under Ways eval must emit exactly 1 error, got {n_ways}"
    );
    assert!(
        has_error_with_message_substr(&ir_ways, "ways"),
        "L261: message must mention 'ways' kind"
    );
}

// ─── Belt & suspenders: clean IR must validate with zero issues ───────────────
#[test]
fn w240_validate_clean_base_emits_no_errors() {
    let ir = base_lines();
    let r = cross_validate(&ir);
    assert!(
        r.errors.is_empty(),
        "Clean lines IR must have 0 errors; got: {:?}",
        r.errors
    );
    assert!(
        r.warnings.is_empty(),
        "Clean lines IR must have 0 warnings; got: {:?}",
        r.warnings
    );
    let ir2 = base_strips();
    let r2 = cross_validate(&ir2);
    assert!(
        r2.errors.is_empty(),
        "Clean strips IR must have 0 errors; got: {:?}",
        r2.errors
    );
}

// ─── Bonus: NearMissRule round-trip touch (defensive) ─────────────────────────
#[test]
fn w240_validate_near_miss_rule_field_present() {
    let mut ir = base_lines();
    ir.compliance.near_miss_rule = NearMissRule::AllowedWithinDistribution;
    // Just ensures cross_validate doesn't panic when this variant is used.
    let _ = cross_validate(&ir);
    ir.compliance.near_miss_rule = NearMissRule::MustBeRandom;
    let _ = cross_validate(&ir);
}

// ─── Belt: free_spins reels FS-side unknown symbol still flags ────────────────
// (Indirect coverage to keep the FS-reel branch alive.)
#[test]
fn w240_validate_fs_reels_unknown_symbol() {
    let mut ir = base_lines();
    let mut fs_reel: BTreeMap<String, f64> = BTreeMap::new();
    fs_reel.insert("S_LP1".to_string(), 1.0);
    fs_reel.insert("S_PHANTOM".to_string(), 1.0);
    let fs_reels = vec![fs_reel.clone(), fs_reel.clone(), fs_reel.clone(), fs_reel.clone(), fs_reel];
    if let slot_sim::ir::ReelSet::Weighted { base, .. } = &ir.reels {
        ir.reels = slot_sim::ir::ReelSet::Weighted {
            base: base.clone(),
            free_spins: Some(fs_reels),
        };
    }
    let n = count_with_path_prefix(&ir, "/reels/free_spins/");
    assert_eq!(
        n, 5,
        "FS reel side: each of 5 reels has one phantom → 5 errors, got {n}"
    );
}

// ─── L62 (delete `!`) — ONLY known symbols on FS reels must emit ZERO errors.
//
//    Original `if !sym_ids.contains(k)`: known sym → condition false → no error.
//    Mutant   `if  sym_ids.contains(k)`: known sym → condition true  → 5 errors
//    emitted (1 per reel × 5 reels), one for each known key. Differs from the
//    `S_PHANTOM` variant above because that test mixes known + unknown — the
//    mutant emits 10 errors there but the assertion expected 5 → coincidentally
//    surviving via path-explosion. This test pins the EXACT clean case.
#[test]
fn w240_validate_kill_l62_fs_reels_only_known_symbols_zero_errors() {
    let mut ir = base_lines();
    let mut fs_reel: BTreeMap<String, f64> = BTreeMap::new();
    fs_reel.insert("S_LP1".to_string(), 1.0); // KNOWN only
    let fs_reels = vec![
        fs_reel.clone(),
        fs_reel.clone(),
        fs_reel.clone(),
        fs_reel.clone(),
        fs_reel,
    ];
    if let slot_sim::ir::ReelSet::Weighted { base, .. } = &ir.reels {
        ir.reels = slot_sim::ir::ReelSet::Weighted {
            base: base.clone(),
            free_spins: Some(fs_reels),
        };
    }
    let n = count_with_path_prefix(&ir, "/reels/free_spins/");
    assert_eq!(
        n, 0,
        "L62 (delete `!`): FS reels with ONLY known symbols must emit 0 errors, got {n}"
    );
}

// Retrigger touchpoint (does not directly kill validate.rs mutants but
// exercises the FreeSpins variant with `retrigger: Some(...)` to keep the
// match-arm coverage warm across crates).
#[allow(dead_code)]
fn _exercise_retrigger() -> RetriggerSpec {
    let mut thresholds = BTreeMap::new();
    thresholds.insert("3".to_string(), 5.0);
    RetriggerSpec {
        trigger: TriggerByCount {
            by: TriggerBy::ScatterCount,
            min: Some(3),
            thresholds: Some(thresholds),
        },
        max_total: Some(50),
    }
}

// ─── Mutant coverage map ─────────────────────────────────────────────────────
//
// validate.rs missed list (cargo mutants baseline, W240):
//
//   L62  delete `!`                       → w240_validate_kill_l62_weighted_base_unknown_symbol
//   L78  delete `!`                       → w240_validate_kill_l78_strips_unknown_symbol
//   L91  delete `!`                       → w240_validate_kill_l91_substitute_unknown_target
//   L109 +→-, +→*                          → w240_validate_kill_l109_rtp_allocation_sum_arithmetic
//   L110 >→>=                              → w240_validate_kill_l110_tolerance_strict_greater
//   L131 delete arm Feature::FreeSpins     → w240_validate_kill_l131_freespins_scatter_missing
//   L133 ==→!=                             → w240_validate_kill_l133_trigger_by_equality
//   L141 delete arm Feature::MysterySymbol → w240_validate_kill_l141_l145_l152_mystery_symbol_paths
//   L145 delete `!`                       → idem
//   L152 delete `!`                       → idem
//   L166 >→==, >→>=                        → w240_validate_kill_l166_rtp_range_lo_hi_order
//   L172 <→<=, >→==, >→<, >→>=             → w240_validate_kill_l172_target_rtp_outside_band
//   L181 >→==, >→<, >→>=                   → w240_validate_kill_l181_max_win_cap_boundary
//   L234 delete arm Cluster                → w240_validate_kill_l234_l235_cluster_evaluation_paths
//   L235 delete `!`                       → idem
//   L242 delete arm Ways                   → w240_validate_kill_l242_ways_evaluation_path
//   L255 replace fn with ()                → w240_validate_kill_l255_l260_l261_paytable_shape_check
//   L260 delete arm Lines                  → idem
//   L261 delete arm Ways                   → idem
