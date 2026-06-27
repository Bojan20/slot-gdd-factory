export type PlayerProfile = 'casual' | 'regular' | 'high_roller' | 'whale';

export interface PlayerBehaviorModel {
  profile: PlayerProfile;
  targetSessionMinutes: number;
  sessionDurationStdDev: number;
  spinsPerMinute: number;
  churnAfterLosses: number;
  betFractionOfBankroll: number;
  recencyBias: number;
}

export const PLAYER_PROFILES: Record<PlayerProfile, PlayerBehaviorModel> = {
  casual: {
    profile: 'casual',
    targetSessionMinutes: 20,
    sessionDurationStdDev: 10,
    spinsPerMinute: 10,
    churnAfterLosses: 8,
    betFractionOfBankroll: 0.05,
    recencyBias: 0.6,
  },
  regular: {
    profile: 'regular',
    targetSessionMinutes: 45,
    sessionDurationStdDev: 15,
    spinsPerMinute: 15,
    churnAfterLosses: 15,
    betFractionOfBankroll: 0.02,
    recencyBias: 0.4,
  },
  high_roller: {
    profile: 'high_roller',
    targetSessionMinutes: 90,
    sessionDurationStdDev: 30,
    spinsPerMinute: 20,
    churnAfterLosses: 25,
    betFractionOfBankroll: 0.01,
    recencyBias: 0.3,
  },
  whale: {
    profile: 'whale',
    targetSessionMinutes: 180,
    sessionDurationStdDev: 60,
    spinsPerMinute: 25,
    churnAfterLosses: 50,
    betFractionOfBankroll: 0.005,
    recencyBias: 0.2,
  },
};

export interface SessionSimConfig {
  profile: PlayerBehaviorModel;
  initialBankroll: number;
  gameRtp: number;
  gameHitRate: number;
  gameVolatility?: number;
  numSessions?: number;
  seed?: number;
}

export interface SpinOutcome {
  bet: number;
  win: number;
  bankroll: number;
  consecutiveLosses: number;
}

export interface SessionOutcome {
  sessionId: number;
  totalSpins: number;
  totalWagered: number;
  totalWon: number;
  finalBankroll: number;
  durationMinutes: number;
  churnReason: 'bankrupt' | 'time_limit' | 'loss_streak' | 'target_reached';
  perceivedRtp: number;
  mathematicalRtp: number;
  spins: SpinOutcome[];
}

export interface PlayerSimulationResult {
  profile: PlayerProfile;
  numSessions: number;
  avgSessionDuration: number;
  avgSpinsPerSession: number;
  avgTotalWagered: number;
  avgTotalWon: number;
  avgPerceivedRtp: number;
  mathRtp: number;
  churnReasons: Record<string, number>;
  bankruptcyRate: number;
  lossStreakChurnRate: number;
  sessions: SessionOutcome[];
}
