import type { SlotGameIR } from '../ir/types.js';
import { runIRSimulation } from '../engine/irSimulator.js';
import type { OptimizerConfig, OptimizationResult, OptimizerIteration } from './types.js';

// ─── helpers ──────────────────────────────────────────────────────────────

function deepCloneIR(ir: SlotGameIR): SlotGameIR {
  return JSON.parse(JSON.stringify(ir)) as SlotGameIR;
}

function computeLoss(
  rtp: number,
  hitRate: number,
  targetRtp: number,
  targetHitRate: number | undefined,
  rtpWeight: number,
  hitRateWeight: number,
): number {
  const rtpErr = rtp - targetRtp;
  let loss = rtpWeight * rtpErr * rtpErr;
  if (targetHitRate != null) {
    const hrErr = hitRate - targetHitRate;
    loss += hitRateWeight * hrErr * hrErr;
  }
  return loss;
}

function extractWeights(
  ir: SlotGameIR,
  symbolIds: string[],
): Record<string, number> {
  if (ir.reels.mode !== 'weighted') return {};
  const reels = ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>;
  const weights: Record<string, number> = {};
  // Average weight across reels for each symbol (for reporting)
  for (const symId of symbolIds) {
    let total = 0;
    let count = 0;
    for (const reelMap of reels.base) {
      if (symId in reelMap) {
        total += reelMap[symId] ?? 0;
        count++;
      }
    }
    weights[symId] = count > 0 ? total / count : 0;
  }
  return weights;
}

function setWeights(
  ir: SlotGameIR,
  symbolId: string,
  weight: number,
  minWeight: number,
  maxWeight: number,
): void {
  if (ir.reels.mode !== 'weighted') return;
  const reels = ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>;
  const clamped = Math.max(minWeight, Math.min(maxWeight, Math.round(weight)));
  for (const reelMap of reels.base) {
    if (symbolId in reelMap) {
      reelMap[symbolId] = clamped;
    }
  }
}

