/**
 * SLOT MATH ENGINE TEMPLATE - Commander CLI
 *
 * Professional CLI using commander for:
 * - Subcommands (sim, compare, lock, export)
 * - Automatic help generation
 * - Option validation
 * - Clean error handling
 */

import { Command } from 'commander';
import { cpus } from 'os';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';

const VERSION = '1.0.0';
const DEFAULT_SPINS = 20_000_000;
const DEFAULT_QUICK_SPINS = 1_000_000;
const DEFAULT_FULL_SPINS = 100_000_000;

export interface SimOptions {
  spins: number;
  bet: number;
  seed: number;
  workers: number;
  mode: 'base' | 'fs' | 'full';
  out: string;
  verbose: boolean;
  json: boolean;
}

export interface CompareOptions {
  report1: string;
  report2: string;
  out: string;
}

export interface LockOptions {
  report: string;
  force: boolean;
}

export interface ExportOptions {
  report: string;
  format: 'csv' | 'json';
  out: string;
}

/**
 * Create the CLI program
 */
export function createCLI(): Command {
  const program = new Command();

  program
    .name('slot-math')
    .description('Slot Math Engine Template - Production Grade Simulator')
    .version(VERSION);

  // ─────────────────────────────────────────────────────────────────────────
  // SIM COMMAND
  // ─────────────────────────────────────────────────────────────────────────

  program
    .command('sim')
    .description('Run Monte Carlo simulation')
    .option('-s, --spins <number>', 'Number of spins to simulate', String(DEFAULT_SPINS))
    .option('-b, --bet <number>', 'Bet amount per spin', '1')
    .option('--seed <number>', 'RNG seed for reproducibility', '12345')
    .option('-w, --workers <number>', 'Number of worker threads', String(Math.max(1, cpus().length - 1)))
    .option('-m, --mode <mode>', 'Simulation mode (base/fs/full)', 'full')
    .option('-o, --out <path>', 'Output directory', './out')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .option('--json', 'Output only JSON (for piping)', false)
    .option('--quick', 'Quick run (1M spins)', false)
    .option('--full', 'Full run (100M spins)', false)
    .action(async (opts) => {
      const options = parseSimOptions(opts);
      logger.setLevel(options.verbose ? 'debug' : 'info');

      if (!options.json) {
        printBanner();
        logger.info(`Starting simulation with ${options.spins.toLocaleString()} spins...`);
      }

      // Use existing parallel simulation
      const { runParallelSimulation } = await import('../sim/parallel.js');
      const { saveReports } = await import('../report/reporter.js');

      const result = await runParallelSimulation({
        totalSpins: options.spins,
        bet: options.bet,
        baseSeed: options.seed,
        workerCount: options.workers,
        mode: options.mode
      });

      // Save reports
      const { reportPath } = saveReports(
        result.statistics,
        {
          spins: options.spins,
          bet: options.bet,
          seed: options.seed,
          workers: options.workers,
          mode: options.mode,
          out: options.out,
          verbose: options.verbose,
          quick: false
        },
        result.elapsedMs,
        result.spinsPerSecond
      );

      if (options.json) {
        console.log(JSON.stringify(result.statistics, null, 2));
      } else {
        logger.info(`Simulation complete. Report: ${reportPath}`);
        logger.info(`RTP: ${result.statistics.rtp.total.toFixed(4)}%`);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────
  // COMPARE COMMAND
  // ─────────────────────────────────────────────────────────────────────────

  program
    .command('compare')
    .description('Compare two simulation reports')
    .argument('<report1>', 'First SimReport.json path')
    .argument('<report2>', 'Second SimReport.json path')
    .option('-o, --out <path>', 'Output comparison file', './out/comparison.json')
    .action(async (report1, report2, opts) => {
      const options: CompareOptions = {
        report1: resolve(report1),
        report2: resolve(report2),
        out: resolve(opts.out)
      };

      logger.info('Comparing simulation reports...');

      // Run compare.ts directly (it's a standalone script)
      const { spawn } = await import('child_process');
      const compareScript = resolve(import.meta.dirname || '.', '../tools/compare.js');
      spawn('node', [compareScript, options.report1, options.report2], { stdio: 'inherit' });
    });

  // ─────────────────────────────────────────────────────────────────────────
  // LOCK COMMAND
  // ─────────────────────────────────────────────────────────────────────────

  program
    .command('lock')
    .description('Lock math configuration after verification')
    .argument('<report>', 'Verified SimReport.json path')
    .option('-f, --force', 'Force lock even with warnings', false)
    .action(async (report, opts) => {
      const options: LockOptions = {
        report: resolve(report),
        force: opts.force
      };

      logger.info('Verifying math lock checklist...');

      // Import and run lock
      const { runLockCLI } = await import('../tools/lock.js');
      await runLockCLI(options);
    });

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT COMMAND
  // ─────────────────────────────────────────────────────────────────────────

  program
    .command('export')
    .description('Export PAR sheet from simulation report')
    .argument('<report>', 'SimReport.json path')
    .option('-f, --format <format>', 'Export format (csv/json)', 'csv')
    .option('-o, --out <path>', 'Output file path', './out/PAR')
    .action(async (report, opts) => {
      const options: ExportOptions = {
        report: resolve(report),
        format: opts.format as 'csv' | 'json',
        out: resolve(opts.out)
      };

      logger.info(`Exporting PAR sheet as ${options.format.toUpperCase()}...`);

      // Import and run export
      const { runExportCLI } = await import('../tools/export.js');
      await runExportCLI(options);
    });

  // ─────────────────────────────────────────────────────────────────────────
  // PAR-PDF COMMAND (P0 #6) — Render JSON PAR → GLI-shaped PDF
  // ─────────────────────────────────────────────────────────────────────────

  program
    .command('par-pdf')
    .description('Render a PAR sheet PDF from a SimReport JSON (P0 #6 deliverable)')
    .argument('<report>', 'SimReport.json path (or any PAR-shaped JSON)')
    .option('-o, --out <path>', 'Output PDF file path', './out/PAR.pdf')
    .option('--disclaimer <text>', 'Custom footer disclaimer text')
    .option('--histogram-limit <n>', 'Max histogram rows in PDF', '30')
    .option('--paytable-limit <n>', 'Max paytable rows in PDF', '20')
    .action(async (report, opts) => {
      const { readFileSync } = await import('fs');
      const { renderParSheetToFile } = await import('../report/parPdf.js');

      const reportPath = resolve(report);
      const outPath = resolve(opts.out);

      logger.info(`Loading PAR JSON: ${reportPath}`);
      const raw = readFileSync(reportPath, 'utf-8');
      const parsed = JSON.parse(raw);

      logger.info(`Rendering PDF → ${outPath}`);
      await renderParSheetToFile(parsed, outPath, {
        disclaimer: opts.disclaimer,
        histogramRowLimit: Number(opts.histogramLimit ?? 30),
        paytableRowLimit: Number(opts.paytableLimit ?? 20),
      });

      logger.info(`PAR PDF written: ${outPath}`);
    });

  // ─────────────────────────────────────────────────────────────────────────
  // RTP COMMAND — W152 Wave 15 Faza 1.6
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Instant RTP estimate from an IR JSON file. Runs the IR-native
  // simulator (`runIRSimulation`) at a configurable spin budget and
  // prints the headline numbers. Designed for two flows:
  //   1. Engineer iteration: "tweak paytable, see RTP, commit when happy."
  //      A 10K-spin run finishes in <2 s on a laptop.
  //   2. CI gate: pipe `--json` into a guard script that asserts the RTP
  //      stays within tolerance vs the IR's `limits.target_rtp`.

  program
    .command('rtp')
    .description('Quick RTP estimate from an IR JSON config (W152 Faza 1.6)')
    .argument('<config>', 'IR JSON path')
    .option('-s, --spins <number>', 'Spin count (default 10000)', '10000')
    .option('--seed <number>', 'RNG seed (default 12345)', '12345')
    .option('--json', 'Emit JSON for piping into a CI guard', false)
    .option('--strict', 'Exit code 1 if RTP exceeds rtp_tolerance', false)
    .action(async (configPath, opts) => {
      const { readFileSync } = await import('fs');
      const { computeRtpReport, formatRtpHeadline } = await import('./rtp.js');

      let report;
      try {
        const raw = readFileSync(resolve(configPath), 'utf-8');
        report = await computeRtpReport(raw, {
          spins: parseInt(String(opts.spins), 10),
          seed: parseInt(String(opts.seed), 10),
        });
      } catch (e) {
        logger.error(e instanceof Error ? e.message : String(e));
        process.exit(2);
      }

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        logger.info(formatRtpHeadline(report));
      }

      if (opts.strict && report.withinTolerance === false) {
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────
  // DEFAULT ACTION (same as sim)
  // ─────────────────────────────────────────────────────────────────────────

  program
    .option('-s, --spins <number>', 'Number of spins to simulate', String(DEFAULT_SPINS))
    .option('-b, --bet <number>', 'Bet amount per spin', '1')
    .option('--seed <number>', 'RNG seed for reproducibility', '12345')
    .option('-w, --workers <number>', 'Number of worker threads', String(Math.max(1, cpus().length - 1)))
    .option('-m, --mode <mode>', 'Simulation mode (base/fs/full)', 'full')
    .option('-o, --out <path>', 'Output directory', './out')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .option('--json', 'Output only JSON (for piping)', false)
    .option('--quick', 'Quick run (1M spins)', false)
    .option('--full', 'Full run (100M spins)', false)
    .action(async (opts) => {
      // Default to sim command if no subcommand
      const options = parseSimOptions(opts);
      logger.setLevel(options.verbose ? 'debug' : 'info');

      if (!options.json) {
        printBanner();
        logger.info(`Starting simulation with ${options.spins.toLocaleString()} spins...`);
      }

      // Use existing parallel simulation
      const { runParallelSimulation } = await import('../sim/parallel.js');
      const { saveReports } = await import('../report/reporter.js');

      const result = await runParallelSimulation({
        totalSpins: options.spins,
        bet: options.bet,
        baseSeed: options.seed,
        workerCount: options.workers,
        mode: options.mode
      });

      // Save reports
      const { reportPath } = saveReports(
        result.statistics,
        {
          spins: options.spins,
          bet: options.bet,
          seed: options.seed,
          workers: options.workers,
          mode: options.mode,
          out: options.out,
          verbose: options.verbose,
          quick: false
        },
        result.elapsedMs,
        result.spinsPerSecond
      );

      if (options.json) {
        console.log(JSON.stringify(result.statistics, null, 2));
      } else {
        logger.info(`Simulation complete. Report: ${reportPath}`);
        logger.info(`RTP: ${result.statistics.rtp.total.toFixed(4)}%`);
      }
    });

  return program;
}

/**
 * Parse sim options with validation
 */
function parseSimOptions(opts: Record<string, unknown>): SimOptions {
  let spins = parseInt(opts.spins as string, 10);

  // Handle quick/full flags
  if (opts.quick) {
    spins = DEFAULT_QUICK_SPINS;
  } else if (opts.full) {
    spins = DEFAULT_FULL_SPINS;
  }

  const workers = parseInt(opts.workers as string, 10);
  const mode = opts.mode as string;

  // Validate mode
  if (!['base', 'fs', 'full'].includes(mode)) {
    logger.error(`Invalid mode: ${mode}. Must be one of: base, fs, full`);
    process.exit(1);
  }

  return {
    spins,
    bet: parseFloat(opts.bet as string),
    seed: parseInt(opts.seed as string, 10),
    workers: Math.max(1, Math.min(workers, cpus().length)),
    mode: mode as 'base' | 'fs' | 'full',
    out: resolve(opts.out as string),
    verbose: Boolean(opts.verbose),
    json: Boolean(opts.json)
  };
}

/**
 * Print CLI banner
 */
function printBanner(): void {
  logger.header('SLOT MATH ENGINE TEMPLATE v1.0.0 - Simulator');
  console.log();
}

/**
 * Run the CLI
 */
export async function runCLI(): Promise<void> {
  const program = createCLI();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error(`CLI Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Export for direct usage
export { VERSION };
