#!/usr/bin/env node
/**
 * SLOT MATH ENGINE TEMPLATE - PAR Export Tool
 *
 * Exports simulation data to CSV or JSON format
 * for external analysis or certification submission.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { format as csvFormat } from 'fast-csv';
import { createWriteStream } from 'fs';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

interface SimReport {
  schemaVersion: string;
  generatedAt: string;
  metadata: Record<string, unknown>;
  simulation: Record<string, unknown>;
  config: Record<string, unknown>;
  results: Record<string, unknown>;
  features: Record<string, unknown>;
  volatility: Record<string, unknown>;
  extremes: Record<string, unknown>;
  histogram: { bins: Array<{ label: string; count: number; percentage: number; rtpContribution: number }> };
  topWins: Array<{ rank: number; winX: number; spinIndex: number }>;
  paytable: Record<string, unknown>;
}

function loadReport(path: string): SimReport {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

async function exportToCSV(report: SimReport, outputPath: string): Promise<void> {
  const writeStream = createWriteStream(outputPath);
  const csvStream = csvFormat({ headers: true });

  csvStream.pipe(writeStream);

  // Summary section
  const flat = flattenObject({
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    ...report.metadata,
    ...report.simulation,
    ...report.config,
    ...report.results,
    ...report.features,
    ...report.volatility,
    ...report.extremes
  });

  // Write as key-value pairs
  for (const [key, value] of Object.entries(flat)) {
    csvStream.write({ Field: key, Value: String(value) });
  }

  // Add empty row
  csvStream.write({ Field: '', Value: '' });
  csvStream.write({ Field: 'HISTOGRAM', Value: '' });

  // Histogram section
  for (const bin of report.histogram.bins) {
    csvStream.write({
      Field: bin.label,
      Value: `count=${bin.count}, pct=${bin.percentage.toFixed(4)}%, rtp=${bin.rtpContribution.toFixed(4)}%`
    });
  }

  // Add empty row
  csvStream.write({ Field: '', Value: '' });
  csvStream.write({ Field: 'TOP_WINS', Value: '' });

  // Top wins
  for (const win of report.topWins) {
    csvStream.write({
      Field: `Rank ${win.rank}`,
      Value: `${win.winX.toFixed(2)}x at spin ${win.spinIndex}`
    });
  }

  csvStream.end();

  return new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

function exportToJSON(report: SimReport, outputPath: string): void {
  // Create a clean export version
  const exportData = {
    exportedAt: new Date().toISOString(),
    source: report.generatedAt,
    summary: {
      rtp: report.results,
      features: report.features,
      volatility: report.volatility,
      extremes: report.extremes
    },
    histogram: report.histogram,
    topWins: report.topWins,
    paytable: report.paytable
  };

  writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
}

export async function runExportCLI(options: {
  report: string;
  format: 'csv' | 'json';
  out: string;
}): Promise<void> {
  if (!existsSync(options.report)) {
    console.error(`${colors.red}Error: Report not found: ${options.report}${colors.reset}`);
    process.exit(1);
  }

  const report = loadReport(options.report);
  const outputPath = options.out.endsWith(`.${options.format}`)
    ? options.out
    : `${options.out}.${options.format}`;

  console.log('');
  console.log(`${colors.cyan}Exporting PAR sheet...${colors.reset}`);
  console.log(`  Source: ${options.report}`);
  console.log(`  Format: ${options.format.toUpperCase()}`);
  console.log(`  Output: ${outputPath}`);

  if (options.format === 'csv') {
    await exportToCSV(report, outputPath);
  } else {
    exportToJSON(report, outputPath);
  }

  console.log('');
  console.log(`${colors.green}✅ Export complete: ${outputPath}${colors.reset}`);
  console.log('');
}

// Standalone CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log(`Usage: node export.js <SimReport.json> [--format csv|json] [--out path]`);
    process.exit(1);
  }

  const formatIdx = args.indexOf('--format');
  const outIdx = args.indexOf('--out');

  runExportCLI({
    report: args[0],
    format: (formatIdx >= 0 ? args[formatIdx + 1] : 'csv') as 'csv' | 'json',
    out: outIdx >= 0 ? args[outIdx + 1] : './out/PAR'
  });
}
