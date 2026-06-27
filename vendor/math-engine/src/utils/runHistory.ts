/**
 * SLOT MATH ENGINE TEMPLATE - Run History Registry
 *
 * JSON-based append-only log of all simulation runs.
 * Tracks:
 * - Run metadata (timestamp, duration, parameters)
 * - Results summary (RTP, hit rate, max win)
 * - Config hash (links to exact config used)
 * - Report path (for full details)
 *
 * File: out/run_history.json
 * Format: Array of RunEntry objects, most recent last
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

/**
 * Single run entry in history
 */
export interface RunEntry {
  /** Unique run ID (timestamp-based) */
  runId: string;

  /** ISO timestamp when run started */
  startedAt: string;

  /** ISO timestamp when run completed */
  completedAt: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Simulation parameters */
  params: {
    spins: number;
    bet: number;
    seed: number;
    workers: number;
    mode: 'base' | 'fs' | 'full';
  };

  /** Results summary */
  results: {
    rtp: number;
    rtpCI95Low: number;
    rtpCI95High: number;
    hitRate: number;
    maxWin: number;
    volatilityClass: string;
  };

  /** Config identification */
  config: {
    hash: string;
    version: string;
  };

  /** Paths to generated files */
  files: {
    reportPath: string;
    parPath?: string;
  };

  /** Performance metrics */
  performance: {
    spinsPerSecond: number;
    peakMemoryMB?: number;
  };

  /** Optional notes */
  notes?: string;
}

/**
 * Run history file format
 */
export interface RunHistoryFile {
  schemaVersion: string;
  game: string;
  entries: RunEntry[];
}

const SCHEMA_VERSION = 'v1.0.0';
const HISTORY_FILENAME = 'run_history.json';

/**
 * Generate unique run ID
 */
export function generateRunId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = Math.random().toString(36).slice(2, 6);
  return `run-${timestamp}-${random}`;
}

/**
 * Load existing run history or create new
 */
export function loadRunHistory(outDir: string): RunHistoryFile {
  const historyPath = join(outDir, HISTORY_FILENAME);

  if (existsSync(historyPath)) {
    try {
      const content = readFileSync(historyPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Corrupted file, backup and start fresh
      const backupPath = historyPath + '.backup.' + Date.now();
      try {
        const content = readFileSync(historyPath, 'utf-8');
        writeFileSync(backupPath, content);
      } catch {
        // Ignore backup failure
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    game: 'Slot Math Engine',
    entries: []
  };
}

/**
 * Save run history
 */
export function saveRunHistory(outDir: string, history: RunHistoryFile): void {
  const historyPath = join(outDir, HISTORY_FILENAME);

  // Ensure directory exists
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

/**
 * Add a new run entry
 */
export function addRunEntry(outDir: string, entry: RunEntry): void {
  const history = loadRunHistory(outDir);
  history.entries.push(entry);
  saveRunHistory(outDir, history);
}

/**
 * Get recent runs
 */
export function getRecentRuns(outDir: string, count: number = 10): RunEntry[] {
  const history = loadRunHistory(outDir);
  return history.entries.slice(-count);
}

/**
 * Get runs by config hash
 */
export function getRunsByConfigHash(outDir: string, hash: string): RunEntry[] {
  const history = loadRunHistory(outDir);
  return history.entries.filter(e => e.config.hash === hash);
}

/**
 * Get best run (highest RTP)
 */
export function getBestRun(outDir: string): RunEntry | null {
  const history = loadRunHistory(outDir);
  if (history.entries.length === 0) return null;

  return history.entries.reduce((best, current) =>
    current.results.rtp > best.results.rtp ? current : best
  );
}

/**
 * Get runs summary statistics
 */
export function getRunsSummary(outDir: string): {
  totalRuns: number;
  totalSpins: number;
  avgRtp: number;
  rtpRange: { min: number; max: number };
  configs: number;
} {
  const history = loadRunHistory(outDir);
  const entries = history.entries;

  if (entries.length === 0) {
    return {
      totalRuns: 0,
      totalSpins: 0,
      avgRtp: 0,
      rtpRange: { min: 0, max: 0 },
      configs: 0
    };
  }

  const totalSpins = entries.reduce((sum, e) => sum + e.params.spins, 0);
  const avgRtp = entries.reduce((sum, e) => sum + e.results.rtp, 0) / entries.length;
  const rtps = entries.map(e => e.results.rtp);
  const uniqueConfigs = new Set(entries.map(e => e.config.hash));

  return {
    totalRuns: entries.length,
    totalSpins,
    avgRtp,
    rtpRange: {
      min: Math.min(...rtps),
      max: Math.max(...rtps)
    },
    configs: uniqueConfigs.size
  };
}

/**
 * Create run entry from simulation result
 */
export function createRunEntry(
  startTime: Date,
  params: RunEntry['params'],
  results: RunEntry['results'],
  config: RunEntry['config'],
  files: RunEntry['files'],
  durationMs: number,
  spinsPerSecond: number
): RunEntry {
  const now = new Date();

  return {
    runId: generateRunId(),
    startedAt: startTime.toISOString(),
    completedAt: now.toISOString(),
    durationMs,
    params,
    results,
    config,
    files,
    performance: {
      spinsPerSecond
    }
  };
}

/**
 * Format run entry for display
 */
export function formatRunEntry(entry: RunEntry): string {
  const date = new Date(entry.completedAt).toLocaleString();
  const spins = (entry.params.spins / 1_000_000).toFixed(1) + 'M';
  const rtp = entry.results.rtp.toFixed(4) + '%';
  const ci = `±${((entry.results.rtpCI95High - entry.results.rtp)).toFixed(4)}%`;

  return `${entry.runId} | ${date} | ${spins} spins | RTP: ${rtp} ${ci} | Max: ${entry.results.maxWin.toFixed(0)}x`;
}

/**
 * Print run history summary
 */
export function printRunHistorySummary(outDir: string): void {
  const summary = getRunsSummary(outDir);
  const recent = getRecentRuns(outDir, 5);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RUN HISTORY SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total Runs:    ${summary.totalRuns}`);
  console.log(`  Total Spins:   ${(summary.totalSpins / 1_000_000).toFixed(1)}M`);
  console.log(`  Avg RTP:       ${summary.avgRtp.toFixed(4)}%`);
  console.log(`  RTP Range:     ${summary.rtpRange.min.toFixed(4)}% - ${summary.rtpRange.max.toFixed(4)}%`);
  console.log(`  Unique Configs: ${summary.configs}`);

  if (recent.length > 0) {
    console.log('\n  Recent Runs:');
    for (const entry of recent) {
      console.log(`    ${formatRunEntry(entry)}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}
