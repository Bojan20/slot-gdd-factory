//! Grid Generation Module
//!
//! Dynamic grid that reads dimensions from `GameConfig` at runtime.
//! No hardcoded `5` or `3` anywhere — all sizing flows from config.
//!
//! `DynGrid` stores symbols as `cells[reel][row]`.  The `Grid` type alias
//! keeps backward compat with the rest of the codebase that uses `Grid`.

use crate::config::GameConfig;
use crate::rng::SlotRng;

// ─── DynGrid ───────────────────────────────────────────────────────────────

/// Dynamic slot grid.  `cells[reel][row]` holds the symbol index (u8).
#[derive(Debug, Clone)]
pub struct DynGrid {
    /// `cells[reel][row]` — inner vec length = rows for that reel.
    pub cells: Vec<Vec<u8>>,
    /// Number of reels.
    pub reels: usize,
    /// Maximum row count (uniform for rectangular topology).
    pub rows: usize,
    /// PAR-14-E #6 — Per-cell Coin Boost multiplier values. Parallel
    /// to `cells`; 1 = no multiplier (default), value > 1 means
    /// "this cell multiplies line pays crossing it by `value`".
    /// Empty Vec when feature is not active.
    #[doc(hidden)]
    pub multipliers: Vec<Vec<u32>>,
}

impl DynGrid {
    /// Create a zeroed grid of the given dimensions.
    pub fn new(reels: usize, rows: usize) -> Self {
        DynGrid {
            cells: vec![vec![0u8; rows]; reels],
            reels,
            rows,
            multipliers: Vec::new(),
        }
    }

    /// PAR-14-E #6 — Read the Coin Boost multiplier at `[reel][row]`.
    /// Returns 1 (no multiplier) when feature is not active or cell
    /// has no boost value.
    #[inline]
    pub fn multiplier_at(&self, reel: usize, row: usize) -> u32 {
        self.multipliers
            .get(reel)
            .and_then(|r| r.get(row))
            .copied()
            .unwrap_or(1)
            .max(1)
    }

    /// PAR-14-E #6 — Set the Coin Boost multiplier at `[reel][row]`.
    /// Lazily initializes the parallel storage on first use.
    pub fn set_multiplier(&mut self, reel: usize, row: usize, val: u32) {
        if self.multipliers.is_empty() {
            self.multipliers = vec![vec![1u32; self.rows]; self.reels];
        }
        if let Some(r) = self.multipliers.get_mut(reel) {
            if let Some(cell) = r.get_mut(row) {
                *cell = val.max(1);
            }
        }
    }

    /// Get symbol index at `[reel][row]`.  Returns `0` if out of bounds.
    #[inline]
    pub fn get(&self, reel: usize, row: usize) -> u8 {
        self.cells
            .get(reel)
            .and_then(|r| r.get(row))
            .copied()
            .unwrap_or(0)
    }

    /// Set symbol index at `[reel][row]`.  No-op if out of bounds.
    #[inline]
    pub fn set(&mut self, reel: usize, row: usize, val: u8) {
        if let Some(r) = self.cells.get_mut(reel) {
            if let Some(cell) = r.get_mut(row) {
                *cell = val;
            }
        }
    }

    /// Row count for a specific reel.  For rectangular grids this is
    /// `self.rows`; Faza 2 can override this for variable-row grids.
    #[inline]
    pub fn rows_for_reel(&self, _reel: usize) -> usize {
        self.rows
    }

    /// PAR-14-E sister-side feature #6 — Populate Coin Boost
    /// multipliers on every cell that carries an `is_coin_boost`
    /// symbol. Multiplier value is drawn from
    /// `config.coin_boost_multipliers` (weighted). Cells without Coin
    /// Boost are left at default 1.
    pub fn apply_coin_boost(
        &self,
        rng: &mut crate::rng::SlotRng,
        config: &crate::config::GameConfig,
    ) -> DynGrid {
        if config.coin_boost_multipliers.is_empty() {
            return self.clone();
        }
        let coin_boost_idxs: Vec<u8> = config
            .symbols
            .iter()
            .enumerate()
            .filter(|(_, s)| s.is_coin_boost)
            .map(|(i, _)| i as u8)
            .collect();
        if coin_boost_idxs.is_empty() {
            return self.clone();
        }
        let total_w: u32 = config.coin_boost_multipliers.iter().map(|m| m.weight).sum();
        if total_w == 0 {
            return self.clone();
        }
        let mut out = self.clone();
        for reel in 0..out.reels {
            for row in 0..out.rows_for_reel(reel) {
                let sym = out.get(reel, row);
                if coin_boost_idxs.contains(&sym) {
                    let mut roll = rng.random() * total_w as f64;
                    let mut value = 1u32;
                    for m in &config.coin_boost_multipliers {
                        roll -= m.weight as f64;
                        if roll <= 0.0 {
                            value = m.value;
                            break;
                        }
                    }
                    out.set_multiplier(reel, row, value);
                }
            }
        }
        out
    }

