/**
 * Faza 13.7 — Main converter entry point.
 *
 * Dispatches to the correct dialect normalizer then runs the generic
 * IR builder. Dialects are named by their structural shape, not by any
 * vendor product.
 */

import { normalizeReelStrips, normalizeReelWeightMap, normalizeWeightedPairs } from './dialects.js';
import { genericToIR } from './framework.js';
import type { ConversionResult, DialectId } from './types.js';

/**
 * Convert a raw proprietary game config to a USIF-compatible SlotGameIR.
 *
 * @param raw     The raw config object from the source system.
 * @param dialect One of 'reel_weight_map' | 'weighted_pairs' | 'reel_strips' | 'generic'.
 */
export function convertToUSIF(raw: Record<string, unknown>, dialect: DialectId): ConversionResult {
  switch (dialect) {
    case 'reel_weight_map': {
      const generic = normalizeReelWeightMap(raw);
      return genericToIR(generic, dialect);
    }
    case 'weighted_pairs': {
      const generic = normalizeWeightedPairs(raw);
      return genericToIR(generic, dialect);
    }
    case 'reel_strips': {
      const generic = normalizeReelStrips(raw);
      return genericToIR(generic, dialect);
    }
    default: {
      // Generic: pass raw through directly as GenericGameConfig
      return genericToIR(raw, dialect);
    }
  }
}
