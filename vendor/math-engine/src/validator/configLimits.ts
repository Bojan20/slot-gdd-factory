/**
 * SLOT MATH EXACT - Configuration Size Limits
 *
 * Validates that game configurations stay within safe limits.
 * Prevents:
 * - Memory exhaustion from oversized configs
 * - Timeout issues from overly complex games
 * - DoS attacks via malicious configs
 *
 * Limits are based on industry standards and practical constraints.
 */

import type { GameConfig, ReelSet } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration limits
 */
export interface ConfigLimits {
  /** Maximum symbols allowed */
  maxSymbols: number;
  /** Maximum reel sets */
  maxReelSets: number;
  /** Maximum reels per set */
  maxReelsPerSet: number;
  /** Maximum symbols per reel strip */
  maxSymbolsPerReel: number;
  /** Maximum grid rows */
  maxGridRows: number;
  /** Maximum grid columns */
  maxGridColumns: number;
  /** Maximum paylines */
  maxPaylines: number;
  /** Maximum paytable entries */
  maxPaytableEntries: number;
  /** Maximum scatter pay entries */
  maxScatterPays: number;
  /** Maximum total cycle count (for enumeration) */
  maxTotalCycles: bigint;
  /** Maximum config JSON size (bytes) */
  maxConfigSizeBytes: number;
  /** Maximum free spins */
  maxFreeSpins: number;
  /** Maximum multiplier */
  maxMultiplier: number;
  /** Maximum retriggers */
  maxRetriggers: number;
  /** Maximum cascade levels */
  maxCascades: number;
}

/**
 * Limit check result
 */
export interface LimitCheckResult {
  /** Check name */
  name: string;
  /** Current value */
  current: number | bigint;
  /** Limit value */
  limit: number | bigint;
  /** Passed check */
  passed: boolean;
  /** Usage percentage (0-100+) */
  usagePercent: number;
  /** Warning if approaching limit */
  warning?: string;
}

/**
 * Configuration limits validation result
 */
export interface ConfigLimitsResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Individual checks */
  checks: LimitCheckResult[];
  /** Failed checks */
  failures: LimitCheckResult[];
  /** Warnings (approaching limits) */
  warnings: LimitCheckResult[];
  /** Estimated complexity */
  complexity: ConfigComplexity;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Configuration complexity estimate
 */
export interface ConfigComplexity {
  /** Total cycle count */
  totalCycles: bigint;
  /** Estimated calculation time (seconds) */
  estimatedTimeSeconds: number;
  /** Memory estimate (MB) */
  estimatedMemoryMB: number;
  /** Complexity rating */
  rating: 'TRIVIAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'EXTREME';
  /** Recommendation */
  recommendation: 'EXACT' | 'SIMULATION' | 'HYBRID';
}

// ============================================================================
// DEFAULT LIMITS
// ============================================================================

/**
 * Default conservative limits
 */
export const DEFAULT_LIMITS: ConfigLimits = {
  maxSymbols: 50,
  maxReelSets: 10,
  maxReelsPerSet: 10,
  maxSymbolsPerReel: 500,
  maxGridRows: 10,
  maxGridColumns: 10,
  maxPaylines: 100,
  maxPaytableEntries: 100,
  maxScatterPays: 10,
  maxTotalCycles: 10n ** 15n,  // 1 quadrillion
  maxConfigSizeBytes: 10 * 1024 * 1024,  // 10 MB
  maxFreeSpins: 1000,
  maxMultiplier: 100000,
  maxRetriggers: 100,
  maxCascades: 100
};

/**
 * Strict limits for production
 */
export const STRICT_LIMITS: ConfigLimits = {
  maxSymbols: 30,
  maxReelSets: 5,
  maxReelsPerSet: 7,
  maxSymbolsPerReel: 200,
  maxGridRows: 7,
  maxGridColumns: 7,
  maxPaylines: 50,
  maxPaytableEntries: 50,
  maxScatterPays: 5,
  maxTotalCycles: 10n ** 12n,  // 1 trillion
  maxConfigSizeBytes: 1 * 1024 * 1024,  // 1 MB
  maxFreeSpins: 500,
  maxMultiplier: 50000,
  maxRetriggers: 50,
  maxCascades: 50
};

/**
 * Relaxed limits for testing
 */
