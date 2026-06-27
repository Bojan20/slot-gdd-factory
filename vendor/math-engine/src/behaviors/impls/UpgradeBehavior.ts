/**
 * UpgradeBehavior — converts every instance of one symbol on the grid
 * into another (an "upgrade").
 *
 * Distinct from `TransformBehavior` which transforms only the current cell.
 * Upgrade applies grid-wide via `upgrade_symbols` Effect.
 *
 * Use cases:
 *   - "Promote every LP_1 to HP_1 once this symbol lands"
 *   - Chain upgrade cascades (LP_5 → LP_4 → ... → HP_1)
 *
 * Config:
 *   fromSymbol — id of symbol to upgrade (required)
 *   toSymbol   — id of upgraded symbol (required)
 *   triggerOn  — 'land' | 'win' (default: 'land')
 *   chain      — optional sequence of [from, to] pairs for chain upgrades.
 *                If supplied, `fromSymbol`/`toSymbol` are ignored and each
 *                pair in `chain` is emitted as a separate upgrade_symbols
 *                effect, in order. The pipeline applies them sequentially.
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export interface UpgradeChain {
  from: string;
  to: string;
}

export interface UpgradeConfig extends SymbolBehaviorConfig {
  fromSymbol?: string;
  toSymbol?: string;
  triggerOn?: 'land' | 'win';
  chain?: UpgradeChain[];
}

export class UpgradeBehavior implements SymbolBehavior {
  readonly kind = 'UpgradeBehavior';
  private readonly _from: string;
  private readonly _to: string;
  private readonly _triggerOn: 'land' | 'win';
  private readonly _chain: ReadonlyArray<UpgradeChain>;

  constructor(
    readonly id: string,
    private readonly _cfg: UpgradeConfig = {}
  ) {
    this._from = (_cfg.fromSymbol as string) ?? '';
    this._to = (_cfg.toSymbol as string) ?? '';
    this._triggerOn = (_cfg.triggerOn as 'land' | 'win') ?? 'land';
    this._chain = (_cfg.chain as UpgradeChain[]) ?? [];

    if (this._chain.length === 0 && (!this._from || !this._to)) {
      throw new Error(
        `UpgradeBehavior(${id}): must supply either chain[] or both fromSymbol+toSymbol.`
      );
    }
  }

  onLand(_ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'land') return [];
    return this._makeEffects();
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'win') return [];
    return this._makeEffects();
  }

  private _makeEffects(): Effect[] {
    if (this._chain.length > 0) {
      return this._chain.map(c => ({
        kind: 'upgrade_symbols' as const,
        fromSymbol: c.from,
        toSymbol: c.to,
      }));
    }
    return [{
      kind: 'upgrade_symbols',
      fromSymbol: this._from,
      toSymbol: this._to,
    }];
  }
}
