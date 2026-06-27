import type {
  SessionSimConfig,
  SessionOutcome,
  SpinOutcome,
  PlayerSimulationResult,
} from './types.js';

/**
 * Minimal self-contained PRNG — mulberry32 variant with Box-Muller normal.
 */
class SimRng {
  private t: number;

  constructor(seed: number) {
    this.t = seed >>> 0;
  }

  /** Returns a value in [0, 1). */
  nextF64(): number {
    this.t = (this.t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(this.t ^ (this.t >>> 15), 1 | this.t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Box-Muller: returns a standard normal N(0,1) sample.
   * Consumes two uniform draws.
   */
  nextNormal(): number {
    const u1 = Math.max(this.nextF64(), 1e-15); // avoid log(0)
    const u2 = this.nextF64();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Splits to a new independent RNG by mixing seed with a nonce.
   */
  split(nonce: number): SimRng {
    let s = (this.t ^ (nonce >>> 0)) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    return new SimRng(s);
  }
}

/** Simulate a single spin outcome. */
function simulateSpin(
  bet: number,
  rtp: number,
  hitRate: number,
  volatility: number,
  rng: SimRng,
): { win: number } {
  const hit = rng.nextF64() < hitRate;
  if (!hit) return { win: 0 };

  // Mean of the lognormal = rtp * bet / hitRate
  const mu = (rtp * bet) / hitRate;
  // sigma controls spread — higher volatility = higher spread
  const sigma = volatility * 0.8; // scale factor keeps it reasonable

  // Lognormal: X = exp(mu_ln + sigma_ln * Z)
  // We want E[X] = mu, so: mu_ln = ln(mu) - sigma_ln^2/2
  const sigmaLn = sigma;
  const muLn = Math.log(Math.max(mu, 1e-9)) - (sigmaLn * sigmaLn) / 2;
  const z = rng.nextNormal();
  const rawWin = Math.exp(muLn + sigmaLn * z);

  return { win: Math.max(0, rawWin) };
}

/** Simulate a single player session. */
function simulateSession(
  sessionId: number,
  config: SessionSimConfig,
  rng: SimRng,
): SessionOutcome {
  const { profile, initialBankroll, gameRtp, gameHitRate, gameVolatility = 1.0 } = config;

  // Sample session target duration with Gaussian noise
  const durationNoise = rng.nextNormal();
  const targetMinutes = Math.max(
    1,
    profile.targetSessionMinutes + durationNoise * profile.sessionDurationStdDev,
  );
  const maxSpins = Math.round(targetMinutes * profile.spinsPerMinute);

  let bankroll = initialBankroll;
  let consecutiveLosses = 0;
  let totalWagered = 0;
  let totalWon = 0;

  // EMA for perceived RTP (recency bias)
  let perceivedRtp = gameRtp; // initialise to math RTP
  const alpha = profile.recencyBias; // higher = more weight on recent outcomes

  const spins: SpinOutcome[] = [];
  let churnReason: SessionOutcome['churnReason'] = 'time_limit';

  for (let i = 0; i < maxSpins; i++) {
    // Bet is a fraction of current bankroll (but at least 1 unit)
    const bet = Math.max(1, bankroll * profile.betFractionOfBankroll);

    if (bankroll < bet) {
      churnReason = 'bankrupt';
      break;
    }

    bankroll -= bet;
    totalWagered += bet;

    const { win } = simulateSpin(bet, gameRtp, gameHitRate, gameVolatility, rng);
    bankroll += win;
    totalWon += win;

    // Update consecutive losses
    if (win <= 0) {
      consecutiveLosses++;
    } else {
      consecutiveLosses = 0;
    }

    // EMA perceived RTP update: weight most recent spin heavily
    const spinRtp = win / bet;
    perceivedRtp = alpha * spinRtp + (1 - alpha) * perceivedRtp;

    spins.push({
      bet,
      win,
      bankroll: Math.max(0, bankroll),
      consecutiveLosses,
    });

    // Check churn conditions
    if (consecutiveLosses >= profile.churnAfterLosses) {
      churnReason = 'loss_streak';
      break;
    }

    if (bankroll >= initialBankroll * 1.5) {
      churnReason = 'target_reached';
      break;
    }
  }

  // Determine actual duration: spins played / spins-per-minute
  const durationMinutes = spins.length / profile.spinsPerMinute;

  const mathematicalRtp = totalWagered > 0 ? totalWon / totalWagered : 0;

  return {
    sessionId,
    totalSpins: spins.length,
    totalWagered,
    totalWon,
    finalBankroll: Math.max(0, bankroll),
    durationMinutes,
    churnReason,
    perceivedRtp,
    mathematicalRtp,
    spins,
  };
}

export class PlayerBehaviorSimulator {
  async simulate(config: SessionSimConfig): Promise<PlayerSimulationResult> {
    const numSessions = config.numSessions ?? 100;
    const seed = config.seed ?? 0x1337_beef;

    const rootRng = new SimRng(seed);
    const sessions: SessionOutcome[] = [];

    for (let i = 0; i < numSessions; i++) {
      const sessionRng = rootRng.split(i);
      const session = simulateSession(i, config, sessionRng);
      sessions.push(session);
    }

    // Aggregate
    const n = sessions.length;
    const avgSessionDuration = sessions.reduce((s, x) => s + x.durationMinutes, 0) / n;
    const avgSpinsPerSession = sessions.reduce((s, x) => s + x.totalSpins, 0) / n;
    const avgTotalWagered = sessions.reduce((s, x) => s + x.totalWagered, 0) / n;
    const avgTotalWon = sessions.reduce((s, x) => s + x.totalWon, 0) / n;
    const avgPerceivedRtp = sessions.reduce((s, x) => s + x.perceivedRtp, 0) / n;
    const mathRtp =
      sessions.reduce((s, x) => s + x.totalWagered, 0) > 0
        ? sessions.reduce((s, x) => s + x.totalWon, 0) /
          sessions.reduce((s, x) => s + x.totalWagered, 0)
        : 0;

    const churnReasons: Record<string, number> = {
      bankrupt: 0,
      time_limit: 0,
      loss_streak: 0,
      target_reached: 0,
    };
    for (const s of sessions) {
      churnReasons[s.churnReason] = (churnReasons[s.churnReason] ?? 0) + 1;
    }

    const bankruptcyRate = churnReasons['bankrupt']! / n;
    const lossStreakChurnRate = churnReasons['loss_streak']! / n;

    return {
      profile: config.profile.profile,
      numSessions: n,
      avgSessionDuration,
      avgSpinsPerSession,
      avgTotalWagered,
      avgTotalWon,
      avgPerceivedRtp,
      mathRtp,
      churnReasons,
      bankruptcyRate,
      lossStreakChurnRate,
      sessions,
    };
  }
}
