/**
 * SLOT MATH ENGINE TEMPLATE - Monte Carlo Simulator
 *
 * High-performance simulation engine:
 * - Single-threaded optimized loop
 * - Streaming statistics (no memory bloat)
 * - Progress reporting
 * - Seed control for reproducibility
 * - H&W + FS dual feature tracking
 */

import { RNG, createRng } from '../engine/rng.js';
import { spin } from '../engine/spin.js';
import { evaluate } from '../engine/evaluate.js';
import { runFreeSpinsQuick } from '../engine/features.js';
import { runHnWQuick } from '../engine/holdAndWin.js';
import { GAME_CONFIG } from '../config/gameConfig.js';
import { SimulationStats, SimulationResults } from './stats.js';

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  spins: number;
  seed?: number;
  progressInterval?: number;  // Report progress every N spins
  verbose?: boolean;
}

/**
 * Progress callback type
 */
export type ProgressCallback = (
  spinsCompleted: number,
  totalSpins: number,
  currentRTP: number
) => void;

/**
 * Run simulation
 */
export async function runSimulation(
  config: SimulationConfig,
  onProgress?: ProgressCallback
): Promise<SimulationResults> {
  const {
    spins,
    seed = Date.now(),
    progressInterval = 1_000_000,
    verbose = false
  } = config;

  const rng = createRng(seed);
  const stats = new SimulationStats();
  const bet = GAME_CONFIG.defaultBet;

  const startTime = Date.now();
  let lastProgressTime = startTime;

  if (verbose) {
    console.log(`\n⚡ SLOT MATH ENGINE - Simulation Started`);
    console.log(`   Spins: ${spins.toLocaleString()}`);
    console.log(`   Seed: ${seed}`);
    console.log(`   Target RTP: ${(GAME_CONFIG.targetRTP * 100).toFixed(2)}%`);
    console.log(`   Features: Free Spins + Hold & Win\n`);
  }

  for (let i = 0; i < spins; i++) {
    // Base game spin
    const spinData = spin(rng, false);
    const evaluation = evaluate(spinData.grid, rng, 1);

    // Record base spin
    stats.recordBaseSpin(
      bet,
      evaluation.lineWinTotal,
      evaluation.scatterWin,
      evaluation.multiplier,
      evaluation.baseWin,
      evaluation.totalWin,
      evaluation.triggeredFS,
      evaluation.triggeredHnW
    );

    // Handle Free Spins if triggered
    if (evaluation.triggeredFS) {
      const fsResult = runFreeSpinsQuick(rng, evaluation.freeSpinsAwarded);

      stats.recordFreeSpinsSession(
        fsResult.totalWin,
        fsResult.totalSpins,
        fsResult.retriggersCount,
        bet
      );
    }

    // Handle Hold & Win if triggered
    if (evaluation.triggeredHnW) {
      const hnwResult = runHnWQuick(spinData.grid, rng);

      stats.recordHnWSession(
        hnwResult.totalWin,
        hnwResult.orbCount,
        hnwResult.respins,
        hnwResult.fullGridJackpot,
        bet
      );
    }

    // Progress reporting
    if (onProgress && (i + 1) % progressInterval === 0) {
      const currentRTP = stats.totalWin / stats.totalBet;
      onProgress(i + 1, spins, currentRTP);
    }

    if (verbose && (i + 1) % progressInterval === 0) {
      const now = Date.now();
      const elapsed = (now - startTime) / 1000;
      const spinsPerSec = (i + 1) / elapsed;
      const currentRTP = (stats.totalWin / stats.totalBet) * 100;
      const remaining = (spins - i - 1) / spinsPerSec;

      console.log(
        `   Progress: ${((i + 1) / spins * 100).toFixed(1)}% | ` +
        `RTP: ${currentRTP.toFixed(3)}% | ` +
        `Speed: ${Math.round(spinsPerSec).toLocaleString()}/s | ` +
        `ETA: ${formatTime(remaining)}`
      );
    }
  }

  const endTime = Date.now();
  const totalTime = (endTime - startTime) / 1000;

  if (verbose) {
    console.log(`\n✅ Simulation Complete`);
    console.log(`   Time: ${formatTime(totalTime)}`);
    console.log(`   Speed: ${Math.round(spins / totalTime).toLocaleString()} spins/sec\n`);
  }

  return stats.getResults();
}

