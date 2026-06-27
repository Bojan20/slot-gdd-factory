/**
 * MultiplierWildBehavior — wild that multiplies wins when part of a winning combo.
 *
 * Config:
 *   value  — multiplier value (default: 2)
 *   scope  — 'line' | 'ways' | 'spin' | 'session' (default: 'line')
 *   mode   — 'mul' (multiplicative) | 'add' (additive stacking) (default: 'mul')
 *
 * Examples:
 *   Two ×2 mul wilds on the same line → ×4 (multiplicative).
 *   Two ×2 add wilds on the same line → ×3 (additive: 1 + 1 + 1).
 */

import type {
  BehaviorContext,
  Effect,
  EffectScope,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export interface MultiplierWildConfig extends SymbolBehaviorConfig {
  value?: number;
  scope?: EffectScope;
  mode?: 'mul' | 'add';
}

export class MultiplierWildBehavior implements SymbolBehavior {
  readonly kind = 'MultiplierWildBehavior';
  private readonly _value: number;
  private readonly _scope: EffectScope;
  private readonly _mode: 'mul' | 'add';

  constructor(
    readonly id: string,
    private readonly _cfg: MultiplierWildConfig = {}
  ) {
    this._value = (_cfg.value as number) ?? 2;
    this._scope = (_cfg.scope as EffectScope) ?? 'line';
    this._mode = (_cfg.mode as 'mul' | 'add') ?? 'mul';
  }

  onLand(_ctx: BehaviorContext): Effect[] {
    return [];
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    if (this._mode === 'mul') {
      return [{ kind: 'multiplier_mul', value: this._value, scope: this._scope }];
    } else {
      return [{ kind: 'multiplier_add', value: this._value, scope: this._scope }];
    }
  }
}
