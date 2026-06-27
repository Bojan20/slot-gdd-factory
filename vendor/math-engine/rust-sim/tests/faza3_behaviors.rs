//! Faza 3 — Symbol Behavior Plugin Layer: Rust Test Suite
//!
//! Mirrors faza3_behaviors.test.ts (TypeScript).
//!
//! ## Coverage
//!
//! | Group | Description                                    | Tests |
//! |-------|------------------------------------------------|-------|
//! | R3-01 | apply_effect — all 13 variants                 |  15   |
//! | R3-02 | tick_locked_positions / restore                |   4   |
//! | R3-03 | WildBehavior                                   |   3   |
//! | R3-04 | ExpandingWildBehavior                          |   4   |
//! | R3-05 | StickyWildBehavior                             |   5   |
//! | R3-06 | MultiplierWildBehavior                         |   4   |
//! | R3-07 | ScatterBehavior                                |   5   |
//! | R3-08 | CoinBehavior                                   |   5   |
//! | R3-09 | JackpotBehavior                                |   4   |
//! | R3-10 | BehaviorRegistry                               |   4   |
//! | R3-11 | Pipeline-level integration                     |   4   |

use slot_sim::behavior::impls::{
    CoinBehavior, ExpandingWildBehavior, JackpotBehavior, JackpotTrigger, MultiplierWildBehavior,
    ScatterBehavior, StickyWildBehavior, WildBehavior,
};
use slot_sim::behavior::registry::BehaviorRegistry;
use slot_sim::behavior::{
    apply_effect, apply_effects, restore_locked_positions, tick_locked_positions, BehaviorContext,
    Effect, EffectScope, SpinState, SymbolBehavior,
};
use std::collections::HashMap;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn make_grid(reels: usize, rows: usize, fill: &str) -> Vec<Vec<String>> {
    vec![vec![fill.to_string(); rows]; reels]
}

fn make_state(reels: usize, rows: usize) -> SpinState {
    SpinState::new(make_grid(reels, rows, "L1"))
}

fn make_ctx<'a>(
    symbol_id: &'a str,
    reel: usize,
    row: usize,
    state: &'a SpinState,
) -> BehaviorContext<'a> {
    static EMPTY: std::sync::OnceLock<HashMap<String, String>> = std::sync::OnceLock::new();
    BehaviorContext {
        symbol_id,
        reel,
        row,
        state,
        config: EMPTY.get_or_init(HashMap::new),
    }
}

// ─── R3-01: apply_effect ─────────────────────────────────────────────────────

#[test]
fn r3_01_noop_no_state_change() {
    let mut s = make_state(5, 3);
    apply_effect(&mut s, &Effect::Noop);
    assert_eq!(s.spin_multiplier, 1.0);
    assert_eq!(s.line_multiplier, 1.0);
}

#[test]
fn r3_01_multiplier_add_spin() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::MultiplierAdd {
            value: 2.0,
            scope: EffectScope::Spin,
        },
    );
    assert!((s.spin_multiplier - 2.0).abs() < 1e-10);
}

#[test]
fn r3_01_multiplier_add_additive_stacking() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::MultiplierAdd {
            value: 2.0,
            scope: EffectScope::Spin,
        },
    );
    apply_effect(
        &mut s,
        &Effect::MultiplierAdd {
            value: 2.0,
            scope: EffectScope::Spin,
        },
    );
    assert!((s.spin_multiplier - 3.0).abs() < 1e-10);
}

#[test]
fn r3_01_multiplier_mul_multiplicative_stacking() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::MultiplierMul {
            value: 2.0,
            scope: EffectScope::Spin,
        },
    );
    apply_effect(
        &mut s,
        &Effect::MultiplierMul {
            value: 3.0,
            scope: EffectScope::Spin,
        },
    );
    assert!((s.spin_multiplier - 6.0).abs() < 1e-10);
}

#[test]
fn r3_01_multiplier_session_scope() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::MultiplierMul {
            value: 4.0,
            scope: EffectScope::Session,
        },
    );
    assert!((s.session_multiplier - 4.0).abs() < 1e-10);
    assert!((s.spin_multiplier - 1.0).abs() < 1e-10);
}

