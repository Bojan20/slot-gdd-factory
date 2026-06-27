//! Packed grid and its O(1) generator.
//!
//! ## PackedGrid
//!
//! A single `u128` stores an entire slot grid — 5 bits per cell, up to
//! 5 × 5 = 25 cells (125 bits < 128 bits).  This gives three advantages over
//! the `Vec<Vec<u8>>` approach in `DynGrid`:
//!
//! 1. **No heap allocation** — the entire grid is a single integer on the
//!    stack.
//! 2. **Cache-friendly** — fits in one 128-bit register or a single cache
//!    line word; no pointer chase.
//! 3. **Copyable** — `Copy + Clone + Default` make it trivial to snapshot
//!    or pass through SIMD pipelines.
//!
//! ## PackedGridGenerator
//!
//! Uses one [`AliasTable`] per reel per mode (base/FS), built once at
//! construction time.  Each cell is sampled in O(1) vs. the O(N) linear scan
//! in `GridGenerator`.
//!
//! Constraint: symbol indices must fit in 5 bits (0–30).  Symbol index 31
//! is reserved as the empty/sentinel value.  Games with ≤ 30 distinct
//! symbol IDs satisfy this automatically.

use super::alias::AliasTable;
use crate::config::GameConfig;
use crate::rng::SlotRng;

// ─── PackedGrid ───────────────────────────────────────────────────────────────

/// Bitpacked slot grid (5 bits / cell, up to 5 × 5 = 25 cells).
///
/// Cell `(reel, row)` lives at bits `[5·idx, 5·idx+5)` where
/// `idx = reel × num_rows + row` (reel-major order).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PackedGrid(pub u128);

impl PackedGrid {
    /// Maximum reels supported (5 × 5-bit-cell fit comfortably in u128).
    pub const MAX_REELS: usize = 5;
    /// Maximum rows per reel.
    pub const MAX_ROWS: usize = 5;
    /// Maximum total cells.
    pub const MAX_CELLS: usize = Self::MAX_REELS * Self::MAX_ROWS; // 25
    /// Bits consumed by one cell.
    pub const BITS: u32 = 5;
    /// Mask for extracting one cell (0x1F = 0b11111).
    pub const MASK: u128 = 0x1F;

    // ── Accessors ────────────────────────────────────────────────────────

    /// Get symbol index at `(reel, row)`.
    #[inline(always)]
    pub fn get(self, reel: usize, row: usize, num_rows: usize) -> u8 {
        debug_assert!(reel < Self::MAX_REELS);
        debug_assert!(row < Self::MAX_ROWS);
        let offset = Self::BITS * (reel * num_rows + row) as u32;
        ((self.0 >> offset) & Self::MASK) as u8
    }

    /// Set symbol index at `(reel, row)`.
    #[inline(always)]
    pub fn set(&mut self, reel: usize, row: usize, num_rows: usize, val: u8) {
        debug_assert!(reel < Self::MAX_REELS);
        debug_assert!(row < Self::MAX_ROWS);
        debug_assert!(val < 32, "symbol index must fit in 5 bits");
        let offset = Self::BITS * (reel * num_rows + row) as u32;
        self.0 &= !(Self::MASK << offset);
        self.0 |= (val as u128 & Self::MASK) << offset;
    }

    // ── Conversion helpers ────────────────────────────────────────────────

    /// Unpack all cells into a flat array in reel-major order.
    ///
    /// `cells[r * rows + row]` = symbol at `(r, row)`.
    /// Cells beyond `reels × rows` are zeroed.
    pub fn unpack(&self, reels: usize, rows: usize) -> [u8; Self::MAX_CELLS] {
        let mut out = [0u8; Self::MAX_CELLS];
        for r in 0..reels.min(Self::MAX_REELS) {
            for row in 0..rows.min(Self::MAX_ROWS) {
                out[r * rows + row] = self.get(r, row, rows);
            }
        }
        out
    }

    /// Build a `PackedGrid` from a flat cell array (inverse of `unpack`).
    pub fn pack(cells: &[u8], reels: usize, rows: usize) -> Self {
        let mut g = PackedGrid::default();
        for r in 0..reels.min(Self::MAX_REELS) {
            for row in 0..rows.min(Self::MAX_ROWS) {
                if let Some(&sym) = cells.get(r * rows + row) {
                    g.set(r, row, rows, sym);
                }
            }
        }
        g
    }

