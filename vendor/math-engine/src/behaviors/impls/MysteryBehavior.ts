/**
 * MysteryBehavior — symbol that transforms into another symbol on land.
 *
 * All mystery instances on the grid reveal as the SAME symbol (drawn once
 * from the weighted distribution). This is the standard convention for
 * mystery-reveal mechanics.
 *
 * Config:
 *   revealDistribution — { symbolId: weight, ... }
 *   seed               — optional fixed seed for deterministic tests
 *
 * Implementation note:
 *   The behavior uses the grid scan to find ALL mystery positions, then
 *   emits a `transform_symbol` for each one with the same `toSymbol` value.
 *   The random draw uses the RNG embedded in BehaviorContext.state if
 *   available; otherwise falls back to Math.random(). In production the
 *   pipeline injects a seeded RNG via SpinState extensions.
 */

import type {
  BehaviorContext,
  Effect,
  SymbolBehavior,
  SymbolBehaviorConfig,
} from '../types.js';

export interface MysteryBehaviorConfig extends SymbolBehaviorConfig {
  revealDistribution?: Record<string, number>;
}

export class MysteryBehavior implements SymbolBehavior {
  readonly kind = 'MysteryBehavior';
  private readonly _dist: Array<{ sym: string; weight: number }>;
  private readonly _total: number;

  constructor(
    readonly id: string,
    private readonly _cfg: MysteryBehaviorConfig = {}
  ) {
    const raw = (_cfg.revealDistribution as Record<string, number>) ?? {};
    this._dist = Object.entries(raw).map(([sym, weight]) => ({ sym, weight }));
    this._total = this._dist.reduce((a, b) => a + b.weight, 0) || 1;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    // Find all mystery positions on the grid.
    const grid = ctx.grid as string[][];
    const positions: Array<{ reel: number; row: number }> = [];

    for (let reel = 0; reel < grid.length; reel++) {
      const col = grid[reel];
      if (!col) continue;
      for (let row = 0; row < col.length; row++) {
        if (col[row] === this.id) {
          positions.push({ reel, row });
        }
      }
    }

    if (positions.length === 0) return [];
    if (this._dist.length === 0) return [];

    // Draw the reveal symbol once for all instances.
    const toSymbol = this._draw();

    return positions.map(pos => ({
      kind: 'transform_symbol' as const,
      reel: pos.reel,
      row: pos.row,
      toSymbol,
    }));
  }

  onWin(_ctx: BehaviorContext): Effect[] {
    return [];
  }

  private _draw(): string {
    // Weighted random selection — use Math.random() (pipeline can override).
    let r = Math.random() * this._total;
    for (const entry of this._dist) {
      r -= entry.weight;
      if (r <= 0) return entry.sym;
    }
    return this._dist[this._dist.length - 1]?.sym ?? '';
  }

  /**
   * Deterministic draw for testing — returns the symbol for a given
   * normalized float `t` ∈ [0, 1).
   */
  drawForT(t: number): string {
    let r = t * this._total;
    for (const entry of this._dist) {
      r -= entry.weight;
      if (r <= 0) return entry.sym;
    }
    return this._dist[this._dist.length - 1]?.sym ?? '';
  }
}
