//! Faza 10.1 — Property-based tests (proptest).
//!
//! Verifies mathematical invariants that must hold for **all** valid inputs,
//! not just the specific cases in unit/integration tests.
//!
//! ## Covered properties
//!
//! | Component          | Property                                                  |
//! |--------------------|-----------------------------------------------------------|
//! | `AliasTable`       | sample ∈ input symbols; marginals match weights           |
//! | `PackedGrid`       | set/get round-trip; neighbor isolation; pack/unpack       |
//! | `ZeroAllocEvaluator` | base_win ≥ 0; mutual exclusion FS/HnW; counts bounded   |
//! | `SlotRng`          | random ∈ [0, 1); same seed → same sequence                |
//! | `PackedGridGenerator` | generated symbols within declared range               |
//!
//! Acceptance criterion: 1000+ random cases → 0 violations, 0 panics.
//!
//! NOTE: proptest macros use `concat!()` internally, so they do NOT support
//! Rust 2021 implicit format-arg captures. Use `"msg {} {}", var1, var2` form.

use proptest::prelude::*;
use slot_sim::{
    config::{GameConfig, PayEntry, ReelWeight},
    rng::SlotRng,
    speed::{AliasTable, PackedGrid, PackedGridGenerator, ZeroAllocEvaluator},
};
use std::collections::HashMap;

// ─── Shared helpers ───────────────────────────────────────────────────────────

/// Minimal valid 5×3 / 5-payline config for property tests.
/// W excluded from paytable to prevent all-zero-grid false wins.
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

// ─── AliasTable strategies ────────────────────────────────────────────────────

/// Generate a random Vec of (symbol_index, weight) pairs suitable for AliasTable::build.
/// Symbols are distinct u8 indices in 0..=30 (5-bit constraint).
fn arb_alias_entries() -> impl Strategy<Value = Vec<(u8, u32)>> {
    (1usize..=30usize).prop_flat_map(|n| {
        prop::sample::subsequence((0u8..=30u8).collect::<Vec<_>>(), n..=n).prop_flat_map(
            move |syms| {
                prop::collection::vec(1u32..=10_000u32, n)
                    .prop_map(move |weights| syms.iter().copied().zip(weights).collect::<Vec<_>>())
            },
        )
    })
}

// ─── AliasTable properties ────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 500,
        ..Default::default()
    })]

    /// Every sampled symbol must be one of the input symbol indices.
    #[test]
    fn alias_sample_always_in_input_set(
        entries in arb_alias_entries(),
        seed in 0u64..=u64::MAX,
    ) {
        let valid: std::collections::HashSet<u8> =
            entries.iter().map(|(s, _)| *s).collect();
        let t = AliasTable::build(&entries);
        let mut rng = SlotRng::new(seed);
        for _ in 0..200 {
            let s = t.sample(&mut rng);
            prop_assert!(
                valid.contains(&s),
                "sample returned {} which is not in input set", s
            );
        }
    }

    /// Marginal probabilities of all symbols sum to 1.0 (within floating-point tolerance).
    #[test]
    fn alias_marginal_probs_sum_to_one(entries in arb_alias_entries()) {
        let t = AliasTable::build(&entries);
        let valid: Vec<u8> = entries.iter().map(|(s, _)| *s).collect();
        let sum: f64 = valid.iter().map(|&s| t.marginal_probability(s)).sum();
        prop_assert!(
            (sum - 1.0).abs() < 1e-9,
            "marginal prob sum = {:.12} (expected 1.0)", sum
        );
    }

    /// Marginal probability of each symbol matches weight / total_weight.
    #[test]
    fn alias_marginals_match_weights(entries in arb_alias_entries()) {
        let total_w: u64 = entries.iter().map(|(_, w)| *w as u64).sum();
        let t = AliasTable::build(&entries);
        for (sym, w) in &entries {
            let expected = *w as f64 / total_w as f64;
            let actual   = t.marginal_probability(*sym);
            prop_assert!(
                (actual - expected).abs() < 1e-9,
                "sym {}: marginal={:.12} expected={:.12}", sym, actual, expected
            );
        }
    }

    /// AliasTable with a single entry always returns that entry.
    #[test]
    fn alias_single_entry_always_returns_it(
        sym in 0u8..=30u8,
        weight in 1u32..=10_000u32,
        seed in 0u64..=u64::MAX,
    ) {
        let t = AliasTable::build(&[(sym, weight)]);
        let mut rng = SlotRng::new(seed);
        for _ in 0..100 {
            prop_assert_eq!(t.sample(&mut rng), sym,
                "single-entry table must always return sym={}", sym);
        }
    }
}

// ─── PackedGrid properties ────────────────────────────────────────────────────

