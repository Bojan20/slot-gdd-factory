//! Zero-allocation Lines evaluator for packed grids.
//!
//! ## Design
//!
//! The baseline `Evaluator::evaluate_spin` allocates a `Vec<LineWin>` on every
//! spin call.  With 50 M spins per simulation that is 50 M small allocations —
//! significant overhead even with the allocator's free-list.
//!
//! `ZeroAllocEvaluator` avoids this entirely:
//!
//! - Paytable is stored as `[[i64; 3]; MAX_SYMS]` — a fixed stack array.
//! - Payline definitions are stored as `[[u8; MAX_REELS]; MAX_PAYLINES]`.
//! - `eval_lines` returns a `PackedSpinResult` — 12 bytes on the stack.
//! - No `Vec`, no `Box`, no dynamic dispatch anywhere in the hot path.
//!
//! Correctness is guaranteed by the cross-validator in `faza9_speed.rs` which
//! runs both evaluators on identical grids and asserts identical totals.
//!
//! ## Scope
//!
//! Only **Lines** mode is implemented here (by far the most common production
//! game type).  Ways/Cluster/Variable-Ways require dynamic intermediate storage
//! (per-reel hit counts) that can't fit in constant-size stack arrays at the
//! maximum grid dimensions — use `bumpalo` arena allocation for those (see
//! `arena_eval.rs`).

use super::packed_grid::PackedGrid;
use crate::config::GameConfig;

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum paylines the zero-alloc evaluator supports.
pub const MAX_PAYLINES: usize = 64;
/// Maximum reels supported (must match `PackedGrid::MAX_REELS`).
pub const MAX_REELS: usize = 8;
/// Maximum distinct symbol indices supported.
pub const MAX_SYMS: usize = 32;

/// Sentinel value meaning "no such symbol".
const NO_SYM: u8 = u8::MAX;

// ─── PackedSpinResult ─────────────────────────────────────────────────────────

/// Stack-only spin result — zero heap footprint.
///
/// Semantics mirror `SpinResult` from the legacy evaluator, minus the
/// `Vec<LineWin>` (individual line wins are not stored — only the total).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PackedSpinResult {
    /// Sum of all line wins (millicredits, bet-scaled).
    pub base_win: i64,
    /// Number of scatter symbols on the grid.
    pub scatter_count: u8,
    /// Number of bonus (HnW) symbols on the grid.
    pub bonus_count: u8,
    /// `true` if `scatter_count >= fs_trigger_count`.
    pub fs_triggered: bool,
    /// `true` if `bonus_count >= hnw_trigger_count`.
    pub hnw_triggered: bool,
}

// ─── ZeroAllocEvaluator ───────────────────────────────────────────────────────

/// Zero-allocation Lines evaluator for `PackedGrid`.
///
/// All internal tables live on the stack; no heap allocation occurs after
/// construction.  Build with [`ZeroAllocEvaluator::from_config`], then call
/// [`eval_lines`] per spin.
pub struct ZeroAllocEvaluator {
    /// `paytable[sym][count-3]` — payout in millicredits (unscaled by bet).
    paytable: [[i64; 3]; MAX_SYMS],
    /// `paylines[i][reel]` — row index for payline `i` on reel `reel`.
    paylines: [[u8; MAX_REELS]; MAX_PAYLINES],
    /// Number of active paylines.
    payline_count: usize,
    /// Wild symbol index, or `NO_SYM` if none.
    wild_idx: u8,
    /// Scatter symbol index, or `NO_SYM` if none.
    scatter_idx: u8,
    /// Bonus symbol index, or `NO_SYM` if none.
    bonus_idx: u8,
    /// Number of reels.
    reels: usize,
    /// Number of rows.
    rows: usize,
    /// Scatter count that triggers free spins.
    fs_trigger_count: u8,
    /// Bonus count that triggers Hold-and-Win.
    hnw_trigger_count: u8,
}

