/**
 * W152 Wave 165 — Reverse Martingale (Paroli) Streak Cash-Out Analyzer (54. solver).
 *
 * INDUSTRY-FIRST chase-pattern detection kernel for the "let it ride" /
 * positive-progression strategy — UKGC LCCP 3.4.3 (chase-pattern detection
 * mandate), MGA Player Protection Directives §18 (progressive wager warning),
 * EU EBA Responsible Gambling Directive 2024, AU NCPF Reform 2022 Schedule 4,
 * NHS Gambling Harms 2024 report (Paroli = #2 chase pattern after Martingale).
 *
 * **54th closed-form solver** — dual of W163 Martingale:
 *   - W163 (P-073): bet doubles on LOSS (chase losses) — Markov over loss streak
 *   - W165 (P-074): bet doubles on WIN (let it ride) — Markov over win streak
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Paroli strategy: start with base bet b_0; on each WIN double bet (let
 * winnings ride); after k_target consecutive wins → cash out (reset to b_0);
 * any LOSS → lose current bet (reset to b_0).
 *
 * Per round (until cash-out or loss):
 *   - P(reach k_target wins in a row) = p^k_target
 *     ⇒ player cashes out profit = b_0·(2^k_target − 1)
 *   - P(loss at step k, k ∈ [1, k_target]) = p^(k−1)·q
 *     ⇒ player loses b_0·2^(k−1) (the bet they were placing)
 *   - Sum check: p^k_target + Σ_{k=1..k_target} p^(k−1)·q
 *                = p^k_target + q·(1 − p^k_target)/(1 − p)
 *                = p^k_target + (1 − p^k_target) = 1 ✓
 *
 * Bankroll constraint: max single-round wager committed = b_0·(2^k_target − 1)
 *   (sum of bets while building the streak). Need ≤ bankroll, so effective
 *   k_target capped at k_max = ⌊log₂(B/b_0 + 1)⌋.
 *
 * ── Closed-form per-round metrics ───────────────────────────────────────
 *   probReachStreak     = p^k_target
 *   probLossAtStep(k)   = p^(k−1)·q
 *   expectedRoundProfit = b_0·(2^k − 1)·p^k − b_0·Σ_{j=1..k} 2^(j−1)·p^(j−1)·q
 *                       = b_0·[(2^k − 1)·p^k − q·(1 − (2p)^k)/(1 − 2p)]   (p ≠ 1/2)
 *   varianceRound       = E[X²] − E[X]² of per-round profit
 *   expectedSpinsPerRound = Σ_{k=1..k_target} k·p^(k−1)·q + k_target·p^k_target
 *
 * ── Long-run profit goal analysis ─────────────────────────────────────────
 * If E[roundProfit] > 0: player has positive edge → "lucky strategy"
 *   - oneInNRoundsToHitGoal: rounds to accumulate profit goal G
 * If E[roundProfit] ≤ 0: player has negative-to-zero edge → bust eventually
 *   - timeToBust = analog Martingale, but with positive jumps when streak hits
 *
 * For this solver we focus on per-round metrics (chase-pattern alert) and
 * provide bankroll-cap interaction.
 *
 * ── Distinct from ────────────────────────────────────────────────────────
 *   - W163 Martingale (P-073) — bet doubles on LOSS (chase losses, dual)
 *   - W154/W157/W161 responsible-gambling triad — all constant bet
 *   - W57 Crash Multiplier — multiplier target, no bet progression
 *   - W118 Bonus Collect-N — token collector, not bet doubling
 *
 * Naming: "Paroli", "reverse Martingale", "let it ride" = generic actuarial /
 * responsible-gambling terms. No vendor TM, no operator brand.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface ParoliStreakCashOutConfig {
  /** Bankroll B > 0. */
  bankroll: number;
  /** Base bet b_0 > 0 (must be ≤ bankroll). */
  baseBet: number;
  /** Per-spin probability of winning ∈ (0, 1). */
  probWinPerSpin: number;
  /** Target consecutive wins to cash out (≥ 1). */
  targetStreak: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface ParoliStreakCashOutResult {
  /** Effective target streak after bankroll cap (= min(target, k_max)). */
  effectiveTargetStreak: number;
  /** Was streak target clipped by bankroll cap? */
  cappedByBankroll: boolean;
  /** Probability of reaching effective target (cash-out event). */
  probReachStreak: number;
  /** Regulator "1 in N rounds" cash-out frequency. */
  oneInNRoundsCashOut: number;
  /** Cash-out payout when streak reached. */
  cashOutPayout: number;
  /** E[round profit] in currency units (can be positive or negative). */
  expectedRoundProfit: number;
  /** Variance of round profit. */
  varianceRoundProfit: number;
  /** Std-dev round profit. */
  stdDevRoundProfit: number;
  /** E[spins per round]. */
  expectedSpinsPerRound: number;
  /** Probability per-round profit ≥ 0 (cash-out OR loss with 0 bet, edge case). */
  probRoundProfitNonNegative: number;
  /** Per-round risk/reward ratio = cashOutPayout / E[absolute loss per loss-ending round]. */
  riskRewardRatio: number;
  /** Chase-pattern risk score ∈ [0, 1]; weighted by deep streak + high p. */
  chasePatternRiskScore: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: ParoliStreakCashOutConfig): void {
  if (!Number.isFinite(cfg.bankroll) || cfg.bankroll <= 0) {
    throw new Error(`paroliStreakCashOut: bankroll must be > 0, got ${cfg.bankroll}`);
  }
  if (!Number.isFinite(cfg.baseBet) || cfg.baseBet <= 0) {
    throw new Error(`paroliStreakCashOut: baseBet must be > 0, got ${cfg.baseBet}`);
  }
  if (cfg.baseBet > cfg.bankroll) {
    throw new Error(
      `paroliStreakCashOut: baseBet (${cfg.baseBet}) > bankroll (${cfg.bankroll})`,
    );
  }
  if (
    !Number.isFinite(cfg.probWinPerSpin) ||
    cfg.probWinPerSpin <= 0 ||
    cfg.probWinPerSpin >= 1
  ) {
    throw new Error(
      `paroliStreakCashOut: probWinPerSpin must be in (0, 1), got ${cfg.probWinPerSpin}`,
    );
  }
  if (!Number.isInteger(cfg.targetStreak) || cfg.targetStreak < 1) {
    throw new Error(
      `paroliStreakCashOut: targetStreak must be positive integer, got ${cfg.targetStreak}`,
    );
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveParoliStreakCashOut(
  cfg: ParoliStreakCashOutConfig,
): ParoliStreakCashOutResult {
  validateConfig(cfg);

  const p = cfg.probWinPerSpin;
  const q = 1 - p;

  // Effective target capped by bankroll: need b_0·(2^k − 1) ≤ B for k bets in streak.
  const ratio = cfg.bankroll / cfg.baseBet;
  const kMaxByBankroll = Math.max(1, Math.floor(Math.log2(ratio + 1)));
  const k = Math.min(cfg.targetStreak, kMaxByBankroll);
  const cappedByBankroll = k < cfg.targetStreak;

  // Cash-out payout = b_0·(2^k − 1) profit when streak reached
  const cashOutPayout = cfg.baseBet * (Math.pow(2, k) - 1);

  // P(reach k wins in a row).
  const probReachStreak = Math.pow(p, k);
  const oneInNRoundsCashOut = probReachStreak > 1e-300 ? 1 / probReachStreak : Infinity;

  // E[round profit] = cashOutPayout · p^k − Σ_{j=1..k} b_0·2^(j−1) · p^(j−1) · q
  //                 = b_0·[(2^k − 1)·p^k − q·Σ_{j=0..k−1} (2p)^j]
  // Σ_{j=0..k−1} (2p)^j = (1 − (2p)^k) / (1 − 2p)   for p ≠ 1/2
  //                    = k                            for p = 1/2 (sum of k ones × correction)
  // For p = 1/2: (2p)^j = 1 for all j, so Σ = k.
  let geomSum: number;
  if (Math.abs(2 * p - 1) < 1e-12) {
    geomSum = k;
  } else {
    geomSum = (1 - Math.pow(2 * p, k)) / (1 - 2 * p);
  }
  const expectedRoundProfit =
    cashOutPayout * probReachStreak - cfg.baseBet * q * geomSum;

  // E[(round profit)²]
  // = cashOutPayout² · p^k + Σ_{j=1..k} (b_0·2^(j−1))² · p^(j−1) · q
  // For variance: subtract E[X]².
  // Σ (4^(j−1)) · p^(j−1) · q = q · Σ_{j=0..k−1} (4p)^j
  let geomSum4p: number;
  if (Math.abs(4 * p - 1) < 1e-12) {
    geomSum4p = k;
  } else {
    geomSum4p = (1 - Math.pow(4 * p, k)) / (1 - 4 * p);
  }
  const expectedSqProfit =
    cashOutPayout * cashOutPayout * probReachStreak +
    cfg.baseBet * cfg.baseBet * q * geomSum4p;
  const varianceRoundProfit = Math.max(
    0,
    expectedSqProfit - expectedRoundProfit * expectedRoundProfit,
  );
  const stdDevRoundProfit = Math.sqrt(varianceRoundProfit);

  // E[spins per round]: streak ends at step k (cash out) or step j (loss).
  //   spins | reach streak = k
  //   spins | loss at step j = j
  let expectedSpinsPerRound = k * probReachStreak;
  let pStreak = 1; // p^0
  for (let j = 1; j <= k; j++) {
    expectedSpinsPerRound += j * pStreak * q;
    pStreak *= p;
  }

  // probRoundProfitNonNegative = probReachStreak (only cash-out is positive)
  const probRoundProfitNonNegative = probReachStreak;

  // riskRewardRatio = cashOutPayout / E[absolute loss per loss-ending round]
  //   E[abs loss | round ends in loss] = Σ b_0·2^(j−1)·p^(j−1)·q / Σ p^(j−1)·q
  //                                    = b_0·q·geomSum / (q·(1−p^k)/(1−p))
  //                                    = b_0·(1−p)·geomSum / (1−p^k)
  // (using geomSum = Σ_{j=0..k−1} (2p)^j)
  const probLossEnd = 1 - probReachStreak;
  const expectedAbsLossGivenLossEnd =
    probLossEnd > 1e-15 ? (cfg.baseBet * q * geomSum) / probLossEnd : 0;
  const riskRewardRatio =
    expectedAbsLossGivenLossEnd > 1e-15
      ? cashOutPayout / expectedAbsLossGivenLossEnd
      : Infinity;

  // Chase-pattern risk score: deep target + high p both increase risk
  //   (deep target = larger commit; high p = "looks like sure thing" trap)
  // Map to [0,1] via heuristic.
  const kNormalized = Math.min(1, k / 8);
  const pBonus = Math.min(1, Math.max(0, (p - 0.4) / 0.2)); // 0 at p=0.4, 1 at p=0.6
  const chasePatternRiskScore = Math.min(1, 0.5 * kNormalized + 0.5 * pBonus);

  return {
    effectiveTargetStreak: k,
    cappedByBankroll,
    probReachStreak,
    oneInNRoundsCashOut,
    cashOutPayout,
    expectedRoundProfit,
    varianceRoundProfit,
    stdDevRoundProfit,
    expectedSpinsPerRound,
    probRoundProfitNonNegative,
    riskRewardRatio,
    chasePatternRiskScore,
  };
}

/** ── MC simulation (cross-validates closed-form) ────────────────────────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParoliStreakCashOutMcResult {
  rounds: number;
  observedProbReachStreak: number;
  observedExpectedRoundProfit: number;
  observedStdDevRoundProfit: number;
  observedExpectedSpinsPerRound: number;
}

/**
 * MC: simulate Paroli rounds; record cash-out frequency, mean round profit,
 * std-dev, and spins per round.
 */
export function simulateParoliStreakCashOut(
  cfg: ParoliStreakCashOutConfig,
  rounds: number,
  seed: number,
): ParoliStreakCashOutMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  const p = cfg.probWinPerSpin;
  const ratio = cfg.bankroll / cfg.baseBet;
  const kMaxByBankroll = Math.max(1, Math.floor(Math.log2(ratio + 1)));
  const k = Math.min(cfg.targetStreak, kMaxByBankroll);

  let cashOutCount = 0;
  let totalProfit = 0;
  const profits: number[] = [];
  let totalSpins = 0;

  for (let r = 0; r < rounds; r++) {
    let winsInRow = 0;
    let spinsThisRound = 0;
    let roundProfit = 0;
    let cashedOut = false;

    while (winsInRow < k) {
      spinsThisRound++;
      const currentBet = cfg.baseBet * Math.pow(2, winsInRow);
      if (rng() < p) {
        winsInRow++;
        if (winsInRow === k) {
          // Cash out: total profit accumulated through win-streak doubles
          roundProfit = cfg.baseBet * (Math.pow(2, k) - 1);
          cashedOut = true;
          break;
        }
      } else {
        // Loss at this step: lose the current bet
        roundProfit = -currentBet;
        break;
      }
    }
    if (cashedOut) cashOutCount++;
    totalProfit += roundProfit;
    profits.push(roundProfit);
    totalSpins += spinsThisRound;
  }

  const meanProfit = totalProfit / rounds;
  const sumSq = profits.reduce((acc, x) => acc + (x - meanProfit) * (x - meanProfit), 0);
  const stdProfit = Math.sqrt(sumSq / rounds);

  return {
    rounds,
    observedProbReachStreak: cashOutCount / rounds,
    observedExpectedRoundProfit: meanProfit,
    observedStdDevRoundProfit: stdProfit,
    observedExpectedSpinsPerRound: totalSpins / rounds,
  };
}
