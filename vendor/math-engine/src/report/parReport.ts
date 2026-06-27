/**
 * SLOT MATH ENGINE TEMPLATE - PAR Sheet Report Generator
 *
 * Generates:
 * 1. SimReport.json - Complete machine-readable report
 * 2. PAR.csv - Excel-friendly summary
 * 3. Console summary - Human readable quick view
 */

import * as fs from 'fs';
import * as path from 'path';
import { GAME_CONFIG } from '../config/gameConfig.js';
import { LINE_PAYTABLE, SCATTER_PAYTABLE } from '../model/paytable.js';
import { ORB_VALUE_TABLE } from '../engine/holdAndWin.js';
import { BASE_REELS, FREE_SPINS_REELS, getReelDistribution } from '../model/reels.js';
import { PAYLINES } from '../model/paylines.js';
import { SymbolId, SYMBOL_DEFINITIONS } from '../model/symbols.js';
import { SimulationResults } from '../sim/stats.js';
import { createHash } from 'crypto';

/**
 * Generate SHA-256 hash of config for versioning
 */
function generateConfigHash(): string {
  const configStr = JSON.stringify({
    version: GAME_CONFIG.version,
    reels: BASE_REELS,
    fsReels: FREE_SPINS_REELS,
    paytable: LINE_PAYTABLE,
    scatterTable: SCATTER_PAYTABLE,
    orbValues: ORB_VALUE_TABLE,
    paylines: PAYLINES
  });

  return createHash('sha256').update(configStr).digest('hex').substring(0, 16);
}

/**
 * SimReport.json structure (v7)
 */
export interface SimReport {
  schemaVersion: string;
  generatedAt: string;
  configHash: string;

  game: {
    name: string;
    version: string;
    mathVersion: string;
    layout: string;
    paySystem: string;
    paylines: number;
    targetRTP: number;
    targetVolatility: string;
    maxWin: number;
  };

  simulation: {
    spins: number;
    seed?: number;
    engineVersion: string;
  };

  results: {
    observedRTP: number;
    rtpPercent: number;
    errorMargin: number;
    ci95Lower: number;
    ci95Upper: number;

    rtpBreakdown: {
      baseLine: number;
      scatter: number;
      freeSpins: number;
      holdAndWin: number;
    };

    hitRate: number;
    deadSpinRate: number;
    avgWinOnHit: number;

    percentiles: {
      p50: number;
      p90: number;
      p99: number;
      p999: number;
    };

    tailBuckets: {
      ge100x: number;
      ge500x: number;
      ge1000x: number;
      ge5000x: number;
    };

    maxObservedWin: number;
    maxWinSpin: number;
  };

  features: Array<{
    id: string;
    name: string;
    triggerRate: number;
    frequency: string;
    avgWin: number;
    rtpContribution: number;
    additionalMetrics?: Record<string, number | string>;
  }>;

  volatility: {
    variance: number;
    stdDev: number;
    volatilityIndex: number;
    classification: string;
  };

  streaks: {
    deadMean: number;
    deadMax: number;
  };

  histogram: Array<{
    bucket: string;
    count: number;
    percentage: number;
    rtpContribution: number;
  }>;

  reelStrips: {
    base: Array<{
      reel: number;
      length: number;
      distribution: Array<{ symbol: string; count: number; percentage: number }>;
    }>;
    freeSpins: Array<{
      reel: number;
      length: number;
      distribution: Array<{ symbol: string; count: number; percentage: number }>;
    }>;
  };

  paytable: {
    lineWins: Array<{
      symbol: string;
      pays: { 3: number; 4: number; 5: number };
    }>;
    scatter: Array<{
      count: number;
      pay: number;
      freeSpins: number;
    }>;
    holdAndWin: {
      orbValues: Array<{ type: string; multiplier: number; weight: number }>;
      expectedOrbValue: number;
    };
  };

  notes: string[];
}

/**
 * Generate SimReport.json (v7)
 */
