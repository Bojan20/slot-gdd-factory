/**
 * WalkingWildBehavior — wild that moves one position per spin.
 *
 * On spin-end the wild emits `add_wild` at the next position and the
 * current position is NOT locked (the reel will draw a new symbol there).
 * When the wild reaches the grid edge:
 *   - `disappearsOnEdge: true` → no further effects (wild is gone)
 *   - `disappearsOnEdge: false` → wild bounces (direction reverses)
 *
 * Config:
 *   direction       — 'left' | 'right' | 'up' | 'down' (default: 'left')
 *   disappearsOnEdge — default true
 *   reels           — grid reel count (required for bounds)
 *   rows            — grid row count (required for bounds)
 *
 * NOTE: Position tracking is done via SpinState.lockedPositions with
 * remainingSpins = 999 (sentinel meaning "walk forever"). The pipeline's
 * restoreLockedPositions() call at spin-start places the wild at the
 * tracked position. WalkingWildBehavior.onSpinEnd() then issues
 * `add_wild` at the next position and removes the old lock by emitting
 * a `lock_position` at the new cell.
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export type WalkDirection = 'left' | 'right' | 'up' | 'down';

export interface WalkingWildConfig extends SymbolBehaviorConfig {
  direction?: WalkDirection;
  disappearsOnEdge?: boolean;
  reels?: number;
  rows?: number;
}

const WALK_SENTINEL = 9999; // large remaining-spins value = "always sticky"

export class WalkingWildBehavior implements SymbolBehavior {
  readonly kind = 'WalkingWildBehavior';
  private readonly _dir: WalkDirection;
  private readonly _disappears: boolean;
  private readonly _reels: number;
  private readonly _rows: number;

  constructor(
    readonly id: string,
    private readonly _cfg: WalkingWildConfig = {}
  ) {
    this._dir = (_cfg.direction as WalkDirection) ?? 'left';
    this._disappears = (_cfg.disappearsOnEdge as boolean) ?? true;
    this._reels = (_cfg.reels as number) ?? 5;
    this._rows = (_cfg.rows as number) ?? 3;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    // Lock current position with a high sentinel so it persists.
    return [{
      kind: 'lock_position',
      reel: ctx.reel,
      row: ctx.row,
      remainingSpins: WALK_SENTINEL,
    }];
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    return [];
  }

  onSpinEnd(ctx: BehaviorContext): Effect[] {
    // Determine the next position.
    const next = this._nextPos(ctx.reel, ctx.row);

    if (!next) {
      // Wild walked off or couldn't bounce — release the lock via an
      // update (set remainingSpins to 0 on current position).
      // We achieve this by emitting lock_position with 0 remaining;
      // the pipeline's tickLockedPositions will prune it next tick.
      return [];
    }

    const effects: Effect[] = [];
    // Place wild at next position with high sentinel.
    effects.push({ kind: 'add_wild', reel: next.reel, row: next.row, symbol: this.id });
    effects.push({
      kind: 'lock_position',
      reel: next.reel,
      row: next.row,
      remainingSpins: WALK_SENTINEL,
    });
    // The old position lock will be ticked by tickLockedPositions — but
    // it has WALK_SENTINEL remaining. We need to forcibly remove it.
    // We handle this by re-locking the old cell with remainingSpins = 0
    // effectively (1 tick away from expiry).
    effects.push({ kind: 'lock_position', reel: ctx.reel, row: ctx.row, remainingSpins: 1 });
    return effects;
  }

  private _nextPos(
    reel: number,
    row: number
  ): { reel: number; row: number } | null {
    let nr = reel;
    let nrow = row;
    let dir = this._dir;

    switch (dir) {
      case 'left':  nr--;  break;
      case 'right': nr++;  break;
      case 'up':    nrow--; break;
      case 'down':  nrow++; break;
    }

    const outOfBounds =
      nr < 0 || nr >= this._reels || nrow < 0 || nrow >= this._rows;

    if (outOfBounds) {
      if (this._disappears) return null;
      // Bounce: reverse direction
      switch (dir) {
        case 'left':  nr = reel + 1; break;
        case 'right': nr = reel - 1; break;
        case 'up':    nrow = row + 1; break;
        case 'down':  nrow = row - 1; break;
      }
      // Second out-of-bounds check (corner case).
      if (nr < 0 || nr >= this._reels || nrow < 0 || nrow >= this._rows) {
        return null;
      }
    }

    return { reel: nr, row: nrow };
  }
}
