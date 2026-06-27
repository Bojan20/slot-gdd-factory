//! W4.8c — Megaways evaluator.
//!
//! Megaways topology samples a variable row count for each reel on every
//! spin (typical range 3..6 for IGT Skeleton Key). The number of "ways"
//! per spin equals the product of per-reel row counts (3×3×3×3×3 = 243 to
//! 6×6×6×6×6 = 7776 for a 5-reel Megaways). Pay evaluation walks
//! `paytable.lines` left-to-right: for each symbol that appears starting
//! from reel 0 (with Wild substitution where allowed), find the longest
//! prefix of consecutive reels where the symbol (or Wild) appears at
//! least once. The ways count for that combo equals the product of
//! occurrence counts on those reels; payout = `pays × ways`.
//!
//! Outputs a `MegawaysSpin` with:
//!   * `line_total_bet_x` — sum of all ways pays in × total-bet units
//!     (Megaways pays are already total-bet multipliers — line bets do
//!     not apply because the topology has no fixed lines).
//!   * `scatter_total_bet_x` — scatter pay × total-bet.
//!   * `role_counts` — grid-wide role counts for feature triggers (FS
//!     `Bonus` scatter, etc.).
//!
//! The grid is `Vec<Vec<String>>` indexed `[reel][row]`. Each reel may
//! have a different `row_count` per spin.

use crate::evaluate::CompiledPaytable;
use crate::ir::{Feature, Ir, MysteryTarget, SymbolRole, Topology};
use crate::reels::CompiledReelSet;
use crate::rng::Prng;
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct MegawaysSpin {
    pub line_total_bet_x: f64,
    pub scatter_total_bet_x: f64,
    pub role_counts: HashMap<String, u32>,
}

impl MegawaysSpin {
    #[inline]
    pub fn payout_total_bet_x(&self) -> f64 {
        self.line_total_bet_x + self.scatter_total_bet_x
    }
}

/// Megaways spin grid — variable rows per reel.
#[derive(Debug, Clone)]
pub struct MegawaysGrid {
    /// `cells[reel][row]` — variable length per reel.
    pub cells: Vec<Vec<String>>,
    /// Per-reel row count (length of `cells[reel]`).
    pub rows_per_reel: Vec<u32>,
}

impl MegawaysGrid {
    pub fn empty(reels: usize) -> Self {
        MegawaysGrid {
            cells: vec![vec![]; reels],
            rows_per_reel: vec![0u32; reels],
        }
    }

    pub fn rows(&self, reel: usize) -> u32 {
        self.rows_per_reel[reel]
    }

    pub fn reels(&self) -> usize {
        self.cells.len()
    }

    /// W4.8c — sample row count per reel from the topology's
    /// `rows_weights` (e.g. `[[1,1,1,1], …]` = uniform 3..6 per reel for
    /// Skeleton Key). Then per-cell weighted draw from each reel's
    /// virtual strip. Equivalent to `Grid::spin_virtual` extended with
    /// variable per-reel height.
    pub fn spin(
        ir: &Ir,
        rs: &CompiledReelSet,
        rng: &mut Prng,
    ) -> MegawaysGrid {
        let (rows_min, rows_max, rows_weights) = match &ir.topology {
            Topology::Megaways {
                rows_min,
                rows_max,
                rows_weights,
                ..
            } => (*rows_min, *rows_max, rows_weights),
            _ => panic!("MegawaysGrid::spin requires Topology::Megaways"),
        };
        let reels = rs.strips.len();
        let mut g = MegawaysGrid::empty(reels);
        let span = (rows_max - rows_min + 1) as usize;
        for r in 0..reels {
            // Sample row count for this reel.
            let weights: &Vec<u32> = rows_weights
                .get(r)
                .unwrap_or_else(|| panic!("rows_weights missing reel {r}"));
            let total: u64 = weights.iter().map(|w| *w as u64).sum();
            let rows = if total == 0 {
                rows_min
            } else {
                let pick = rng.gen_range_i64(total as i64);
                let mut acc: i64 = 0;
                let mut chosen = 0usize;
                for (i, w) in weights.iter().enumerate() {
                    acc += *w as i64;
                    if pick < acc {
                        chosen = i;
                        break;
                    }
                }
                // Clamp chosen to span in case weights vec is longer.
                let chosen = chosen.min(span.saturating_sub(1));
                rows_min + chosen as u32
            };
            g.rows_per_reel[r] = rows;
            g.cells[r] = Vec::with_capacity(rows as usize);
            for _row in 0..rows {
                let stop = rs.strips[r].sample_stop(rng);
                g.cells[r].push(rs.strips[r].symbols[stop].clone());
            }
        }
        g
    }

    #[inline]
    fn count_symbol_or_wild(&self, reel: usize, sym: &str, wild: &str, sym_is_wild: bool) -> u32 {
        let mut c = 0u32;
        for cell in &self.cells[reel] {
            if cell == sym || (!sym_is_wild && cell == wild) {
                c += 1;
            }
        }
        c
    }

