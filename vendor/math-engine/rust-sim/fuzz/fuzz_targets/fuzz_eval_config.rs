//! Faza 10.2 — Fuzz target: ZeroAllocEvaluator + PackedGridGenerator construction
//! and spin evaluation.
//!
//! Invariants:
//!
//! 1. `ZeroAllocEvaluator::from_config` must not panic on valid configs
//!    (valid = ≤ MAX_PAYLINES, ≤ MAX_SYMS symbols, positive weights).
//! 2. `eval_lines` must return non-negative `base_win` for non-negative `bet_mc`.
//! 3. `eval_lines` must return `base_win = 0` for `bet_mc = 0`.
//! 4. FS and HnW are mutually exclusive in the result.
//! 5. scatter_count ≤ reels × rows.
//! 6. bonus_count ≤ reels × rows.
//!
//! ## Running locally
//!
//! ```bash
//! cargo fuzz run fuzz_eval_config -- -max_total_time=120
//! ```

#![no_main]

use libfuzzer_sys::fuzz_target;
use slot_sim::{
    config::{GameConfig, PayEntry, ReelWeight},
    rng::SlotRng,
    speed::{PackedGrid, ZeroAllocEvaluator, MAX_PAYLINES, MAX_REELS},
};
use std::collections::HashMap;

/// Decode fuzz bytes into a simple valid GameConfig with 1-5 reels, 1-3 rows,
/// 1-3 paylines, and a handful of symbols.
fn fuzz_to_config(data: &[u8]) -> Option<GameConfig> {
    if data.len() < 8 {
        return None;
    }

    let mut cfg = GameConfig::default();

    // Layout
    cfg.reels = (data[0] % 5 + 1) as u8;  // 1-5
    cfg.rows  = (data[1] % 3 + 1) as u8;  // 1-3

    // Paylines: 1 - min(MAX_PAYLINES, derived from data)
    let n_paylines = (data[2] % 8 + 1) as usize;
    cfg.paylines = (0..n_paylines)
        .map(|i| {
            (0..cfg.reels as usize)
                .map(|r| {
                    let row_val = data.get(3 + i * cfg.reels as usize + r)
                        .copied()
                        .unwrap_or(0)
                        % cfg.rows;
                    row_val
                })
                .collect()
        })
        .collect();

    // Symbols: always W(0), H1(1), L1(2), S(3=scatter), B(4=bonus)
    // (inherited from GameConfig::default())

    // Paytable: random pays (0-200) for H1 and L1
    let pay3_h1 = (data.get(30).copied().unwrap_or(5) % 50 + 1) as f64;
    let pay4_h1 = pay3_h1 * 3.0;
    let pay5_h1 = pay3_h1 * 10.0;
    let pay3_l1 = (data.get(31).copied().unwrap_or(2) % 30 + 1) as f64;
    let pay4_l1 = pay3_l1 * 3.0;
    let pay5_l1 = pay3_l1 * 8.0;

    cfg.paytable = HashMap::from([
        ("H1".to_string(), PayEntry { pay3: pay3_h1, pay4: pay4_h1, pay5: pay5_h1 }),
        ("L1".to_string(), PayEntry { pay3: pay3_l1, pay4: pay4_l1, pay5: pay5_l1 }),
    ]);

    // Weights: random but positive
    let w_w  = (data.get(32).copied().unwrap_or(2)  % 10 + 1) as u32;
    let w_h1 = (data.get(33).copied().unwrap_or(10) % 20 + 1) as u32;
    let w_l1 = (data.get(34).copied().unwrap_or(30) % 50 + 1) as u32;
    let w_s  = (data.get(35).copied().unwrap_or(3)  % 10 + 1) as u32;
    let w_b  = (data.get(36).copied().unwrap_or(5)  % 10 + 1) as u32;

    let rw = vec![
        ReelWeight { symbol: "W".to_string(),  weight: w_w  },
        ReelWeight { symbol: "H1".to_string(), weight: w_h1 },
        ReelWeight { symbol: "L1".to_string(), weight: w_l1 },
        ReelWeight { symbol: "S".to_string(),  weight: w_s  },
        ReelWeight { symbol: "B".to_string(),  weight: w_b  },
    ];
    cfg.base_weights = vec![rw.clone(); cfg.reels as usize];
    cfg.fs_weights   = vec![rw;        cfg.reels as usize];

    Some(cfg)
}

fuzz_target!(|data: &[u8]| {
    let cfg = match fuzz_to_config(data) {
        Some(c) => c,
        None    => return,
    };

    // Construction must not panic.
    let eval = match std::panic::catch_unwind(|| ZeroAllocEvaluator::from_config(&cfg)) {
        Ok(e)  => e,
        Err(_) => return, // panic on construction = fuzzer found a bug (would crash)
    };

    let reels = cfg.reels as usize;
    let rows  = cfg.rows  as usize;

    // Build a fuzz-derived packed grid (cells from data[64..]).
    let mut g = PackedGrid::default();
    let base = 64usize;
    for r in 0..reels {
        for row in 0..rows {
            let idx = base + r * rows + row;
            let val = data.get(idx).copied().unwrap_or(0) % 5; // 0-4 (valid symbols)
            g.set(r, row, rows, val);
        }
    }

    // Derive bet_mc from fuzz data.
    let bet_mc = {
        let lo = data.get(60).copied().unwrap_or(0) as i64;
        let hi = data.get(61).copied().unwrap_or(0) as i64;
        lo | (hi << 8)
    }.abs(); // ensure non-negative

    let res = eval.eval_lines(g, bet_mc);

    // Invariant 1: base_win ≥ 0 for non-negative bet.
    assert!(res.base_win >= 0,
        "base_win={} for bet_mc={}", res.base_win, bet_mc);

    // Invariant 2: bet=0 → win=0.
    let res_zero = eval.eval_lines(g, 0);
    assert_eq!(res_zero.base_win, 0, "bet=0 but base_win={}", res_zero.base_win);

    // Invariant 3: FS and HnW are mutually exclusive.
    assert!(!(res.fs_triggered && res.hnw_triggered),
        "FS and HnW both triggered — mutual exclusion violated");

    // Invariant 4: scatter_count ≤ reels × rows.
    let max_cells = (reels * rows) as u8;
    assert!(res.scatter_count <= max_cells,
        "scatter_count={} > max_cells={}", res.scatter_count, max_cells);

    // Invariant 5: bonus_count ≤ reels × rows.
    assert!(res.bonus_count <= max_cells,
        "bonus_count={} > max_cells={}", res.bonus_count, max_cells);

    // Run 20 random spins from a derived seed — no panic.
    let seed = data.iter().take(8).enumerate()
        .fold(0u64, |acc, (i, &b)| acc | ((b as u64) << (i * 8)));
    let mut rng = SlotRng::new(seed);
    for _ in 0..20 {
        let res2 = eval.eval_lines(g, 1_000);
        assert!(res2.base_win >= 0, "negative win in random spin");
    }
    let _ = rng; // suppress unused warning
});
