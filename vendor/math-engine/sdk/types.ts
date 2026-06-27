/**
 * @slot-math-engine/sdk — Public types for third-party developers.
 *
 * Anything exported from this file is part of the SDK's stable public
 * surface. Internal engine types live in src/ and are not exposed.
 */

export type Jurisdiction =
  | 'UKGC' | 'MGA' | 'NV' | 'NJ' | 'PA' | 'MI' | 'ON' | 'BC'
  | 'AAMS' | 'DGA' | 'SGA' | 'KSA' | 'GBGA' | 'SK' | 'AGCO' | 'GENERIC';

export type Topology =
  | 'rectangular'
  | 'cluster_grid'
  | 'megaways'
  | 'colossal'
  | 'multi_grid';

export interface TopologyConfig {
  kind: Topology;
  reels: number;
  rows: number | number[];
  ways?: number;
  lines?: number;
}

/** Symbol pool counts indexed by symbol-id. */
export type SymbolPool = Record<string, number>;

export interface PaytableEntry {
  symbol: string;
  /** Multiplier per line for k-of-a-kind. */
  payouts: Record<number, number>;
}

export interface FeatureConfig {
  /** Trigger condition: 'scatters' >= N or other. */
  trigger?: number;
  /** Outcome size. */
  count?: number;
  /** Multiplier or other numeric arg. */
  multiplier?: number;
  /** Extra options. */
  [key: string]: unknown;
}

export interface IRDocument {
  schemaVersion: '1.0' | '2.0';
  gameId: string;
  topology: TopologyConfig;
  symbols: SymbolPool;
  paytable?: PaytableEntry[];
  features?: Record<string, FeatureConfig>;
  rtpTarget?: number;
  jurisdictions?: Jurisdiction[];
  metadata?: Record<string, unknown>;
}

export interface RTPResult {
  /** Closed-form RTP estimate. */
  rtp: number;
  hitFrequency: number;
  variance: number;
  /** Monte-Carlo confidence half-width at 95%. */
  ciHalfWidth?: number;
  /** Method tag for audit. */
  method: 'closed-form' | 'monte-carlo' | 'hybrid';
}

export interface SpinResult {
  /** Server-authoritative spin id. */
  spinId: string;
  /** Symbols on each reel position. */
  reelStop: string[][];
  /** Total credits won this spin. */
  totalWin: number;
  /** Per-win breakdown. */
  wins: Array<{ payline: number; symbol: string; count: number; amount: number }>;
  /** Audit-trail hash. */
  hash: string;
  /** Wallet balance after this spin. */
  balance: number;
}

export interface ClientOptions {
  apiUrl: string;
  apiKey?: string;
  /** Total request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Override fetch implementation (used by tests). */
  fetch?: typeof fetch;
}

export interface ApiError extends Error {
  statusCode?: number;
  body?: unknown;
}

export interface RenderConfig {
  gameId: string;
  topology: TopologyConfig;
  rtp: number;
  irFile: string;
  /** UI-driver hints. */
  uiHints?: Record<string, unknown>;
}

export interface SeamlessHandshake {
  operatorId: string;
  /** Endpoint operator should call for wallet ops. */
  walletEndpoint: string;
  /** Endpoint operator should call for spin. */
  spinEndpoint: string;
  /** Public key the operator should verify signed responses with. */
  publicKey: string;
  /** Server timestamp for clock-skew check. */
  timestamp: string;
}