impl ZeroAllocEvaluator {
    // ── Constructor ──────────────────────────────────────────────────────

    /// Build a `ZeroAllocEvaluator` from a `GameConfig`.
    ///
    /// Copies all paytable and payline data into fixed-size arrays.
    /// Panics if `config.paylines` exceeds `MAX_PAYLINES` or any symbol index
    /// exceeds `MAX_SYMS - 1`.
    pub fn from_config(config: &GameConfig) -> Self {
        let reels = config.reels as usize;
        let rows = config.rows as usize;

        // ── Paytable ──────────────────────────────────────────────────────
        let mut paytable = [[0i64; 3]; MAX_SYMS];
        for (sym_id, pay) in &config.paytable {
            if let Some(idx) = config.symbol_index(sym_id) {
                assert!(
                    idx < MAX_SYMS,
                    "symbol index {idx} exceeds MAX_SYMS={MAX_SYMS}"
                );
                paytable[idx][0] = (pay.pay3 * 1_000.0) as i64;
                paytable[idx][1] = (pay.pay4 * 1_000.0) as i64;
                paytable[idx][2] = (pay.pay5 * 1_000.0) as i64;
            }
        }

        // ── Paylines ──────────────────────────────────────────────────────
        let payline_count = config.paylines.len();
        assert!(
            payline_count <= MAX_PAYLINES,
            "config has {payline_count} paylines; ZeroAllocEvaluator supports max {MAX_PAYLINES}"
        );
        let mut paylines = [[0u8; MAX_REELS]; MAX_PAYLINES];
        for (i, pl) in config.paylines.iter().enumerate() {
            for r in 0..reels.min(MAX_REELS) {
                paylines[i][r] = *pl.get(r).unwrap_or(&0);
            }
        }

        // ── Special symbol indices ─────────────────────────────────────────
        let wild_idx = config
            .symbols
            .iter()
            .position(|s| s.is_wild)
            .map(|i| i as u8)
            .unwrap_or(NO_SYM);
        let scatter_idx = config
            .symbols
            .iter()
            .position(|s| s.is_scatter)
            .map(|i| i as u8)
            .unwrap_or(NO_SYM);
        let bonus_idx = config
            .symbols
            .iter()
            .position(|s| s.is_bonus)
            .map(|i| i as u8)
            .unwrap_or(NO_SYM);

        ZeroAllocEvaluator {
            paytable,
            paylines,
            payline_count,
            wild_idx,
            scatter_idx,
            bonus_idx,
            reels,
            rows,
            fs_trigger_count: 3,
            hnw_trigger_count: config.hold_and_win.trigger_count,
        }
    }

    // ── Public hot-path ───────────────────────────────────────────────────

