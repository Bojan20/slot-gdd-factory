import type {
  FraudDetectorConfig,
  FraudReport,
  FraudSessionRecord,
  FraudSignal,
  FraudSpinRecord,
} from './types.js';

const DEFAULT_MAX_SPINS_PER_MINUTE = 120;
const DEFAULT_WIN_RATE_SIGMA = 4.0;
const DEFAULT_CONSECUTIVE_WINS = 10;
const DEFAULT_FLAG_THRESHOLD = 60;
const DEFAULT_MAX_JACKPOT_HITS = 2;

const WINDOW_MS = 60_000; // 1 minute sliding window

export class FraudDetector {
  private readonly cfg: Required<FraudDetectorConfig>;

  constructor(config: FraudDetectorConfig) {
    this.cfg = {
      expectedWinRate: config.expectedWinRate,
      maxSpinsPerMinute: config.maxSpinsPerMinute ?? DEFAULT_MAX_SPINS_PER_MINUTE,
      winRateSigmaThreshold: config.winRateSigmaThreshold ?? DEFAULT_WIN_RATE_SIGMA,
      consecutiveWinsThreshold: config.consecutiveWinsThreshold ?? DEFAULT_CONSECUTIVE_WINS,
      flagThreshold: config.flagThreshold ?? DEFAULT_FLAG_THRESHOLD,
      maxJackpotHitsPerSession: config.maxJackpotHitsPerSession ?? DEFAULT_MAX_JACKPOT_HITS,
    };
  }

  analyze(session: FraudSessionRecord): FraudReport {
    const signals: FraudSignal[] = [];

    const velSig = this._checkVelocity(session);
    if (velSig) signals.push(velSig);

    const wrSig = this._checkWinRate(session);
    if (wrSig) signals.push(wrSig);

    const ppSig = this._checkPayoutPattern(session);
    if (ppSig) signals.push(ppSig);

    const bpSig = this._checkBetPattern(session);
    if (bpSig) signals.push(bpSig);

    const jcSig = this._checkJackpotClustering(session);
    if (jcSig) signals.push(jcSig);

    const riskScore = this._computeRisk(signals);
    const flagged = riskScore >= this.cfg.flagThreshold;
    const recommendation: FraudReport['recommendation'] =
      riskScore >= 80 ? 'block' : riskScore >= 60 ? 'review' : 'allow';

    return {
      sessionId: session.sessionId,
      signals,
      riskScore,
      flagged,
      recommendation,
    };
  }

  /** Sliding 60-second window: flag if max spins in any window > maxSpinsPerMinute. */
  _checkVelocity(session: FraudSessionRecord): FraudSignal | null {
    const spins = session.spins;
    if (spins.length === 0) return null;

    let maxInWindow = 0;
    for (let i = 0; i < spins.length; i++) {
      const windowStart = spins[i]!.timestampMs;
      let count = 0;
      for (let j = i; j < spins.length; j++) {
        if (spins[j]!.timestampMs - windowStart <= WINDOW_MS) {
          count++;
        } else {
          break;
        }
      }
      if (count > maxInWindow) maxInWindow = count;
    }

    if (maxInWindow <= this.cfg.maxSpinsPerMinute) return null;

    const ratio = maxInWindow / this.cfg.maxSpinsPerMinute;
    const severity: FraudSignal['severity'] = ratio >= 2 ? 'critical' : 'warning';
    const confidence = Math.min(1, (ratio - 1) / 2);

    return {
      kind: 'velocity_excess',
      severity,
      confidence,
      message: `Spin velocity ${maxInWindow} spins/min exceeds limit of ${this.cfg.maxSpinsPerMinute}`,
      detail: { maxSpinsInWindow: maxInWindow, limit: this.cfg.maxSpinsPerMinute, ratio },
      detectedAt: Date.now(),
    };
  }

  /** Binomial Z-test on win rate (requires n >= 30). */
  _checkWinRate(session: FraudSessionRecord): FraudSignal | null {
    const spins = session.spins;
    if (spins.length < 30) return null;

    const n = spins.length;
    const wins = spins.filter((s) => s.win > s.bet).length;
    const observedRate = wins / n;
    const p = this.cfg.expectedWinRate;
    const stdDev = Math.sqrt((p * (1 - p)) / n);

    if (stdDev === 0) return null;

    const z = (observedRate - p) / stdDev;

    if (z <= this.cfg.winRateSigmaThreshold) return null;

    const confidence = Math.min(1, (z - this.cfg.winRateSigmaThreshold) / this.cfg.winRateSigmaThreshold);
    const severity: FraudSignal['severity'] =
      z >= this.cfg.winRateSigmaThreshold * 2 ? 'critical' : 'warning';

    return {
      kind: 'win_rate_anomaly',
      severity,
      confidence,
      message: `Win rate ${(observedRate * 100).toFixed(1)}% is ${z.toFixed(1)}σ above expected ${(p * 100).toFixed(1)}%`,
      detail: { observedRate, expectedRate: p, zScore: z, n },
      detectedAt: Date.now(),
    };
  }

