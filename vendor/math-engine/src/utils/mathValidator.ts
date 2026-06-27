/**
 * MATH VALIDATOR UTILITY
 *
 * Validira matematičku konzistentnost pre simulacije.
 * Hvata greške rano - pre nego što potrošiš sate na simulaciju.
 */

import { GAME_CONFIG } from '../config/gameConfig.js';
import { LINE_PAYTABLE, SCATTER_PAYTABLE } from '../model/paytable.js';
import { BASE_REELS, FREE_SPINS_REELS } from '../model/reels.js';
import { PAYLINES, NUM_REELS, NUM_ROWS } from '../model/paylines.js';
import { SymbolId, SYMBOL_DEFINITIONS, LP_SYMBOLS, HP_SYMBOLS } from '../model/symbols.js';
import { SYMBOL_ROLES, FEATURE_FLAGS, validateSymbolConfig } from '../config/symbolConfig.js';

// ============================================
// VALIDATION RESULT
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

// ============================================
// MAIN VALIDATOR
// ============================================

export function validateMath(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    info: []
  };

  // 1. Symbol config
  if (!validateSymbolConfig()) {
    result.errors.push('Symbol configuration invalid');
    result.valid = false;
  }

  // 2. Paytable validation
  validatePaytable(result);

  // 3. Reel strips validation
  validateReelStrips(result);

  // 4. Paylines validation
  validatePaylines(result);

  // 5. RTP budget validation
  validateRtpBudget(result);

  // 6. Feature config validation
  validateFeatureConfig(result);

  // 7. Caps validation
  validateCaps(result);

  return result;
}

// ============================================
// PAYTABLE VALIDATION
// ============================================

function validatePaytable(result: ValidationResult): void {
  // Check all paying symbols have paytable entries
  const paytableSymbols = new Set(LINE_PAYTABLE.map(p => p.symbol));

  for (const symbol of [...LP_SYMBOLS, ...HP_SYMBOLS]) {
    if (!paytableSymbols.has(symbol)) {
      result.errors.push(`Symbol ${symbol} missing from paytable`);
      result.valid = false;
    }
  }

  // Check pay values are reasonable
  for (const entry of LINE_PAYTABLE) {
    const { symbol, pays } = entry;

    // 3oak should be less than 4oak should be less than 5oak
    if (pays[3] >= pays[4] || pays[4] >= pays[5]) {
      result.errors.push(`${symbol}: Pay progression incorrect (${pays[3]} → ${pays[4]} → ${pays[5]})`);
      result.valid = false;
    }

    // LP should pay less than HP
    const def = SYMBOL_DEFINITIONS[symbol];
    if (def?.tier === 'LP' && pays[5] > 20) {
      result.warnings.push(`${symbol}: LP symbol pays ${pays[5]}x for 5oak (high for LP)`);
    }

    if (def?.tier === 'HP' && pays[5] < 20) {
      result.warnings.push(`${symbol}: HP symbol pays ${pays[5]}x for 5oak (low for HP)`);
    }

    // Check for 0 pays
    if (pays[3] === 0 || pays[4] === 0 || pays[5] === 0) {
      result.warnings.push(`${symbol}: Has 0 pay value`);
    }
  }

  // Check scatter pays
  for (const scatter of SCATTER_PAYTABLE) {
    if (scatter.pay <= 0) {
      result.errors.push(`Scatter ${scatter.count}x has no pay value`);
      result.valid = false;
    }
  }

  result.info.push(`Paytable: ${LINE_PAYTABLE.length} symbols, ${SCATTER_PAYTABLE.length} scatter pays`);
}

// ============================================
// REEL STRIPS VALIDATION
// ============================================

function validateReelStrips(result: ValidationResult): void {
  validateReelSet(BASE_REELS, 'Base Game', result);

  if (FEATURE_FLAGS.hasFreeSpins) {
    validateReelSet(FREE_SPINS_REELS, 'Free Spins', result);
  }
}

