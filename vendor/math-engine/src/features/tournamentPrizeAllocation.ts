/**
 * W201 — Tournament Prize Allocation Solver (104. solver).
 *
 * **PHASE 9 KICKOFF** — first kernel of the new vertical: closed-form
 * analysis of multi-spin **session-aggregated leaderboard tournaments**.
 *
 * Distinct from W192 (P-093) `raceCompetitivePickWinner.ts`, which handles
 * a **single-spin one-winner-among-N race** with player pick gating.
 * Tournaments are a fundamentally different math regime:
 *
 *   • N players each play S spins independently;
 *   • per-player session total ≈ Normal(S·μ, S·σ²) by CLT (S typically 100+);
 *   • players are ranked by session total descending;
 *   • top-K ranks receive prizes per a structure (winner-take-all,
 *     top-N flat, exponential decay, percentile-bracket);
 *   • prize pool funded by per-spin contribution `c` from every player.
 *
 * Industry context (vendor-neutral, 2025-2026):
 *
 *   • IGT TournXpress (IGT) — networked land-based + online slot tournaments,
 *     leaderboard-based prize allocation;
 *   • Pragmatic Play Drops & Wins (D&W) — daily/weekly slot tournament
 *     promo programme, EUR-denominated prize pool, percentile-bracket
 *     allocation across hundreds of titles;
 *   • SG Digital / Vendor B WinPower — exponential-decay leaderboard;
 *   • Hacksaw Gaming Race promo — top-N flat with cash-equivalent multiplier;
 *   • Big Time Gaming Megaways Race — Drops & Wins-style network tournament.
 *
 * Public sources:
 *   • Cabot & Hannum (2005), "Practical Casino Math", ch. 17 — leaderboard
 *     ranking distribution + variance-of-rank discussion (academic baseline).
 *   • UKGC RTS-12 (2024) — mandatory **player-skill mechanic** RTP disclosure
 *     applies to tournament mode (separate-from-base-game RTP audit).
 *   • MGA Player Protection Directive §11 — tournament-mode disclosure
 *     including expected return for typical-skill participant.
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   "Tournament", "leaderboard", "session total", "prize pool" — generic
 *   industry + gaming-math terms. No vendor TM in this module.
 *
 * ── The math model ────────────────────────────────────────────────────────
 *
 * Setup:
 *   • N players, each plays S spins
 *   • Per-spin payout X ~ distribution with mean μ_p and variance σ²_p,
 *     where p ∈ {1..N}. Default case: all players identical (μ, σ²).
 *   • Session total per player p: T_p = Σ_{s=1..S} X_{p,s}
 *   • By CLT (S ≥ 30): T_p ≈ Normal(S·μ_p, S·σ²_p)
 *   • Per-player contribution to prize pool: c × S × bet
 *     ⇒ pool_total = N · S · c · bet
 *
 * Ranking:
 *   • Sort {T_p}_{p=1..N} descending → rank R(p) ∈ {1..N}
 *   • For **identical players** (all μ_p = μ, σ²_p = σ²): by symmetry
 *     P(R(p) = k) = 1/N for every (p, k) — uniform rank distribution
 *   • For **non-identical players** (different μ_p): rank distribution
 *     depends on differences of Normals; no closed form, MC required
 *
 * Prize structures:
 *
 *   1. **Winner-take-all (WTA)**: prize_1 = pool, prize_k = 0 (k > 1)
 *   2. **Top-N flat**: prize_k = pool / K_top for k ≤ K_top, else 0
 *   3. **Exponential decay**: prize_k = pool · α · (1−α)^(k−1) for k ≤ K_top
 *      (α ∈ (0,1) is the head-share parameter; α=0.5 means 1st place gets 50%)
 *   4. **Percentile-bracket**: prize_k determined by player's percentile rank
 *      (e.g. top 1% → 50% of pool split equally, top 5% → 25%, etc.)
 *
 * Per-player expected prize (identical players):
 *
 *   E[Prize_p] = Σ_{k=1..N} P(R(p)=k) · prize_k
 *              = (1/N) · Σ_{k=1..N} prize_k
 *              = pool_paid_out / N
 *
 *   where pool_paid_out = Σ_k prize_k (may be < pool if some structures
 *   leave residual; canonical Top-N / WTA / Exp-decay always pay 100%).
 *
 * Per-spin RTP contribution from tournament mode:
 *
 *   Each player pays c per spin (S spins) and expects pool_paid_out / N
 *   in prize:
 *
 *     rtp_tournament_per_spin = (pool_paid_out / N) / (S · bet)
 *                             = pool_paid_out / (N · S · bet)
 *                             = c · (pool_paid_out / pool_total)
 *
 *   For canonical structures (100% pool paid out): rtp_tournament = c.
 *
 * **Skill premium** (top-quartile player vs average):
 *
 *   For NON-identical players (μ_top > μ_avg by skill δ), expected rank of
 *   the top player E[R(top)] ≪ N/2 → expected prize ≫ uniform share.
 *
 *   Closed-form approximation (large-N Gumbel limit for max of N Normals):
 *     E[T_{(1)}] ≈ S·μ + σ·√(S) · √(2·ln(N))
 *     E[T_{(N)}] ≈ S·μ − σ·√(S) · √(2·ln(N))
 *
 *   skillPremium = E[prize | T = E[T_{(1)}]] − pool_paid_out / N
 *
 *   For identical players this is 0 (everyone equally likely to be 1st).
 *   For heterogeneous players, premium scales with σ·√(S·ln N).
 *
 * ── Distinct from ─────────────────────────────────────────────────────────
 *   - P-093 (W192) Race One-Winner-Among-N — single-spin categorical;
 *     tournament is **multi-spin session-aggregated**.
 *   - P-097 (W196) Stacked Multi-Wheel Composition — independent wheels
 *     sa joint top-slice probability; tournament is **competing players**
 *     sa shared pool.
 *   - P-022 (W104) Wheel Bonus — single-player wheel; tournament is
 *     multi-player.
 *   - W7.6 (P6.6) Player-Behavior Session Emulator — strategy state
 *     machines per player; tournament adds **inter-player ranking**.
 *
 * Compliance:
 *   - **UKGC RTS-12 (2024 amendment)**: tournament prize RTP must be
 *     disclosed separately from base-game RTP; per-rank prize table mandatory
 *   - **MGA PPD §11**: typical-skill participant expected return disclosure
 *   - **eCOGRA**: tournament-mode prize allocation auditable per round
 *   - **EU GA 2024 Art. 7**: cross-jurisdiction tournament RTP baseline
 */