export const RELAXED_LIMITS: ConfigLimits = {
  maxSymbols: 100,
  maxReelSets: 20,
  maxReelsPerSet: 15,
  maxSymbolsPerReel: 1000,
  maxGridRows: 15,
  maxGridColumns: 15,
  maxPaylines: 200,
  maxPaytableEntries: 200,
  maxScatterPays: 20,
  maxTotalCycles: 10n ** 18n,  // 1 quintillion
  maxConfigSizeBytes: 50 * 1024 * 1024,  // 50 MB
  maxFreeSpins: 5000,
  maxMultiplier: 500000,
  maxRetriggers: 500,
  maxCascades: 500
};

// ============================================================================
// LIMIT VALIDATOR
// ============================================================================

/**
 * Validate configuration against limits
 */
export function validateConfigLimits(
  config: GameConfig,
  limits: ConfigLimits = DEFAULT_LIMITS
): ConfigLimitsResult {
  const checks: LimitCheckResult[] = [];
  const failures: LimitCheckResult[] = [];
  const warnings: LimitCheckResult[] = [];

  // Symbol count
  checks.push(checkLimit('Symbols', config.symbols.length, limits.maxSymbols));

  // Reel sets
  checks.push(checkLimit('Reel Sets', config.reelSets.length, limits.maxReelSets));

  // Reels per set
  const maxReels = Math.max(...config.reelSets.map(rs => rs.reels.length));
  checks.push(checkLimit('Reels Per Set', maxReels, limits.maxReelsPerSet));

  // Symbols per reel
  const maxSymbolsPerReel = Math.max(
    ...config.reelSets.flatMap(rs => rs.reels.map(r => r.symbols.length))
  );
  checks.push(checkLimit('Symbols Per Reel', maxSymbolsPerReel, limits.maxSymbolsPerReel));

  // Grid size
  checks.push(checkLimit('Grid Rows', config.grid.rows, limits.maxGridRows));
  checks.push(checkLimit('Grid Columns', config.grid.cols, limits.maxGridColumns));

  // Paylines
  if (config.paylines) {
    checks.push(checkLimit('Paylines', config.paylines.length, limits.maxPaylines));
  }

  // Paytable entries
  checks.push(checkLimit('Paytable Entries', config.paytable.length, limits.maxPaytableEntries));

  // Scatter pays
  if (config.scatterPays) {
    checks.push(checkLimit('Scatter Pays', config.scatterPays.length, limits.maxScatterPays));
  }

  // Total cycles
  const totalCycles = calculateTotalCycles(config);
  checks.push(checkBigIntLimit('Total Cycles', totalCycles, limits.maxTotalCycles));

  // Config size
  const configSize = JSON.stringify(config).length;
  checks.push(checkLimit('Config Size (bytes)', configSize, limits.maxConfigSizeBytes));

  // Free spins
  if (config.freeSpins?.enabled) {
    const maxSpins = Math.max(
      ...Object.values(config.freeSpins.triggerCounts).map(tc => tc.spins)
    );
    checks.push(checkLimit('Max Free Spins', maxSpins, limits.maxFreeSpins));
  }

  // Multiplier
  if (config.freeSpins?.maxMultiplier) {
    checks.push(checkLimit('Max Multiplier', config.freeSpins.maxMultiplier, limits.maxMultiplier));
  }

  // Max win multiplier
  checks.push(checkLimit('Max Win Multiplier', config.maxWinMultiplier, limits.maxMultiplier));

  // Retriggers
  if (config.freeSpins?.maxRetriggers !== undefined) {
    checks.push(checkLimit('Max Retriggers', config.freeSpins.maxRetriggers, limits.maxRetriggers));
  }

  // Cascades
  checks.push(checkLimit('Max Cascades', config.maxCascades, limits.maxCascades));

  // Categorize results
  for (const check of checks) {
    if (!check.passed) {
      failures.push(check);
    } else if (check.usagePercent > 80) {
      check.warning = `Approaching limit (${check.usagePercent.toFixed(1)}% used)`;
      warnings.push(check);
    }
  }

  // Calculate complexity
  const complexity = estimateComplexity(config, totalCycles);

  // Generate recommendations
  const recommendations: string[] = [];

  if (failures.length > 0) {
    recommendations.push('Reduce configuration size to meet limits');
  }

  if (complexity.rating === 'EXTREME') {
    recommendations.push('Configuration too complex for exact calculation - use simulation');
  } else if (complexity.rating === 'VERY_HIGH') {
    recommendations.push('Consider hybrid approach or simulation for faster results');
  }

  if (warnings.length > 0) {
    recommendations.push('Some values approaching limits - consider optimization');
  }

  return {
    passed: failures.length === 0,
    checks,
    failures,
    warnings,
    complexity,
    recommendations
  };
}