/**
 * Run quick validation simulation
 */
export async function runQuickSim(seed?: number): Promise<SimulationResults> {
  return runSimulation({
    spins: GAME_CONFIG.simulation.quickSpins,
    seed,
    verbose: true
  });
}

/**
 * Run full certification simulation
 */
export async function runFullSim(seed?: number): Promise<SimulationResults> {
  return runSimulation({
    spins: GAME_CONFIG.simulation.fullSpins,
    seed,
    verbose: true
  });
}

/**
 * Run multi-seed batch simulation
 */
export async function runBatchSimulation(
  spinsPerSeed: number,
  seeds: number[],
  verbose: boolean = false
): Promise<{
  results: SimulationResults[];
  aggregate: AggregateResults;
}> {
  const results: SimulationResults[] = [];

  for (let i = 0; i < seeds.length; i++) {
    if (verbose) {
      console.log(`\n━━━ Seed ${i + 1}/${seeds.length}: ${seeds[i]} ━━━`);
    }

    const result = await runSimulation({
      spins: spinsPerSeed,
      seed: seeds[i],
      verbose
    });

    results.push(result);
  }

  // Aggregate results
  const aggregate = aggregateResults(results);

  if (verbose) {
    console.log('\n━━━ AGGREGATE RESULTS ━━━');
    console.log(`   Seeds: ${seeds.length}`);
    console.log(`   Total spins: ${(spinsPerSeed * seeds.length).toLocaleString()}`);
    console.log(`   Mean RTP: ${aggregate.meanRTP.toFixed(4)}%`);
    console.log(`   RTP Range: ${aggregate.minRTP.toFixed(4)}% - ${aggregate.maxRTP.toFixed(4)}%`);
    console.log(`   RTP StdDev: ${aggregate.rtpStdDev.toFixed(4)}%`);
  }

  return { results, aggregate };
}

/**
 * Aggregate results interface
 */
export interface AggregateResults {
  seedCount: number;
  totalSpins: number;

  meanRTP: number;
  minRTP: number;
  maxRTP: number;
  rtpStdDev: number;

  meanHitRate: number;
  meanFSFrequency: number;
  meanHnWFrequency: number;

  maxObservedWin: number;
}

/**
 * Aggregate multiple simulation results
 */
function aggregateResults(results: SimulationResults[]): AggregateResults {
  const n = results.length;

  const rtps = results.map(r => r.rtpPercent);
  const meanRTP = rtps.reduce((a, b) => a + b, 0) / n;
  const rtpVariance = rtps.reduce((sum, rtp) => sum + Math.pow(rtp - meanRTP, 2), 0) / (n - 1);
  const rtpStdDev = Math.sqrt(rtpVariance);

  return {
    seedCount: n,
    totalSpins: results.reduce((sum, r) => sum + r.totalSpins, 0),

    meanRTP,
    minRTP: Math.min(...rtps),
    maxRTP: Math.max(...rtps),
    rtpStdDev,

    meanHitRate: results.reduce((sum, r) => sum + r.hitRatePercent, 0) / n,
    meanFSFrequency: results.reduce((sum, r) => sum + r.fsFrequency, 0) / n,
    meanHnWFrequency: results.reduce((sum, r) => sum + r.hnwFrequency, 0) / n,

    maxObservedWin: Math.max(...results.map(r => r.maxWin))
  };
}

/**
 * Format seconds to human readable time
 */
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}
