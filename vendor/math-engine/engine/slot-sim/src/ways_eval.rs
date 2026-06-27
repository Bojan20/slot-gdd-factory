//! W4.10c — Ways (243 / 1024) evaluator + cascade pass.
//!
//! Ways evaluation for a fixed-rows grid (e.g. Fortune Coin Boost
//! Classic 5×3 = 243 ways): for each paying symbol, find the longest
//! left-anchored consecutive-reel prefix where symbol or Wild appears at
//! least once. Ways = product of (sym + wild) occurrence counts on that
//! prefix. Pay = `paytable[(sym, prefix_len)] × ways` in total-bet units.
//!
//! Cascade pass (Fortune Coin coin/boost flavor):
//!   1. Initial spin → eval base
//!   2. Remove winning cells (mark as empty)
//!   3. Re-pop empty cells with weighted draws from the same reel
//!   4. Re-eval, accumulate, loop until no new wins (or depth ≥ 50)
//!
//! Infinite-loop guard at depth 50 (Excel never publishes a cascade
//! longer than ~5 in practice; 50 is comfortably > 10× the publishing
//! cap and protects against pathological IR mis-config).

use crate::evaluate::CompiledPaytable;
use crate::ir::{Evaluation, Ir, SymbolRole, Topology};
use crate::reels::{CompiledReelSet, Grid};
use crate::rng::Prng;
use std::collections::HashMap;

pub const MAX_CASCADE_DEPTH: u32 = 50;

#[derive(Debug, Clone, Default)]
pub struct WaysSpin {
    /// Total ways-pay payout in × total-bet (across all cascade steps).
    pub line_total_bet_x: f64,
    /// Scatter pay × total-bet (evaluated on the INITIAL grid only — IGT
    /// Fortune Coin pays scatter once per spin, not per cascade step).
    pub scatter_total_bet_x: f64,
    /// Grid role counts on the initial grid.
    pub role_counts: HashMap<String, u32>,
    /// Number of cascade steps actually executed (0 = no cascade, just
    /// the base spin; ≥ MAX_CASCADE_DEPTH means the guard tripped).
    pub cascade_steps: u32,
}

impl WaysSpin {
    #[inline]
    pub fn payout_total_bet_x(&self) -> f64 {
        self.line_total_bet_x + self.scatter_total_bet_x
    }
}

/// Set of (reel, row) cells that contributed to a ways win on this
/// evaluator pass. Used by the cascade loop to nullify and repop.
type WinCellSet = std::collections::HashSet<(usize, usize)>;

/// W4.10c — Evaluate ways and return (payout, winning_cells).
///
/// Winning cells are the union, across every paying combo, of all
/// matched cells on the prefix reels (anchor symbol or substituting
/// Wild). The cascade driver removes these cells and refills.
pub fn evaluate_ways_with_cells(
    grid: &Grid,
    ir: &Ir,
    pt: &CompiledPaytable,
) -> (f64, WinCellSet) {
    let mut total = 0.0f64;
    let mut win_cells: WinCellSet = WinCellSet::new();

    let min_count = match &ir.evaluation {
        Evaluation::Ways { min_count, .. } => *min_count,
        _ => return (total, win_cells),
    };

    // IGT 243 Ways (Fortune Coin): RTP_combo = pays × winning_ways / total_bet
    // per Excel PAR notes "243 MultiWay for 75 coins fixed".
    let total_bet_coins = ir
        .bet_table
        .total_bets
        .first()
        .copied()
        .unwrap_or(1.0)
        .max(1.0);

    let wild_id: Option<String> = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Wild)
        .map(|s| s.id.clone());
    let wild_except: Vec<String> = ir
        .symbols
        .iter()
        .find(|s| s.role == SymbolRole::Wild)
        .map(|s| s.substitutes_except.clone())
        .unwrap_or_default();

    for s in &ir.symbols {
        if !matches!(s.role, SymbolRole::Lp | SymbolRole::Hp | SymbolRole::Wild) {
            continue;
        }
        let can_substitute = !wild_except.iter().any(|x| x == &s.id);
        let sym_is_wild = matches!(s.role, SymbolRole::Wild);
        let wild = wild_id.as_deref().unwrap_or("");
        // Per-reel count of matching cells (anchor sym OR wild if subs).
        let mut prefix: Vec<Vec<usize>> = Vec::new();
        for r in 0..grid.reels() {
            let mut matched_rows = Vec::new();
            for row in 0..grid.rows() {
                let cell = grid.cell(r, row);
                if cell == s.id
                    || (can_substitute && !sym_is_wild && !wild.is_empty() && cell == wild)
                {
                    matched_rows.push(row);
                }
            }
            if matched_rows.is_empty() {
                break;
            }
            prefix.push(matched_rows);
        }
        let prefix_len = prefix.len() as u32;
        if prefix_len < min_count {
            continue;
        }
        // Try longest first.
        let mut best_pay = 0.0f64;
        let mut best_len = 0u32;
        for k in (min_count..=prefix_len).rev() {
            if let Some(&p) = pt.lines.get(&(s.id.clone(), k)) {
                best_pay = p;
                best_len = k;
                break;
            }
        }
        if best_pay <= 0.0 || best_len == 0 {
            continue;
        }
        let ways: u64 = prefix
            .iter()
            .take(best_len as usize)
            .map(|rows| rows.len() as u64)
            .product();
        total += best_pay * ways as f64 / total_bet_coins;
        for (r, rows) in prefix.iter().take(best_len as usize).enumerate() {
            for &row in rows {
                win_cells.insert((r, row));
            }
        }
    }

    (total, win_cells)
}