    /// Convert a `DynGrid` reference to `PackedGrid`.
    ///
    /// Useful for cross-validator tests that compare `ZeroAllocEvaluator`
    /// results with the legacy `Evaluator`.
    pub fn from_dyn(grid: &crate::grid::DynGrid) -> Self {
        let reels = grid.reels;
        let rows = grid.rows;
        let mut g = PackedGrid::default();
        for r in 0..reels.min(Self::MAX_REELS) {
            for row in 0..rows.min(Self::MAX_ROWS) {
                g.set(r, row, rows, grid.get(r, row));
            }
        }
        g
    }
}

// ─── PackedGridGenerator ─────────────────────────────────────────────────────

/// Packed grid generator — uses Walker's Alias Method for O(1) per cell.
///
/// Build once with [`PackedGridGenerator::from_config`]; then call
/// [`generate_base`] or [`generate_fs`] per spin — zero heap allocation.
pub struct PackedGridGenerator {
    base_tables: Vec<AliasTable>,
    fs_tables: Vec<AliasTable>,
    reels: usize,
    rows: usize,
}

impl PackedGridGenerator {
    /// Construct from a `GameConfig`.
    ///
    /// Builds one `AliasTable` per reel × mode (base + FS).
    /// If `fs_weights` for a reel is empty, falls back to `base_weights`.
    ///
    /// # Panics
    /// Any reel with no symbol entries (or all-zero weight) will panic.
    pub fn from_config(config: &GameConfig) -> Self {
        let reels = config.reels as usize;

        let base_tables: Vec<AliasTable> = (0..reels)
            .map(|r| build_alias_for_reel(config, r, false))
            .collect();

        let fs_tables: Vec<AliasTable> = (0..reels)
            .map(|r| build_alias_for_reel(config, r, true))
            .collect();

        PackedGridGenerator {
            base_tables,
            fs_tables,
            reels,
            rows: config.rows as usize,
        }
    }

    /// Generate a base-game packed grid (no heap allocation).
    #[inline(always)]
    pub fn generate_base(&self, rng: &mut SlotRng) -> PackedGrid {
        self.generate_inner(rng, &self.base_tables)
    }

    /// Generate a free-spins packed grid (no heap allocation).
    #[inline(always)]
    pub fn generate_fs(&self, rng: &mut SlotRng) -> PackedGrid {
        self.generate_inner(rng, &self.fs_tables)
    }

    /// Number of reels this generator was built for.
    #[inline]
    pub fn reels(&self) -> usize {
        self.reels
    }

    /// Number of rows this generator was built for.
    #[inline]
    pub fn rows(&self) -> usize {
        self.rows
    }

    // ── Internal ──────────────────────────────────────────────────────────

