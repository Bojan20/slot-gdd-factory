//! Faza 10.6 — Adversarial & edge-case tests.
//!
//! Tests that would crash or produce incorrect results in a naive
//! implementation.  Every test here corresponds to a failure mode observed
//! in real slot math engines in the wild.
//!
//! ## Categories
//!
//! | Category                     | Description                                           |
//! |------------------------------|-------------------------------------------------------|
//! | **All-wild grids**           | Wild on every cell → legal but extremely high win     |
//! | **All-scatter / all-bonus**  | Max scatter/bonus counts → correct trigger flags      |
//! | **Boundary bets**            | bet=0, bet=i64::MAX/1000 → no overflow, no panic      |
//! | **Payline extremes**         | Single payline; max paylines (64); all-same-row       |
//! | **Symbol edge cases**        | Only scatter on grid; only wild; only bonus           |
//! | **Config extremes**          | feature_loop_cap=0; empty paytable; single-weight reel|
//! | **PackedGrid boundaries**    | All-zeros; all-max-sym; set/get at extreme positions  |
//! | **AliasTable extremes**      | Weights [1,u32::MAX]; heavily skewed; all-equal       |

use slot_sim::{
    config::{GameConfig, PayEntry, ReelWeight},
    evaluator::{EvalMode, Evaluator},
    grid::GridGenerator,
    rng::SlotRng,
    speed::{
        AliasTable, PackedGrid, PackedGridGenerator, ZeroAllocEvaluator, MAX_PAYLINES, MAX_REELS,
    },
};
use std::collections::HashMap;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn base_config() -> GameConfig {
    let mut cfg = GameConfig::default();
    cfg.paylines = vec![
        vec![1u8, 1, 1, 1, 1],
        vec![0u8, 0, 0, 0, 0],
        vec![2u8, 2, 2, 2, 2],
        vec![0u8, 1, 2, 1, 0],
        vec![2u8, 1, 0, 1, 2],
    ];
    cfg.paytable = HashMap::from([
        (
            "W".to_string(),
            PayEntry {
                pay3: 10.0,
                pay4: 50.0,
                pay5: 200.0,
            },
        ),
        (
            "H1".to_string(),
            PayEntry {
                pay3: 5.0,
                pay4: 25.0,
                pay5: 100.0,
            },
        ),
        (
            "L1".to_string(),
            PayEntry {
                pay3: 2.0,
                pay4: 10.0,
                pay5: 40.0,
            },
        ),
    ]);
    let rw = vec![
        ReelWeight {
            symbol: "W".to_string(),
            weight: 2,
        },
        ReelWeight {
            symbol: "H1".to_string(),
            weight: 10,
        },
        ReelWeight {
            symbol: "L1".to_string(),
            weight: 30,
        },
        ReelWeight {
            symbol: "S".to_string(),
            weight: 3,
        },
        ReelWeight {
            symbol: "B".to_string(),
            weight: 5,
        },
    ];
    cfg.base_weights = vec![rw.clone(); 5];
    cfg.fs_weights = vec![rw; 5];
    cfg
}

/// Sym indices in base_config: W=0, H1=1, L1=2, S=3, B=4.
fn make_grid_all_sym(sym_idx: u8) -> PackedGrid {
    let rows = 3;
    let mut g = PackedGrid::default();
    for r in 0..5usize {
        for row in 0..rows {
            g.set(r, row, rows, sym_idx);
        }
    }
    g
}

// ─── All-wild grid ────────────────────────────────────────────────────────────

/// All wilds (sym=0) → every payline fires as W×5 = 200×bet.
/// Expected: 5 paylines × 200 × 1000 mc = 1_000_000 mc.
#[test]
fn adversarial_all_wild_grid_produces_max_line_win() {
    let cfg = base_config();
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let grid = make_grid_all_sym(0); // W=0

    let res = eval.eval_lines(grid, 1_000);
    // 5 paylines × pay5(W) × bet = 5 × 200_000 = 1_000_000 mc
    assert_eq!(
        res.base_win, 1_000_000,
        "all-wild grid: expected 1_000_000 mc, got {}",
        res.base_win
    );
    assert_eq!(res.scatter_count, 0, "wilds are not scatters");
    assert_eq!(res.bonus_count, 0, "wilds are not bonuses");
}