#[test]
fn r3_01_transform_symbol_replaces_cell() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::TransformSymbol {
            reel: 2,
            row: 1,
            to_symbol: "H1".to_string(),
        },
    );
    assert_eq!(s.grid[2][1], "H1");
    assert_eq!(s.grid[2][0], "L1"); // neighbor unchanged
}

#[test]
fn r3_01_expand_wild_fills_reel() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::ExpandWild {
            reel: 1,
            symbol: "W".to_string(),
        },
    );
    assert_eq!(s.grid[1], vec!["W", "W", "W"]);
    assert_eq!(s.grid[0][0], "L1"); // other reel unchanged
}

#[test]
fn r3_01_lock_position_upsert_keeps_max() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 0,
            row: 0,
            remaining_spins: 3,
        },
    );
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 0,
            row: 0,
            remaining_spins: 5,
        },
    );
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 0,
            row: 0,
            remaining_spins: 2,
        },
    );
    assert_eq!(s.locked_positions.len(), 1);
    assert_eq!(s.locked_positions[0].remaining_spins, 5);
}

#[test]
fn r3_01_collect_coin_appends() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::CollectCoin {
            reel: 1,
            row: 0,
            amount: 42.0,
        },
    );
    assert_eq!(s.collected_coins.len(), 1);
    assert!((s.collected_coins[0].amount - 42.0).abs() < 1e-10);
}

#[test]
fn r3_01_trigger_feature_deduped() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::TriggerFeature {
            feature_id: "free_spins".to_string(),
        },
    );
    apply_effect(
        &mut s,
        &Effect::TriggerFeature {
            feature_id: "free_spins".to_string(),
        },
    );
    assert_eq!(s.triggered_features.len(), 1);
}

#[test]
fn r3_01_award_jackpot_once_per_spin() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::AwardJackpot {
            tier: "grand".to_string(),
            amount: 1000.0,
        },
    );
    apply_effect(
        &mut s,
        &Effect::AwardJackpot {
            tier: "minor".to_string(),
            amount: 100.0,
        },
    );
    let jp = s.jackpot_awarded.as_ref().unwrap();
    assert_eq!(jp.0, "grand");
}

#[test]
fn r3_01_upgrade_symbols_replaces_all() {
    let mut s = make_state(5, 3); // all L1
    apply_effect(
        &mut s,
        &Effect::UpgradeSymbols {
            from_symbol: "L1".to_string(),
            to_symbol: "H1".to_string(),
        },
    );
    for col in &s.grid {
        for cell in col {
            assert_eq!(cell, "H1");
        }
    }
}

#[test]
fn r3_01_scatter_pay_accumulates() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::ScatterPay {
            count: 3,
            multiplier: 5.0,
        },
    );
    apply_effect(
        &mut s,
        &Effect::ScatterPay {
            count: 4,
            multiplier: 10.0,
        },
    );
    assert!((s.scatter_payout - 15.0).abs() < 1e-10);
}

#[test]
fn r3_01_respin_increments() {
    let mut s = make_state(5, 3);
    apply_effect(&mut s, &Effect::Respin { count: 3 });
    apply_effect(&mut s, &Effect::Respin { count: 1 });
    assert_eq!(s.respins_awarded, 4);
}

#[test]
fn r3_01_apply_effects_batch_order() {
    let mut s = make_state(5, 3);
    let effects = vec![
        Effect::MultiplierMul {
            value: 2.0,
            scope: EffectScope::Spin,
        },
        Effect::MultiplierMul {
            value: 3.0,
            scope: EffectScope::Spin,
        },
        Effect::MultiplierMul {
            value: 5.0,
            scope: EffectScope::Spin,
        },
    ];
    apply_effects(&mut s, &effects);
    assert!((s.spin_multiplier - 30.0).abs() < 1e-10);
}

// ─── R3-02: tick_locked_positions / restore ───────────────────────────────────

#[test]
fn r3_02_tick_decrements_remaining() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 0,
            row: 0,
            remaining_spins: 3,
        },
    );
    tick_locked_positions(&mut s);
    assert_eq!(s.locked_positions[0].remaining_spins, 2);
}

#[test]
fn r3_02_tick_removes_expired() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 0,
            row: 0,
            remaining_spins: 1,
        },
    );
    let released = tick_locked_positions(&mut s);
    assert!(s.locked_positions.is_empty());
    assert_eq!(released.len(), 1);
}