export function generateSimReport(
  results: SimulationResults,
  seed?: number
): SimReport {
  const configHash = generateConfigHash();

  // Estimate percentiles from histogram (approximation)
  const estimatedPercentiles = estimatePercentiles(results.histogram);

  // Calculate expected orb value
  const totalWeight = ORB_VALUE_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
  const expectedOrbValue = ORB_VALUE_TABLE.reduce(
    (sum, entry) => sum + entry.value.multiplier * (entry.weight / totalWeight),
    0
  );

  const report: SimReport = {
    schemaVersion: 'v1.0.0',
    generatedAt: new Date().toISOString(),
    configHash,

    game: {
      name: GAME_CONFIG.name,
      version: GAME_CONFIG.version,
      mathVersion: GAME_CONFIG.mathVersion,
      layout: `${GAME_CONFIG.numReels}x${GAME_CONFIG.numRows}`,
      paySystem: 'paylines',
      paylines: GAME_CONFIG.numPaylines,
      targetRTP: GAME_CONFIG.targetRTP * 100,
      targetVolatility: GAME_CONFIG.targetVolatility,
      maxWin: GAME_CONFIG.maxWinMultiplier
    },

    simulation: {
      spins: results.totalSpins,
      seed,
      engineVersion: 'sim-core-1.0.0'
    },

    results: {
      observedRTP: results.rtp,
      rtpPercent: results.rtpPercent,
      errorMargin: results.rtp95CI,
      ci95Lower: results.rtpPercent - results.rtp95CI,
      ci95Upper: results.rtpPercent + results.rtp95CI,

      rtpBreakdown: results.rtpBreakdown,

      hitRate: results.hitRatePercent,
      deadSpinRate: results.deadSpinRate * 100,
      avgWinOnHit: results.rtp / results.hitRate,

      percentiles: estimatedPercentiles,

      tailBuckets: {
        ge100x: results.wins100xPlusRate,
        ge500x: results.wins500xPlusRate,
        ge1000x: results.wins1000xPlusRate,
        ge5000x: results.wins5000xPlusRate
      },

      maxObservedWin: results.maxWin,
      maxWinSpin: results.maxWinSpin
    },

    features: [
      {
        id: 'freeSpins',
        name: 'Free Spins',
        triggerRate: 1 / results.fsFrequency,
        frequency: `1 in ${results.fsFrequency}`,
        avgWin: results.avgFSWin,
        rtpContribution: results.rtpBreakdown.freeSpins,
        additionalMetrics: {
          avgSpins: results.avgFSSpins,
          retriggerRate: (results.fsRetriggerRate * 100).toFixed(2) + '%',
          maxMultiplier: results.maxMultiplier + 'x'
        }
      },
      {
        id: 'holdAndWin',
        name: 'Hold & Win',
        triggerRate: 1 / results.hnwFrequency,
        frequency: `1 in ${results.hnwFrequency}`,
        avgWin: results.avgHnWWin,
        rtpContribution: results.rtpBreakdown.holdAndWin,
        additionalMetrics: {
          avgOrbs: results.avgHnWOrbs.toFixed(1),
          fullGridJackpotRate: (results.fullGridJackpotRate * 100).toFixed(4) + '%'
        }
      }
    ],

    volatility: {
      variance: results.variance,
      stdDev: results.stdDev,
      volatilityIndex: results.volatilityIndex,
      classification: classifyVolatility(results.volatilityIndex)
    },

    streaks: {
      deadMean: results.avgDeadStreak,
      deadMax: results.maxDeadStreak
    },

    histogram: results.histogram.map(bin => ({
      bucket: bin.label,
      count: bin.count,
      percentage: bin.percentage,
      rtpContribution: bin.rtpContribution * 100
    })),

    reelStrips: {
      base: BASE_REELS.map((reel, i) => ({
        reel: i + 1,
        length: reel.length,
        distribution: getReelDistribution(i, false).map(d => ({
          symbol: d.symbol,
          count: d.count,
          percentage: d.percentage
        }))
      })),
      freeSpins: FREE_SPINS_REELS.map((reel, i) => ({
        reel: i + 1,
        length: reel.length,
        distribution: getReelDistribution(i, true).map(d => ({
          symbol: d.symbol,
          count: d.count,
          percentage: d.percentage
        }))
      }))
    },

    paytable: {
      lineWins: LINE_PAYTABLE.map(entry => ({
        symbol: entry.symbol,
        pays: entry.pays
      })),
      scatter: SCATTER_PAYTABLE.map(entry => ({
        count: entry.count,
        pay: entry.pay,
        freeSpins: entry.freeSpinsAwarded
      })),
      holdAndWin: {
        orbValues: ORB_VALUE_TABLE.map(entry => ({
          type: entry.value.type,
          multiplier: entry.value.multiplier,
          weight: entry.weight
        })),
        expectedOrbValue
      }
    },

    notes: generateNotes(results)
  };

  return report;
}

