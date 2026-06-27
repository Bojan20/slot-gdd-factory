import {
  type JackpotTier,
  type JackpotTierName,
  type JackpotEvent,
  type JackpotPendingPayment,
} from './types.js';

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface JackpotManagerConfig {
  tiers: JackpotTier[];
  maxRetries?: number;
  paymentTimeoutMs?: number;
}

export class JackpotManager {
  private readonly tiers: Map<JackpotTierName, JackpotTier>;
  private readonly maxRetries: number;
  private readonly paymentTimeoutMs: number;
  private readonly pending: Map<string, JackpotPendingPayment> = new Map();
  private readonly eventLog: JackpotEvent[] = [];

  constructor(config: JackpotManagerConfig) {
    this.tiers = new Map();
    for (const tier of config.tiers) {
      this.tiers.set(tier.name, { ...tier });
    }
    this.maxRetries = config.maxRetries ?? 3;
    this.paymentTimeoutMs = config.paymentTimeoutMs ?? 30_000;
  }

  private emit(event: JackpotEvent): void {
    this.eventLog.push(event);
  }

  contribute(wager: number): JackpotEvent[] {
    const events: JackpotEvent[] = [];
    for (const tier of this.tiers.values()) {
      const contribution = wager * tier.contributionRate;
      tier.poolValue += contribution;

      // Cap at mustHitByMax
      if (tier.mustHitByMax !== undefined && tier.poolValue > tier.mustHitByMax) {
        tier.poolValue = tier.mustHitByMax;
      }

      const contributed: JackpotEvent = {
        kind: 'tier_contributed',
        tierName: tier.name,
        contribution,
        newPool: tier.poolValue,
      };
      events.push(contributed);
      this.emit(contributed);

      // must_hit_by_approaching at 90% of cap
      if (
        tier.mustHitByMax !== undefined &&
        tier.poolValue >= tier.mustHitByMax * 0.9
      ) {
        const approaching: JackpotEvent = {
          kind: 'must_hit_by_approaching',
          tierName: tier.name,
          poolValue: tier.poolValue,
          cap: tier.mustHitByMax,
        };
        events.push(approaching);
        this.emit(approaching);
      }
    }
    return events;
  }

  canWin(tierName: JackpotTierName): boolean {
    const tier = this.tiers.get(tierName);
    if (!tier) return false;
    if (tier.poolValue <= 0) return false;
    if (tier.minThreshold !== undefined && tier.poolValue < tier.minThreshold) return false;
    return true;
  }

  beginJackpot(spinId: string, tierName: JackpotTierName, nowMs?: number): { pendingId: string; events: JackpotEvent[] } {
    const now = nowMs ?? Date.now();
    const events: JackpotEvent[] = [];
    const tier = this.tiers.get(tierName);

    if (!tier || tier.poolValue <= 0) {
      const available = tier?.poolValue ?? 0;
      const event: JackpotEvent = {
        kind: 'jackpot_insufficient_funds',
        tierName,
        requested: 0,
        available,
      };
      events.push(event);
      this.emit(event);
      return { pendingId: '', events };
    }

    const pendingId = uuid();
    const amount = tier.poolValue;

    // Reserve the pool (set to 0)
    tier.poolValue = 0;

    const payment: JackpotPendingPayment = {
      pendingId,
      spinId,
      tierName,
      amount,
      startedAt: now,
      status: 'pending',
      retryCount: 0,
    };
    this.pending.set(pendingId, payment);

    const event: JackpotEvent = {
      kind: 'jackpot_payment_required',
      pendingId,
      tierName,
      amount,
    };
    events.push(event);
    this.emit(event);

    return { pendingId, events };
  }

