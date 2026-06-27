/**
 * SLOT MATH ENGINE TEMPLATE - CLI Arguments Parser
 *
 * Production-grade command line interface for slot simulation.
 */

import { cpus } from 'os';
import { resolve } from 'path';

export interface CLIArgs {
  spins: number;
  bet: number;
  seed: number;
  workers: number;
  mode: 'base' | 'fs' | 'full';
  out: string;
  reels?: string;
  config?: string;
  quick: boolean;
  verbose: boolean;
}

const DEFAULT_ARGS: CLIArgs = {
  spins: 20_000_000,
  bet: 1,
  seed: 12345,
  workers: Math.max(1, cpus().length - 1),
  mode: 'full',
  out: './out',
  quick: false,
  verbose: false
};

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║   SLOT MATH ENGINE TEMPLATE - Simulator v1.0.0           ║
╚══════════════════════════════════════════════════════════╝

USAGE:
  npm run sim -- [options]
  node dist/index.js [options]

OPTIONS:
  --spins <number>     Number of spins to simulate (default: 20000000)
  --bet <number>       Bet amount per spin (default: 1)
  --seed <number>      Base RNG seed for reproducibility (default: 12345)
  --workers <number>   Number of worker threads (default: CPU cores - 1)
  --mode <mode>        Simulation mode: base, fs, full (default: full)
  --out <path>         Output directory (default: ./out)
  --reels <path>       Load reel strips from external JSON file
  --config <path>      Load full game config from JSON file
  --quick              Quick run alias (sets spins=500000)
  --verbose            Enable verbose logging
  --help, -h           Show this help message

EXAMPLES:
  npm run sim -- --spins 5000000 --seed 7 --workers 8
  npm run sim -- --quick --verbose
  npm run sim -- --spins 100000000 --out ./out/production_run
  npm run sim -- --config ./custom_config.json --spins 10000000

OUTPUT:
  Creates timestamped folder with:
  - SimReport.json     Full simulation report with all metrics
  - PAR.csv            PAR sheet in CSV format
  - config_snapshot.json  Frozen config used for this run
`);
}

function parseNumber(value: string, name: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid ${name}: "${value}" - must be a positive number`);
  }
  return num;
}

function parseMode(value: string): 'base' | 'fs' | 'full' {
  const normalized = value.toLowerCase();
  if (normalized === 'base' || normalized === 'fs' || normalized === 'full') {
    return normalized;
  }
  throw new Error(`Invalid mode: "${value}" - must be one of: base, fs, full`);
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CLIArgs {
  const args: CLIArgs = { ...DEFAULT_ARGS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextArg = argv[i + 1];

    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);

      case '--spins':
        args.spins = parseNumber(nextArg, 'spins');
        i++;
        break;

      case '--bet':
        args.bet = parseNumber(nextArg, 'bet');
        i++;
        break;

      case '--seed':
        args.seed = parseNumber(nextArg, 'seed');
        i++;
        break;

      case '--workers':
        args.workers = parseNumber(nextArg, 'workers');
        i++;
        break;

      case '--mode':
        args.mode = parseMode(nextArg);
        i++;
        break;

      case '--out':
        args.out = resolve(nextArg);
        i++;
        break;

      case '--reels':
        args.reels = resolve(nextArg);
        i++;
        break;

      case '--config':
        args.config = resolve(nextArg);
        i++;
        break;

      case '--quick':
        args.quick = true;
        args.spins = 500_000;
        break;

      case '--verbose':
        args.verbose = true;
        break;

      default:
        // Handle --key=value format
        if (arg.startsWith('--') && arg.includes('=')) {
          const [key, value] = arg.slice(2).split('=');
          switch (key) {
            case 'spins':
              args.spins = parseNumber(value, 'spins');
              break;
            case 'bet':
              args.bet = parseNumber(value, 'bet');
              break;
            case 'seed':
              args.seed = parseNumber(value, 'seed');
              break;
            case 'workers':
              args.workers = parseNumber(value, 'workers');
              break;
            case 'mode':
              args.mode = parseMode(value);
              break;
            case 'out':
              args.out = resolve(value);
              break;
            case 'reels':
              args.reels = resolve(value);
              break;
            case 'config':
              args.config = resolve(value);
              break;
          }
        } else if (arg.startsWith('-') || arg.startsWith('--')) {
          console.warn(`Warning: Unknown option "${arg}"`);
        }
    }
  }

  // Clamp workers to reasonable range
  args.workers = Math.max(1, Math.min(args.workers, cpus().length));

  return args;
}

export function formatArgs(args: CLIArgs): string {
  return `
  Spins:      ${args.spins.toLocaleString()}
  Bet:        ${args.bet}
  Seed:       ${args.seed}
  Workers:    ${args.workers}
  Mode:       ${args.mode}
  Output:     ${args.out}
  Quick:      ${args.quick}
  Verbose:    ${args.verbose}
  Reels:      ${args.reels || 'built-in'}
  Config:     ${args.config || 'built-in'}`;
}
