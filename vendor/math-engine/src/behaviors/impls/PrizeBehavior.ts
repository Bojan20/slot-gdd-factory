/**
 * PrizeBehavior — symbol carrying a direct cash-on-reel value.
 *
 * Unlike CoinBehavior (which adds to a Hold & Win bank waiting to be
 * collected), PrizeBehavior emits the value immediately on land — useful
 * for "money symbol pays-on-land" mechanics where the value contributes
 * to total win regardless of payline / cluster.
 *
 * Config:
 *   defaultAmount — fallback amount when no per-cell amount is supplied
 *                   (default: 1.0)
 *   amountByCell  — Map<"r,c", number> — explicit amount per grid position
 *                   (useful for tests where cells carry pre-rolled values)
 *   distribution  — Map<symbol, weight> for random value sampling at
 *                   construction time; when set, `amountByCell` is ignored
 *                   and the prize value is drawn from this distribution
 *                   the first time the cell is observed.
 *   rngSeed       — deterministic seed for distribution sampling (test mode)
 *   triggerOn     — 'land' | 'win' (default: 'land')
 *   directPayout  — when true, emit `scatter_pay` instead of `collect_coin`
 *                   so the value adds to total win immediately rather than
 *                   to a Hold & Win bank. Default: true.
 *
 * Pipeline interaction:
 *   - `directPayout: true` → emits `scatter_pay { count, multiplier }`
 *     where `multiplier = amount` so the pipeline adds it to scatterPayout.
 *     `count` defaults to 1 (we always sweep one cell per emission).
 *   - `directPayout: false` → emits `collect_coin { reel, row, amount }`,
 *     same as CoinBehavior, for Hold & Win integration.
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export interface PrizeConfig extends SymbolBehaviorConfig {
  defaultAmount?: number;
  amountByCell?: Record<string, number>;
  distribution?: Record<string, number>;
  rngSeed?: number;
  triggerOn?: 'land' | 'win';
  directPayout?: boolean;
}

function nextRandom(seed: number): { value: number; nextSeed: number } {
  const nextSeed = (seed * 1664525 + 1013904223) >>> 0;
  return { value: nextSeed / 0x100000000, nextSeed };
}

export class PrizeBehavior implements SymbolBehavior {
  readonly kind = 'PrizeBehavior';
  private readonly _defaultAmount: number;
  private readonly _amountByCell: ReadonlyMap<string, number>;
  private readonly _distribution: ReadonlyArray<[number, number]>; // sorted [cumulativeWeight, value]
  private readonly _totalWeight: number;
  private readonly _triggerOn: 'land' | 'win';
  private readonly _direct: boolean;
  private _seed: number;

  constructor(
    readonly id: string,
    private readonly _cfg: PrizeConfig = {}
  ) {
    this._defaultAmount = (_cfg.defaultAmount as number) ?? 1.0;
    this._amountByCell = new Map(Object.entries((_cfg.amountByCell as Record<string, number>) ?? {}));
    this._triggerOn = (_cfg.triggerOn as 'land' | 'win') ?? 'land';
    this._direct = (_cfg.directPayout as boolean) ?? true;
    this._seed = (_cfg.rngSeed as number) ?? 0xC0FFEE;

    const dist = (_cfg.distribution as Record<string, number>) ?? {};
    const entries = Object.entries(dist);
    let cumulative = 0;
    const sorted: [number, number][] = [];
    for (const [valStr, weight] of entries) {
      const v = Number(valStr);
      if (Number.isFinite(v) && weight > 0) {
        cumulative += weight;
        sorted.push([cumulative, v]);
      }
    }
    this._distribution = sorted;
    this._totalWeight = cumulative;
  }

  onLand(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'land') return [];
    return this._emit(ctx);
  }

  onWin(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'win') return [];
    return this._emit(ctx);
  }

  private _emit(ctx: BehaviorContext): Effect[] {
    const amount = this._resolveAmount(ctx);
    if (amount <= 0) return [];

    if (this._direct) {
      return [{ kind: 'scatter_pay', count: 1, multiplier: amount }];
    }
    return [{ kind: 'collect_coin', reel: ctx.reel, row: ctx.row, amount }];
  }

  private _resolveAmount(ctx: BehaviorContext): number {
    const key = `${ctx.reel},${ctx.row}`;
    const explicit = this._amountByCell.get(key);
    if (explicit !== undefined) return explicit;

    if (this._totalWeight > 0 && this._distribution.length > 0) {
      const { value, nextSeed } = nextRandom(this._seed);
      this._seed = nextSeed;
      const target = value * this._totalWeight;
      for (const [cumWeight, val] of this._distribution) {
        if (target < cumWeight) return val;
      }
      // Numerical edge: target equals totalWeight exactly.
      return this._distribution[this._distribution.length - 1]![1];
    }

    return this._defaultAmount;
  }
}
