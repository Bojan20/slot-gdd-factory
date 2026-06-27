/**
 * SLOT MATH ENGINE TEMPLATE - Zod Validation Schemas
 *
 * TypeScript-first schema validation using Zod.
 * Provides:
 * - Runtime validation with detailed errors
 * - Automatic TypeScript type inference
 * - Fail-fast validation before simulation
 *
 * Usage:
 *   const result = GameConfigSchema.safeParse(config);
 *   if (!result.success) console.log(result.error.issues);
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// VOLATILITY & BASICS
// ═══════════════════════════════════════════════════════════════════════════

export const VolatilitySchema = z.enum(['low', 'medium', 'high', 'extreme']);

// ═══════════════════════════════════════════════════════════════════════════
// FREE SPINS CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export const FreeSpinsConfigSchema = z.object({
  scatter3Award: z.number().int().min(1).max(50),
  scatter4Award: z.number().int().min(1).max(100),
  scatter5Award: z.number().int().min(1).max(200),
  globalMultiplierStart: z.number().min(1).max(10),
  globalMultiplierIncrement: z.number().min(0).max(5),
  maxRetriggers: z.number().int().min(0).max(50)
}).refine(
  (data) => data.scatter3Award < data.scatter4Award && data.scatter4Award < data.scatter5Award,
  { message: 'Free spins awards must increase with scatter count' }
);

// ═══════════════════════════════════════════════════════════════════════════
// MULTIPLIER ORB CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export const MultiplierOrbConfigSchema = z.object({
  possibleValues: z.array(z.number().min(1)).min(1),
  weights: z.array(z.number().min(0)).min(1)
}).refine(
  (data) => data.possibleValues.length === data.weights.length,
  { message: 'Multiplier values and weights arrays must have same length' }
);

// ═══════════════════════════════════════════════════════════════════════════
// CAPS CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export const CapsConfigSchema = z.object({
  maxWinMultiplier: z.number().min(100).max(100000),
  maxTotalMultiplier: z.number().min(1).max(10000),
  maxFreeSpinsFromRetrigger: z.number().int().min(1).max(1000)
});

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATION CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export const SimulationDefaultsSchema = z.object({
  defaultSpins: z.number().int().min(1000).max(10_000_000_000),
  quickSpins: z.number().int().min(1000).max(100_000_000),
  fullSpins: z.number().int().min(1_000_000).max(10_000_000_000)
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GAME CONFIG SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const GameConfigSchema = z.object({
  // Meta
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  mathVersion: z.string().min(1),

  // Layout
  numReels: z.number().int().min(3).max(10),
  numRows: z.number().int().min(1).max(10),
  numPaylines: z.number().int().min(1).max(500),

  // Targets
  targetRTP: z.number().min(0.80).max(1.0),
  targetVolatility: VolatilitySchema,
  maxWinMultiplier: z.number().min(100).max(100000),

  // Bet
  defaultBet: z.number().positive(),
  minBet: z.number().positive(),
  maxBet: z.number().positive(),

  // Features
  freeSpins: FreeSpinsConfigSchema,
  multiplierOrb: MultiplierOrbConfigSchema,
  caps: CapsConfigSchema,
  simulation: SimulationDefaultsSchema
}).refine(
  (data) => data.minBet <= data.defaultBet && data.defaultBet <= data.maxBet,
  { message: 'Bet range must satisfy: minBet <= defaultBet <= maxBet' }
).refine(
  (data) => data.caps.maxWinMultiplier <= data.maxWinMultiplier * 1.1,
  { message: 'Cap should match target max win' }
);

// ═══════════════════════════════════════════════════════════════════════════
// PAYTABLE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const SymbolPaySchema = z.object({
  symbol: z.string().min(1),
  pays: z.record(z.string(), z.number().min(0))
});

export const PaytableSchema = z.array(SymbolPaySchema);

// ═══════════════════════════════════════════════════════════════════════════
// REEL STRIP SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const ReelStripSchema = z.array(z.string().min(1)).min(10);

export const ReelStripsSchema = z.array(ReelStripSchema).min(3).max(10);

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATION INPUT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const SimulationInputSchema = z.object({
  spins: z.number().int().min(1000).max(10_000_000_000),
  seed: z.number().int().optional(),
  bet: z.number().positive().default(1),
  workers: z.number().int().min(1).max(64).optional(),
  mode: z.enum(['base', 'fs', 'full']).default('full'),
  progressInterval: z.number().int().positive().optional()
});

// ═══════════════════════════════════════════════════════════════════════════
// SIM REPORT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const SimReportSchema = z.object({
  schemaVersion: z.string(),
  game: z.object({
    name: z.string(),
    version: z.string(),
    mathVersion: z.string(),
    layout: z.string(),
    targetRTP: z.number(),
    targetVolatility: VolatilitySchema,
    maxWin: z.number()
  }),
  simulation: z.object({
    spins: z.number().int(),
    seed: z.number().int().optional(),
    workers: z.number().int(),
    mode: z.string(),
    engineVersion: z.string(),
    configHash: z.string(),
    durationMs: z.number()
  }),
  results: z.object({
    observedRTP: z.number(),
    rtpCI: z.object({
      lower: z.number(),
      upper: z.number(),
      confidence: z.number()
    }),
    hitRate: z.number(),
    avgWinOnHit: z.number(),
    volatilityIndex: z.number(),
    maxObservedWin: z.number()
  }),
  // HDR Histogram percentiles (precise tail distribution)
  percentiles: z.object({
    p50: z.number().describe('Median win multiplier'),
    p75: z.number().describe('75th percentile'),
    p90: z.number().describe('90th percentile'),
    p95: z.number().describe('95th percentile'),
    p99: z.number().describe('99th percentile'),
    p99_9: z.number().describe('99.9th percentile'),
    p99_99: z.number().describe('99.99th percentile (extreme tail)')
  }),
  // Tail bucket counts
  tailBuckets: z.object({
    ge10x: z.number().int().describe('Count of wins >= 10x'),
    ge50x: z.number().int().describe('Count of wins >= 50x'),
    ge100x: z.number().int().describe('Count of wins >= 100x'),
    ge200x: z.number().int().describe('Count of wins >= 200x'),
    ge500x: z.number().int().describe('Count of wins >= 500x'),
    ge1000x: z.number().int().describe('Count of wins >= 1000x')
  }),
  features: z.object({
    freeSpins: z.object({
      triggerRate: z.number(),
      avgSpinsPerSession: z.number(),
      avgWinPerSession: z.number(),
      rtpContribution: z.number()
    }),
    multiplierOrb: z.object({
      hitRate: z.number(),
      avgMultiplier: z.number()
    })
  }),
  histogram: z.array(z.object({
    range: z.string(),
    count: z.number(),
    percentage: z.number()
  })),
  topWins: z.array(z.object({
    spinIndex: z.number(),
    win: z.number(),
    isFS: z.boolean()
  })),
  mathLockChecklist: z.object({
    rtpInRange: z.boolean(),
    hitRateAcceptable: z.boolean(),
    maxWinReasonable: z.boolean(),
    fsFrequencyOk: z.boolean(),
    noAnomalies: z.boolean()
  }).optional(),
  tuningHints: z.array(z.string()).optional()
});

// ═══════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export type Volatility = z.infer<typeof VolatilitySchema>;
export type FreeSpinsConfig = z.infer<typeof FreeSpinsConfigSchema>;
export type MultiplierOrbConfig = z.infer<typeof MultiplierOrbConfigSchema>;
export type CapsConfig = z.infer<typeof CapsConfigSchema>;
export type GameConfig = z.infer<typeof GameConfigSchema>;
export type SimulationInput = z.infer<typeof SimulationInputSchema>;
export type SimReport = z.infer<typeof SimReportSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate game config with detailed error messages
 */
