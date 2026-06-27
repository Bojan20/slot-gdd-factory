/**
 * MultiplierSymbolBehavior — non-wild symbol that carries a multiplier.
 *
 * Unlike MultiplierWildBehavior (which substitutes AND multiplies),
 * this symbol just applies a multiplier on the spin when it lands OR wins.
 *
 * Config:
 *   value      — multiplier value (default: 2)
 *   scope      — 'line' | 'ways' | 'spin' | 'session' (default: 'spin')
 *   mode       — 'mul' | 'add' (default: 'mul')
 *   triggerOn  — 'land' | 'win' | 'both' (default: 'win')
 */

import type {
  BehaviorContext,
  Effect,
  EffectScope,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export type MultiplierTrigger = 'land' | 'win' | 'both';

export interface MultiplierSymbolConfig extends SymbolBehaviorConfig {
  value?: number;
  scope?: EffectScope;
  mode?: 'mul' | 'add';
  triggerOn?: MultiplierTrigger;
}

export class MultiplierSymbolBehavior implements SymbolBehavior {
  readonly kind = 'MultiplierSymbolBehavior';
  private readonly _value: number;
  private readonly _scope: EffectScope;
  private readonly _mode: 'mul' | 'add';
  private readonly _triggerOn: MultiplierTrigger;

  constructor(
    readonly id: string,
    private readonly _cfg: MultiplierSymbolConfig = {}
  ) {
    this._value     = (_cfg.value as number) ?? 2;
    this._scope     = (_cfg.scope as EffectScope) ?? 'spin';
    this._mode      = (_cfg.mode as 'mul' | 'add') ?? 'mul';
    this._triggerOn = (_cfg.triggerOn as MultiplierTrigger) ?? 'win';
  }

  private _makeEffect(): Effect {
    if (this._mode === 'mul') {
      return { kind: 'multiplier_mul', value: this._value, scope: this._scope };
    }
    return { kind: 'multiplier_add', value: this._value, scope: this._scope };
  }

  onLand(_ctx: BehaviorContext): Effect[] {
    if (this._triggerOn === 'land' || this._triggerOn === 'both') {
      return [this._makeEffect()];
    }
    return [];
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    if (this._triggerOn === 'win' || this._triggerOn === 'both') {
      return [this._makeEffect()];
    }
    return [];
  }
}
