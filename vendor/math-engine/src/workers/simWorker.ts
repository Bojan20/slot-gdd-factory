/**
 * SLOT MATH ENGINE TEMPLATE - Piscina Simulation Worker
 *
 * High-performance worker for parallel Monte Carlo simulation.
 * Uses Mulberry32 for deterministic RNG (matches Rust simulator).
 *
 * This worker is spawned by piscina and receives:
 * - seed: deterministic seed for this worker
 * - spins: number of spins to simulate
 * - bet: bet size
 * - mode: 'base' | 'fs' | 'full'
 *
 * Returns aggregated statistics that can be merged with other workers.
 */

import { RNG } from '../engine/rng.js';
import { spin } from '../engine/spin.js';
import { evaluate } from '../engine/evaluate.js';
import { runFreeSpinsQuick } from '../engine/features.js';
import { runHnWQuick } from '../engine/holdAndWin.js';
import { StatsAccumulator, AccumulatorData } from '../sim/accumulator.js';

export interface WorkerTask {
  workerId: number;
  seed: number;
  spins: number;
  bet: number;
  mode: 'base' | 'fs' | 'full';
}

export interface WorkerResult {
  workerId: number;
  data: AccumulatorData;
  spinsCompleted: number;
  elapsedMs: number;
}

/**
 * Main worker function - exported for piscina
 */
export default function runSimulationWorker(task: WorkerTask): WorkerResult {
  const startTime = performance.now();
  const rng = new RNG(task.seed);
  const accumulator = new StatsAccumulator(task.bet, task.workerId);

  for (let i = 0; i < task.spins; i++) {
    // Generate base game spin
    const spinData = spin(rng, false);

    // Evaluate base game
    const result = evaluate(spinData.grid, rng, 1);

    // Record base spin
    accumulator.recordBaseSpin(
      result.lineWinTotal,
      result.scatterWin,
      result.multiplier,
      result.triggeredFS,
      result.triggeredHnW
    );

    // Handle Free Spins if triggered and mode allows
    if (result.triggeredFS && task.mode !== 'base') {
      const fsResult = runFreeSpinsQuick(
        rng,
        result.freeSpinsAwarded
      );

      accumulator.recordFreeSpinsSession(
        fsResult.totalWin,
        fsResult.totalSpins,
        fsResult.retriggersCount,
        result.scatterWin * result.multiplier,
        fsResult.maxMultiplier
      );
    }

    // Handle Hold & Win if triggered and mode allows
    if (result.triggeredHnW && task.mode !== 'base') {
      const hnwResult = runHnWQuick(spinData.grid, rng);

      accumulator.recordHnWSession(
        hnwResult.totalWin,
        hnwResult.orbCount,
        hnwResult.respins,
        hnwResult.fullGridJackpot
      );
    }
  }

  const elapsedMs = performance.now() - startTime;

  return {
    workerId: task.workerId,
    data: accumulator.getData(),
    spinsCompleted: task.spins,
    elapsedMs
  };
}
