/**
 * Slot GDD Factory · paylines BLOCK
 *
 * One concern: produce the canonical PAYLINE_POOL (array of line definitions,
 * each line = array of row indices per reel) for a given grid shape.
 *
 * Public API:
 *   buildStandardPaylines(reels, rows)     → number[][]  (pure)
 *   paylineConfig(model, shape)            → { mode: 'line-pays'|'cluster'|'ways', pool: number[][] }
 *   LINE_PAYS_KINDS                        → Set of shape.kind values that use paylines
 *
 * Pure ES module — Node-testable, no DOM, no globals. Server-side block. The
 * runtime SVG draw lives in a sibling block (`paylineOverlay.mjs`) that emits
 * an injected JS string for the in-browser overlay.
 *
 * GDD-driven: when the parsed model carries an explicit payline pool
 * (`model.winPresentation.paylines`), it wins over the synthesised default.
 * Otherwise we fall back to the industry-standard 16/20/25-line set so a
 * fresh GDD without an explicit pool still produces correct line cycling.
 */

/* Grid kinds that pay on lines (vs. cluster / ways / wheel etc.). Used by
   the orchestrator to decide whether to instantiate a payline pool at all. */
export const LINE_PAYS_KINDS = new Set([
  'rectangular', 'variable_reel', 'lock_respin', 'expanding'
]);

/* ── industry-standard payline synthesiser ─────────────────────────────────
   Same generator that previously lived inline in buildSlotHTML.mjs. Pure
   function — given (reels, rows) returns a deduplicated array of line
   definitions clamped to the visible grid. Output is stable across runs
   (no randomness, no Date.now), so PAR comparators and parity gates can
   diff hashes deterministically. */
export function buildStandardPaylines(reels, rows) {
  if (reels < 3) return [];
  /* Helper — clamp every row of a line into [0, rows-1] so we can reuse
     the canonical 5×3 set on taller grids by repeating the centre row. */
  const clamp = (row) => Math.max(0, Math.min(rows - 1, row));
  const horizontalRows = rows >= 3 ? [1, 0, 2] : Array.from({length: rows}, (_, i) => i);
  const lines = [];
  /* 1-3: three horizontals (middle, top, bottom) */
  for (const r of horizontalRows.slice(0, Math.min(rows, 4))) {
    lines.push(Array(reels).fill(clamp(r)));
  }
  if (reels >= 3 && rows >= 3) {
    /* 4-5: V and inverted V */
    lines.push(Array.from({length: reels}, (_, c) => {
      const mid = (reels - 1) / 2;
      const d = Math.abs(c - mid);
      return clamp(Math.round(d));
    }));
    lines.push(Array.from({length: reels}, (_, c) => {
      const mid = (reels - 1) / 2;
      const d = Math.abs(c - mid);
      return clamp(rows - 1 - Math.round(d));
    }));
    /* 6-9: U-shape variants on top and bottom rows */
    const u  = (c) => (c === 0 || c === reels - 1) ? 1 : 0;
    const u2 = (c) => (c === 0 || c === reels - 1) ? 1 : 2;
    const u3 = (c) => (c === 0 || c === reels - 1) ? 0 : 1;
    const u4 = (c) => (c === 0 || c === reels - 1) ? 2 : 1;
    lines.push(Array.from({length: reels}, (_, c) => clamp(u(c))));
    lines.push(Array.from({length: reels}, (_, c) => clamp(u2(c))));
    lines.push(Array.from({length: reels}, (_, c) => clamp(u3(c))));
    lines.push(Array.from({length: reels}, (_, c) => clamp(u4(c))));
    /* 10-15: zig-zags (alternating row pairs) */
    const zig = (a, b) => (c) => clamp(c % 2 === 0 ? a : b);
    lines.push(Array.from({length: reels}, (_, c) => zig(0, 1)(c)));
    lines.push(Array.from({length: reels}, (_, c) => zig(1, 0)(c)));
    lines.push(Array.from({length: reels}, (_, c) => zig(2, 1)(c)));
    lines.push(Array.from({length: reels}, (_, c) => zig(1, 2)(c)));
    lines.push(Array.from({length: reels}, (_, c) => zig(0, 2)(c)));
    lines.push(Array.from({length: reels}, (_, c) => zig(2, 0)(c)));
    /* 16-20: bounded peaks/valleys */
    const peaks = [
      [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
      [1, 0, 1, 0, 1], [1, 2, 1, 2, 1],
      [0, 0, 1, 2, 2],
    ];
    for (const p of peaks) {
      lines.push(Array.from({length: reels}, (_, c) => clamp(p[c] ?? p[p.length - 1])));
    }
    /* 21-25: deep-row variations (only when rows >= 4) */
    if (rows >= 4) {
      const deep = [
        [3, 3, 3, 3, 3], [3, 2, 3, 2, 3], [2, 3, 2, 3, 2],
        [0, 1, 2, 3, 3], [3, 2, 1, 0, 0],
      ];
      for (const d of deep) {
        lines.push(Array.from({length: reels}, (_, c) => clamp(d[c] ?? d[d.length - 1])));
      }
    }
  }
  /* Dedupe (same path written twice on a tiny grid) */
  const seen = new Set();
  const unique = [];
  for (const line of lines) {
    const key = line.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }
  return unique;
}

/* ── payline config block ─────────────────────────────────────────────────
   GDD-driven entry point. Builds the pool the slot will animate over.

   Priority order:
     1. Model-supplied explicit pool (`model.winPresentation.paylines`)        ← GDD wins
     2. Industry-standard synthesised pool for line-pay shapes                  ← safe default
     3. Empty pool for cluster/ways/wheel etc. (orchestrator dispatches to
        cluster mode instead)                                                  ← non-line shapes
*/
export function paylineConfig(model, shape) {
  const explicit = model && model.winPresentation && Array.isArray(model.winPresentation.paylines)
    ? model.winPresentation.paylines
    : null;

  if (explicit && explicit.length > 0) {
    return { mode: 'line-pays', pool: explicit };
  }
  if (LINE_PAYS_KINDS.has(shape.kind)) {
    return { mode: 'line-pays', pool: buildStandardPaylines(shape.reels, shape.rows) };
  }
  return { mode: 'cluster', pool: [] };
}
