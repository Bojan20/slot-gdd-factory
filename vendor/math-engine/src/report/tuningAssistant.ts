/**
 * SLOT MATH ENGINE TEMPLATE - Tuning Assistant
 *
 * Generates automatic tuning hints based on simulation results.
 * Helps non-mathematicians understand what to adjust.
 */

import { GAME_CONFIG } from '../config/gameConfig.js';
import { SimulationStatistics } from '../sim/accumulator.js';

export type HintSeverity = 'info' | 'warn' | 'critical';

export interface TuningHint {
  severity: HintSeverity;
  category: string;
  message: string;
  suggestion?: string;
}

export interface MathLockChecklist {
  rtpWithinTarget: boolean;
  ciCoversTarget: boolean;
  fsFrequencyOk: boolean;
  hnwFrequencyOk: boolean;
  hitRateOk: boolean;
  volatilityMeasured: boolean;
  maxWinObserved: boolean;
  spinsSufficient: boolean;
}

// Target ranges for high volatility slot
const TARGETS = {
  rtp: {
    target: GAME_CONFIG.targetRTP * 100,
    tolerance: 0.2,       // ±0.2% for warnings
    criticalTolerance: 0.5 // ±0.5% for critical
  },
  hitRate: {
    min: 18,
    max: 35,
    idealMin: 20,
    idealMax: 30
  },
  fsFrequency: {
    min: 120,
    max: 300,
    idealMin: 150,
    idealMax: 250
  },
  hnwFrequency: {
    min: 150,
    max: 400,
    idealMin: 200,
    idealMax: 300
  },
  maxWin: {
    warningThreshold: 500,
    highThreshold: 8000
  },
  minSpins: {
    quick: 500_000,
    standard: 20_000_000,
    production: 100_000_000
  }
};

/**
 * Generate tuning hints based on simulation results
 */