#[test]
fn r3_02_restore_overwrites_grid() {
    let mut s = make_state(5, 3);
    s.grid[2][1] = "W".to_string();
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 2,
            row: 1,
            remaining_spins: 3,
        },
    );
    // Simulate reel re-draw
    s.grid[2][1] = "H1".to_string();
    restore_locked_positions(&mut s);
    assert_eq!(s.grid[2][1], "W");
}

#[test]
fn r3_02_multiple_locks_survive_partial_tick() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 0,
            row: 0,
            remaining_spins: 2,
        },
    );
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 1,
            row: 0,
            remaining_spins: 1,
        },
    );
    tick_locked_positions(&mut s);
    // Position [0,0] still alive, [1,0] expired
    assert_eq!(s.locked_positions.len(), 1);
    assert_eq!(s.locked_positions[0].reel, 0);
}

// ─── R3-03: WildBehavior ─────────────────────────────────────────────────────

#[test]
fn r3_03_wild_on_land_empty() {
    let s = make_state(5, 3);
    let b = WildBehavior {
        id: "W".to_string(),
    };
    let ctx = make_ctx("W", 2, 1, &s);
    assert!(b.on_land(&ctx).is_empty());
}

#[test]
fn r3_03_wild_on_win_empty() {
    let s = make_state(5, 3);
    let b = WildBehavior {
        id: "W".to_string(),
    };
    let ctx = make_ctx("W", 2, 1, &s);
    assert!(b.on_win(&ctx).is_empty());
}

#[test]
fn r3_03_wild_kind_and_id() {
    let b = WildBehavior {
        id: "WLD".to_string(),
    };
    assert_eq!(b.id(), "WLD");
    assert_eq!(b.kind(), "WildBehavior");
}

// ─── R3-04: ExpandingWildBehavior ────────────────────────────────────────────

#[test]
fn r3_04_expanding_on_land_emits_expand() {
    let s = make_state(5, 3);
    let b = ExpandingWildBehavior {
        id: "EW".to_string(),
        on_win_only: false,
    };
    let ctx = make_ctx("EW", 3, 1, &s);
    let effects = b.on_land(&ctx);
    assert_eq!(effects.len(), 1);
    match &effects[0] {
        Effect::ExpandWild { reel, .. } => assert_eq!(*reel, 3),
        _ => panic!("expected ExpandWild"),
    }
}

#[test]
fn r3_04_expanding_on_land_empty_when_win_only() {
    let s = make_state(5, 3);
    let b = ExpandingWildBehavior {
        id: "EW".to_string(),
        on_win_only: true,
    };
    let ctx = make_ctx("EW", 3, 1, &s);
    assert!(b.on_land(&ctx).is_empty());
}

#[test]
fn r3_04_expanding_on_win_emits_when_win_only() {
    let s = make_state(5, 3);
    let b = ExpandingWildBehavior {
        id: "EW".to_string(),
        on_win_only: true,
    };
    let ctx = make_ctx("EW", 2, 0, &s);
    assert!(!b.on_win(&ctx).is_empty());
}

#[test]
fn r3_04_expand_effect_fills_reel() {
    let mut s = make_state(5, 3);
    let b = ExpandingWildBehavior {
        id: "EW".to_string(),
        on_win_only: false,
    };
    let effects = b.on_land(&make_ctx("EW", 1, 2, &s));
    apply_effects(&mut s, &effects);
    assert_eq!(s.grid[1], vec!["EW", "EW", "EW"]);
}

// ─── R3-05: StickyWildBehavior ───────────────────────────────────────────────

#[test]
fn r3_05_sticky_on_land_emits_lock() {
    let s = make_state(5, 3);
    let b = StickyWildBehavior {
        id: "SW".to_string(),
        duration: 3,
        upgrade_on_win: false,
    };
    let effects = b.on_land(&make_ctx("SW", 2, 1, &s));
    assert_eq!(effects.len(), 1);
    match &effects[0] {
        Effect::LockPosition {
            remaining_spins, ..
        } => assert_eq!(*remaining_spins, 3),
        _ => panic!("expected LockPosition"),
    }
}

#[test]
fn r3_05_sticky_on_win_empty_without_upgrade() {
    let s = make_state(5, 3);
    let b = StickyWildBehavior {
        id: "SW".to_string(),
        duration: 3,
        upgrade_on_win: false,
    };
    assert!(b.on_win(&make_ctx("SW", 0, 0, &s)).is_empty());
}

