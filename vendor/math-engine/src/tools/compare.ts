#!/usr/bin/env node
/**
 * SLOT MATH ENGINE TEMPLATE - Report Comparison Tool
 *
 * Compares two SimReport.json files and shows deltas.
 * Usage: npm run compare -- path/to/runA.json path/to/runB.json
 */

import { readFileSync } from 'fs';
import { basename, dirname } from 'path';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

interface SimReport {
  results: {
    rtp: {
      observed: number;
      ci95Low: number;
      ci95High: number;
    };
    hitRate: number;
  };
  features: {
    freeSpins: {
      triggerRate: number;
      avgWin: number;
    };
    multiplier: {
      frequency: number;
      avgValue: number;
    };
  };
  volatility: {
    classification: string;
    stdDev: number;
  };
  extremes: {
    maxWinObserved: number;
    tail100x: number;
    tail500x: number;
  };
  simulation: {
    totalSpins: number;
  };
  metadata: {
    configChecksum: string;
  };
}

function loadReport(path: string): SimReport {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

function formatDelta(before: number, after: number, unit: string = '', decimals: number = 2): string {
  const delta = after - before;
  const sign = delta >= 0 ? '+' : '';
  const color = Math.abs(delta) < 0.01 ? colors.dim : (delta >= 0 ? colors.green : colors.red);
  return `${before.toFixed(decimals)}${unit} → ${after.toFixed(decimals)}${unit}  ${color}(${sign}${delta.toFixed(decimals)}${unit})${colors.reset}`;
}

function formatFrequency(before: number, after: number): string {
  const delta = after - before;
  let comment = '';
  if (delta < -5) comment = `${colors.yellow}(more frequent)${colors.reset}`;
  else if (delta > 5) comment = `${colors.yellow}(less frequent)${colors.reset}`;
  else comment = `${colors.dim}(similar)${colors.reset}`;
  return `1/${Math.round(before)} → 1/${Math.round(after)}  ${comment}`;
}

function compare(pathA: string, pathB: string): void {
  const reportA = loadReport(pathA);
  const reportB = loadReport(pathB);

  const nameA = basename(dirname(pathA));
  const nameB = basename(dirname(pathB));

  console.log('');
  console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}  SIMULATION COMPARISON${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
  console.log(`${colors.dim}  A: ${nameA}${colors.reset}`);
  console.log(`${colors.dim}  B: ${nameB}${colors.reset}`);
  console.log('');

  // Config checksum comparison
  if (reportA.metadata.configChecksum === reportB.metadata.configChecksum) {
    console.log(`${colors.yellow}⚠️  Same config checksum - no config changes detected${colors.reset}`);
    console.log('');
  }

  console.log(`${colors.yellow}📊 METRICS COMPARISON${colors.reset}`);
  console.log('─────────────────────────────────────────────────────────');
  console.log(`  RTP:            ${formatDelta(reportA.results.rtp.observed, reportB.results.rtp.observed, '%')}`);
  console.log(`  Hit Rate:       ${formatDelta(reportA.results.hitRate, reportB.results.hitRate, '%', 1)}`);
  console.log(`  FS Frequency:   ${formatFrequency(reportA.features.freeSpins.triggerRate, reportB.features.freeSpins.triggerRate)}`);
  console.log(`  FS Avg Win:     ${formatDelta(reportA.features.freeSpins.avgWin, reportB.features.freeSpins.avgWin, 'x', 1)}`);
  console.log(`  Mult Frequency: ${formatFrequency(reportA.features.multiplier.frequency, reportB.features.multiplier.frequency)}`);
  console.log(`  Mult Avg:       ${formatDelta(reportA.features.multiplier.avgValue, reportB.features.multiplier.avgValue, 'x', 2)}`);
  console.log(`  Max Win:        ${formatDelta(reportA.extremes.maxWinObserved, reportB.extremes.maxWinObserved, 'x', 0)}`);
  console.log(`  Std Dev:        ${formatDelta(reportA.volatility.stdDev, reportB.volatility.stdDev, '', 2)}`);
  console.log('');

  // Volatility classification
  if (reportA.volatility.classification !== reportB.volatility.classification) {
    console.log(`${colors.yellow}⚠️  Volatility changed: ${reportA.volatility.classification} → ${reportB.volatility.classification}${colors.reset}`);
  } else {
    console.log(`${colors.dim}ℹ️  Volatility: ${reportB.volatility.classification} (unchanged)${colors.reset}`);
  }

  console.log('');

  console.log(`${colors.yellow}🎯 TAIL COMPARISON${colors.reset}`);
  console.log('─────────────────────────────────────────────────────────');
  console.log(`  100x+ Rate:     ${formatDelta(reportA.extremes.tail100x, reportB.extremes.tail100x, '%', 4)}`);
  console.log(`  500x+ Rate:     ${formatDelta(reportA.extremes.tail500x, reportB.extremes.tail500x, '%', 4)}`);
  console.log('');

  console.log(`${colors.yellow}📈 SAMPLE SIZE${colors.reset}`);
  console.log('─────────────────────────────────────────────────────────');
  console.log(`  A: ${reportA.simulation.totalSpins.toLocaleString()} spins`);
  console.log(`  B: ${reportB.simulation.totalSpins.toLocaleString()} spins`);
  console.log('');

  // Summary
  const rtpDelta = Math.abs(reportB.results.rtp.observed - reportA.results.rtp.observed);
  if (rtpDelta < 0.1) {
    console.log(`${colors.green}✅ RTP change is minimal (< 0.1%)${colors.reset}`);
  } else if (rtpDelta < 0.5) {
    console.log(`${colors.yellow}⚠️  RTP changed by ${rtpDelta.toFixed(2)}% - review before lock${colors.reset}`);
  } else {
    console.log(`${colors.red}❌ RTP changed significantly (${rtpDelta.toFixed(2)}%) - requires investigation${colors.reset}`);
  }

  console.log('');
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
}

// Main
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
${colors.cyan}SLOT MATH ENGINE - Report Compare Tool${colors.reset}

Usage:
  npm run compare -- <report_A.json> <report_B.json>

Example:
  npm run compare -- out/sim_runs/run1/SimReport.json out/sim_runs/run2/SimReport.json

This tool compares two simulation reports and shows:
- RTP delta
- Hit rate change
- Feature frequency changes
- Max win comparison
- Volatility classification
`);
  process.exit(1);
}

try {
  compare(args[0], args[1]);
} catch (error) {
  console.error(`${colors.red}Error: ${error}${colors.reset}`);
  process.exit(1);
}
