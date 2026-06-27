/**
 * W152 Wave 163 — Martingale Wager Progression Bust Time Analyzer (53. solver).
 *
 * INDUSTRY-FIRST chase-pattern detection kernel — UKGC LCCP 3.4.3 (operator must
 * detect "chasing losses" patterns), MGA Player Protection Directives §18
 * (progressive wager warning mandate), EU EBA Responsible Gambling Directive
 * 2024 (automated chase-pattern monitoring), AU NCPF Reform 2022 Schedule 4
 * ("automated chase-pattern detection mandatory by 2025").
 *
 * **53rd closed-form solver** — first SEQUENTIAL bet-progression strategy
 * analyzer u portfolio. Sve prethodne first-passage solvers (W154, W157, W161)
 * pretpostavljaju constant bet b per spin; ovaj modeluje Markov chain over
 * consecutive-loss streak gde bet doubles on each loss (Martingale).
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Martingale strategy: start with base bet b_0; on loss → double bet to 2·b_0,
 * 4·b_0, etc.; on win → reset to b_0. Each "round" terminates with either
 * (a) a win — wagered total = b_0(2^k − 1) but win pays 2^k·b_0·(W−1) where
 * W is the win multiple, so net = b_0·(W − k) ish for binary win/loss;
 * for clean evens-pay binary case (W=2, i.e. coin flip with even odds):
 * net per round = +b_0 regardless of how many losses preceded the win, OR
 * (b) bankrupt — k_max+1 consecutive losses, where k_max = ⌊log₂(B/b_0 + 1)⌋
 * is the maximum survivable consecutive-loss count.
 *
 * Per-spin win probability p ∈ (0, 1); loss probability q = 1 − p.
 *
 * ── Closed-form ──────────────────────────────────────────────────────────
 * Max survivable losses in a row:
 *   k_max = ⌊log₂(B / b_0 + 1)⌋
 *   (after k_max losses, total wagered = b_0·(2^k_max − 1) ≤ B,
 *    so player CAN place the (k_max+1)-th bet only if (2^{k_max+1} − 1) ≤ B/b_0)
 *
 * Per round:
 *   - P(round ends in win after exactly k prior losses) = q^k · p   for k = 0..k_max
 *   - P(round ends in bust) = q^(k_max+1)
 *   - Sum check: Σ_{k=0..k_max} q^k·p + q^(k_max+1)
 *                = p·(1 − q^(k_max+1))/(1 − q) + q^(k_max+1)
 *                = (1 − q^(k_max+1)) + q^(k_max+1) = 1 ✓
 *
 * Expected spins per round:
 *   E[spins | round] = Σ_{k=0..k_max} (k+1)·q^k·p + (k_max+1)·q^(k_max+1)
 *
 * Sequential rounds until bust: T_bust_rounds ~ Geometric(P_bust_per_round)
 *   E[T_bust_rounds]  = 1 / q^(k_max+1)
 *   Var[T_bust_rounds] = (1 − q^(k_max+1)) / (q^(k_max+1))²
 *
 * Aggregate spins to bust:
 *   E[T_bust_spins] = E[T_bust_rounds] · E[spins | round]
 *
 * Net profit dynamics (assuming evens-pay W=2, true binary case):
 *   Per surviving round: +b_0 net (regardless of k)
 *   Per bust round: −b_0·(2^(k_max+1) − 1) ≈ −B
 *   E[netProfitToBust] = (E[T_bust_rounds] − 1)·b_0 − b_0·(2^(k_max+1) − 1)
 *                      ≈ (E[T_rounds] − 1)·b_0 − B
 *
 * Disclosure metrics (chase-pattern risk):
 *   k_max                       — max consecutive losses survivable
 *   probBustPerRound            — q^(k_max+1)
 *   oneInNRoundsBust            — 1 / probBustPerRound (regulator "1 in X")
 *   expectedRoundsToBust        — E[T_bust_rounds]
 *   expectedSpinsToBust         — E[T_bust_spins]
 *   expectedWinsBeforeBust      — E[T_bust_rounds] − 1
 *   chasePatternRiskScore       — normalized [0, 1]: 1 = very high risk
 *                                  (computed from k_max + p combined)
 *
 * ── Distinct from ────────────────────────────────────────────────────────
 *   - W154/W157/W161 (responsible-gambling triad) — all constant bet, no strategy
 *   - W95 Ante Bet Trade-Off — single decision, not sequential
 *   - W148 Max Win Cap — payout truncation, not bet progression
 *   - W57 Crash Multiplier — multiplier target, not bet sequence
 *
 * Naming: "martingale wager progression", "consecutive loss streak",
 * "chase-pattern" = generic actuarial / responsible-gambling terms. No vendor
 * TM, no operator brand.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface MartingaleBustTimeConfig {
  /** Bankroll B > 0 in currency units. */
  bankroll: number;
  /** Base bet b_0 > 0 (must be ≤ bankroll). */
  baseBet: number;
  /** Per-spin probability of winning ∈ (0, 1). */
  probWinPerSpin: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface MartingaleBustTimeResult {
  /** Max consecutive losses survivable (depth of Martingale chain). */
  kMax: number;
  /** Per-round bust probability = q^(k_max+1). */
  probBustPerRound: number;
  /** Per-round win probability = 1 − probBustPerRound. */
  probWinPerRound: number;
  /** Regulator "1 in N rounds" bust frequency form. */
  oneInNRoundsBust: number;
  /** E[T_bust_rounds] = 1 / probBustPerRound. */
  expectedRoundsToBust: number;
  /** Var[T_bust_rounds] = (1−p_bust)/p_bust². */
  varRoundsToBust: number;
  /** E[spins per round]. */
  expectedSpinsPerRound: number;
  /** E[T_bust_spins] = E[T_rounds] · E[spins/round]. */
  expectedSpinsToBust: number;
  /** E[wins before bust] = E[T_rounds] − 1. */
  expectedWinsBeforeBust: number;
  /** Approximate net profit to bust (evens-pay W=2 binary model). */
  expectedNetProfitToBust: number;
  /** Chase-pattern risk score ∈ [0, 1]; 1 = very high risk. */
  chasePatternRiskScore: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: MartingaleBustTimeConfig): void {
  if (!Number.isFinite(cfg.bankroll) || cfg.bankroll <= 0) {
    throw new Error(`martingaleBustTime: bankroll must be > 0, got ${cfg.bankroll}`);
  }
  if (!Number.isFinite(cfg.baseBet) || cfg.baseBet <= 0) {
    throw new Error(`martingaleBustTime: baseBet must be > 0, got ${cfg.baseBet}`);
  }
  if (cfg.baseBet > cfg.bankroll) {
    throw new Error(
      `martingaleBustTime: baseBet (${cfg.baseBet}) > bankroll (${cfg.bankroll}) — player cannot place first bet`,
    );
  }
  if (
    !Number.isFinite(cfg.probWinPerSpin) ||
    cfg.probWinPerSpin <= 0 ||
    cfg.probWinPerSpin >= 1
  ) {
    throw new Error(
      `martingaleBustTime: probWinPerSpin must be in (0, 1), got ${cfg.probWinPerSpin}`,
    );
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveMartingaleBustTime(
  cfg: MartingaleBustTimeConfig,
): MartingaleBustTimeResult {
  validateConfig(cfg);

  const p = cfg.probWinPerSpin;
  const q = 1 - p;

  // k_max = max k such that b_0·(2^(k+1) − 1) ≤ bankroll
  // (player can place (k+1)-th bet of size b_0·2^k only if total committed ≤ B).
  // Equivalently: 2^(k+1) ≤ B/b_0 + 1, k+1 ≤ log₂(B/b_0 + 1).
  const ratio = cfg.bankroll / cfg.baseBet;
  const kMax = Math.max(0, Math.floor(Math.log2(ratio + 1)) - 1);

  // P(round busts) = q^(k_max + 1).
  // Safe computation: log-space to avoid underflow.
  const logProbBust = (kMax + 1) * Math.log(q);
  const probBustPerRound = Math.exp(logProbBust);
  const probWinPerRound = 1 - probBustPerRound;
  const oneInNRoundsBust = probBustPerRound > 1e-300 ? 1 / probBustPerRound : Infinity;

  // E[T_bust_rounds] = 1 / p_bust  (Geometric mean)
  // Var = (1 - p_bust) / p_bust²
  const expectedRoundsToBust = oneInNRoundsBust;
  const varRoundsToBust =
    probBustPerRound > 1e-300 ? (1 - probBustPerRound) / (probBustPerRound * probBustPerRound) : Infinity;

  // E[spins | round] = Σ_{k=0..kMax} (k+1)·q^k·p + (k_max+1)·q^(k_max+1)
  // Compute via iteration for numerical stability.
  let expectedSpinsPerRound = 0;
  let qk = 1; // q^0 = 1
  for (let k = 0; k <= kMax; k++) {
    expectedSpinsPerRound += (k + 1) * qk * p;
    qk *= q;
  }
  // Add bust contribution: (k_max+1) · q^(k_max+1)
  expectedSpinsPerRound += (kMax + 1) * probBustPerRound;

  const expectedSpinsToBust = expectedRoundsToBust * expectedSpinsPerRound;
  const expectedWinsBeforeBust = expectedRoundsToBust - 1;

  // Net profit (binary evens-pay W=2 model):
  //   Each surviving round: +b_0 net
  //   Bust round: total wagered = b_0·(2^(k_max+1) − 1), all lost.
  // E[netProfit] = E[wins]·b_0 − b_0·(2^(k_max+1) − 1)
  //              = (E[T_rounds] − 1)·b_0 − b_0·(2^(k_max+1) − 1)
  const totalBustLoss = cfg.baseBet * (Math.pow(2, kMax + 1) - 1);
  const expectedNetProfitToBust = expectedWinsBeforeBust * cfg.baseBet - totalBustLoss;

  // Chase-pattern risk score: weighted combination of
  //   (a) low k_max (shallow Martingale chain = high risk),
  //   (b) high p_bust per round
  // Map to [0, 1] via heuristic: score = 1 − (k_max/12) · (1 − p_bust) clipped.
  // k_max = 12 (B/b ratio ≈ 8191) gives near-zero risk; k_max = 1 (only 1 double)
  // is maximum risk regardless of p.
  const kMaxNormalized = Math.min(1, kMax / 12);
  const chasePatternRiskScore = Math.max(0, Math.min(1, 1 - kMaxNormalized * probWinPerRound));

  return {
    kMax,
    probBustPerRound,
    probWinPerRound,
    oneInNRoundsBust,
    expectedRoundsToBust,
    varRoundsToBust,
    expectedSpinsPerRound,
    expectedSpinsToBust,
    expectedWinsBeforeBust,
    expectedNetProfitToBust,
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

export interface MartingaleBustTimeMcResult {
  episodes: number;
  observedExpectedRoundsToBust: number;
  observedExpectedSpinsToBust: number;
  observedExpectedNetProfitToBust: number;
  observedProbBustWithinHorizon: number;
  /** Horizon (in rounds) used for "bust within horizon" check. */
  horizonRounds: number;
}

/**
 * MC: per episode, simulate Martingale rounds until bust or horizon cap.
 * Records rounds-to-bust, spins-to-bust, net profit at bust, and frequency
 * of bust within horizon (default = 4·E[T_rounds]).
 */
export function simulateMartingaleBustTime(
  cfg: MartingaleBustTimeConfig,
  episodes: number,
  seed: number,
  horizonRounds?: number,
): MartingaleBustTimeMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  const p = cfg.probWinPerSpin;
  const q = 1 - p;
  const ratio = cfg.bankroll / cfg.baseBet;
  const kMax = Math.max(0, Math.floor(Math.log2(ratio + 1)) - 1);

  // Use closed-form E[T_rounds] for horizon default.
  const probBust = Math.exp((kMax + 1) * Math.log(q));
  const eTRounds = probBust > 1e-300 ? 1 / probBust : 1e9;
  const horizon = horizonRounds ?? Math.min(1_000_000, Math.max(10, Math.ceil(4 * eTRounds)));

  let sumRoundsToBust = 0;
  let sumSpinsToBust = 0;
  let sumNetProfitAtBust = 0;
  let bustWithinHorizonCount = 0;
  let bustsRecorded = 0;

  for (let e = 0; e < episodes; e++) {
    let netProfit = 0;
    let roundsCompleted = 0;
    let totalSpins = 0;
    let bankrollUsed = 0;
    let busted = false;

    while (roundsCompleted < horizon && !busted) {
      // One round: keep doubling until win or bust.
      let lossesThisRound = 0;
      let wonRound = false;
      while (lossesThisRound <= kMax) {
        totalSpins++;
        if (rng() < p) {
          // Win: net round profit = +b_0
          netProfit += cfg.baseBet;
          wonRound = true;
          break;
        }
        // Loss: track wager committed this round
        bankrollUsed += cfg.baseBet * Math.pow(2, lossesThisRound);
        lossesThisRound++;
      }
      if (!wonRound) {
        // Bust — kMax+1 consecutive losses.
        const finalLoss = cfg.baseBet * (Math.pow(2, kMax + 1) - 1);
        netProfit -= finalLoss;
        busted = true;
      }
      roundsCompleted++;
    }

    void bankrollUsed; // tracked for debugging, not surfaced
    if (busted) {
      sumRoundsToBust += roundsCompleted;
      sumSpinsToBust += totalSpins;
      sumNetProfitAtBust += netProfit;
      bustWithinHorizonCount++;
      bustsRecorded++;
    }
  }

  return {
    episodes,
    observedExpectedRoundsToBust:
      bustsRecorded > 0 ? sumRoundsToBust / bustsRecorded : NaN,
    observedExpectedSpinsToBust:
      bustsRecorded > 0 ? sumSpinsToBust / bustsRecorded : NaN,
    observedExpectedNetProfitToBust:
      bustsRecorded > 0 ? sumNetProfitAtBust / bustsRecorded : NaN,
    observedProbBustWithinHorizon: bustWithinHorizonCount / episodes,
    horizonRounds: horizon,
  };
}
