/**
 * Parallel Simulation Coordinator
 *
 * Manages worker threads and merges results for large-scale simulations.
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { StatsAccumulator, SimulationStatistics } from './accumulator.js';
import { deriveWorkerSeeds } from '../utils/hash.js';
import { WorkerInput, WorkerOutput, WorkerProgress } from './worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ParallelSimOptions {
  totalSpins: number;
  bet: number;
  baseSeed: number;
  workerCount: number;
  mode: 'base' | 'fs' | 'full';
  onProgress?: (progress: SimulationProgress) => void;
}

export interface SimulationProgress {
  spinsCompleted: number;
  totalSpins: number;
  percentComplete: number;
  currentRtp: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  spinsPerSecond: number;
}

export interface ParallelSimResult {
  statistics: SimulationStatistics;
  elapsedMs: number;
  spinsPerSecond: number;
  workerStats: {
    workerIndex: number;
    spinsCompleted: number;
    elapsedMs: number;
  }[];
}

export async function runParallelSimulation(
  options: ParallelSimOptions
): Promise<ParallelSimResult> {
  const { totalSpins, bet, baseSeed, workerCount, mode, onProgress } = options;

  const startTime = performance.now();
  const workerSeeds = deriveWorkerSeeds(baseSeed, workerCount);

  // Distribute spins across workers
  const spinsPerWorker = Math.floor(totalSpins / workerCount);
  const remainder = totalSpins % workerCount;

  const workerPromises: Promise<WorkerOutput>[] = [];
  const workerProgress: Map<number, WorkerProgress> = new Map();

  // Path to compiled worker
  const workerPath = join(__dirname, 'worker.js');

  for (let i = 0; i < workerCount; i++) {
    const spinsForThisWorker = spinsPerWorker + (i < remainder ? 1 : 0);
    const startSpinIndex = i * spinsPerWorker + Math.min(i, remainder);

    const input: WorkerInput = {
      workerIndex: i,
      seed: workerSeeds[i],
      spinsToRun: spinsForThisWorker,
      bet,
      mode,
      startSpinIndex
    };

    const promise = new Promise<WorkerOutput>((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: input });

      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          workerProgress.set(msg.data.workerIndex, msg.data);

          if (onProgress) {
            const totalCompleted = Array.from(workerProgress.values())
              .reduce((sum, p) => sum + p.spinsCompleted, 0);
            const avgRtp = Array.from(workerProgress.values())
              .reduce((sum, p) => sum + p.currentRtp, 0) / workerProgress.size;
            const elapsed = performance.now() - startTime;
            const spinsPerSecond = totalCompleted / (elapsed / 1000);
            const remaining = (totalSpins - totalCompleted) / spinsPerSecond * 1000;

            onProgress({
              spinsCompleted: totalCompleted,
              totalSpins,
              percentComplete: (totalCompleted / totalSpins) * 100,
              currentRtp: avgRtp,
              elapsedMs: elapsed,
              estimatedRemainingMs: remaining,
              spinsPerSecond
            });
          }
        } else if (msg.type === 'complete') {
          resolve(msg.data);
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker ${i} exited with code ${code}`));
        }
      });
    });

    workerPromises.push(promise);
  }

  // Wait for all workers to complete
  const workerOutputs = await Promise.all(workerPromises);

  // Merge results
  const mainAccumulator = new StatsAccumulator(bet, 0);

  for (const output of workerOutputs) {
    mainAccumulator.merge(output.data);
  }

  const elapsedMs = performance.now() - startTime;
  const statistics = mainAccumulator.getStatistics();

  return {
    statistics,
    elapsedMs,
    spinsPerSecond: totalSpins / (elapsedMs / 1000),
    workerStats: workerOutputs.map((o) => ({
      workerIndex: o.workerIndex,
      spinsCompleted: o.spinsCompleted,
      elapsedMs: o.elapsedMs
    }))
  };
}

/**
 * Run simulation in a single thread (fallback for small runs or debugging)
 */
export function runSingleThreadSimulation(
  options: Omit<ParallelSimOptions, 'workerCount'>
): ParallelSimResult {
  // Import worker function directly for single-thread execution
  const { runSimulation } = require('./worker.js');

  const startTime = performance.now();

  const input: WorkerInput = {
    workerIndex: 0,
    seed: options.baseSeed,
    spinsToRun: options.totalSpins,
    bet: options.bet,
    mode: options.mode,
    startSpinIndex: 0
  };

  const output = runSimulation(input);

  const accumulator = new StatsAccumulator(options.bet, 0);
  accumulator.merge(output.data);

  const elapsedMs = performance.now() - startTime;
  const statistics = accumulator.getStatistics();

  return {
    statistics,
    elapsedMs,
    spinsPerSecond: options.totalSpins / (elapsedMs / 1000),
    workerStats: [{
      workerIndex: 0,
      spinsCompleted: output.spinsCompleted,
      elapsedMs: output.elapsedMs
    }]
  };
}
