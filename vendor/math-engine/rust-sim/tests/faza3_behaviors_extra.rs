//! Faza 3 — EXTRA behavior unit tests (W235 mutation hardening)
//!
//! Adds direct unit-test coverage for behaviors that were previously
//! exercised only indirectly via integration paths:
//!
//! - MultiplierSymbolBehavior — `trigger_on` 3 modes × (mul / add) branches
//! - MysteryBehavior          — `draw` weighted distribution + on_land/on_win
//! - TransformBehavior        — SelfPos / Adjacent / All trigger variants
//! - WalkingWildBehavior      — 4 directions × (bounce / disappear) edges
//!
//! Goal: kill mutants in `rust-sim/src/behavior/impls.rs` that survived the
//! `faza3_behaviors.rs` + `ir_cascade_respin_mystery.rs` suites.

use slot_sim::behavior::impls::{
    CoinBehavior, ExpandingWildBehavior, JackpotBehavior, JackpotTrigger,
    MultiplierSymbolBehavior, MultiplierTrigger, MultiplierWildBehavior, MysteryBehavior,
    ScatterBehavior, StickyWildBehavior, TransformBehavior, TransformRule, TransformTrigger,
    WalkDirection, WalkingWildBehavior, WildBehavior,
};
use slot_sim::behavior::{
    BehaviorContext, Effect, EffectScope, SpinState, SymbolBehavior,
};
use std::collections::HashMap;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn make_grid(reels: usize, rows: usize, fill: &str) -> Vec<Vec<String>> {
    vec![vec![fill.to_string(); rows]; reels]
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

// ─── R3X-00: id() + kind() smoke (kills `xyzzy` / wrong-kind mutants) ───────

#[test]
fn r3x_00_all_behaviors_return_their_own_id_and_kind() {
    // Wild
    let w = WildBehavior { id: "W".into() };
    assert_eq!(w.id(), "W");
    assert_eq!(w.kind(), "WildBehavior");

    // ExpandingWild
    let ew = ExpandingWildBehavior {
        id: "EW".into(),
        on_win_only: false,
    };
    assert_eq!(ew.id(), "EW");
    assert_eq!(ew.kind(), "ExpandingWildBehavior");

    // StickyWild
    let sw = StickyWildBehavior {
        id: "SW".into(),
        duration: 1,
        upgrade_on_win: false,
    };
    assert_eq!(sw.id(), "SW");
    assert_eq!(sw.kind(), "StickyWildBehavior");

    // MultiplierWild
    let mw = MultiplierWildBehavior {
        id: "MW".into(),
        value: 2.0,
        scope: EffectScope::Line,
        mul: true,
    };
    assert_eq!(mw.id(), "MW");
    assert_eq!(mw.kind(), "MultiplierWildBehavior");

    // Scatter
    let sc = ScatterBehavior {
        id: "SC".into(),
        feature_id: "fs".into(),
        trigger_count: 3,
        scatter_pays: HashMap::new(),
    };
    assert_eq!(sc.id(), "SC");
    assert_eq!(sc.kind(), "ScatterBehavior");

    // Coin
    let co = CoinBehavior {
        id: "CO".into(),
        feature_id: "fs".into(),
        trigger_count: 6,
        default_amount: 1.0,
        respins_reset: 3,
    };
    assert_eq!(co.id(), "CO");
    assert_eq!(co.kind(), "CoinBehavior");

    // MultiplierSymbol
    let ms = MultiplierSymbolBehavior {
        id: "MS".into(),
        value: 2.0,
        scope: EffectScope::Line,
        mul: true,
        trigger_on: MultiplierTrigger::Land,
    };
    assert_eq!(ms.id(), "MS");
    assert_eq!(ms.kind(), "MultiplierSymbolBehavior");

    // Mystery
    let my = MysteryBehavior::new("MY".into(), vec![("L1".into(), 1.0)]);
    assert_eq!(my.id(), "MY");
    assert_eq!(my.kind(), "MysteryBehavior");

    // Jackpot
    let jp = JackpotBehavior {
        id: "JP".into(),
        tier: "MINI".into(),
        amount: 10.0,
        trigger_on: JackpotTrigger::Land,
        min_count: 1,
    };
    assert_eq!(jp.id(), "JP");
    assert_eq!(jp.kind(), "JackpotBehavior");

    // Transform
    let tr = TransformBehavior {
        id: "TR".into(),
        rules: vec![],
    };
    assert_eq!(tr.id(), "TR");
    assert_eq!(tr.kind(), "TransformBehavior");

    // WalkingWild
    let ww = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    assert_eq!(ww.id(), "WW");
    assert_eq!(ww.kind(), "WalkingWildBehavior");
}

// ─── R3X-01: MultiplierSymbolBehavior ────────────────────────────────────────

#[test]
fn r3x_01_multiplier_symbol_land_mul_emits_mul_effect() {
    let b = MultiplierSymbolBehavior {
        id: "M3".into(),
        value: 3.0,
        scope: EffectScope::Line,
        mul: true,
        trigger_on: MultiplierTrigger::Land,
    };
    let st = SpinState::new(make_grid(3, 3, "X"));
    let ctx = make_ctx("M3", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 1);
    match &out[0] {
        Effect::MultiplierMul { value, scope } => {
            assert!((*value - 3.0).abs() < 1e-12);
            assert_eq!(*scope, EffectScope::Line);
        }
        other => panic!("expected MultiplierMul, got {:?}", other),
    }
    // on_win path on Land trigger must be empty.
    assert!(b.on_win(&ctx).is_empty());
}

#[test]
fn r3x_01_multiplier_symbol_land_add_emits_add_effect() {
    let b = MultiplierSymbolBehavior {
        id: "A5".into(),
        value: 5.0,
        scope: EffectScope::Spin,
        mul: false,
        trigger_on: MultiplierTrigger::Land,
    };
    let st = SpinState::new(make_grid(3, 3, "X"));
    let ctx = make_ctx("A5", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 1);
    match &out[0] {
        Effect::MultiplierAdd { value, scope } => {
            assert!((*value - 5.0).abs() < 1e-12);
            assert_eq!(*scope, EffectScope::Spin);
        }
        other => panic!("expected MultiplierAdd, got {:?}", other),
    }
}

#[test]
fn r3x_01_multiplier_symbol_win_trigger_only_fires_on_win() {
    let b = MultiplierSymbolBehavior {
        id: "W2".into(),
        value: 2.0,
        scope: EffectScope::Ways,
        mul: true,
        trigger_on: MultiplierTrigger::Win,
    };
    let st = SpinState::new(make_grid(3, 3, "X"));
    let ctx = make_ctx("W2", 0, 0, &st);
    assert!(b.on_land(&ctx).is_empty(), "Win trigger must skip on_land");
    let out = b.on_win(&ctx);
    assert_eq!(out.len(), 1);
    match &out[0] {
        Effect::MultiplierMul { scope, .. } => assert_eq!(*scope, EffectScope::Ways),
        other => panic!("expected MultiplierMul, got {:?}", other),
    }
}

#[test]
fn r3x_01_multiplier_symbol_both_trigger_fires_on_land_and_win() {
    let b = MultiplierSymbolBehavior {
        id: "B4".into(),
        value: 4.0,
        scope: EffectScope::Session,
        mul: false,
        trigger_on: MultiplierTrigger::Both,
    };
    let st = SpinState::new(make_grid(3, 3, "X"));
    let ctx = make_ctx("B4", 0, 0, &st);
    let on_land = b.on_land(&ctx);
    let on_win = b.on_win(&ctx);
    assert_eq!(on_land.len(), 1);
    assert_eq!(on_win.len(), 1);
    assert_eq!(on_land, on_win, "Both should emit identical effect");
    if let Effect::MultiplierAdd { scope, .. } = &on_land[0] {
        assert_eq!(*scope, EffectScope::Session);
    } else {
        panic!("expected MultiplierAdd (mul=false)");
    }
}

// ─── R3X-02: MysteryBehavior ────────────────────────────────────────────────

#[test]
fn r3x_02_mystery_draw_picks_first_bucket_at_zero() {
    let b = MysteryBehavior::new("MY".into(), vec![("L1".into(), 1.0), ("L2".into(), 9.0)]);
    // total = 10. t = 0 → target = 0 → falls into first bucket (cum=1.0).
    assert_eq!(b.draw(0.0), "L1");
}

#[test]
fn r3x_02_mystery_draw_picks_first_bucket_at_boundary() {
    let b = MysteryBehavior::new("MY".into(), vec![("L1".into(), 1.0), ("L2".into(), 9.0)]);
    // target = 0.1 * 10 = 1.0 → equals first cum → still L1 (uses <=).
    assert_eq!(b.draw(0.1), "L1");
}

#[test]
fn r3x_02_mystery_draw_picks_second_bucket_above_boundary() {
    let b = MysteryBehavior::new("MY".into(), vec![("L1".into(), 1.0), ("L2".into(), 9.0)]);
    // target = 0.2 * 10 = 2.0 → > 1.0, ≤ 10.0 → L2.
    assert_eq!(b.draw(0.2), "L2");
}

#[test]
fn r3x_02_mystery_draw_picks_last_bucket_near_one() {
    let b = MysteryBehavior::new(
        "MY".into(),
        vec![("L1".into(), 1.0), ("L2".into(), 1.0), ("L3".into(), 1.0)],
    );
    assert_eq!(b.draw(0.99), "L3");
}

#[test]
fn r3x_02_mystery_on_land_with_no_matching_positions_emits_nothing() {
    let b = MysteryBehavior::new("MY".into(), vec![("L1".into(), 1.0)]);
    let st = SpinState::new(make_grid(3, 3, "X")); // grid full of "X", not "MY"
    let ctx = make_ctx("MY", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert!(out.is_empty(), "no MY positions → no effects");
}

#[test]
fn r3x_02_mystery_on_land_transforms_all_matching_positions_to_same_symbol() {
    let b = MysteryBehavior::new("MY".into(), vec![("L1".into(), 1.0)]);
    // grid with 3 "MY" cells at known positions.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "MY".into();
    grid[1][2] = "MY".into();
    grid[2][1] = "MY".into();
    let st = SpinState::new(grid);
    let ctx = make_ctx("MY", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 3, "one TransformSymbol per MY cell");

    // All targets must be the same symbol (single draw broadcast).
    let mut to_symbols: Vec<&str> = Vec::new();
    let mut positions: Vec<(usize, usize)> = Vec::new();
    for e in &out {
        if let Effect::TransformSymbol {
            reel,
            row,
            to_symbol,
        } = e
        {
            to_symbols.push(to_symbol.as_str());
            positions.push((*reel, *row));
        } else {
            panic!("expected TransformSymbol");
        }
    }
    assert!(
        to_symbols.iter().all(|s| *s == to_symbols[0]),
        "all targets must be identical (single draw)"
    );
    positions.sort();
    assert_eq!(positions, vec![(0, 0), (1, 2), (2, 1)]);
}

#[test]
fn r3x_02_mystery_on_win_returns_empty() {
    let b = MysteryBehavior::new("MY".into(), vec![("L1".into(), 1.0)]);
    let st = SpinState::new(make_grid(3, 3, "MY"));
    let ctx = make_ctx("MY", 0, 0, &st);
    assert!(b.on_win(&ctx).is_empty());
}

// ─── R3X-03: TransformBehavior ──────────────────────────────────────────────

#[test]
fn r3x_03_transform_self_pos_matches_and_emits_one_effect() {
    let mut grid = make_grid(3, 3, "X");
    grid[1][1] = "A".into();
    let st = SpinState::new(grid);
    let b = TransformBehavior {
        id: "T".into(),
        rules: vec![TransformRule {
            trigger: TransformTrigger::SelfPos,
            from: "A".into(),
            to: "B".into(),
        }],
    };
    let ctx = make_ctx("T", 1, 1, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 1);
    match &out[0] {
        Effect::TransformSymbol {
            reel,
            row,
            to_symbol,
        } => {
            assert_eq!(*reel, 1);
            assert_eq!(*row, 1);
            assert_eq!(to_symbol, "B");
        }
        other => panic!("expected TransformSymbol, got {:?}", other),
    }
}

#[test]
fn r3x_03_transform_self_pos_no_match_emits_nothing() {
    let st = SpinState::new(make_grid(3, 3, "X"));
    let b = TransformBehavior {
        id: "T".into(),
        rules: vec![TransformRule {
            trigger: TransformTrigger::SelfPos,
            from: "A".into(), // not present in grid
            to: "B".into(),
        }],
    };
    let ctx = make_ctx("T", 1, 1, &st);
    assert!(b.on_land(&ctx).is_empty());
}

#[test]
fn r3x_03_transform_adjacent_finds_4_neighbors() {
    // Place "A" in all 4 orthogonal neighbors of (1,1).
    let mut grid = make_grid(3, 3, "X");
    grid[0][1] = "A".into(); // left
    grid[2][1] = "A".into(); // right
    grid[1][0] = "A".into(); // up
    grid[1][2] = "A".into(); // down
    let st = SpinState::new(grid);
    let b = TransformBehavior {
        id: "T".into(),
        rules: vec![TransformRule {
            trigger: TransformTrigger::Adjacent,
            from: "A".into(),
            to: "B".into(),
        }],
    };
    let ctx = make_ctx("T", 1, 1, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 4, "all 4 neighbors should be transformed");
    let mut positions: Vec<(usize, usize)> = out
        .iter()
        .map(|e| {
            if let Effect::TransformSymbol { reel, row, .. } = e {
                (*reel, *row)
            } else {
                panic!()
            }
        })
        .collect();
    positions.sort();
    assert_eq!(positions, vec![(0, 1), (1, 0), (1, 2), (2, 1)]);
}

#[test]
fn r3x_03_transform_adjacent_at_corner_skips_out_of_bounds() {
    // Place "A" at (1,0) and (0,1) only — neighbors of corner (0,0).
    // Note: wrapping_sub gives a huge index for (0-1), which `grid.get` returns None for.
    let mut grid = make_grid(3, 3, "X");
    grid[1][0] = "A".into();
    grid[0][1] = "A".into();
    let st = SpinState::new(grid);
    let b = TransformBehavior {
        id: "T".into(),
        rules: vec![TransformRule {
            trigger: TransformTrigger::Adjacent,
            from: "A".into(),
            to: "B".into(),
        }],
    };
    let ctx = make_ctx("T", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(
        out.len(),
        2,
        "only 2 in-bounds neighbors should be transformed"
    );
}

#[test]
fn r3x_03_transform_all_scans_full_grid() {
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "A".into();
    grid[1][1] = "A".into();
    grid[2][2] = "A".into();
    let st = SpinState::new(grid);
    let b = TransformBehavior {
        id: "T".into(),
        rules: vec![TransformRule {
            trigger: TransformTrigger::All,
            from: "A".into(),
            to: "B".into(),
        }],
    };
    let ctx = make_ctx("T", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 3);
    let mut positions: Vec<(usize, usize)> = out
        .iter()
        .map(|e| {
            if let Effect::TransformSymbol {
                reel,
                row,
                to_symbol,
            } = e
            {
                assert_eq!(to_symbol, "B");
                (*reel, *row)
            } else {
                panic!()
            }
        })
        .collect();
    positions.sort();
    assert_eq!(positions, vec![(0, 0), (1, 1), (2, 2)]);
}

#[test]
fn r3x_03_transform_multiple_rules_apply_in_order() {
    let mut grid = make_grid(2, 2, "X");
    grid[0][0] = "A".into();
    grid[1][1] = "C".into();
    let st = SpinState::new(grid);
    let b = TransformBehavior {
        id: "T".into(),
        rules: vec![
            TransformRule {
                trigger: TransformTrigger::All,
                from: "A".into(),
                to: "B".into(),
            },
            TransformRule {
                trigger: TransformTrigger::All,
                from: "C".into(),
                to: "D".into(),
            },
        ],
    };
    let ctx = make_ctx("T", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 2);
}

#[test]
fn r3x_03_transform_on_win_returns_empty() {
    let st = SpinState::new(make_grid(2, 2, "X"));
    let b = TransformBehavior {
        id: "T".into(),
        rules: vec![],
    };
    let ctx = make_ctx("T", 0, 0, &st);
    assert!(b.on_win(&ctx).is_empty());
}

// ─── R3X-04: WalkingWildBehavior ────────────────────────────────────────────

#[test]
fn r3x_04_walking_on_land_locks_current_position_with_sentinel() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    let ctx = make_ctx("WW", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 1);
    if let Effect::LockPosition {
        reel,
        row,
        remaining_spins,
    } = &out[0]
    {
        assert_eq!(*reel, 0);
        assert_eq!(*row, 0);
        assert_eq!(*remaining_spins, 9999, "WALK_SENTINEL value");
    } else {
        panic!("expected LockPosition");
    }
}

#[test]
fn r3x_04_walking_on_win_returns_empty() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    let ctx = make_ctx("WW", 0, 0, &st);
    assert!(b.on_win(&ctx).is_empty());
}

#[test]
fn r3x_04_walking_right_moves_one_reel_right() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    let ctx = make_ctx("WW", 1, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 2, "should move right (+1 reel)");
        assert_eq!(*row, 1);
    } else {
        panic!("expected AddWild first");
    }
}

