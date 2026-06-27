//! Faza 10.2 — Fuzz target: PackedGrid set/get and pack/unpack.
//!
//! Invariants:
//!
//! 1. `set` then `get` on any valid cell returns the set value.
//! 2. `pack(unpack(g))` == `g` for any grid and valid (reels, rows).
//! 3. Writing to one cell does not corrupt a randomly chosen other cell.
//! 4. `unpack` output cells are all < 32 (5-bit constraint).
//!
//! ## Running locally
//!
//! ```bash
//! cargo fuzz run fuzz_packed_grid -- -max_total_time=60
//! ```

#![no_main]

use libfuzzer_sys::fuzz_target;
use slot_sim::speed::PackedGrid;

fuzz_target!(|data: &[u8]| {
    if data.len() < 16 {
        return; // need enough bytes for grid dimensions + cell values
    }

    // Derive grid dimensions from fuzz data.
    let rows  = (data[0] % 5 + 1) as usize;  // 1..=5
    let reels = (data[1] % 5 + 1) as usize;  // 1..=5

    // Build a grid from fuzz data (cells from data[2..]).
    let mut g = PackedGrid::default();
    let mut idx = 2usize;
    for r in 0..reels {
        for row in 0..rows {
            let val = if idx < data.len() {
                data[idx] % 31  // clamp to 0-30
            } else {
                0u8
            };
            g.set(r, row, rows, val);
            idx += 1;
        }
    }

    // Property 1: unpack/pack round-trip.
    let flat = g.unpack(reels, rows);
    let g2   = PackedGrid::pack(&flat, reels, rows);
    for r in 0..reels {
        for row in 0..rows {
            let v1 = g.get(r, row, rows);
            let v2 = g2.get(r, row, rows);
            assert_eq!(v1, v2, "pack/unpack round-trip failed at ({r},{row})");
        }
    }

    // Property 2: all unpacked cells are < 32.
    for &c in flat.iter() {
        assert!(c < 32, "unpacked cell {c} ≥ 32 (5-bit overflow)");
    }

    // Property 3: overwrite (0,0) with a sentinel, verify no other cell changes.
    if reels >= 2 && rows >= 2 {
        let before: Vec<u8> = (0..reels).flat_map(|r| {
            (0..rows).map(move |row| g.get(r, row, rows))
        }).collect();

        let new_val = (data.get(idx).copied().unwrap_or(0) % 31) as u8;
        g.set(0, 0, rows, new_val);

        for r in 0..reels {
            for row in 0..rows {
                if r == 0 && row == 0 {
                    assert_eq!(g.get(r, row, rows), new_val, "overwrite didn't take");
                } else {
                    assert_eq!(
                        g.get(r, row, rows),
                        before[r * rows + row],
                        "cell ({r},{row}) corrupted by write to (0,0)"
                    );
                }
            }
        }
    }
});
