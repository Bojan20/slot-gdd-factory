//! Faza 9 — Speed: high-performance simulation primitives.
//!
//! This module ships four interlocking optimizations that together cut
//! per-spin CPU cost dramatically vs. the baseline `grid`/`evaluator` path:
//!
//! | Component | Baseline | Optimized | Technique |
//! |-----------|----------|-----------|-----------|
//! | Grid gen  | O(N) / cell | O(1) / cell | Walker's Alias Method |
//! | Grid store | Vec<Vec<u8>> | u128 packed | 5-bit cells, zero alloc |
//! | Evaluator  | Vec<LineWin> alloc | stack arrays | Fixed-size arrays |
//! | Scatter count | scalar loop | SIMD u8x16 | `wide` crate |
//!
//! Plus `hot_cold` cache-line layout that packs all per-spin hot state into
//! exactly 64 bytes (one cache line), eliminating false-sharing in
//! multi-threaded simulations.
//!
//! ## Usage
//!
//! ```rust,no_run
//! use slot_sim::speed::{PackedGridGenerator, ZeroAllocEvaluator};
//! use slot_sim::config::GameConfig;
//! use slot_sim::rng::SlotRng;
//!
//! let config = GameConfig::default();
//! // PackedGridGenerator requires non-empty base_weights — use a real config.
//! // let gen   = PackedGridGenerator::from_config(&config);
//! // let eval  = ZeroAllocEvaluator::from_config(&config);
//! // let mut rng = SlotRng::new(42);
//! // let grid = gen.generate_base(&mut rng);
//! // let result = eval.eval_lines(grid, 1_000);
//! ```
//!
//! ## Thread safety
//!
//! `PackedGridGenerator` and `ZeroAllocEvaluator` are both immutable after
//! construction and safe to share across threads.  `SlotRng` and `SpinHot`
//! are per-thread (one per Rayon worker).

pub mod alias;
pub mod hot_cold;
pub mod packed_eval;
pub mod packed_grid;
pub mod simd_eval;

pub use alias::AliasTable;
pub use hot_cold::{SpinCold, SpinHot};
pub use packed_eval::{PackedSpinResult, ZeroAllocEvaluator, MAX_PAYLINES, MAX_REELS, MAX_SYMS};
pub use packed_grid::{PackedGrid, PackedGridGenerator};
pub use simd_eval::{
    scalar_count_scatter_bonus, scalar_count_symbol, simd_count_multi4, simd_count_scatter_bonus,
    simd_count_symbol,
};
pub use simd_eval::{simd_accumulate_wins, scalar_accumulate_wins, simd_payline_hits, scalar_payline_hits};
