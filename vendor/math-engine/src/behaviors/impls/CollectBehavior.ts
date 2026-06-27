/**
 * CollectBehavior — symbol that sweeps every coin / prize on the grid and
 * sums their values to itself.
 *
 * Pairs with `CoinBehavior` / `PrizeBehavior`: those put numeric values on
 * the grid, this one harvests them.
 *
 * Config:
 *   coinSymbols      — ids of symbols whose values are eligible to collect
 *                      (default: ['C']). All other cells are ignored.
 *   coinAmountByCell — Map<"r,c", number> — values placed by upstream
 *                      coin/prize symbols. Used in tests to pre-populate
 *                      values. In production, values are read from
 *                      `ctx.state.collectedCoins`.
 *   triggerOn        — 'land' | 'win' (default: 'land')
 *   multiplier       — multiplier applied to collected total (default: 1)
 *
 * Pipeline interaction:
 *   - This behavior emits one `collect_coin` per eligible grid cell that
 *     carries a numeric value. The pipeline appends each to
 *     `state.collectedCoins`, which features-layer (hold-and-win) sums
 *     into the final win.
 *   - The behavior does NOT emit `expand_wild` or `transform_symbol` —
 *     the grid is read-only from its perspective.
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export interface CollectConfig extends SymbolBehaviorConfig {
  coinSymbols?: string[];
  coinAmountByCell?: Record<string, number>;
  triggerOn?: 'land' | 'win';
  multiplier?: number;
}

export class CollectBehavior implements SymbolBehavior {
  readonly kind = 'CollectBehavior';
  private readonly _coinSymbols: ReadonlySet<string>;
  private readonly _coinAmountByCell: ReadonlyMap<string, number>;
  private readonly _triggerOn: 'land' | 'win';
  private readonly _multiplier: number;

  constructor(
    readonly id: string,
    private readonly _cfg: CollectConfig = {}
  ) {
    const coins = (_cfg.coinSymbols as string[]) ?? ['C'];
    this._coinSymbols = new Set(coins);
    this._coinAmountByCell = new Map(Object.entries((_cfg.coinAmountByCell as Record<string, number>) ?? {}));
    this._triggerOn = (_cfg.triggerOn as 'land' | 'win') ?? 'land';
    this._multiplier = (_cfg.multiplier as number) ?? 1;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'land') return [];
    return this._sweep(ctx);
  }

  onWin(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'win') return [];
    return this._sweep(ctx);
  }

  private _sweep(ctx: BehaviorContext): Effect[] {
    const effects: Effect[] = [];
    const grid = ctx.grid;

    for (let reel = 0; reel < grid.length; reel++) {
      const col = grid[reel];
      if (!col) continue;
      for (let row = 0; row < col.length; row++) {
        const sym = col[row];
        if (!sym || !this._coinSymbols.has(sym)) continue;

        // Skip the collector's own cell.
        if (reel === ctx.reel && row === ctx.row) continue;

        const key = `${reel},${row}`;
        const amount = (this._coinAmountByCell.get(key) ?? 1) * this._multiplier;
        if (amount <= 0) continue;

        effects.push({
          kind: 'collect_coin',
          reel,
          row,
          amount,
        });
      }
    }

    return effects;
  }
}