#[test]
fn r3x_04_walking_left_moves_one_reel_left() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Left,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    let ctx = make_ctx("WW", 3, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 2, "should move left (-1 reel)");
        assert_eq!(*row, 1);
    } else {
        panic!("expected AddWild first");
    }
}

#[test]
fn r3x_04_walking_up_moves_one_row_up() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Up,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    let ctx = make_ctx("WW", 1, 2, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 1);
        assert_eq!(*row, 1, "should move up (-1 row)");
    } else {
        panic!("expected AddWild first");
    }
}

#[test]
fn r3x_04_walking_down_moves_one_row_down() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Down,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    let ctx = make_ctx("WW", 1, 0, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 1);
        assert_eq!(*row, 1, "should move down (+1 row)");
    } else {
        panic!("expected AddWild first");
    }
}

#[test]
fn r3x_04_walking_disappears_at_edge_when_flag_true() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: true,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    // At reel=4 (last), going Right → next is reel=5 → out of bounds.
    let ctx = make_ctx("WW", 4, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert!(out.is_empty(), "should disappear at edge");
}

#[test]
fn r3x_04_walking_bounces_at_edge_when_flag_false() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    // At reel=4 (last), going Right → next is OOB → bounce to reel=3.
    let ctx = make_ctx("WW", 4, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 3, "should bounce back to reel-1");
        assert_eq!(*row, 1);
    } else {
        panic!("expected AddWild after bounce");
    }
}