    /// PAR-14-E sister-side feature #4 — Wild Expand spatial mechanic.
    ///
    /// When a Wild lands anywhere on a reel, every cell on that reel
    /// is filled with Wild. Matches Skeleton Key / NetEnt Mega Joker
    /// expanding-wild semantics. Sister evaluator then evaluates the
    /// post-expand grid using normal line / ways logic.
    ///
    /// Returns a new grid; original is preserved for scatter / bonus
    /// counts and reveal-style features that operate on raw symbols.
    pub fn apply_wild_expand(&self, wild_idx: u8) -> DynGrid {
        let mut out = self.clone();
        for reel in 0..out.reels {
            let mut has_wild = false;
            let rows = out.rows_for_reel(reel);
            for row in 0..rows {
                if out.get(reel, row) == wild_idx {
                    has_wild = true;
                    break;
                }
            }
            if has_wild {
                for row in 0..rows {
                    out.set(reel, row, wild_idx);
                }
            }
        }
        out
    }

    /// PAR-14-E sister-side feature #2 — Mystery Reveal.
    ///
    /// Returns a new grid with every Mystery cell replaced by a single
    /// shared random LP/MP paying symbol drawn uniformly from the
    /// supplied payable symbol indices. Matches Skeleton Key / Mystic
    /// Reels semantics: ALL Mystery cells on the spin reveal as the
    /// SAME symbol per spin (sharing the same RNG draw).
    ///
    /// If no Mystery cells are present or no payable symbols supplied,
    /// returns a clone of `self` unchanged.
    pub fn apply_mystery_reveal(
        &self,
        mystery_idx: u8,
        payable_idxs: &[u8],
        rng: &mut crate::rng::SlotRng,
    ) -> DynGrid {
        let mut out = self.clone();
        if payable_idxs.is_empty() {
            return out;
        }
        // Single shared draw — every Mystery cell reveals as the SAME symbol.
        let pick_idx = (rng.random() * payable_idxs.len() as f64) as usize;
        let revealed = payable_idxs[pick_idx.min(payable_idxs.len() - 1)];
        for reel in 0..out.reels {
            for row in 0..out.rows_for_reel(reel) {
                if out.get(reel, row) == mystery_idx {
                    out.set(reel, row, revealed);
                }
            }
        }
        out
    }
}

// ─── Type alias ────────────────────────────────────────────────────────────

/// Public type alias kept for backward compatibility.
pub type Grid = DynGrid;

// ─── GridGenerator ─────────────────────────────────────────────────────────

/// Grid generator — reads reel count and row count from config.
pub struct GridGenerator<'a> {
    config: &'a GameConfig,
    /// Precomputed base-game weights per reel: `(symbol_index, weight)`.
    base_weights: Vec<Vec<(u8, u32)>>,
    /// Precomputed free-spins weights per reel.
    fs_weights: Vec<Vec<(u8, u32)>>,
    /// Cumulative totals for base weights.
    base_totals: Vec<u32>,
    /// Cumulative totals for FS weights.
    fs_totals: Vec<u32>,
}

impl<'a> GridGenerator<'a> {
    /// Create a new grid generator.  Precomputes weight tables for O(1)
    /// weighted sampling at spin time.
    pub fn new(config: &'a GameConfig) -> Self {
        let num_reels = config.reels as usize;

        let mut base_weights = Vec::with_capacity(num_reels);
        let mut fs_weights = Vec::with_capacity(num_reels);
        let mut base_totals = Vec::with_capacity(num_reels);
        let mut fs_totals = Vec::with_capacity(num_reels);

        for reel in 0..num_reels {
            // ── Base game weights ──────────────────────────────────────
            let (bw, bt) = build_weight_table(config, reel, false);
            base_weights.push(bw);
            base_totals.push(bt);

            // ── Free spins weights ─────────────────────────────────────
            let (fw, ft) = build_weight_table(config, reel, true);
            fs_weights.push(fw);
            fs_totals.push(ft);
        }

        GridGenerator {
            config,
            base_weights,
            fs_weights,
            base_totals,
            fs_totals,
        }
    }

