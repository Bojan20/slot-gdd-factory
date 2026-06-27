/**
 * W202 / PHASE 9.2 — Multi-Pool Cross-Tournament Network Solver (105. solver).
 *
 * Closes the "networked tournament" gap: a single prize pool funded by
 * **multiple titles** across **multiple days**, with players freely
 * distributing their session time across titles within the network.
 *
 * Industry context (2025-2026):
 *
 *   • Pragmatic Drops & Wins — 200+ titles share a single weekly EUR
 *     prize pool; per-title contribution rate varies (high-volatility
 *     titles contribute more); cumulative leaderboard across all titles.
 *   • IGT TournXpress Network — multi-cabinet WAP tournament where
 *     each cabinet contributes to a shared pool at a per-cabinet rate.
 *   • SG / L&W Network Tournament Suite (NTS) — cross-property leader-
 *     board with per-property weighting + multi-day cumulative.
 *   • BTG Megaways Race — 80+ Megaways titles, daily + weekly + monthly
 *     tier-stacked tournaments.
 *
 * Sources:
 *   • Cabot & Hannum (2005), "Practical Casino Math", ch. 17 — networked
 *     pool variance decomposition (baseline academic treatment).
 *   • UKGC RTS-12 (2024) — cross-title tournament must disclose per-title
 *     contribution rate + per-title expected return for typical participant.
 *   • MGA Player Protection Directive §11 — multi-day cumulative leader-
 *     board mandatory disclosure of carry-over rules + reset cadence.
 *
 * Naming: "cross-title", "network pool", "cumulative leaderboard",
 * "per-title contribution rate" — generic industry terms; no vendor TM.
 *
 * ── Math model ────────────────────────────────────────────────────────────
 *
 * Setup:
 *   • M titles, indexed t ∈ {1..M}
 *   • D days in the network tournament window, d ∈ {1..D}
 *   • N players (uniform participation per identical-player assumption)
 *   • Per-title-per-day per-player spins: S_{t,d}  (default uniform = S/M/D)
 *   • Per-title-per-day per-spin contribution rate: c_{t,d}
 *   • Per-title per-spin payout (μ_t, σ²_t)  — base-game RTP + variance
 *
 * Pool funding (deterministic):
 *   pool_total = Σ_{t,d} N · S_{t,d} · c_{t,d} · bet_{t,d}
 *
 *   Per-title contribution share:
 *     share_t = Σ_d N·S_{t,d}·c_{t,d}·bet_{t,d} / pool_total
 *
 *   Per-day contribution share:
 *     share_d = Σ_t N·S_{t,d}·c_{t,d}·bet_{t,d} / pool_total
 *
 * Per-player cumulative session total (CLT over independent spins):
 *   T_p = Σ_{t,d} Σ_{s} X_{p,t,d,s}
 *   • E[T_p] = Σ_{t,d} S_{t,d} · μ_t · bet_{t,d}
 *   • Var[T_p] = Σ_{t,d} S_{t,d} · σ²_t · bet²_{t,d}
 *     (independence across (t,d,s) tuples ⇒ additive variance)
 *   • T_p ≈ Normal(E[T_p], Var[T_p])  for total spins ≥ 30
 *
 * Identical-player rank distribution (symmetry):
 *   • Every (p, k) pair: P(rank(p) = k) = 1/N
 *   • Same as W201 (single-title); the multi-title structure does NOT
 *     break per-player rank symmetry as long as ALL players follow the
 *     same participation profile.
 *
 * **NOVEL**: Title-skew uplift (player elects high-RTP titles):
 *   • If player p deviates by allocating more spins to title t* with
 *     μ_{t*} > μ_avg, expected rank improves.
 *   • Closed-form approximation (small-deviation expansion):
 *
 *       boost_skew(p) = (ΔE[T_p]) / σ_T  · σ_T·√(2·ln N)
 *                     = ΔE[T_p] · √(2·ln N)
 *
 *     where ΔE[T_p] = (Σ_{t,d} ΔS_{p,t,d} · μ_t · bet_{t,d}).
 *
 *     **Critical insight**: skew uplift is **independent of σ_T** at first
 *     order — bigger absolute μ-spread among titles ⇒ bigger uplift.
 *     This is a clean UKGC RTS-12 disclosure metric for "title-elect
 *     player skill premium".
 *
 * Multi-day carry-over:
 *   • Default: full-pool carry to day D's leaderboard (most common).
 *   • Alternative: per-day reset + monthly grand reset (BTG-style).
 *   • Per-day reset model: each day is W201 sub-tournament with pool_d.
 *
 * Per-player expected prize (identical players, full-pool carry):
 *   • Same as W201: E[prize] = pool_paid_out / N
 *   • RTP equivalence: rtp_tournament = (Σ_t S_t·c_t) / (Σ_t S_t·bet_t)
 *     — weighted-average contribution rate across titles per player.
 *
 * ── Distinct from ─────────────────────────────────────────────────────────
 *   - **W201 Tournament Prize Allocation** — single-title single-day
 *     prize structure; this kernel extends to **multi-title × multi-day**
 *     network with per-title contribution heterogeneity.
 *   - **P-097 (W196) Stacked Multi-Wheel Composition** — independent
 *     wheels with joint top-slice prob; this kernel is players competing
 *     over an aggregated pool, not wheels combining.
 *   - **Network Progressive (`calculateNetworkProgressiveRTP`)** —
 *     network-wide JACKPOT pool funding; this kernel is TOURNAMENT pool
 *     (rank-distributed across players in a window, not random-trigger).
 */