/// Strategy: random (reel, row, num_rows) within PackedGrid's valid range.
fn arb_cell() -> impl Strategy<Value = (usize, usize, usize, u8)> {
    (1usize..=5usize).prop_flat_map(|rows| (0usize..5usize, 0usize..rows, Just(rows), 0u8..32u8))
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 1_000,
        ..Default::default()
    })]

    /// set/get round-trip: any valid cell write is immediately readable.
    #[test]
    fn packed_grid_set_get_round_trip(
        (reel, row, rows, sym) in arb_cell(),
    ) {
        let mut g = PackedGrid::default();
        g.set(reel, row, rows, sym);
        let got = g.get(reel, row, rows);
        prop_assert_eq!(got, sym,
            "set/get round-trip: reel={} row={} rows={} sym={} got={}", reel, row, rows, sym, got);
    }

    /// Overwriting a cell does not corrupt adjacent cells.
    #[test]
    fn packed_grid_overwrite_no_neighbor_corruption(
        rows in 1usize..=5usize,
        sym_a in 0u8..32u8,
        sym_b in 0u8..32u8,
    ) {
        let mut g = PackedGrid::default();
        for r in 0..5usize {
            for row in 0..rows {
                g.set(r, row, rows, sym_a);
            }
        }
        let target_reel = 2usize;
        let target_row  = rows.min(1).min(rows - 1);
        g.set(target_reel, target_row, rows, sym_b);

        prop_assert_eq!(g.get(target_reel, target_row, rows), sym_b,
            "overwrite failed: expected {} got {}", sym_b, g.get(target_reel, target_row, rows));

        for r in 0..5usize {
            for row in 0..rows {
                if r == target_reel && row == target_row { continue; }
                let got = g.get(r, row, rows);
                prop_assert_eq!(got, sym_a,
                    "neighbor ({},{}) corrupted: got {} != sym_a {}", r, row, got, sym_a);
            }
        }
    }

    /// pack(unpack(g)) identity — for random grids.
    #[test]
    fn packed_grid_pack_unpack_identity(
        rows in 1usize..=5usize,
        syms in prop::collection::vec(0u8..32u8, 25usize),
    ) {
        let reels = 5usize;
        let mut g = PackedGrid::default();
        for r in 0..reels {
            for row in 0..rows {
                g.set(r, row, rows, syms[r * rows + row]);
            }
        }
        let flat = g.unpack(reels, rows);
        let g2   = PackedGrid::pack(&flat, reels, rows);
        for r in 0..reels {
            for row in 0..rows {
                let v1 = g.get(r, row, rows);
                let v2 = g2.get(r, row, rows);
                prop_assert_eq!(v1, v2,
                    "pack/unpack mismatch at ({},{}) v1={} v2={}", r, row, v1, v2);
            }
        }
    }

    /// Any value written must be retrievable; the upper 3 bits are masked away.
    #[test]
    fn packed_grid_only_5_bits_stored(
        reel in 0usize..5usize,
        row in 0usize..3usize,
        val in 0u8..32u8,
    ) {
        let rows = 3;
        let mut g = PackedGrid::default();
        g.set(reel, row, rows, val);
        let got = g.get(reel, row, rows);
        prop_assert_eq!(got, val & 0x1F,
            "stored {:#04x}, got {:#04x}", val, got);
    }
}

// ─── ZeroAllocEvaluator properties ───────────────────────────────────────────

