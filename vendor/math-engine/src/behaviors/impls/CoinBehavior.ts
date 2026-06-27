/**
 * CoinBehavior — coin / cash symbol for Hold & Win features.
 *
 * On land: collects the coin at the current position and, if the total coin
 * count reaches `triggerCount`, triggers the Hold & Win feature.
 * During HnW respins: each new coin resets the respin counter.
 *
 * Config:
 *   featureId    — feature to trigger (default: 'hold_and_win')
 *   triggerCount — minimum coins to trigger HnW (default: 6)
 *   defaultAmount — coin cash value if no amount encoded in grid (default: 1)
 *   respinsReset  — how many respins to award per new coin during HnW (default: 3)
 *
 * Amount encoding: If the symbol id is of the form "COIN:42" the amount is
 * parsed from the suffix. Otherwise `defaultAmount` is used.
 */

import type {
  BehaviorContext,
  Effect,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export interface CoinBehaviorConfig extends SymbolBehaviorConfig {
  featureId?: string;
  triggerCount?: number;
  defaultAmount?: number;
  respinsReset?: number;
}

export class CoinBehavior implements SymbolBehavior {
  readonly kind = 'CoinBehavior';
  private readonly _featureId: string;
  private readonly _triggerCount: number;
  private readonly _defaultAmount: number;
  private readonly _respinsReset: number;

  constructor(
    readonly id: string,
    private readonly _cfg: CoinBehaviorConfig = {}
  ) {
    this._featureId    = (_cfg.featureId    as string) ?? 'hold_and_win';
    this._triggerCount = (_cfg.triggerCount as number) ?? 6;
    this._defaultAmount = (_cfg.defaultAmount as number) ?? 1;
    this._respinsReset  = (_cfg.respinsReset  as number) ?? 3;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    const effects: Effect[] = [];
    const amount = this._parseAmount(ctx.symbolId);

    // Collect the coin.
    effects.push({ kind: 'collect_coin', reel: ctx.reel, row: ctx.row, amount });

    // Count total coins on the grid (after this land).
    const coinCount = this._countCoins(ctx.grid as string[][]);

    // Trigger feature if threshold met.
    if (coinCount >= this._triggerCount) {
      effects.push({ kind: 'trigger_feature', featureId: this._featureId });
    }

    // During a HnW respin session (triggeredFeatures already contains the id),
    // award additional respins.
    if (ctx.state.triggeredFeatures.has(this._featureId)) {
      effects.push({ kind: 'respin', count: this._respinsReset });
    }

    return effects;
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    return [];
  }

  private _parseAmount(symbolId: string): number {
    // Support "COIN:42" style encoded amounts.
    const colon = symbolId.indexOf(':');
    if (colon >= 0) {
      const parsed = parseFloat(symbolId.slice(colon + 1));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return this._defaultAmount;
  }

  private _countCoins(grid: string[][]): number {
    let n = 0;
    const prefix = this.id.split(':')[0] ?? this.id;
    for (const col of grid) {
      for (const cell of col) {
        if (cell === this.id || cell.startsWith(prefix + ':')) n++;
      }
    }
    return n;
  }
}
