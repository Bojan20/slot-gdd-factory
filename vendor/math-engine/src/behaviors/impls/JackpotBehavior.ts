/**
 * JackpotBehavior — symbol that awards a jackpot tier on win.
 *
 * Config:
 *   tier      — jackpot tier id (e.g. 'grand', 'major', 'minor', 'mini')
 *   amount    — jackpot multiplier × bet (0 = progressive / to be resolved externally)
 *   triggerOn — 'land' | 'win' (default: 'win')
 *   minCount  — minimum instances on grid to trigger (default: 1)
 *
 * Only one jackpot is awarded per spin — SpinState.jackpotAwarded is a
 * single-entry field; subsequent award_jackpot effects are silently dropped
 * by the pipeline.
 */

import type {
  BehaviorContext,
  Effect,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export type JackpotTrigger = 'land' | 'win';

export interface JackpotBehaviorConfig extends SymbolBehaviorConfig {
  tier?: string;
  amount?: number;
  triggerOn?: JackpotTrigger;
  minCount?: number;
}

export class JackpotBehavior implements SymbolBehavior {
  readonly kind = 'JackpotBehavior';
  private readonly _tier: string;
  private readonly _amount: number;
  private readonly _triggerOn: JackpotTrigger;
  private readonly _minCount: number;

  constructor(
    readonly id: string,
    private readonly _cfg: JackpotBehaviorConfig = {}
  ) {
    this._tier      = (_cfg.tier as string) ?? 'grand';
    this._amount    = (_cfg.amount as number) ?? 0;
    this._triggerOn = (_cfg.triggerOn as JackpotTrigger) ?? 'win';
    this._minCount  = (_cfg.minCount as number) ?? 1;
  }

  private _shouldTrigger(grid: string[][]): boolean {
    if (this._minCount <= 1) return true;
    let count = 0;
    for (const col of grid) {
      for (const cell of col) {
        if (cell === this.id) {
          count++;
          if (count >= this._minCount) return true;
        }
      }
    }
    return false;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'land') return [];
    if (!this._shouldTrigger(ctx.grid as string[][])) return [];
    return [{ kind: 'award_jackpot', tier: this._tier, amount: this._amount }];
  }

  onWin(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'win') return [];
    if (!this._shouldTrigger(ctx.grid as string[][])) return [];
    return [{ kind: 'award_jackpot', tier: this._tier, amount: this._amount }];
  }
}
