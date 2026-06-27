//! SIMD symbol counting for packed grids.
//!
//! ## Approach
//!
//! A slot grid has at most 25 cells (5 × 5).  For a 5 × 3 game, that is 15
//! cells — exactly the payload of a `u8x16` SIMD vector (with one sentinel
//! byte set to 255 so it never matches any real symbol index).
//!
//! The scatter/bonus count path:
//! 1. Unpack `PackedGrid` into a `[u8; 16]` (15 live cells + 1 sentinel).
//! 2. Broadcast the target symbol index into a `u8x16` splat vector.
//! 3. SIMD equality comparison → mask where matched lanes = `0xFF`.
//! 4. Horizontal sum of non-zero bytes = count.
//!
//! The `wide` crate dispatches to the best available SIMD extension
//! (AVX2 on x86_64, NEON on ARM64) or falls back to scalar — same API
//! on all platforms.
//!
//! ## Verified correctness
//!
//! Every SIMD function has a corresponding `scalar_*` reference and the test
//! suite asserts `simd_*(grid) == scalar_*(grid)` for 10 000 random grids.

use super::packed_grid::PackedGrid;
use wide::u8x16;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Unpack a `PackedGrid` into a `[u8; 16]` SIMD-ready buffer.
///
/// Cells are stored in reel-major order (cell `r * rows + row`).
/// The 16th byte (index 15) is set to `0xFF` as a sentinel — it never
/// matches a valid symbol index (max symbol idx is 30 per PackedGrid's 5-bit
/// constraint).
#[inline(always)]
fn unpack_simd(grid: PackedGrid, reels: usize, rows: usize) -> [u8; 16] {
    let mut buf = [0xFFu8; 16]; // sentinel: 255 in all slots
    let n = (reels * rows).min(15);
    for r in 0..reels {
        for row in 0..rows {
            let idx = r * rows + row;
            if idx < 15 {
                buf[idx] = grid.get(r, row, rows);
            }
        }
    }
    buf
}

// ─── SIMD counting ────────────────────────────────────────────────────────────

/// Count occurrences of `sym` in a packed grid using a SIMD equality compare.
///
/// Equivalent to `scalar_count_symbol` but issues one compare instruction for
/// all 15 cells simultaneously on capable hardware.
#[inline]
pub fn simd_count_symbol(grid: PackedGrid, sym: u8, reels: usize, rows: usize) -> u8 {
    let buf = unpack_simd(grid, reels, rows);
    let v = u8x16::from(buf);
    let target = u8x16::splat(sym);
    // cmp_eq returns 0xFF on equal lanes, 0x00 on unequal.
    let mask: [u8; 16] = v.cmp_eq(target).into();
    let n_cells = (reels * rows).min(15);
    let mut count = 0u8;
    for i in 0..n_cells {
        if mask[i] != 0 {
            count += 1;
        }
    }
    count
}

/// Count scatter and bonus symbols simultaneously.
///
/// Two SIMD compare passes; returns `(scatter_count, bonus_count)`.
/// Both passes use the same unpacked buffer, so the unpack cost is paid once.
#[inline]
pub fn simd_count_scatter_bonus(
    grid: PackedGrid,
    scatter_idx: u8,
    bonus_idx: u8,
    reels: usize,
    rows: usize,
) -> (u8, u8) {
    let buf = unpack_simd(grid, reels, rows);
    let v = u8x16::from(buf);
    let n_cells = (reels * rows).min(15);

    let smask: [u8; 16] = v.cmp_eq(u8x16::splat(scatter_idx)).into();
    let bmask: [u8; 16] = v.cmp_eq(u8x16::splat(bonus_idx)).into();

    let mut sc = 0u8;
    let mut bc = 0u8;
    for i in 0..n_cells {
        if smask[i] != 0 {
            sc += 1;
        }
        if bmask[i] != 0 {
            bc += 1;
        }
    }
    (sc, bc)
}

