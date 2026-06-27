/**
 * SLOT MATH ENGINE TEMPLATE - Symbol Configuration
 *
 * Central config for all symbol roles.
 * This enables the core engine to use generic references
 * instead of hardcoded theme-specific symbols.
 *
 * CUSTOMIZATION:
 * 1. Define your symbols in symbols.ts
 * 2. Update SYMBOL_ROLES with your symbol IDs
 * 3. Engine uses this config for evaluation
 */

import { SymbolId } from '../model/symbols.js';

// ============================================
// SYMBOL ROLES — Define which symbol has which role
// ============================================

export interface SymbolRoles {
  // Wild symbol that substitutes
  wild: SymbolId;

  // Scatter symbol that triggers Free Spins
  scatter: SymbolId;

  // Special symbol for Hold & Win (null if no H&W)
  special: SymbolId | null;

  // Highest paying symbol (for wild-only lines)
  topPaying: SymbolId;
}

/**
 * DEFAULT SYMBOL ROLES
 *
 * CHANGE THIS FOR YOUR GAME!
 *
 * Example for a themed game (rename SymbolId values to match your theme):
 * wild: SymbolId.<your-wild-id>,
 * scatter: SymbolId.<your-scatter-id>,
 * special: SymbolId.<your-special-id>,
 * topPaying: SymbolId.<your-top-pay-id>,
 */
export const SYMBOL_ROLES: SymbolRoles = {
  // Wild symbol
  wild: SymbolId.WILD,

  // Scatter (Free Spins trigger)
  scatter: SymbolId.SCATTER,

  // Special (Hold & Win trigger) — set to null if no H&W
  special: SymbolId.BONUS,

  // Top paying symbol (used for wild-only wins)
  topPaying: SymbolId.HP_1,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if symbol is wild
 */
export function isWild(symbol: SymbolId): boolean {
  return symbol === SYMBOL_ROLES.wild;
}

/**
 * Check if symbol is scatter
 */
export function isScatter(symbol: SymbolId): boolean {
  return symbol === SYMBOL_ROLES.scatter;
}

/**
 * Check if symbol is special (H&W trigger)
 */
export function isSpecial(symbol: SymbolId): boolean {
  return SYMBOL_ROLES.special !== null && symbol === SYMBOL_ROLES.special;
}

/**
 * Check if symbol is a regular paying symbol
 * (not wild, scatter, or special)
 */
export function isPayingSymbol(symbol: SymbolId): boolean {
  return !isWild(symbol) && !isScatter(symbol) && !isSpecial(symbol);
}

/**
 * Get wild symbol ID
 */
export function getWildSymbol(): SymbolId {
  return SYMBOL_ROLES.wild;
}

/**
 * Get scatter symbol ID
 */
export function getScatterSymbol(): SymbolId {
  return SYMBOL_ROLES.scatter;
}

/**
 * Get special symbol ID (or null if no H&W)
 */
export function getSpecialSymbol(): SymbolId | null {
  return SYMBOL_ROLES.special;
}

/**
 * Get top paying symbol (for wild-only lines)
 */
export function getTopPayingSymbol(): SymbolId {
  return SYMBOL_ROLES.topPaying;
}

// ============================================
// FEATURE FLAGS
// ============================================

export interface FeatureFlags {
  hasWild: boolean;
  hasScatter: boolean;
  hasFreeSpins: boolean;
  hasHoldAndWin: boolean;
  hasCollector: boolean;
  hasCascade: boolean;
  hasMultiplier: boolean;
}

/**
 * DEFAULT FEATURE FLAGS
 *
 * Set true/false for features your game has.
 */
export const FEATURE_FLAGS: FeatureFlags = {
  hasWild: true,
  hasScatter: true,
  hasFreeSpins: true,
  hasHoldAndWin: true,  // Set false if no H&W
  hasCollector: false,
  hasCascade: false,
  hasMultiplier: true,  // Progressive multiplier in FS
};

// ============================================
// VALIDATION
// ============================================

/**
 * Validate symbol config
 */
export function validateSymbolConfig(): boolean {
  const errors: string[] = [];

  // Check wild exists
  if (!SYMBOL_ROLES.wild) {
    errors.push('Wild symbol not defined');
  }

  // Check scatter exists if FS enabled
  if (FEATURE_FLAGS.hasFreeSpins && !SYMBOL_ROLES.scatter) {
    errors.push('Scatter symbol required for Free Spins');
  }

  // Check special exists if H&W enabled
  if (FEATURE_FLAGS.hasHoldAndWin && !SYMBOL_ROLES.special) {
    errors.push('Special symbol required for Hold & Win');
  }

  // Check top paying exists
  if (!SYMBOL_ROLES.topPaying) {
    errors.push('Top paying symbol not defined');
  }

  if (errors.length > 0) {
    console.error('Symbol config validation failed:');
    errors.forEach(e => console.error(`  - ${e}`));
    return false;
  }

  return true;
}

// ============================================
// USAGE EXAMPLE
// ============================================

/**
 * Usage example in evaluate.ts:
 *
 * import { isWild, isScatter, getWildSymbol } from '../config/symbolConfig.js';
 *
 * // Instead of:
 * if (symbol === SymbolId.WILD) { ... }
 *
 * // Use:
 * if (isWild(symbol)) { ... }
 *
 * // For wild-only lines:
 * const wildSymbol = getWildSymbol();
 */
