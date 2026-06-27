/**
 * Analytical Memoization — Types (Faza 14.1).
 *
 * All types used by the AnalyticalEngine for exhaustive grid enumeration,
 * exact RTP computation, and sub-millisecond query via memoization.
 */

export interface AnalyticalTableEntry {
  gridHash: string;
  grid: string[][];
  payout: number;
  probability: number;
}

export interface AnalyticalTable {
  gameId: string;
  totalStates: number;
  computedAt: number;
  analyticalRtp: number;
  analyticalHitRate: number;
  entries: Map<string, AnalyticalTableEntry>;
}

export interface AnalyticalBuildConfig {
  maxStates?: number;
}

export interface InstantSpinResult {
  payout: number;
  probability: number;
  fromCache: boolean;
}