    #[inline(always)]
    fn generate_inner(&self, rng: &mut SlotRng, tables: &[AliasTable]) -> PackedGrid {
        let mut grid = PackedGrid::default();
        for r in 0..self.reels {
            for row in 0..self.rows {
                let sym = tables[r].sample(rng);
                grid.set(r, row, self.rows, sym);
            }
        }
        grid
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn build_alias_for_reel(config: &GameConfig, reel: usize, is_fs: bool) -> AliasTable {
    // Try the requested mode; fall back to base if FS weights not configured.
    let source = if is_fs {
        &config.fs_weights
    } else {
        &config.base_weights
    };
    let weights = source
        .get(reel)
        .filter(|w| !w.is_empty())
        .or_else(|| config.base_weights.get(reel))
        .unwrap_or_else(|| panic!("PackedGridGenerator: reel {reel} has no weight entries"));

    let entries: Vec<(u8, u32)> = weights
        .iter()
        .filter_map(|e| {
            config.symbol_index(&e.symbol).map(|idx| {
                assert!(
                    idx < 31,
                    "symbol index {idx} does not fit in 5 bits (max 30)"
                );
                (idx as u8, e.weight)
            })
        })
        .filter(|(_, w)| *w > 0)
        .collect();

    assert!(
        !entries.is_empty(),
        "PackedGridGenerator: reel {reel} has no valid symbols after filtering"
    );

    AliasTable::build(&entries)
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_packed(cells: &[(usize, usize, u8)], rows: usize) -> PackedGrid {
        let mut g = PackedGrid::default();
        for &(r, row, sym) in cells {
            g.set(r, row, rows, sym);
        }
        g
    }

    #[test]
    fn set_and_get_round_trip() {
        let mut g = PackedGrid::default();
        // Place 30 distinct symbols across a 5×3 grid.
        let rows = 3;
        for r in 0..5 {
            for row in 0..rows {
                let sym = (r * rows + row) as u8;
                g.set(r, row, rows, sym);
            }
        }
        for r in 0..5 {
            for row in 0..rows {
                let expected = (r * rows + row) as u8;
                assert_eq!(g.get(r, row, rows), expected, "mismatch at ({r},{row})");
            }
        }
    }

    #[test]
    fn overwrite_does_not_bleed_into_neighbours() {
        let rows = 3;
        let mut g = PackedGrid::default();
        g.set(0, 0, rows, 15);
        g.set(0, 1, rows, 7);
        g.set(0, 0, rows, 3); // overwrite
        assert_eq!(g.get(0, 0, rows), 3, "overwrite failed");
        assert_eq!(g.get(0, 1, rows), 7, "neighbour corrupted");
    }

    #[test]
    fn unpack_and_pack_round_trip() {
        let rows = 3;
        let mut g = PackedGrid::default();
        let mut k = 0u8;
        for r in 0..5usize {
            for row in 0..rows {
                g.set(r, row, rows, k % 31);
                k += 1;
            }
        }
        let flat = g.unpack(5, rows);
        let g2 = PackedGrid::pack(&flat, 5, rows);
        assert_eq!(g, g2, "pack(unpack(g)) must equal g");
    }

    #[test]
    fn from_dyn_matches_original() {
        use crate::grid::DynGrid;
        let reels = 5;
        let rows = 3;
        let mut dyn_grid = DynGrid::new(reels, rows);
        let mut k = 0u8;
        for r in 0..reels {
            for row in 0..rows {
                dyn_grid.set(r, row, k % 30);
                k += 1;
            }
        }
        let packed = PackedGrid::from_dyn(&dyn_grid);
        for r in 0..reels {
            for row in 0..rows {
                assert_eq!(
                    packed.get(r, row, rows),
                    dyn_grid.get(r, row),
                    "mismatch at ({r},{row})"
                );
            }
        }
    }

    #[test]
    fn generator_all_cells_in_symbol_range() {
        use crate::config::*;
        use std::collections::HashMap;

        let mut cfg = GameConfig::default();
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
        cfg.paytable = HashMap::new();

        let gen = PackedGridGenerator::from_config(&cfg);
        let mut rng = SlotRng::new(1337);

        for _ in 0..10_000 {
            let g = gen.generate_base(&mut rng);
            for r in 0..gen.reels() {
                for row in 0..gen.rows() {
                    let sym = g.get(r, row, gen.rows());
                    assert!(
                        sym < 5,
                        "symbol index {sym} out of expected range (have 5 symbols)"
                    );
                }
            }
        }
    }

    #[test]
    fn generator_fs_weights_used_when_present() {
        use crate::config::*;
        use std::collections::HashMap;

        let mut cfg = GameConfig::default();
        // Base: only symbol 0 (W)
        cfg.base_weights = vec![
            vec![ReelWeight {
                symbol: "W".to_string(),
                weight: 100
            }];
            5
        ];
        // FS: only symbol 1 (H1)
        cfg.fs_weights = vec![
            vec![ReelWeight {
                symbol: "H1".to_string(),
                weight: 100
            }];
            5
        ];
        cfg.paytable = HashMap::new();

        let gen = PackedGridGenerator::from_config(&cfg);
        let mut rng = SlotRng::new(42);

        for _ in 0..100 {
            let base = gen.generate_base(&mut rng);
            let fs = gen.generate_fs(&mut rng);
            assert_eq!(base.get(0, 0, gen.rows()), 0, "base must use W (idx=0)");
            assert_eq!(fs.get(0, 0, gen.rows()), 1, "FS must use H1 (idx=1)");
        }
    }
}