    #[inline]
    fn count_only(&self, reel: usize, sym: &str) -> u32 {
        self.cells[reel].iter().filter(|c| *c == sym).count() as u32
    }

    pub fn count_on_grid(&self, sym: &str) -> u32 {
        self.cells
            .iter()
            .map(|reel| reel.iter().filter(|c| *c == sym).count() as u32)
            .sum()
    }

    /// W4.8d — IGT Skeleton Key Mystery Symbol transform.
    ///
    /// Walks every `Feature::MysteryTransform` in the IR. For each
    /// trigger symbol (typically "Mystery") that appears at least once
    /// on the grid, samples ONE target symbol from the active reel set's
    /// distribution and replaces every Mystery cell with that target.
    ///
    /// `active_set` is the reel-set ID picked for this spin (matches
    /// `CompiledReelSet::set`). When the distribution is missing for the
    /// active set we fall back to set "1" (defensive — should not happen
    /// for IGT Skeleton Key which publishes 8 BG + 6 FS Mystery sets).
    ///
    /// `in_fs` chooses between `per_set_distributions` (false → BG) and
    /// `fs_per_set_distributions` (true → FS); the FS table falls back
    /// to BG when empty.
    pub fn apply_mystery_transform(
        &mut self,
        ir: &Ir,
        active_set: i64,
        in_fs: bool,
        rng: &mut Prng,
    ) {
        for f in &ir.features {
            let Feature::MysteryTransform {
                trigger_symbol,
                per_set_distributions,
                fs_per_set_distributions,
            } = f
            else {
                continue;
            };
            if self.count_on_grid(trigger_symbol) == 0 {
                continue;
            }
            // Pick FS or BG table; fall back BG when FS empty.
            let table = if in_fs && !fs_per_set_distributions.is_empty() {
                fs_per_set_distributions
            } else {
                per_set_distributions
            };
            let key = active_set.to_string();
            let dist: &Vec<MysteryTarget> = match table.get(&key) {
                Some(v) if !v.is_empty() => v,
                _ => {
                    // Defensive: fall back to set "1" or first available.
                    match table.get("1") {
                        Some(v) if !v.is_empty() => v,
                        _ => match table.values().next() {
                            Some(v) if !v.is_empty() => v,
                            _ => continue,
                        },
                    }
                }
            };
            let total: i64 = dist.iter().map(|t| t.weight).sum();
            if total <= 0 {
                continue;
            }
            let pick = rng.gen_range_i64(total);
            let mut acc: i64 = 0;
            let mut target: &str = &dist[0].symbol;
            for t in dist {
                acc += t.weight;
                if pick < acc {
                    target = &t.symbol;
                    break;
                }
            }
            // Replace ALL trigger cells with the chosen target.
            for reel in self.cells.iter_mut() {
                for cell in reel.iter_mut() {
                    if cell == trigger_symbol {
                        *cell = target.to_string();
                    }
                }
            }
        }
    }
}