#[test]
fn r3x_04_walking_left_bounces_at_left_edge() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Left,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    // At reel=0, going Left → next is OOB → bounce to reel=1.
    let ctx = make_ctx("WW", 0, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 1, "should bounce to reel+1");
        assert_eq!(*row, 1);
    } else {
        panic!("expected AddWild after bounce");
    }
}

#[test]
fn r3x_04_walking_up_bounces_at_top_edge() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Up,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    // At row=0, going Up → next is OOB → bounce to row=1.
    let ctx = make_ctx("WW", 2, 0, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 2);
        assert_eq!(*row, 1, "should bounce to row+1");
    } else {
        panic!("expected AddWild after bounce");
    }
}

#[test]
fn r3x_04_walking_down_bounces_at_bottom_edge() {
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Down,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    // At row=2 (last), going Down → next is OOB → bounce to row=1.
    let ctx = make_ctx("WW", 2, 2, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 2);
        assert_eq!(*row, 1, "should bounce to row-1");
    } else {
        panic!("expected AddWild after bounce");
    }
}

#[test]
fn r3x_04_walking_emits_locks_for_new_and_old_position() {
    // Sanity: spin_end emits 3 effects in order: AddWild, LockPosition(new, sentinel),
    // LockPosition(old, 1). Validate the last two.
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 5,
        rows: 3,
    };
    let st = SpinState::new(make_grid(5, 3, "X"));
    let ctx = make_ctx("WW", 1, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    // out[1] = LockPosition new (sentinel)
    if let Effect::LockPosition {
        reel,
        row,
        remaining_spins,
    } = &out[1]
    {
        assert_eq!(*reel, 2);
        assert_eq!(*row, 1);
        assert_eq!(*remaining_spins, 9999, "new position locked with sentinel");
    } else {
        panic!("expected LockPosition new");
    }
    // out[2] = LockPosition old (remaining=1 → unlocks next tick)
    if let Effect::LockPosition {
        reel,
        row,
        remaining_spins,
    } = &out[2]
    {
        assert_eq!(*reel, 1);
        assert_eq!(*row, 1);
        assert_eq!(*remaining_spins, 1, "old position decays in 1 tick");
    } else {
        panic!("expected LockPosition old");
    }
}

