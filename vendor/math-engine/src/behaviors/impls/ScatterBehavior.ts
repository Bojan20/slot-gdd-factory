/**
 * ScatterBehavior — pays anywhere and/or triggers a named feature.
 *
 * Config:
 *   featureId    — feature to trigger (e.g. 'free_spins'). Default: 'free_spins'.
 *   triggerCount — minimum scatter count to trigger (default: 3).
 *   scatterPays  — map of count→multiplier for pay-anywhere payouts.
 *                  e.g. { 3: 2, 4: 10, 5: 50 }
 *
 * Each scatter instance calls `onLand`. The pipeline accumulates all
 * `trigger_feature` effects; duplicate feature IDs are deduplicated by
 * SpinState's Set. We emit `trigger_feature` every time a scatter lands
 * but the feature is only activated if scatter_count reaches the threshold.
 * Feature activation logic lives in irEvaluator — not here.
 *
 * `scatter_pay` effects are emitted from onLand with the full count context
 * by scanning the grid for current scatter density.
 */

import type {
  BehaviorContext,
  Effect,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export interface ScatterBehaviorConfig extends SymbolBehaviorConfig {
  featureId?: string;
  triggerCount?: number;
  scatterPays?: Record<string, number>;
}

export class ScatterBehavior implements SymbolBehavior {
  readonly kind = 'ScatterBehavior';
  private readonly _featureId: string;
  private readonly _triggerCount: number;
  private readonly _scatterPays: Map<number, number>;

  constructor(
    readonly id: string,
    private readonly _cfg: ScatterBehaviorConfig = {}
  ) {
    this._featureId = (_cfg.featureId as string) ?? 'free_spins';
    this._triggerCount = (_cfg.triggerCount as number) ?? 3;

    const rawPays = (_cfg.scatterPays as Record<string, number>) ?? {};
    this._scatterPays = new Map(
      Object.entries(rawPays).map(([k, v]) => [parseInt(k, 10), v])
    );
  }

  onLand(ctx: BehaviorContext): Effect[] {
    const effects: Effect[] = [];

    // Count how many of this scatter symbol are currently on the grid.
    const count = this._countOnGrid(ctx.grid as string[][], this.id);

    // Emit trigger_feature if threshold is met.
    if (count >= this._triggerCount) {
      effects.push({ kind: 'trigger_feature', featureId: this._featureId });
    }

    // Emit scatter_pay if a pay exists for this count.
    const multiplier = this._scatterPays.get(count);
    if (multiplier !== undefined) {
      effects.push({ kind: 'scatter_pay', count, multiplier });
    }

    return effects;
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    return [];
  }

  private _countOnGrid(grid: string[][], symbolId: string): number {
    let n = 0;
    for (const col of grid) {
      for (const cell of col) {
        if (cell === symbolId) n++;
      }
    }
    return n;
  }
}
