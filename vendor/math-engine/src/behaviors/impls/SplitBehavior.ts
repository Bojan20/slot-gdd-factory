/**
 * SplitBehavior — symbol that counts as 2 (or N) symbols for win evaluation.
 *
 * A "split symbol" or "2-in-1" position. Each visible cell of this symbol
 * contributes N matches to the ways/cluster count rather than 1.
 *
 * Implementation strategy:
 *   - For WAYS / VARIABLE_WAYS evaluation, the per-reel match count is
 *     multiplied by `splitFactor` (default 2) via `multiplier_mul` on the
 *     `'ways'` scope. The evaluator already honors ways-scope multipliers.
 *   - For LINES evaluation, the split symbol cannot occupy two payline
 *     rows simultaneously, so the behavior emits a no-op effect on land
 *     and instead relies on the paytable having a pre-doubled entry.
 *   - For CLUSTER evaluation, the cell is counted as `splitFactor` cluster
 *     members via a `multiplier_mul` on `'spin'` scope.
 *
 * Config:
 *   splitFactor — number of "virtual symbols" this cell counts as
 *                 (default: 2). Must be >= 2.
 *   evalMode    — 'ways' | 'cluster' | 'lines' (default: 'ways').
 *                 Determines which Effect scope is used.
 *   triggerOn   — 'land' | 'win' (default: 'land')
 */

import type {
  BehaviorContext,
  Effect,
  EffectScope,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export type SplitEvalMode = 'ways' | 'cluster' | 'lines';

export interface SplitConfig extends SymbolBehaviorConfig {
  splitFactor?: number;
  evalMode?: SplitEvalMode;
  triggerOn?: 'land' | 'win';
}

export class SplitBehavior implements SymbolBehavior {
  readonly kind = 'SplitBehavior';
  private readonly _factor: number;
  private readonly _evalMode: SplitEvalMode;
  private readonly _triggerOn: 'land' | 'win';

  constructor(
    readonly id: string,
    private readonly _cfg: SplitConfig = {}
  ) {
    const f = (_cfg.splitFactor as number) ?? 2;
    if (f < 2) {
      throw new Error(`SplitBehavior(${id}): splitFactor must be >= 2 (got ${f}).`);
    }
    this._factor = f;
    this._evalMode = (_cfg.evalMode as SplitEvalMode) ?? 'ways';
    this._triggerOn = (_cfg.triggerOn as 'land' | 'win') ?? 'land';
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
    let scope: EffectScope;
    switch (this._evalMode) {
      case 'ways':    scope = 'ways';    break;
      case 'cluster': scope = 'spin';    break;
      case 'lines':   return [{ kind: 'noop' }]; // see header comment
      default:        scope = 'ways';
    }
    return [{ kind: 'multiplier_mul', value: this._factor, scope }];
  }
}
