export type ObservabilityMode = 'dev' | 'prod';

export interface SpinRecord {
  bet: number;
  payout: number;
  features: FeatureHit[];
  timestamp?: number;
}

export interface FeatureHit {
  kind: string;
  payout: number;
}

export interface FeatureContribution {
  featureKind: string;
  hitCount: number;
  totalPayout: number;
  avgPayout: number;
  contributionPct: number;
}

export interface PercentileStats {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface AlertThreshold {
  metric: 'rtp' | 'hitRate';
  min?: number;
  max?: number;
}

export interface AlertFired {
  threshold: AlertThreshold;
  actual: number;
  spinIndex: number;
  message: string;
}

export interface SessionSnapshot {
  sessionId: string;
  mode: ObservabilityMode;
  totalSpins: number;
  totalBet: number;
  totalPayout: number;
  rtp: number;
  hitRate: number;
  winSpins: number;
  featureContributions: FeatureContribution[];
  avgPayout: number;
  drySpellCurrent: number;
  drySpellMax: number;
  alertsFired: AlertFired[];
  elapsedMs: number;
}

export interface ObservabilityReport extends SessionSnapshot {
  finalizedAt: number;
  variance?: number;
  stdDev?: number;
  percentiles?: PercentileStats;
  payoutHistogram?: Record<string, number>;
}