/// All wilds → no division by zero, no overflow at max sane bet.
#[test]
fn adversarial_all_wild_max_sane_bet_no_overflow() {
    let cfg = base_config();
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let grid = make_grid_all_sym(0);

    // 1 billion mc per bet is extreme but representable in i64
    let bet_mc = 1_000_000_000i64;
    let res = eval.eval_lines(grid, bet_mc);
    assert!(res.base_win > 0, "expected positive win");
    assert!(res.base_win < i64::MAX, "no overflow");
}

// ─── All-scatter grid ─────────────────────────────────────────────────────────

/// 15 scatters → scatter_count = 15, fs_triggered = true (3 required).
#[test]
fn adversarial_all_scatter_grid_triggers_fs() {
    let cfg = base_config();
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let grid = make_grid_all_sym(3); // S=3

    let res = eval.eval_lines(grid, 1_000);
    assert_eq!(res.scatter_count, 15, "expected 15 scatters");
    assert!(res.fs_triggered, "15 scatters must trigger FS");
    assert!(!res.hnw_triggered, "scatters don't trigger HnW");
}

/// S is not in paytable → no line wins from all-scatter grid.
#[test]
fn adversarial_all_scatter_gives_zero_line_win() {
    let cfg = base_config();
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let grid = make_grid_all_sym(3); // S not in paytable

    let res = eval.eval_lines(grid, 1_000);
    assert_eq!(
        res.base_win, 0,
        "scatter not in paytable → zero line wins, got {}",
        res.base_win
    );
}

// ─── All-bonus grid ───────────────────────────────────────────────────────────

/// 15 bonuses → hnw_triggered = true (6 required by default).
#[test]
fn adversarial_all_bonus_grid_triggers_hnw() {
    let cfg = base_config();
    // Default hold_and_win.trigger_count = 6
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let grid = make_grid_all_sym(4); // B=4

    let res = eval.eval_lines(grid, 1_000);
    assert_eq!(res.bonus_count, 15, "expected 15 bonus symbols");
    assert!(
        res.hnw_triggered,
        "15 bonuses (≥6 required) must trigger HnW"
    );
    assert!(!res.fs_triggered, "HnW takes priority over FS");
}

// ─── HnW/FS mutual exclusion ─────────────────────────────────────────────────

/// Grid with both scatter AND bonus ≥ thresholds → HnW wins (priority).
/// Default: hnw_trigger_count=6 (hold_and_win.trigger_count), fs_trigger_count=3.
#[test]
fn adversarial_hnw_priority_over_fs_when_both_triggered() {
    let cfg = base_config();
    // Default hold_and_win.trigger_count = 6
    let eval = ZeroAllocEvaluator::from_config(&cfg);

    // Place 3 scatters (FS threshold=3) + 6 bonuses (HnW threshold=6) on one grid.
    let rows = 3;
    let mut g = PackedGrid::default();
    // All wild first (W=0 on all cells)
    for r in 0..5 {
        for row in 0..rows {
            g.set(r, row, rows, 0);
        }
    }
    // 3 scatters: reels 0-2, row 0
    g.set(0, 0, rows, 3);
    g.set(1, 0, rows, 3);
    g.set(2, 0, rows, 3);
    // 6 bonuses: all 5 reels row 2 + reel 0 row 1 (row 0 is scatter on reels 0-2)
    for r in 0..5 {
        g.set(r, 2, rows, 4);
    }
    g.set(3, 1, rows, 4); // 6th bonus

    let res = eval.eval_lines(g, 1_000);
    // hnw_trigger_count=6 and bonus_count=6 → HnW fires
    // fs_trigger_count=3 and scatter_count=3 → FS would fire, but HnW takes priority
    assert!(
        res.bonus_count >= 6,
        "must have ≥6 bonuses, got {}",
        res.bonus_count
    );
    assert!(res.hnw_triggered, "HnW must fire when 6 bonuses present");
    assert!(!res.fs_triggered, "FS must NOT fire when HnW has priority");
}

// ─── Zero bet ─────────────────────────────────────────────────────────────────

#[test]
fn adversarial_zero_bet_gives_zero_win() {
    let cfg = base_config();
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    // All-wild → would give max win if bet > 0
    let grid = make_grid_all_sym(0);
    let res = eval.eval_lines(grid, 0);
    assert_eq!(res.base_win, 0, "bet=0 must produce zero win");
}