export function validateGameConfig(config: unknown): {
  success: boolean;
  data?: GameConfig;
  errors?: string[];
  warnings?: string[];
} {
  const result = GameConfigSchema.safeParse(config);
  const warnings: string[] = [];

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    };
  }

  const data = result.data;

  // Generate warnings
  if (data.targetRTP < 0.92) {
    warnings.push('RTP below 92% may not be legal in some jurisdictions');
  }
  if (data.targetRTP > 0.99) {
    warnings.push('RTP above 99% leaves very thin margin');
  }
  if (data.targetVolatility === 'extreme' && data.maxWinMultiplier < 5000) {
    warnings.push('Extreme volatility typically requires max win >= 5000x');
  }

  // Check multiplier weights sum
  const weightSum = data.multiplierOrb.weights.reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 100) > 0.01) {
    warnings.push(`Multiplier weights sum to ${weightSum}, consider normalizing to 100`);
  }

  return {
    success: true,
    data,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Validate simulation input
 */
export function validateSimulationInput(input: unknown): {
  success: boolean;
  data?: SimulationInput;
  errors?: string[];
} {
  const result = SimulationInputSchema.safeParse(input);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    };
  }

  return {
    success: true,
    data: result.data
  };
}

/**
 * Validate reel strips against symbol list
 */
export function validateReelStrips(
  strips: unknown,
  validSymbols: string[]
): {
  success: boolean;
  errors?: string[];
  warnings?: string[];
} {
  const result = ReelStripsSchema.safeParse(strips);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    };
  }

  const data = result.data;
  const symbolSet = new Set(validSymbols);

  // Check each reel
  for (let i = 0; i < data.length; i++) {
    const strip = data[i];

    if (strip.length < 20) {
      warnings.push(`Reel ${i} has only ${strip.length} stops (short)`);
    }

    // Check symbols exist
    for (const sym of strip) {
      if (!symbolSet.has(sym)) {
        errors.push(`Unknown symbol "${sym}" in reel ${i}`);
      }
    }
  }

  return {
    success: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Quick validation that throws on error
 */
export function assertValidConfig(config: unknown): GameConfig {
  const result = validateGameConfig(config);
  if (!result.success) {
    throw new Error(`Invalid config: ${result.errors?.join(', ')}`);
  }
  return result.data!;
}
