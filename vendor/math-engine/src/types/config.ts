/**
 * SLOT MATH EXACT - Configuration Types
 *
 * Generic configuration schema for ANY slot game type.
 * Supports:
 * - Line pay (L→R, R→L, Both)
 * - Ways to win (fixed e.g. 243/1024 or variable per spin)
 * - Cluster pay
 * - All feature types
 */

import { z } from 'zod';

// ============================================================================
// SYMBOL DEFINITIONS
// ============================================================================

/**
 * Symbol role in the game
 */
export const SymbolRoleSchema = z.enum([
  'LOW_PAY',      // Low paying symbols (cards, etc.)
  'HIGH_PAY',     // High paying symbols (thematic)
  'WILD',         // Wild symbol (substitutes)
  'SCATTER',      // Scatter (pays anywhere, triggers features)
  'BONUS',        // Bonus symbol (triggers bonus games)
  'MULTIPLIER',   // Multiplier symbol
  'COLLECTOR',    // Collector symbol (Hold & Win)
  'MYSTERY',      // Mystery/transform symbol
  'BLANK',        // Empty/blank position
  'SPECIAL'       // Other special symbols
]);

export type SymbolRole = z.infer<typeof SymbolRoleSchema>;

/**
 * Wild symbol variant
 */
export const WildTypeSchema = z.enum([
  'STANDARD',     // Regular wild
  'MULTIPLIER',   // Wild with multiplier (x2, x3, etc.)
  'STACKED',      // Stacked wild (fills reel)
  'EXPANDING',    // Expands to fill reel
  'WALKING',      // Moves each spin
  'STICKY',       // Stays for multiple spins
  'RANDOM',       // Appears randomly
  'COLOSSAL'      // 2x2 or larger wild
]);

export type WildType = z.infer<typeof WildTypeSchema>;

/**
 * Single symbol definition
 */
export const SymbolDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: SymbolRoleSchema,
  wildType: WildTypeSchema.optional(),
  multiplier: z.number().positive().optional(),  // For multiplier wilds
  substitutes: z.array(z.string()).optional(),   // What symbols this wild can replace
  canBeSubstituted: z.boolean().default(true)    // Can wilds substitute for this?
});

export type SymbolDef = z.infer<typeof SymbolDefSchema>;

// ============================================================================
// PAYTABLE DEFINITIONS
// ============================================================================

/**
 * Pay entry for line/ways pay
 */
export const PayEntrySchema = z.object({
  symbolId: z.string(),
  pays: z.record(z.string(), z.number().nonnegative())  // count -> multiplier
  // e.g., { "3": 0.5, "4": 1.5, "5": 5.0 }
});

export type PayEntry = z.infer<typeof PayEntrySchema>;

/**
 * Scatter pay entry
 */
export const ScatterPaySchema = z.object({
  symbolId: z.string(),
  pays: z.record(z.string(), z.object({
    pay: z.number().nonnegative(),
    freeSpinsAwarded: z.number().nonnegative().optional(),
    bonusAwarded: z.boolean().optional()
  }))
});

export type ScatterPay = z.infer<typeof ScatterPaySchema>;

// ============================================================================
// REEL DEFINITIONS
// ============================================================================

/**
 * Reel strip definition
 */
export const ReelStripSchema = z.object({
  id: z.string(),
  symbols: z.array(z.string()),     // Symbol IDs in order
  weights: z.array(z.number().positive()).optional()  // Optional weights (uniform if not specified)
});

export type ReelStrip = z.infer<typeof ReelStripSchema>;

/**
 * Reel set (collection of reel strips for a game state)
 */
export const ReelSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  reels: z.array(ReelStripSchema)
});

export type ReelSet = z.infer<typeof ReelSetSchema>;

// ============================================================================
// PAYLINE DEFINITIONS
// ============================================================================

/**
 * Payline definition - positions per reel
 */
export const PaylineSchema = z.object({
  id: z.number(),
  positions: z.array(z.number())  // Row index per reel (0-indexed)
});

export type Payline = z.infer<typeof PaylineSchema>;

// ============================================================================
// EVALUATION MODE
// ============================================================================

/**
 * Game evaluation type
 */
export const EvalTypeSchema = z.enum([
  'LINES_LTR',      // Line pay, left to right only
  'LINES_RTL',      // Line pay, right to left only
  'LINES_BOTH',     // Line pay, both directions
  'WAYS',           // Ways to win (243, 1024, etc.)
  'VARIABLE_WAYS',  // Variable per-reel symbol count → variable total ways per spin
  'CLUSTER',        // Cluster pay
  'ALL_WAYS',       // All ways (any adjacent)
  'HYBRID'          // Mixed evaluation
]);

export type EvalType = z.infer<typeof EvalTypeSchema>;

/**
 * Cluster pay configuration
 */
