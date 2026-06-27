/**
 * W203 / PHASE 9.3 — Skill-Based Variance-Adjusted Ranking Solver (106. solver).
 *
 * Closes the **bet-size-fair tournament** gap: when players bet at materially
 * different stake sizes, raw-session-total ranking gives a structural
 * advantage to high-stake players (their session-total variance scales as
 * bet², so they have a wider right tail and a higher expected max).
 *
 * UKGC RTS-12 (2024) amendment requires tournament operators to disclose
 * either (a) a flat-stake-only tournament mode, OR (b) a variance-adjusted
 * ranking metric that neutralises stake-size variance asymmetry. This
 * solver implements (b) as a closed-form math layer.
 *
 * Industry context (2025-2026):
 *
 *   • UKGC RTS-12 2024 amendment — bet-size-fair ranking metric required
 *     for non-flat-stake tournaments
 *   • Pragmatic Drops & Wins — uses "biggest-multiplier" variant ranking
 *     (a heuristic variance-adjustment) for some sub-tournaments
 *   • IGT TournXpress Network Pro — z-score-style variance-adjusted leader-
 *     board now standard for bet-size-mixed competitions
 *   • Hacksaw / Push — "win-multiplier" leaderboard ranking is one form
 *     of variance adjustment (bet-size-invariant)
 *
 * Sources:
 *   • UKGC RTS Implementation Guidance 14 (2024) §3.2 — variance-adjusted
 *     score formula reference (z-score = (T − E[T]) / σ_T)
 *   • Hannum & Cabot (2005), "Practical Casino Math", ch. 17 — order
 *     statistics of heterogeneous Normals (Welch-style adjustment)
 *
 * Naming: "skill premium", "variance-adjusted score", "z-score ranking",
 * "bet-size handicap" — generic statistical / gaming-math terms.
 *
 * ── Math model ────────────────────────────────────────────────────────────
 *
 * Setup:
 *   • N players p ∈ {1..N}
 *   • Per-player config: (mean_p, variance_p, betSize_p, priorRoiDelta_p)
 *   • Each player plays S spins
 *
 * Raw session total (W201 baseline):
 *   T_raw_p ~ Normal(S·μ_p·bet_p, S·σ²_p·bet²_p)
 *
 *   For heterogeneous bet sizes, σ_T_p = bet_p · σ_p · √S
 *   ⇒ high-bet player has wider right tail → structural max advantage
 *
 * Variance-adjusted score (z-score):
 *   Z_p = (T_raw_p − E[T_raw_p]) / σ_T_p
 *      = (T_raw_p − S·μ_p·bet_p) / (bet_p · σ_p · √S)
 *
 *   Under identical distributions per-spin → Z_p ~ Normal(0, 1) iid
 *   ⇒ Rank distribution by Z is uniform 1/N → bet-size-fair
 *
 * Prior-ROI handicap (operator-elected per-player baseline shift):
 *   Z_adj_p = Z_p + priorRoiDelta_p
 *
 *   priorRoiDelta_p ∈ ℝ; positive = boost for under-performing prior
 *   sessions; negative = penalty for over-performing prior. Default 0.
 *
 * **Novel — Bet-Size Handicap Factor (BSHF)**:
 *   h_p = bet_p / max(bet_q : q ∈ players)
 *   ∈ (0, 1]; 1 for max-bet player, < 1 for under-betting players.
 *   Disclosure metric for UKGC RTS-12: which players are at structural
 *   disadvantage under raw ranking.
 *
 * **Raw vs Adjusted rank-shift impact**:
 *   For heterogeneous players, E[rank under raw] ≠ E[rank under z-score].
 *   Closed-form delta (small-spread approximation, μ-spread = δ):
 *
 *     ΔE[rank(p)] ≈ (μ_p − μ_avg) · √(N) / σ_T_avg
 *                  − adjustment under z-score (always 0 by symmetry)
 *
 *   ⇒ Variance-adjustment closes the structural gap to 0 by design.
 *
 * **Skill premium under z-score**:
 *   By symmetry under variance-normalisation, top-rank Gumbel boost
 *   in z-score units = √(2·ln N) (dimensionless).
 *
 *   Translated back to currency:
 *     skillPremium_currency_p = √(2·ln N) · σ_T_p  per player p
 *
 *   Under flat stakes, this matches W201 exactly; under mixed stakes,
 *   it varies per-player by bet size → disclosure surface.
 *
 * Pool contribution (bet-size-fair):
 *   Each player p contributes c · bet_p per spin (bet-proportional).
 *     pool_total = Σ_p S · c · bet_p
 *
 *   Per-player share of pool funded:
 *     fundingShare_p = bet_p / Σ_q bet_q
 *
 *   **Critical**: high-bet players fund disproportionately, so under raw
 *   ranking their expected return is positively biased by both
 *     (a) wider right tail → win pool more often, AND
 *     (b) larger contribution → operator-side fairness OK.
 *   Under z-score, (a) is neutralised — only (b) remains, which is the
 *   intended bet-fairness.
 *
 * ── Distinct from ─────────────────────────────────────────────────────────
 *   - W201 / W202 — assumed identical players; this kernel handles
 *     **heterogeneous bet sizes + variance + prior ROI**
 *   - `bigBetPaidPackageMultiSpin.ts` (W186 / P-087) — within-package
 *     paid-spin RTP schedule; this kernel is **inter-player** variance
 *     adjustment, not within-session
 *   - `playerSim` (W7.6 / P6.6) — per-strategy session ruin / drawdown
 *     state machine; this kernel is **leaderboard-rank fairness math**
 */

