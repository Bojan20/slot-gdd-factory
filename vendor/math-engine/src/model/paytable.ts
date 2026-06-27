/**
 * SLOT MATH ENGINE TEMPLATE - Paytable Definitions
 *
 * Paytable design philosophy:
 * - LP symbols: Low frequency wins, sustain base game cadence
 * - HP symbols: Premium pays, create excitement moments
 * - Scatter: Pays anywhere + triggers Free Spins (1 per reel max)
 *
 * All pays are expressed as multipliers of TOTAL BET
 *
 * Target RTP allocation:
 * - Base game: ~45%
 * - Free Spins: ~20%
 * - Hold & Win: ~31%
 * - Total: 96%
 *
 * CUSTOMIZATION:
 * 1. Adjust LINE_PAYTABLE values to tune base game RTP
 * 2. Adjust SCATTER_PAYTABLE for FS trigger rewards
 * 3. Run simulation to verify RTP after changes
 */

import { SymbolId } from './symbols.js';

export interface PaytableEntry {
  symbol: SymbolId;
  pays: {
    3: number;  // 3 of a kind
    4: number;  // 4 of a kind
    5: number;  // 5 of a kind
  };
}

export interface ScatterPayEntry {
  count: number;
  pay: number;          // Total bet multiplier
  freeSpinsAwarded: number;
}

/**
 * Line pays - expressed as total bet multipliers
 *
 * Pay philosophy:
 * - LP 3oak: 0.6-0.9x (sustain, frequent but small)
 * - LP 5oak: 5-9x (occasional nice hit)
 * - HP 3oak: 2-3x (excitement trigger)
 * - HP 5oak: 40-60x (premium moments)
 */
export const LINE_PAYTABLE: PaytableEntry[] = [
  // Low Pay Symbols
  {
    symbol: SymbolId.LP_1,
    pays: { 3: 0.9, 4: 2.9, 5: 8.8 }
  },
  {
    symbol: SymbolId.LP_2,
    pays: { 3: 0.9, 4: 2.9, 5: 8.8 }
  },
  {
    symbol: SymbolId.LP_3,
    pays: { 3: 0.8, 4: 2.2, 5: 7.3 }
  },
  {
    symbol: SymbolId.LP_4,
    pays: { 3: 0.8, 4: 2.2, 5: 7.3 }
  },
  {
    symbol: SymbolId.LP_5,
    pays: { 3: 0.6, 4: 1.8, 5: 4.9 }
  },

  // High Pay Symbols
  {
    symbol: SymbolId.HP_1,
    pays: { 3: 3.1, 4: 12.2, 5: 63.0 }  // Top paying symbol
  },
  {
    symbol: SymbolId.HP_2,
    pays: { 3: 2.2, 4: 8.8, 5: 44.0 }
  },
  {
    symbol: SymbolId.HP_3,
    pays: { 3: 2.0, 4: 7.3, 5: 39.0 }
  },

  // Wild pays as highest symbol
  {
    symbol: SymbolId.WILD,
    pays: { 3: 3.1, 4: 12.2, 5: 63.0 }
  }
];

/**
 * Scatter pays - total bet multipliers, pays anywhere
 * Also triggers Free Spins
 */
export const SCATTER_PAYTABLE: ScatterPayEntry[] = [
  { count: 3, pay: 2.0, freeSpinsAwarded: 8 },
  { count: 4, pay: 10.0, freeSpinsAwarded: 12 },
  { count: 5, pay: 50.0, freeSpinsAwarded: 15 }
];

/**
 * Get pay for a symbol and match count
 */
export function getLinePay(symbol: SymbolId, count: number): number {
  const entry = LINE_PAYTABLE.find(p => p.symbol === symbol);
  if (!entry) return 0;

  if (count === 3) return entry.pays[3];
  if (count === 4) return entry.pays[4];
  if (count === 5) return entry.pays[5];

  return 0;
}

/**
 * Get scatter pay and FS award for a given count
 */
export function getScatterResult(count: number): ScatterPayEntry | null {
  return SCATTER_PAYTABLE.find(s => s.count === count) || null;
}

/**
 * Build a lookup map for fast paytable access
 */
export type PaytableLookup = Map<SymbolId, { 3: number; 4: number; 5: number }>;

export function buildPaytableLookup(): PaytableLookup {
  const lookup: PaytableLookup = new Map();

  for (const entry of LINE_PAYTABLE) {
    lookup.set(entry.symbol, entry.pays);
  }

  return lookup;
}

// Pre-built lookup for performance
export const PAYTABLE_LOOKUP = buildPaytableLookup();
