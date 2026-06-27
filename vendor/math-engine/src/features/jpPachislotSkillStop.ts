/**
 * W240 — JP Pachislot 風営法 §2(7) Skill-Stop Compliance Analyzer (97. solver).
 *
 * Japan Pachislot Regulation 風営法 §2(7) skill-stop mechanic + Type 5/6
 * regulations + 賭博罪 §185 anti-gambling carve-out + JAGRA certification.
 *
 * Math: skill-stop reels — player can stop reel manually after spin; per-spin
 * RTP ranges 55-119% (Type 5: 55-130, Type 6: 55-119 stricter); skill margin
 * = ability-adjusted EV; payback cycle (回胴) — must NOT exceed 4 hours.
 */

export interface JpPachislotConfig {
  /** Per-spin target RTP ∈ [0.55, 1.30] (Type 5) or [0.55, 1.19] (Type 6). */
  targetRtp: number;
  /** Pachislot type (5 = old reg, 6 = new reg post-2021). */
  pachislotType: 5 | 6;
  /** Player skill multiplier ∈ [1.00, 1.10] (max 10% skill boost per JAGRA). */
  playerSkillMultiplier: number;
  /** Bet per spin (JPY ¥). */
  betPerSpin: number;
  /** Average spins per hour. */
  spinsPerHour: number;
  /** Daily play hours target ∈ [0, 12]. */
  dailyPlayHours: number;
  /** Payback cycle (回胴) target hours — JAGRA mandate ≤ 4h. */
  paybackCycleHours: number;
  /** Boolean: JAGRA certified machine. */
  jagraCertified: boolean;
}

export interface JpPachislotResult {
  /** Effective RTP after skill multiplier. */
  effectiveRtp: number;
  /** Hourly expected loss (JPY ¥). */
  expectedHourlyLoss: number;
  /** Daily expected loss. */
  expectedDailyLoss: number;
  /** Boolean: RTP within type limits. */
  rtpWithinTypeLimits: boolean;
  /** Boolean: payback cycle ≤ 4h. */
  paybackCycleCompliant: boolean;
  /** Composite Type 5/6 compliance score ∈ [0, 1]. */
  pachislotComplianceScore: number;
  /** JAGRA + 風営法 §2(7) compliance. */
  isCompliantFueiho: boolean;
}

function validate(c: JpPachislotConfig): void {
  if (!Number.isFinite(c.targetRtp) || c.targetRtp < 0.55 || c.targetRtp > 1.30)
    throw new Error('targetRtp ∈ [0.55, 1.30]');
  if (![5, 6].includes(c.pachislotType)) throw new Error('pachislotType must be 5 or 6');
  if (!Number.isFinite(c.playerSkillMultiplier) || c.playerSkillMultiplier < 1.0 || c.playerSkillMultiplier > 1.10)
    throw new Error('playerSkillMultiplier ∈ [1.00, 1.10]');
  if (!Number.isFinite(c.betPerSpin) || c.betPerSpin <= 0) throw new Error('betPerSpin > 0');
  if (!Number.isFinite(c.spinsPerHour) || c.spinsPerHour <= 0) throw new Error('spinsPerHour > 0');
  if (!Number.isFinite(c.dailyPlayHours) || c.dailyPlayHours < 0 || c.dailyPlayHours > 12)
    throw new Error('dailyPlayHours ∈ [0, 12]');
  if (!Number.isFinite(c.paybackCycleHours) || c.paybackCycleHours <= 0) throw new Error('paybackCycleHours > 0');
}

export function solveJpPachislot(cfg: JpPachislotConfig): JpPachislotResult {
  validate(cfg);

  const effectiveRtp = cfg.targetRtp * cfg.playerSkillMultiplier;
  const hourlyLoss = cfg.spinsPerHour * cfg.betPerSpin * (1 - effectiveRtp);
  const dailyLoss = hourlyLoss * cfg.dailyPlayHours;

  const maxRtp = cfg.pachislotType === 5 ? 1.30 : 1.19;
  const minRtp = 0.55;
  const rtpWithinTypeLimits = effectiveRtp >= minRtp && effectiveRtp <= maxRtp;
  const paybackCycleCompliant = cfg.paybackCycleHours <= 4.0;

  const rtpScore = rtpWithinTypeLimits ? 1 : 0;
  const cycleScore = paybackCycleCompliant ? 1 : Math.max(0, 1 - (cfg.paybackCycleHours - 4) / 4);
  const jagraScore = cfg.jagraCertified ? 1 : 0;
  const pachislotComplianceScore = Math.max(0, Math.min(1, 0.4 * rtpScore + 0.3 * cycleScore + 0.3 * jagraScore));

  const isCompliantFueiho = rtpWithinTypeLimits && paybackCycleCompliant && cfg.jagraCertified;

  return {
    effectiveRtp,
    expectedHourlyLoss: hourlyLoss,
    expectedDailyLoss: dailyLoss,
    rtpWithinTypeLimits,
    paybackCycleCompliant,
    pachislotComplianceScore,
    isCompliantFueiho,
  };
}

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface JpPachislotMcResult {
  episodes: number;
  observedDailyLossMean: number;
}

export function simulateJpPachislot(cfg: JpPachislotConfig, seed: number, episodes: number): JpPachislotMcResult {
  validate(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) throw new Error('episodes ≥ 100');
  const rng = makeRng(seed);
  let sum = 0;
  const dailySpins = Math.floor(cfg.spinsPerHour * cfg.dailyPlayHours);
  const effRtp = cfg.targetRtp * cfg.playerSkillMultiplier;
  for (let ep = 0; ep < episodes; ep++) {
    let loss = 0;
    for (let i = 0; i < dailySpins; i++) {
      // simplified Bernoulli: win/lose given effective RTP
      const r = rng();
      const isWin = r < effRtp / 10; // approximation
      if (isWin) loss -= cfg.betPerSpin * 10 * (effRtp); // 10× win
      else loss += cfg.betPerSpin;
    }
    sum += loss;
  }
  return { episodes, observedDailyLossMean: sum / episodes };
}