#[test]
fn r3_05_sticky_upgrade_on_win_extends_lock() {
    let mut s = make_state(5, 3);
    apply_effect(
        &mut s,
        &Effect::LockPosition {
            reel: 0,
            row: 0,
            remaining_spins: 2,
        },
    );
    let b = StickyWildBehavior {
        id: "SW".to_string(),
        duration: 3,
        upgrade_on_win: true,
    };
    let effects = b.on_win(&make_ctx("SW", 0, 0, &s));
    assert!(!effects.is_empty());
    match &effects[0] {
        Effect::LockPosition {
            remaining_spins, ..
        } => assert_eq!(*remaining_spins, 3),
        _ => panic!("expected LockPosition"),
    }
}

#[test]
fn r3_05_sticky_persists_across_spins() {
    let mut s = make_state(5, 3);
    let b = StickyWildBehavior {
        id: "SW".to_string(),
        duration: 2,
        upgrade_on_win: false,
    };
    let effects = b.on_land(&make_ctx("SW", 1, 1, &s));
    apply_effects(&mut s, &effects);
    assert_eq!(s.locked_positions[0].remaining_spins, 2);
    tick_locked_positions(&mut s);
    assert_eq!(s.locked_positions[0].remaining_spins, 1);
    tick_locked_positions(&mut s);
    assert!(s.locked_positions.is_empty());
}

#[test]
fn r3_05_sticky_kind() {
    let b = StickyWildBehavior {
        id: "SW".to_string(),
        duration: 3,
        upgrade_on_win: false,
    };
    assert_eq!(b.kind(), "StickyWildBehavior");
}

// ─── R3-06: MultiplierWildBehavior ───────────────────────────────────────────

#[test]
fn r3_06_mul_wild_on_land_empty() {
    let s = make_state(5, 3);
    let b = MultiplierWildBehavior {
        id: "MW".to_string(),
        value: 2.0,
        scope: EffectScope::Line,
        mul: true,
    };
    assert!(b.on_land(&make_ctx("MW", 0, 0, &s)).is_empty());
}

#[test]
fn r3_06_mul_wild_on_win_emits_mul() {
    let s = make_state(5, 3);
    let b = MultiplierWildBehavior {
        id: "MW".to_string(),
        value: 3.0,
        scope: EffectScope::Spin,
        mul: true,
    };
    let effects = b.on_win(&make_ctx("MW", 0, 0, &s));
    match &effects[0] {
        Effect::MultiplierMul { value, .. } => assert!((value - 3.0).abs() < 1e-10),
        _ => panic!("expected MultiplierMul"),
    }
}

#[test]
fn r3_06_mul_wild_additive_mode() {
    let s = make_state(5, 3);
    let b = MultiplierWildBehavior {
        id: "MW".to_string(),
        value: 2.0,
        scope: EffectScope::Line,
        mul: false,
    };
    match &b.on_win(&make_ctx("MW", 0, 0, &s))[0] {
        Effect::MultiplierAdd { .. } => {}
        _ => panic!("expected MultiplierAdd"),
    }
}

#[test]
fn r3_06_two_mul_wilds_stack_to_x4() {
    let mut s = make_state(5, 3);
    let b = MultiplierWildBehavior {
        id: "MW".to_string(),
        value: 2.0,
        scope: EffectScope::Spin,
        mul: true,
    };
    let e1 = b.on_win(&make_ctx("MW", 0, 0, &s));
    apply_effects(&mut s, &e1);
    let e2 = b.on_win(&make_ctx("MW", 1, 0, &s));
    apply_effects(&mut s, &e2);
    assert!((s.spin_multiplier - 4.0).abs() < 1e-10);
}

// ─── R3-07: ScatterBehavior ──────────────────────────────────────────────────

#[test]
fn r3_07_scatter_no_trigger_below_threshold() {
    let mut s = make_state(5, 3);
    s.grid[0][0] = "SC".to_string();
    s.grid[1][0] = "SC".to_string(); // 2 scatters, threshold = 3
    let b = ScatterBehavior {
        id: "SC".to_string(),
        feature_id: "free_spins".to_string(),
        trigger_count: 3,
        scatter_pays: HashMap::new(),
    };
    let effects = b.on_land(&make_ctx("SC", 0, 0, &s));
    assert!(!effects
        .iter()
        .any(|e| matches!(e, Effect::TriggerFeature { .. })));
}

