import type { SlotGameIR } from '../ir/types.js';

export interface SensitivityDelta {
  reelIndex: number;       // -1 = all reels
  symbolId: string;
  delta: number;           // fractional change applied (e.g. 0.1)
  rtpDelta: number;        // absolute RTP change
  hitRateDelta: number;
  sensitivity: number;     // rtpDelta / delta
}

export interface SensitivityReport {
  baseRtp: number;
  baseHitRate: number;
  deltas: SensitivityDelta[];
  topInfluencers: SensitivityDelta[];  // top 5 by |sensitivity|
}

export interface InverseSolverConfig {
  targetRtp: number;
  varySymbol: string;
  varyReels?: number[];
  tolerance?: number;       // default 0.001
  maxIterations?: number;   // default 50
  evalSpins?: number;       // default 10000
}

export interface InverseSolverResult {
  converged: boolean;
  iterations: number;
  achievedRtp: number;
  targetRtp: number;
  error: number;
  solvedIr: SlotGameIR;
  weightChange: number;
}

export interface AutoTunerConfig {
  targetRtp: number;
  targetHitRate?: number;
  rtpTolerance?: number;   // default 0.005
  maxIterations?: number;  // default 20
  evalSpins?: number;      // default 10000
}

export interface AutoTunerResult {
  converged: boolean;
  achievedRtp: number;
  achievedHitRate?: number;
  iterations: number;
  solvedIr: SlotGameIR;
}
