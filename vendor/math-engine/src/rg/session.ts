import {
  type RGJurisdiction,
  type RGLimits,
  type RGSessionState,
  type RGDecision,
  type RGEvent,
  type AMLConfig,
  type AMLState,
  MIN_SPIN_MS,
} from './types.js';

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface RGSessionOptions {
  sessionId?: string;
  jurisdiction?: RGJurisdiction;
  limits?: RGLimits;
  aml?: AMLConfig;
  /** Override the session start timestamp (useful for deterministic tests). */
  startTime?: number;
}

export class RGSession {
  private readonly sessionId: string;
  private readonly jurisdiction: RGJurisdiction;
  private readonly limits: RGLimits;
  private readonly amlConfig: AMLConfig;
  private readonly startTime: number;

  private totalWagered = 0;
  private totalWon = 0;
  private netLoss = 0;
  private spinCount = 0;
  private lastRealityCheckAt: number | null;
  private lastSpinCompletedAt = 0;

  private readonly eventLog: RGEvent[] = [];

  // AML state
  private amlState: AMLState = {
    recentSpinTimestamps: [],
    consecutiveWins: 0,
    totalWins: 0,
    totalSpins: 0,
    flagged: false,
  };
  private amlVelocityFired = false;
  private amlWinRateFired = false;

  constructor(opts: RGSessionOptions = {}) {
    const now = opts.startTime ?? Date.now();
    this.sessionId = opts.sessionId ?? uuid();
    this.jurisdiction = opts.jurisdiction ?? 'default';
    this.limits = opts.limits ?? {};
    this.amlConfig = opts.aml ?? {};
    this.startTime = now;
    // lastRealityCheckAt is initialized lazily on the first recordSpin call
    // to ensure deterministic behaviour when tests pass explicit nowMs.
    this.lastRealityCheckAt = null;
  }

  // ── W244 wave 5 — guard methods (Stryker compound-conditional bug workaround)
  //
  // Each `_is*` returns a plain boolean.  Hoisting the inline
  // `if (X !== undefined && violation)` compound expressions into named
  // single-decision methods lets Stryker's mutator target the method
  // body — which is then correctly mapped to covering tests by V8's
  // line-based perTest tracker.  See `bug-reports/stryker-vitest-
  // compound-conditional/` for the upstream issue and reproducer.
  // Behaviour is identical to the previous inline form; existing tests
  // (faza118, faza1310, w239, w244) all pass unchanged.

  /** Player has self-excluded — gate refuses every spin. */
  private _isSelfExcluded(): boolean {
    return this.limits.selfExcluded === true;
  }

  // Helper: numeric ceiling fallback for undefined optional caps.  Using
  // `?? Infinity` instead of `if (cap === undefined) return false` removes
  // the entire `if`-statement surface from Stryker — every comparison
  // remains a single non-compound expression that mutates cleanly.

  /** Wager exceeds the per-spin cap (or no cap configured → false). */
  private _isMaxWagerExceeded(wager: number): boolean {
    return wager > (this.limits.maxWagerPerSpin ?? Infinity);
  }

  /** Less time than jurisdiction-min has passed since the prior spin. */
  private _isMinSpinTimeViolation(now: number): { violated: boolean; minMs: number; elapsed: number } {
    const minMs = MIN_SPIN_MS[this.jurisdiction];
    const elapsed = now - this.lastSpinCompletedAt;
    // Single boolean: pre-first-spin (lastSpinCompletedAt === 0) OR
    // jurisdiction-min is zero OR elapsed is already past min → no violation.
    const violated = this.lastSpinCompletedAt > 0 && minMs > 0 && elapsed < minMs;
    return { violated, minMs, elapsed };
  }

  /** Elapsed session-wall-clock has reached the configured cap. */
  private _isMaxSessionDurationReached(now: number): boolean {
    return now - this.startTime >= (this.limits.maxSessionDurationMs ?? Infinity);
  }