function validateReelSet(
  reels: SymbolId[][],
  name: string,
  result: ValidationResult
): void {
  // Check reel count
  if (reels.length !== NUM_REELS) {
    result.errors.push(`${name}: Expected ${NUM_REELS} reels, found ${reels.length}`);
    result.valid = false;
  }

  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];

    // Check strip length
    if (reel.length < 30) {
      result.warnings.push(`${name} Reel ${i + 1}: Strip length ${reel.length} is short`);
    }
    if (reel.length > 100) {
      result.warnings.push(`${name} Reel ${i + 1}: Strip length ${reel.length} is long`);
    }

    // Count symbols
    const counts: Record<string, number> = {};
    for (const symbol of reel) {
      counts[symbol] = (counts[symbol] || 0) + 1;
    }

    // Check scatter count (should be ~2 for typical 1/117-140 trigger)
    const scatterSymbol = SYMBOL_ROLES.scatter;
    const scatterCount = counts[scatterSymbol] || 0;
    if (scatterCount === 0) {
      result.warnings.push(`${name} Reel ${i + 1}: No scatter symbols`);
    } else if (scatterCount > 4) {
      result.warnings.push(`${name} Reel ${i + 1}: ${scatterCount} scatters (may trigger too often)`);
    }

    // Check wild count
    const wildSymbol = SYMBOL_ROLES.wild;
    const wildCount = counts[wildSymbol] || 0;
    const wildPercent = (wildCount / reel.length) * 100;
    if (wildPercent > 15) {
      result.warnings.push(`${name} Reel ${i + 1}: ${wildPercent.toFixed(1)}% wilds (may be too many)`);
    }

    // Check for missing symbols
    for (const symbol of [...LP_SYMBOLS, ...HP_SYMBOLS]) {
      if (!counts[symbol]) {
        result.warnings.push(`${name} Reel ${i + 1}: Missing symbol ${symbol}`);
      }
    }
  }

  result.info.push(`${name}: ${reels.length} reels validated`);
}

// ============================================
// PAYLINES VALIDATION
// ============================================

function validatePaylines(result: ValidationResult): void {
  // Check payline count
  if (PAYLINES.length === 0) {
    result.errors.push('No paylines defined');
    result.valid = false;
    return;
  }

  for (let i = 0; i < PAYLINES.length; i++) {
    const payline = PAYLINES[i];

    // Check length
    if (payline.length !== NUM_REELS) {
      result.errors.push(`Payline ${i + 1}: Wrong length (${payline.length} vs ${NUM_REELS})`);
      result.valid = false;
    }

    // Check row bounds
    for (let reel = 0; reel < payline.length; reel++) {
      if (payline[reel] < 0 || payline[reel] >= NUM_ROWS) {
        result.errors.push(`Payline ${i + 1}, Reel ${reel}: Invalid row ${payline[reel]}`);
        result.valid = false;
      }
    }
  }

  // Check for duplicate paylines
  const paylineStrings = PAYLINES.map(p => p.join(','));
  const uniquePaylines = new Set(paylineStrings);
  if (uniquePaylines.size < PAYLINES.length) {
    result.warnings.push(`Found ${PAYLINES.length - uniquePaylines.size} duplicate paylines`);
  }

  result.info.push(`Paylines: ${PAYLINES.length} lines on ${NUM_REELS}x${NUM_ROWS} grid`);
}

// ============================================
// RTP BUDGET VALIDATION
// ============================================

function validateRtpBudget(result: ValidationResult): void {
  const budget = GAME_CONFIG.rtpBudget;
  const target = GAME_CONFIG.targetRTP;

  const total = budget.baseGame + budget.freeSpins + budget.holdAndWin;

  if (Math.abs(total - target) > 0.02) {
    result.warnings.push(
      `RTP budget (${(total * 100).toFixed(1)}%) differs from target (${(target * 100).toFixed(1)}%)`
    );
  }

  // Check individual allocations
  if (budget.baseGame < 0.3) {
    result.warnings.push('Base game RTP < 30% - game may feel unrewarding');
  }

  if (budget.freeSpins > 0.4 && FEATURE_FLAGS.hasFreeSpins) {
    result.warnings.push('Free Spins RTP > 40% - feature dominates too much');
  }

  if (budget.holdAndWin > 0.4 && FEATURE_FLAGS.hasHoldAndWin) {
    result.warnings.push('Hold & Win RTP > 40% - feature dominates too much');
  }

  result.info.push(
    `RTP Budget: Base ${(budget.baseGame * 100).toFixed(0)}% + ` +
    `FS ${(budget.freeSpins * 100).toFixed(0)}% + ` +
    `H&W ${(budget.holdAndWin * 100).toFixed(0)}% = ${(total * 100).toFixed(0)}%`
  );
}