#[test]
fn r3_07_scatter_triggers_at_threshold() {
    let mut s = make_state(5, 3);
    s.grid[0][0] = "SC".to_string();
    s.grid[1][0] = "SC".to_string();
    s.grid[2][0] = "SC".to_string();
    let b = ScatterBehavior {
        id: "SC".to_string(),
        feature_id: "free_spins".to_string(),
        trigger_count: 3,
        scatter_pays: HashMap::new(),
    };
    let effects = b.on_land(&make_ctx("SC", 0, 0, &s));
    assert!(effects
        .iter()
        .any(|e| matches!(e, Effect::TriggerFeature { .. })));
}

#[test]
fn r3_07_scatter_pay_emitted_for_count() {
    let mut s = make_state(5, 3);
    for i in 0..3 {
        s.grid[i][0] = "SC".to_string();
    }
    let mut pays = HashMap::new();
    pays.insert(3, 5.0);
    let b = ScatterBehavior {
        id: "SC".to_string(),
        feature_id: "free_spins".to_string(),
        trigger_count: 3,
        scatter_pays: pays,
    };
    let effects = b.on_land(&make_ctx("SC", 0, 0, &s));
    assert!(effects.iter().any(
        |e| matches!(e, Effect::ScatterPay { multiplier, .. } if (*multiplier - 5.0).abs() < 1e-10)
    ));
}

#[test]
fn r3_07_scatter_on_win_empty() {
    let s = make_state(5, 3);
    let b = ScatterBehavior {
        id: "SC".to_string(),
        feature_id: "free_spins".to_string(),
        trigger_count: 3,
        scatter_pays: HashMap::new(),
    };
    assert!(b.on_win(&make_ctx("SC", 0, 0, &s)).is_empty());
}

#[test]
fn r3_07_scatter_deduped_in_state() {
    let mut s = make_state(5, 3);
    for i in 0..3 {
        s.grid[i][0] = "SC".to_string();
    }
    let b = ScatterBehavior {
        id: "SC".to_string(),
        feature_id: "free_spins".to_string(),
        trigger_count: 3,
        scatter_pays: HashMap::new(),
    };
    for i in 0..3 {
        let effects = b.on_land(&make_ctx("SC", i, 0, &s));
        apply_effects(&mut s, &effects);
    }
    assert_eq!(s.triggered_features.len(), 1);
}

// ─── R3-08: CoinBehavior ─────────────────────────────────────────────────────

#[test]
fn r3_08_coin_on_land_collects_coin() {
    let mut s = make_state(5, 3);
    s.grid[0][0] = "COIN".to_string();
    let b = CoinBehavior {
        id: "COIN".to_string(),
        feature_id: "hold_and_win".to_string(),
        trigger_count: 6,
        default_amount: 5.0,
        respins_reset: 3,
    };
    let effects = b.on_land(&make_ctx("COIN", 0, 0, &s));
    assert!(effects
        .iter()
        .any(|e| matches!(e, Effect::CollectCoin { amount, .. } if (*amount - 5.0).abs() < 1e-10)));
}

#[test]
fn r3_08_coin_triggers_when_threshold_met() {
    let mut s = make_state(5, 3);
    for reel in 0..3 {
        for row in 0..2 {
            s.grid[reel][row] = "COIN".to_string();
        }
    }
    // 6 coins exactly matches trigger_count = 6
    let b = CoinBehavior {
        id: "COIN".to_string(),
        feature_id: "hold_and_win".to_string(),
        trigger_count: 6,
        default_amount: 1.0,
        respins_reset: 3,
    };
    let effects = b.on_land(&make_ctx("COIN", 0, 0, &s));
    assert!(effects
        .iter()
        .any(|e| matches!(e, Effect::TriggerFeature { .. })));
}

#[test]
fn r3_08_coin_respin_during_hnw() {
    let mut s = make_state(5, 3);
    s.grid[0][0] = "COIN".to_string();
    s.triggered_features.insert("hold_and_win".to_string());
    let b = CoinBehavior {
        id: "COIN".to_string(),
        feature_id: "hold_and_win".to_string(),
        trigger_count: 6,
        default_amount: 1.0,
        respins_reset: 3,
    };
    let effects = b.on_land(&make_ctx("COIN", 0, 0, &s));
    assert!(effects
        .iter()
        .any(|e| matches!(e, Effect::Respin { count } if *count == 3)));
}