  /** Cumulative net loss has reached the session-loss cap. */
  private _isMaxLossSessionReached(): boolean {
    return this.netLoss >= (this.limits.maxLossPerSession ?? Infinity);
  }

  checkSpinAllowed(wager: number, nowMs?: number): RGDecision {
    const now = nowMs ?? Date.now();

    // 1. Self-exclusion
    if (this._isSelfExcluded()) {
      return { allow: false, reason: 'self_excluded', message: 'Player is self-excluded.' };
    }

    // 2. Max wager per spin
    if (this._isMaxWagerExceeded(wager)) {
      return {
        allow: false,
        reason: 'max_wager_exceeded',
        message: `Wager ${wager} exceeds limit ${this.limits.maxWagerPerSpin}.`,
      };
    }

    // 3. Min spin time (only after the first spin has been recorded)
    const minSpin = this._isMinSpinTimeViolation(now);
    if (minSpin.violated) {
      return {
        allow: false,
        reason: 'min_spin_time_not_elapsed',
        message: `Must wait ${minSpin.minMs - minSpin.elapsed}ms more before spinning.`,
      };
    }

    // 4. Session duration
    if (this._isMaxSessionDurationReached(now)) {
      return {
        allow: false,
        reason: 'max_session_duration',
        message: 'Session duration limit reached.',
      };
    }

    // 5. Session loss limit
    if (this._isMaxLossSessionReached()) {
      return {
        allow: false,
        reason: 'max_loss_session',
        message: 'Session loss limit reached.',
      };
    }

    return { allow: true };
  }

  recordSpin(wager: number, win: number, nowMs?: number): RGEvent[] {
    const now = nowMs ?? Date.now();
    const events: RGEvent[] = [];

    // Lazy-initialize the reality-check baseline to the first spin's timestamp.
    if (this.lastRealityCheckAt === null) {
      this.lastRealityCheckAt = now;
    }

    // Update counters
    this.totalWagered += wager;
    this.totalWon += win;
    this.netLoss = Math.max(0, this.totalWagered - this.totalWon);
    this.spinCount += 1;
    this.lastSpinCompletedAt = now;

    // Update AML state
    this.amlState.totalSpins += 1;
    this.amlState.recentSpinTimestamps.push(now);
    if (win > 0) {
      this.amlState.totalWins += 1;
      this.amlState.consecutiveWins += 1;
    } else {
      this.amlState.consecutiveWins = 0;
    }

    // AML velocity: sliding 60s window
    const windowStart = now - 60_000;
    this.amlState.recentSpinTimestamps = this.amlState.recentSpinTimestamps.filter(
      (ts) => ts > windowStart,
    );
    const spinsInWindow = this.amlState.recentSpinTimestamps.length;
    const maxSpinsPerMinute = this.amlConfig.maxSpinsPerMinute;
    if (this._shouldFireAmlVelocity(spinsInWindow)) {
      this.amlVelocityFired = true;
      this.amlState.flagged = true;
      this.amlState.flagReason = 'velocity';
      const event: RGEvent = {
        kind: 'aml_velocity_flag',
        sessionId: this.sessionId,
        timestamp: now,
        detail: { spinsInWindow, maxSpinsPerMinute },
      };
      events.push(event);
      this.eventLog.push(event);
    }

    // AML win-rate sigma: after 30+ spins
    if (this._isAmlWinRateGateOpen()) {
      const n = this.amlState.totalSpins;
      const p = 0.35; // expected win rate
      const actualRate = this.amlState.totalWins / n;
      const stdErr = Math.sqrt((p * (1 - p)) / n);
      const sigma = Math.abs(actualRate - p) / stdErr;
      if (sigma > (this.amlConfig.winRateSigmaThreshold as number)) {
        this.amlWinRateFired = true;
        this.amlState.flagged = true;
        this.amlState.flagReason = this.amlState.flagReason ?? 'win_rate_sigma';
        const event: RGEvent = {
          kind: 'aml_velocity_flag',
          sessionId: this.sessionId,
          timestamp: now,
          detail: { actualRate, expectedRate: p, sigma, threshold: this.amlConfig.winRateSigmaThreshold },
        };
        events.push(event);
        this.eventLog.push(event);
      }
    }

    // Reality check (lastRealityCheckAt is non-null here — initialized above)
    if (this._shouldFireRealityCheck(now)) {
      this.lastRealityCheckAt = now;
      const event: RGEvent = {
        kind: 'reality_check_due',
        sessionId: this.sessionId,
        timestamp: now,
        detail: {
          totalWagered: this.totalWagered,
          totalWon: this.totalWon,
          netLoss: this.netLoss,
          spinCount: this.spinCount,
        },
      };
      events.push(event);
      this.eventLog.push(event);
    }

    // Session limit warning at 80%
    if (this._shouldFireSessionLimitWarning()) {
      const event: RGEvent = {
        kind: 'session_limit_warning',
        sessionId: this.sessionId,
        timestamp: now,
        detail: {
          netLoss: this.netLoss,
          limit: this.limits.maxLossPerSession,
          pct: this.netLoss / (this.limits.maxLossPerSession as number),
        },
      };
      events.push(event);
      this.eventLog.push(event);
    }

    return events;
  }