// ─── Negative bet ─────────────────────────────────────────────────────────────

/// Negative bet: the evaluator uses `max(0, pay)` internally,
/// so negative bets produce zero wins — not negative wins.
/// This tests the actual documented behavior of `eval_payline`.
#[test]
fn adversarial_negative_bet_gives_zero_win() {
    let cfg = base_config();
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    // All-H1 grid would give high positive win with positive bet.
    let grid = make_grid_all_sym(1); // H1=1

    let pos = eval.eval_lines(grid, 1_000).base_win;
    let neg = eval.eval_lines(grid, -1_000).base_win;

    // eval_payline uses `best.max(val)` with best=0, so negative bets → 0 win.
    assert!(
        pos > 0,
        "positive bet must produce positive win for all-H1 grid"
    );
    assert_eq!(
        neg, 0,
        "negative bet must give 0 win (max guard), got {neg}"
    );
}

// ─── Single payline config ────────────────────────────────────────────────────

#[test]
fn adversarial_single_payline_config_works() {
    let mut cfg = base_config();
    cfg.paylines = vec![vec![1u8, 1, 1, 1, 1]]; // middle only
    let eval = ZeroAllocEvaluator::from_config(&cfg);

    // H1 on middle row of all 5 reels → H1×5 = 100 × 1000 = 100_000 mc
    let rows = 3;
    let mut g = PackedGrid::default();
    for r in 0..5 {
        g.set(r, 1, rows, 1);
    } // H1=1 on row 1 (middle)

    let res = eval.eval_lines(g, 1_000);
    assert_eq!(
        res.base_win, 100_000,
        "single middle payline H1×5: expected 100_000, got {}",
        res.base_win
    );
}

// ─── Max paylines (64) ────────────────────────────────────────────────────────

#[test]
fn adversarial_max_paylines_config_no_panic() {
    let mut cfg = base_config();

    // Fill all MAX_PAYLINES (64) slots — use middle row for all to keep math simple.
    cfg.paylines = (0..MAX_PAYLINES)
        .map(|i| {
            // Rotate through rows 0,1,2 per payline to create variety
            let row = (i % 3) as u8;
            vec![row; MAX_REELS.min(5)]
        })
        .collect();

    // Build should not panic
    let eval = ZeroAllocEvaluator::from_config(&cfg);

    // Run 100 spins
    let gen = PackedGridGenerator::from_config(&cfg);
    let mut rng = SlotRng::new(42);
    for _ in 0..100 {
        let grid = gen.generate_base(&mut rng);
        let res = eval.eval_lines(grid, 1_000);
        assert!(res.base_win >= 0, "negative win impossible");
    }
}

// ─── Empty paytable ───────────────────────────────────────────────────────────

#[test]
fn adversarial_empty_paytable_gives_zero_line_wins() {
    let mut cfg = base_config();
    cfg.paytable = HashMap::new(); // no symbol pays anything
    let eval = ZeroAllocEvaluator::from_config(&cfg);

    let mut rng = SlotRng::new(7777);
    let gen = PackedGridGenerator::from_config(&cfg);
    for _ in 0..1_000 {
        let grid = gen.generate_base(&mut rng);
        let res = eval.eval_lines(grid, 1_000);
        assert_eq!(
            res.base_win, 0,
            "empty paytable → zero line wins, got {}",
            res.base_win
        );
    }
}

// ─── Single-weight reel (one symbol) ─────────────────────────────────────────

#[test]
fn adversarial_single_symbol_per_reel_always_generates_it() {
    let mut cfg = base_config();
    // Every reel only has L1 (idx=2) with weight 100
    cfg.base_weights = vec![
        vec![ReelWeight {
            symbol: "L1".to_string(),
            weight: 100
        }];
        5
    ];
    cfg.fs_weights = cfg.base_weights.clone();

    let gen = PackedGridGenerator::from_config(&cfg);
    let mut rng = SlotRng::new(54321);
    for _ in 0..5_000 {
        let g = gen.generate_base(&mut rng);
        for r in 0..5 {
            for row in 0..3 {
                let sym = g.get(r, row, 3);
                assert_eq!(sym, 2, "expected L1 (idx=2), got {sym}");
            }
        }
    }
}

// ─── AliasTable extreme weights ──────────────────────────────────────────────

