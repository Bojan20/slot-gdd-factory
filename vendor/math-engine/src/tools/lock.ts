#!/usr/bin/env node
/**
 * SLOT MATH ENGINE TEMPLATE - Math Lock Tool
 *
 * Verifies math configuration meets all certification requirements
 * and generates a lock file for production deployment.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { GAME_CONFIG } from '../config/gameConfig.js';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
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
    };
    multiplier: {
      frequency: number;
    };
  };
  extremes: {
    maxWinObserved: number;
  };
  simulation: {
    totalSpins: number;
  };
  metadata: {
    configChecksum: string;
    mathVersion: string;
  };
  mathLockChecklist?: {
    rtpWithinTarget: boolean;
    ciCoversTarget: boolean;
    fsFrequencyOk: boolean;
    multFrequencyOk: boolean;
    hitRateOk: boolean;
    volatilityMeasured: boolean;
    maxWinObserved: boolean;
    spinsSufficient: boolean;
  };
}

interface LockFile {
  version: string;
  lockedAt: string;
  configChecksum: string;
  mathVersion: string;
  targetRTP: number;
  observedRTP: number;
  spinsVerified: number;
  checklistPassed: boolean;
  notes: string[];
}

function loadReport(path: string): SimReport {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

export function runLockCLI(options: { report: string; force: boolean }): void {
  if (!existsSync(options.report)) {
    console.error(`${colors.red}Error: Report not found: ${options.report}${colors.reset}`);
    process.exit(1);
  }

  const report = loadReport(options.report);
  const checklist = report.mathLockChecklist;

  console.log('');
  console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}  MATH LOCK VERIFICATION${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');

  // Check each item
  const items: [boolean | undefined, string][] = [
    [checklist?.rtpWithinTarget, 'RTP within ±0.1% of target'],
    [checklist?.ciCoversTarget, '95% CI covers target RTP'],
    [checklist?.fsFrequencyOk, 'Free Spins frequency in range'],
    [checklist?.multFrequencyOk, 'Multiplier frequency reasonable'],
    [checklist?.hitRateOk, 'Hit rate in expected range'],
    [checklist?.volatilityMeasured, 'Volatility properly classified'],
    [checklist?.maxWinObserved, 'Max win potential verified'],
    [checklist?.spinsSufficient, 'Sufficient spins simulated (20M+)']
  ];

  let allPassed = true;
  const notes: string[] = [];

  for (const [passed, label] of items) {
    const icon = passed ? `${colors.green}✅${colors.reset}` : `${colors.red}❌${colors.reset}`;
    console.log(`  ${icon} ${label}`);
    if (!passed) {
      allPassed = false;
      notes.push(`FAILED: ${label}`);
    }
  }

  console.log('');

  // Additional checks
  const targetRTP = GAME_CONFIG.targetRTP * 100;
  const rtpDiff = Math.abs(report.results.rtp.observed - targetRTP);

  if (rtpDiff > 0.5) {
    console.log(`${colors.yellow}⚠️  Warning: RTP differs by ${rtpDiff.toFixed(2)}% from target${colors.reset}`);
    notes.push(`Warning: RTP diff = ${rtpDiff.toFixed(2)}%`);
  }

  if (report.simulation.totalSpins < 100_000_000) {
    console.log(`${colors.yellow}⚠️  Warning: Less than 100M spins simulated${colors.reset}`);
    notes.push('Warning: Less than 100M spins');
  }

  console.log('');

  if (allPassed || options.force) {
    const lockFile: LockFile = {
      version: '1.0.0',
      lockedAt: new Date().toISOString(),
      configChecksum: report.metadata.configChecksum,
      mathVersion: report.metadata.mathVersion,
      targetRTP: targetRTP,
      observedRTP: report.results.rtp.observed,
      spinsVerified: report.simulation.totalSpins,
      checklistPassed: allPassed,
      notes
    };

    const lockPath = join(dirname(options.report), 'MATH_LOCK.json');
    writeFileSync(lockPath, JSON.stringify(lockFile, null, 2));

    console.log(`${colors.green}${colors.bright}✅ MATH LOCKED${colors.reset}`);
    console.log(`   Lock file: ${lockPath}`);

    if (options.force && !allPassed) {
      console.log(`${colors.yellow}   (Forced lock with failing checks)${colors.reset}`);
    }
  } else {
    console.log(`${colors.red}❌ MATH NOT READY FOR LOCK${colors.reset}`);
    console.log(`   Address failing items above.`);
    console.log(`   Use --force to override (not recommended).`);
    process.exit(1);
  }

  console.log('');
}

// Standalone CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log(`Usage: node lock.js <SimReport.json> [--force]`);
    process.exit(1);
  }
  runLockCLI({
    report: args[0],
    force: args.includes('--force')
  });
}