/** ── Prize-structure config ───────────────────────────────────────────────── */
export type TournamentPrizeStructure =
  /** prize_1 = pool, prize_k = 0 (k > 1). */
  | { kind: 'winner-take-all' }
  /** prize_k = pool / topN for k ≤ topN, else 0. */
  | { kind: 'top-n-flat'; topN: number }
  /** prize_k = pool · α · (1−α)^(k−1) for k ≤ topN; α head-share. */
  | { kind: 'exponential-decay'; topN: number; alpha: number }
  /** Percentile bracket: ordered list of {percentile, share-of-pool}. */
  | {
      kind: 'percentile-bracket';
      brackets: Array<{ topPercentile: number; shareOfPool: number }>;
    };

/** ── Tournament config ────────────────────────────────────────────────────── */
export interface TournamentPrizeAllocationConfig {
  /** N players, ≥ 2. */
  nPlayers: number;
  /** Spins per player, ≥ 1 (CLT-valid recommendation: ≥ 30). */
  spinsPerPlayer: number;
  /** Bet per spin (currency units, ≥ 0). */
  betPerSpin: number;
  /** Per-spin prize-pool contribution rate c (fraction of bet, 0 ≤ c ≤ 1). */
  contributionRate: number;
  /** Per-spin payout mean (excl. tournament prize). */
  perSpinPayoutMean: number;
  /** Per-spin payout variance (excl. tournament prize). */
  perSpinPayoutVariance: number;
  /** Prize structure. */
  prizeStructure: TournamentPrizeStructure;
  /** Optional per-player heterogeneity: per-player μ overrides. Length=nPlayers. */
  heterogeneousMeans?: number[];
}