export const ClusterConfigSchema = z.object({
  minClusterSize: z.number().int().min(2),
  adjacency: z.enum(['ORTHOGONAL', 'DIAGONAL', 'BOTH']).default('ORTHOGONAL'),
  cascadeEnabled: z.boolean().default(false),
  cascadeMultiplierProgression: z.array(z.number()).optional()  // e.g., [1, 2, 3, 5, 10]
});

export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;

/**
 * Variable-ways configuration
 *
 * Each reel can land a variable number of symbol rows in a configured
 * range, so the total number of ways per spin equals the product of
 * per-reel row counts. Generic — no vendor naming.
 */
export const VariableWaysConfigSchema = z.object({
  minSymbolsPerReel: z.number().int().min(2),
  maxSymbolsPerReel: z.number().int().max(10),
  reelWeights: z.array(z.record(z.string(), z.number())).optional()  // Weights for each reel height
});

export type VariableWaysConfig = z.infer<typeof VariableWaysConfigSchema>;

// ============================================================================
// FEATURE DEFINITIONS
// ============================================================================

/**
 * Free spins feature configuration
 */
export const FreeSpinsConfigSchema = z.object({
  enabled: z.boolean(),
  triggerSymbol: z.string(),
  triggerCounts: z.record(z.string(), z.object({
    spins: z.number().int().positive(),
    pay: z.number().nonnegative().optional()
  })),
  reelSetId: z.string().optional(),  // Different reels during FS
  startMultiplier: z.number().positive().default(1),
  multiplierProgression: z.enum(['NONE', 'PER_SPIN', 'PER_WIN', 'PER_CASCADE']).default('NONE'),
  multiplierIncrements: z.array(z.number()).optional(),
  maxMultiplier: z.number().positive().optional(),
  retriggerEnabled: z.boolean().default(true),
  retriggerCounts: z.record(z.string(), z.number().int().positive()).optional(),
  maxRetriggers: z.number().int().nonnegative().optional()
});

export type FreeSpinsConfig = z.infer<typeof FreeSpinsConfigSchema>;

/**
 * Hold & Win / Respins feature configuration
 */
export const HoldAndWinConfigSchema = z.object({
  enabled: z.boolean(),
  triggerSymbol: z.string(),
  triggerCount: z.number().int().min(1),
  initialRespins: z.number().int().positive().default(3),
  respinsResetOnLand: z.boolean().default(true),
  /** Trigger probability (e.g., 1/192 = 0.0052). If not set, calculated from reels. */
  triggerProbability: z.number().min(0).max(1).optional(),
  /** Landing probability per empty position during respins (0.01 = 1%) */
  landingProbability: z.number().min(0).max(1).optional(),
  symbolValues: z.record(z.string(), z.object({
    weight: z.number().positive(),
    value: z.number().nonnegative()  // As bet multiplier
  })),
  jackpots: z.record(z.string(), z.object({
    condition: z.enum(['FULL_GRID', 'SYMBOL_COUNT', 'SPECIAL_SYMBOL']),
    value: z.number().nonnegative(),
    weight: z.number().positive().optional()
  })).optional(),
  stickyPositions: z.boolean().default(true),
  gridSize: z.object({
    rows: z.number().int().positive(),
    cols: z.number().int().positive()
  }).optional()
});

export type HoldAndWinConfig = z.infer<typeof HoldAndWinConfigSchema>;

/**
 * Gamble feature configuration
 */
export const GambleConfigSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(['CARD_COLOR', 'CARD_SUIT', 'COIN_FLIP', 'LADDER']),
  maxGambles: z.number().int().positive().optional(),
  maxWinMultiplier: z.number().positive().optional(),
  collectThreshold: z.number().nonnegative().optional()
});

export type GambleConfig = z.infer<typeof GambleConfigSchema>;

/**
 * Bonus buy configuration
 */
export const BonusBuyConfigSchema = z.object({
  enabled: z.boolean(),
  options: z.array(z.object({
    id: z.string(),
    name: z.string(),
    cost: z.number().positive(),  // As bet multiplier
    feature: z.string(),          // Feature ID to trigger
    guaranteedValue: z.number().optional()  // Optional guaranteed min value
  }))
});

export type BonusBuyConfig = z.infer<typeof BonusBuyConfigSchema>;

// ============================================================================
// GRID CONFIGURATION
// ============================================================================

/**
 * Grid layout configuration
 */
export const GridConfigSchema = z.object({
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  type: z.enum(['FIXED', 'VARIABLE', 'EXPANDING']).default('FIXED'),
  variableRowsPerCol: z.array(z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
    weights: z.record(z.string(), z.number()).optional()
  })).optional()
});

export type GridConfig = z.infer<typeof GridConfigSchema>;