    /// Generate a base-game grid.
    #[inline]
    pub fn generate_base(&self, rng: &mut SlotRng) -> Grid {
        self.generate_grid(rng, false)
    }

    /// Generate a free-spins grid.
    #[inline]
    pub fn generate_fs(&self, rng: &mut SlotRng) -> Grid {
        self.generate_grid(rng, true)
    }

    /// PAR-14-E #5 — Generate an FS grid using an EXPLICIT reel-weight
    /// set (e.g. a Special Reel Set picked per FS round). Mirrors the
    /// internal generate_grid loop but takes the weight tables from
    /// the caller instead of fs_weights.
    ///
    /// `reels_input` is `Vec<Vec<ReelWeight>>` shape (per reel: ordered
    /// list of {symbol_id, weight}). Symbol IDs are resolved via the
    /// config's symbol_index lookup; reels with unknown symbols silently
    /// drop those weights. Reels with empty totals are left at sentinel.
    pub fn generate_fs_with_set(
        &self,
        rng: &mut SlotRng,
        reels_input: &[Vec<crate::config::ReelWeight>],
    ) -> Grid {
        let num_reels = self.config.reels as usize;
        let num_rows = self.config.rows as usize;
        let mut grid = DynGrid::new(num_reels, num_rows);

        for reel in 0..num_reels {
            let Some(reel_strip) = reels_input.get(reel) else { continue };

            // Resolve symbol indices + total.
            let mut resolved: Vec<(u8, u32)> = Vec::with_capacity(reel_strip.len());
            let mut total: u32 = 0;
            for entry in reel_strip {
                if let Some(idx) = self.config.symbol_index(&entry.symbol) {
                    resolved.push((idx as u8, entry.weight));
                    total = total.saturating_add(entry.weight);
                }
            }
            if total == 0 {
                continue;
            }

            let reel_rows = grid.rows_for_reel(reel);
            for row in 0..reel_rows {
                let mut roll = rng.random() * total as f64;
                let mut chosen = 0u8;
                for &(sym_idx, weight) in &resolved {
                    roll -= weight as f64;
                    if roll <= 0.0 {
                        chosen = sym_idx;
                        break;
                    }
                }
                grid.set(reel, row, chosen);
            }
        }
        grid
    }

    /// Generate a variable-rows grid: each reel may have a different row
    /// count for this spin. `row_counts.len()` must equal `config.reels`.
    /// The resulting `DynGrid` allocates the *maximum* row count across
    /// reels (uniform `cells[reel].len()`), but only the first
    /// `row_counts[reel]` cells of each reel are populated — the trailing
    /// slots are left at the sentinel `0`. Evaluators must honour the
    /// `row_counts` passed via `EvalMode::VariableWays`, not the grid's
    /// implicit `rows`.
    ///
    /// `row_counts_config` is the configurable per-reel min/max envelope
    /// that drives random row selection for callers that prefer to
    /// resolve row counts inside the generator. Pass `None` to use the
    /// rectangular config dimensions.
    pub fn generate_variable_rows(
        &self,
        rng: &mut SlotRng,
        row_counts_config: &[(usize, usize)],
    ) -> (Grid, Vec<usize>) {
        let num_reels = self.config.reels as usize;

        // Resolve actual per-reel row counts for this spin.
        let mut row_counts: Vec<usize> = Vec::with_capacity(num_reels);
        let max_rows = row_counts_config
            .iter()
            .map(|(_, hi)| *hi)
            .max()
            .unwrap_or(self.config.rows as usize);

        for reel in 0..num_reels {
            let (lo, hi) = row_counts_config
                .get(reel)
                .copied()
                .unwrap_or((self.config.rows as usize, self.config.rows as usize));
            let span = hi - lo + 1;
            let rc = lo + (rng.random() * span as f64) as usize;
            row_counts.push(rc.min(hi));
        }

        let mut grid = DynGrid::new(num_reels, max_rows);

        let weights = &self.base_weights;
        let totals = &self.base_totals;

        for reel in 0..num_reels {
            let reel_weights = &weights[reel];
            let total = totals[reel];
            if total == 0 {
                continue;
            }

            let reel_rows = row_counts[reel];
            for row in 0..reel_rows {
                let mut roll = rng.random() * total as f64;
                let mut chosen = 0u8;
                for &(sym_idx, weight) in reel_weights {
                    roll -= weight as f64;
                    if roll <= 0.0 {
                        chosen = sym_idx;
                        break;
                    }
                }
                grid.set(reel, row, chosen);
            }
        }

        (grid, row_counts)
    }