  commitJackpot(pendingId: string, nowMs?: number): JackpotEvent[] {
    const now = nowMs ?? Date.now();
    const payment = this.pending.get(pendingId);
    if (!payment) throw new Error(`Unknown pendingId: ${pendingId}`);

    const age = now - payment.startedAt;

    if (age > this.paymentTimeoutMs) {
      payment.status = 'failed';
      payment.failureReason = 'payment_timeout';
      const event: JackpotEvent = {
        kind: 'jackpot_failed',
        pendingId,
        reason: 'payment_timeout',
      };
      this.emit(event);
      return [event];
    }

    if (payment.status !== 'pending') {
      throw new Error(
        `Cannot commit payment in status '${payment.status}'. pendingId=${pendingId}`,
      );
    }

    // Reset tier to seedValue
    const tier = this.tiers.get(payment.tierName);
    if (tier) {
      tier.poolValue = tier.seedValue;
    }

    payment.status = 'committed';
    payment.committedAt = now;

    const event: JackpotEvent = {
      kind: 'jackpot_committed',
      pendingId,
      spinId: payment.spinId,
      amount: payment.amount,
    };
    this.emit(event);
    return [event];
  }

  rollbackJackpot(pendingId: string, reason: string, nowMs?: number): JackpotEvent[] {
    const now = nowMs ?? Date.now();
    const payment = this.pending.get(pendingId);
    if (!payment) throw new Error(`Unknown pendingId: ${pendingId}`);

    if (payment.status !== 'pending') {
      throw new Error(
        `Cannot rollback payment in status '${payment.status}'. pendingId=${pendingId}`,
      );
    }

    // Restore pool
    const tier = this.tiers.get(payment.tierName);
    if (tier) {
      tier.poolValue = payment.amount;
    }

    payment.status = 'rolled_back';
    payment.rolledBackAt = now;

    const event: JackpotEvent = {
      kind: 'jackpot_rolled_back',
      pendingId,
      reason,
    };
    this.emit(event);
    return [event];
  }

  retryJackpot(pendingId: string, nowMs?: number): JackpotEvent[] {
    const now = nowMs ?? Date.now();
    const payment = this.pending.get(pendingId);
    if (!payment) throw new Error(`Unknown pendingId: ${pendingId}`);

    payment.retryCount += 1;

    if (payment.retryCount > this.maxRetries) {
      // Mark as failed, restore seed
      payment.status = 'failed';
      payment.failureReason = 'max_retries_exceeded';
      const tier = this.tiers.get(payment.tierName);
      if (tier) {
        tier.poolValue = tier.seedValue;
      }
      const event: JackpotEvent = {
        kind: 'jackpot_failed',
        pendingId,
        reason: 'max_retries_exceeded',
      };
      this.emit(event);
      return [event];
    }

    // Reset to pending so it can be committed again
    payment.status = 'pending';
    payment.startedAt = now; // reset timeout clock on retry

    return [];
  }

  expireTimedOut(nowMs?: number): JackpotEvent[] {
    const now = nowMs ?? Date.now();
    const events: JackpotEvent[] = [];
    for (const payment of this.pending.values()) {
      if (payment.status === 'pending' && now - payment.startedAt >= this.paymentTimeoutMs) {
        const rolled = this.rollbackJackpot(payment.pendingId, 'payment_timeout', now);
        events.push(...rolled);
      }
    }
    return events;
  }

  getTier(name: JackpotTierName): Readonly<JackpotTier> | undefined {
    const tier = this.tiers.get(name);
    return tier ? { ...tier } : undefined;
  }

  getTiers(): ReadonlyArray<Readonly<JackpotTier>> {
    return Array.from(this.tiers.values()).map((t) => ({ ...t }));
  }

  getPending(id: string): Readonly<JackpotPendingPayment> | undefined {
    const p = this.pending.get(id);
    return p ? { ...p } : undefined;
  }

  getAllPending(): ReadonlyArray<Readonly<JackpotPendingPayment>> {
    return Array.from(this.pending.values()).map((p) => ({ ...p }));
  }

  getEventLog(): readonly JackpotEvent[] {
    return this.eventLog;
  }
}
