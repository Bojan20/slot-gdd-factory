/**
 * W152 Wave 18 — Selective Stacking H&W Mode (Faza 15.A.14).
 *
 * Hold & Win family of features supports two distinct cell-respin modes:
 *
 *   * `all_reels`        — every reel re-spins on each respin pass.
 *                          Locked cells stay (= "sticky"), unlocked
 *                          cells are re-rolled. Resets respin counter
 *                          ONLY when no new cell-locks happened.
 *                          (Classic generic Hold-and-Win semantics.)
 *
 *   * `selective_locked` — ONLY columns that have at least one unlocked
 *                          cell re-spin. Fully-locked columns freeze
 *                          entirely (no symbol movement at all). Resets
 *                          respin counter on no-new-lock condition.
 *                          (Used by some heavily-stacked H&W variants
 *                          where freezing whole columns is the design
 *                          intent — generic mechanic, no vendor.)
 *
 * Math difference:
 *   * `all_reels` — long-run RTP unchanged BUT distribution of respin-
 *     count is wider (locked cells continue to occupy space, but other
 *     reels still do work).
 *   * `selective_locked` — same long-run RTP (∑ payouts identical) BUT
 *     respin-count distribution is narrower because frozen columns
 *     produce 0 new locks per spin. Acceptance gate: total RTP ±0.001 %
 *     across modes; per-respin distributions DIVERGE measurably.
 *
 * This module formalises the mode selection so the IR carries an
 * EXPLICIT `stackingMode` field on a Hold&Win feature, instead of
 * relying on ad-hoc evaluator branches. Engine consumers read
 * `selectStackingResolver(mode)` to get the right cell-update function.
 */

export type StackingMode = 'all_reels' | 'selective_locked';

export interface CellState {
  /** Symbol currently in the cell. */
  symbol: string;
  /** Whether the cell is locked (a money-symbol or persistent feature). */
  locked: boolean;
  /** Optional cash value if the cell is a money-symbol. */
  cashValue?: number;
}

export type Grid = CellState[][]; // grid[reel][row]

export interface RespinResult {
  /** New grid after applying the resolver. */
  newGrid: Grid;
  /** Number of NEW locks that happened during this respin. */
  newLockCount: number;
  /** Reels that were re-rolled (length 0 if none). */
  reelsRespun: number[];
}

export interface RespinContext {
  grid: Grid;
  /**
   * Caller-provided cell generator. Given (reel, row), returns the
   * NEW cell state for that position. For unlocked cells, this draws
   * a fresh symbol; for locked cells, the resolver never calls this.
   *
   * Pure function — operator wires their RNG inside the closure.
   */
  generateCell: (reel: number, row: number) => CellState;
}

// ════════════════════════════════════════════════════════════════════════════
// Resolvers
// ════════════════════════════════════════════════════════════════════════════

/**
 * `all_reels` mode resolver — every reel respins, but locked cells stay.
 * Returns the new grid + count of newly-locked cells.
 */
export function resolveAllReels(ctx: RespinContext): RespinResult {
  const newGrid: Grid = ctx.grid.map((reel, ri) =>
    reel.map((cell, rj) => {
      if (cell.locked) return cell;
      return ctx.generateCell(ri, rj);
    }),
  );
  const newLockCount = countNewLocks(ctx.grid, newGrid);
  const reelsRespun = ctx.grid.map((_, i) => i);
  return { newGrid, newLockCount, reelsRespun };
}

/**
 * `selective_locked` mode resolver — only columns with at least one
 * unlocked cell respin. Fully-locked columns freeze entirely.
 */
export function resolveSelectiveLocked(ctx: RespinContext): RespinResult {
  const reelsRespun: number[] = [];
  const newGrid: Grid = ctx.grid.map((reel, ri) => {
    const allLocked = reel.every((c) => c.locked);
    if (allLocked) return reel; // frozen column
    reelsRespun.push(ri);
    return reel.map((cell, rj) => {
      if (cell.locked) return cell;
      return ctx.generateCell(ri, rj);
    });
  });
  const newLockCount = countNewLocks(ctx.grid, newGrid);
  return { newGrid, newLockCount, reelsRespun };
}

/** Count how many cells became locked during the respin. */
function countNewLocks(prev: Grid, next: Grid): number {
  let count = 0;
  for (let ri = 0; ri < prev.length; ri++) {
    for (let rj = 0; rj < prev[ri].length; rj++) {
      if (!prev[ri][rj].locked && next[ri]?.[rj]?.locked) {
        count += 1;
      }
    }
  }
  return count;
}

/** Factory — operator picks mode at IR-load time. */
export function selectStackingResolver(mode: StackingMode): (ctx: RespinContext) => RespinResult {
  switch (mode) {
    case 'all_reels':
      return resolveAllReels;
    case 'selective_locked':
      return resolveSelectiveLocked;
    default:
      throw new Error(`selectStackingResolver: unknown mode '${mode}'`);
  }
}
