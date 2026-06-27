/**
 * Faza 13.7 — Format Converter types.
 *
 * Common types shared across all dialect normalizers and the generic
 * conversion framework.
 */

import type { SlotGameIR } from '../ir/types.js';

export type DialectId = 'reel_weight_map' | 'weighted_pairs' | 'reel_strips' | 'generic' | string;

export interface ConversionWarning {
  field: string;
  message: string;
  originalValue?: unknown;
}

export interface ConversionResult {
  ir: SlotGameIR;
  dialect: DialectId;
  warnings: ConversionWarning[];
  lossyFields: string[];
  usifValid: boolean;
}

/**
 * Normalised intermediate config shared by all dialect normalizers.
 * All field names are canonical — dialects map their proprietary
 * names onto this shape before the generic converter builds a
 * SlotGameIR.
 */
export interface GenericGameConfig {
  gameId?: string;
  gameName?: string;
  gameVersion?: string;
  provider?: string;

  reels?: number;
  rows?: number;

  /** Array-of-objects form: [{id, isWild, isScatter}, ...] */
  symbolList?: Array<{ id: string; isWild?: boolean; isScatter?: boolean }>;
  /** Object form: { symbolId: { wild?, scatter? }, ... } */
  symbols?: Record<string, { wild?: boolean; scatter?: boolean }>;

  paytable?: Record<string, number[]>;
  pays?: Record<string, number[]>;

  /** Each element is a per-reel weight map: { symbolId: weight, ... } */
  reelWeights?: Record<string, number>[];
  /** Each element is a per-reel strip array */
  reelStrips?: string[][];
  /** Weighted-pairs shape: array of arrays of { symbol, weight } objects */
  weightedReels?: Array<Array<{ symbol: string; weight: number }>>;

  rtp?: number;
  paylines?: number[][] | number;

  minBet?: number;
  maxBet?: number;
  defaultBet?: number;

  hasFreeSpins?: boolean;
  freeSpinsCount?: number;
  hasWild?: boolean;
  hasScatter?: boolean;
  hasBuyFeature?: boolean;
  hasGamble?: boolean;
  hasCascade?: boolean;
  hasHoldAndWin?: boolean;

  [key: string]: unknown;
}
