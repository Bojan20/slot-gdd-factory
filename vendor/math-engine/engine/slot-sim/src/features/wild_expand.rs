//! W4.9 — Wild expansion runner (L&W CE base game).
//!
//! L&W CE PAR-001 documents:
//!     "In the base game, Wild appears on reels 2,3,4,5 and EXPANDS to
//!      fill the corresponding reel with Wild.
//!      Wild expansion only occurs if it results in a winning combo."
//!
//! Runner behavior:
//!   1. Iterate `on_reels` (e.g. [1,2,3,4] = reels 2-5 in 0-indexed).
//!   2. For each such reel that contains a Wild symbol in the visible
//!      window, create a hypothetical grid clone with the entire reel
//!      filled with Wild.
//!   3. Re-evaluate line wins on the expanded grid.
//!   4. Return the DELTA (expanded_line_coins − original_line_coins) so
//!      the engine adds only the incremental contribution. If `only_if
//!      _winning` is set and delta ≤ 0, return 0 (don't expand when it
//!      would lower payout).

use crate::evaluate::{evaluate_lines, CompiledPaytable, SpinWin};
use crate::features::FeatureOutcome;
use crate::ir::{Evaluation, Ir, SymbolRole};
use crate::reels::Grid;
use crate::rng::Prng;

#[derive(Debug, Clone)]
pub struct WildExpandParams<'a> {
    pub wild_symbol: &'a str,
    pub on_reels: &'a [u32],
    pub only_if_winning: bool,
    /// W4.9d — restrict expansion to spins where base grid has NO line
    /// wins (Excel target match for L&W CE: "expansion fires only when
    /// it RESULTS IN a winning combo" interpreted as "creates a NEW
    /// winning combo, not amplifies an existing one"). Defaults false
    /// to preserve W4.9b behavior; A/B compare against Excel determines
    /// final value.
    pub expand_only_when_base_no_win: bool,
    /// W4.9d — true = iterate all 2^n−1 subsets and take delta-max
    /// (over-pays L&W by ~0.4 %); false = expand ALL eligible reels at
    /// once (L&W canonical: "every Wild on reels 2-5 expands when the
    /// expansion forms a winning combo"). Defaults true to preserve
    /// W4.9b semantics; adapter A/B-toggles to determine correct
    /// vendor-specific value.
    pub subset_search: bool,
}

pub fn run(
    params: &WildExpandParams,
    ir: &Ir,
    grid: &Grid,
    base: &SpinWin,
    pt: &CompiledPaytable,
    _rng: &mut Prng,
) -> FeatureOutcome {
    let mut out = FeatureOutcome::default();
    if !matches!(&ir.evaluation, Evaluation::Lines { .. }) {
        return out;
    }
    if params.on_reels.is_empty() {
        return out;
    }

    let wild_id = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Wild)
        .map(|s| s.id.as_str())
        .unwrap_or(params.wild_symbol);

    let rows = grid.rows();
    let mut to_expand: Vec<usize> = Vec::new();
    for &reel_u in params.on_reels {
        let r = reel_u as usize;
        if r >= grid.reels() {
            continue;
        }
        for row in 0..rows {
            if grid.cell(r, row) == wild_id {
                to_expand.push(r);
                break;
            }
        }
    }
    if to_expand.is_empty() {
        return out;
    }

    // W4.9b — L&W "results in a winning combo" rule: expansion fires
    // only when it would create a new ≥3-of-a-kind line where the base
    // grid wasn't already paying. If the base line already wins,
    // expansion that simply upgrades 3OAK→4OAK→5OAK is allowed because
    // it preserves the winning combo (the combo IS a winning one) —
    // L&W pays the higher count.
    //
    // W4.9d — `subset_search` chooses between two strategies:
    //   true  (W4.9b default): iterate ALL 2^n−1 subsets and pick the
    //         delta-maximizing one (over-pays vs Excel by ~0.4 %)
    //   false (W4.9d trial): expand ALL eligible reels at once (single
    //         deterministic expansion; matches L&W published behavior
    //         of "every Wild on reels 2-5 expands when triggered")
    let base_line_coins = base.line_coins;
    let mut best_extra = 0.0_f64;
    let mut expansions_used: Vec<usize> = Vec::new();
    let n = to_expand.len();
    if params.subset_search {
        for mask in 1..(1u32 << n) {
            let mut g = grid.clone();
            let mut chosen: Vec<usize> = Vec::new();
            for (i, &reel) in to_expand.iter().enumerate() {
                if (mask >> i) & 1 == 1 {
                    for row in 0..rows {
                        g.cells[reel][row] = wild_id.to_string();
                    }
                    chosen.push(reel);
                }
            }
            let exp_win = evaluate_lines(&g, ir, pt);
            let delta = exp_win.line_coins - base_line_coins;
            if delta > best_extra {
                best_extra = delta;
                expansions_used = chosen;
            }
        }
    } else {
        // Expand every eligible reel simultaneously (no subset search).
        let mut g = grid.clone();
        for &reel in &to_expand {
            for row in 0..rows {
                g.cells[reel][row] = wild_id.to_string();
            }
        }
        let exp_win = evaluate_lines(&g, ir, pt);
        let delta = exp_win.line_coins - base_line_coins;
        if delta > 0.0 {
            best_extra = delta;
            expansions_used = to_expand.clone();
        }
    }

    if params.only_if_winning && best_extra <= 0.0 {
        return out;
    }
    if best_extra > 0.0 {
        // W4.9d hypothesis: L&W "wild expansion creates winning combo"
        // rule MAY mean "only fires when base grid has NO winning line";
        // gated by `expand_only_when_base_no_win` so it can be toggled
        // for empirical RTP comparison. Default-off (preserves W4.9b
        // behavior); to enable, set the field on WildExpand IR feature.
        if params.expand_only_when_base_no_win && base_line_coins > 0.0 {
            return out;
        }
        out.coins += best_extra;
        out.events.push(format!("wild_expand:{}", expansions_used.len()));
    }
    out
}
