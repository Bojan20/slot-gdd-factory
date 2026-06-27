export type FraudSignalKind =
  | 'velocity_excess'
  | 'win_rate_anomaly'
  | 'payout_pattern'
  | 'bet_pattern_exploit'
  | 'jackpot_clustering';

export interface FraudSignal {
  kind: FraudSignalKind;
  severity: 'info' | 'warning' | 'critical';
  confidence: number;
  message: string;
  detail: Record<string, unknown>;
  detectedAt: number;
}

export interface FraudSessionRecord {
  sessionId: string;
  playerId?: string;
  spins: FraudSpinRecord[];
  sessionStartMs: number;
  lastSpinMs: number;
}

export interface FraudSpinRecord {
  spinIndex: number;
  timestampMs: number;
  bet: number;
  win: number;
  isJackpot?: boolean;
}

export interface FraudReport {
  sessionId: string;
  signals: FraudSignal[];
  riskScore: number;
  flagged: boolean;
  recommendation: 'allow' | 'review' | 'block';
}

export interface FraudDetectorConfig {
  expectedWinRate: number;
  maxSpinsPerMinute?: number;
  winRateSigmaThreshold?: number;
  consecutiveWinsThreshold?: number;
  flagThreshold?: number;
  maxJackpotHitsPerSession?: number;
}