/**
 * Estimate percentiles from histogram (rough approximation)
 */
function estimatePercentiles(
  histogram: SimulationResults['histogram']
): { p50: number; p90: number; p99: number; p999: number } {
  // This is an approximation - for accurate percentiles, use streaming quantile algorithms
  let cumulative = 0;
  let p50 = 0, p90 = 0, p99 = 0, p999 = 0;

  for (const bin of histogram) {
    const prevCum = cumulative;
    cumulative += bin.percentage;

    if (prevCum < 50 && cumulative >= 50) p50 = bin.max;
    if (prevCum < 90 && cumulative >= 90) p90 = bin.max;
    if (prevCum < 99 && cumulative >= 99) p99 = bin.max;
    if (prevCum < 99.9 && cumulative >= 99.9) p999 = bin.max;
  }

  return { p50, p90, p99, p999 };
}

/**
 * Classify volatility based on index
 */
function classifyVolatility(index: number): string {
  if (index < 5) return 'Low';
  if (index < 10) return 'Medium';
  if (index < 15) return 'High';
  return 'Extreme';
}

/**
 * Generate notes based on results (v7)
 */
function generateNotes(results: SimulationResults): string[] {
  const notes: string[] = [];

  // RTP check
  const rtpDiff = Math.abs(results.rtpPercent - GAME_CONFIG.targetRTP * 100);
  if (rtpDiff > 0.5) {
    notes.push(`⚠️ RTP ${results.rtpPercent.toFixed(2)}% deviates from target ${(GAME_CONFIG.targetRTP * 100).toFixed(2)}% by ${rtpDiff.toFixed(2)}%`);
  } else {
    notes.push(`✅ RTP within tolerance of target`);
  }

  // Max win check
  if (results.maxWin >= GAME_CONFIG.caps.maxWinMultiplier * 0.9) {
    notes.push(`⚠️ Max win ${results.maxWin.toFixed(0)}x approaching cap`);
  }

  // FS frequency check
  if (results.fsFrequency > 200) {
    notes.push(`ℹ️ Free Spins trigger rate 1/${results.fsFrequency} is relatively rare`);
  }

  // H&W frequency check
  if (results.hnwFrequency > 300) {
    notes.push(`ℹ️ Hold & Win trigger rate 1/${results.hnwFrequency} is relatively rare`);
  }

  // Full Grid Jackpot check
  if (results.fullGridJackpotRate > 0) {
    notes.push(`⚡ Full Grid Jackpot rate: ${(results.fullGridJackpotRate * 100).toFixed(4)}% of H&W sessions`);
  }

  return notes;
}

/**
 * Generate PAR.csv (v7)
 */
