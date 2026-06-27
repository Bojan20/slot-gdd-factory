/**
 * SLOT MATH ENGINE TEMPLATE - Slot Math Simulator
 *
 * Production-grade Monte Carlo simulator with:
 * - Multi-threaded parallel execution
 * - Streaming statistics (no memory blowup)
 * - Deterministic reproducibility
 * - Comprehensive reporting
 */

import { cpus } from 'os';
import { parseArgs, formatArgs, CLIArgs } from './cli/args.js';
import { GAME_CONFIG } from './config/gameConfig.js';
import { validatePaylines } from './model/paylines.js';
import { validateReels } from './model/reels.js';
import { runParallelSimulation, SimulationProgress } from './sim/parallel.js';
import { saveReports } from './report/reporter.js';
import { checksumObject } from './utils/hash.js';
import {
  generateTuningHints,
  generateMathLockChecklist,
  formatHintsForConsole,
  formatChecklistForConsole,
  isMathLockReady
} from './report/tuningAssistant.js';
import { SimulationStatistics } from './sim/accumulator.js';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function printBanner(): void {
  console.log(`
${colors.cyan}╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🎰 SLOT MATH ENGINE TEMPLATE                           ║
║   v1.0.0 - Production-Grade Simulator                    ║
║                                                          ║
║   Multi-threaded Monte Carlo                             ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝${colors.reset}
`);
}

function printConfig(args: CLIArgs): void {
  console.log(`${colors.yellow}📋 CONFIGURATION${colors.reset}`);
  console.log('────────────────────────────────────────');
  console.log(`  Game:        ${GAME_CONFIG.name}`);
  console.log(`  Version:     ${GAME_CONFIG.version}`);
  console.log(`  Layout:      ${GAME_CONFIG.numReels}x${GAME_CONFIG.numRows}`);
  console.log(`  Paylines:    ${GAME_CONFIG.numPaylines}`);
  console.log(`  Target RTP:  ${(GAME_CONFIG.targetRTP * 100).toFixed(2)}%`);
  console.log(`  Volatility:  ${GAME_CONFIG.targetVolatility}`);
  console.log(`  Max Win:     ${GAME_CONFIG.maxWinMultiplier}x`);
  console.log('');
  console.log(`${colors.blue}⚙️  SIMULATION SETTINGS${colors.reset}`);
  console.log('────────────────────────────────────────');
  console.log(`  Spins:       ${args.spins.toLocaleString()}`);
  console.log(`  Seed:        ${args.seed}`);
  console.log(`  Workers:     ${args.workers} / ${cpus().length} cores`);
  console.log(`  Mode:        ${args.mode}`);
  console.log(`  Bet:         ${args.bet}`);
  console.log(`  Output:      ${args.out}`);
  console.log('');
}

