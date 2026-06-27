export type JackpotTierName = 'Mini' | 'Minor' | 'Major' | 'Grand' | 'Mega' | string;

export interface JackpotTier {
  name: JackpotTierName;
  poolValue: number;
  seedValue: number;
  contributionRate: number;
  mustHitByMax?: number;
  minThreshold?: number;
}

export type JackpotPaymentStatus = 'pending' | 'committed' | 'rolled_back' | 'failed';

export interface JackpotPendingPayment {
  pendingId: string;
  spinId: string;
  tierName: JackpotTierName;
  amount: number;
  startedAt: number;
  status: JackpotPaymentStatus;
  retryCount: number;
  committedAt?: number;
  rolledBackAt?: number;
  failureReason?: string;
}

export type JackpotEvent =
  | { kind: 'jackpot_payment_required'; pendingId: string; tierName: JackpotTierName; amount: number }
  | { kind: 'jackpot_insufficient_funds'; tierName: JackpotTierName; requested: number; available: number }
  | { kind: 'jackpot_committed'; pendingId: string; spinId: string; amount: number }
  | { kind: 'jackpot_rolled_back'; pendingId: string; reason: string }
  | { kind: 'jackpot_failed'; pendingId: string; reason: string }
  | { kind: 'tier_contributed'; tierName: JackpotTierName; contribution: number; newPool: number }
  | { kind: 'must_hit_by_approaching'; tierName: JackpotTierName; poolValue: number; cap: number };