export function generatePARCSV(results: SimulationResults): string {
  const lines: string[] = [];

  // SUMMARY
  lines.push('SECTION,METRIC,VALUE');
  lines.push('');
  lines.push('SUMMARY,Game Name,' + GAME_CONFIG.name);
  lines.push('SUMMARY,Version,' + GAME_CONFIG.version);
  lines.push('SUMMARY,Layout,' + `${GAME_CONFIG.numReels}x${GAME_CONFIG.numRows}`);
  lines.push('SUMMARY,Paylines,' + GAME_CONFIG.numPaylines);
  lines.push('SUMMARY,Target RTP,' + (GAME_CONFIG.targetRTP * 100).toFixed(2) + '%');
  lines.push('SUMMARY,Observed RTP,' + results.rtpPercent.toFixed(4) + '%');
  lines.push('SUMMARY,95% CI,' + `±${results.rtp95CI.toFixed(4)}%`);
  lines.push('SUMMARY,Hit Rate,' + results.hitRatePercent.toFixed(2) + '%');
  lines.push('SUMMARY,Max Win Observed,' + results.maxWin.toFixed(0) + 'x');
  lines.push('SUMMARY,Volatility,' + classifyVolatility(results.volatilityIndex));
  lines.push('');

  // RTP BREAKDOWN
  lines.push('RTP BREAKDOWN,Base Line Wins,' + results.rtpBreakdown.baseLine.toFixed(4) + '%');
  lines.push('RTP BREAKDOWN,Scatter Wins,' + results.rtpBreakdown.scatter.toFixed(4) + '%');
  lines.push('RTP BREAKDOWN,Free Spins,' + results.rtpBreakdown.freeSpins.toFixed(4) + '%');
  lines.push('RTP BREAKDOWN,Hold & Win,' + results.rtpBreakdown.holdAndWin.toFixed(4) + '%');
  lines.push('');

  // FEATURES - Free Spins
  lines.push('FREE SPINS,Trigger Frequency,1 in ' + results.fsFrequency);
  lines.push('FREE SPINS,Avg FS Spins,' + results.avgFSSpins.toFixed(1));
  lines.push('FREE SPINS,Avg FS Win,' + results.avgFSWin.toFixed(2) + 'x');
  lines.push('FREE SPINS,Retrigger Rate,' + (results.fsRetriggerRate * 100).toFixed(2) + '%');
  lines.push('FREE SPINS,Max Multiplier,' + results.maxMultiplier + 'x');
  lines.push('');

  // FEATURES - Hold & Win
  lines.push('HOLD & WIN,Trigger Frequency,1 in ' + results.hnwFrequency);
  lines.push('HOLD & WIN,Avg Orbs,' + results.avgHnWOrbs.toFixed(1));
  lines.push('HOLD & WIN,Avg H&W Win,' + results.avgHnWWin.toFixed(2) + 'x');
  lines.push('HOLD & WIN,Full Grid Jackpot Rate,' + (results.fullGridJackpotRate * 100).toFixed(4) + '%');
  lines.push('');

  // PAYTABLE
  lines.push('PAYTABLE,Symbol,3-Kind,4-Kind,5-Kind');
  for (const entry of LINE_PAYTABLE) {
    const name = SYMBOL_DEFINITIONS[entry.symbol].name;
    lines.push(`PAYTABLE,${name},${entry.pays[3]}x,${entry.pays[4]}x,${entry.pays[5]}x`);
  }
  lines.push('');

  // SCATTER
  lines.push('SCATTER,Count,Pay,Free Spins');
  for (const entry of SCATTER_PAYTABLE) {
    lines.push(`SCATTER,${entry.count},${entry.pay}x,${entry.freeSpinsAwarded}`);
  }
  lines.push('');

  // ORB VALUES
  lines.push('ORB VALUES,Type,Multiplier,Weight');
  for (const entry of ORB_VALUE_TABLE) {
    lines.push(`ORB VALUES,${entry.value.type},${entry.value.multiplier}x,${entry.weight}`);
  }
  lines.push('');

  // HISTOGRAM
  lines.push('HISTOGRAM,Bucket,Count,Percentage,RTP Contribution');
  for (const bin of results.histogram) {
    lines.push(`HISTOGRAM,${bin.label},${bin.count},${bin.percentage.toFixed(4)}%,${(bin.rtpContribution * 100).toFixed(4)}%`);
  }

  return lines.join('\n');
}

/**
 * Print console summary (v7)
 */
