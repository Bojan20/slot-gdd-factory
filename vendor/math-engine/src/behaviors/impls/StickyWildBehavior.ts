/**
 * StickyWildBehavior — wild that locks in place for N spins after landing.
 *
 * Config:
 *   duration  — number of spins the wild remains locked (default: 3)
 *   upgradeOnWin — if true, each win during lock extends duration by 1 (default: false)
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export interface StickyWildConfig extends SymbolBehaviorConfig {
  /** Spins the wild remains. Default 3. */
  duration?: number;
  /** Extend duration by 1 on each win. Default false. */
  upgradeOnWin?: boolean;
}

export class StickyWildBehavior implements SymbolBehavior {
  readonly kind = 'StickyWildBehavior';
  private readonly _duration: number;
  private readonly _upgradeOnWin: boolean;

  constructor(
    readonly id: string,
    private readonly _cfg: StickyWildConfig = {}
  ) {
    this._duration = ((_cfg.duration as number) ?? 3);
    this._upgradeOnWin = ((_cfg.upgradeOnWin as boolean) ?? false);
  }

  onLand(ctx: BehaviorContext): Effect[] {
    return [{
      kind: 'lock_position',
      reel: ctx.reel,
      row: ctx.row,
      remainingSpins: this._duration,
    }];
  }

  onWin(ctx: BehaviorContext): Effect[] {
    if (!this._upgradeOnWin) return [];
    // Extend the lock by 1 additional spin when this symbol is in a win.
    const existing = ctx.state.lockedPositions.find(
      lp => lp.reel === ctx.reel && lp.row === ctx.row
    );
    if (!existing) return [];
    return [{
      kind: 'lock_position',
      reel: ctx.reel,
      row: ctx.row,
      remainingSpins: existing.remainingSpins + 1,
    }];
  }
}
