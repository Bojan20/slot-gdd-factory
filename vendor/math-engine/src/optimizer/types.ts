import type { SlotGameIR } from '../ir/types.js';

export interface OptimizationTarget {
  rtp: number;
  hitRate?: number;
  rtpWeight?: number;
  hitRateWeight?: number;
  rtpTolerance?: number;
  hitRateTolerance?: number;
}

export interface OptimizerConfig {
  target: OptimizationTarget;
  varySymbols?: string[];
  maxIterations?: number;  // default 30
  learningRate?: number;   // default 0.2
  evalSpins?: number;      // default 5000
  seed?: number;
  minWeight?: number;      // default 1
  maxWeight?: number;      // default 1000
}

export interface OptimizerIteration {
  iteration: number;
  rtp: number;
  hitRate: number;
  loss: number;
  weights: Record<string, number>;
}

export interface OptimizationResult {
  converged: boolean;
  iterations: number;
  finalRtp: number;
  finalHitRate: number;
  finalLoss: number;
  targetRtp: number;
  solvedIr: SlotGameIR;
  history: OptimizerIteration[];
  rtpError: number;
  hitRateError?: number;
}