#[test]
fn r3_08_coin_on_win_empty() {
    let s = make_state(5, 3);
    let b = CoinBehavior {
        id: "COIN".to_string(),
        feature_id: "hold_and_win".to_string(),
        trigger_count: 6,
        default_amount: 1.0,
        respins_reset: 3,
    };
    assert!(b.on_win(&make_ctx("COIN", 0, 0, &s)).is_empty());
}

#[test]
fn r3_08_coin_kind() {
    let b = CoinBehavior {
        id: "COIN".to_string(),
        feature_id: "hold_and_win".to_string(),
        trigger_count: 6,
        default_amount: 1.0,
        respins_reset: 3,
    };
    assert_eq!(b.kind(), "CoinBehavior");
}

// ─── R3-09: JackpotBehavior ──────────────────────────────────────────────────

#[test]
fn r3_09_jackpot_on_win_emits() {
    let s = make_state(5, 3);
    let b = JackpotBehavior {
        id: "JP".to_string(),
        tier: "grand".to_string(),
        amount: 1000.0,
        trigger_on: JackpotTrigger::Win,
        min_count: 1,
    };
    let effects = b.on_win(&make_ctx("JP", 0, 0, &s));
    assert!(!effects.is_empty());
    match &effects[0] {
        Effect::AwardJackpot { tier, amount } => {
            assert_eq!(tier, "grand");
            assert!((*amount - 1000.0).abs() < 1e-10);
        }
        _ => panic!("expected AwardJackpot"),
    }
}

#[test]
fn r3_09_jackpot_on_land_empty_by_default() {
    let s = make_state(5, 3);
    let b = JackpotBehavior {
        id: "JP".to_string(),
        tier: "grand".to_string(),
        amount: 1000.0,
        trigger_on: JackpotTrigger::Win,
        min_count: 1,
    };
    assert!(b.on_land(&make_ctx("JP", 0, 0, &s)).is_empty());
}

#[test]
fn r3_09_jackpot_min_count_gate() {
    let mut s = make_state(5, 3);
    s.grid[0][0] = "JP".to_string();
    s.grid[1][0] = "JP".to_string(); // 2 instances, threshold=3
    let b = JackpotBehavior {
        id: "JP".to_string(),
        tier: "grand".to_string(),
        amount: 1000.0,
        trigger_on: JackpotTrigger::Win,
        min_count: 3,
    };
    assert!(b.on_win(&make_ctx("JP", 0, 0, &s)).is_empty());

    s.grid[2][0] = "JP".to_string(); // 3 instances = threshold met
    assert!(!b.on_win(&make_ctx("JP", 0, 0, &s)).is_empty());
}

#[test]
fn r3_09_jackpot_only_once_per_spin() {
    let mut s = make_state(5, 3);
    let b = JackpotBehavior {
        id: "JP".to_string(),
        tier: "grand".to_string(),
        amount: 1000.0,
        trigger_on: JackpotTrigger::Win,
        min_count: 1,
    };
    let e1 = b.on_win(&make_ctx("JP", 0, 0, &s));
    apply_effects(&mut s, &e1);
    let b2 = JackpotBehavior {
        id: "JP2".to_string(),
        tier: "minor".to_string(),
        amount: 100.0,
        trigger_on: JackpotTrigger::Win,
        min_count: 1,
    };
    let e2 = b2.on_win(&make_ctx("JP2", 1, 0, &s));
    apply_effects(&mut s, &e2);
    assert_eq!(s.jackpot_awarded.as_ref().unwrap().0, "grand");
}

// ─── R3-10: BehaviorRegistry ─────────────────────────────────────────────────

#[test]
fn r3_10_registry_register_and_get() {
    let mut reg = BehaviorRegistry::new();
    reg.register(
        "W",
        Box::new(WildBehavior {
            id: "W".to_string(),
        }),
    );
    assert!(reg.has("W"));
    assert!(reg.get("W").is_some());
}

#[test]
fn r3_10_registry_not_found() {
    let reg = BehaviorRegistry::new();
    assert!(!reg.has("SC"));
    assert!(reg.get("SC").is_none());
}

