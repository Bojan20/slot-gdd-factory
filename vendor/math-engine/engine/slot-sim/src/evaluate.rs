// Universal paytable evaluator — dispatches on `Evaluation` variant.
//
// Lines: classic L→R paylines with Wild substitution + scope=line/scatter/pattern.
// Ways/Megaways/Cluster scaffolded — to be filled when first PAR arrives.

use crate::ir::{Evaluation, Ir, SymbolRole};
use crate::reels::Grid;
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct SpinWin {
    /// Line wins in coins (per single-line bet).
    pub line_coins: f64,
    /// Scatter pays in × total bet (e.g. Volcano scatter, Big Volcano FS).
    pub scatter_total_bet_x: f64,
    /// Pattern win — replaces line wins when triggered.
    pub pattern_total_bet_x: f64,
    pub is_pattern_win: bool,
    /// Counts of each "role" symbol on the grid (used for feature triggers).
    pub role_counts: HashMap<String, u32>,
    /// True iff sum payout > 0.
    pub is_hit: bool,
    /// True iff payout > 1× total bet (net win).
    pub is_win: bool,
}

impl SpinWin {
    pub fn payout_total_bet_x(&self, lines: u32) -> f64 {
        if self.is_pattern_win {
            self.pattern_total_bet_x + self.scatter_total_bet_x
        } else {
            self.line_coins / (lines as f64) + self.scatter_total_bet_x
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompiledPaytable {
    /// `lines[(symbol, count)]` = pays/line.
    pub lines: HashMap<(String, u32), f64>,
    /// Scatter pays by symbol count.
    pub scatter: HashMap<(String, u32), f64>,
    /// Pattern-win pays in × total bet.
    pub pattern_pays: f64,
    /// Symbol id of the pattern anchor.
    pub pattern_anchor: Option<String>,
}

impl CompiledPaytable {
    pub fn compile(ir: &Ir) -> Self {
        let mut lines = HashMap::new();
        let mut scatter = HashMap::new();
        let mut pattern_pays = 0.0;
        let mut pattern_anchor = None;
        for e in &ir.paytable {
            if e.combo.is_empty() {
                continue;
            }
            match e.scope.as_str() {
                "line" => {
                    let first = &e.combo[0];
                    let count = e.combo.iter().filter(|c| c.as_str() == first.as_str()).count() as u32;
                    lines.insert((first.clone(), count), e.pays);
                }
                "scatter" => {
                    // Convention: combo[0] = "Any N <Symbol>" or just symbol name + count column.
                    // Universal parser stores `(symbol, count)` explicitly via combo[0] = "<sym>:<count>" OR
                    // legacy "Any N <sym>" string. We support both.
                    //
                    // W4.8c / W4.10c — also accept literal-form combos where the
                    // paytable entry repeats the symbol N times (e.g. IGT
                    // Skeleton Key and Fortune Coin emit `['Bonus','Bonus','Bonus']`
                    // for a 3-Bonus scatter pay rather than the "Any 3 Bonus"
                    // string). When all combo cells share the same value, treat
                    // count = combo.len() and symbol = combo[0].
                    let first = &e.combo[0];
                    if let Some((n, sym)) = parse_any_n(first) {
                        scatter.insert((sym, n), e.pays);
                    } else if let Some((sym, n)) = parse_sym_count(first) {
                        scatter.insert((sym, n), e.pays);
                    } else if e.combo.iter().all(|c| c == first) {
                        let n = e.combo.len() as u32;
                        scatter.insert((first.clone(), n), e.pays);
                    }
                }
                "pattern" => {
                    pattern_pays = e.pays;
                    if !e.combo.is_empty() {
                        pattern_anchor = Some(e.combo[0].clone());
                    }
                }
                _ => {}
            }
        }
        CompiledPaytable { lines, scatter, pattern_pays, pattern_anchor }
    }
}

fn parse_any_n(s: &str) -> Option<(u32, String)> {
    // "Any 5 Volcano" / "Any 3 Bonus"
    let mut parts = s.split_whitespace();
    if parts.next()? != "Any" {
        return None;
    }
    let n: u32 = parts.next()?.parse().ok()?;
    let sym: String = parts.collect::<Vec<_>>().join(" ");
    Some((n, sym))
}

fn parse_sym_count(s: &str) -> Option<(String, u32)> {
    // "Volcano:3"
    let (sym, count_s) = s.split_once(':')?;
    let n: u32 = count_s.parse().ok()?;
    Some((sym.to_string(), n))
}

#[inline]
fn count_on_grid(grid: &Grid, sym: &str) -> u32 {
    let mut c = 0u32;
    for r in 0..grid.reels() {
        for row in 0..grid.rows() {
            if grid.cells[r][row] == sym {
                c += 1;
            }
        }
    }
    c
}

/// W4.9b — Canonical symbol name for line eval matching.
/// L&W CE FS spins use "Big X" stacked symbols on the linked block; the
/// FS paytable keys on "X". Stripping the "Big " prefix lets a single
/// paytable row pay both Red7×5 (base) and (Big Red7 + Red7 + Red7 +
/// Red7 + Red7)-style FS wins where the linked block fills three middle
/// reels with Big Red7.
#[inline]
fn canon_cell(cell: &str) -> &str {
    cell.strip_prefix("Big ").unwrap_or(cell)
}

/// Universal line evaluator. Wild substitution per symbol-role definitions.
pub fn evaluate_lines(grid: &Grid, ir: &Ir, pt: &CompiledPaytable) -> SpinWin {
    let mut w = SpinWin::default();
    let lines_n = match &ir.evaluation {
        Evaluation::Lines { lines, min_count: _ } => lines.len() as u32,
        _ => return w,
    };
    let _ = lines_n;
    let lines_ref = match &ir.evaluation {
        Evaluation::Lines { lines, .. } => lines,
        _ => return w,
    };
    // Pre-compute role lookup
    let role: HashMap<&str, SymbolRole> = ir
        .symbols
        .iter()
        .map(|s| (s.id.as_str(), s.role))
        .collect();
    // Score each payline using *max* of (raw, wild-expanded) for Wild Expand
    // is handled by feature pass later; here only Wild substitution.
    let mut total_coins = 0.0f64;
    for pl in lines_ref {
        let mut cells: Vec<&str> = Vec::with_capacity(pl.len());
        for (r, cell) in pl.iter().enumerate() {
            let row = cell.expect("payline row");
            cells.push(grid.cell(r, row as usize));
        }
        // W4.9b — canonicalize Big_X → X for matching purposes so the
        // FS linked block (which lands "Big Red7" etc.) lines up with
        // base paytable rows keyed on "Red7".
        let canon: Vec<&str> = cells.iter().map(|c| canon_cell(c)).collect();
        // First non-Wild, non-special symbol = anchor
        let mut anchor: Option<&str> = None;
        for (i, _c) in cells.iter().enumerate() {
            let r = role
                .get(canon[i])
                .or_else(|| role.get(cells[i]))
                .copied()
                .unwrap_or_default();
            if r != SymbolRole::Wild && r != SymbolRole::Scatter && r != SymbolRole::Bonus && r != SymbolRole::Cash {
                anchor = Some(canon[i]);
                break;
            }
        }
        if anchor.is_none() {
            // All-Wild leading run
            let mut count = 0u32;
            for c in &cells {
                if role.get(c).copied().unwrap_or_default() == SymbolRole::Wild {
                    count += 1;
                } else {
                    break;
                }
            }
            if let Some(sym) = ir.symbols.iter().find(|s| s.role == SymbolRole::Wild).map(|s| s.id.as_str()) {
                if let Some(p) = pt.lines.get(&(sym.to_string(), count)) {
                    total_coins += p;
                }
            }
            continue;
        }
        let sym = anchor.unwrap();
        let sym_role = role
            .get(sym)
            .copied()
            .unwrap_or_default();
        let wild_subs = sym_role != SymbolRole::Cash && sym_role != SymbolRole::Bonus;
        // Anchor-led count (allows wild substitutions in the run; W4.9b
        // also accepts canonicalized cells so "Big Red7" matches anchor
        // "Red7").
        let mut anchor_count = 0u32;
        for (i, c) in cells.iter().enumerate() {
            let r = role
                .get(canon[i])
                .or_else(|| role.get(*c))
                .copied()
                .unwrap_or_default();
            if canon[i] == sym || *c == sym || (wild_subs && r == SymbolRole::Wild) {
                anchor_count += 1;
            } else {
                break;
            }
        }
        let anchor_pay = if anchor_count >= 3 {
            pt.lines.get(&(sym.to_string(), anchor_count)).copied().unwrap_or(0.0)
        } else {
            0.0
        };
        // Industry standard: a line with a wild prefix pays the BEST of
        // (anchor symbol N-of-a-kind) vs (pure wild prefix N-of-a-kind).
        // Without this, [W,W,W,Y,Z] would only score the lower Y×4 pay
        // and miss the higher W×3 pay, undercounting base RTP by ~1–2 %.
        let mut wild_only_count = 0u32;
        for c in &cells {
            if role.get(c).copied().unwrap_or_default() == SymbolRole::Wild {
                wild_only_count += 1;
            } else {
                break;
            }
        }
        let wild_pay = if wild_only_count >= 3 {
            ir.symbols
                .iter()
                .find(|s| s.role == SymbolRole::Wild)
                .and_then(|w| pt.lines.get(&(w.id.clone(), wild_only_count)))
                .copied()
                .unwrap_or(0.0)
        } else {
            0.0
        };
        let line_pay = anchor_pay.max(wild_pay);
        if line_pay > 0.0 {
            total_coins += line_pay;
        }
    }
    w.line_coins = total_coins;
    // Scatter pays: count each scatter-role symbol on grid; look up
    // best matching entry from the paytable. A scatter entry with
    // `(sym, k)` pays when `c >= k`; we take the HIGHEST `k <= c` that
    // has an entry (matches industry standard "tiered scatter pays" —
    // e.g. 3 scatters pays 2×, 4 pays 5×, 5 pays 25×; landing 5 always
    // takes the 5-tier pay). Drops the previous hard floor of c >= 3 so
    // L&W FS "Big Volcano:1" entries pay when even one block lands.
    for s in ir.symbols.iter().filter(|s| s.role == SymbolRole::Scatter) {
        let c = count_on_grid(grid, &s.id);
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
            w.scatter_total_bet_x += best_pay;
        }
    }
    // Role counts for feature pass
    for s in &ir.symbols {
        if matches!(s.role, SymbolRole::Cash | SymbolRole::Scatter | SymbolRole::Bonus | SymbolRole::Anchor) {
            w.role_counts.insert(s.id.clone(), count_on_grid(grid, &s.id));
        }
    }
    // Hit/win flags (feature pass may add more)
    let payout = w.payout_total_bet_x(lines_ref.len() as u32);
    w.is_hit = payout > 0.0;
    w.is_win = payout > 1.0;
    w
}