#[test]
fn r3x_04_walking_single_reel_with_disappear_yields_empty() {
    // Edge: reels=1, rows=1 → no possible move in any direction → empty.
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: true,
        reels: 1,
        rows: 1,
    };
    let st = SpinState::new(make_grid(1, 1, "X"));
    let ctx = make_ctx("WW", 0, 0, &st);
    assert!(b.on_spin_end(&ctx).is_empty());
}

// ─── R3X-05: Helpers (count_symbol / count_coin_prefix / parse_coin_amount) ─

#[test]
fn r3x_05_scatter_count_symbol_threshold_exact_triggers() {
    // 3 SC symbols on a 3x3 grid, trigger_count = 3 → exactly at threshold.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "SC".into();
    grid[1][1] = "SC".into();
    grid[2][2] = "SC".into();
    let st = SpinState::new(grid);
    let b = ScatterBehavior {
        id: "SC".into(),
        feature_id: "fs".into(),
        trigger_count: 3,
        scatter_pays: {
            let mut m = HashMap::new();
            m.insert(3usize, 5.0_f64);
            m
        },
    };
    let ctx = make_ctx("SC", 0, 0, &st);
    let out = b.on_land(&ctx);
    // Expect: TriggerFeature("fs") + ScatterPay(count=3, mult=5.0)
    assert_eq!(out.len(), 2);
    assert!(matches!(
        &out[0],
        Effect::TriggerFeature { feature_id } if feature_id == "fs"
    ));
    if let Effect::ScatterPay { count, multiplier } = &out[1] {
        assert_eq!(*count, 3);
        assert!((*multiplier - 5.0).abs() < 1e-12);
    } else {
        panic!("expected ScatterPay");
    }
}