#[test]
#[should_panic(expected = "duplicate")]
fn r3_10_registry_duplicate_panics() {
    let mut reg = BehaviorRegistry::new();
    reg.register(
        "W",
        Box::new(WildBehavior {
            id: "W".to_string(),
        }),
    );
    reg.register(
        "W",
        Box::new(WildBehavior {
            id: "W".to_string(),
        }),
    );
}

#[test]
fn r3_10_registry_override_no_panic() {
    let mut reg = BehaviorRegistry::new();
    reg.register(
        "W",
        Box::new(WildBehavior {
            id: "W".to_string(),
        }),
    );
    reg.override_behavior(
        "W",
        Box::new(ExpandingWildBehavior {
            id: "W".to_string(),
            on_win_only: false,
        }),
    );
    assert_eq!(reg.get("W").unwrap().kind(), "ExpandingWildBehavior");
}

// ─── R3-11: Integration ──────────────────────────────────────────────────────

#[test]
fn r3_11_scatter_pipeline_triggers_free_spins() {
    let mut s = make_state(5, 3);
    s.grid[0][0] = "SC".to_string();
    s.grid[1][0] = "SC".to_string();
    s.grid[2][0] = "SC".to_string();
    let mut reg = BehaviorRegistry::new();
    reg.register(
        "SC",
        Box::new(ScatterBehavior {
            id: "SC".to_string(),
            feature_id: "free_spins".to_string(),
            trigger_count: 3,
            scatter_pays: HashMap::new(),
        }),
    );

    for reel in 0..5 {
        for row in 0..3 {
            let sym = s.grid[reel][row].clone();
            if let Some(b) = reg.get(&sym) {
                let effects = b.on_land(&make_ctx(&sym, reel, row, &s));
                apply_effects(&mut s, &effects);
            }
        }
    }

    assert!(s.triggered_features.contains("free_spins"));
}

#[test]
fn r3_11_mul_wilds_accumulate_via_on_win() {
    let mut s = make_state(5, 3);
    let mut reg = BehaviorRegistry::new();
    reg.register(
        "MW",
        Box::new(MultiplierWildBehavior {
            id: "MW".to_string(),
            value: 2.0,
            scope: EffectScope::Spin,
            mul: true,
        }),
    );

    let winning = vec![("MW", 0usize, 0usize), ("MW", 1, 0)];
    for (sym, reel, row) in &winning {
        if let Some(b) = reg.get(*sym) {
            let effects = b.on_win(&make_ctx(sym, *reel, *row, &s));
            apply_effects(&mut s, &effects);
        }
    }
    assert!((s.spin_multiplier - 4.0).abs() < 1e-10);
}

#[test]
fn r3_11_expanding_wild_fills_reel_via_pipeline() {
    let mut s = make_state(5, 3);
    s.grid[2][1] = "EW".to_string();
    let mut reg = BehaviorRegistry::new();
    reg.register(
        "EW",
        Box::new(ExpandingWildBehavior {
            id: "EW".to_string(),
            on_win_only: false,
        }),
    );

    // Run onLand for all cells
    for reel in 0..5 {
        for row in 0..3 {
            let sym = s.grid[reel][row].clone();
            if let Some(b) = reg.get(&sym) {
                let effects = b.on_land(&make_ctx(&sym, reel, row, &s));
                apply_effects(&mut s, &effects);
            }
        }
    }
    assert_eq!(s.grid[2], vec!["EW", "EW", "EW"]);
}

#[test]
fn r3_11_sticky_wild_lock_persists_and_restores() {
    let mut s = make_state(5, 3);
    s.grid[1][2] = "SW".to_string();
    let mut reg = BehaviorRegistry::new();
    reg.register(
        "SW",
        Box::new(StickyWildBehavior {
            id: "SW".to_string(),
            duration: 3,
            upgrade_on_win: false,
        }),
    );

    // spin 1: land
    let effects = reg.get("SW").unwrap().on_land(&make_ctx("SW", 1, 2, &s));
    apply_effects(&mut s, &effects);
    assert_eq!(s.locked_positions.len(), 1);

    // spin 2: reel re-drawn, restore locked
    s.grid[1][2] = "H1".to_string(); // simulated random draw
    restore_locked_positions(&mut s);
    assert_eq!(s.grid[1][2], "SW"); // restored

    // tick
    tick_locked_positions(&mut s);
    assert_eq!(s.locked_positions[0].remaining_spins, 2);
}
