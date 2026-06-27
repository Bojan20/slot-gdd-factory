/**
 * MegaSymbolBehavior — colossal 2×2 (or N×M) symbol occupying a rectangle
 * of grid cells.
 *
 * When the anchor cell lands, the behavior emits `transform_symbol`
 * effects for the remaining cells in the rectangle so that win
 * evaluation sees a contiguous block of matching symbols.
 *
 * Anchor convention: the (reel, row) where the trigger symbol lands is
 * the TOP-LEFT corner of the rectangle. The rectangle extends
 * `width - 1` reels to the right and `height - 1` rows down. If the
 * rectangle would exceed the grid bounds, the behavior is a no-op
 * (regulator-safe: a colossal that wouldn't fit is invalid math).
 *
 * Config:
 *   width        — rectangle width in reels (default: 2)
 *   height       — rectangle height in rows (default: 2)
 *   anchor       — 'top-left' | 'center' | 'top-right' | 'bottom-left' |
 *                  'bottom-right' (default: 'top-left')
 *   replaceWith  — symbol id to fill the rectangle with (default: the
 *                  trigger symbol's own id)
 *   triggerOn    — 'land' | 'win' (default: 'land')
 *
 * NOTE: We use `transform_symbol` (not `expand_wild`) because the colossal
 * is typically a paying HP / wild symbol, NOT necessarily a wild. The
 * pipeline applies the transforms before win evaluation reads the grid.
 */

import type { BehaviorContext, Effect, SymbolBehavior, SymbolBehaviorConfig } from '../types.js';

export type MegaAnchor =
  | 'top-left'
  | 'center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface MegaSymbolConfig extends SymbolBehaviorConfig {
  width?: number;
  height?: number;
  anchor?: MegaAnchor;
  replaceWith?: string;
  triggerOn?: 'land' | 'win';
}

export class MegaSymbolBehavior implements SymbolBehavior {
  readonly kind = 'MegaSymbolBehavior';
  private readonly _width: number;
  private readonly _height: number;
  private readonly _anchor: MegaAnchor;
  private readonly _replaceWith: string | null;
  private readonly _triggerOn: 'land' | 'win';

  constructor(
    readonly id: string,
    private readonly _cfg: MegaSymbolConfig = {}
  ) {
    const w = (_cfg.width as number) ?? 2;
    const h = (_cfg.height as number) ?? 2;
    if (w < 1 || h < 1) {
      throw new Error(
        `MegaSymbolBehavior(${id}): width and height must be >= 1 (got ${w}x${h}).`
      );
    }
    this._width = w;
    this._height = h;
    this._anchor = (_cfg.anchor as MegaAnchor) ?? 'top-left';
    this._replaceWith = (_cfg.replaceWith as string) ?? null;
    this._triggerOn = (_cfg.triggerOn as 'land' | 'win') ?? 'land';
  }

  onLand(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'land') return [];
    return this._makeEffects(ctx);
  }

  onWin(ctx: BehaviorContext): Effect[] {
    if (this._triggerOn !== 'win') return [];
    return this._makeEffects(ctx);
  }

  private _makeEffects(ctx: BehaviorContext): Effect[] {
    const fillSymbol = this._replaceWith ?? ctx.symbolId;
    const rect = this._computeRect(ctx);
    if (!rect) return [];

    const grid = ctx.grid;
    const reelCount = grid.length;
    if (reelCount === 0) return [];

    // Bounds check — entire rectangle must fit.
    for (let r = rect.minReel; r <= rect.maxReel; r++) {
      if (r < 0 || r >= reelCount) return [];
      const col = grid[r];
      if (!col) return [];
      if (rect.minRow < 0 || rect.maxRow >= col.length) return [];
    }

    const effects: Effect[] = [];
    for (let r = rect.minReel; r <= rect.maxReel; r++) {
      for (let row = rect.minRow; row <= rect.maxRow; row++) {
        if (r === ctx.reel && row === ctx.row) continue; // anchor already correct
        effects.push({ kind: 'transform_symbol', reel: r, row, toSymbol: fillSymbol });
      }
    }
    return effects;
  }

  private _computeRect(ctx: BehaviorContext): {
    minReel: number; maxReel: number; minRow: number; maxRow: number;
  } | null {
    const w = this._width;
    const h = this._height;
    let minReel: number, minRow: number;

    switch (this._anchor) {
      case 'top-left':
        minReel = ctx.reel;
        minRow = ctx.row;
        break;
      case 'top-right':
        minReel = ctx.reel - (w - 1);
        minRow = ctx.row;
        break;
      case 'bottom-left':
        minReel = ctx.reel;
        minRow = ctx.row - (h - 1);
        break;
      case 'bottom-right':
        minReel = ctx.reel - (w - 1);
        minRow = ctx.row - (h - 1);
        break;
      case 'center':
        minReel = ctx.reel - Math.floor((w - 1) / 2);
        minRow = ctx.row - Math.floor((h - 1) / 2);
        break;
      default:
        return null;
    }

    return {
      minReel,
      maxReel: minReel + w - 1,
      minRow,
      maxRow: minRow + h - 1,
    };
  }
}