  /** Max consecutive wins (where win > bet). */
  _checkPayoutPattern(session: FraudSessionRecord): FraudSignal | null {
    const spins = session.spins;
    let maxConsec = 0;
    let current = 0;

    for (const spin of spins) {
      if (spin.win > spin.bet) {
        current++;
        if (current > maxConsec) maxConsec = current;
      } else {
        current = 0;
      }
    }

    if (maxConsec < this.cfg.consecutiveWinsThreshold) return null;

    const ratio = maxConsec / this.cfg.consecutiveWinsThreshold;
    const confidence = Math.min(1, (ratio - 1) / 2 + 0.5);
    const severity: FraudSignal['severity'] = ratio >= 2 ? 'critical' : 'warning';

    return {
      kind: 'payout_pattern',
      severity,
      confidence,
      message: `${maxConsec} consecutive wins detected (threshold: ${this.cfg.consecutiveWinsThreshold})`,
      detail: { maxConsecutiveWins: maxConsec, threshold: this.cfg.consecutiveWinsThreshold },
      detectedAt: Date.now(),
    };
  }

  /**
   * Bet pattern exploit: compare average bet size immediately before wins vs
   * all other spins. Flag if ratio > 1.5x (requires >= 5 of each category).
   */
  _checkBetPattern(session: FraudSessionRecord): FraudSignal | null {
    const spins = session.spins;
    if (spins.length < 2) return null;

    // A spin is "before a win" if the next spin has win > bet
    const betsBeforeWins: number[] = [];
    const normalBets: number[] = [];

    for (let i = 0; i < spins.length - 1; i++) {
      const next = spins[i + 1]!;
      const isBeforeWin = next.win > next.bet;
      if (isBeforeWin) {
        betsBeforeWins.push(spins[i]!.bet);
      } else {
        normalBets.push(spins[i]!.bet);
      }
    }
    // Include last spin in normal bets
    normalBets.push(spins[spins.length - 1]!.bet);

    if (betsBeforeWins.length < 5 || normalBets.length < 5) return null;

    const avgBefore = betsBeforeWins.reduce((a, b) => a + b, 0) / betsBeforeWins.length;
    const avgNormal = normalBets.reduce((a, b) => a + b, 0) / normalBets.length;

    if (avgNormal === 0) return null;

    const ratio = avgBefore / avgNormal;
    if (ratio <= 1.5) return null;

    const confidence = Math.min(1, (ratio - 1.5) / 1.5);
    const severity: FraudSignal['severity'] = ratio >= 3 ? 'critical' : 'warning';

    return {
      kind: 'bet_pattern_exploit',
      severity,
      confidence,
      message: `Bets before wins (avg ${avgBefore.toFixed(2)}) are ${ratio.toFixed(2)}x normal bets (avg ${avgNormal.toFixed(2)})`,
      detail: { avgBetBeforeWin: avgBefore, avgNormalBet: avgNormal, ratio },
      detectedAt: Date.now(),
    };
  }

  /** Count jackpot hits; flag if exceeds maxJackpotHitsPerSession. */
  _checkJackpotClustering(session: FraudSessionRecord): FraudSignal | null {
    const jackpots = session.spins.filter((s) => s.isJackpot === true).length;

    if (jackpots <= this.cfg.maxJackpotHitsPerSession) return null;

    const ratio = jackpots / this.cfg.maxJackpotHitsPerSession;
    const confidence = Math.min(1, (ratio - 1) / 2);
    const severity: FraudSignal['severity'] = ratio >= 2 ? 'critical' : 'warning';

    return {
      kind: 'jackpot_clustering',
      severity,
      confidence,
      message: `${jackpots} jackpot hits in session (max: ${this.cfg.maxJackpotHitsPerSession})`,
      detail: { jackpotCount: jackpots, maxAllowed: this.cfg.maxJackpotHitsPerSession },
      detectedAt: Date.now(),
    };
  }

  /** Weighted risk score: info=5, warning=25, critical=50, scaled by confidence, capped 0..100. */
  _computeRisk(signals: FraudSignal[]): number {
    const basePoints: Record<FraudSignal['severity'], number> = {
      info: 5,
      warning: 25,
      critical: 50,
    };
    const raw = signals.reduce((total, sig) => {
      return total + basePoints[sig.severity] * sig.confidence;
    }, 0);
    return Math.min(100, Math.max(0, raw));
  }
}
