/**
 * SLOT MATH ENGINE TEMPLATE - Report Generator
 *
 * Generates standardized SimReport.json and PAR.csv files
 * with full provenance and reproducibility information.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { SimulationStatistics, HISTOGRAM_BINS } from '../sim/accumulator.js';
import { checksumObject, getGitCommit } from '../utils/hash.js';
import { StandardPercentiles, TailBuckets } from '../utils/histogram.js';
import { GAME_CONFIG } from '../config/gameConfig.js';
import { LINE_PAYTABLE, SCATTER_PAYTABLE } from '../model/paytable.js';
import { ORB_VALUE_TABLE } from '../engine/holdAndWin.js';
import { BASE_REELS, FREE_SPINS_REELS } from '../model/reels.js';
import { PAYLINES } from '../model/paylines.js';
import { SYMBOL_DEFINITIONS, SymbolId } from '../model/symbols.js';
import { CLIArgs } from '../cli/args.js';
import {
  TuningHint,
  MathLockChecklist,
  generateTuningHints,
  generateMathLockChecklist
} from './tuningAssistant.js';

export interface SimReport {
  schemaVersion: string;
  generatedAt: string;

  metadata: {
    gameId: string;
    mathVersion: string;
    gitCommit: string | null;
    configChecksum: string;
    reelsChecksum: string;
  };

  simulation: {
    totalSpins: number;
    bet: number;
    baseSeed: number;
    workers: number;
    mode: string;
    elapsedMs: number;
    spinsPerSecond: number;
  };

  config: {
    layout: { reels: number; rows: number };
    paylines: number;
    targetRtp: number;
    maxWin: number;
    volatility: string;
  };

  results: {
    rtp: {
      observed: number;
      ci95Low: number;
      ci95High: number;
      ci95Margin: number;
      breakdown: {
        base: number;
        scatter: number;
        freeSpins: number;
        holdAndWin: number;
      };
    };
    hitRate: number;
    deadSpinRate: number;
    avgWinOnHit: number;
  };

  features: {
    freeSpins: {
      triggerRate: number;
      avgSpins: number;
      avgWin: number;
      retriggerRate: number;
      totalTriggers: number;
      maxMultiplier: number;
    };
    holdAndWin: {
      frequency: number;
      avgOrbs: number;
      avgWin: number;
      fullGridJackpotRate: number;
      totalTriggers: number;
    };
  };

  volatility: {
    stdDev: number;
    index: number;
    classification: string;
  };

  extremes: {
    maxWinObserved: number;
    maxWinSpinIndex: number;
    tail100x: number;
    tail500x: number;
    tail1000x: number;
  };

  // HDR percentiles for precise tail distribution
  percentiles: StandardPercentiles;

  // Tail bucket counts
  tailBuckets: TailBuckets;

  histogram: {
    bins: {
      label: string;
      count: number;
      percentage: number;
      rtpContribution: number;
    }[];
  };

  topWins: {
    rank: number;
    winX: number;
    spinIndex: number;
  }[];

  paytable: {
    symbols: {
      id: string;
      name: string;
      tier: string;
      pays: { count: number; value: number }[];
    }[];
    scatter: {
      count: number;
      pay: number;
      freeSpins: number;
    }[];
    holdAndWin: {
      orbValues: { type: string; multiplier: number; weight: number }[];
      expectedOrbValue: number;
    };
  };

  reels: {
    base: {
      reelIndex: number;
      length: number;
      symbolCounts: { symbol: string; count: number }[];
    }[];
    freeSpins: {
      reelIndex: number;
      length: number;
      symbolCounts: { symbol: string; count: number }[];
    }[];
  };

  tuningHints: TuningHint[];

  mathLockChecklist: MathLockChecklist;
}

function getSymbolName(id: SymbolId): string {
  return SYMBOL_DEFINITIONS[id]?.name || `Symbol_${id}`;
}

function getSymbolTier(id: SymbolId): string {
  const def = SYMBOL_DEFINITIONS[id];
  if (!def) return 'UNKNOWN';
  return def.tier;
}

function countSymbols(reel: SymbolId[]): { symbol: string; count: number }[] {
  const counts = new Map<SymbolId, number>();
  for (const sym of reel) {
    counts.set(sym, (counts.get(sym) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ symbol: getSymbolName(id), count }))
    .sort((a, b) => b.count - a.count);
}

export function generateSimReport(
  stats: SimulationStatistics,
  args: CLIArgs,
  elapsedMs: number,
  spinsPerSecond: number
): SimReport {
  const now = new Date().toISOString();

  // Build reels config for checksum
  const reelsConfig = { base: BASE_REELS, freeSpins: FREE_SPINS_REELS };
  const fullConfig = {
    game: GAME_CONFIG,
    paytable: LINE_PAYTABLE,
    scatter: SCATTER_PAYTABLE,
    orbValues: ORB_VALUE_TABLE,
    paylines: PAYLINES,
    reels: reelsConfig
  };

  // Calculate expected orb value
  const totalWeight = ORB_VALUE_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
  const expectedOrbValue = ORB_VALUE_TABLE.reduce(
    (sum, entry) => sum + entry.value.multiplier * (entry.weight / totalWeight),
    0
  );

  return {
    schemaVersion: 'v1.0.0',
    generatedAt: now,

    metadata: {
      gameId: GAME_CONFIG.name,
      mathVersion: GAME_CONFIG.mathVersion,
      gitCommit: getGitCommit(),
      configChecksum: checksumObject(fullConfig),
      reelsChecksum: checksumObject(reelsConfig)
    },

    simulation: {
      totalSpins: stats.spinCount,
      bet: args.bet,
      baseSeed: args.seed,
      workers: args.workers,
      mode: args.mode,
      elapsedMs,
      spinsPerSecond
    },

    config: {
      layout: { reels: GAME_CONFIG.numReels, rows: GAME_CONFIG.numRows },
      paylines: GAME_CONFIG.numPaylines,
      targetRtp: GAME_CONFIG.targetRTP * 100,
      maxWin: GAME_CONFIG.maxWinMultiplier,
      volatility: GAME_CONFIG.targetVolatility
    },

    results: {
      rtp: {
        observed: stats.rtp.total,
        ci95Low: stats.rtp.ci95Low,
        ci95High: stats.rtp.ci95High,
        ci95Margin: stats.rtp.ci95Margin,
        breakdown: {
          base: stats.rtp.base,
          scatter: stats.rtp.scatter,
          freeSpins: stats.rtp.freeSpins,
          holdAndWin: stats.rtp.holdAndWin
        }
      },
      hitRate: stats.hitRate,
      deadSpinRate: stats.deadSpinRate,
      avgWinOnHit: stats.avgWinOnHit
    },

    features: {
      freeSpins: {
        triggerRate: stats.freeSpins.triggerRate,
        avgSpins: stats.freeSpins.avgSpins,
        avgWin: stats.freeSpins.avgWin,
        retriggerRate: stats.freeSpins.retriggerRate,
        totalTriggers: stats.freeSpins.totalTriggers,
        maxMultiplier: stats.freeSpins.maxMultiplier || 1
      },
      holdAndWin: {
        frequency: stats.holdAndWin.frequency,
        avgOrbs: stats.holdAndWin.avgOrbs,
        avgWin: stats.holdAndWin.avgWin,
        fullGridJackpotRate: stats.holdAndWin.fullGridJackpotRate,
        totalTriggers: stats.holdAndWin.totalTriggers
      }
    },

    volatility: {
      stdDev: stats.volatility.stdDev,
      index: stats.volatility.index,
      classification: stats.volatility.class
    },

    extremes: {
      maxWinObserved: stats.extremes.maxWin,
      maxWinSpinIndex: stats.extremes.maxWinSpinIndex,
      tail100x: stats.extremes.tail100x,
      tail500x: stats.extremes.tail500x,
      tail1000x: stats.extremes.tail1000x
    },

    // HDR percentiles
    percentiles: stats.percentiles,
    tailBuckets: stats.tailBuckets,

    histogram: {
      bins: stats.histogram.map((bin) => ({
        label: bin.label,
        count: bin.count,
        percentage: (bin.count / stats.spinCount) * 100,
        rtpContribution: bin.rtpContribution
      }))
    },

    topWins: stats.topWins.slice(0, 20).map((win, i) => ({
      rank: i + 1,
      winX: win.winX,
      spinIndex: win.spinIndex
    })),

    paytable: {
      symbols: LINE_PAYTABLE.map((entry) => ({
        id: entry.symbol,
        name: getSymbolName(entry.symbol),
        tier: getSymbolTier(entry.symbol),
        pays: [
          { count: 3, value: entry.pays[3] },
          { count: 4, value: entry.pays[4] },
          { count: 5, value: entry.pays[5] }
        ]
      })),
      scatter: SCATTER_PAYTABLE.map((s) => ({
        count: s.count,
        pay: s.pay,
        freeSpins: s.freeSpinsAwarded
      })),
      holdAndWin: {
        orbValues: ORB_VALUE_TABLE.map((entry) => ({
          type: entry.value.type,
          multiplier: entry.value.multiplier,
          weight: entry.weight
        })),
        expectedOrbValue
      }
    },

    reels: {
      base: BASE_REELS.map((reel, i) => ({
        reelIndex: i,
        length: reel.length,
        symbolCounts: countSymbols(reel)
      })),
      freeSpins: FREE_SPINS_REELS.map((reel, i) => ({
        reelIndex: i,
        length: reel.length,
        symbolCounts: countSymbols(reel)
      }))
    },

    tuningHints: generateTuningHints(stats),

    mathLockChecklist: generateMathLockChecklist(stats)
  };
}

export function generatePARCsv(stats: SimulationStatistics, args: CLIArgs): string {
  const lines: string[] = [];

  // Helper to add section
  const section = (name: string) => {
    lines.push('');
    lines.push(`SECTION,${name}`);
  };

  // SUMMARY
  section('SUMMARY');
  lines.push(`Game Name,${GAME_CONFIG.name}`);
  lines.push(`Version,${GAME_CONFIG.version}`);
  lines.push(`Layout,${GAME_CONFIG.numReels}x${GAME_CONFIG.numRows}`);
  lines.push(`Paylines,${GAME_CONFIG.numPaylines}`);
  lines.push(`Target RTP,${(GAME_CONFIG.targetRTP * 100).toFixed(2)}%`);
  lines.push(`Observed RTP,${stats.rtp.total.toFixed(4)}%`);
  lines.push(`95% CI,±${stats.rtp.ci95Margin.toFixed(4)}%`);
  lines.push(`Hit Rate,${stats.hitRate.toFixed(2)}%`);
  lines.push(`Max Win Observed,${stats.extremes.maxWin.toFixed(0)}x`);
  lines.push(`Volatility,${stats.volatility.class}`);

  // SIMULATION
  section('SIMULATION');
  lines.push(`Spins,${stats.spinCount.toLocaleString()}`);
  lines.push(`Seed,${args.seed}`);
  lines.push(`Workers,${args.workers}`);
  lines.push(`Mode,${args.mode}`);
  lines.push(`Bet,${args.bet}`);

  // RTP BREAKDOWN
  section('RTP_BREAKDOWN');
  lines.push(`Base Line Wins,${stats.rtp.base.toFixed(4)}%`);
  lines.push(`Scatter Wins,${stats.rtp.scatter.toFixed(4)}%`);
  lines.push(`Free Spins,${stats.rtp.freeSpins.toFixed(4)}%`);
  lines.push(`Hold & Win,${stats.rtp.holdAndWin.toFixed(4)}%`);

  // FEATURES - Free Spins
  section('FREE_SPINS');
  lines.push(`Trigger Frequency,1 in ${Math.round(stats.freeSpins.triggerRate)}`);
  lines.push(`Avg FS Spins,${stats.freeSpins.avgSpins.toFixed(1)}`);
  lines.push(`Avg FS Win,${stats.freeSpins.avgWin.toFixed(2)}x`);
  lines.push(`Retrigger Rate,${stats.freeSpins.retriggerRate.toFixed(2)}%`);
  lines.push(`Max Multiplier,${stats.freeSpins.maxMultiplier || 1}x`);

  // FEATURES - Hold & Win
  section('HOLD_AND_WIN');
  lines.push(`Trigger Frequency,1 in ${Math.round(stats.holdAndWin.frequency)}`);
  lines.push(`Avg Orbs,${stats.holdAndWin.avgOrbs.toFixed(1)}`);
  lines.push(`Avg H&W Win,${stats.holdAndWin.avgWin.toFixed(2)}x`);
  lines.push(`Full Grid Jackpot Rate,${stats.holdAndWin.fullGridJackpotRate.toFixed(4)}%`);

  // PAYTABLE
  section('PAYTABLE');
  lines.push('Symbol,3-Kind,4-Kind,5-Kind');
  for (const entry of LINE_PAYTABLE) {
    const name = getSymbolName(entry.symbol);
    lines.push(`${name},${entry.pays[3]}x,${entry.pays[4]}x,${entry.pays[5]}x`);
  }

  // SCATTER
  section('SCATTER');
  lines.push('Count,Pay,Free Spins');
  for (const s of SCATTER_PAYTABLE) {
    lines.push(`${s.count},${s.pay}x,${s.freeSpinsAwarded}`);
  }

  // ORB VALUES
  section('ORB_VALUES');
  lines.push('Type,Multiplier,Weight');
  for (const entry of ORB_VALUE_TABLE) {
    lines.push(`${entry.value.type},${entry.value.multiplier}x,${entry.weight}`);
  }

  // REELS
  section('REELS_BASE');
  lines.push('Reel,Length,Symbols');
  for (let i = 0; i < BASE_REELS.length; i++) {
    const reel = BASE_REELS[i];
    const counts = countSymbols(reel);
    const symStr = counts.map((c) => `${c.symbol}:${c.count}`).join(' ');
    lines.push(`${i + 1},${reel.length},${symStr}`);
  }

  section('REELS_FREESPINS');
  lines.push('Reel,Length,Symbols');
  for (let i = 0; i < FREE_SPINS_REELS.length; i++) {
    const reel = FREE_SPINS_REELS[i];
    const counts = countSymbols(reel);
    const symStr = counts.map((c) => `${c.symbol}:${c.count}`).join(' ');
    lines.push(`${i + 1},${reel.length},${symStr}`);
  }

  // HISTOGRAM
  section('HISTOGRAM');
  lines.push('Bucket,Count,Percentage,RTP Contribution');
  for (const bin of stats.histogram) {
    const pct = (bin.count / stats.spinCount) * 100;
    lines.push(`${bin.label},${bin.count},${pct.toFixed(4)}%,${bin.rtpContribution.toFixed(4)}%`);
  }

  // TOP WINS
  section('TOP_WINS');
  lines.push('Rank,Win,Spin Index');
  for (let i = 0; i < Math.min(20, stats.topWins.length); i++) {
    const win = stats.topWins[i];
    lines.push(`${i + 1},${win.winX.toFixed(2)}x,${win.spinIndex}`);
  }

  // PERFORMANCE
  section('PERFORMANCE');
  lines.push(`Volatility Index,${stats.volatility.index.toFixed(2)}`);
  lines.push(`Std Deviation,${stats.volatility.stdDev.toFixed(4)}`);
  lines.push(`100x+ Rate,${stats.extremes.tail100x.toFixed(4)}%`);
  lines.push(`500x+ Rate,${stats.extremes.tail500x.toFixed(4)}%`);
  lines.push(`1000x+ Rate,${stats.extremes.tail1000x.toFixed(6)}%`);

  return lines.join('\n');
}

export function generateOutputPath(args: CLIArgs): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 16);

  const spinsLabel = args.spins >= 1_000_000
    ? `${Math.round(args.spins / 1_000_000)}M`
    : `${Math.round(args.spins / 1000)}K`;

  const folderName = `${timestamp}_spins${spinsLabel}_seed${args.seed}_workers${args.workers}`;
  return join(args.out, 'sim_runs', folderName);
}

export function saveReports(
  stats: SimulationStatistics,
  args: CLIArgs,
  elapsedMs: number,
  spinsPerSecond: number
): { reportPath: string; parPath: string; configPath: string } {
  const outputDir = generateOutputPath(args);

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Generate and save SimReport.json
  const report = generateSimReport(stats, args, elapsedMs, spinsPerSecond);
  const reportPath = join(outputDir, 'SimReport.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Generate and save PAR.csv
  const parCsv = generatePARCsv(stats, args);
  const parPath = join(outputDir, 'PAR.csv');
  writeFileSync(parPath, parCsv);

  // Save config snapshot
  const configSnapshot = {
    generatedAt: new Date().toISOString(),
    args,
    gameConfig: GAME_CONFIG,
    paytable: LINE_PAYTABLE,
    scatter: SCATTER_PAYTABLE,
    orbValues: ORB_VALUE_TABLE,
    paylines: PAYLINES,
    reels: {
      base: BASE_REELS,
      freeSpins: FREE_SPINS_REELS
    }
  };
  const configPath = join(outputDir, 'config_snapshot.json');
  writeFileSync(configPath, JSON.stringify(configSnapshot, null, 2));

  return { reportPath, parPath, configPath };
}
