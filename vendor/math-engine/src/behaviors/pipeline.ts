/**
 * Faza 3 — Symbol Behavior Plugin Layer: Effect Pipeline
 *
 * Applies a stream of Effects to a mutable SpinState.
 * All mutations are centralized here — behaviors return Effects,
 * the pipeline owns the state transition logic.
 *
 * ## Ordering
 *
 * Effects within a single hook call are applied in array order.
 * transform_symbol / expand_wild / upgrade_symbols effects mutate
 * `state.grid` immediately so later effects in the same batch see
 * the updated grid (e.g. a wild that expands then multiplies).
 *
 * ## Multiplier semantics
 *
 * - `multiplier_add(v, scope)` → state.[scope]Multiplier += (v - 1)
 *   so add(2) on a ×1 base → ×2, add(2) twice → ×3 (additive stacking).
 * - `multiplier_mul(v, scope)` → state.[scope]Multiplier *= v
 *   so mul(2) on ×3 → ×6 (multiplicative stacking).
 *
 * Both are intentional — different game designs use different conventions.
 */

import type { Effect, EffectScope, SpinState } from './types.js';

// ─── Single-effect application ─────────────────────────────────────────────

/**
 * Apply one Effect to the given SpinState, mutating it in place.
 * Returns the same reference for chaining convenience.
 */
export function applyEffect(state: SpinState, effect: Effect): SpinState {
  switch (effect.kind) {
    case 'noop':
      break;

    case 'multiplier_add': {
      const delta = effect.value - 1;
      _adjustMultiplier(state, effect.scope, delta, 'add');
      break;
    }

    case 'multiplier_mul': {
      _adjustMultiplier(state, effect.scope, effect.value, 'mul');
      break;
    }

    case 'transform_symbol': {
      const col = state.grid[effect.reel];
      if (col && effect.row >= 0 && effect.row < col.length) {
        col[effect.row] = effect.toSymbol;
      }
      break;
    }

    case 'expand_wild': {
      const col = state.grid[effect.reel];
      if (col) {
        for (let r = 0; r < col.length; r++) {
          col[r] = effect.symbol;
        }
      }
      break;
    }

    case 'lock_position': {
      // Upsert: if position already locked, update remainingSpins to max.
      const existing = state.lockedPositions.find(
        lp => lp.reel === effect.reel && lp.row === effect.row
      );
      if (existing) {
        existing.remainingSpins = Math.max(existing.remainingSpins, effect.remainingSpins);
      } else {
        // Symbol at this position becomes the locked wild.
        const sym = state.grid[effect.reel]?.[effect.row] ?? 'W';
        state.lockedPositions.push({
          reel: effect.reel,
          row: effect.row,
          symbol: sym,
          remainingSpins: effect.remainingSpins,
        });
      }
      break;
    }

    case 'add_wild': {
      const col = state.grid[effect.reel];
      if (col && effect.row >= 0 && effect.row < col.length) {
        col[effect.row] = effect.symbol;
      }
      break;
    }

    case 'collect_coin': {
      state.collectedCoins.push({
        reel: effect.reel,
        row: effect.row,
        amount: effect.amount,
      });
      break;
    }

    case 'trigger_feature': {
      state.triggeredFeatures.add(effect.featureId);
      break;
    }

    case 'award_jackpot': {
      // Only award once per spin.
      if (!state.jackpotAwarded) {
        state.jackpotAwarded = { tier: effect.tier, amount: effect.amount };
      }
      break;
    }

    case 'upgrade_symbols': {
      for (const col of state.grid) {
        for (let r = 0; r < col.length; r++) {
          if (col[r] === effect.fromSymbol) {
            col[r] = effect.toSymbol;
          }
        }
      }
      state.upgrades.push({ fromSymbol: effect.fromSymbol, toSymbol: effect.toSymbol });
      break;
    }

    case 'scatter_pay': {
      state.scatterPayout += effect.multiplier;
      break;
    }

    case 'respin': {
      state.respinsAwarded += effect.count;
      break;
    }

    default: {
      // Exhaustive check — compile error if a variant is missing above.
      const _exhaustive: never = effect;
      throw new Error(`Unknown effect kind: ${JSON.stringify(_exhaustive)}`);
    }
  }

  return state;
}

// ─── Batch application ─────────────────────────────────────────────────────

/**
 * Apply an array of Effects to SpinState in order.
 * Returns the same state reference.
 */
export function applyEffects(state: SpinState, effects: Effect[]): SpinState {
  for (const effect of effects) {
    applyEffect(state, effect);
  }
  return state;
}

// ─── Multiplier helper ─────────────────────────────────────────────────────

function _adjustMultiplier(
  state: SpinState,
  scope: EffectScope,
  value: number,
  mode: 'add' | 'mul'
): void {
  switch (scope) {
    case 'line':
      state.lineMultiplier = mode === 'add'
        ? state.lineMultiplier + value
        : state.lineMultiplier * value;
      break;
    case 'ways':
      // Ways games share the same spin accumulator.
      state.spinMultiplier = mode === 'add'
        ? state.spinMultiplier + value
        : state.spinMultiplier * value;
      break;
    case 'spin':
      state.spinMultiplier = mode === 'add'
        ? state.spinMultiplier + value
        : state.spinMultiplier * value;
      break;
    case 'session':
      state.sessionMultiplier = mode === 'add'
        ? state.sessionMultiplier + value
        : state.sessionMultiplier * value;
      break;
    default: {
      const _ex: never = scope;
      throw new Error(`Unknown scope: ${_ex}`);
    }
  }
}

