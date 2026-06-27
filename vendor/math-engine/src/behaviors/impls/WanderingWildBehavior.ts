/**
 * WanderingWildBehavior — wild that re-positions to a random grid cell each spin.
 *
 * Unlike WalkingWildBehavior (which moves deterministically in one direction),
 * WanderingWild jumps to a uniformly-random grid position at spin-end. The
 * previous position is released; the new position is locked for one spin
 * so the next reel draw doesn't overwrite it before the wild moves again.
 *
 * Config:
 *   reels        — grid reel count (required for bounds)
 *   rows         — grid row count (required for bounds)
 *   rngSeed      — optional fixed seed for deterministic tests
 *   pickStrategy — 'uniform' | 'avoid-current' (default: 'uniform')
 *                  'avoid-current' guarantees the new position is different
 *                  from the current one when the grid has > 1 cell.
 *
 * Determinism: the wandering RNG is seeded from `rngSeed` (test mode) or
 * derived from spin count (production) so that replay produces identical
 * trajectories from identical seeds.
 *
 * NOTE: This behavior emits `add_wild` at the next position and a short-
 * duration `lock_position` at the current cell (remainingSpins = 1) so the
 * old lock expires on the next tick. The new position is locked with a
 * sentinel value so it persists into the next spin.
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export type WanderStrategy = 'uniform' | 'avoid-current';

export interface WanderingWildConfig extends SymbolBehaviorConfig {
  reels?: number;
  rows?: number;
  rngSeed?: number;
  pickStrategy?: WanderStrategy;
}

const WANDER_SENTINEL = 9999;

/**
 * Deterministic 32-bit LCG used when `rngSeed` is supplied. Identical
 * algorithm on TS and Rust so replay reproduces the same trajectory.
 */
function nextRandom(seed: number): { value: number; nextSeed: number } {
  const nextSeed = (seed * 1664525 + 1013904223) >>> 0;
  return { value: nextSeed / 0x100000000, nextSeed };
}

export class WanderingWildBehavior implements SymbolBehavior {
  readonly kind = 'WanderingWildBehavior';
  private readonly _reels: number;
  private readonly _rows: number;
  private readonly _strategy: WanderStrategy;
  private _seed: number;

  constructor(
    readonly id: string,
    private readonly _cfg: WanderingWildConfig = {}
  ) {
    this._reels = (_cfg.reels as number) ?? 5;
    this._rows = (_cfg.rows as number) ?? 3;
    this._strategy = (_cfg.pickStrategy as WanderStrategy) ?? 'uniform';
    this._seed = (_cfg.rngSeed as number) ?? 0xCAFEBABE;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    // Lock current position so the wild survives the next reel draw.
    return [{
      kind: 'lock_position',
      reel: ctx.reel,
      row: ctx.row,
      remainingSpins: WANDER_SENTINEL,
    }];
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    return [];
  }

  onSpinEnd(ctx: BehaviorContext): Effect[] {
    const target = this._pickTarget(ctx.reel, ctx.row);
    if (!target) return [];

    return [
      // Place wild at the new position with persistence.
      { kind: 'add_wild', reel: target.reel, row: target.row, symbol: this.id },
      { kind: 'lock_position', reel: target.reel, row: target.row, remainingSpins: WANDER_SENTINEL },
      // Expire the current lock on the next tick.
      { kind: 'lock_position', reel: ctx.reel, row: ctx.row, remainingSpins: 1 },
    ];
  }

  /**
   * Pick the next random grid position.
   * Returns null if grid is empty or only-current-cell + avoid-current.
   */
  private _pickTarget(currentReel: number, currentRow: number): { reel: number; row: number } | null {
    const totalCells = this._reels * this._rows;
    if (totalCells <= 0) return null;
    if (this._strategy === 'avoid-current' && totalCells <= 1) return null;

    for (let attempt = 0; attempt < 16; attempt++) {
      const { value, nextSeed } = nextRandom(this._seed);
      this._seed = nextSeed;
      const idx = Math.floor(value * totalCells);
      const reel = idx % this._reels;
      const row = Math.floor(idx / this._reels);
      const sameAsCurrent = reel === currentReel && row === currentRow;
      if (this._strategy === 'avoid-current' && sameAsCurrent) continue;
      return { reel, row };
    }
    // Pathological case (very rare with avoid-current on tiny grids).
    return null;
  }
}
