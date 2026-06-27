/**
 * ExpandingWildBehavior — wild that expands to fill its entire reel on land.
 *
 * Config:
 *   rows       — number of rows in the grid (required for expand_wild effect)
 *   onWinOnly  — if true, expands only when it contributes to a win (default false)
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export interface ExpandingWildConfig extends SymbolBehaviorConfig {
  /** Grid row count (used to validate the expand). */
  rows?: number;
  /** Expand only when the symbol is part of a winning line. Default: false. */
  onWinOnly?: boolean;
}

export class ExpandingWildBehavior implements SymbolBehavior {
  readonly kind = 'ExpandingWildBehavior';
  private readonly _onWinOnly: boolean;

  constructor(
    readonly id: string,
    private readonly _cfg: ExpandingWildConfig = {}
  ) {
    this._onWinOnly = (_cfg.onWinOnly as boolean) ?? false;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    if (this._onWinOnly) return [];
    return [{ kind: 'expand_wild', reel: ctx.reel, symbol: ctx.symbolId }];
  }

  onWin(ctx: BehaviorContext): Effect[] {
    if (!this._onWinOnly) return [];
    // If it already expanded on land, don't re-emit.
    return [{ kind: 'expand_wild', reel: ctx.reel, symbol: ctx.symbolId }];
  }
}