    /// Evaluate a `PackedGrid` for **Lines mode** — zero heap allocations.
    ///
    /// `total_bet_mc` is the total bet in millicredits (1 credit = 1000 mc).
    ///
    /// Returns a `PackedSpinResult` on the stack.
    #[inline]
    pub fn eval_lines(&self, grid: PackedGrid, total_bet_mc: i64) -> PackedSpinResult {
        let mut base_win = 0i64;
        let mut scatter_count = 0u8;
        let mut bonus_count = 0u8;

        // ── Count special symbols (scalar loop over all cells) ────────────
        for r in 0..self.reels {
            for row in 0..self.rows {
                let sym = grid.get(r, row, self.rows);
                if sym == self.scatter_idx {
                    scatter_count += 1;
                }
                if sym == self.bonus_idx {
                    bonus_count += 1;
                }
            }
        }

        // ── Evaluate paylines (fully on the stack) ────────────────────────
        for pl in 0..self.payline_count {
            // Gather line symbols into a stack array — never heap.
            let mut line = [0u8; MAX_REELS];
            for r in 0..self.reels {
                line[r] = grid.get(r, self.paylines[pl][r] as usize, self.rows);
            }
            base_win += self.eval_payline(&line, total_bet_mc);
        }

        // Mirror legacy `Evaluator` mutual-exclusion: HnW takes priority over FS.
        // Legacy code: `if hnw { ... } else if scatter >= 3 { ... }` — when HnW
        // fires, FS does NOT fire even if scatter_count >= 3.
        let hnw_triggered = bonus_count >= self.hnw_trigger_count;
        let fs_triggered = !hnw_triggered && scatter_count >= self.fs_trigger_count;

        PackedSpinResult {
            base_win,
            scatter_count,
            bonus_count,
            fs_triggered,
            hnw_triggered,
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────

    /// Evaluate one payline and return the win in millicredits.
    ///
    /// Logic mirrors `Evaluator::evaluate_payline` exactly:
    /// - First symbol is scatter/bonus → no win.
    /// - Chain length: consecutive non-scatter/bonus symbols from reel 0.
    /// - Best of `(first non-wild paying symbol, wild-only)`.
    #[inline(always)]
    fn eval_payline(&self, line: &[u8; MAX_REELS], bet_mc: i64) -> i64 {
        let s0 = line[0];

        // Scatter or bonus at reel 0 breaks all paylines.
        if self.is_blocker(s0) {
            return 0;
        }

        // Chain: consecutive non-blocker cells from left.
        let mut chain = 0usize;
        for r in 0..self.reels {
            if self.is_blocker(line[r]) {
                break;
            }
            chain += 1;
        }
        if chain < 3 {
            return 0;
        }

        // First non-wild paying symbol in the chain.
        let target = (0..chain)
            .map(|r| line[r])
            .find(|&s| s != self.wild_idx && self.get_pay_raw(s, 3) > 0);

        let mut best = 0i64;

        if let Some(tgt) = target {
            best = best.max(self.count_and_pay(line, chain, tgt, bet_mc));
        }
        // Wild-only win (only if wild symbol exists).
        if self.wild_idx != NO_SYM {
            best = best.max(self.count_and_pay(line, chain, self.wild_idx, bet_mc));
        }

        best
    }

    /// Count consecutive matches of `tgt` (or wild) from reel 0, then pay.
    #[inline(always)]
    fn count_and_pay(&self, line: &[u8; MAX_REELS], chain: usize, tgt: u8, bet_mc: i64) -> i64 {
        let mut count = 0usize;
        for r in 0..chain {
            let s = line[r];
            if s == tgt || s == self.wild_idx {
                count += 1;
            } else {
                break;
            }
        }
        if count < 3 {
            return 0;
        }
        let raw = self.get_pay_raw(tgt, count as u8);
        if raw <= 0 {
            return 0;
        }
        raw.saturating_mul(bet_mc) / 1_000
    }

    /// `paytable[sym][count-3]` with bounds-checked access.
    #[inline(always)]
    fn get_pay_raw(&self, sym: u8, count: u8) -> i64 {
        if (sym as usize) >= MAX_SYMS || count < 3 || count > 5 {
            return 0;
        }
        self.paytable[sym as usize][(count - 3) as usize]
    }

    /// `true` if `sym` blocks a payline (scatter or bonus).
    #[inline(always)]
    fn is_blocker(&self, sym: u8) -> bool {
        sym == self.scatter_idx || sym == self.bonus_idx
    }

    // ── Accessors for tests ───────────────────────────────────────────────

    #[cfg(test)]
    pub fn reels(&self) -> usize {
        self.reels
    }
    #[cfg(test)]
    pub fn rows(&self) -> usize {
        self.rows
    }
    #[cfg(test)]
    pub fn scatter_idx(&self) -> u8 {
        self.scatter_idx
    }
    #[cfg(test)]
    pub fn bonus_idx(&self) -> u8 {
        self.bonus_idx
    }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::*;
    use std::collections::HashMap;

    // ── Helpers ───────────────────────────────────────────────────────────

    /// Build a 5×3 config with 5 symbols and 5 paylines.
    ///
    /// **W is intentionally excluded from the paytable** so that the default
    /// all-zero (= all-wild) `PackedGrid` produces zero win.  Wild still
    /// substitutes for H1/L1 — tested explicitly in `wild_substitutes_for_h1`.
    fn make_config() -> GameConfig {
        let mut cfg = GameConfig::default();
        cfg.paylines = vec![
            vec![1, 1, 1, 1, 1], // middle row
            vec![0, 0, 0, 0, 0], // top row
            vec![2, 2, 2, 2, 2], // bottom row
            vec![0, 1, 2, 1, 0], // V shape
            vec![2, 1, 0, 1, 2], // inverted V
        ];
        // W (idx=0) NOT in paytable → wild-only chains yield 0.
        // This lets us use PackedGrid::default() (all-zero = all-wild) as a
        // zero-win baseline while still testing wild substitution.
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
        cfg
    }

    /// Block all paylines except the middle row by placing scatter (idx=3) on
    /// reel 0 at rows 0 and 2.  Any payline that passes through row 0 or
    /// row 2 at reel 0 is immediately blocked (`is_blocker` check on sym[0]).
    ///
    /// Paylines that use row 1 at reel 0 (only the middle row `[1,…]`) are
    /// unaffected.  Non-scatter off-payline cells remain at 0 (W = wild), but
    /// since W is not in the paytable those cells contribute nothing.
    fn block_non_middle_paylines(g: &mut PackedGrid) {
        let rows = 3;
        g.set(0, 0, rows, 3); // scatter on (reel=0, row=0) — blocks top + V-shape
        g.set(0, 2, rows, 3); // scatter on (reel=0, row=2) — blocks bottom + inv-V
    }

    // ── Tests ─────────────────────────────────────────────────────────────

    #[test]
    fn no_symbols_set_gives_zero_win() {
        // PackedGrid::default() = all 0 = all W (wild).
        // W is NOT in the paytable, so wild-only chains pay nothing.
        let cfg = make_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let g = PackedGrid::default();
        let res = eval.eval_lines(g, 1_000);
        assert_eq!(
            res.base_win, 0,
            "wild-only grid with W not in paytable → zero win"
        );
        assert_eq!(res.scatter_count, 0);
        assert_eq!(res.bonus_count, 0);
        assert!(!res.fs_triggered);
        assert!(!res.hnw_triggered);
    }

    #[test]
    fn h1_five_of_a_kind_on_middle_line() {
        let cfg = make_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let rows = 3;
        let mut g = PackedGrid::default();
        // Block all non-middle paylines via scatter at reel 0.
        block_non_middle_paylines(&mut g);
        // Place H1 (idx=1) on the entire middle row.
        for r in 0..5 {
            g.set(r, 1, rows, 1);
        }
        let bet_mc = 1_000i64;
        let res = eval.eval_lines(g, bet_mc);
        // Middle row: H1 pay5 = 100 × bet/1000 = 100_000 mc.
        assert_eq!(
            res.base_win, 100_000,
            "H1×5 on middle line; got {}",
            res.base_win
        );
    }

    #[test]
    fn scatter_at_reel0_on_all_rows_blocks_every_payline() {
        let cfg = make_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let rows = 3;
        let mut g = PackedGrid::default();
        // Scatter (idx=3) on ALL rows of reel 0 → every payline blocked.
        for row in 0..rows {
            g.set(0, row, rows, 3);
        }
        // Fill reels 1-4 with H1 (would pay if not blocked).
        for r in 1..5 {
            for row in 0..rows {
                g.set(r, row, rows, 1);
            }
        }
        let res = eval.eval_lines(g, 1_000);
        assert_eq!(
            res.base_win, 0,
            "scatter on all rows of reel 0: all paylines blocked"
        );
        assert_eq!(res.scatter_count, 3, "exactly 3 scatters at reel 0");
    }

    #[test]
    fn three_scatters_trigger_fs() {
        let cfg = make_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let mut g = PackedGrid::default();
        let rows = 3;
        // Place 3 scatters on separate reels/rows (not at reel 0 col 0/1 to keep grid clean).
        g.set(1, 0, rows, 3);
        g.set(3, 0, rows, 3);
        g.set(4, 2, rows, 3);
        let res = eval.eval_lines(g, 1_000);
        assert_eq!(res.scatter_count, 3);
        assert!(res.fs_triggered, "3 scatters must trigger FS");
        assert!(!res.hnw_triggered);
    }

    #[test]
    fn wild_substitutes_for_h1_on_isolated_payline() {
        let cfg = make_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let rows = 3;
        let mut g = PackedGrid::default();
        // Block non-middle paylines.
        block_non_middle_paylines(&mut g);
        // Middle row: W(0) at reel 0, H1(1) at reels 1-4.
        g.set(0, 1, rows, 0); // W (wild)
        for r in 1..5 {
            g.set(r, 1, rows, 1);
        } // H1
        let res = eval.eval_lines(g, 1_000);
        // W + H1×4 → chain of 5 counting W as wild → H1-pay5 = 100_000 mc.
        assert_eq!(
            res.base_win, 100_000,
            "wild sub gives H1×5; got {}",
            res.base_win
        );
    }

    #[test]
    fn three_of_a_kind_on_isolated_middle_line() {
        let cfg = make_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let rows = 3;
        let mut g = PackedGrid::default();
        block_non_middle_paylines(&mut g);
        // H1 at reels 0-2, L1 at reels 3-4 on the middle row.
        // The chain stops at reel 3 (L1 ≠ H1 and L1 ≠ wild) → 3-of-a-kind H1.
        for r in 0..3 {
            g.set(r, 1, rows, 1);
        } // H1
        for r in 3..5 {
            g.set(r, 1, rows, 2);
        } // L1
        let res = eval.eval_lines(g, 1_000);
        // H1 pay3 = 5 × bet_mc/1000 = 5_000 mc.
        assert_eq!(res.base_win, 5_000, "H1×3; got {}", res.base_win);
    }

    #[test]
    fn hnw_trigger_requires_config_count() {
        // Default HnW trigger = 6 bonus symbols.
        let cfg = make_config();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let rows = 3;
        let mut g = PackedGrid::default();
        // 5 bonus (idx=4): should NOT trigger HnW.
        g.set(0, 0, rows, 4);
        g.set(1, 0, rows, 4);
        g.set(2, 0, rows, 4);
        g.set(3, 0, rows, 4);
        g.set(4, 0, rows, 4);
        let res = eval.eval_lines(g, 1_000);
        assert_eq!(res.bonus_count, 5);
        assert!(
            !res.hnw_triggered,
            "5 bonus < 6 required — must not trigger"
        );

        // 6th bonus → triggers HnW.
        g.set(0, 1, rows, 4);
        let res = eval.eval_lines(g, 1_000);
        assert_eq!(res.bonus_count, 6);
        assert!(
            res.hnw_triggered,
            "6 bonus == trigger_count=6 — must trigger"
        );
    }

    #[test]
    fn no_paytable_entry_gives_zero_win() {
        // Config with no paytable at all — nothing pays.
        let mut cfg = make_config();
        cfg.paytable.clear();
        let eval = ZeroAllocEvaluator::from_config(&cfg);
        let rows = 3;
        let mut g = PackedGrid::default();
        // Fill middle row with H1.
        for r in 0..5 {
            g.set(r, 1, rows, 1);
        }
        let res = eval.eval_lines(g, 1_000);
        assert_eq!(res.base_win, 0, "empty paytable → zero win");
    }
}
