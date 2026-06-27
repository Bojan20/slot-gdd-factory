/**
 * SLOT MATH ENGINE TEMPLATE - Game Configuration
 *
 * Hold & Win + Free Spins dual feature system.
 * Central configuration file for all game parameters.
 *
 * CUSTOMIZATION:
 * 1. Update name and version for your game
 * 2. Adjust RTP targets and feature parameters
 * 3. Run simulation to verify RTP after changes
 */

import { NUM_PAYLINES, NUM_REELS, NUM_ROWS } from '../model/paylines.js';

export interface GameConfig {
  // Meta
  name: string;
  version: string;
  mathVersion: string;

  // Layout
  numReels: number;
  numRows: number;
  numPaylines: number;

  // Targets
  targetRTP: number;
  targetVolatility: 'low' | 'medium' | 'high' | 'extreme';
  maxWinMultiplier: number;

  // Bet
  defaultBet: number;
  minBet: number;
  maxBet: number;

  // Free Spins (scatter triggered, 1 scatter per reel max)
  freeSpins: {
    enabled: boolean;
    scatter3Award: number;
    scatter4Award: number;
    scatter5Award: number;
    progressiveMultiplier: boolean;  // +1x each spin without win
    maxMultiplier: number;
    maxRetriggers: number;
  };

  // Hold & Win
  holdAndWin: {
    enabled: boolean;
    triggerOrbCount: number;         // 5+ special symbols to trigger
    initialRespins: number;          // 3 respins
    fullGridBonus: number;           // +1000x for full grid
  };

  // Win Caps
  caps: {
    maxWinMultiplier: number;
    maxFreeSpinsFromRetrigger: number;
  };

  // RTP Budget allocation
  rtpBudget: {
    baseGame: number;      // Target 45%
    freeSpins: number;     // Target 20%
    holdAndWin: number;    // Target 31%
  };

  // Simulation defaults
  simulation: {
    defaultSpins: number;
    quickSpins: number;
    fullSpins: number;
  };
}

export const GAME_CONFIG: GameConfig = {
  // Meta
  name: 'Slot Math Engine Template',
  version: '1.0.0',
  mathVersion: 'v1.0.0',

  // Layout
  numReels: NUM_REELS,
  numRows: NUM_ROWS,
  numPaylines: NUM_PAYLINES,

  // Targets
  targetRTP: 0.96,  // 96.00%
  targetVolatility: 'high',
  maxWinMultiplier: 2500,  // 2500x target (H&W focused)

  // Bet (normalized to 1.0 for calculations)
  defaultBet: 1.0,
  minBet: 0.10,
  maxBet: 100.0,

  // Free Spins configuration
  freeSpins: {
    enabled: true,
    scatter3Award: 8,
    scatter4Award: 12,
    scatter5Award: 15,
    progressiveMultiplier: true,  // +1x each spin without win, reset on win
    maxMultiplier: 10,
    maxRetriggers: 5              // Safety cap
  },

  // Hold & Win configuration
  holdAndWin: {
    enabled: true,
    triggerOrbCount: 5,           // 5+ special symbols (industry standard)
    initialRespins: 3,            // 3 respins, reset on new symbol
    fullGridBonus: 1000           // +1000x for full 15/15 grid
  },

  // Win Caps (safety limits)
  caps: {
    maxWinMultiplier: 2500,       // Hard cap at 2500x
    maxFreeSpinsFromRetrigger: 50 // Max FS accumulation
  },

  // RTP Budget allocation (targets, validated by simulation)
  rtpBudget: {
    baseGame: 0.45,    // 45% from base game line wins
    freeSpins: 0.20,   // 20% from Free Spins feature
    holdAndWin: 0.31   // 31% from Hold & Win feature
  },

  // Simulation defaults
  simulation: {
    defaultSpins: 20_000_000,    // 20M for normal runs
    quickSpins: 1_000_000,       // 1M for quick checks
    fullSpins: 100_000_000       // 100M for certification
  }
};

/**
 * Get free spins awarded for scatter count
 */
export function getFreeSpinsAward(scatterCount: number): number {
  const config = GAME_CONFIG.freeSpins;

  if (!config.enabled) return 0;

  switch (scatterCount) {
    case 3: return config.scatter3Award;
    case 4: return config.scatter4Award;
    case 5: return config.scatter5Award;
    default: return 0;
  }
}

/**
 * Check if H&W should trigger based on orb count
 */
export function shouldTriggerHnW(orbCount: number): boolean {
  return GAME_CONFIG.holdAndWin.enabled &&
         orbCount >= GAME_CONFIG.holdAndWin.triggerOrbCount;
}

/**
 * Validate configuration
 */
export function validateConfig(): boolean {
  const config = GAME_CONFIG;

  // Check RTP budget sums to ~96%
  const rtpSum = config.rtpBudget.baseGame +
                 config.rtpBudget.freeSpins +
                 config.rtpBudget.holdAndWin;
  if (Math.abs(rtpSum - config.targetRTP) > 0.01) {
    console.warn(`RTP budget sums to ${(rtpSum * 100).toFixed(2)}%, target is ${(config.targetRTP * 100).toFixed(2)}%`);
  }

  // Check caps
  if (config.caps.maxWinMultiplier < 1000) {
    console.warn('Max win multiplier seems low for high volatility');
  }

  // Check H&W trigger
  if (config.holdAndWin.enabled && config.holdAndWin.triggerOrbCount < 5) {
    console.warn('H&W trigger count < 5 may be too frequent');
  }

  return true;
}

// Export singleton
export default GAME_CONFIG;
