/**
 * SLOT MATH ENGINE TEMPLATE — Symbol Definitions (P0 #2 final-close)
 *
 * Legacy `SymbolId` was a hard-typed string `enum` with 11 baked entries.
 * Operator who wanted a different theme (different IDs, more / fewer
 * symbols, kind dispatched at runtime) had to fork the file. That fork
 * point is the tech debt this module retires.
 *
 * What the new shape gives you:
 *
 *  - `SymbolId` is now a **plain string type** (`type SymbolId = string`)
 *    plus a `DEFAULT_SYMBOL_IDS` const object that documents the
 *    canonical template-default 11-symbol set. All call sites that used
 *    `SymbolId.LP_1` still resolve at runtime via `DEFAULT_SYMBOL_IDS.LP_1`
 *    because the `SymbolId` identifier is re-exported as a value alias.
 *  - The default 11-symbol set is **opt-in**, not enforced. A game
 *    that loads via the IR pipeline (`parseGameIR` → `runIRSimulation`)
 *    populates `SYMBOL_DEFINITIONS` from `ir.symbols`, not from this
 *    constant table. See `loadSymbolsFromIR(ir)` below.
 *  - The `enum` syntax is gone — there is no more nominal type that
 *    blocks an operator's arbitrary string id from being treated as a
 *    valid symbol. Any string is a `SymbolId`.
 *
 * Customization:
 *  - **IR path (recommended):** describe the game's symbols in the IR
 *    JSON and load via `loadSymbolsFromIR(ir)`. No edits to this file.
 *  - **Template path (legacy):** extend `DEFAULT_SYMBOL_IDS` and the
 *    `DEFAULT_SYMBOL_DEFINITIONS` table below. The template ships an
 *    11-symbol baseline so the default fixtures still simulate.
 */

import type { SlotGameIR, Symbol as IRSymbolDef } from '../ir/types.js';

/** A symbol id is a free-form string — derived from the IR at runtime. */
export type SymbolId = string;

/**
 * Canonical template-default symbol identifiers.
 *
 * `as const` keeps each value a literal-string type so existing call
 * sites that wrote `SymbolId.LP_1` still type-check (the namespace
 * lookup resolves to the literal `'LP_1'`).
 */
export const DEFAULT_SYMBOL_IDS = {
  // Low Pay Symbols (LP) - Theme artifacts/items
  LP_1: 'LP_1',       // Generic low-paying symbol slot 1
  LP_2: 'LP_2',       // Generic low-paying symbol slot 2
  LP_3: 'LP_3',       // Generic low-paying symbol slot 3
  LP_4: 'LP_4',       // Generic low-paying symbol slot 4
  LP_5: 'LP_5',       // Generic low-paying symbol slot 5

  // High Pay Symbols (HP) — assign per-game theme via config, not enum
  HP_1: 'HP_1',       // Top paying high-pay symbol
  HP_2: 'HP_2',       // Second-tier high-pay symbol (third high-pay symbol)
  HP_3: 'HP_3',       // Third high-pay symbol

  // Special Symbols
  WILD: 'WILD',       // Wild - substitutes all except Scatter & Special
  SCATTER: 'SCATTER', // Scatter - triggers Free Spins
  BONUS: 'BONUS',     // Special - Hold & Win trigger + cash values
} as const;

/**
 * Backwards-compatible alias.
 *
 * `SymbolId.LP_1` (member access) still resolves to `'LP_1'`. The
 * companion type is a free-form string — the engine accepts any id
 * the IR declares.
 */
export const SymbolId = DEFAULT_SYMBOL_IDS;

export interface SymbolDefinition {
  id: SymbolId;
  name: string;
  tier: 'LP' | 'HP' | 'WILD' | 'SCATTER' | 'SPECIAL';
  description: string;
  substitutes: boolean;        // Can substitute for other symbols
  canBeSubstituted: boolean;   // Can be substituted by Wild
  appearsOnReels: number[];    // Which reels (0-4) this symbol can appear on
}

export const DEFAULT_SYMBOL_DEFINITIONS: Record<SymbolId, SymbolDefinition> = {
  // Low Pay Symbols
  [SymbolId.LP_1]: {
    id: SymbolId.LP_1,
    name: 'LP1',
    tier: 'LP',
    description: 'Low pay symbol 1',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.LP_2]: {
    id: SymbolId.LP_2,
    name: 'LP2',
    tier: 'LP',
    description: 'Low pay symbol 2',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.LP_3]: {
    id: SymbolId.LP_3,
    name: 'LP3',
    tier: 'LP',
    description: 'Low pay symbol 3',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.LP_4]: {
    id: SymbolId.LP_4,
    name: 'LP4',
    tier: 'LP',
    description: 'Low pay symbol 4',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.LP_5]: {
    id: SymbolId.LP_5,
    name: 'LP5',
    tier: 'LP',
    description: 'Low pay symbol 5',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },

  // High Pay Symbols
  [SymbolId.HP_1]: {
    id: SymbolId.HP_1,
    name: 'HP1',
    tier: 'HP',
    description: 'Top paying symbol',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.HP_2]: {
    id: SymbolId.HP_2,
    name: 'HP2',
    tier: 'HP',
    description: 'High pay symbol 2',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.HP_3]: {
    id: SymbolId.HP_3,
    name: 'HP3',
    tier: 'HP',
    description: 'High pay symbol 3',
    substitutes: false,
    canBeSubstituted: true,
    appearsOnReels: [0, 1, 2, 3, 4]
  },

  // Special Symbols
  [SymbolId.WILD]: {
    id: SymbolId.WILD,
    name: 'Wild',
    tier: 'WILD',
    description: 'Substitutes all except Scatter & Special',
    substitutes: true,
    canBeSubstituted: false,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.SCATTER]: {
    id: SymbolId.SCATTER,
    name: 'Scatter',
    tier: 'SCATTER',
    description: 'Triggers Free Spins, pays anywhere',
    substitutes: false,
    canBeSubstituted: false,
    appearsOnReels: [0, 1, 2, 3, 4]
  },
  [SymbolId.BONUS]: {
    id: SymbolId.BONUS,
    name: 'Bonus',
    tier: 'SPECIAL',
    description: 'Hold & Win trigger, carries cash value',
    substitutes: false,
    canBeSubstituted: false,
    appearsOnReels: [0, 1, 2, 3, 4]
  }
};