// ============================================
// FEATURE CONFIG VALIDATION
// ============================================

function validateFeatureConfig(result: ValidationResult): void {
  const fs = GAME_CONFIG.freeSpins;
  const hnw = GAME_CONFIG.holdAndWin;

  // Free Spins
  if (fs.enabled) {
    if (fs.scatter3Award <= 0) {
      result.errors.push('Free Spins enabled but no spins awarded for 3 scatters');
      result.valid = false;
    }

    if (fs.maxMultiplier < 1) {
      result.errors.push('Free Spins max multiplier must be >= 1');
      result.valid = false;
    }

    if (fs.maxRetriggers < 0) {
      result.errors.push('Free Spins max retriggers cannot be negative');
      result.valid = false;
    }

    result.info.push(
      `Free Spins: ${fs.scatter3Award}/${fs.scatter4Award}/${fs.scatter5Award} spins, ` +
      `max ${fs.maxMultiplier}x multiplier, ${fs.maxRetriggers} retriggers`
    );
  }

  // Hold & Win
  if (hnw.enabled) {
    if (hnw.triggerOrbCount < 3) {
      result.warnings.push('H&W trigger count < 3 may trigger too often');
    }

    if (hnw.triggerOrbCount > 8) {
      result.warnings.push('H&W trigger count > 8 may be too rare');
    }

    if (hnw.initialRespins < 1) {
      result.errors.push('H&W must have at least 1 respin');
      result.valid = false;
    }

    result.info.push(
      `Hold & Win: ${hnw.triggerOrbCount}+ orbs to trigger, ` +
      `${hnw.initialRespins} respins, ${hnw.fullGridBonus}x jackpot bonus`
    );
  }
}

// ============================================
// CAPS VALIDATION
// ============================================

function validateCaps(result: ValidationResult): void {
  const caps = GAME_CONFIG.caps;

  if (caps.maxWinMultiplier < 500) {
    result.warnings.push(`Max win cap ${caps.maxWinMultiplier}x is low for most markets`);
  }

  if (caps.maxWinMultiplier > 50000) {
    result.warnings.push(`Max win cap ${caps.maxWinMultiplier}x is very high - ensure proper validation`);
  }

  // Check max win vs paytable
  const maxPaytableWin = Math.max(...LINE_PAYTABLE.map(p => p.pays[5]));
  const maxWithPaylines = maxPaytableWin * PAYLINES.length;

  if (maxWithPaylines > caps.maxWinMultiplier * 0.5) {
    result.warnings.push(
      `Max base win (${maxWithPaylines.toFixed(0)}x) is >50% of max cap (${caps.maxWinMultiplier}x)`
    );
  }

  result.info.push(`Caps: Max win ${caps.maxWinMultiplier}x, Max FS ${caps.maxFreeSpinsFromRetrigger}`);
}

// ============================================
// PRINT VALIDATION REPORT
// ============================================

export function printValidationReport(result: ValidationResult): void {
  console.log('\n════════════════════════════════════════');
  console.log('         MATH VALIDATION REPORT');
  console.log('════════════════════════════════════════\n');

  // Errors
  if (result.errors.length > 0) {
    console.log('❌ ERRORS:');
    result.errors.forEach(e => console.log(`   ${e}`));
    console.log('');
  }

  // Warnings
  if (result.warnings.length > 0) {
    console.log('⚠️  WARNINGS:');
    result.warnings.forEach(w => console.log(`   ${w}`));
    console.log('');
  }

  // Info
  if (result.info.length > 0) {
    console.log('ℹ️  INFO:');
    result.info.forEach(i => console.log(`   ${i}`));
    console.log('');
  }

  // Final status
  console.log('────────────────────────────────────────');
  if (result.valid) {
    console.log('✅ VALIDATION PASSED');
    if (result.warnings.length > 0) {
      console.log(`   (${result.warnings.length} warnings - review recommended)`);
    }
  } else {
    console.log('❌ VALIDATION FAILED');
    console.log(`   Fix ${result.errors.length} error(s) before simulation`);
  }
  console.log('════════════════════════════════════════\n');
}

// ============================================
// CLI INTEGRATION
// ============================================

export function runValidation(): boolean {
  const result = validateMath();
  printValidationReport(result);
  return result.valid;
}