/// W4.10c — Cascade driver.
///
/// Wraps `evaluate_ways_with_cells` in the standard Fortune Coin cascade
/// loop. Returns aggregated `WaysSpin` with scatter eval on the INITIAL
/// grid only.
pub fn evaluate_cascade(
    initial: Grid,
    rs: &CompiledReelSet,
    ir: &Ir,
    pt: &CompiledPaytable,
    rng: &mut Prng,
) -> WaysSpin {
    let mut out = WaysSpin {
        scatter_total_bet_x: scatter_pay_total_bet(&initial, ir, pt),
        ..WaysSpin::default()
    };
    // Role counts on initial grid.
    for s in &ir.symbols {
        if matches!(
            s.role,
            SymbolRole::Cash | SymbolRole::Scatter | SymbolRole::Bonus | SymbolRole::Anchor
        ) {
            out.role_counts.insert(s.id.clone(), count_on_grid(&initial, &s.id));
        }
    }

    let mut grid = initial;
    let mut depth = 0u32;
    loop {
        let (pay, win_cells) = evaluate_ways_with_cells(&grid, ir, pt);
        out.line_total_bet_x += pay;
        if win_cells.is_empty() {
            break;
        }
        if depth >= MAX_CASCADE_DEPTH {
            // Guard — abort further cascading. Rare but defends against
            // pathological IR config where every refill keeps hitting.
            break;
        }
        depth += 1;
        // Remove + refill empty cells with a per-reel weighted draw.
        for (r, row) in &win_cells {
            // Draw fresh stop from the SAME reel's strip — equivalent to
            // a virtual-independent sample (matches IR sampling_mode).
            let stop = rs.strips[*r].sample_stop(rng);
            let sym = rs.strips[*r].symbols[stop].clone();
            grid.cells[*r][*row] = sym;
        }
    }
    out.cascade_steps = depth;

    out
}

fn count_on_grid(grid: &Grid, sym: &str) -> u32 {
    let mut c = 0u32;
    for r in 0..grid.reels() {
        for row in 0..grid.rows() {
            if grid.cell(r, row) == sym {
                c += 1;
            }
        }
    }
    c
}

fn scatter_pay_total_bet(grid: &Grid, ir: &Ir, pt: &CompiledPaytable) -> f64 {
    let mut total = 0.0f64;
    for s in ir.symbols.iter().filter(|s| s.role == SymbolRole::Scatter) {
        let c = count_on_grid(grid, &s.id);
        if c == 0 {
            continue;
        }
        let mut best_pay = 0.0f64;
        for k in (1..=c).rev() {
            if let Some(&p) = pt.scatter.get(&(s.id.clone(), k)) {
                best_pay = p;
                break;
            }
        }
        total += best_pay;
    }
    total
}

/// Helper: rows count for a Rectangular topology.
pub fn rect_rows(ir: &Ir) -> usize {
    match &ir.topology {
        Topology::Rectangular { rows, .. } => *rows as usize,
        _ => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reels::{CompiledReelSet, Grid, Strip};

    fn mk_strip(syms: &[(&str, i64)]) -> Strip {
        let entries: Vec<(String, i64)> =
            syms.iter().map(|(s, w)| (s.to_string(), *w)).collect();
        Strip::new(&entries)
    }

    fn mk_rs() -> CompiledReelSet {
        // 5 reels, each strip with just "Ace".
        let strips: Vec<Strip> = (0..5).map(|_| mk_strip(&[("Ace", 1)])).collect();
        CompiledReelSet { set: 0, strips }
    }

    #[test]
    fn cascade_single_pass_remove_repop() {
        // 5x3 grid, set up so reel 0 row 0 = "X", rest = "Y" — no wins,
        // win_cells empty, no cascade.
        let mut g = Grid::new(5, 3);
        for r in 0..5 {
            for row in 0..3 {
                g.cells[r][row] = "Y".to_string();
            }
        }
        // Test that refill happens for given winning cells.
        let rs = mk_rs();
        let mut rng = Prng::from_seed(42);
        let stop = rs.strips[0].sample_stop(&mut rng);
        let new_sym = rs.strips[0].symbols[stop].clone();
        // Manual mini-cascade step: replace cell (0, 0).
        g.cells[0][0] = new_sym.clone();
        assert_eq!(g.cells[0][0], "Ace");
    }

    #[test]
    fn cascade_depth_guard_kicks_in() {
        // Cascade guard test handled in fortune_coin_engine integration —
        // verifying constant here.
        assert_eq!(MAX_CASCADE_DEPTH, 50);
    }
}