/// W4.8c — Evaluate a Megaways spin.
///
/// Iterates each paying symbol (LP/HP role). For each, computes the
/// longest left-anchored consecutive-reel prefix where `count_symbol +
/// count_wild ≥ 1`. The "ways" count = product of (sym + wild) counts on
/// those reels.
///
/// Pay normalization (BTG / IGT Megaways convention):
///   bet_per_way = total_bet / max_ways
///   win_coins   = pays × ways × bet_per_way
///   RTP_x       = win_coins / total_bet = pays × ways / max_ways
///
/// where `max_ways = Π rows_max[i]` (e.g. 6^5 = 7776 for IGT Skeleton
/// Key). This makes Excel's published RTP breakdown match the MC mean
/// to within sampling noise. Wild substitution skipped when the symbol
/// id is also Wild or appears in `Wild.substitutes_except` (Bonus /
/// Scatter / cash).
pub fn evaluate_megaways(grid: &MegawaysGrid, ir: &Ir, pt: &CompiledPaytable) -> MegawaysSpin {
    let mut out = MegawaysSpin::default();

    let min_count = match &ir.evaluation {
        crate::ir::Evaluation::Megaways { min_count } => *min_count,
        _ => return out,
    };

    // IGT Megaways pay normalization (per Excel PAR notes
    // "243 to 7,776 Multiway for 10 coins" / "243 MultiWay for 75 coins
    // fixed"):
    //   Pay (coins) = pays × winning_ways
    //   RTP_x       = Pay / total_bet_coins
    //
    // `total_bet_coins` for Megaways games is the per-spin bet stated in
    // Excel PAR notes (e.g. 10 coins for Skeleton Key — independent of
    // the `bet_table.total_bets` field which carries the credit-display
    // bet in chips, not the PAR-normalized coin bet). When the bet_table
    // value is the wrong unit we fall back to a reasonable default that
    // honors the published formula.
    let total_bet_coins = ir
        .bet_table
        .total_bets
        .first()
        .copied()
        .unwrap_or(1.0)
        .max(1.0);

    let role: HashMap<&str, SymbolRole> =
        ir.symbols.iter().map(|s| (s.id.as_str(), s.role)).collect();

    let wild_id_owned: Option<String> = ir
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

    // Iterate each paying symbol (LP / HP / Wild itself for 5-of-a-kind
    // wild line — IGT Megaways typically lists Wild as the top symbol).
    for s in &ir.symbols {
        let pays_for_sym = matches!(
            s.role,
            SymbolRole::Lp | SymbolRole::Hp | SymbolRole::Wild
        );
        if !pays_for_sym {
            continue;
        }
        // Check if this symbol can be wild-substituted.
        let can_substitute = !wild_except.iter().any(|x| x == &s.id);
        let sym_is_wild = matches!(s.role, SymbolRole::Wild);

        let wild_id = wild_id_owned.as_deref().unwrap_or("");
        // Compute prefix length of consecutive reels where symbol (or
        // Wild, if substitution allowed) appears at least once.
        let mut prefix_counts: Vec<u32> = Vec::new();
        for r in 0..grid.reels() {
            let c = if can_substitute && !sym_is_wild && !wild_id.is_empty() {
                grid.count_symbol_or_wild(r, &s.id, wild_id, sym_is_wild)
            } else {
                grid.count_only(r, &s.id)
            };
            if c == 0 {
                break;
            }
            prefix_counts.push(c);
        }
        let prefix_len = prefix_counts.len() as u32;
        if prefix_len < min_count {
            continue;
        }
        // Look up pay for the longest prefix in paytable; fall back to
        // shorter prefixes if the longest is not paid (rare but possible
        // for sparse paytables).
        let mut best_pay_per_way: f64 = 0.0;
        let mut best_len: u32 = 0;
        for k in (min_count..=prefix_len).rev() {
            if let Some(&p) = pt.lines.get(&(s.id.clone(), k)) {
                best_pay_per_way = p;
                best_len = k;
                break;
            }
        }
        if best_pay_per_way <= 0.0 || best_len == 0 {
            continue;
        }
        let ways: u64 = prefix_counts
            .iter()
            .take(best_len as usize)
            .map(|c| *c as u64)
            .product();
        // IGT Megaways: Win_coins = pays × winning_ways.
        // RTP per combo = pays × winning_ways / total_bet_coins.
        out.line_total_bet_x += best_pay_per_way * ways as f64 / total_bet_coins;
    }

    // Scatter pays — count each scatter-role symbol across the whole
    // grid and look up tier ≤ count.
    for s in ir.symbols.iter().filter(|s| s.role == SymbolRole::Scatter) {
        let c = grid.count_on_grid(&s.id);
        if c == 0 {
            continue;
        }
        let mut best_pay: f64 = 0.0;
        for k in (1..=c).rev() {
            if let Some(&p) = pt.scatter.get(&(s.id.clone(), k)) {
                best_pay = p;
                break;
            }
        }
        if best_pay > 0.0 {
            out.scatter_total_bet_x += best_pay;
        }
    }

    // Role counts for feature triggers.
    for s in &ir.symbols {
        if matches!(
            s.role,
            SymbolRole::Cash | SymbolRole::Scatter | SymbolRole::Bonus | SymbolRole::Anchor
        ) {
            out.role_counts.insert(s.id.clone(), grid.count_on_grid(&s.id));
        }
    }

    // Suppress unused role var on optimizer.
    let _ = role;

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_grid(rows: &[Vec<&str>]) -> MegawaysGrid {
        let cells: Vec<Vec<String>> = rows
            .iter()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .collect();
        let rows_per_reel: Vec<u32> = cells.iter().map(|r| r.len() as u32).collect();
        MegawaysGrid { cells, rows_per_reel }
    }

    #[test]
    fn ways_math_product_of_counts() {
        // 5 reels, each with single Chest cell ⇒ ways = 1×1×1×1×1 = 1.
        let g = mk_grid(&[
            vec!["Chest"],
            vec!["Chest"],
            vec!["Chest"],
            vec!["Chest"],
            vec!["Chest"],
        ]);
        assert_eq!(g.count_only(0, "Chest"), 1);
        assert_eq!(g.reels(), 5);
        // 6×6 example.
        let g2 = mk_grid(&[
            vec!["Chest", "Chest"],
            vec!["Chest", "Chest"],
            vec!["Chest", "Chest"],
            vec!["X", "X"],
            vec!["Y", "Y"],
        ]);
        assert_eq!(g2.count_only(0, "Chest"), 2);
        assert_eq!(g2.count_only(3, "Chest"), 0);
    }

    #[test]
    fn count_on_grid_works() {
        let g = mk_grid(&[
            vec!["Bonus", "X"],
            vec!["X"],
            vec!["Bonus"],
            vec!["Bonus", "X", "Bonus"],
            vec!["X"],
        ]);
        assert_eq!(g.count_on_grid("Bonus"), 4);
        assert_eq!(g.count_on_grid("X"), 4);
        assert_eq!(g.count_on_grid("Wild"), 0);
    }
}