/** ── Per-title-per-day cell ───────────────────────────────────────────────── */
export interface NetworkTitleDayCell {
  /** Optional label (audit only). */
  label?: string;
  /** Per-player spins on this title/day, ≥ 0. */
  spinsPerPlayer: number;
  /** Per-spin contribution to pool, fraction of bet ∈ [0, 1]. */
  contributionRate: number;
  /** Bet per spin (currency, ≥ 0). */
  betPerSpin: number;
  /** Per-spin payout mean for this title (base-game RTP × bet), ≥ 0. */
  perSpinPayoutMean: number;
  /** Per-spin payout variance for this title, ≥ 0. */
  perSpinPayoutVariance: number;
}

/** ── Prize structure (reused from W201) ───────────────────────────────────── */
export type NetworkPrizeStructure =
  | { kind: 'winner-take-all' }
  | { kind: 'top-n-flat'; topN: number }
  | { kind: 'exponential-decay'; topN: number; alpha: number }
  | {
      kind: 'percentile-bracket';
      brackets: Array<{ topPercentile: number; shareOfPool: number }>;
    };

/** ── Network config ───────────────────────────────────────────────────────── */
export interface MultiPoolCrossTournamentConfig {
  /** N players, ≥ 2. */
  nPlayers: number;
  /**
   * Per-title-per-day grid. Outer index = title (M); inner index = day (D).
   * All inner arrays must have the same length (D).
   */
  titleDayGrid: NetworkTitleDayCell[][];
  /** Prize structure across the cumulative leaderboard. */
  prizeStructure: NetworkPrizeStructure;
  /**
   * Multi-day carry-over policy:
   *   - "cumulative": single grand leaderboard across all D days (default)
   *   - "per-day-reset": each day is its own sub-tournament with prizes
   *     allocated D times (each from pool_d = pool_total / D)
   */
  multiDayPolicy?: 'cumulative' | 'per-day-reset';
}

/** ── Per-title disclosure row ─────────────────────────────────────────────── */
export interface TitleContributionRow {
  /** Title index 0..M-1. */
  titleIndex: number;
  /** Echo of cell.label (joined across days). */
  label: string;
  /** Total contribution to pool from this title across all D days. */
  contributionToPool: number;
  /** Share of total pool from this title. */
  shareOfPool: number;
  /** Total per-player spins on this title across D days. */
  spinsPerPlayerTotal: number;
  /** Per-player expected payout from this title (base-game). */
  expectedBasePayoutPerPlayer: number;
  /** This title's variance contribution to per-player session total. */
  varianceContributionPerPlayer: number;
}