export function generateTuningHints(stats: SimulationStatistics): TuningHint[] {
  const hints: TuningHint[] = [];
  const targetRTP = TARGETS.rtp.target;

  // RTP Analysis
  const rtpDiff = stats.rtp.total - targetRTP;

  if (rtpDiff < -TARGETS.rtp.criticalTolerance) {
    hints.push({
      severity: 'critical',
      category: 'RTP',
      message: `RTP is significantly below target (${stats.rtp.total.toFixed(2)}% vs ${targetRTP.toFixed(2)}%)`,
      suggestion: 'Consider: increasing HP symbol frequency on reels, increasing paytable values, adding more Wild symbols, or increasing Multiplier Orb odds.'
    });
  } else if (rtpDiff < -TARGETS.rtp.tolerance) {
    hints.push({
      severity: 'warn',
      category: 'RTP',
      message: `RTP is below target (${stats.rtp.total.toFixed(2)}% vs ${targetRTP.toFixed(2)}%)`,
      suggestion: 'Consider: slightly increasing HP frequency or paytable values.'
    });
  } else if (rtpDiff > TARGETS.rtp.criticalTolerance) {
    hints.push({
      severity: 'critical',
      category: 'RTP',
      message: `RTP is significantly above target (${stats.rtp.total.toFixed(2)}% vs ${targetRTP.toFixed(2)}%)`,
      suggestion: 'Consider: reducing Orb multiplier odds, decreasing HP frequency, or lowering paytable values.'
    });
  } else if (rtpDiff > TARGETS.rtp.tolerance) {
    hints.push({
      severity: 'warn',
      category: 'RTP',
      message: `RTP is above target (${stats.rtp.total.toFixed(2)}% vs ${targetRTP.toFixed(2)}%)`,
      suggestion: 'Consider: slightly reducing HP frequency or Orb odds.'
    });
  } else {
    hints.push({
      severity: 'info',
      category: 'RTP',
      message: `RTP is within target range (${stats.rtp.total.toFixed(2)}% vs ${targetRTP.toFixed(2)}%)`,
    });
  }

  // Free Spins Frequency Analysis
  const fsFreq = stats.freeSpins.triggerRate;

  if (fsFreq < TARGETS.fsFrequency.min) {
    hints.push({
      severity: 'critical',
      category: 'Free Spins',
      message: `Free Spins trigger too frequently (1 in ${Math.round(fsFreq)})`,
      suggestion: 'For high volatility, reduce Scatter symbol stops on reels (especially middle reels 2-4).'
    });
  } else if (fsFreq < TARGETS.fsFrequency.idealMin) {
    hints.push({
      severity: 'warn',
      category: 'Free Spins',
      message: `Free Spins trigger frequently for high volatility (1 in ${Math.round(fsFreq)})`,
      suggestion: 'Consider reducing Scatter presence slightly for more volatility.'
    });
  } else if (fsFreq > TARGETS.fsFrequency.max) {
    hints.push({
      severity: 'warn',
      category: 'Free Spins',
      message: `Free Spins very rare (1 in ${Math.round(fsFreq)}). UX may feel dry.`,
      suggestion: 'Consider increasing Scatter symbol stops on middle reels.'
    });
  } else if (fsFreq > TARGETS.fsFrequency.idealMax) {
    hints.push({
      severity: 'info',
      category: 'Free Spins',
      message: `Free Spins are rare (1 in ${Math.round(fsFreq)}). Good for high volatility.`,
    });
  } else {
    hints.push({
      severity: 'info',
      category: 'Free Spins',
      message: `Free Spins frequency is in ideal range (1 in ${Math.round(fsFreq)})`,
    });
  }

  // Hit Rate Analysis
  if (stats.hitRate < TARGETS.hitRate.min) {
    hints.push({
      severity: 'warn',
      category: 'Hit Rate',
      message: `Hit rate very low (${stats.hitRate.toFixed(1)}%). Game may feel punishing.`,
      suggestion: 'Consider increasing LP symbol frequency or adding small pays.'
    });
  } else if (stats.hitRate > TARGETS.hitRate.max) {
    hints.push({
      severity: 'warn',
      category: 'Hit Rate',
      message: `Hit rate high (${stats.hitRate.toFixed(1)}%). Game may feel low-volatility.`,
      suggestion: 'Consider reducing LP frequency for more volatility.'
    });
  } else if (stats.hitRate < TARGETS.hitRate.idealMin || stats.hitRate > TARGETS.hitRate.idealMax) {
    hints.push({
      severity: 'info',
      category: 'Hit Rate',
      message: `Hit rate is ${stats.hitRate.toFixed(1)}% (ideal: ${TARGETS.hitRate.idealMin}-${TARGETS.hitRate.idealMax}%)`,
    });
  }

  // Hold & Win Frequency Analysis
  const hnwFreq = stats.holdAndWin.frequency;

  if (hnwFreq < TARGETS.hnwFrequency.min) {
    hints.push({
      severity: 'warn',
      category: 'Hold & Win',
      message: `Hold & Win triggers very frequently (1 in ${Math.round(hnwFreq)})`,
      suggestion: 'This may inflate RTP unpredictably. Consider reducing multiplier-orb stops on reels.'
    });
  } else if (hnwFreq > TARGETS.hnwFrequency.max) {
    hints.push({
      severity: 'info',
      category: 'Hold & Win',
      message: `Hold & Win is rare (1 in ${Math.round(hnwFreq)}). May want more for excitement.`,
    });
  } else {
    hints.push({
      severity: 'info',
      category: 'Hold & Win',
      message: `Hold & Win frequency is in ideal range (1 in ${Math.round(hnwFreq)})`,
    });
  }

  // Max Win Analysis
  if (stats.extremes.maxWin < TARGETS.maxWin.warningThreshold) {
    hints.push({
      severity: 'info',
      category: 'Max Win',
      message: `Max win not yet observed at high levels (${stats.extremes.maxWin.toFixed(0)}x). May require more spins.`,
      suggestion: 'Run more spins (100M+) or check if multiplier potential supports target max win.'
    });
  } else if (stats.extremes.maxWin > TARGETS.maxWin.highThreshold) {
    hints.push({
      severity: 'warn',
      category: 'Max Win',
      message: `Very high win observed (${stats.extremes.maxWin.toFixed(0)}x). Check exposure.`,
      suggestion: 'Verify win caps are correctly applied. Consider if this is acceptable for business.'
    });
  }

  // Spins Sufficiency
  if (stats.spinCount < TARGETS.minSpins.quick) {
    hints.push({
      severity: 'warn',
      category: 'Sample Size',
      message: `Very few spins (${stats.spinCount.toLocaleString()}). Results are unreliable.`,
      suggestion: 'Run at least 500K spins for rough guidance, 20M for decisions.'
    });
  } else if (stats.spinCount < TARGETS.minSpins.standard) {
    hints.push({
      severity: 'info',
      category: 'Sample Size',
      message: `Sample size is ${stats.spinCount.toLocaleString()}. Good for rough tuning.`,
      suggestion: 'Run 20M+ spins before making final decisions.'
    });
  }

  // CI Width Analysis
  if (stats.rtp.ci95Margin > 0.5) {
    hints.push({
      severity: 'warn',
      category: 'Confidence',
      message: `Confidence interval is wide (±${stats.rtp.ci95Margin.toFixed(2)}%). Results uncertain.`,
      suggestion: 'Run more spins to narrow the confidence interval.'
    });
  }

  return hints;
}

