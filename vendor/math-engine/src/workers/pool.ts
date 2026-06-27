/**
 * SLOT MATH ENGINE TEMPLATE - Piscina Worker Pool Manager
 *
 * Professional worker pool using piscina for:
 * - Automatic thread management
 * - Optimal CPU utilization
 * - Clean task distribution
 * - Graceful shutdown
 *
 * Usage:
 *   const pool = new SimulationPool();
 *   const result = await pool.runSimulation({ ... });
 *   await pool.destroy();
 */

import { Piscina } from 'piscina';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { cpus } from 'os';
import { StatsAccumulator, SimulationStatistics } from '../sim/accumulator.js';
import type { WorkerTask, WorkerResult } from './simWorker.js';

// Derive unique seeds for each worker (simple mixing function)
function deriveWorkerSeeds(baseSeed: number, count: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    // Simple but effective mixing for worker seed derivation
    let h = (baseSeed ^ (i * 0x9e3779b9)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    seeds.push(h >>> 0);
  }
  return seeds;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PoolSimulationOptions {
  totalSpins: number;
  bet: number;
  baseSeed: number;
  mode: 'base' | 'fs' | 'full';
  workerCount?: number;
  onProgress?: (progress: PoolProgress) => void;
}

export interface PoolProgress {
  spinsCompleted: number;
  totalSpins: number;
  percentComplete: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  spinsPerSecond: number;
}

export interface PoolSimulationResult {
  statistics: SimulationStatistics;
  elapsedMs: number;
  spinsPerSecond: number;
  workerCount: number;
  workerStats: {
    workerId: number;
    spinsCompleted: number;
    elapsedMs: number;
  }[];
}

/**
 * Piscina-based simulation pool
 */
export class SimulationPool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pool: any;
  private isDestroyed = false;

  constructor(workerCount?: number) {
    const threads = workerCount ?? Math.max(1, cpus().length - 1);

    this.pool = new Piscina({
      filename: join(__dirname, 'simWorker.js'),
      minThreads: threads,
      maxThreads: threads,
      idleTimeout: 5000
    });
  }

  /**
   * Run parallel simulation across all workers
   */
  async runSimulation(options: PoolSimulationOptions): Promise<PoolSimulationResult> {
    if (this.isDestroyed) {
      throw new Error('Pool has been destroyed');
    }

    const startTime = performance.now();
    const workerCount = options.workerCount ?? this.pool.threads.length;
    const workerSeeds = deriveWorkerSeeds(options.baseSeed, workerCount);

    // Distribute spins across workers
    const spinsPerWorker = Math.floor(options.totalSpins / workerCount);
    const remainder = options.totalSpins % workerCount;

    // Create tasks
    const tasks: WorkerTask[] = [];
    for (let i = 0; i < workerCount; i++) {
      tasks.push({
        workerId: i,
        seed: workerSeeds[i],
        spins: spinsPerWorker + (i < remainder ? 1 : 0),
        bet: options.bet,
        mode: options.mode
      });
    }

    // Run all tasks in parallel
    const results = await Promise.all(
      tasks.map(task => this.pool.run(task) as Promise<WorkerResult>)
    );

    // Merge results
    const mainAccumulator = new StatsAccumulator(options.bet, 0);
    for (const result of results) {
      mainAccumulator.merge(result.data);
    }

    const elapsedMs = performance.now() - startTime;
    const statistics = mainAccumulator.getStatistics();

    // Call progress callback with final state
    if (options.onProgress) {
      options.onProgress({
        spinsCompleted: options.totalSpins,
        totalSpins: options.totalSpins,
        percentComplete: 100,
        elapsedMs,
        estimatedRemainingMs: 0,
        spinsPerSecond: options.totalSpins / (elapsedMs / 1000)
      });
    }

    return {
      statistics,
      elapsedMs,
      spinsPerSecond: options.totalSpins / (elapsedMs / 1000),
      workerCount,
      workerStats: results.map(r => ({
        workerId: r.workerId,
        spinsCompleted: r.spinsCompleted,
        elapsedMs: r.elapsedMs
      }))
    };
  }

  /**
   * Get current pool statistics
   */
  getStats() {
    return {
      threads: this.pool.threads.length,
      completed: this.pool.completed,
      utilization: this.pool.utilization
    };
  }

  /**
   * Gracefully shutdown the pool
   */
  async destroy(): Promise<void> {
    if (!this.isDestroyed) {
      this.isDestroyed = true;
      await this.pool.destroy();
    }
  }
}

/**
 * Quick helper for one-off simulations
 */
export async function runPooledSimulation(
  options: PoolSimulationOptions
): Promise<PoolSimulationResult> {
  const pool = new SimulationPool(options.workerCount);
  try {
    return await pool.runSimulation(options);
  } finally {
    await pool.destroy();
  }
}

/**
 * Get optimal worker count for this machine
 */
export function getOptimalWorkerCount(): number {
  return Math.max(1, cpus().length - 1);
}