    /// Core grid generation — iterates over `config.reels` reels and
    /// `config.rows` rows (no hardcoded constants).
    fn generate_grid(&self, rng: &mut SlotRng, is_fs: bool) -> Grid {
        let num_reels = self.config.reels as usize;
        let num_rows = self.config.rows as usize;

        let mut grid = DynGrid::new(num_reels, num_rows);

        let weights = if is_fs {
            &self.fs_weights
        } else {
            &self.base_weights
        };
        let totals = if is_fs {
            &self.fs_totals
        } else {
            &self.base_totals
        };

        for reel in 0..num_reels {
            let reel_weights = &weights[reel];
            let total = totals[reel];

            if total == 0 {
                continue;
            }

            let reel_rows = grid.rows_for_reel(reel);
            for row in 0..reel_rows {
                let mut roll = rng.random() * total as f64;
                let mut chosen = 0u8;

                for &(sym_idx, weight) in reel_weights {
                    roll -= weight as f64;
                    if roll <= 0.0 {
                        chosen = sym_idx;
                        break;
                    }
                }
                grid.set(reel, row, chosen);
            }
        }

        grid
    }

    // ── Symbol helpers ──────────────────────────────────────────────────

    /// Symbol id string for a symbol index.
    #[inline]
    pub fn symbol_id(&self, idx: u8) -> &str {
        self.config
            .symbols
            .get(idx as usize)
            .map(|s| s.id.as_str())
            .unwrap_or("?")
    }

    /// Returns `true` if the symbol at `idx` is a wild.
    #[inline]
    pub fn is_wild(&self, idx: u8) -> bool {
        self.config
            .symbols
            .get(idx as usize)
            .map(|s| s.is_wild)
            .unwrap_or(false)
    }

    /// Returns `true` if the symbol at `idx` is a scatter.
    #[inline]
    pub fn is_scatter(&self, idx: u8) -> bool {
        self.config
            .symbols
            .get(idx as usize)
            .map(|s| s.is_scatter)
            .unwrap_or(false)
    }

    /// Returns `true` if the symbol at `idx` is a bonus.
    #[inline]
    pub fn is_bonus(&self, idx: u8) -> bool {
        self.config
            .symbols
            .get(idx as usize)
            .map(|s| s.is_bonus)
            .unwrap_or(false)
    }

    /// Count cells matching `predicate` across the whole grid.
    #[inline]
    pub fn count_symbol(&self, grid: &Grid, predicate: impl Fn(u8) -> bool) -> u8 {
        let num_reels = self.config.reels as usize;
        let mut count = 0u8;
        for reel in 0..num_reels {
            let reel_rows = grid.rows_for_reel(reel);
            for row in 0..reel_rows {
                if predicate(grid.get(reel, row)) {
                    count += 1;
                }
            }
        }
        count
    }

    /// Count scatter symbols in the grid.
    #[inline]
    pub fn count_scatters(&self, grid: &Grid) -> u8 {
        self.count_symbol(grid, |idx| self.is_scatter(idx))
    }

    /// Count bonus symbols in the grid.
    #[inline]
    pub fn count_bonus(&self, grid: &Grid) -> u8 {
        self.count_symbol(grid, |idx| self.is_bonus(idx))
    }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/// Build `(weights, total)` for a single reel from config.
fn build_weight_table(config: &GameConfig, reel: usize, is_fs: bool) -> (Vec<(u8, u32)>, u32) {
    let source = if is_fs {
        &config.fs_weights
    } else {
        &config.base_weights
    };

    let mut reel_weights: Vec<(u8, u32)> = Vec::new();
    let mut total = 0u32;

    if let Some(weights) = source.get(reel) {
        for entry in weights {
            if let Some(idx) = config.symbol_index(&entry.symbol) {
                reel_weights.push((idx as u8, entry.weight));
                total += entry.weight;
            }
        }
    }

    (reel_weights, total)
}