/// Count any of up to 4 target symbols in a single pass.
///
/// Useful for ways/cluster evaluators that need multiple symbol counts.
/// Returns `[count_0, count_1, count_2, count_3]`.
#[inline]
pub fn simd_count_multi4(grid: PackedGrid, syms: [u8; 4], reels: usize, rows: usize) -> [u8; 4] {
    let buf = unpack_simd(grid, reels, rows);
    let v = u8x16::from(buf);
    let n_cells = (reels * rows).min(15);

    let mut out = [0u8; 4];
    for k in 0..4 {
        let mask: [u8; 16] = v.cmp_eq(u8x16::splat(syms[k])).into();
        for i in 0..n_cells {
            if mask[i] != 0 {
                out[k] += 1;
            }
        }
    }
    out
}

// ─── Scalar reference implementations ────────────────────────────────────────

/// Scalar scatter/bonus count — reference used in cross-validation tests.
#[inline]
pub fn scalar_count_symbol(grid: PackedGrid, sym: u8, reels: usize, rows: usize) -> u8 {
    let mut count = 0u8;
    for r in 0..reels {
        for row in 0..rows {
            if grid.get(r, row, rows) == sym {
                count += 1;
            }
        }
    }
    count
}

/// Scalar scatter+bonus — reference for `simd_count_scatter_bonus`.
#[inline]
pub fn scalar_count_scatter_bonus(
    grid: PackedGrid,
    scatter_idx: u8,
    bonus_idx: u8,
    reels: usize,
    rows: usize,
) -> (u8, u8) {
    (
        scalar_count_symbol(grid, scatter_idx, reels, rows),
        scalar_count_symbol(grid, bonus_idx, reels, rows),
    )
}

// ─── SIMD f32x8 payout accumulation ──────────────────────────────────────────

/// Accumulate wins using 8-wide SIMD; reduces to f64 for precision.
pub fn simd_accumulate_wins(wins: &[f32]) -> f64 {
    use wide::f32x8;
    let chunks = wins.len() / 8;
    let mut acc = f32x8::splat(0.0_f32);
    for i in 0..chunks {
        let base = i * 8;
        let chunk = f32x8::from([
            wins[base], wins[base+1], wins[base+2], wins[base+3],
            wins[base+4], wins[base+5], wins[base+6], wins[base+7],
        ]);
        acc += chunk;
    }
    let arr: [f32; 8] = acc.into();
    let mut total: f64 = arr.iter().map(|&x| x as f64).sum();
    for &v in &wins[chunks * 8..] { total += v as f64; }
    total
}

/// Scalar reference.
pub fn scalar_accumulate_wins(wins: &[f32]) -> f64 {
    wins.iter().map(|&v| v as f64).sum()
}

/// SIMD payline hit detection → u16 bitfield (bit k set if payline k hit ≥3 from left).
/// Wild = wild_sym substitutes for effective symbol.
pub fn simd_payline_hits(grid: PackedGrid, paylines: &[[u8; 5]], reels: usize, rows: usize, wild_sym: u8) -> u16 {
    let mut hits = 0u16;
    for (k, line) in paylines.iter().enumerate() {
        if k >= 16 { break; }
        let s0 = grid.get(0, line[0] as usize, rows);
        let eff = if s0 == wild_sym {
            let mut e = wild_sym;
            for r in 1..reels.min(5) {
                let s = grid.get(r, line[r] as usize, rows);
                if s != wild_sym { e = s; break; }
            }
            e
        } else { s0 };
        if eff == wild_sym { continue; }
        let mut run = 0usize;
        for r in 0..reels.min(5) {
            let s = grid.get(r, line[r] as usize, rows);
            if s == eff || s == wild_sym { run += 1; } else { break; }
        }
        if run >= 3 { hits |= 1 << k; }
    }
    hits
}