#[test]
fn r3x_05_scatter_below_threshold_no_trigger_no_pay() {
    // 2 SC symbols, trigger_count = 3, no scatter_pays entry for 2.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "SC".into();
    grid[1][1] = "SC".into();
    let st = SpinState::new(grid);
    let b = ScatterBehavior {
        id: "SC".into(),
        feature_id: "fs".into(),
        trigger_count: 3,
        scatter_pays: HashMap::new(),
    };
    let ctx = make_ctx("SC", 0, 0, &st);
    assert!(b.on_land(&ctx).is_empty());
}

#[test]
fn r3x_05_scatter_pay_without_trigger_only_emits_pay() {
    // 2 SC, trigger=3 (no trigger) but scatter_pays has entry for 2.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "SC".into();
    grid[1][1] = "SC".into();
    let st = SpinState::new(grid);
    let b = ScatterBehavior {
        id: "SC".into(),
        feature_id: "fs".into(),
        trigger_count: 3,
        scatter_pays: {
            let mut m = HashMap::new();
            m.insert(2usize, 1.5_f64);
            m
        },
    };
    let ctx = make_ctx("SC", 0, 0, &st);
    let out = b.on_land(&ctx);
    assert_eq!(out.len(), 1);
    assert!(matches!(&out[0], Effect::ScatterPay { count: 2, .. }));
}

#[test]
fn r3x_05_coin_amount_parses_colon_suffix() {
    // Coin id "C" with symbol "C:7.5" should emit CollectCoin with amount = 7.5.
    let st = SpinState::new(make_grid(3, 3, "X"));
    let b = CoinBehavior {
        id: "C".into(),
        feature_id: "rs".into(),
        trigger_count: 99, // high so no feature trigger
        default_amount: 1.0,
        respins_reset: 3,
    };
    let ctx = make_ctx("C:7.5", 1, 1, &st);
    let out = b.on_land(&ctx);
    // At least the CollectCoin.
    assert!(!out.is_empty());
    if let Effect::CollectCoin { amount, .. } = &out[0] {
        assert!((*amount - 7.5).abs() < 1e-12, "got {}", amount);
    } else {
        panic!("expected CollectCoin first");
    }
}