function getAvgWeight(ir: SlotGameIR, symbolId: string): number {
  if (ir.reels.mode !== 'weighted') return 0;
  const reels = ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>;
  let total = 0;
  let count = 0;
  for (const reelMap of reels.base) {
    if (symbolId in reelMap) {
      total += reelMap[symbolId] ?? 0;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

// ─── ReelStripOptimizer ────────────────────────────────────────────────────

export class ReelStripOptimizer {
  private readonly config: Required<OptimizerConfig>;

  constructor(config: OptimizerConfig) {
    this.config = {
      target: config.target,
      varySymbols: config.varySymbols ?? [],
      maxIterations: config.maxIterations ?? 30,
      learningRate: config.learningRate ?? 0.2,
      evalSpins: config.evalSpins ?? 5000,
      seed: config.seed ?? 42,
      minWeight: config.minWeight ?? 1,
      maxWeight: config.maxWeight ?? 1000,
    };
  }

  async optimize(ir: SlotGameIR): Promise<OptimizationResult> {
    // Non-weighted: return gracefully
    if (ir.reels.mode !== 'weighted') {
      return {
        converged: false,
        iterations: 0,
        finalRtp: 0,
        finalHitRate: 0,
        finalLoss: 0,
        targetRtp: this.config.target.rtp,
        solvedIr: ir,
        history: [],
        rtpError: Math.abs(this.config.target.rtp),
        hitRateError: this.config.target.hitRate != null
          ? Math.abs(this.config.target.hitRate)
          : undefined,
      };
    }

    const {
      target,
      maxIterations,
      learningRate: lr,
      evalSpins,
      seed,
      minWeight,
      maxWeight,
    } = this.config;

    const targetRtp = target.rtp;
    const targetHitRate = target.hitRate;
    const rtpWeight = target.rtpWeight ?? 1.0;
    const hitRateWeight = target.hitRateWeight ?? 1.0;
    const rtpTolerance = target.rtpTolerance ?? 0.01;

    // Determine which symbols to vary
    const reels = ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>;
    let varySymbols = this.config.varySymbols;
    if (varySymbols.length === 0) {
      // Default: all symbols present in reels
      const symSet = new Set<string>();
      for (const reelMap of reels.base) {
        for (const key of Object.keys(reelMap)) symSet.add(key);
      }
      varySymbols = Array.from(symSet);
    }

    // Work on a deep clone
    let currentIr = deepCloneIR(ir);
    const history: OptimizerIteration[] = [];
    let converged = false;

    // Evaluate initial state
    let simResult = await runIRSimulation(currentIr, { spins: evalSpins, seed });
    let currentRtp = simResult.rtp;
    let currentHitRate = simResult.hitRate;
    let currentLoss = computeLoss(
      currentRtp, currentHitRate, targetRtp, targetHitRate, rtpWeight, hitRateWeight,
    );

    // Record iteration 0 (initial state)
    history.push({
      iteration: 0,
      rtp: currentRtp,
      hitRate: currentHitRate,
      loss: currentLoss,
      weights: extractWeights(currentIr, varySymbols),
    });

    for (let iter = 1; iter <= maxIterations; iter++) {
      // Check convergence
      if (Math.abs(currentRtp - targetRtp) < rtpTolerance) {
        converged = true;
        break;
      }

      // Coordinate-wise gradient descent
      for (const symId of varySymbols) {
        const currentWeight = getAvgWeight(currentIr, symId);
        if (currentWeight <= 0) continue;

        // Try increasing weight by factor (1 + lr)
        const irInc = deepCloneIR(currentIr);
        setWeights(irInc, symId, currentWeight * (1 + lr), minWeight, maxWeight);
        const simInc = await runIRSimulation(irInc, { spins: evalSpins, seed });
        const lossInc = computeLoss(
          simInc.rtp, simInc.hitRate, targetRtp, targetHitRate, rtpWeight, hitRateWeight,
        );

        // Try decreasing weight by factor (1 - lr)
        const irDec = deepCloneIR(currentIr);
        setWeights(irDec, symId, currentWeight * (1 - lr), minWeight, maxWeight);
        const simDec = await runIRSimulation(irDec, { spins: evalSpins, seed });
        const lossDec = computeLoss(
          simDec.rtp, simDec.hitRate, targetRtp, targetHitRate, rtpWeight, hitRateWeight,
        );

        // Pick best move if it improves loss
        if (lossInc < currentLoss && lossInc <= lossDec) {
          currentIr = irInc;
          currentRtp = simInc.rtp;
          currentHitRate = simInc.hitRate;
          currentLoss = lossInc;
        } else if (lossDec < currentLoss) {
          currentIr = irDec;
          currentRtp = simDec.rtp;
          currentHitRate = simDec.hitRate;
          currentLoss = lossDec;
        }
        // else: no improvement, keep current
      }

      // Re-evaluate after full coordinate pass
      simResult = await runIRSimulation(currentIr, { spins: evalSpins, seed });
      currentRtp = simResult.rtp;
      currentHitRate = simResult.hitRate;
      currentLoss = computeLoss(
        currentRtp, currentHitRate, targetRtp, targetHitRate, rtpWeight, hitRateWeight,
      );

      history.push({
        iteration: iter,
        rtp: currentRtp,
        hitRate: currentHitRate,
        loss: currentLoss,
        weights: extractWeights(currentIr, varySymbols),
      });

      if (Math.abs(currentRtp - targetRtp) < rtpTolerance) {
        converged = true;
        break;
      }
    }

    return {
      converged,
      iterations: history.length - 1, // excludes the initial iteration 0
      finalRtp: currentRtp,
      finalHitRate: currentHitRate,
      finalLoss: currentLoss,
      targetRtp,
      solvedIr: currentIr,
      history,
      rtpError: Math.abs(currentRtp - targetRtp),
      hitRateError: targetHitRate != null
        ? Math.abs(currentHitRate - targetHitRate)
        : undefined,
    };
  }
}