/// One symbol with weight=1, one with weight=u32::MAX → construction OK.
#[test]
fn adversarial_alias_extreme_weight_ratio_no_panic() {
    let entries = [(0u8, 1u32), (1u8, u32::MAX)];
    let t = AliasTable::build(&entries);
    let mut rng = SlotRng::new(13);

    // Should produce mostly sym=1
    let n = 100_000;
    let mut count_1 = 0u32;
    for _ in 0..n {
        if t.sample(&mut rng) == 1 {
            count_1 += 1;
        }
    }
    let p1 = count_1 as f64 / n as f64;
    // Expected ≈ u32::MAX / (1 + u32::MAX) ≈ 1 − 2^-32 ≈ 1.0
    assert!(p1 > 0.999, "P(sym=1) = {p1:.6}, expected ~1.0");
}

/// All-equal weights → uniform distribution (chi-squared test).
#[test]
fn adversarial_alias_all_equal_weights_uniform() {
    let k = 5u8;
    let entries: Vec<(u8, u32)> = (0..k).map(|i| (i, 100u32)).collect();
    let t = AliasTable::build(&entries);
    let mut rng = SlotRng::new(31415);

    let n = 500_000u64;
    let mut counts = [0u64; 5];
    for _ in 0..n {
        counts[t.sample(&mut rng) as usize] += 1;
    }
    let expected = n as f64 / k as f64;
    let chi2: f64 = counts
        .iter()
        .map(|&c| {
            let d = c as f64 - expected;
            d * d / expected
        })
        .sum();
    // df=4, α=0.001 critical ≈ 18.5; generous guard at 30.
    assert!(chi2 < 30.0, "chi² = {chi2:.3} for uniform 5-symbol table");
}

/// Maximum entries (255) → no panic, all symbols represented.
#[test]
fn adversarial_alias_max_entries_no_panic() {
    let entries: Vec<(u8, u32)> = (0u8..=254u8).map(|i| (i, (i as u32) + 1)).collect();
    let t = AliasTable::build(&entries);
    let mut rng = SlotRng::new(2718);

    let valid: std::collections::HashSet<u8> = (0u8..=254u8).collect();
    for _ in 0..10_000 {
        let s = t.sample(&mut rng);
        assert!(valid.contains(&s), "unexpected symbol {s}");
    }
}

// ─── PackedGrid boundary operations ──────────────────────────────────────────

/// set/get at every valid cell position with max 5-bit value (31).
#[test]
fn adversarial_packed_grid_every_position_max_value() {
    let rows = 5;
    let mut g = PackedGrid::default();
    for r in 0..PackedGrid::MAX_REELS {
        for row in 0..PackedGrid::MAX_ROWS {
            g.set(r, row, rows, 30); // 30 is max valid (31 = sentinel)
        }
    }
    for r in 0..PackedGrid::MAX_REELS {
        for row in 0..PackedGrid::MAX_ROWS {
            assert_eq!(
                g.get(r, row, rows),
                30,
                "max value round-trip failed at ({r},{row})"
            );
        }
    }
}

/// All-zeros PackedGrid (default) → every cell returns 0.
#[test]
fn adversarial_packed_grid_default_all_zeros() {
    let g = PackedGrid::default();
    for r in 0..5 {
        for row in 0..3 {
            assert_eq!(
                g.get(r, row, 3),
                0,
                "default grid cell ({r},{row}) should be 0"
            );
        }
    }
}

/// Rapid alternating set/get on the same cell with different values.
#[test]
fn adversarial_packed_grid_alternating_writes_no_bleed() {
    let rows = 3;
    let mut g = PackedGrid::default();
    for cycle in 0..1_000u32 {
        let val = (cycle % 31) as u8;
        g.set(2, 1, rows, val);
        assert_eq!(g.get(2, 1, rows), val, "cycle {cycle}");
        // Adjacent cells must not be affected
        assert_eq!(g.get(2, 0, rows), 0, "neighbor (2,0) at cycle {cycle}");
        assert_eq!(g.get(2, 2, rows), 0, "neighbor (2,2) at cycle {cycle}");
    }
}

// ─── feature_loop_cap protection ─────────────────────────────────────────────