#[test]
fn r3x_05_coin_amount_fallback_for_bare_id() {
    let st = SpinState::new(make_grid(3, 3, "X"));
    let b = CoinBehavior {
        id: "C".into(),
        feature_id: "rs".into(),
        trigger_count: 99,
        default_amount: 2.5,
        respins_reset: 3,
    };
    let ctx = make_ctx("C", 0, 0, &st);
    let out = b.on_land(&ctx);
    if let Effect::CollectCoin { amount, .. } = &out[0] {
        assert!((*amount - 2.5).abs() < 1e-12);
    } else {
        panic!();
    }
}

#[test]
fn r3x_05_coin_amount_fallback_for_negative_or_zero_suffix() {
    // parse_coin_amount: if parsed value <= 0 → returns default.
    let st = SpinState::new(make_grid(3, 3, "X"));
    let b = CoinBehavior {
        id: "C".into(),
        feature_id: "rs".into(),
        trigger_count: 99,
        default_amount: 3.0,
        respins_reset: 3,
    };
    let ctx = make_ctx("C:0", 0, 0, &st);
    let out = b.on_land(&ctx);
    if let Effect::CollectCoin { amount, .. } = &out[0] {
        assert!(
            (*amount - 3.0).abs() < 1e-12,
            "0 should fall back to default 3.0, got {}",
            amount
        );
    } else {
        panic!();
    }
}

#[test]
fn r3x_05_coin_collector_triggers_at_threshold_with_respin() {
    // Two C symbols → count=2, threshold=2 → triggers + emits Respin.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "C:1".into();
    grid[1][1] = "C:2".into();
    let st = SpinState::new(grid);
    let b = CoinBehavior {
        id: "C".into(),
        feature_id: "rs".into(),
        trigger_count: 2,
        default_amount: 1.0,
        respins_reset: 3,
    };
    // Hook ctx onto first coin position.
    let ctx = make_ctx("C:1", 0, 0, &st);
    let out = b.on_land(&ctx);
    // Expect: CollectCoin + TriggerFeature (+ Respin only if state already has feature)
    assert!(out.len() >= 2);
    assert!(matches!(&out[0], Effect::CollectCoin { amount, .. } if (*amount - 1.0).abs() < 1e-12));
    assert!(matches!(
        &out[1],
        Effect::TriggerFeature { feature_id } if feature_id == "rs"
    ));
}

#[test]
fn r3x_05_coin_emits_respin_when_feature_already_triggered() {
    // Pre-populate triggered_features with the coin's feature.
    let mut st = SpinState::new(make_grid(3, 3, "X"));
    st.triggered_features.insert("rs".into());
    let b = CoinBehavior {
        id: "C".into(),
        feature_id: "rs".into(),
        trigger_count: 99,
        default_amount: 1.0,
        respins_reset: 5,
    };
    let ctx = make_ctx("C", 0, 0, &st);
    let out = b.on_land(&ctx);
    // Expect: CollectCoin + Respin(5)
    assert_eq!(out.len(), 2);
    assert!(matches!(&out[1], Effect::Respin { count: 5 }));
}

#[test]
fn r3x_05_jackpot_min_count_threshold_fires_only_when_met() {
    // 2 JP on grid, min_count = 3 → should NOT fire.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "JP".into();
    grid[1][1] = "JP".into();
    let st = SpinState::new(grid);
    let b = JackpotBehavior {
        id: "JP".into(),
        tier: "MAXI".into(),
        amount: 1000.0,
        trigger_on: JackpotTrigger::Land,
        min_count: 3,
    };
    let ctx = make_ctx("JP", 0, 0, &st);
    assert!(b.on_land(&ctx).is_empty(), "below threshold");

    // Add one more JP → count=3, threshold=3 → fires.
    let mut grid2 = make_grid(3, 3, "X");
    grid2[0][0] = "JP".into();
    grid2[1][1] = "JP".into();
    grid2[2][2] = "JP".into();
    let st2 = SpinState::new(grid2);
    let ctx2 = make_ctx("JP", 0, 0, &st2);
    let out = b.on_land(&ctx2);
    assert_eq!(out.len(), 1);
    assert!(matches!(
        &out[0],
        Effect::AwardJackpot { tier, amount } if tier == "MAXI" && (*amount - 1000.0).abs() < 1e-12
    ));
}

#[test]
fn r3x_05_jackpot_win_trigger_does_not_fire_on_land() {
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "JP".into();
    let st = SpinState::new(grid);
    let b = JackpotBehavior {
        id: "JP".into(),
        tier: "MINI".into(),
        amount: 10.0,
        trigger_on: JackpotTrigger::Win,
        min_count: 1,
    };
    let ctx = make_ctx("JP", 0, 0, &st);
    assert!(b.on_land(&ctx).is_empty(), "Win trigger must skip on_land");
    let out = b.on_win(&ctx);
    assert_eq!(out.len(), 1);
}

#[test]
fn r3x_05_jackpot_land_trigger_does_not_fire_on_win() {
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "JP".into();
    let st = SpinState::new(grid);
    let b = JackpotBehavior {
        id: "JP".into(),
        tier: "MIDI".into(),
        amount: 100.0,
        trigger_on: JackpotTrigger::Land,
        min_count: 1,
    };
    let ctx = make_ctx("JP", 0, 0, &st);
    assert!(b.on_win(&ctx).is_empty(), "Land trigger must skip on_win");
    assert_eq!(b.on_land(&ctx).len(), 1);
}

