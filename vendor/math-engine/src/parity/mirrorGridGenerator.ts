/**
 * Faza 10.3 — TS-side mirror of the Rust grid generator.
 *
 * This module is **the** TS implementation that is bit-identical to
 * `rust-sim/src/grid.rs::generate_grid` for the Mulberry32 RNG. It
 * exists exclusively for the parity gate — production TS uses the
 * legacy `XorShift128+` path which is not byte-comparable to Rust.
 *
 * Bit-identity contract:
 *
 *   1. Same `(sym_id, weight)` list per reel, in the same JSON-source
 *      order as the IR (`base[reel]` object key iteration order is
 *      preserved by `Object.entries`).
 *   2. Same RNG: `Mulberry32` from `src/rng/backends/Mulberry32.ts`,
 *      whose `nextF64()` returns the same f64 as Rust
 *      `SlotRng::random()` for every step.
 *   3. Same weighted sampling: `roll = rng.nextF64() * total`, then
 *      decrement-and-test loop in the same order, picking the first
 *      `roll <= 0` symbol.
 *   4. Same fallback: if `total == 0`, all cells stay at sentinel "0"
 *      (we emit the special id `"?"` to match Rust's `symbol_id(0)`
 *      default; if symbol 0 exists in the config we emit its id).
 *
 * The result is a flat row-major `string[]` (length `reels × rows`),
 * exactly mirroring `evaluator_parity.rs::grid_symbols`.
 */

import { Mulberry32 } from '../rng/backends/Mulberry32.js';

export interface MirrorIRSymbol {
  id: string;
}

export interface MirrorIRConfig {
  topology: { reels: number; rows: number };
  symbols: ReadonlyArray<MirrorIRSymbol>;
  reels: { base: ReadonlyArray<Record<string, number>> };
}

/** Per-reel `(sym_idx, weight)` table, mirrors Rust `reel_weights`. */
export interface MirrorReelWeights {
  /** Each `[sym_idx, weight]` pair, in source-order. */
  readonly pairs: ReadonlyArray<readonly [number, number]>;
  /** Sum of weights. Zero iff the reel is empty (Rust would skip it). */
  readonly total: number;
}

/**
 * Build the per-reel weight tables, mirroring
 * `rust-sim/src/grid.rs::build_weight_table` exactly.
 *
 * **Iteration order is lexicographic by symbol id.** This is critical
 * for byte-match: the Rust IR adapter loads weighted reels into a
 * `BTreeMap<String, f64>` (`rust-sim/src/ir/adapter.rs::
 * weighted_map_to_reel_weights`), which produces alphabetically-
 * ordered keys. The TS engine's `Object.entries` on the JSON object
 * preserves insertion order — different from BTreeMap. We **must**
 * sort here to match Rust's iteration order, or the same Mulberry32
 * roll selects a different symbol on every cell.
 */
export function buildMirrorWeightTables(ir: MirrorIRConfig): MirrorReelWeights[] {
  const symIndex = new Map<string, number>();
  for (let i = 0; i < ir.symbols.length; i++) {
    symIndex.set(ir.symbols[i].id, i);
  }

  const out: MirrorReelWeights[] = [];
  for (const reel of ir.reels.base) {
    const pairs: Array<[number, number]> = [];
    let total = 0;
    // SORTED lexicographically — mirrors BTreeMap iteration in Rust.
    const entries = Object.entries(reel).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    for (const [symId, weight] of entries) {
      const idx = symIndex.get(symId);
      if (idx === undefined) continue; // Rust does the same (`if let Some(idx) = ...`)
      // Round to integer like Rust u32 (config schema specifies integer weights).
      const w = Math.trunc(weight);
      if (w <= 0) continue;
      pairs.push([idx, w]);
      total += w;
    }
    out.push({ pairs, total });
  }
  return out;
}

/**
 * Generate a single grid using the Mulberry32 path, emitting the same
 * row-major `string[]` representation that `evaluator_parity.rs` emits.
 * `rng` is consumed in-place — caller drives it across spins.
 */
export function generateMirrorGrid(
  ir: MirrorIRConfig,
  weights: ReadonlyArray<MirrorReelWeights>,
  rng: Mulberry32
): string[] {
  const reels = ir.topology.reels;
  const rows = ir.topology.rows;
  const out: string[] = new Array(reels * rows);

  for (let r = 0; r < reels; r++) {
    const reelWeights = weights[r];
    const total = reelWeights?.total ?? 0;
    if (total === 0) {
      // Match Rust: leave sentinel 0; ids resolved below.
      for (let row = 0; row < rows; row++) {
        out[r * rows + row] = ir.symbols[0]?.id ?? '?';
      }
      continue;
    }
    for (let row = 0; row < rows; row++) {
      let roll = rng.nextF64() * total;
      let chosen = 0;
      for (const [symIdx, w] of reelWeights.pairs) {
        roll -= w;
        if (roll <= 0) {
          chosen = symIdx;
          break;
        }
      }
      out[r * rows + row] = ir.symbols[chosen]?.id ?? '?';
    }
  }

  return out;
}