export function printConsoleSummary(results: SimulationResults): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  SLOT MATH ENGINE - SIMULATION RESULTS');
  console.log('═'.repeat(60));

  console.log('\n📊 OVERALL PERFORMANCE');
  console.log('─'.repeat(40));
  console.log(`  Spins Simulated:  ${results.totalSpins.toLocaleString()}`);
  console.log(`  Target RTP:       ${(GAME_CONFIG.targetRTP * 100).toFixed(2)}%`);
  console.log(`  Observed RTP:     ${results.rtpPercent.toFixed(4)}% ± ${results.rtp95CI.toFixed(4)}%`);
  console.log(`  Hit Rate:         ${results.hitRatePercent.toFixed(2)}%`);
  console.log(`  Dead Spin Rate:   ${(results.deadSpinRate * 100).toFixed(2)}%`);

  console.log('\n💰 RTP BREAKDOWN');
  console.log('─'.repeat(40));
  console.log(`  Base Line Wins:   ${results.rtpBreakdown.baseLine.toFixed(2)}%`);
  console.log(`  Scatter Wins:     ${results.rtpBreakdown.scatter.toFixed(2)}%`);
  console.log(`  Free Spins:       ${results.rtpBreakdown.freeSpins.toFixed(2)}%`);
  console.log(`  Hold & Win:       ${results.rtpBreakdown.holdAndWin.toFixed(2)}%`);

  console.log('\n🎰 FREE SPINS');
  console.log('─'.repeat(40));
  console.log(`  Trigger:          1 in ${results.fsFrequency} spins`);
  console.log(`  Avg FS Spins:     ${results.avgFSSpins.toFixed(1)}`);
  console.log(`  Avg FS Win:       ${results.avgFSWin.toFixed(2)}x`);
  console.log(`  Retrigger Rate:   ${(results.fsRetriggerRate * 100).toFixed(2)}%`);
  console.log(`  Max Multiplier:   ${results.maxMultiplier}x`);

  console.log('\n⚡ HOLD & WIN');
  console.log('─'.repeat(40));
  console.log(`  Trigger:          1 in ${results.hnwFrequency} spins`);
  console.log(`  Avg Orbs:         ${results.avgHnWOrbs.toFixed(1)}`);
  console.log(`  Avg H&W Win:      ${results.avgHnWWin.toFixed(2)}x`);
  console.log(`  Full Grid Rate:   ${(results.fullGridJackpotRate * 100).toFixed(4)}%`);

  console.log('\n📈 VOLATILITY');
  console.log('─'.repeat(40));
  console.log(`  Std Deviation:    ${results.stdDev.toFixed(4)}`);
  console.log(`  Volatility Index: ${results.volatilityIndex.toFixed(2)}`);
  console.log(`  Classification:   ${classifyVolatility(results.volatilityIndex)}`);

  console.log('\n🏆 TAIL & EXTREMES');
  console.log('─'.repeat(40));
  console.log(`  Max Win:          ${results.maxWin.toFixed(0)}x (spin #${results.maxWinSpin.toLocaleString()})`);
  console.log(`  100x+ Wins:       ${(results.wins100xPlusRate * 100).toFixed(4)}%`);
  console.log(`  500x+ Wins:       ${(results.wins500xPlusRate * 100).toFixed(4)}%`);
  console.log(`  1000x+ Wins:      ${(results.wins1000xPlusRate * 100).toFixed(6)}%`);

  console.log('\n' + '═'.repeat(60) + '\n');
}

/**
 * Save reports to files
 */
export async function saveReports(
  results: SimulationResults,
  outDir: string,
  seed?: number
): Promise<void> {
  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Save SimReport.json
  const simReport = generateSimReport(results, seed);
  const jsonPath = path.join(outDir, `SimReport_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(simReport, null, 2));
  console.log(`📄 Saved: ${jsonPath}`);

  // Save PAR.csv
  const csv = generatePARCSV(results);
  const csvPath = path.join(outDir, `PAR_${timestamp}.csv`);
  fs.writeFileSync(csvPath, csv);
  console.log(`📄 Saved: ${csvPath}`);

  // Save latest (overwrite)
  fs.writeFileSync(path.join(outDir, 'SimReport_latest.json'), JSON.stringify(simReport, null, 2));
  fs.writeFileSync(path.join(outDir, 'PAR_latest.csv'), csv);
}