  // ── recordSpin-side guard methods (Stryker compound-conditional workaround)
  //
  // Same `?? Infinity` / `?? -1` pattern: optional caps fall through to a
  // sentinel that flips the comparison's outcome, so the body remains a
  // single arithmetic expression with no embedded `if`.

  /** AML velocity fire iff not yet fired AND cap is configured AND threshold exceeded. */
  private _shouldFireAmlVelocity(spinsInWindow: number): boolean {
    return !this.amlVelocityFired
      && spinsInWindow > (this.amlConfig.maxSpinsPerMinute ?? Infinity);
  }

  /** AML win-rate gate opens iff not yet fired AND ≥30 spins AND threshold configured. */
  private _isAmlWinRateGateOpen(): boolean {
    return !this.amlWinRateFired
      && this.amlState.totalSpins >= 30
      && this.amlConfig.winRateSigmaThreshold !== undefined;
  }

  /** Reality-check fires iff interval is configured AND interval has elapsed since last check. */
  private _shouldFireRealityCheck(now: number): boolean {
    // lastRealityCheckAt is non-null at every call site (lazy-init above).
    const interval = this.limits.realityCheckIntervalMs ?? Infinity;
    return now - (this.lastRealityCheckAt as number) >= interval;
  }

  /** Session-limit warning fires iff cap configured AND netLoss ≥ 80 % of cap. */
  private _shouldFireSessionLimitWarning(): boolean {
    const cap = this.limits.maxLossPerSession ?? Infinity;
    return this.netLoss >= cap * 0.8;
  }

  getState(): Readonly<RGSessionState> {
    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      totalWagered: this.totalWagered,
      totalWon: this.totalWon,
      netLoss: this.netLoss,
      spinCount: this.spinCount,
      lastRealityCheckAt: this.lastRealityCheckAt ?? this.startTime,
      jurisdiction: this.jurisdiction,
      limits: { ...this.limits },
    };
  }

  /** AML cash-out hold required iff threshold configured AND amount ≥ threshold. */
  private _shouldHoldCashOut(amount: number): boolean {
    return amount >= (this.amlConfig.cashOutHoldThreshold ?? Infinity);
  }

  cashOutHoldRequired(amount: number): { required: boolean; reason?: string } {
    if (this._shouldHoldCashOut(amount)) {
      const threshold = this.amlConfig.cashOutHoldThreshold as number;
      return { required: true, reason: `Cash-out amount ${amount} meets AML hold threshold ${threshold}.` };
    }
    return { required: false };
  }

  getEventLog(): readonly RGEvent[] {
    return this.eventLog;
  }

  getAMLState(): Readonly<AMLState> {
    return { ...this.amlState, recentSpinTimestamps: [...this.amlState.recentSpinTimestamps] };
  }
}