/// Strategy: random PackedGrid for the standard 5×3 config.
fn arb_packed_grid_5x3() -> impl Strategy<Value = PackedGrid> {
    prop::collection::vec(0u8..5u8, 15usize).prop_map(|syms| {
        let mut g = PackedGrid::default();
        for r in 0..5usize {
            for row in 0..3usize {
                g.set(r, row, 3, syms[r * 3 + row]);
            }
        }
        g
    })
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 2_000,
        ..Default::default()
    })]

    /// base_win is always non-negative for non-negative bets.
    #[test]
    fn eval_base_win_non_negative(
        grid in arb_packed_grid_5x3(),
        bet_mc in 0i64..=1_000_000i64,
    ) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, bet_mc);
        prop_assert!(res.base_win >= 0,
            "base_win = {} for bet_mc = {}", res.base_win, bet_mc);
    }

    /// base_win is always zero for any non-positive bet.
    /// (eval_payline uses max(0, pay) guard internally.)
    #[test]
    fn eval_non_positive_bet_gives_zero_win(
        grid in arb_packed_grid_5x3(),
        bet_mc in i64::MIN..=0i64,
    ) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, bet_mc);
        prop_assert_eq!(res.base_win, 0,
            "bet={} but base_win = {} (expected 0)", bet_mc, res.base_win);
    }

    /// scatter_count ≤ reels × rows (15 for a 5×3 grid).
    #[test]
    fn eval_scatter_count_bounded(grid in arb_packed_grid_5x3()) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, 1_000);
        prop_assert!(res.scatter_count <= 15,
            "scatter_count = {} > 15", res.scatter_count);
    }

    /// bonus_count ≤ reels × rows (15 for a 5×3 grid).
    #[test]
    fn eval_bonus_count_bounded(grid in arb_packed_grid_5x3()) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, 1_000);
        prop_assert!(res.bonus_count <= 15,
            "bonus_count = {} > 15", res.bonus_count);
    }

    /// FS and HnW are mutually exclusive (HnW takes priority).
    #[test]
    fn eval_fs_and_hnw_mutually_exclusive(grid in arb_packed_grid_5x3()) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, 1_000);
        prop_assert!(
            !(res.fs_triggered && res.hnw_triggered),
            "fs={} AND hnw={} — mutual exclusion violated",
            res.fs_triggered, res.hnw_triggered
        );
    }

    /// FS triggered → scatter_count ≥ fs_trigger_count (3 by default).
    #[test]
    fn eval_fs_trigger_implies_scatter_ge_threshold(grid in arb_packed_grid_5x3()) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, 1_000);
        if res.fs_triggered {
            prop_assert!(res.scatter_count >= 3,
                "fs_triggered but scatter_count = {} < 3", res.scatter_count);
        }
    }

    /// HnW triggered → bonus_count ≥ hnw_trigger_count (6 by default).
    #[test]
    fn eval_hnw_trigger_implies_bonus_ge_threshold(grid in arb_packed_grid_5x3()) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, 1_000);
        if res.hnw_triggered {
            // Default hnw_trigger_count = 6
            prop_assert!(res.bonus_count >= 6,
                "hnw_triggered but bonus_count = {} < 6", res.bonus_count);
        }
    }

    /// Zero bet → zero win (evaluator is purely bet-proportional).
    #[test]
    fn eval_zero_bet_gives_zero_win(grid in arb_packed_grid_5x3()) {
        let cfg  = base_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let res  = eval.eval_lines(grid, 0);
        prop_assert_eq!(res.base_win, 0,
            "bet=0 but base_win = {}", res.base_win);
    }

    /// base_win is proportional to bet_mc (linear scaling).
    #[test]
    fn eval_win_scales_linearly_with_bet(
        grid in arb_packed_grid_5x3(),
        k in 1i64..=100i64,
    ) {
        let cfg    = base_config();
        let eval   = ZeroAllocEvaluator::from_config(&cfg);
        let res1   = eval.eval_lines(grid, 1_000);
        let res_k  = eval.eval_lines(grid, 1_000 * k);
        prop_assert_eq!(
            res_k.base_win, res1.base_win * k,
            "win({}xbet)={} != {}x win(bet)={}", k, res_k.base_win, k, res1.base_win
        );
    }
}

// ─── SlotRng properties ───────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 200,
        ..Default::default()
    })]

    /// random() always returns a value in [0, 1).
    #[test]
    fn rng_float_in_unit_interval(seed in 0u64..=u64::MAX) {
        let mut rng = SlotRng::new(seed);
        for _ in 0..1_000 {
            let v = rng.random();
            prop_assert!(v >= 0.0 && v < 1.0,
                "random() = {} out of [0, 1)", v);
            prop_assert!(!v.is_nan(),      "random() returned NaN");
            prop_assert!(!v.is_infinite(), "random() returned Inf");
        }
    }

    /// Same seed → same sequence (determinism).
    #[test]
    fn rng_same_seed_same_sequence(seed in 0u64..=u64::MAX) {
        let mut rng1 = SlotRng::new(seed);
        let mut rng2 = SlotRng::new(seed);
        for _ in 0..500 {
            prop_assert_eq!(rng1.random(), rng2.random(),
                "divergence for seed {}", seed);
        }
    }

    /// Different seeds (almost surely) produce different sequences.
    #[test]
    fn rng_different_seeds_different_outputs(
        s1 in 0u64..0x7FFF_FFFFu64,
        s2 in 0x8000_0000u64..=u64::MAX,
    ) {
        let mut rng1 = SlotRng::new(s1);
        let mut rng2 = SlotRng::new(s2);
        let all_same = (0..20).all(|_| rng1.random() == rng2.random());
        prop_assert!(!all_same,
            "seeds {} and {} produced identical 20-float sequence", s1, s2);
    }
}

// ─── PackedGridGenerator properties ──────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100,
        ..Default::default()
    })]

    /// Every generated symbol must be in the declared range [0, num_symbols).
    #[test]
    fn generator_symbols_always_in_range(seed in 0u64..=u64::MAX) {
        let cfg = base_config();
        let num_syms = cfg.symbols.len();
        let gen = PackedGridGenerator::from_config(&cfg);
        let mut rng = SlotRng::new(seed);
        for _ in 0..500 {
            let g = gen.generate_base(&mut rng);
            for r in 0..gen.reels() {
                for row in 0..gen.rows() {
                    let sym = g.get(r, row, gen.rows());
                    prop_assert!(
                        (sym as usize) < num_syms,
                        "symbol {} >= num_syms={} at ({},{})", sym, num_syms, r, row
                    );
                }
            }
        }
    }

    /// Determinism: same seed → same sequence of generated grids.
    #[test]
    fn generator_deterministic(seed in 0u64..=u64::MAX) {
        let cfg = base_config();
        let gen = PackedGridGenerator::from_config(&cfg);
        let mut rng1 = SlotRng::new(seed);
        let mut rng2 = SlotRng::new(seed);
        for _ in 0..200 {
            prop_assert_eq!(
                gen.generate_base(&mut rng1),
                gen.generate_base(&mut rng2),
                "generator diverged for seed {}", seed
            );
        }
    }
}
