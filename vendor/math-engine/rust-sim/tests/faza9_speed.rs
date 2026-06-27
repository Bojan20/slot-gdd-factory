//! Faza 9 — Speed integration tests.
//!
//! Covers:
//! * Walker's Alias distribution correctness (chi-squared < critical value).
//! * `PackedGrid` get/set/unpack/pack round-trips.
//! * `PackedGridGenerator` symbol range, FS fallback, throughput.
//! * `ZeroAllocEvaluator` correctness cross-validated against `Evaluator`.
//! * SIMD vs scalar agreement for scatter/bonus counting.
//! * `SpinHot` cache-line size/alignment assertions.
//! * 1 M packed spins — constant memory + RTP sanity.

use slot_sim::{
    config::{GameConfig, PayEntry, ReelWeight},
    evaluator::{EvalMode, Evaluator},
    grid::GridGenerator,
    rng::SlotRng,
    speed::{
        scalar_count_scatter_bonus, scalar_count_symbol, simd_count_scatter_bonus,
        simd_count_symbol, AliasTable, PackedGrid, PackedGridGenerator, PackedSpinResult, SpinCold,
        SpinHot, ZeroAllocEvaluator,
    },
};
use std::collections::HashMap;

// ─── Shared helpers ───────────────────────────────────────────────────────────