/**
 * Check a numeric limit
 */
function checkLimit(name: string, current: number, limit: number): LimitCheckResult {
  const passed = current <= limit;
  const usagePercent = (current / limit) * 100;

  return {
    name,
    current,
    limit,
    passed,
    usagePercent
  };
}

/**
 * Check a bigint limit
 */
function checkBigIntLimit(name: string, current: bigint, limit: bigint): LimitCheckResult {
  const passed = current <= limit;
  const usagePercent = Number((current * 100n) / limit);

  return {
    name,
    current,
    limit,
    passed,
    usagePercent
  };
}

/**
 * Calculate total cycle count
 */
function calculateTotalCycles(config: GameConfig): bigint {
  const baseReelSet = config.reelSets.find(rs => rs.id === config.baseGameReelSetId);
  if (!baseReelSet) return 0n;

  let total = 1n;
  for (const reel of baseReelSet.reels) {
    total *= BigInt(reel.symbols.length);
  }

  return total;
}

/**
 * Estimate configuration complexity
 */
function estimateComplexity(config: GameConfig, totalCycles: bigint): ConfigComplexity {
  // Time estimate: ~1M cycles/second on modern hardware
  const cyclesPerSecond = 1_000_000n;
  const estimatedTimeSeconds = Number(totalCycles / cyclesPerSecond);

  // Memory estimate: ~100 bytes per unique win combination
  // Rough estimate based on typical win distributions
  const estimatedWinCombinations = Math.min(
    Number(totalCycles / 100n),
    1_000_000
  );
  const estimatedMemoryMB = (estimatedWinCombinations * 100) / (1024 * 1024);

  // Rating
  let rating: ConfigComplexity['rating'];
  let recommendation: ConfigComplexity['recommendation'];

  if (totalCycles < 1_000_000n) {
    rating = 'TRIVIAL';
    recommendation = 'EXACT';
  } else if (totalCycles < 1_000_000_000n) {
    rating = 'LOW';
    recommendation = 'EXACT';
  } else if (totalCycles < 1_000_000_000_000n) {
    rating = 'MEDIUM';
    recommendation = 'EXACT';
  } else if (totalCycles < 1_000_000_000_000_000n) {
    rating = 'HIGH';
    recommendation = 'HYBRID';
  } else if (totalCycles < 1_000_000_000_000_000_000n) {
    rating = 'VERY_HIGH';
    recommendation = 'SIMULATION';
  } else {
    rating = 'EXTREME';
    recommendation = 'SIMULATION';
  }

  return {
    totalCycles,
    estimatedTimeSeconds,
    estimatedMemoryMB,
    rating,
    recommendation
  };
}

// ============================================================================
// SANITIZATION
// ============================================================================

/**
 * Sanitize configuration to meet limits
 */
