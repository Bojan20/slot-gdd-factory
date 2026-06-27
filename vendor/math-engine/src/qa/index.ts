/**
 * SLOT MATH EXACT - QA Tools Exports
 *
 * Using namespaced exports to avoid naming conflicts between modules.
 */

// Bias detection
export * as BiasDetection from './biasDetection.js';

// Near-miss detection (H1)
export * as NearMiss from './nearMissDetection.js';

// Session volatility (H2)
export * as SessionVolatility from './sessionVolatility.js';

// Max exposure tracking (H3)
export * as MaxExposure from './maxExposure.js';

// Reel entropy analysis (H5)
export * as ReelEntropy from './reelEntropy.js';

// Symbol correlation matrix (H6)
export * as SymbolCorrelation from './symbolCorrelation.js';