/** ── Per-rank row (reused shape from W201) ────────────────────────────────── */
export interface NetworkRankRow {
  rank: number;
  prize: number;
  probabilityThisRank: number;
  expectedPrizeContribution: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface MultiPoolCrossTournamentResult {
  /** Total pool across all (title, day) cells. */
  poolTotal: number;
  /** Sum of paid prizes. */
  poolPaidOut: number;
  /** Pool residual (carry-over or operator-retained). */
  poolResidual: number;
  /** Per-rank disclosure rows (cumulative leaderboard). */
  rankBreakdown: NetworkRankRow[];
  /** Per-title disclosure (UKGC RTS-12 mandatory). */
  perTitle: TitleContributionRow[];
  /** Expected per-player prize from network tournament mode. */
  expectedPrizePerPlayer: number;
  /** RTP per spin attributable to tournament mode (weighted-avg c across titles). */
  rtpPerSpinTournament: number;
  /** Weighted-avg base RTP per spin across all (t,d) cells. */
  rtpPerSpinBaseAverage: number;
  /** Combined RTP per spin (base + tournament). */
  rtpPerSpinCombined: number;
  /** Per-player cumulative session total: E[T_p]. */
  expectedSessionTotal: number;
  /** Per-player cumulative session total variance: Var[T_p]. */
  varianceSessionTotal: number;
  /** Per-player cumulative session total std dev: √Var. */
  stdDevSessionTotal: number;
  /** Title-elect skill premium (Gumbel approx) — top-μ title heavy skew bonus. */
  titleSkewSkillPremium: number;
  /** Best-title index by μ (informational for skill-rational player). */
  bestTitleByMean: number;
  /** Worst-title index by μ. */
  worstTitleByMean: number;
  /** P(rank = 1) per player (identical: 1/N). */
  probabilityFinishFirst: number;
  /** P(in the money) — paying ranks / N. */
  probabilityFinishInTheMoney: number;
  /** Audit metadata. */
  audit: {
    nTitles: number;
    nDays: number;
    nPlayers: number;
    multiDayPolicy: 'cumulative' | 'per-day-reset';
    totalSpinsPerPlayer: number;
    nPayingRanks: number;
    poolPayoutShare: number;
    perTitleContributionVarianceAcrossTitles: number;
  };
}

/** ── Validation ──────────────────────────────────────────────────────────── */
function validateNetworkConfig(config: MultiPoolCrossTournamentConfig): void {
  if (!Number.isInteger(config.nPlayers) || config.nPlayers < 2) {
    throw new Error('nPlayers must be an integer ≥ 2');
  }
  if (!Array.isArray(config.titleDayGrid) || config.titleDayGrid.length === 0) {
    throw new Error('titleDayGrid must be a non-empty array of titles');
  }
  const D = config.titleDayGrid[0].length;
  if (D === 0) throw new Error('titleDayGrid rows must be non-empty (D ≥ 1)');
  for (const titleRow of config.titleDayGrid) {
    if (!Array.isArray(titleRow) || titleRow.length !== D) {
      throw new Error('All title rows must have same length D');
    }
    for (const cell of titleRow) {
      if (!Number.isFinite(cell.spinsPerPlayer) || cell.spinsPerPlayer < 0) {
        throw new Error('cell.spinsPerPlayer must be ≥ 0');
      }
      if (
        !Number.isFinite(cell.contributionRate) ||
        cell.contributionRate < 0 ||
        cell.contributionRate > 1
      ) {
        throw new Error('cell.contributionRate must be in [0, 1]');
      }
      if (!Number.isFinite(cell.betPerSpin) || cell.betPerSpin < 0) {
        throw new Error('cell.betPerSpin must be ≥ 0');
      }
      if (!Number.isFinite(cell.perSpinPayoutMean) || cell.perSpinPayoutMean < 0) {
        throw new Error('cell.perSpinPayoutMean must be ≥ 0');
      }
      if (!Number.isFinite(cell.perSpinPayoutVariance) || cell.perSpinPayoutVariance < 0) {
        throw new Error('cell.perSpinPayoutVariance must be ≥ 0');
      }
    }
  }
  // Reuse W201 prize-structure validation shape
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
          throw new Error('percentile-bracket: brackets must be ordered ascending');
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
  const policy = config.multiDayPolicy ?? 'cumulative';
  if (policy !== 'cumulative' && policy !== 'per-day-reset') {
    throw new Error('multiDayPolicy must be "cumulative" or "per-day-reset"');
  }
}

/** ── Prize vector (reused from W201 shape, exported for cross-solver) ─────── */
function computeNetworkPrizeVector(
  poolTotal: number,
  structure: NetworkPrizeStructure,
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
      const { topN, alpha } = structure;
      const norm = 1 - Math.pow(1 - alpha, topN);
      for (let k = 0; k < topN; k++) {
        prizes[k] = (poolTotal * alpha * Math.pow(1 - alpha, k)) / norm;
      }
      break;
    }
    case 'percentile-bracket': {
      let prevPct = 0;
      for (const b of structure.brackets) {
        const lo = Math.ceil(prevPct * nPlayers) + 1;
        const hi = Math.floor(b.topPercentile * nPlayers);
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

/** ── Main solver ─────────────────────────────────────────────────────────── */
export function solveMultiPoolCrossTournament(
  config: MultiPoolCrossTournamentConfig,
): MultiPoolCrossTournamentResult {
  validateNetworkConfig(config);

  const policy = config.multiDayPolicy ?? 'cumulative';
  const M = config.titleDayGrid.length;
  const D = config.titleDayGrid[0].length;
  const N = config.nPlayers;

  // Pool total + per-title contribution
  let poolTotal = 0;
  const perTitleContribution: number[] = new Array(M).fill(0);
  const perTitleSpins: number[] = new Array(M).fill(0);
  const perTitleExpectedPayout: number[] = new Array(M).fill(0);
  const perTitleVarianceContribution: number[] = new Array(M).fill(0);
  const perTitleMean: number[] = new Array(M).fill(0);

  let totalSpinsPerPlayer = 0;
  let expectedSessionTotal = 0;
  let varianceSessionTotal = 0;
  let totalBetVolumePerPlayer = 0;
  let totalContributionPerPlayer = 0;

  for (let t = 0; t < M; t++) {
    let titleSpinsTotal = 0;
    let titleMeanWeighted = 0;
    let titleMeanWeightSum = 0;
    for (let d = 0; d < D; d++) {
      const cell = config.titleDayGrid[t][d];
      const contribCell = N * cell.spinsPerPlayer * cell.contributionRate * cell.betPerSpin;
      poolTotal += contribCell;
      perTitleContribution[t] += contribCell;
      titleSpinsTotal += cell.spinsPerPlayer;
      perTitleExpectedPayout[t] += cell.spinsPerPlayer * cell.perSpinPayoutMean;
      perTitleVarianceContribution[t] +=
        cell.spinsPerPlayer * cell.perSpinPayoutVariance * cell.betPerSpin * cell.betPerSpin;
      totalSpinsPerPlayer += cell.spinsPerPlayer;
      expectedSessionTotal += cell.spinsPerPlayer * cell.perSpinPayoutMean;
      varianceSessionTotal +=
        cell.spinsPerPlayer * cell.perSpinPayoutVariance * cell.betPerSpin * cell.betPerSpin;
      totalBetVolumePerPlayer += cell.spinsPerPlayer * cell.betPerSpin;
      totalContributionPerPlayer += cell.spinsPerPlayer * cell.contributionRate * cell.betPerSpin;
      titleMeanWeighted += cell.spinsPerPlayer * cell.perSpinPayoutMean;
      titleMeanWeightSum += cell.spinsPerPlayer;
    }
    perTitleSpins[t] = titleSpinsTotal;
    perTitleMean[t] = titleMeanWeightSum > 0 ? titleMeanWeighted / titleMeanWeightSum : 0;
  }

  // Prize vector
  let prizes: number[];
  let poolPaidOut: number;
  if (policy === 'cumulative') {
    prizes = computeNetworkPrizeVector(poolTotal, config.prizeStructure, N);
    poolPaidOut = prizes.reduce((a, b) => a + b, 0);
  } else {
    // per-day-reset: D sub-tournaments each with pool_d = poolTotal / D
    const poolPerDay = poolTotal / D;
    const dayPrizes = computeNetworkPrizeVector(poolPerDay, config.prizeStructure, N);
    // For per-day reset, every day independently allocates poolPerDay across
    // its own leaderboard. Total per-rank prize ACROSS THE WINDOW is dayPrizes[k] × D,
    // by symmetry of identical players (each day's rank is uniform 1/N).
    prizes = dayPrizes.map((p) => p * D);
    poolPaidOut = prizes.reduce((a, b) => a + b, 0);
  }

  const probabilityThisRank = 1 / N;
  const rankBreakdown: NetworkRankRow[] = prizes.map((p, idx) => ({
    rank: idx + 1,
    prize: p,
    probabilityThisRank,
    expectedPrizeContribution: probabilityThisRank * p,
  }));

  const expectedPrizePerPlayer = rankBreakdown.reduce(
    (a, r) => a + r.expectedPrizeContribution,
    0,
  );

  const rtpPerSpinTournament =
    totalBetVolumePerPlayer > 0 ? expectedPrizePerPlayer / totalBetVolumePerPlayer : 0;
  const rtpPerSpinBaseAverage =
    totalBetVolumePerPlayer > 0 ? expectedSessionTotal / totalBetVolumePerPlayer : 0;
  const rtpPerSpinCombined = rtpPerSpinBaseAverage + rtpPerSpinTournament;

  // Per-title disclosure
  const perTitle: TitleContributionRow[] = [];
  for (let t = 0; t < M; t++) {
    const labels: string[] = [];
    for (let d = 0; d < D; d++) {
      const l = config.titleDayGrid[t][d].label;
      if (l) labels.push(`d${d}:${l}`);
    }
    perTitle.push({
      titleIndex: t,
      label: labels.join('|') || `t${t}`,
      contributionToPool: perTitleContribution[t],
      shareOfPool: poolTotal > 0 ? perTitleContribution[t] / poolTotal : 0,
      spinsPerPlayerTotal: perTitleSpins[t],
      expectedBasePayoutPerPlayer: perTitleExpectedPayout[t],
      varianceContributionPerPlayer: perTitleVarianceContribution[t],
    });
  }

  // Title-skew skill premium (Gumbel approx)
  const bestTitleByMean = perTitleMean.indexOf(Math.max(...perTitleMean));
  const worstTitleByMean = perTitleMean.indexOf(Math.min(...perTitleMean));
  const muSpread = perTitleMean[bestTitleByMean] - perTitleMean[worstTitleByMean];
  // If the player reallocates K spins from worst → best title:
  // ΔE[T] = K · (μ_best − μ_worst); we report the per-(re-allocated-spin) boost.
  const titleSkewSkillPremium = muSpread * Math.sqrt(2 * Math.log(Math.max(N, 2)));

  // Audit
  const nPayingRanks = prizes.filter((p) => p > 0).length;
  const probabilityFinishInTheMoney = nPayingRanks / N;
  const probabilityFinishFirst = 1 / N;

  // Per-title contribution variance (across titles)
  let cmean = 0;
  for (const c of perTitleContribution) cmean += c;
  cmean /= M;
  let cvar = 0;
  for (const c of perTitleContribution) cvar += (c - cmean) * (c - cmean);
  cvar /= M;

  // Suppress unused-locals lint:
  void totalContributionPerPlayer;

  return {
    poolTotal,
    poolPaidOut,
    poolResidual: poolTotal - poolPaidOut,
    rankBreakdown,
    perTitle,
    expectedPrizePerPlayer,
    rtpPerSpinTournament,
    rtpPerSpinBaseAverage,
    rtpPerSpinCombined,
    expectedSessionTotal,
    varianceSessionTotal,
    stdDevSessionTotal: Math.sqrt(varianceSessionTotal),
    titleSkewSkillPremium,
    bestTitleByMean,
    worstTitleByMean,
    probabilityFinishFirst,
    probabilityFinishInTheMoney,
    audit: {
      nTitles: M,
      nDays: D,
      nPlayers: N,
      multiDayPolicy: policy,
      totalSpinsPerPlayer,
      nPayingRanks,
      poolPayoutShare: poolTotal > 0 ? poolPaidOut / poolTotal : 0,
      perTitleContributionVarianceAcrossTitles: cvar,
    },
  };
}