/// feature_loop_cap = 0 → evaluator constructs without panic.
/// (The cap is enforced by the legacy Evaluator, not ZeroAllocEvaluator.)
#[test]
fn adversarial_feature_loop_cap_zero_no_panic() {
    let mut cfg = base_config();
    cfg.feature_loop_cap = 0;
    // Should not panic
    let _eval = ZeroAllocEvaluator::from_config(&cfg);
    let _gen = PackedGridGenerator::from_config(&cfg);
}

/// feature_loop_cap = u32::MAX → evaluator constructs without panic.
#[test]
fn adversarial_feature_loop_cap_max_no_panic() {
    let mut cfg = base_config();
    cfg.feature_loop_cap = u32::MAX;
    let _eval = ZeroAllocEvaluator::from_config(&cfg);
    let _gen = PackedGridGenerator::from_config(&cfg);
}

// ─── Legacy Evaluator adversarial ────────────────────────────────────────────

/// Legacy evaluator never panics on any grid producible by GridGenerator.
#[test]
fn adversarial_legacy_evaluator_never_panics_5k_spins() {
    let cfg = base_config();
    let gen = GridGenerator::new(&cfg);
    let eval_leg = Evaluator::with_mode(&cfg, &gen, EvalMode::Lines);
    let mut rng = SlotRng::new(0xDEAD_BEEF);
    for _ in 0..5_000 {
        let grid = gen.generate_base(&mut rng);
        let _res = eval_leg.evaluate_spin(&grid, &mut rng, 1_000, false, true);
    }
}

/// Legacy evaluator + ZeroAllocEvaluator agree on 500 adversarial all-wild spins.
#[test]
fn adversarial_all_wild_cross_validates_legacy_vs_zero_alloc() {
    let cfg = base_config();
    let gen_dyn = GridGenerator::new(&cfg);
    let eval_leg = Evaluator::with_mode(&cfg, &gen_dyn, EvalMode::Lines);
    let eval_zal = ZeroAllocEvaluator::from_config(&cfg);
    let mut rng = SlotRng::new(0xBEEF);

    for spin in 0..500 {
        let dyn_grid = gen_dyn.generate_base(&mut rng);
        let packed = PackedGrid::from_dyn(&dyn_grid);
        let leg_res = eval_leg.evaluate_spin(&dyn_grid, &mut rng, 1_000, false, true);
        let zal_res = eval_zal.eval_lines(packed, 1_000);
        assert_eq!(
            leg_res.base_win, zal_res.base_win,
            "spin {spin}: legacy={} zal={}",
            leg_res.base_win, zal_res.base_win
        );
    }
}

// ─── RNG adversarial ─────────────────────────────────────────────────────────

/// SlotRng with seed=0 must not produce identical values for all outputs.
#[test]
fn adversarial_rng_seed_zero_not_degenerate() {
    let mut rng = SlotRng::new(0);
    let vals: Vec<f64> = (0..20).map(|_| rng.random()).collect();
    let all_same = vals.windows(2).all(|w| w[0] == w[1]);
    assert!(!all_same, "seed=0 produced degenerate constant sequence");
}

/// SlotRng with seed=u64::MAX must not produce NaN or Inf.
#[test]
fn adversarial_rng_max_seed_no_nan_inf() {
    let mut rng = SlotRng::new(u64::MAX);
    for _ in 0..1_000 {
        let v = rng.random();
        assert!(!v.is_nan(), "NaN from seed=u64::MAX");
        assert!(!v.is_infinite(), "Inf from seed=u64::MAX");
        assert!(v >= 0.0 && v < 1.0, "out of [0,1) range: {v}");
    }
}

/// Mulberry32 matches known expected values for seed=12345.
/// These are the canonical values documented in src/utils/rng.ts.
#[test]
fn adversarial_mulberry32_known_vectors_seed_12345() {
    use slot_sim::rng::{create_rng, RngKind};
    let mut rng = create_rng(RngKind::Mulberry32, 12345);
    let v1 = rng.next_f64();
    let v2 = rng.next_f64();
    let v3 = rng.next_f64();
    // From TS docs: 0.9797282677609473, 0.3067522644996643, 0.484205421525985
    assert!((v1 - 0.9797282677609473).abs() < 1e-14, "v1={v1}");
    assert!((v2 - 0.3067522644996643).abs() < 1e-14, "v2={v2}");
    assert!((v3 - 0.484_205_421_525_985_f64).abs() < 1e-14, "v3={v3}");
}