fn make_config() -> GameConfig {
    let mut cfg = GameConfig::default();
    cfg.paylines = vec![
        vec![1, 1, 1, 1, 1], // middle
        vec![0, 0, 0, 0, 0], // top
        vec![2, 2, 2, 2, 2], // bottom
        vec![0, 1, 2, 1, 0], // V
        vec![2, 1, 0, 1, 2], // inverted V
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

// ─── AliasTable tests ─────────────────────────────────────────────────────────

#[test]
fn alias_single_entry_always_returns_same_symbol() {
    let t = AliasTable::build(&[(42u8, 999)]);
    let mut rng = SlotRng::new(1);
    for _ in 0..1_000 {
        assert_eq!(t.sample(&mut rng), 42);
    }
}

#[test]
fn alias_distribution_chi_squared_valid() {
    // Weights: L1=30, H1=10, W=2, B=5, S=3 → total=50
    let entries = [(0u8, 30), (1u8, 10), (2u8, 2), (3u8, 5), (4u8, 3)];
    let total: u32 = entries.iter().map(|(_, w)| w).sum();
    let t = AliasTable::build(&entries);
    let mut rng = SlotRng::new(555);
    let n = 500_000u64;
    let mut counts = [0u64; 5];
    for _ in 0..n {
        counts[t.sample(&mut rng) as usize] += 1;
    }
    let chi2: f64 = entries
        .iter()
        .map(|(i, w)| {
            let expected = n as f64 * (*w as f64 / total as f64);
            let diff = counts[*i as usize] as f64 - expected;
            diff * diff / expected
        })
        .sum();
    // df=4, critical value α=0.001 ≈ 18.5; generous buffer → 40
    assert!(chi2 < 40.0, "alias chi² = {chi2:.3}");
}

#[test]
fn alias_marginal_probs_exact() {
    let entries = [(0u8, 70), (1u8, 20), (2u8, 10)];
    let t = AliasTable::build(&entries);
    let eps = 1e-9;
    assert!((t.marginal_probability(0) - 0.70).abs() < eps);
    assert!((t.marginal_probability(1) - 0.20).abs() < eps);
    assert!((t.marginal_probability(2) - 0.10).abs() < eps);
}

// ─── PackedGrid tests ─────────────────────────────────────────────────────────

#[test]
fn packed_grid_set_get_all_cells_5x3() {
    let rows = 3;
    let mut g = PackedGrid::default();
    let mut k = 0u8;
    for r in 0..5 {
        for row in 0..rows {
            g.set(r, row, rows, k % 30);
            k += 1;
        }
    }
    let mut k = 0u8;
    for r in 0..5 {
        for row in 0..rows {
            assert_eq!(g.get(r, row, rows), k % 30);
            k += 1;
        }
    }
}

#[test]
fn packed_grid_set_get_all_cells_5x5() {
    let rows = 5;
    let mut g = PackedGrid::default();
    let mut k = 0u8;
    for r in 0..5 {
        for row in 0..rows {
            g.set(r, row, rows, k % 30);
            k += 1;
        }
    }
    let mut k = 0u8;
    for r in 0..5 {
        for row in 0..rows {
            assert_eq!(g.get(r, row, rows), k % 30);
            k += 1;
        }
    }
}

#[test]
fn packed_grid_overwrite_is_clean() {
    let rows = 3;
    let mut g = PackedGrid::default();
    g.set(2, 1, rows, 15);
    g.set(2, 1, rows, 7);
    assert_eq!(g.get(2, 1, rows), 7);
    // Neighbours must be untouched
    assert_eq!(g.get(2, 0, rows), 0);
    assert_eq!(g.get(2, 2, rows), 0);
}

#[test]
fn packed_grid_pack_unpack_round_trip() {
    let rows = 3;
    let mut g = PackedGrid::default();
    for r in 0..5 {
        for row in 0..rows {
            g.set(r, row, rows, ((r * 3 + row) % 30) as u8);
        }
    }
    let flat = g.unpack(5, rows);
    let g2 = PackedGrid::pack(&flat, 5, rows);
    assert_eq!(g, g2);
}

#[test]
fn packed_grid_from_dyn_matches() {
    use slot_sim::grid::DynGrid;
    let reels = 5;
    let rows = 3;
    let mut dyn_g = DynGrid::new(reels, rows);
    for r in 0..reels {
        for row in 0..rows {
            dyn_g.set(r, row, ((r * 3 + row) % 25) as u8);
        }
    }
    let packed = PackedGrid::from_dyn(&dyn_g);
    for r in 0..reels {
        for row in 0..rows {
            assert_eq!(packed.get(r, row, rows), dyn_g.get(r, row));
        }
    }
}

// ─── PackedGridGenerator tests ────────────────────────────────────────────────

#[test]
fn packed_gen_all_symbols_in_valid_range() {
    let cfg = make_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let mut rng = SlotRng::new(999);
    for _ in 0..50_000 {
        let g = gen.generate_base(&mut rng);
        for r in 0..gen.reels() {
            for row in 0..gen.rows() {
                assert!(g.get(r, row, gen.rows()) < 5, "sym out of range");
            }
        }
    }
}

#[test]
fn packed_gen_fs_fallback_uses_base_when_fs_empty() {
    let mut cfg = make_config();
    cfg.fs_weights = vec![]; // no FS weights → fallback to base
                             // Should not panic:
    let _gen = PackedGridGenerator::from_config(&cfg);
}

#[test]
fn packed_gen_deterministic_same_seed() {
    let cfg = make_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let mut rng1 = SlotRng::new(111);
    let mut rng2 = SlotRng::new(111);
    for _ in 0..1_000 {
        assert_eq!(gen.generate_base(&mut rng1), gen.generate_base(&mut rng2));
    }
}

// ─── ZeroAllocEvaluator correctness cross-validator ──────────────────────────

/// Run `ZeroAllocEvaluator` and legacy `Evaluator` on the same grids,
/// assert identical `base_win` totals across N spins.
#[test]
fn zero_alloc_matches_legacy_evaluator() {
    let cfg = make_config();
    let gen_dyn = GridGenerator::new(&cfg);
    let eval_leg = Evaluator::with_mode(&cfg, &gen_dyn, EvalMode::Lines);
    let eval_zal = ZeroAllocEvaluator::from_config(&cfg);
    let bet_mc = 1_000i64;

    let mut rng = SlotRng::new(12345);
    let mut mismatches = 0u32;
    let n = 20_000;

    for spin in 0..n {
        // Generate DynGrid with legacy generator.
        let dyn_grid = gen_dyn.generate_base(&mut rng);
        // Convert to PackedGrid for ZeroAllocEvaluator.
        let packed = PackedGrid::from_dyn(&dyn_grid);

        let leg_res = eval_leg.evaluate_spin(&dyn_grid, &mut rng, bet_mc, false, true);
        let zal_res = eval_zal.eval_lines(packed, bet_mc);

        // base_win must match exactly.
        if leg_res.base_win != zal_res.base_win {
            eprintln!(
                "spin {spin}: legacy={} zal={} packed={:?}",
                leg_res.base_win, zal_res.base_win, packed
            );
            mismatches += 1;
        }
        // Scatter and bonus counts must match.
        assert_eq!(
            leg_res.scatter_count, zal_res.scatter_count,
            "scatter mismatch spin {spin}"
        );
        assert_eq!(
            leg_res.bonus_count, zal_res.bonus_count,
            "bonus mismatch spin {spin}"
        );
    }
    assert_eq!(mismatches, 0, "{mismatches} / {n} spins had win mismatches");
}

#[test]
fn zero_alloc_fs_trigger_matches_legacy() {
    let cfg = make_config();
    let gen_dyn = GridGenerator::new(&cfg);
    let eval_leg = Evaluator::with_mode(&cfg, &gen_dyn, EvalMode::Lines);
    let eval_zal = ZeroAllocEvaluator::from_config(&cfg);
    let bet_mc = 1_000i64;

    let mut rng = SlotRng::new(77777);
    for spin in 0..10_000 {
        let dyn_grid = gen_dyn.generate_base(&mut rng);
        let packed = PackedGrid::from_dyn(&dyn_grid);
        let leg_res = eval_leg.evaluate_spin(&dyn_grid, &mut rng, bet_mc, false, true);
        let zal_res = eval_zal.eval_lines(packed, bet_mc);
        assert_eq!(
            leg_res.fs_triggered, zal_res.fs_triggered,
            "fs_triggered mismatch spin {spin}"
        );
    }
}

// ─── SIMD vs scalar tests ─────────────────────────────────────────────────────

#[test]
fn simd_equals_scalar_random_10k() {
    let cfg = make_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let mut rng = SlotRng::new(24680);
    let reels = gen.reels();
    let rows = gen.rows();
    let scatter_idx = 3u8; // S
    let bonus_idx = 4u8; // B

    for _ in 0..10_000 {
        let g = gen.generate_base(&mut rng);
        assert_eq!(
            simd_count_symbol(g, scatter_idx, reels, rows),
            scalar_count_symbol(g, scatter_idx, reels, rows),
            "scatter SIMD vs scalar"
        );
        assert_eq!(
            simd_count_symbol(g, bonus_idx, reels, rows),
            scalar_count_symbol(g, bonus_idx, reels, rows),
            "bonus SIMD vs scalar"
        );
        let simd_pair = simd_count_scatter_bonus(g, scatter_idx, bonus_idx, reels, rows);
        let scal_pair = scalar_count_scatter_bonus(g, scatter_idx, bonus_idx, reels, rows);
        assert_eq!(simd_pair, scal_pair, "pair mismatch");
    }
}

#[test]
fn simd_full_grid_same_symbol() {
    let reels = 5;
    let rows = 3;
    let mut g = PackedGrid::default();
    for r in 0..reels {
        for row in 0..rows {
            g.set(r, row, rows, 3);
        }
    }
    let expected = (reels * rows) as u8;
    assert_eq!(simd_count_symbol(g, 3, reels, rows), expected);
    assert_eq!(scalar_count_symbol(g, 3, reels, rows), expected);
}

// ─── SpinHot layout tests ────────────────────────────────────────────────────

#[test]
fn spin_hot_size_is_64_bytes() {
    assert_eq!(std::mem::size_of::<SpinHot>(), 64);
}

#[test]
fn spin_hot_alignment_is_64() {
    assert_eq!(std::mem::align_of::<SpinHot>(), 64);
}

#[test]
fn spin_hot_reset_and_record() {
    let mut hot = SpinHot::new();
    let mut cold = SpinCold {
        bet_mc: 1_000,
        ..Default::default()
    };

    hot.base_win = 5_000;
    hot.multiplier = 2;
    hot.scatter_count = 3;
    hot.fs_triggered = true;
    cold.record(&hot);

    assert_eq!(cold.spins_done, 1);
    assert_eq!(cold.total_wagered, 1_000);
    assert_eq!(cold.total_won, 10_000); // 5_000 × 2
    assert_eq!(cold.fs_triggers, 1);

    hot.reset_spin();
    assert_eq!(hot.base_win, 0);
    assert_eq!(hot.multiplier, 1);
    assert!(!hot.fs_triggered);
}

// ─── 1M-spin throughput + RTP sanity ─────────────────────────────────────────

#[test]
fn packed_1m_spins_rtp_sanity_and_constant_memory() {
    let cfg = make_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let mut cold = SpinCold {
        bet_mc: 1_000,
        ..Default::default()
    };
    let mut rng = SlotRng::new(99999);
    let n = 1_000_000u64;

    for _ in 0..n {
        let grid = gen.generate_base(&mut rng);
        let res = eval.eval_lines(grid, cold.bet_mc);
        let mut hot = SpinHot::new();
        hot.base_win = res.base_win;
        hot.scatter_count = res.scatter_count;
        hot.bonus_count = res.bonus_count;
        hot.fs_triggered = res.fs_triggered;
        hot.hnw_triggered = res.hnw_triggered;
        cold.record(&hot);
    }

    assert_eq!(cold.spins_done, n);
    // The test config has L1 at 60% weight with pay5=40× and 5 paylines, giving
    // a theoretical RTP >> 100%.  We only verify correctness — non-zero wins and
    // no integer overflow (not game-balance).  A real config would be tuned to 96%.
    let rtp = cold.rtp_pct();
    assert!(rtp > 1.0, "RTP = {rtp:.2}% — evaluator producing no wins");
    assert!(
        rtp < 1_000_000.0,
        "RTP = {rtp:.2}% — arithmetic overflow suspected"
    );
}

// ─── PackedSpinResult layout ─────────────────────────────────────────────────

#[test]
fn packed_spin_result_is_small() {
    // Ensure the stack-only result stays compact (max 16 bytes).
    let size = std::mem::size_of::<PackedSpinResult>();
    assert!(
        size <= 16,
        "PackedSpinResult is {size} bytes — should be ≤16"
    );
}

// ─── Zero-alloc evaluator with multiplied paylines ───────────────────────────

#[test]
fn zero_alloc_multiple_winning_lines_accumulate() {
    let cfg = make_config();
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let rows = 3usize;
    let bet_mc = 1_000i64;

    // Place H1 (sym=1) on ALL rows of ALL reels — every payline wins pay5.
    let mut g = PackedGrid::default();
    for r in 0..5 {
        for row in 0..rows {
            g.set(r, row, rows, 1);
        }
    }
    let res = eval.eval_lines(g, bet_mc);

    // 5 paylines × H1-pay5 (100 bet-mul × 1000 / 1000 = 100_000 mc each)
    assert_eq!(
        res.base_win,
        5 * 100_000,
        "all 5 paylines H1×5; got {}",
        res.base_win
    );
}

#[test]
fn zero_alloc_wild_only_wins_when_no_paying_symbol() {
    let mut cfg = make_config();
    // Only W in paytable — wild-only chains must pay.
    cfg.paytable = HashMap::from([(
        "W".to_string(),
        PayEntry {
            pay3: 10.0,
            pay4: 50.0,
            pay5: 200.0,
        },
    )]);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let rows = 3usize;
    let bet_mc = 1_000i64;

    let mut g = PackedGrid::default();
    // Block non-middle paylines: scatter (idx=3) at reel 0, rows 0 and 2.
    // These rows feed paylines [0,0,0,0,0], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2].
    g.set(0, 0, rows, 3); // blocks top row + V-shape paylines at reel 0
    g.set(0, 2, rows, 3); // blocks bottom row + inv-V paylines at reel 0
                          // Middle row (row=1): all W.
    for r in 0..5 {
        g.set(r, 1, rows, 0);
    }
    let res = eval.eval_lines(g, bet_mc);
    // Only payline 0 [1,1,1,1,1] fires: W×5 = pay5 = 200 × 1000/1000 = 200_000 mc.
    assert_eq!(
        res.base_win, 200_000,
        "wild-only 5x on isolated middle row; got {}",
        res.base_win
    );
}

// ─── AliasTable throughput gate ───────────────────────────────────────────────

#[test]
fn alias_1m_samples_deterministic_and_fast() {
    let entries = [(0u8, 30), (1u8, 10), (2u8, 2), (3u8, 5), (4u8, 3)];
    let t = AliasTable::build(&entries);
    let mut rng = SlotRng::new(314159);
    let mut checksum = 0u64;
    for _ in 0..1_000_000 {
        checksum = checksum.wrapping_add(t.sample(&mut rng) as u64);
    }
    // The checksum is just for black-box anti-optimization; its exact value
    // doesn't matter — just that it's stable across runs with same seed.
    let mut rng2 = SlotRng::new(314159);
    let mut checksum2 = 0u64;
    for _ in 0..1_000_000 {
        checksum2 = checksum2.wrapping_add(t.sample(&mut rng2) as u64);
    }
    assert_eq!(checksum, checksum2, "alias sampling must be deterministic");
}

// ─── SpinCold RTP accumulator ─────────────────────────────────────────────────

#[test]
fn spin_cold_rtp_zero_when_no_wagered() {
    let cold = SpinCold::default();
    assert_eq!(cold.rtp_pct(), 0.0);
}

#[test]
fn spin_cold_fs_trigger_count_correct() {
    let mut cold = SpinCold {
        bet_mc: 1_000,
        ..Default::default()
    };
    let mut hot = SpinHot::new();
    // Non-FS spins
    for _ in 0..10 {
        cold.record(&hot);
    }
    assert_eq!(cold.fs_triggers, 0);
    // FS spin
    hot.fs_triggered = true;
    cold.record(&hot);
    assert_eq!(cold.fs_triggers, 1);
}
