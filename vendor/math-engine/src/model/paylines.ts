/**
 * SLOT MATH ENGINE TEMPLATE - Demo Payline Definitions (5×3)
 *
 * NOTE: This file describes the **default demo game** (10 paylines on 5×3).
 * The engine itself supports arbitrary grids — see `src/ir/` and
 * `src/config/gameConfig.ts::buildGameConfig()` for IR-driven configs.
 *
 * Dimensions are **derived** from the payline definitions below, NOT
 * hardcoded. Override by passing a different `paylines` set to
 * `buildGameConfig({ paylines, ... })`.
 *
 * Grid positions (row, col):
 *   [0,0] [0,1] [0,2] [0,3] [0,4]  <- Top row
 *   [1,0] [1,1] [1,2] [1,3] [1,4]  <- Middle row
 *   [2,0] [2,1] [2,2] [2,3] [2,4]  <- Bottom row
 *
 * Paylines evaluate Left-to-Right only by default.
 * Each payline is an array of row indices per reel [reel0Row, reel1Row, ...].
 */

export type PaylineDefinition = number[];

/**
 * Standard 10-line payline configuration
 * Classic pattern covering key positions
 */
export const PAYLINES: PaylineDefinition[] = [
  // Line 1: Middle straight
  [1, 1, 1, 1, 1],

  // Line 2: Top straight
  [0, 0, 0, 0, 0],

  // Line 3: Bottom straight
  [2, 2, 2, 2, 2],

  // Line 4: V shape (top to bottom to top)
  [0, 1, 2, 1, 0],

  // Line 5: Inverted V (bottom to top to bottom)
  [2, 1, 0, 1, 2],

  // Line 6: Top zigzag down
  [0, 0, 1, 2, 2],

  // Line 7: Bottom zigzag up
  [2, 2, 1, 0, 0],

  // Line 8: Wave down from middle
  [1, 0, 0, 0, 1],

  // Line 9: Wave up from middle
  [1, 2, 2, 2, 1],

  // Line 10: Diamond center
  [1, 0, 1, 2, 1]
];

// Dimensions DERIVED from PAYLINES, not hardcoded.
// Engine supports arbitrary grids — these constants describe the demo only.
export const NUM_PAYLINES = PAYLINES.length;
export const NUM_REELS: number = PAYLINES[0]?.length ?? 5;
export const NUM_ROWS: number = (() => {
  let max = 0;
  for (const line of PAYLINES) for (const r of line) if (r > max) max = r;
  return max + 1;
})();

/**
 * Build straight-line paylines for an arbitrary grid:
 *   row 0 across, row 1 across, ..., row (rows-1) across.
 *
 * For non-rectangular topologies, use IR `evaluation.paylines` instead.
 */
export function buildStraightLinePaylines(reels: number, rows: number): PaylineDefinition[] {
  const out: PaylineDefinition[] = [];
  for (let r = 0; r < rows; r++) {
    out.push(new Array(reels).fill(r));
  }
  return out;
}

/**
 * Derive dimensions from any payline set.
 * Returns `{reels, rows}` for the given set, or null if empty.
 */
export function deriveDimensions(
  paylines: PaylineDefinition[],
): { reels: number; rows: number } | null {
  if (paylines.length === 0) return null;
  const reels = paylines[0]!.length;
  let rows = 0;
  for (const line of paylines) for (const r of line) if (r >= rows) rows = r + 1;
  return { reels, rows };
}

/**
 * Payline visualization helper
 * Returns ASCII art of a payline on the grid
 */
export function visualizePayline(lineIndex: number): string {
  const payline = PAYLINES[lineIndex];
  if (!payline) return '';
  // Use the demo dimensions derived from this PAYLINES set.
  const grid: string[][] = Array.from({ length: NUM_ROWS }, () =>
    Array(NUM_REELS).fill('.'),
  );
  for (let reel = 0; reel < NUM_REELS; reel++) {
    const row = payline[reel];
    if (row !== undefined && grid[row]) grid[row]![reel] = 'X';
  }
  return grid.map(row => row.join(' ')).join('\n');
}

/**
 * Get all grid positions covered by paylines
 * Returns Set of "row,col" strings
 */
export function getCoveredPositions(): Set<string> {
  const covered = new Set<string>();

  for (const payline of PAYLINES) {
    for (let reel = 0; reel < NUM_REELS; reel++) {
      covered.add(`${payline[reel]},${reel}`);
    }
  }

  return covered;
}

/**
 * Validate payline definitions
 * Ensures all positions are within grid bounds
 */
export function validatePaylines(
  paylines: PaylineDefinition[] = PAYLINES,
  reels: number = NUM_REELS,
  rows: number = NUM_ROWS,
): boolean {
  for (let i = 0; i < paylines.length; i++) {
    const payline = paylines[i];
    if (!payline) continue;

    if (payline.length !== reels) {
      console.error(`Payline ${i + 1} has wrong length: ${payline.length} (expected ${reels})`);
      return false;
    }

    for (let reel = 0; reel < reels; reel++) {
      const r = payline[reel];
      if (r === undefined || r < 0 || r >= rows) {
        console.error(`Payline ${i + 1}, reel ${reel}: invalid row ${r}`);
        return false;
      }
    }
  }

  return true;
}