function validateConfiguration(): boolean {
  console.log(`${colors.dim}🔍 Running pre-simulation validation...${colors.reset}\n`);

  let valid = true;

  // Validate game config
  if (GAME_CONFIG.targetRTP < 0 || GAME_CONFIG.targetRTP > 1) {
    console.error(`${colors.red}❌ Invalid target RTP: ${GAME_CONFIG.targetRTP}${colors.reset}`);
    valid = false;
  } else {
    console.log(`${colors.green}✅ Game config valid${colors.reset}`);
  }

  // Validate paylines
  if (!validatePaylines()) {
    console.error(`${colors.red}❌ Payline validation failed${colors.reset}`);
    valid = false;
  } else {
    console.log(`${colors.green}✅ Paylines valid${colors.reset}`);
  }

  // Validate reels
  if (!validateReels()) {
    console.error(`${colors.red}❌ Reel strip validation failed${colors.reset}`);
    valid = false;
  } else {
    console.log(`${colors.green}✅ Reel strips valid${colors.reset}`);
  }

  console.log('');
  return valid;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

let lastProgressLine = '';

function printProgress(progress: SimulationProgress): void {
  const pct = progress.percentComplete.toFixed(1);
  const rtp = progress.currentRtp.toFixed(3);
  const speed = formatNumber(progress.spinsPerSecond);
  const eta = formatTime(progress.estimatedRemainingMs);

  const line = `   Progress: ${pct}% | RTP: ${rtp}% | Speed: ${speed}/s | ETA: ${eta}`;

  // Clear previous line and print new
  process.stdout.write('\r' + ' '.repeat(lastProgressLine.length) + '\r');
  process.stdout.write(line);
  lastProgressLine = line;
}

async function main(): Promise<void> {
  printBanner();

  // Parse CLI arguments
  const args = parseArgs();

  // Print configuration
  printConfig(args);

  // Validate before running
  if (!validateConfiguration()) {
    console.error(`${colors.red}❌ Validation failed. Aborting simulation.${colors.reset}`);
    process.exit(1);
  }

  // Start simulation
  console.log(`${colors.magenta}🎰 Starting Parallel Simulation${colors.reset}`);
  console.log('────────────────────────────────────────');
  console.log(`   Spins: ${args.spins.toLocaleString()}`);
  console.log(`   Seed: ${args.seed}`);
  console.log(`   Workers: ${args.workers}`);
  console.log(`   Target RTP: ${(GAME_CONFIG.targetRTP * 100).toFixed(2)}%`);
  console.log('');

  const startTime = Date.now();

  try {
    const result = await runParallelSimulation({
      totalSpins: args.spins,
      bet: args.bet,
      baseSeed: args.seed,
      workerCount: args.workers,
      mode: args.mode,
      onProgress: printProgress
    });

    // Clear progress line
    process.stdout.write('\n\n');

    const stats = result.statistics;

    console.log(`${colors.green}✅ Simulation Complete${colors.reset}`);
    console.log(`   Time: ${formatTime(result.elapsedMs)}`);
    console.log(`   Speed: ${formatNumber(result.spinsPerSecond)} spins/sec`);
    console.log('');

    // Print results
    console.log(`${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`  ${colors.bright}SLOT MATH ENGINE TEMPLATE - SIMULATION RESULTS${colors.reset}`);
    console.log(`${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log('');

    console.log(`${colors.yellow}📊 OVERALL PERFORMANCE${colors.reset}`);
    console.log('────────────────────────────────────────');
    console.log(`  Spins Simulated:  ${stats.spinCount.toLocaleString()}`);
    console.log(`  Target RTP:       ${(GAME_CONFIG.targetRTP * 100).toFixed(2)}%`);
    console.log(`  Observed RTP:     ${stats.rtp.total.toFixed(4)}% ± ${stats.rtp.ci95Margin.toFixed(4)}%`);
    console.log(`  95% CI:           [${stats.rtp.ci95Low.toFixed(4)}% - ${stats.rtp.ci95High.toFixed(4)}%]`);
    console.log(`  Hit Rate:         ${stats.hitRate.toFixed(2)}%`);
    console.log(`  Dead Spin Rate:   ${stats.deadSpinRate.toFixed(2)}%`);
    console.log('');

    console.log(`${colors.yellow}💰 RTP BREAKDOWN${colors.reset}`);
    console.log('────────────────────────────────────────');
    console.log(`  Base Line Wins:   ${stats.rtp.base.toFixed(4)}%`);
    console.log(`  Scatter Wins:     ${stats.rtp.scatter.toFixed(4)}%`);
    console.log(`  Free Spins:       ${stats.rtp.freeSpins.toFixed(4)}%`);
    console.log(`  Hold & Win:       ${stats.rtp.holdAndWin.toFixed(4)}%`);
    console.log('');

    console.log(`${colors.yellow}🎰 FEATURES${colors.reset}`);
    console.log('────────────────────────────────────────');
    console.log(`  FS Trigger:       1 in ${Math.round(stats.freeSpins.triggerRate)} spins`);
    console.log(`  Avg FS Spins:     ${stats.freeSpins.avgSpins.toFixed(1)}`);
    console.log(`  Avg FS Win:       ${stats.freeSpins.avgWin.toFixed(2)}x`);
    console.log(`  Retrigger Rate:   ${stats.freeSpins.retriggerRate.toFixed(2)}%`);
    console.log(`  Max FS Mult:      ${stats.freeSpins.maxMultiplier}x`);
    console.log(`  H&W Frequency:    1 in ${Math.round(stats.holdAndWin.frequency)} spins`);
    console.log(`  Avg H&W Win:      ${stats.holdAndWin.avgWin.toFixed(2)}x`);
    console.log(`  Full Grid Rate:   ${stats.holdAndWin.fullGridJackpotRate.toFixed(4)}%`);
    console.log('');

    console.log(`${colors.yellow}📈 VOLATILITY${colors.reset}`);
    console.log('────────────────────────────────────────');
    console.log(`  Std Deviation:    ${stats.volatility.stdDev.toFixed(4)}`);
    console.log(`  Volatility Index: ${stats.volatility.index.toFixed(2)}`);
    console.log(`  Classification:   ${stats.volatility.class}`);
    console.log('');

    console.log(`${colors.yellow}🏆 TAIL & EXTREMES${colors.reset}`);
    console.log('────────────────────────────────────────');
    console.log(`  Max Win:          ${stats.extremes.maxWin.toFixed(0)}x (spin #${stats.extremes.maxWinSpinIndex.toLocaleString()})`);
    console.log(`  100x+ Wins:       ${stats.extremes.tail100x.toFixed(4)}%`);
    console.log(`  500x+ Wins:       ${stats.extremes.tail500x.toFixed(4)}%`);
    console.log(`  1000x+ Wins:      ${stats.extremes.tail1000x.toFixed(6)}%`);
    console.log('');

    console.log(`${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log('');

    // Save reports
    const { reportPath, parPath, configPath } = saveReports(
      stats,
      args,
      result.elapsedMs,
      result.spinsPerSecond
    );

    console.log(`${colors.green}📄 Reports saved:${colors.reset}`);
    console.log(`   ${reportPath}`);
    console.log(`   ${parPath}`);
    console.log(`   ${configPath}`);
    console.log('');

    // Final status
    const targetRtpPct = GAME_CONFIG.targetRTP * 100;
    const rtpDiff = stats.rtp.total - targetRtpPct;
    const rtpOk = Math.abs(rtpDiff) <= stats.rtp.ci95Margin;

    console.log(`${colors.yellow}🎯 FINAL STATUS${colors.reset}`);
    console.log('────────────────────────────────────────');

    if (rtpOk) {
      console.log(`${colors.green}✅ RTP OK: ${stats.rtp.total.toFixed(4)}% (target: ${targetRtpPct.toFixed(2)}%)${colors.reset}`);
      console.log(`   Within 95% CI margin of ±${stats.rtp.ci95Margin.toFixed(4)}%`);
    } else {
      console.log(`${colors.red}❌ RTP OFF: ${stats.rtp.total.toFixed(4)}% (target: ${targetRtpPct.toFixed(2)}%)${colors.reset}`);
      console.log(`   Difference: ${rtpDiff > 0 ? '+' : ''}${rtpDiff.toFixed(4)}%`);
    }

    console.log('');

    // Human Summary
    printHumanSummary(stats);

    // Tuning Hints
    printTuningHints(stats);

    // Math Lock Checklist
    printMathLockChecklist(stats);

  } catch (error) {
    console.error(`${colors.red}❌ Simulation failed:${colors.reset}`, error);
    process.exit(1);
  }
}

/**
 * Print Human Summary - Easy to read overview
 */
function printHumanSummary(stats: SimulationStatistics): void {
  const targetRTP = GAME_CONFIG.targetRTP * 100;

  console.log(`${colors.bright}${colors.cyan}═════════════════ HUMAN SUMMARY ═════════════════${colors.reset}`);
  console.log(`  Target RTP:         ${targetRTP.toFixed(2)}%`);
  console.log(`  Achieved RTP:       ${stats.rtp.total.toFixed(2)}% (CI ${stats.rtp.ci95Low.toFixed(2)} – ${stats.rtp.ci95High.toFixed(2)})`);
  console.log(`  Hit Rate:           ${stats.hitRate.toFixed(1)}%`);
  console.log(`  FS Frequency:       1 in ${Math.round(stats.freeSpins.triggerRate)}`);
  console.log(`  H&W Frequency:      1 in ${Math.round(stats.holdAndWin.frequency)}`);
  console.log(`  Avg H&W Win:        ${stats.holdAndWin.avgWin.toFixed(1)}x`);
  console.log(`  Max Win Observed:   ${stats.extremes.maxWin.toFixed(0)}x`);
  console.log(`  Volatility:         ${stats.volatility.class} (std dev = ${stats.volatility.stdDev.toFixed(2)})`);
  console.log(`${colors.cyan}══════════════════════════════════════════════════${colors.reset}`);
  console.log('');
}

/**
 * Print Tuning Hints
 */
function printTuningHints(stats: SimulationStatistics): void {
  const hints = generateTuningHints(stats);

  console.log(`${colors.yellow}💡 TUNING HINTS${colors.reset}`);
  console.log('────────────────────────────────────────');

  for (const hint of hints) {
    let icon = 'ℹ️ ';
    let color = colors.dim;

    if (hint.severity === 'warn') {
      icon = '⚠️ ';
      color = colors.yellow;
    } else if (hint.severity === 'critical') {
      icon = '❌';
      color = colors.red;
    }

    console.log(`${icon} ${color}[${hint.category}]${colors.reset} ${hint.message}`);
    if (hint.suggestion) {
      console.log(`   ${colors.dim}→ ${hint.suggestion}${colors.reset}`);
    }
  }

  console.log('');
}

/**
 * Print Math Lock Checklist
 */
function printMathLockChecklist(stats: SimulationStatistics): void {
  const checklist = generateMathLockChecklist(stats);
  const ready = isMathLockReady(checklist);

  console.log(`${colors.yellow}📋 MATH LOCK CHECKLIST${colors.reset}`);
  console.log('────────────────────────────────────────');

  const check = (value: boolean, label: string) => {
    const icon = value ? `${colors.green}✅${colors.reset}` : `${colors.dim}⬜${colors.reset}`;
    console.log(`${icon} ${label}`);
  };

  check(checklist.rtpWithinTarget, 'RTP within ±0.1% of target');
  check(checklist.ciCoversTarget, '95% CI covers target');
  check(checklist.fsFrequencyOk, 'FS frequency in ideal band (150-250)');
  check(checklist.hnwFrequencyOk, 'H&W frequency reasonable (200-300)');
  check(checklist.hitRateOk, 'Hit rate in ideal range (20-30%)');
  check(checklist.volatilityMeasured, 'Volatility classified');
  check(checklist.maxWinObserved, 'Max win 500x+ observed');
  check(checklist.spinsSufficient, 'Sufficient spins (20M+)');

  console.log('');

  if (ready) {
    console.log(`${colors.green}${colors.bright}✅ MATH IS READY FOR LOCK${colors.reset}`);
  } else {
    console.log(`${colors.yellow}⏳ Math not ready - address items above${colors.reset}`);
  }

  console.log('');
}

main().catch(console.error);
