/**
 * WildReelBehavior — symbol that converts its entire reel to wild on land.
 *
 * Distinct from ExpandingWildBehavior in that the reel turns fully wild
 * regardless of which row the trigger symbol landed on. Common mechanic
 * for "full-reel wild" stacked features.
 *
 * Config:
 *   wildSymbol     — id of the wild symbol to fill the reel with (default: 'W')
 *   triggerOn      — 'land' | 'win' (default: 'land')
 *   stickyDuration — optional; if set > 0 the reel stays wild for N more spins
 *                    via lock_position on each cell in the reel.
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export interface WildReelConfig extends SymbolBehaviorConfig {
  wildSymbol?: string;
  triggerOn?: 'land' | 'win';
  stickyDuration?: number;
}

export class WildReelBehavior implements SymbolBehavior {
  readonly kind = 'WildReelBehavior';
  private readonly _wildSymbol: string;
  private readonly _triggerOn: 'land' | 'win';
  private readonly _stickyDuration: number;

  constructor(
    readonly id: string,
    private readonly _cfg: WildReelConfig = {}
  ) {
    this._wildSymbol = (_cfg.wildSymbol as string) ?? 'W';
    this._triggerOn = (_cfg.triggerOn as 'land' | 'win') ?? 'land';
    this._stickyDuration = (_cfg.stickyDuration as number) ?? 0;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'land') return [];
    return this._makeEffects(ctx);
  }

  onWin(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'win') return [];
    return this._makeEffects(ctx);
  }

  private _makeEffects(ctx: BehaviorContext): Effect[] {
    const effects: Effect[] = [];
    // expand_wild fills the entire reel with the wild symbol.
    effects.push({ kind: 'expand_wild', reel: ctx.reel, symbol: this._wildSymbol });

    // Optional sticky: lock every cell of this reel for stickyDuration spins.
    if (this._stickyDuration > 0) {
      const reelCol = ctx.grid[ctx.reel];
      const rowCount = reelCol?.length ?? 0;
      for (let row = 0; row < rowCount; row++) {
        effects.push({
          kind: 'lock_position',
          reel: ctx.reel,
          row,
          remainingSpins: this._stickyDuration,
        });
      }
    }

    return effects;
  }
}
