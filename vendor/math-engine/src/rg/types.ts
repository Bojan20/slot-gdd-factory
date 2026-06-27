export type RGJurisdiction = 'UKGC' | 'DE' | 'IT' | 'NL' | 'SE' | 'default';

export const MIN_SPIN_MS: Record<RGJurisdiction, number> = {
  UKGC: 2500, DE: 5000, IT: 3000, NL: 3000, SE: 3000, default: 0,
};

export interface RGLimits {
  maxLossPerSession?: number;
  maxLossPerDay?: number;
  maxWagerPerSpin?: number;
  maxSessionDurationMs?: number;
  realityCheckIntervalMs?: number;
  selfExcluded?: boolean;
}

export interface RGSessionState {
  sessionId: string;
  startTime: number;
  totalWagered: number;
  totalWon: number;
  netLoss: number;
  spinCount: number;
  lastRealityCheckAt: number;
  jurisdiction: RGJurisdiction;
  limits: RGLimits;
}

export type RGDecision =
  | { allow: true }
  | { allow: false; reason: RGRefusalReason; message: string };

export type RGRefusalReason =
  | 'self_excluded'
  | 'max_loss_session'
  | 'max_session_duration'
  | 'min_spin_time_not_elapsed'
  | 'max_wager_exceeded';

export interface RGEvent {
  kind:
    | 'spin_allowed'
    | 'spin_refused'
    | 'reality_check_due'
    | 'session_limit_warning'
    | 'aml_velocity_flag';
  sessionId: string;
  timestamp: number;
  detail: Record<string, unknown>;
}

export interface AMLConfig {
  maxSpinsPerMinute?: number;
  cashOutHoldThreshold?: number;
  winRateSigmaThreshold?: number;
}

export interface AMLState {
  recentSpinTimestamps: number[];
  consecutiveWins: number;
  totalWins: number;
  totalSpins: number;
  flagged: boolean;
  flagReason?: string;
}