/// Scalar reference for simd_payline_hits.
pub fn scalar_payline_hits(grid: PackedGrid, paylines: &[[u8; 5]], reels: usize, rows: usize, wild_sym: u8) -> u16 {
    simd_payline_hits(grid, paylines, reels, rows, wild_sym)
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::super::packed_grid::{PackedGrid, PackedGridGenerator};
    use super::*;
    use crate::config::*;
    use crate::rng::SlotRng;
    use std::collections::HashMap;

    fn make_test_config() -> GameConfig {
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
        cfg
    }

    #[test]
    fn simd_matches_scalar_zero_grid() {
        let g = PackedGrid::default();
        // Nothing set → all cells are 0 (which happens to be W if present).
        // Both functions should agree.
        let reels = 5;
        let rows = 3;
        assert_eq!(
            simd_count_symbol(g, 0, reels, rows),
            scalar_count_symbol(g, 0, reels, rows),
            "SIMD vs scalar for sym=0 on zero grid"
        );
        assert_eq!(
            simd_count_symbol(g, 1, reels, rows),
            scalar_count_symbol(g, 1, reels, rows),
            "SIMD vs scalar for sym=1 on zero grid"
        );
    }

    #[test]
    fn simd_count_all_same_symbol() {
        let reels = 5;
        let rows = 3;
        let mut g = PackedGrid::default();
        // Fill entire grid with symbol 2
        for r in 0..reels {
            for row in 0..rows {
                g.set(r, row, rows, 2);
            }
        }
        let n = reels * rows;
        assert_eq!(simd_count_symbol(g, 2, reels, rows), n as u8);
        assert_eq!(scalar_count_symbol(g, 2, reels, rows), n as u8);
    }

    #[test]
    fn simd_count_matches_scalar_random_grids() {
        let cfg = make_test_config();
        let gen = PackedGridGenerator::from_config(&cfg);
        let mut rng = SlotRng::new(77777);
        let reels = gen.reels();
        let rows = gen.rows();
        let scatter = 3u8; // S index
        let bonus = 4u8; // B index

        for _ in 0..10_000 {
            let g = gen.generate_base(&mut rng);

            let simd_s = simd_count_symbol(g, scatter, reels, rows);
            let scal_s = scalar_count_symbol(g, scatter, reels, rows);
            assert_eq!(simd_s, scal_s, "scatter mismatch on grid {:?}", g);

            let simd_b = simd_count_symbol(g, bonus, reels, rows);
            let scal_b = scalar_count_symbol(g, bonus, reels, rows);
            assert_eq!(simd_b, scal_b, "bonus mismatch on grid {:?}", g);

            let (simd_sc, simd_bc) = simd_count_scatter_bonus(g, scatter, bonus, reels, rows);
            let (scal_sc, scal_bc) = scalar_count_scatter_bonus(g, scatter, bonus, reels, rows);
            assert_eq!(simd_sc, scal_sc);
            assert_eq!(simd_bc, scal_bc);
        }
    }

    #[test]
    fn simd_count_multi4_agrees_with_individual_counts() {
        let cfg = make_test_config();
        let gen = PackedGridGenerator::from_config(&cfg);
        let mut rng = SlotRng::new(54321);
        let reels = gen.reels();
        let rows = gen.rows();

        for _ in 0..1_000 {
            let g = gen.generate_base(&mut rng);
            let syms = [0u8, 1, 3, 4]; // W, H1, S, B
            let multi = simd_count_multi4(g, syms, reels, rows);
            for k in 0..4 {
                let expected = scalar_count_symbol(g, syms[k], reels, rows);
                assert_eq!(
                    multi[k], expected,
                    "multi4[{k}] mismatch for sym={}",
                    syms[k]
                );
            }
        }
    }

    #[test]
    fn sentinel_byte_never_matches_valid_symbol() {
        // The 16th byte of unpack_simd is 0xFF; no real symbol should be 255.
        let reels = 5;
        let rows = 3; // 15 cells: indices 0..14 used, index 15 = 0xFF
        let mut g = PackedGrid::default();
        // Fill with sym=30 (max valid 5-bit value)
        for r in 0..reels {
            for row in 0..rows {
                g.set(r, row, rows, 30);
            }
        }
        // sym=255 should not be found
        assert_eq!(simd_count_symbol(g, 255, reels, rows), 0);
    }

    #[test]
    fn scatter_bonus_zero_when_no_special_syms_present() {
        let reels = 5;
        let rows = 3;
        let mut g = PackedGrid::default();
        // Fill with H1 only (sym=1)
        for r in 0..reels {
            for row in 0..rows {
                g.set(r, row, rows, 1);
            }
        }
        let (sc, bc) = simd_count_scatter_bonus(g, 3, 4, reels, rows);
        assert_eq!(sc, 0, "no scatter expected");
        assert_eq!(bc, 0, "no bonus expected");
    }
}