// Back-compat alias so the rest of the codebase keeps reading
// `SYMBOL_DEFINITIONS` while the canonical name is now
// `DEFAULT_SYMBOL_DEFINITIONS`. New code should prefer the explicit
// "DEFAULT_" name (and ideally the IR-derived loader below) so it's
// obvious which definitions are template defaults vs runtime-loaded.
export const SYMBOL_DEFINITIONS = DEFAULT_SYMBOL_DEFINITIONS;

// Helper arrays for quick lookups (template-default set).
export const LP_SYMBOLS: SymbolId[] = [
  SymbolId.LP_1,
  SymbolId.LP_2,
  SymbolId.LP_3,
  SymbolId.LP_4,
  SymbolId.LP_5,
];

export const HP_SYMBOLS: SymbolId[] = [
  SymbolId.HP_1,
  SymbolId.HP_2,
  SymbolId.HP_3,
];

export const PAYING_SYMBOLS: SymbolId[] = [...LP_SYMBOLS, ...HP_SYMBOLS];

export const ALL_SYMBOLS: SymbolId[] = Object.values(DEFAULT_SYMBOL_IDS);

/**
 * Build a `SymbolDefinition`-shaped registry from an IR document.
 *
 * Use this in production over the template-default set — the IR is
 * the canonical source of truth for which symbols exist, what each
 * one substitutes for, and on which reels it can land.
 *
 * The output is `Record<SymbolId, SymbolDefinition>` so it slots in
 * everywhere `SYMBOL_DEFINITIONS` is used today.
 */
export function loadSymbolsFromIR(ir: SlotGameIR): Record<SymbolId, SymbolDefinition> {
  const out: Record<SymbolId, SymbolDefinition> = {};
  const reelCount =
    ir.topology.kind === 'rectangular'
      ? ir.topology.reels
      : ir.topology.kind === 'variable_rows'
        ? ir.topology.reels
        : ir.topology.kind === 'cluster_grid'
          ? ir.topology.columns
          : 5;
  const allReels = Array.from({ length: reelCount }, (_, i) => i);
  for (const sym of ir.symbols as IRSymbolDef[]) {
    const tier = mapIRKindToTier(sym.kind);
    const substitutes = sym.kind === 'wild';
    const canBeSubstituted =
      sym.kind === 'lp' || sym.kind === 'hp' || sym.kind === 'multiplier';
    out[sym.id] = {
      id: sym.id,
      name: sym.name ?? sym.id,
      tier,
      description: `${sym.kind} symbol (IR-derived)`,
      substitutes,
      canBeSubstituted,
      appearsOnReels: allReels,
    };
  }
  return out;
}

function mapIRKindToTier(kind: string): SymbolDefinition['tier'] {
  switch (kind) {
    case 'lp':
      return 'LP';
    case 'hp':
      return 'HP';
    case 'wild':
      return 'WILD';
    case 'scatter':
      return 'SCATTER';
    default:
      return 'SPECIAL';
  }
}

/**
 * Check if a symbol can substitute for another.
 *
 * Looks up by id in `DEFAULT_SYMBOL_DEFINITIONS`. Pass an explicit
 * `defs` argument to use an IR-derived registry instead.
 */
export function canSubstitute(
  substitutor: SymbolId,
  target: SymbolId,
  defs: Record<SymbolId, SymbolDefinition> = DEFAULT_SYMBOL_DEFINITIONS,
): boolean {
  const substitutorDef = defs[substitutor];
  const targetDef = defs[target];
  if (!substitutorDef || !targetDef) return false;
  return substitutorDef.substitutes && targetDef.canBeSubstituted;
}

/**
 * Check if two symbols match (considering wild substitution).
 *
 * Pass `defs` for an IR-derived registry; otherwise falls back to the
 * template-default definitions.
 */
export function symbolsMatch(
  a: SymbolId,
  b: SymbolId,
  defs: Record<SymbolId, SymbolDefinition> = DEFAULT_SYMBOL_DEFINITIONS,
): boolean {
  if (a === b) return true;
  if (canSubstitute(a, b, defs)) return true;
  if (canSubstitute(b, a, defs)) return true;
  return false;
}