// ─── Locked-position tick ──────────────────────────────────────────────────

/**
 * Decrement all locked positions by 1 spin.
 * Removes positions whose remaining spins reach 0.
 * Call this at spin-end, after all effects have been applied.
 *
 * Returns the list of positions that were released (for audit).
 */
export function tickLockedPositions(state: SpinState): Array<{ reel: number; row: number }> {
  const released: Array<{ reel: number; row: number }> = [];

  state.lockedPositions = state.lockedPositions.filter(lp => {
    lp.remainingSpins--;
    if (lp.remainingSpins <= 0) {
      released.push({ reel: lp.reel, row: lp.row });
      return false;
    }
    return true;
  });

  return released;
}

/**
 * Restore all locked-position symbols onto the grid.
 * Call this at spin-start, before random symbols are drawn, so that
 * sticky wilds persist across spins.
 */
export function restoreLockedPositions(state: SpinState): void {
  for (const lp of state.lockedPositions) {
    const col = state.grid[lp.reel];
    if (col && lp.row >= 0 && lp.row < col.length) {
      col[lp.row] = lp.symbol;
    }
  }
}

// ─── BehaviorPipeline ──────────────────────────────────────────────────────

/**
 * High-level pipeline that orchestrates behavior calls for a full spin.
 *
 * Usage:
 * ```ts
 * const pipeline = new BehaviorPipeline(registry, state);
 * pipeline.runOnLand();           // all visible symbols → onLand
 * // ... win evaluation happens here ...
 * pipeline.runOnWin(winningSyms); // winning symbols → onWin
 * pipeline.runOnSpinEnd();        // all symbols → onSpinEnd
 * ```
 */
import type { SymbolBehavior, BehaviorContext } from './types.js';

export class BehaviorPipeline {
  constructor(
    private readonly behaviors: Map<string, SymbolBehavior>,
    private readonly state: SpinState
  ) {}

  /**
   * Run `onLand` for every symbol visible on the current grid.
   */
  runOnLand(): void {
    this._forEachCell((behavior, ctx) => {
      const effects = behavior.onLand(ctx);
      applyEffects(this.state, effects);
    });
  }

  /**
   * Run `onWin` for each [reel, row] pair that is part of a winning combo.
   */
  runOnWin(winningPositions: Array<{ symbolId: string; reel: number; row: number }>): void {
    for (const pos of winningPositions) {
      const behavior = this.behaviors.get(pos.symbolId);
      if (!behavior) continue;
      const ctx = this._buildCtx(pos.symbolId, pos.reel, pos.row);
      const effects = behavior.onWin(ctx);
      applyEffects(this.state, effects);
    }
  }

  /**
   * Run `onCascadeRemove` for each position being removed in a cascade.
   */
  runOnCascadeRemove(removedPositions: Array<{ symbolId: string; reel: number; row: number }>): void {
    for (const pos of removedPositions) {
      const behavior = this.behaviors.get(pos.symbolId);
      if (!behavior?.onCascadeRemove) continue;
      const ctx = this._buildCtx(pos.symbolId, pos.reel, pos.row);
      const effects = behavior.onCascadeRemove(ctx);
      applyEffects(this.state, effects);
    }
  }

  /**
   * Run `onFeatureStart` for all registered behaviors.
   * `symbolId` on the context is empty string — this is a session event.
   */
  runOnFeatureStart(featureId: string): void {
    for (const [symId, behavior] of this.behaviors) {
      if (!behavior.onFeatureStart) continue;
      const ctx: BehaviorContext = {
        symbolId: symId,
        reel: -1,
        row: -1,
        state: this.state,
        config: {},
        grid: this.state.grid,
      };
      const effects = behavior.onFeatureStart({ ...ctx, config: { featureId } });
      applyEffects(this.state, effects);
    }
  }

  /**
   * Run `onSpinEnd` for every symbol visible on the current grid.
   */
  runOnSpinEnd(): void {
    this._forEachCell((behavior, ctx) => {
      if (!behavior.onSpinEnd) return;
      const effects = behavior.onSpinEnd(ctx);
      applyEffects(this.state, effects);
    });
  }

  private _forEachCell(
    fn: (behavior: SymbolBehavior, ctx: BehaviorContext) => void
  ): void {
    const grid = this.state.grid;
    for (let reel = 0; reel < grid.length; reel++) {
      const col = grid[reel];
      if (!col) continue;
      for (let row = 0; row < col.length; row++) {
        const symId = col[row];
        if (!symId) continue;
        const behavior = this.behaviors.get(symId);
        if (!behavior) continue;
        fn(behavior, this._buildCtx(symId, reel, row));
      }
    }
  }

  private _buildCtx(symbolId: string, reel: number, row: number): BehaviorContext {
    return {
      symbolId,
      reel,
      row,
      state: this.state,
      config: {},
      grid: this.state.grid,
    };
  }
}