// ============================================================================
// MAIN GAME CONFIGURATION
// ============================================================================

/**
 * Complete game configuration
 */
export const GameConfigSchema = z.object({
  // Metadata
  name: z.string(),
  version: z.string(),
  targetRTP: z.number().min(0.70).max(1.00),  // 70% - 100%

  // Grid
  grid: GridConfigSchema,

  // Symbols
  symbols: z.array(SymbolDefSchema),

  // Paytable
  paytable: z.array(PayEntrySchema),
  scatterPays: z.array(ScatterPaySchema).optional(),

  // Reels
  reelSets: z.array(ReelSetSchema),
  baseGameReelSetId: z.string(),

  // Evaluation
  evalType: EvalTypeSchema,
  paylines: z.array(PaylineSchema).optional(),  // Required for line pay
  clusterConfig: ClusterConfigSchema.optional(),  // Required for cluster
  variableWaysConfig: VariableWaysConfigSchema.optional(),  // Required for VARIABLE_WAYS

  // Features
  freeSpins: FreeSpinsConfigSchema.optional(),
  holdAndWin: HoldAndWinConfigSchema.optional(),
  gamble: GambleConfigSchema.optional(),
  bonusBuy: BonusBuyConfigSchema.optional(),

  // Limits
  maxWinMultiplier: z.number().positive().default(10000),
  maxCascades: z.number().int().positive().default(50)
});

export type GameConfig = z.infer<typeof GameConfigSchema>;

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Win result from evaluation
 */
export interface WinResult {
  type: 'LINE' | 'WAYS' | 'CLUSTER' | 'SCATTER' | 'FEATURE';
  symbolId: string;
  count: number;
  positions: Array<{ row: number; col: number }>;
  baseWin: number;            // Before multipliers
  multiplier: number;         // Applied multiplier
  totalWin: number;           // Final win amount
  paylineId?: number;         // For line wins
  isWild?: boolean;           // If wild substitution was used
  wildPositions?: Array<{ row: number; col: number }>;
}

/**
 * Spin result
 */
export interface SpinResult {
  grid: string[][];           // Symbol IDs in grid
  wins: WinResult[];
  totalWin: number;
  triggeredFeature?: 'FREE_SPINS' | 'HOLD_AND_WIN' | 'BONUS';
  multiplier: number;
}

/**
 * Feature result
 */
export interface FeatureResult {
  type: 'FREE_SPINS' | 'HOLD_AND_WIN' | 'BONUS';
  spins?: SpinResult[];
  totalWin: number;
  finalGrid?: string[][];
  multiplierReached?: number;
}

/**
 * Complete RTP calculation result
 */
export interface RTPResult {
  totalRTP: number;           // As decimal (e.g., 0.9608)
  baseGameRTP: number;
  freeSpinsRTP: number;
  holdAndWinRTP: number;
  bonusRTP: number;

  hitRate: number;            // Probability of any win
  volatility: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

  featureFrequencies: {
    freeSpins?: number;       // 1 in X spins
    holdAndWin?: number;
    bonus?: number;
  };

  maxWin: number;             // Maximum possible win multiplier

  // Detailed breakdown
  symbolContributions: Array<{
    symbolId: string;
    contribution: number;     // RTP contribution
    hitRate: number;
  }>;

  // Distribution data
  winDistribution: Array<{
    range: string;            // e.g., "0x", "0-1x", "1-2x"
    probability: number;
    rtpContribution: number;
  }>;

  // Cycle information
  totalCycles: bigint;
  cyclesCalculated: bigint;

  // Precision
  confidenceInterval?: {
    lower: number;
    upper: number;
  };

  // Statistical metrics (C1-C4)
  statistics?: {
    /** Variance of win distribution */
    variance: number;
    /** Standard deviation */
    standardDeviation: number;
    /** Coefficient of variation (σ/μ) */
    coefficientOfVariation: number;
    /** Skewness (asymmetry) */
    skewness: number;
    /** Kurtosis (tail heaviness) */
    kurtosis: number;
    /** Excess kurtosis (kurtosis - 3) */
    excessKurtosis: number;
    /** Volatility index (0-25+ scale) */
    volatilityIndex: number;
    /** Volatility category */
    volatilityCategory: string;
    /** Industry percentile (0-100) */
    industryPercentile: number;
  };

  // Calculation metadata
  calculationType?: 'EXACT' | 'SIMULATION' | 'HYBRID';
  calculationTimeMs?: number;

  // Simulation fallback warnings
  warnings?: Array<{
    code: 'SIMULATION_FALLBACK' | 'PARTIAL_CALCULATION' | 'TIMEOUT' | 'UNSUPPORTED_FEATURE';
    message: string;
    details?: string;
  }>;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
  }>;
  warnings: Array<{
    path: string;
    code: string;
    message: string;
  }>;
}