export function sanitizeConfig(
  config: GameConfig,
  limits: ConfigLimits = DEFAULT_LIMITS
): { sanitized: GameConfig; changes: string[] } {
  const changes: string[] = [];
  const sanitized = JSON.parse(JSON.stringify(config)) as GameConfig;

  // Truncate symbols
  if (sanitized.symbols.length > limits.maxSymbols) {
    const removed = sanitized.symbols.length - limits.maxSymbols;
    sanitized.symbols = sanitized.symbols.slice(0, limits.maxSymbols);
    changes.push(`Removed ${removed} symbols (exceeded limit)`);
  }

  // Truncate reel sets
  if (sanitized.reelSets.length > limits.maxReelSets) {
    const removed = sanitized.reelSets.length - limits.maxReelSets;
    sanitized.reelSets = sanitized.reelSets.slice(0, limits.maxReelSets);
    changes.push(`Removed ${removed} reel sets (exceeded limit)`);
  }

  // Truncate reel strips
  for (const reelSet of sanitized.reelSets) {
    for (const reel of reelSet.reels) {
      if (reel.symbols.length > limits.maxSymbolsPerReel) {
        const removed = reel.symbols.length - limits.maxSymbolsPerReel;
        reel.symbols = reel.symbols.slice(0, limits.maxSymbolsPerReel);
        changes.push(`Truncated reel ${reel.id} by ${removed} symbols`);
      }
    }
  }

  // Truncate paylines
  if (sanitized.paylines && sanitized.paylines.length > limits.maxPaylines) {
    const removed = sanitized.paylines.length - limits.maxPaylines;
    sanitized.paylines = sanitized.paylines.slice(0, limits.maxPaylines);
    changes.push(`Removed ${removed} paylines (exceeded limit)`);
  }

  // Cap multiplier
  if (sanitized.maxWinMultiplier > limits.maxMultiplier) {
    sanitized.maxWinMultiplier = limits.maxMultiplier;
    changes.push(`Capped max win multiplier to ${limits.maxMultiplier}`);
  }

  // Cap cascades
  if (sanitized.maxCascades > limits.maxCascades) {
    sanitized.maxCascades = limits.maxCascades;
    changes.push(`Capped max cascades to ${limits.maxCascades}`);
  }

  return { sanitized, changes };
}

// ============================================================================
// REPORT
// ============================================================================

/**
 * Generate limits report
 */
export function generateLimitsReport(result: ConfigLimitsResult): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    '                CONFIGURATION LIMITS REPORT',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Status: ${result.passed ? '✓ WITHIN LIMITS' : '✗ EXCEEDS LIMITS'}`,
    '',
    '───────────────────────────────────────────────────────────────',
    'COMPLEXITY ASSESSMENT',
    '───────────────────────────────────────────────────────────────',
    `Total Cycles: ${result.complexity.totalCycles.toLocaleString()}`,
    `Complexity Rating: ${result.complexity.rating}`,
    `Estimated Time: ${formatTime(result.complexity.estimatedTimeSeconds)}`,
    `Estimated Memory: ${result.complexity.estimatedMemoryMB.toFixed(1)} MB`,
    `Recommended Approach: ${result.complexity.recommendation}`,
    ''
  ];

  if (result.failures.length > 0) {
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('FAILED CHECKS');
    lines.push('───────────────────────────────────────────────────────────────');

    for (const check of result.failures) {
      lines.push(`✗ ${check.name}: ${formatValue(check.current)} > ${formatValue(check.limit)} (${check.usagePercent.toFixed(1)}%)`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('WARNINGS');
    lines.push('───────────────────────────────────────────────────────────────');

    for (const check of result.warnings) {
      lines.push(`⚠ ${check.name}: ${formatValue(check.current)} / ${formatValue(check.limit)} (${check.usagePercent.toFixed(1)}%)`);
    }
    lines.push('');
  }

  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('ALL CHECKS');
  lines.push('───────────────────────────────────────────────────────────────');

  for (const check of result.checks) {
    const icon = check.passed ? '✓' : '✗';
    const bar = generateBar(check.usagePercent);
    lines.push(`${icon} ${check.name.padEnd(25)} ${bar} ${check.usagePercent.toFixed(1).padStart(6)}%`);
  }

  if (result.recommendations.length > 0) {
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('RECOMMENDATIONS');
    lines.push('───────────────────────────────────────────────────────────────');

    for (const rec of result.recommendations) {
      lines.push(`• ${rec}`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format a value for display
 */
function formatValue(value: number | bigint): string {
  if (typeof value === 'bigint') {
    return value.toLocaleString();
  }
  return value.toLocaleString();
}

/**
 * Format time in human-readable form
 */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} minutes`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

/**
 * Generate a progress bar
 */
function generateBar(percent: number): string {
  const width = 20;
  const filled = Math.min(width, Math.round((percent / 100) * width));
  const empty = width - filled;
  const overflowChar = percent > 100 ? '!' : '█';
  return '[' + overflowChar.repeat(filled) + '░'.repeat(empty) + ']';
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  validateConfigLimits as validate,
  sanitizeConfig as sanitize,
  generateLimitsReport as report,
  DEFAULT_LIMITS as defaultLimits,
  STRICT_LIMITS as strictLimits,
  RELAXED_LIMITS as relaxedLimits
};