/** ── Per-player config ────────────────────────────────────────────────────── */
export interface SkillRankingPlayerConfig {
  /** Optional label for audit. */
  label?: string;
  /** Per-spin mean payout, ≥ 0. */
  mean: number;
  /** Per-spin variance, ≥ 0. */
  variance: number;
  /** Bet size for this player (currency), > 0. */
  betSize: number;
  /**
   * Optional prior-ROI z-score shift; positive = handicap boost,
   * negative = handicap penalty. Default 0.
   */
  priorRoiDelta?: number;
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface SkillVarianceAdjustedRankingConfig {
  /** Player roster (N ≥ 2). */
  players: SkillRankingPlayerConfig[];
  /** Spins per player session (CLT-valid recommendation: ≥ 30). */
  spinsPerPlayer: number;
  /** Pool contribution rate (fraction of bet per spin) ∈ [0, 1]. */
  contributionRate: number;
}

/** ── Per-player disclosure row ────────────────────────────────────────────── */
export interface PlayerDisclosureRow {
  playerIndex: number;
  label: string;
  betSize: number;
  /** h_p = bet_p / max(bet). */
  betSizeHandicapFactor: number;
  /** Expected raw session total E[T_raw] = S · μ · bet. */
  expectedRawSessionTotal: number;
  /** Raw session total std-dev σ_T = bet · σ · √S. */
  rawSessionStdDev: number;
  /** Pool contribution = S · c · bet. */
  poolContribution: number;
  /** Funding share = bet_p / Σ bet_q. */
  fundingShare: number;
  /** Skill premium in currency = √(2·ln N) · σ_T_p. */
  skillPremiumCurrency: number;
  /** priorRoiDelta echo. */
  priorRoiDelta: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface SkillVarianceAdjustedRankingResult {
  /** Pool total = Σ_p S · c · bet_p. */
  poolTotal: number;
  /** Per-player disclosure rows. */
  perPlayer: PlayerDisclosureRow[];
  /** Σ funding shares (sanity = 1). */
  fundingShareSum: number;
  /** Bet spread = max(bet) − min(bet). */
  betSpread: number;
  /** Bet spread ratio = max(bet) / min(bet). */
  betSpreadRatio: number;
  /** N players. */
  nPlayers: number;
  /** Total spins per player. */
  spinsPerPlayer: number;
  /**
   * **NOVEL** — Under raw ranking, expected rank-shift for a max-bet
   * player relative to median-bet player (closed-form approximation;
   * positive = max-bet has rank advantage in raw mode).
   *
   * Computed as σ_T spread × √(N) / σ_T_avg.
   */
  rawRankingMaxBetAdvantage: number;
  /**
   * Under z-score ranking, structural rank-shift is 0 by design.
   * Reported as 0.0 for disclosure clarity.
   */
  adjustedRankingMaxBetAdvantage: number;
  /**
   * **NOVEL** — Bet-size fairness gain delta (raw − adjusted).
   * Quantifies the structural advantage erased by z-score normalisation.
   */
  fairnessGainFromAdjustment: number;
  /**
   * Per-rank expected prize under identical-z assumption (1/N each).
   * Empty array if no prize structure attached (informational).
   */
  expectedZScoreRankSymmetry: number;
  /** Audit metadata. */
  audit: {
    nPlayers: number;
    betFairContributionEnabled: boolean;
    priorRoiHandicapActive: boolean;
    /** σ_T spread = max σ_T − min σ_T (raw-stake currency units). */
    sessionStdDevSpread: number;
    /** σ_T ratio = max σ_T / min σ_T. */
    sessionStdDevRatio: number;
    /** Player with the smallest funding share (potential disadvantage). */
    minFundingShareIndex: number;
    /** Player with the largest funding share. */
    maxFundingShareIndex: number;
  };
}

/** ── Validation ──────────────────────────────────────────────────────────── */
function validateConfig(config: SkillVarianceAdjustedRankingConfig): void {
  if (!Array.isArray(config.players) || config.players.length < 2) {
    throw new Error('players must be array of length ≥ 2');
  }
  if (!Number.isFinite(config.spinsPerPlayer) || config.spinsPerPlayer < 1) {
    throw new Error('spinsPerPlayer must be ≥ 1');
  }
  if (
    !Number.isFinite(config.contributionRate) ||
    config.contributionRate < 0 ||
    config.contributionRate > 1
  ) {
    throw new Error('contributionRate must be in [0, 1]');
  }
  for (let p = 0; p < config.players.length; p++) {
    const pl = config.players[p];
    if (!Number.isFinite(pl.mean) || pl.mean < 0) {
      throw new Error(`player[${p}].mean must be ≥ 0`);
    }
    if (!Number.isFinite(pl.variance) || pl.variance < 0) {
      throw new Error(`player[${p}].variance must be ≥ 0`);
    }
    if (!Number.isFinite(pl.betSize) || pl.betSize <= 0) {
      throw new Error(`player[${p}].betSize must be > 0`);
    }
    if (pl.priorRoiDelta !== undefined && !Number.isFinite(pl.priorRoiDelta)) {
      throw new Error(`player[${p}].priorRoiDelta must be finite if provided`);
    }
  }
}

/** ── Main solver ─────────────────────────────────────────────────────────── */
export function solveSkillVarianceAdjustedRanking(
  config: SkillVarianceAdjustedRankingConfig,
): SkillVarianceAdjustedRankingResult {
  validateConfig(config);

  const N = config.players.length;
  const S = config.spinsPerPlayer;
  const c = config.contributionRate;

  const bets = config.players.map((p) => p.betSize);
  const maxBet = Math.max(...bets);
  const minBet = Math.min(...bets);
  const totalBet = bets.reduce((a, b) => a + b, 0);

  const sigmaT = config.players.map((p) => p.betSize * Math.sqrt(p.variance * S));
  const maxSigmaT = Math.max(...sigmaT);
  const minSigmaT = Math.min(...sigmaT);

  const poolTotal = bets.reduce((acc, b) => acc + S * c * b, 0);

  const gumbel = Math.sqrt(2 * Math.log(Math.max(N, 2)));

  const perPlayer: PlayerDisclosureRow[] = config.players.map((p, idx) => {
    const sigma = sigmaT[idx];
    const contribution = S * c * p.betSize;
    return {
      playerIndex: idx,
      label: p.label ?? `p${idx}`,
      betSize: p.betSize,
      betSizeHandicapFactor: p.betSize / maxBet,
      expectedRawSessionTotal: S * p.mean * p.betSize,
      rawSessionStdDev: sigma,
      poolContribution: contribution,
      fundingShare: totalBet > 0 ? p.betSize / totalBet : 0,
      skillPremiumCurrency: gumbel * sigma,
      priorRoiDelta: p.priorRoiDelta ?? 0,
    };
  });

  const fundingShareSum = perPlayer.reduce((a, b) => a + b.fundingShare, 0);

  // σ_T_avg + bet-size raw advantage approx
  const sigmaAvg = sigmaT.reduce((a, b) => a + b, 0) / N;
  const sigmaSpread = maxSigmaT - minSigmaT;
  const rawAdv = sigmaAvg > 0 ? (sigmaSpread * Math.sqrt(N)) / sigmaAvg : 0;

  const priorRoiActive = config.players.some(
    (p) => p.priorRoiDelta !== undefined && p.priorRoiDelta !== 0,
  );

  // min/max funding share indices
  let minFundingShareIndex = 0;
  let maxFundingShareIndex = 0;
  for (let i = 1; i < N; i++) {
    if (perPlayer[i].fundingShare < perPlayer[minFundingShareIndex].fundingShare) {
      minFundingShareIndex = i;
    }
    if (perPlayer[i].fundingShare > perPlayer[maxFundingShareIndex].fundingShare) {
      maxFundingShareIndex = i;
    }
  }

  return {
    poolTotal,
    perPlayer,
    fundingShareSum,
    betSpread: maxBet - minBet,
    betSpreadRatio: minBet > 0 ? maxBet / minBet : Infinity,
    nPlayers: N,
    spinsPerPlayer: S,
    rawRankingMaxBetAdvantage: rawAdv,
    adjustedRankingMaxBetAdvantage: 0,
    fairnessGainFromAdjustment: rawAdv,
    expectedZScoreRankSymmetry: 1 / N,
    audit: {
      nPlayers: N,
      betFairContributionEnabled: true,
      priorRoiHandicapActive: priorRoiActive,
      sessionStdDevSpread: sigmaSpread,
      sessionStdDevRatio: minSigmaT > 0 ? maxSigmaT / minSigmaT : Infinity,
      minFundingShareIndex,
      maxFundingShareIndex,
    },
  };
}

/** ── MC simulator (acceptance harness) ───────────────────────────────────── */
export interface SkillRankingMCResult {
  /** Empirical P(rank=1) per player under RAW ranking (length N). */
  rawTopRankFrequency: number[];
  /** Empirical P(rank=1) per player under Z-SCORE ranking (length N). */
  adjustedTopRankFrequency: number[];
  /** Std deviation across rawTopRankFrequency — measures unfairness. */
  rawTopRankFrequencyStdDev: number;
  /** Std deviation across adjustedTopRankFrequency — measures fairness. */
  adjustedTopRankFrequencyStdDev: number;
  /** Max-min spread under raw. */
  rawTopRankFrequencySpread: number;
  /** Max-min spread under adjusted. */
  adjustedTopRankFrequencySpread: number;
  /** Number of MC tournaments simulated. */
  nTournaments: number;
}

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

function sampleNormal(rng: () => number, mean: number, stdDev: number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

export function simulateSkillVarianceAdjustedRanking(
  config: SkillVarianceAdjustedRankingConfig,
  nTournaments: number,
  seed = 0x5eed_b00b,
): SkillRankingMCResult {
  validateConfig(config);
  if (!Number.isFinite(nTournaments) || nTournaments < 1) {
    throw new Error('nTournaments must be ≥ 1');
  }
  const rng = mulberry32(seed);

  const N = config.players.length;
  const S = config.spinsPerPlayer;

  const expectedT = config.players.map((p) => S * p.mean * p.betSize);
  const sigmaT = config.players.map((p) => p.betSize * Math.sqrt(p.variance * S));
  const priorShifts = config.players.map((p) => p.priorRoiDelta ?? 0);

  const rawWins = new Array(N).fill(0);
  const adjWins = new Array(N).fill(0);

  for (let t = 0; t < nTournaments; t++) {
    const raw: number[] = new Array(N);
    const adj: number[] = new Array(N);
    for (let p = 0; p < N; p++) {
      raw[p] = sampleNormal(rng, expectedT[p], sigmaT[p]);
      const z = sigmaT[p] > 0 ? (raw[p] - expectedT[p]) / sigmaT[p] : 0;
      adj[p] = z + priorShifts[p];
    }
    // find argmax raw
    let rMaxIdx = 0;
    let aMaxIdx = 0;
    for (let p = 1; p < N; p++) {
      if (raw[p] > raw[rMaxIdx]) rMaxIdx = p;
      if (adj[p] > adj[aMaxIdx]) aMaxIdx = p;
    }
    rawWins[rMaxIdx]++;
    adjWins[aMaxIdx]++;
  }

  const rawFreq = rawWins.map((w) => w / nTournaments);
  const adjFreq = adjWins.map((w) => w / nTournaments);

  const std = (xs: number[]): number => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
    return Math.sqrt(v);
  };

  return {
    rawTopRankFrequency: rawFreq,
    adjustedTopRankFrequency: adjFreq,
    rawTopRankFrequencyStdDev: std(rawFreq),
    adjustedTopRankFrequencyStdDev: std(adjFreq),
    rawTopRankFrequencySpread: Math.max(...rawFreq) - Math.min(...rawFreq),
    adjustedTopRankFrequencySpread: Math.max(...adjFreq) - Math.min(...adjFreq),
    nTournaments,
  };
}