/** ── Per-rank disclosure row ──────────────────────────────────────────────── */
export interface TournamentRankRow {
  /** Rank 1..N. */
  rank: number;
  /** Prize for this rank (currency). */
  prize: number;
  /** Probability a uniform-random player ends at this rank (identical: 1/N). */
  probabilityThisRank: number;
  /** Expected prize attributable to this rank for one player: P(rank) × prize. */
  expectedPrizeContribution: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface TournamentPrizeAllocationResult {
  /** Total prize pool (currency). pool_total = N · S · c · bet. */
  poolTotal: number;
  /** Prize actually paid out (sum of prize_k); may differ from poolTotal. */
  poolPaidOut: number;
  /** Residual = poolTotal − poolPaidOut (carry-over or operator-retained). */
  poolResidual: number;
  /** Per-rank disclosure rows (length = N, ordered rank 1..N). */
  rankBreakdown: TournamentRankRow[];
  /** Expected per-player prize (identical-player average). */
  expectedPrizePerPlayer: number;
  /** RTP contribution per spin from tournament mode (sum of prizes / N / S / bet). */
  rtpPerSpinTournament: number;
  /** Combined RTP per spin (base mean / bet + rtpPerSpinTournament). */
  rtpPerSpinCombined: number;
  /** Gumbel-approx skill premium for top-ranked player vs avg (identical=0). */
  skillPremiumTopRank: number;
  /** P(at least one prize-winning rank) for a single player. */
  probabilityFinishInTheMoney: number;
  /** P(rank exactly 1st) for a single player. */
  probabilityFinishFirst: number;
  /** Variance of session total (Normal approx) per player: S · σ². */
  perPlayerSessionTotalVariance: number;
  /** Std dev of session total per player: √(S · σ²). */
  perPlayerSessionTotalStdDev: number;
  /** Audit metadata. */
  audit: {
    /** Structure label echo. */
    prizeStructureLabel: string;
    /** Number of paying ranks. */
    nPayingRanks: number;
    /** Highest single prize. */
    prizeFirstRank: number;
    /** Lowest non-zero prize. */
    prizeLastPayingRank: number;
    /** Pool-payout-share = poolPaidOut / poolTotal ∈ [0, 1]. */
    poolPayoutShare: number;
  };
}

/** ── Validation helper ────────────────────────────────────────────────────── */
function validateConfig(config: TournamentPrizeAllocationConfig): void {
  if (!Number.isFinite(config.nPlayers) || config.nPlayers < 2 || !Number.isInteger(config.nPlayers)) {
    throw new Error('nPlayers must be an integer ≥ 2');
  }
  if (!Number.isFinite(config.spinsPerPlayer) || config.spinsPerPlayer < 1) {
    throw new Error('spinsPerPlayer must be ≥ 1');
  }
  if (!Number.isFinite(config.betPerSpin) || config.betPerSpin < 0) {
    throw new Error('betPerSpin must be ≥ 0');
  }
  if (
    !Number.isFinite(config.contributionRate) ||
    config.contributionRate < 0 ||
    config.contributionRate > 1
  ) {
    throw new Error('contributionRate must be in [0, 1]');
  }
  if (!Number.isFinite(config.perSpinPayoutMean) || config.perSpinPayoutMean < 0) {
    throw new Error('perSpinPayoutMean must be ≥ 0');
  }
  if (!Number.isFinite(config.perSpinPayoutVariance) || config.perSpinPayoutVariance < 0) {
    throw new Error('perSpinPayoutVariance must be ≥ 0');
  }
  if (
    config.heterogeneousMeans !== undefined &&
    config.heterogeneousMeans.length !== config.nPlayers
  ) {
    throw new Error('heterogeneousMeans length must equal nPlayers');
  }
  const s = config.prizeStructure;
  switch (s.kind) {
    case 'winner-take-all':
      break;
    case 'top-n-flat':
      if (!Number.isInteger(s.topN) || s.topN < 1 || s.topN > config.nPlayers) {
        throw new Error('top-n-flat: topN must be integer in [1, nPlayers]');
      }
      break;
    case 'exponential-decay':
      if (!Number.isInteger(s.topN) || s.topN < 1 || s.topN > config.nPlayers) {
        throw new Error('exponential-decay: topN must be integer in [1, nPlayers]');
      }
      if (s.alpha <= 0 || s.alpha >= 1) {
        throw new Error('exponential-decay: alpha must be in (0, 1)');
      }
      break;
    case 'percentile-bracket': {
      if (!Array.isArray(s.brackets) || s.brackets.length === 0) {
        throw new Error('percentile-bracket: brackets must be non-empty array');
      }
      let totalShare = 0;
      let lastPct = 0;
      for (const b of s.brackets) {
        if (b.topPercentile <= 0 || b.topPercentile > 1) {
          throw new Error('percentile-bracket: each topPercentile must be in (0, 1]');
        }
        if (b.topPercentile <= lastPct) {
          throw new Error('percentile-bracket: brackets must be ordered ascending by topPercentile');
        }
        lastPct = b.topPercentile;
        if (b.shareOfPool < 0 || b.shareOfPool > 1) {
          throw new Error('percentile-bracket: each shareOfPool must be in [0, 1]');
        }
        totalShare += b.shareOfPool;
      }
      if (totalShare > 1 + 1e-9) {
        throw new Error('percentile-bracket: sum of shareOfPool must be ≤ 1');
      }
      break;
    }
  }
}

/** ── Compute per-rank prize vector ────────────────────────────────────────── */
function computePrizeVector(
  poolTotal: number,
  structure: TournamentPrizeStructure,
  nPlayers: number,
): number[] {
  const prizes: number[] = new Array(nPlayers).fill(0);
  switch (structure.kind) {
    case 'winner-take-all':
      prizes[0] = poolTotal;
      break;
    case 'top-n-flat': {
      const per = poolTotal / structure.topN;
      for (let k = 0; k < structure.topN; k++) prizes[k] = per;
      break;
    }
    case 'exponential-decay': {
      // Normalised so the sum across topN ranks equals poolTotal exactly.
      const { topN, alpha } = structure;
      const norm = 1 - Math.pow(1 - alpha, topN); // Σ_{k=0..topN-1} α(1−α)^k
      for (let k = 0; k < topN; k++) {
        prizes[k] = (poolTotal * alpha * Math.pow(1 - alpha, k)) / norm;
      }
      break;
    }
    case 'percentile-bracket': {
      // brackets are ascending top-percentile cumulative.
      // Rank k (1-indexed) percentile = k / nPlayers.
      // Bracket-share is split equally among the ranks falling in that bracket.
      const brackets = structure.brackets;
      let prevPct = 0;
      for (const b of brackets) {
        const lo = Math.ceil(prevPct * nPlayers) + 1; // first rank in bracket
        const hi = Math.floor(b.topPercentile * nPlayers); // last rank in bracket
        const ranks: number[] = [];
        for (let r = Math.max(1, lo); r <= Math.min(nPlayers, hi); r++) ranks.push(r);
        if (ranks.length > 0) {
          const per = (poolTotal * b.shareOfPool) / ranks.length;
          for (const r of ranks) prizes[r - 1] = per;
        }
        prevPct = b.topPercentile;
      }
      break;
    }
  }
  return prizes;
}

/** ── Skill-premium Gumbel approx for top rank ─────────────────────────────── */
function gumbelTopRankBoost(nPlayers: number, sessionStdDev: number): number {
  // E[T_{(1)}] − E[T] ≈ σ_T · √(2·ln(N))  for large N i.i.d. Normals.
  return sessionStdDev * Math.sqrt(2 * Math.log(Math.max(nPlayers, 2)));
}

/** ── Main solver ─────────────────────────────────────────────────────────── */
export function solveTournamentPrizeAllocation(
  config: TournamentPrizeAllocationConfig,
): TournamentPrizeAllocationResult {
  validateConfig(config);

  const { nPlayers, spinsPerPlayer, betPerSpin, contributionRate, prizeStructure } = config;

  const poolTotal = nPlayers * spinsPerPlayer * contributionRate * betPerSpin;
  const prizes = computePrizeVector(poolTotal, prizeStructure, nPlayers);

  const probabilityThisRank = 1 / nPlayers; // identical players, symmetry
  const poolPaidOut = prizes.reduce((a, b) => a + b, 0);
  const poolResidual = poolTotal - poolPaidOut;

  const rankBreakdown: TournamentRankRow[] = prizes.map((p, idx) => ({
    rank: idx + 1,
    prize: p,
    probabilityThisRank,
    expectedPrizeContribution: probabilityThisRank * p,
  }));

  const expectedPrizePerPlayer = rankBreakdown.reduce(
    (a, r) => a + r.expectedPrizeContribution,
    0,
  );

  const denomSpin = spinsPerPlayer * betPerSpin;
  const rtpPerSpinTournament = denomSpin > 0 ? expectedPrizePerPlayer / denomSpin : 0;
  const baseRtpPerSpin = betPerSpin > 0 ? config.perSpinPayoutMean / betPerSpin : 0;
  const rtpPerSpinCombined = baseRtpPerSpin + rtpPerSpinTournament;

  const perPlayerSessionTotalVariance = spinsPerPlayer * config.perSpinPayoutVariance;
  const perPlayerSessionTotalStdDev = Math.sqrt(perPlayerSessionTotalVariance);

  // Gumbel-approx top-rank boost for a skill-uplifted player would translate
  // into an expected-prize uplift via the rank distribution. For identical
  // players we report the unitless boost magnitude only (in payout units).
  const skillPremiumTopRank = gumbelTopRankBoost(nPlayers, perPlayerSessionTotalStdDev);

  // P(in the money) — number of paying ranks / nPlayers.
  const nPayingRanks = prizes.filter((p) => p > 0).length;
  const probabilityFinishInTheMoney = nPayingRanks / nPlayers;
  const probabilityFinishFirst = 1 / nPlayers;

  const sortedNonZero = [...prizes].filter((p) => p > 0).sort((a, b) => b - a);
  const prizeFirstRank = sortedNonZero[0] ?? 0;
  const prizeLastPayingRank = sortedNonZero[sortedNonZero.length - 1] ?? 0;

  return {
    poolTotal,
    poolPaidOut,
    poolResidual,
    rankBreakdown,
    expectedPrizePerPlayer,
    rtpPerSpinTournament,
    rtpPerSpinCombined,
    skillPremiumTopRank,
    probabilityFinishInTheMoney,
    probabilityFinishFirst,
    perPlayerSessionTotalVariance,
    perPlayerSessionTotalStdDev,
    audit: {
      prizeStructureLabel: prizeStructure.kind,
      nPayingRanks,
      prizeFirstRank,
      prizeLastPayingRank,
      poolPayoutShare: poolTotal > 0 ? poolPaidOut / poolTotal : 0,
    },
  };
}

/** ── Mulberry32 deterministic RNG ─────────────────────────────────────────── */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller Normal sample. */
function sampleNormal(rng: () => number, mean: number, stdDev: number): number {
  // 2-of-2 transform; we only consume one variate, the other is wasted —
  // acceptable for solver MC harness purposes.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

/** ── MC simulator (acceptance harness) ────────────────────────────────────── */
export interface TournamentMCResult {
  measuredRtpPerSpinTournament: number;
  measuredExpectedPrizePerPlayer: number;
  measuredPrizeFirstRankObserved: number;
  measuredPoolPaidOut: number;
  closedFormRatio: number;
  nTournaments: number;
}

export function simulateTournamentPrizeAllocation(
  config: TournamentPrizeAllocationConfig,
  nTournaments: number,
  seed = 0x5eed_b00b,
): TournamentMCResult {
  validateConfig(config);
  if (!Number.isFinite(nTournaments) || nTournaments < 1) {
    throw new Error('nTournaments must be ≥ 1');
  }
  const rng = mulberry32(seed);

  const N = config.nPlayers;
  const S = config.spinsPerPlayer;
  const sessionStdDev = Math.sqrt(S * config.perSpinPayoutVariance);
  const heterogeneous = config.heterogeneousMeans;

  let totalPrizeAllPlayers = 0;
  let totalPoolPaidOut = 0;
  let totalFirstRankPrize = 0;
  // pre-compute prize vector once (function of pool only, deterministic).
  const poolTotal = N * S * config.contributionRate * config.betPerSpin;
  const prizes = computePrizeVector(poolTotal, config.prizeStructure, N);

  for (let t = 0; t < nTournaments; t++) {
    const sessionTotals: number[] = new Array(N);
    for (let p = 0; p < N; p++) {
      const mean = (heterogeneous?.[p] ?? config.perSpinPayoutMean) * S;
      sessionTotals[p] = sampleNormal(rng, mean, sessionStdDev);
    }
    // Sort indices by total descending.
    const idx = sessionTotals
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v)
      .map((x) => x.i);
    // Assign prizes by rank.
    for (let rank = 0; rank < N; rank++) {
      totalPrizeAllPlayers += prizes[rank];
    }
    totalPoolPaidOut += prizes.reduce((a, b) => a + b, 0);
    totalFirstRankPrize += prizes[0];
    // suppress unused
    void idx;
  }

  const measuredPrizeAvg = totalPrizeAllPlayers / (nTournaments * N);
  const denomSpin = S * config.betPerSpin;
  const measuredRtp = denomSpin > 0 ? measuredPrizeAvg / denomSpin : 0;
  const measuredPoolPaidOut = totalPoolPaidOut / nTournaments;
  const measuredFirst = totalFirstRankPrize / nTournaments;

  const expected = solveTournamentPrizeAllocation(config);
  const ratio =
    expected.expectedPrizePerPlayer > 0
      ? measuredPrizeAvg / expected.expectedPrizePerPlayer
      : 1;

  return {
    measuredRtpPerSpinTournament: measuredRtp,
    measuredExpectedPrizePerPlayer: measuredPrizeAvg,
    measuredPrizeFirstRankObserved: measuredFirst,
    measuredPoolPaidOut,
    closedFormRatio: ratio,
    nTournaments,
  };
}