#[test]
fn r3x_04_walking_single_cell_with_bounce_also_yields_empty() {
    // Edge: reels=1, rows=1 with bounce → forward OOB, backward also OOB → empty.
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 1,
        rows: 1,
    };
    let st = SpinState::new(make_grid(1, 1, "X"));
    let ctx = make_ctx("WW", 0, 0, &st);
    assert!(b.on_spin_end(&ctx).is_empty());
}

// ─── R3X-06: Mutation-kill targeted edge cases (W235) ───────────────────────

#[test]
fn r3x_06_sticky_on_win_does_not_upgrade_when_only_row_matches_locked_position() {
    // Kills: L99 `&&` → `||` in StickyWild::on_win.
    // Scenario: locked_position at (reel=0, row=1), ctx at (reel=1, row=1).
    //   Original `&&`: lp.reel==ctx.reel? 0==1 FALSE && ... → no match → empty.
    //   Mutant   `||`: 0==1 FALSE || 1==1 TRUE → matches → emits LockPosition (BUG).
    // Test must assert empty output.
    let mut st = SpinState::new(make_grid(3, 3, "X"));
    st.locked_positions.push(slot_sim::behavior::types::LockedPosition {
        reel: 0,
        row: 1,
        symbol: "SW".into(),
        remaining_spins: 5,
    });
    let b = StickyWildBehavior {
        id: "SW".into(),
        duration: 3,
        upgrade_on_win: true,
    };
    // ctx position shares row=1 with locked_position but reel differs.
    let ctx = make_ctx("SW", 1, 1, &st);
    let out = b.on_win(&ctx);
    assert!(
        out.is_empty(),
        "Sticky on_win must not upgrade when reel differs (got {:?})",
        out
    );
}

#[test]
fn r3x_06_sticky_on_win_does_not_upgrade_when_only_reel_matches_locked_position() {
    // Companion test: same row would also trip a `||` mutant via reel match.
    // Ctx at (reel=1, row=0), locked_position at (reel=1, row=2).
    //   Original `&&`: 1==1 TRUE && 2==0 FALSE → no match → empty.
    //   Mutant   `||`: TRUE || FALSE → matches → emits (BUG).
    let mut st = SpinState::new(make_grid(3, 3, "X"));
    st.locked_positions.push(slot_sim::behavior::types::LockedPosition {
        reel: 1,
        row: 2,
        symbol: "SW".into(),
        remaining_spins: 7,
    });
    let b = StickyWildBehavior {
        id: "SW".into(),
        duration: 3,
        upgrade_on_win: true,
    };
    let ctx = make_ctx("SW", 1, 0, &st);
    let out = b.on_win(&ctx);
    assert!(out.is_empty(), "Sticky on_win must not upgrade when only reel matches");
}

#[test]
fn r3x_06_sticky_on_win_upgrades_when_both_reel_and_row_match() {
    // Positive case: also locks down the +1 remaining_spins arithmetic.
    let mut st = SpinState::new(make_grid(3, 3, "X"));
    st.locked_positions.push(slot_sim::behavior::types::LockedPosition {
        reel: 1,
        row: 2,
        symbol: "SW".into(),
        remaining_spins: 5,
    });
    let b = StickyWildBehavior {
        id: "SW".into(),
        duration: 3,
        upgrade_on_win: true,
    };
    let ctx = make_ctx("SW", 1, 2, &st);
    let out = b.on_win(&ctx);
    assert_eq!(out.len(), 1);
    if let Effect::LockPosition {
        reel,
        row,
        remaining_spins,
    } = &out[0]
    {
        assert_eq!(*reel, 1);
        assert_eq!(*row, 2);
        assert_eq!(*remaining_spins, 6, "remaining_spins must be lp.remaining_spins + 1");
    } else {
        panic!("expected LockPosition");
    }
}

#[test]
fn r3x_06_walking_right_bounce_at_reels_2_lands_on_reel_0() {
    // Kills: L602:19  `br < 0` → `br <= 0` (would push br=0 result into None branch)
    // Kills: L602:50  `br < 0 || ... || brow < 0` → `&&` (would never enter None
    //                  when both `<0` and `>=rows` can't be simultaneously true)
    // Scenario: reels=2, ctx at reel=1, Right. Forward nr=2 (OOB). Bounce br=0.
    //   Original: br=0, 0<0 false, 0>=2 false → in-bounds → Some((0, row)).
    //   Mutant `<→<=`: 0<=0 true → None (BUG, no AddWild emitted).
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Right,
        disappears_on_edge: false,
        reels: 2,
        rows: 3,
    };
    let st = SpinState::new(make_grid(2, 3, "X"));
    let ctx = make_ctx("WW", 1, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3, "bounce must succeed → AddWild + 2× LockPosition");
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 0, "bounce of Right at reels=2 must land at reel 0");
        assert_eq!(*row, 1);
    } else {
        panic!("expected AddWild after bounce");
    }
}

