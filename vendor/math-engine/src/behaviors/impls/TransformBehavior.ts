/**
 * TransformBehavior — rule-based symbol transformer.
 *
 * Applies a set of transform rules on land, turning the current symbol (or
 * other symbols on the grid) into something else. Useful for chain-wild
 * effects, symbol upgrades, etc.
 *
 * Config:
 *   rules — Array of transform rules, applied in order:
 *     { trigger: 'self' | 'adjacent' | 'all'; from: string; to: string; }
 *   upgradeAll — if true, emit upgrade_symbols (global replace) instead
 *                of per-cell transform_symbol effects
 *
 * Rule `trigger`:
 *   'self'     — transforms only [reel, row] where this symbol landed
 *   'adjacent' — transforms all 4 orthogonal neighbors
 *   'all'      — transforms all matching cells on the grid
 */

import type {
  BehaviorContext,
  Effect,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export type TransformTrigger = 'self' | 'adjacent' | 'all';

export interface TransformRule {
  trigger: TransformTrigger;
  from: string;
  to: string;
}

export interface TransformBehaviorConfig extends SymbolBehaviorConfig {
  rules?: TransformRule[];
  upgradeAll?: boolean;
}

export class TransformBehavior implements SymbolBehavior {
  readonly kind = 'TransformBehavior';
  private readonly _rules: TransformRule[];
  private readonly _upgradeAll: boolean;

  constructor(
    readonly id: string,
    private readonly _cfg: TransformBehaviorConfig = {}
  ) {
    this._rules = (_cfg.rules as TransformRule[]) ?? [];
    this._upgradeAll = (_cfg.upgradeAll as boolean) ?? false;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    const effects: Effect[] = [];
    const grid = ctx.grid as string[][];

    for (const rule of this._rules) {
      if (this._upgradeAll && rule.trigger === 'all') {
        effects.push({ kind: 'upgrade_symbols', fromSymbol: rule.from, toSymbol: rule.to });
        continue;
      }

      switch (rule.trigger) {
        case 'self': {
          if (grid[ctx.reel]?.[ctx.row] === rule.from) {
            effects.push({ kind: 'transform_symbol', reel: ctx.reel, row: ctx.row, toSymbol: rule.to });
          }
          break;
        }

        case 'adjacent': {
          const neighbors = [
            [ctx.reel - 1, ctx.row],
            [ctx.reel + 1, ctx.row],
            [ctx.reel, ctx.row - 1],
            [ctx.reel, ctx.row + 1],
          ];
          for (const [nr, nrow] of neighbors) {
            if (nr != null && nrow != null && grid[nr]?.[nrow] === rule.from) {
              effects.push({ kind: 'transform_symbol', reel: nr, row: nrow, toSymbol: rule.to });
            }
          }
          break;
        }

        case 'all': {
          for (let reel = 0; reel < grid.length; reel++) {
            const col = grid[reel];
            if (!col) continue;
            for (let row = 0; row < col.length; row++) {
              if (col[row] === rule.from) {
                effects.push({ kind: 'transform_symbol', reel, row, toSymbol: rule.to });
              }
            }
          }
          break;
        }
      }
    }

    return effects;
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    return [];
  }
}
