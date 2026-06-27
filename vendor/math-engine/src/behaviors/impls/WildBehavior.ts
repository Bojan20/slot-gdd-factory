/**
 * WildBehavior — standard wild symbol.
 *
 * Standard wilds substitute for any non-special symbol in win evaluation.
 * The substitution itself is handled by the line/ways evaluator; this behavior
 * exists to (a) provide a registered hook for custom wild effects, and (b)
 * serve as the base class pattern for specialized wilds.
 *
 * `onLand` — no effects (wild substitution is implicit in win evaluation).
 * `onWin`  — no effects by default; subclasses override for multipliers etc.
 */

import type {
  BehaviorContext,
  Effect,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export class WildBehavior implements SymbolBehavior {
  readonly kind = 'WildBehavior';

  constructor(
    readonly id: string,
    protected readonly _cfg: SymbolBehaviorConfig = {}
  ) {}

  onLand(_ctx: BehaviorContext): Effect[] {
    return [];
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    return [];
  }
}