#[test]
fn r3x_06_walking_down_bounce_at_rows_2_lands_on_row_0() {
    // Symmetric kill for L602:58 `brow < 0` → `<=` and L602:62 `||` → `&&`.
    // Scenario: rows=2, ctx at row=1, Down. Forward nrow=2 (OOB). Bounce brow=0.
    //   Original: 0<0 false, 0>=2 false → Some((reel, 0)).
    //   Mutant `<→<=`: 0<=0 true → None (BUG).
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Down,
        disappears_on_edge: false,
        reels: 3,
        rows: 2,
    };
    let st = SpinState::new(make_grid(3, 2, "X"));
    let ctx = make_ctx("WW", 1, 1, &st);
    let out = b.on_spin_end(&ctx);
    assert_eq!(out.len(), 3);
    if let Effect::AddWild { reel, row, .. } = &out[0] {
        assert_eq!(*reel, 1);
        assert_eq!(*row, 0, "bounce of Down at rows=2 must land at row 0");
    } else {
        panic!("expected AddWild after bounce");
    }
}

#[test]
fn r3x_06_walking_up_at_row_0_with_rows_1_bounces_oob_returns_none() {
    // Kills: L602:50 / L602:62 `||` → `&&` variants by forcing single-axis OOB
    // after bounce. Forward Up nrow=-1 OOB → bounce brow=row+1=1, but rows=1
    // → brow=1 >= 1 → original returns None. With `||→&&`, condition becomes
    // (brow<0 && brow>=rows) which is never true → returns Some((br, 1 as usize))
    // emitting a bogus AddWild.
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Up,
        disappears_on_edge: false,
        reels: 2,
        rows: 1,
    };
    let st = SpinState::new(make_grid(2, 1, "X"));
    let ctx = make_ctx("WW", 0, 0, &st);
    assert!(b.on_spin_end(&ctx).is_empty(), "bounce OOB must yield empty");
}

#[test]
fn r3x_06_walking_left_at_reel_0_with_reels_1_bounces_oob_returns_none() {
    // Companion kill: forces br<0 OR br>=reels post-bounce when reels=1.
    // Forward Left → nr=-1 OOB. Bounce br = reel+1 = 1, reels=1 → 1>=1 → None.
    // With `||→&&` mutant, condition becomes (br<0 && br>=reels) → never true
    // → returns Some emitting bogus AddWild.
    let b = WalkingWildBehavior {
        id: "WW".into(),
        direction: WalkDirection::Left,
        disappears_on_edge: false,
        reels: 1,
        rows: 2,
    };
    let st = SpinState::new(make_grid(1, 2, "X"));
    let ctx = make_ctx("WW", 0, 0, &st);
    assert!(b.on_spin_end(&ctx).is_empty(), "left-bounce in 1-reel grid must be empty");
}

#[test]
fn r3x_06_coin_prefix_filter_excludes_non_coin_cells() {
    // Kills: L624 `==` → `!=` in count_coin_prefix filter.
    //   Original filter: c == "C" || c.starts_with("C:")
    //     Grid: 1×"C" + 8×"X" → matches: 1 ("C") → count=1.
    //   Mutant  filter: c != "C" || c.starts_with("C:")
    //     Grid: "C" → false||false = false (not matched); "X" → true||false = true.
    //     Count = 8 (all the X cells).
    // Use trigger_count between 1 and 8 — original below, mutant above.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "C".into(); // single bare coin
    let st = SpinState::new(grid);
    let b = CoinBehavior {
        id: "C".into(),
        feature_id: "rs".into(),
        trigger_count: 5, // 1 < 5 < 8 → original misses threshold, mutant trips it
        default_amount: 1.0,
        respins_reset: 3,
    };
    let ctx = make_ctx("C", 0, 0, &st);
    let out = b.on_land(&ctx);
    // Original: only CollectCoin (count=1 < 5 → no TriggerFeature, no Respin).
    // Mutant: CollectCoin + TriggerFeature (count=8 ≥ 5).
    assert_eq!(out.len(), 1, "expected ONLY CollectCoin (count_coin_prefix==1, below trigger=5), got {:?}", out);
    assert!(matches!(&out[0], Effect::CollectCoin { .. }));
}

#[test]
fn r3x_06_coin_prefix_filter_matches_both_bare_and_colon_forms() {
    // Positive coverage: original must count both "C" and "C:N" as coin cells.
    let mut grid = make_grid(3, 3, "X");
    grid[0][0] = "C".into();
    grid[1][1] = "C:2".into();
    grid[2][2] = "C:5".into();
    let st = SpinState::new(grid);
    let b = CoinBehavior {
        id: "C".into(),
        feature_id: "rs".into(),
        trigger_count: 3, // exact match → triggers
        default_amount: 1.0,
        respins_reset: 4,
    };
    let ctx = make_ctx("C", 0, 0, &st);
    let out = b.on_land(&ctx);
    // CollectCoin + TriggerFeature
    assert!(out.len() >= 2);
    assert!(matches!(&out[0], Effect::CollectCoin { .. }));
    assert!(matches!(
        &out[1],
        Effect::TriggerFeature { feature_id } if feature_id == "rs"
    ));
}