/**
 * Generate Math Lock Checklist
 */
export function generateMathLockChecklist(stats: SimulationStatistics): MathLockChecklist {
  const targetRTP = TARGETS.rtp.target;

  return {
    rtpWithinTarget: Math.abs(stats.rtp.total - targetRTP) <= 0.1,
    ciCoversTarget: stats.rtp.ci95Low <= targetRTP && targetRTP <= stats.rtp.ci95High,
    fsFrequencyOk: stats.freeSpins.triggerRate >= TARGETS.fsFrequency.idealMin &&
                   stats.freeSpins.triggerRate <= TARGETS.fsFrequency.idealMax,
    hnwFrequencyOk: stats.holdAndWin.frequency >= TARGETS.hnwFrequency.idealMin &&
                    stats.holdAndWin.frequency <= TARGETS.hnwFrequency.idealMax,
    hitRateOk: stats.hitRate >= TARGETS.hitRate.idealMin &&
               stats.hitRate <= TARGETS.hitRate.idealMax,
    volatilityMeasured: stats.volatility.class.length > 0,
    maxWinObserved: stats.extremes.maxWin >= TARGETS.maxWin.warningThreshold,
    spinsSufficient: stats.spinCount >= TARGETS.minSpins.standard
  };
}

/**
 * Format hints for console output
 */
export function formatHintsForConsole(hints: TuningHint[]): string {
  const lines: string[] = [];

  const severityIcons: Record<HintSeverity, string> = {
    critical: '❌',
    warn: '⚠️ ',
    info: 'ℹ️ '
  };

  for (const hint of hints) {
    const icon = severityIcons[hint.severity];
    lines.push(`${icon} [${hint.category}] ${hint.message}`);
    if (hint.suggestion) {
      lines.push(`   → ${hint.suggestion}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format Math Lock Checklist for console
 */
export function formatChecklistForConsole(checklist: MathLockChecklist): string {
  const lines: string[] = [];

  const check = (value: boolean, label: string) => {
    const icon = value ? '✅' : '⬜';
    lines.push(`${icon} ${label}`);
  };

  check(checklist.rtpWithinTarget, 'RTP within ±0.1% of target');
  check(checklist.ciCoversTarget, '95% CI covers target');
  check(checklist.fsFrequencyOk, 'FS frequency in ideal band');
  check(checklist.hnwFrequencyOk, 'H&W frequency reasonable (200-300)');
  check(checklist.hitRateOk, 'Hit rate in ideal range');
  check(checklist.volatilityMeasured, 'Volatility classified');
  check(checklist.maxWinObserved, 'Max win 500x+ observed');
  check(checklist.spinsSufficient, 'Sufficient spins (20M+)');

  return lines.join('\n');
}

/**
 * Check if math is ready for lock
 */
export function isMathLockReady(checklist: MathLockChecklist): boolean {
  return Object.values(checklist).every(v => v === true);
}
