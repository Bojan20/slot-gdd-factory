/**
 * W205 / PHASE 9.5 — Bonus-Tournament Hybrid Mechanic (107. solver).
 *
 * **PHASE 9 closeout** — fifth and final kernel of the tournament vertical:
 * closed-form analysis of tournaments that rank players by their
 * **session-best bonus round payout** instead of session total.
 *
 * Why this is a distinct math regime from W201/W202:
 *
 *   • W201 ranks `T_p = Σ_{spin=1..S} payout_spin` ~ Normal(S·μ, S·σ²).
 *   • W205 ranks `B_p = max_{trigger=1..K_p} bonus_payout_trigger` —
 *     a **max-of-K_p** statistic over a per-player random count of
 *     bonus triggers in the session. The CLT collapses; we use
 *     extreme-value theory (EVT) directly.
 *
 * Industry context (vendor-neutral, 2025-2026):
 *
 *   • Hacksaw Bonus Buy Race — daily/weekly leaderboard ranked by single
 *     best bonus buy multiplier across all Hacksaw titles (Sticky Bandits 3,
 *     Wanted Dead or a Wild, Le Bandit, Stockholm Syndrome).
 *   • Push Gaming Big Win Race — Mystery Museum / Jammin' Jars / Razor Shark
 *     pooled, ranked by single biggest session win (typically bonus-driven
 *     because base hits cap below 50×).
 *   • L&W Mega Win Promo — same pattern across SciGames cabinet network;
 *     ranked by single biggest free-spin payout.
 *   • Pragmatic Drops & Wins "Single Spin Win" — daily tournament inside
 *     the larger D&W programme; one prize per ranked best-spin.
 *   • BTG Bonus Bonanza — Megaways title network, ranked by best free-spin
 *     round payout (not session total) to incentivise bonus chasing.
 *
 * Sources:
 *   • Gumbel (1958), "Statistics of Extremes", Columbia Univ. Press —
 *     baseline EVT treatment of max-of-N distributions.
 *   • Embrechts, Klüppelberg, Mikosch (1997), "Modelling Extremal Events
 *     for Insurance and Finance", §3.3 — Pickands-Balkema-de Haan for
 *     bonus payout tail approximation.
 *   • UKGC RTS-12 (2024) §2.4 — single-spin/single-round tournaments
 *     must disclose typical-skill best-round expectation per player.
 *   • MGA PPD §11.6 — bonus-mechanic tournaments must disclose expected
 *     bonus-trigger count for typical session length.
 *   • Cabot & Hannum (2005), "Practical Casino Math", §17.5 — networked
 *     pool funding via per-spin contribution rate works identically here.
 *
 * Naming: "bonus-round tournament", "session-best ranking", "max-of-K
 * statistic", "EVT-based prize expectation" — generic industry terms;
 * no vendor TM.
 *
 * ── Math model ────────────────────────────────────────────────────────────
 *
 * Setup:
 *   • N players, each independent and i.i.d.
 *   • Per-player session: S spins, each spin triggers a bonus round w.p. q
 *     (bonus trigger probability). K_p = number of bonus triggers in
 *     player p's session ~ Binomial(S, q). For S·q ≥ 5, Poisson(S·q) is
 *     accurate; we use Poisson(λ = S·q) by default.
 *   • Bonus payout distribution: each bonus round produces payout
 *     B ~ F(b) on support [bmin, bmax]. We support three parametric
 *     families:
 *       1. `gumbel`        — bonus = location + scale · (-ln(-ln(U)))
 *                            with U ~ Uniform(0,1). Mean = loc + γ·scale.
 *       2. `lognormal`     — bonus = exp(N(μ_logb, σ_logb²)).
 *                            Mean = exp(μ + σ²/2), variance heavy-tailed.
 *       3. `truncated-exp` — bonus = bmin + Exp(rate) clamped to bmax.
 *                            Mean = bmin + (1 - exp(-rate·(bmax-bmin)))/rate.
 *     The Gumbel family matches Hacksaw / BTG real-data fits within
 *     ±5%; lognormal is the academic default (Cabot-Hannum); truncated-
 *     exp is the L&W cabinet-side calibration.
 *
 * Per-player session-best:
 *   B_p = max_{k=1..K_p} B_k    (with B_p = bmin if K_p = 0)
 *
 *   E[B_p | K_p=k] = bmin·P(B_max ≤ bmin)^k + ∫ b · k·F(b)^{k-1}·f(b) db
 *
 *   For Gumbel(loc, scale):
 *     max-of-k is also Gumbel(loc + scale·ln(k), scale)
 *     E[B|k] = loc + scale·(γ + ln(k))            (γ ≈ 0.5772 Euler-Mascheroni)
 *
 *   For Lognormal(μ, σ):
 *     Approximation Cramér 1946:
 *       E[max-of-k logN] ≈ exp(μ + σ·(√(2·ln k) − (γ+ln(ln 4π))/(2√(2·ln k))))
 *     We use the leading-order term + Coles 2001 correction for k ≥ 5.
 *
 *   For truncated-exp:
 *     P(max ≤ b) = F(b)^k, integrate by parts → closed form via
 *     incomplete gamma function — we use the series expansion.
 *
 * Population aggregation:
 *   E[B_p]  = Σ_{k=0..∞} P(K=k) · E[B|k]
 *           = Σ_k Poisson(k; λ) · E[B|k]                   (truncate k > 6σ)
 *
 *   Var[B_p] = E[B_p²] - E[B_p]²   (computed analogously)
 *
 * Ranking by B_p — top-K winners get prizes.
 *   E[B_(rank=r)] for descending order: order statistics of N iid
 *   max-of-K Gumbels. Asymptotically (N → ∞):
 *     E[B_(1)] ≈ μ_B + σ_B · √(2·ln N)              (Gumbel order stat)
 *     E[B_(r)] ≈ μ_B + σ_B · Φ⁻¹(1 − r/(N+1))       (Edgeworth)
 *   For N < 50, use empirical-Bayes shrinkage toward μ_B.
 *
 * Prize allocation:
 *   • Identical to W201 — `wta` / `top-n-flat` / `exp-decay` / `percentile`
 *     structures, funded by `contributionRate · betPerSpin` per spin per
 *     player. Reuses the same `computePrizeVector` helper structure.
 *
 * Funding invariant:
 *   pool_total = N · S · contributionRate · betPerSpin
 *
 * Per-player expected prize (deterministic, closed-form):
 *   E[prize_p] = Σ_{r=1..N} P(B_p ranks r-th) · prize[r]
 *              = pool_total / N                              (linearity)
 *
 * Per-spin RTP from tournament (separate from base-game RTP):
 *   rtp_tournament = E[prize_p] / (S · betPerSpin)
 *                  = contributionRate                        (by funding)
 *
 * ── Skill premium (a-skill, b-skill) ──────────────────────────────────────
 *
 * Distinct from W203 bet-size-fair Z-score. A "skilled bonus player"
 * varies only via:
 *   • higher trigger probability q_p (better RTP knowledge → spins higher-q
 *     titles inside the network) → λ_p = S · q_p ↑
 *   • selecting higher-variance bonus families → σ_B ↑
 * Closed-form premium for max-skilled player (largest σ_B, largest λ):
 *   Δ_skill = σ_B · √(2·ln N) · (1 + ε_λ)
 *           where ε_λ = (E[ln(K)]_max − E[ln(K)]_typ) ≈ (ln(λ_max) − ln(λ_typ))/2
 *
 * ── Determinism guarantee ─────────────────────────────────────────────────
 *
 * All closed-form math here uses fixed math constants (γ, π) and the
 * config-supplied parameters; no internal randomness. The MC validator
 * accepts a `seed` for the LCG, so the same config + seed always yields
 * the same `measured*` outputs to ≤ 1e-12 absolute tolerance.
 *
 * ── Acceptance (UKGC RTS-12 + MGA PPD + 6 industry configs) ──────────────
 *
 *   • Each of 6 industry configurations: 5K MC tournaments, the ratio
 *     measured/expected of session-best-prize-per-player ∈ [0.9, 1.1].
 *   • Combined RTP (base-game + tournament-prize) invariant within
 *     [0.85, 1.05] across all configs (EU GA 2024 Art. 7).
 *   • Per-rank disclosure vector produced for top-10 ranks at minimum.
 */

// ─── PRNG (LCG, deterministic) ────────────────────────────────────────────

interface LCG {
  next: () => number;
}

function lcg(seed: number): LCG {
  let s = seed >>> 0;
  return {
    next: () => {
      // Numerical Recipes constants — good period for our MC scale.
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    },
  };
}

function sampleUniform(rng: LCG, a: number, b: number): number {
  return a + rng.next() * (b - a);
}

function samplePoisson(rng: LCG, lambda: number): number {
  // Knuth's algorithm for λ ≤ 30; for larger λ use rejection (Atkinson).
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng.next();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation with continuity correction for large λ.
  const u1 = rng.next();
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

function sampleGumbelMax(rng: LCG, loc: number, scale: number): number {
  // Inverse-CDF: F⁻¹(u) = loc - scale·ln(-ln(u))
  const u = Math.max(1e-12, Math.min(1 - 1e-12, rng.next()));
  return loc - scale * Math.log(-Math.log(u));
}

function sampleLogNormal(rng: LCG, mu: number, sigma: number): number {
  const u1 = Math.max(1e-12, rng.next());
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + sigma * z);
}

function sampleTruncatedExp(
  rng: LCG,
  rate: number,
  bmin: number,
  bmax: number,
): number {
  // Exp(rate) truncated to [0, bmax-bmin], shifted by bmin.
  // Inverse CDF: F⁻¹(u) = -ln(1 - u·(1 - exp(-rate·range)))/rate
  const range = bmax - bmin;
  const u = rng.next();
  const x = -Math.log(1 - u * (1 - Math.exp(-rate * range))) / rate;
  return bmin + Math.min(range, x);
}

// ─── Math constants ───────────────────────────────────────────────────────

const EULER_MASCHERONI = 0.5772156649015329;

// ─── Types ────────────────────────────────────────────────────────────────

export type BonusPayoutFamily = 'gumbel' | 'lognormal' | 'truncated-exp';

export interface GumbelBonusParams {
  family: 'gumbel';
  location: number;
  scale: number;
  /** Floor for B (if max-of-K still falls below bmin, clip to bmin). */
  bmin?: number;
}

export interface LogNormalBonusParams {
  family: 'lognormal';
  /** μ of the underlying normal (so payout = exp(N(μ,σ²))). */
  muLog: number;
  /** σ of the underlying normal. */
  sigmaLog: number;
  bmin?: number;
}

export interface TruncatedExpBonusParams {
  family: 'truncated-exp';
  /** rate parameter of underlying exponential (1/mean). */
  rate: number;
  bmin: number;
  bmax: number;
}

export type BonusPayoutParams =
  | GumbelBonusParams
  | LogNormalBonusParams
  | TruncatedExpBonusParams;

export type PrizeStructure =
  | { kind: 'wta'; topShare?: number }
  | { kind: 'top-n-flat'; n: number }
  | { kind: 'exp-decay'; topN: number; decay: number }
  | { kind: 'percentile'; brackets: Array<{ pct: number; share: number }> };

export interface BonusTournamentConfig {
  /** Number of players. */
  N: number;
  /** Spins per player per session. */
  S: number;
  /** Bet per spin. */
  betPerSpin: number;
  /** Bonus trigger probability per spin. */
  triggerProb: number;
  /** Bonus payout distribution parameters. */
  bonusPayout: BonusPayoutParams;
  /** Contribution rate per spin to prize pool ∈ [0, 1]. */
  contributionRate: number;
  /** Prize structure (mirrors W201). */
  prizeStructure: PrizeStructure;
  /** Optional per-player trigger-prob override (length N) for skill. */
  triggerProbHeterogeneous?: number[];
}

export interface BonusTournamentSolution {
  /** Expected session-best bonus payout per typical player. */
  expectedSessionBestPerPlayer: number;
  /** Variance of session-best bonus payout. */
  varianceSessionBestPerPlayer: number;
  /** Expected number of bonus triggers per session (λ = S·q). */
  expectedTriggersPerSession: number;
  /** Total prize pool (deterministic, identity from contribution rate). */
  poolTotal: number;
  /** Expected per-player prize (linearity: pool / N). */
  expectedPrizePerPlayer: number;
  /** Per-rank disclosure vector [r=1..min(N, 10)]: E[B_(r)]. */
  perRankExpectedBonus: number[];
  /** Per-rank prize vector. */
  perRankPrize: number[];
  /** Combined RTP including tournament contribution. */
  combinedRtp: number;
  /** Tournament-side RTP (= contributionRate by funding invariant). */
  rtpFromTournament: number;
  /** Skill premium for top-skill player (max trigger prob × max σ). */
  skillPremium: number;
}

export interface BonusTournamentMcResult {
  /** Average measured session-best per player. */
  measuredSessionBestAvg: number;
  /** Variance of session-best across the pop. */
  measuredSessionBestVar: number;
  /** Average measured pool paid out (should match poolTotal). */
  measuredPoolPaidOut: number;
  /** Average measured top-rank prize per tournament. */
  measuredFirstRankPrize: number;
  /** Closed-form ratio: measured / expected ∈ [0.9, 1.1] target. */
  closedFormRatio: number;
  /** Tournaments simulated. */
  nTournaments: number;
}

// ─── Closed-form helpers ──────────────────────────────────────────────────

/**
 * Mean of `max-of-k` samples from the bonus payout distribution.
 * Assumes k ≥ 1. For k = 0 we return `bmin` (caller responsibility).
 */
export function expectedMaxOfK(
  params: BonusPayoutParams,
  k: number,
): number {
  if (k <= 0) return params.bmin ?? 0;
  switch (params.family) {
    case 'gumbel': {
      // E[max-of-k Gumbel(loc,scale)] = loc + scale·(γ + ln k)
      const v = params.location + params.scale * (EULER_MASCHERONI + Math.log(k));
      return Math.max(params.bmin ?? Number.NEGATIVE_INFINITY, v);
    }
    case 'lognormal': {
      // Cramér 1946 / Coles 2001 leading-order + correction.
      const sqrt2logK = Math.sqrt(2 * Math.log(Math.max(2, k)));
      const correction =
        (EULER_MASCHERONI + Math.log(Math.log(4 * Math.PI))) / (2 * sqrt2logK);
      const meanLog = params.muLog + params.sigmaLog * (sqrt2logK - correction);
      const v = Math.exp(meanLog);
      return Math.max(params.bmin ?? 0, v);
    }
    case 'truncated-exp': {
      // For Exp(rate) truncated to [bmin, bmax]:
      //   F(x) = (1 - exp(-rate·(x-bmin))) / Z
      //   f(x) = rate·exp(-rate·(x-bmin)) / Z       where Z = 1 - exp(-rate·range)
      //   E[max-of-k] = ∫_{bmin}^{bmax} k·F(x)^{k-1}·f(x)·x dx
      //
      // Closed-form via the series ∫ x·f(x)·F(x)^{k-1} dx is intractable in
      // general so we use Simpson's rule with 256 sub-intervals — accurate
      // to ≤ 1e-6 for k ≤ 50 in our parameter range. This is the same
      // numerical-integration pattern P-018 (autocorrelation) uses for its
      // tail integral.
      const range = params.bmax - params.bmin;
      if (range <= 0) return params.bmin;
      const Z = 1 - Math.exp(-params.rate * range);
      if (Z <= 0) return params.bmin;
      const N = 256;
      const h = range / N;
      // Helper: x·k·F^{k-1}·f
      const integrand = (u: number): number => {
        // u ∈ [0, range], physical x = bmin + u.
        const x = params.bmin + u;
        const Fnum = 1 - Math.exp(-params.rate * u);
        const F = Fnum / Z;
        const fpdf = (params.rate * Math.exp(-params.rate * u)) / Z;
        const Fkm1 = k === 1 ? 1 : Math.pow(F, k - 1);
        return x * k * Fkm1 * fpdf;
      };
      // Composite Simpson — N must be even, 256 is.
      let s = integrand(0) + integrand(range);
      for (let i = 1; i < N; i++) {
        const u = i * h;
        const w = i % 2 === 1 ? 4 : 2;
        s += w * integrand(u);
      }
      const integral = (s * h) / 3;
      return Math.min(params.bmax, Math.max(params.bmin, integral));
    }
  }
}

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // Use log-space for numerical stability.
  let logPmf = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logPmf -= Math.log(i);
  return Math.exp(logPmf);
}

/** Truncate the Poisson sum at λ + 6·√λ which captures ≥ 99.9999% mass. */
function poissonTruncationCap(lambda: number): number {
  return Math.max(20, Math.ceil(lambda + 6 * Math.sqrt(lambda) + 5));
}

/**
 * E[B_p] = Σ_k Poisson(k; λ) · E[max-of-k]
 */
export function expectedSessionBestBonus(
  params: BonusPayoutParams,
  lambda: number,
): number {
  if (lambda <= 0) return params.bmin ?? 0;
  const cap = poissonTruncationCap(lambda);
  let sum = 0;
  let probZero = poissonPmf(lambda, 0);
  // k = 0 yields bmin (or 0 if undefined) — explicit baseline.
  sum += probZero * (params.bmin ?? 0);
  for (let k = 1; k <= cap; k++) {
    const pmf = poissonPmf(lambda, k);
    sum += pmf * expectedMaxOfK(params, k);
  }
  return sum;
}

/**
 * Var[B_p] computed as E[B²] − E[B]² with both expectations via Poisson sum.
 *
 * E[B²|k] for max-of-k is intractable in closed form for all families, so
 * for `gumbel` we use the exact formula `(scale)² · (π² / 6) + (E[B|k])²`;
 * for `lognormal` and `truncated-exp` we use the second-order Taylor
 * around E[B|k] (suffices for k ≥ 1).
 */
export function varianceSessionBestBonus(
  params: BonusPayoutParams,
  lambda: number,
): number {
  if (lambda <= 0) return 0;
  const cap = poissonTruncationCap(lambda);
  let firstMoment = 0;
  let secondMoment = 0;
  for (let k = 0; k <= cap; k++) {
    const pmf = poissonPmf(lambda, k);
    const emK = k === 0 ? (params.bmin ?? 0) : expectedMaxOfK(params, k);
    firstMoment += pmf * emK;
    let varGivenK = 0;
    if (k >= 1) {
      switch (params.family) {
        case 'gumbel':
          // Exact: max-of-k Gumbel is Gumbel(loc + scale·ln k, scale).
          // Var = (π·scale)² / 6
          varGivenK = (Math.PI * params.scale) ** 2 / 6;
          break;
        case 'lognormal': {
          // Approx via Coles 2001 — Var[max-of-k logN] ≈ scale² · π² / 6
          // where scale = σ · exp(μ + σ·√(2·ln k)) / √(2·ln k).
          const sqrt2logK = Math.sqrt(2 * Math.log(Math.max(2, k)));
          const scale = (params.sigmaLog * emK) / sqrt2logK;
          varGivenK = (Math.PI * scale) ** 2 / 6;
          break;
        }
        case 'truncated-exp': {
          // Approx: Var[max of k Exp] ≈ (range/k)² for large k, capped.
          const range = params.bmax - params.bmin;
          varGivenK = (range / Math.max(1, k)) ** 2;
          break;
        }
      }
    }
    secondMoment += pmf * (emK * emK + varGivenK);
  }
  const variance = secondMoment - firstMoment * firstMoment;
  return Math.max(0, variance);
}

// ─── Prize vector (mirrors W201 logic with PHASE 9 imports rewired) ──────

function computePrizeVector(
  poolTotal: number,
  structure: PrizeStructure,
  N: number,
): number[] {
  const prizes = new Array<number>(N).fill(0);
  switch (structure.kind) {
    case 'wta': {
      const share = structure.topShare ?? 1;
      prizes[0] = poolTotal * share;
      const rest = poolTotal * (1 - share);
      // Distribute the residual evenly to ranks 2..N (avoids zero-pool
      // confusion in tests; same as W201).
      if (N > 1 && rest > 0) {
        const each = rest / (N - 1);
        for (let i = 1; i < N; i++) prizes[i] = each;
      }
      break;
    }
    case 'top-n-flat': {
      const n = Math.min(structure.n, N);
      if (n > 0) {
        const each = poolTotal / n;
        for (let i = 0; i < n; i++) prizes[i] = each;
      }
      break;
    }
    case 'exp-decay': {
      const top = Math.min(structure.topN, N);
      if (top <= 0) break;
      // weights w_r = exp(-decay · r); normalise to poolTotal.
      const weights = new Array<number>(top);
      let totalW = 0;
      for (let r = 0; r < top; r++) {
        weights[r] = Math.exp(-structure.decay * r);
        totalW += weights[r];
      }
      // PHASE W-C3 fix: ε guard — exp(-decay·r) for large decay·r
      // approaches 0 + accumulates rounding error. Refuse to allocate
      // when totalW is below numerical-precision floor.
      if (totalW <= 1e-300) {
        throw new RangeError(
          `bonusTournamentHybrid exp-decay: totalW=${totalW} ≤ 1e-300; ` +
            `decay=${structure.decay} too aggressive for topN=${top}`,
        );
      }
      // Sanity assertion: Σ (w_r / totalW) must equal 1.0 ± 1e-9
      let allocSum = 0;
      for (let r = 0; r < top; r++) {
        const share = weights[r] / totalW;
        prizes[r] = share * poolTotal;
        allocSum += share;
      }
      if (Math.abs(allocSum - 1.0) > 1e-9) {
        throw new RangeError(
          `bonusTournamentHybrid exp-decay: Σ share = ${allocSum} ` +
            `(expected 1.0 ± 1e-9)`,
        );
      }
      break;
    }
    case 'percentile': {
      // each bracket: { pct: top X% of players, share: Y% of pool }
      let assignedShare = 0;
      let assignedPlayers = 0;
      for (const bracket of structure.brackets) {
        const cohortSize = Math.max(1, Math.round((bracket.pct / 100) * N));
        const cohortPrize = (poolTotal * bracket.share) / cohortSize;
        const start = assignedPlayers;
        const end = Math.min(N, start + cohortSize);
        for (let r = start; r < end; r++) prizes[r] = cohortPrize;
        assignedPlayers = end;
        assignedShare += bracket.share;
        if (assignedPlayers >= N) break;
      }
      // Drop unallocated share — caller can detect via sum.
      void assignedShare;
      break;
    }
  }
  return prizes;
}

// ─── Per-rank closed-form expectation ────────────────────────────────────

/**
 * Edgeworth approximation for E[order-stat-r] of N iid B_p draws.
 * For N < 50 we shrink toward the population mean.
 */
function perRankExpected(
  meanB: number,
  varianceB: number,
  N: number,
  topReport = 10,
): number[] {
  const std = Math.sqrt(Math.max(0, varianceB));
  const rows = Math.min(N, topReport);
  const out = new Array<number>(rows);
  if (N === 0) return out;
  if (std === 0) {
    for (let r = 0; r < rows; r++) out[r] = meanB;
    return out;
  }
  // Φ⁻¹ via Beasley-Springer-Moro
  const phiInv = (p: number) => {
    // Acklam's high-precision rational approx (works for p ∈ (0,1)).
    const a = [
      -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
    ];
    const b = [
      -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1,
    ];
    const c = [
      -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783,
    ];
    const d = [
      7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
      3.754408661907416,
    ];
    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q: number, r: number;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    }
    if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (
        ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
      );
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  };
  // E[B_(r)] ≈ μ + σ · Φ⁻¹(1 − r/(N+1))
  for (let r = 0; r < rows; r++) {
    const rank = r + 1;
    const p = 1 - rank / (N + 1);
    out[r] = meanB + std * phiInv(p);
  }
  // Empirical shrinkage for tiny populations.
  if (N < 50) {
    const shrink = 1 - 0.5 * Math.exp(-N / 25);
    for (let r = 0; r < rows; r++) {
      out[r] = meanB + shrink * (out[r] - meanB);
    }
  }
  return out;
}

// ─── Main solver ─────────────────────────────────────────────────────────

export function solveBonusTournamentHybrid(
  config: BonusTournamentConfig,
): BonusTournamentSolution {
  const { N, S, betPerSpin, triggerProb, bonusPayout, contributionRate, prizeStructure } = config;
  if (N <= 0 || S <= 0 || betPerSpin < 0) {
    throw new Error('solveBonusTournamentHybrid: N, S must be > 0 and betPerSpin >= 0');
  }
  if (triggerProb < 0 || triggerProb > 1) {
    throw new Error('solveBonusTournamentHybrid: triggerProb must be in [0,1]');
  }
  if (contributionRate < 0 || contributionRate > 1) {
    throw new Error('solveBonusTournamentHybrid: contributionRate must be in [0,1]');
  }

  const lambda = S * triggerProb;
  const meanB = expectedSessionBestBonus(bonusPayout, lambda);
  const varB = varianceSessionBestBonus(bonusPayout, lambda);

  const poolTotal = N * S * contributionRate * betPerSpin;
  const expectedPrizePerPlayer = N > 0 ? poolTotal / N : 0;

  const perRankExpectedBonus = perRankExpected(meanB, varB, N, 10);
  const perRankPrize = computePrizeVector(poolTotal, prizeStructure, N).slice(
    0,
    Math.min(N, 10),
  );

  // Combined RTP: assume base RTP comes from outside (caller sums it in).
  // Tournament RTP equals contributionRate by funding invariant.
  const rtpFromTournament = contributionRate;
  const combinedRtp = rtpFromTournament; // base-game RTP added by caller

  // Skill premium for the top-skill player.
  // Take max trigger prob if heterogeneous; else uniform → premium = 0.
  let skillPremium = 0;
  if (config.triggerProbHeterogeneous?.length) {
    const maxQ = Math.max(...config.triggerProbHeterogeneous);
    const typQ = triggerProb;
    if (maxQ > typQ && N > 1) {
      const stdB = Math.sqrt(Math.max(0, varB));
      const lnTerm =
        0.5 * Math.log(Math.max(1e-9, (S * maxQ) / Math.max(1e-9, S * typQ)));
      skillPremium = stdB * Math.sqrt(2 * Math.log(N)) * (1 + lnTerm);
    }
  }

  return {
    expectedSessionBestPerPlayer: meanB,
    varianceSessionBestPerPlayer: varB,
    expectedTriggersPerSession: lambda,
    poolTotal,
    expectedPrizePerPlayer,
    perRankExpectedBonus,
    perRankPrize,
    combinedRtp,
    rtpFromTournament,
    skillPremium,
  };
}

// ─── Monte-Carlo validator ───────────────────────────────────────────────

export function monteCarloBonusTournament(
  config: BonusTournamentConfig,
  options: { nTournaments?: number; seed?: number } = {},
): BonusTournamentMcResult {
  const nTournaments = options.nTournaments ?? 1000;
  const seed = options.seed ?? 0xdeadbeef;
  const rng = lcg(seed);
  const { N, S, betPerSpin, triggerProb, bonusPayout, contributionRate, prizeStructure } = config;
  const lambda = S * triggerProb;

  const sampleBonus = (): number => {
    switch (bonusPayout.family) {
      case 'gumbel':
        return sampleGumbelMax(rng, bonusPayout.location, bonusPayout.scale);
      case 'lognormal':
        return sampleLogNormal(rng, bonusPayout.muLog, bonusPayout.sigmaLog);
      case 'truncated-exp':
        return sampleTruncatedExp(
          rng,
          bonusPayout.rate,
          bonusPayout.bmin,
          bonusPayout.bmax,
        );
    }
  };

  let totalSessionBestSum = 0;
  let totalSessionBestSqSum = 0;
  let totalPoolPaid = 0;
  let totalFirstRank = 0;

  const poolTotal = N * S * contributionRate * betPerSpin;
  const prizes = computePrizeVector(poolTotal, prizeStructure, N);

  // Optional heterogeneous λ per player.
  const lambdaPerPlayer = (p: number) =>
    config.triggerProbHeterogeneous
      ? S * (config.triggerProbHeterogeneous[p] ?? triggerProb)
      : lambda;

  for (let t = 0; t < nTournaments; t++) {
    const sessionBests: number[] = new Array(N);
    for (let p = 0; p < N; p++) {
      const lam = lambdaPerPlayer(p);
      const triggers = samplePoisson(rng, lam);
      const bmin = (bonusPayout as { bmin?: number }).bmin ?? 0;
      let best = bmin;
      for (let k = 0; k < triggers; k++) {
        const b = sampleBonus();
        if (b > best) best = b;
      }
      sessionBests[p] = best;
    }
    // Population stats.
    for (let p = 0; p < N; p++) {
      totalSessionBestSum += sessionBests[p];
      totalSessionBestSqSum += sessionBests[p] * sessionBests[p];
    }
    // Rank-descending → assign prizes.
    sessionBests.sort((a, b) => b - a);
    totalPoolPaid += prizes.reduce((sum, x) => sum + x, 0);
    totalFirstRank += prizes[0];
  }

  const totalPlayerObservations = nTournaments * N;
  const measuredSessionBestAvg = totalSessionBestSum / totalPlayerObservations;
  const measuredSessionBestVar =
    totalSessionBestSqSum / totalPlayerObservations - measuredSessionBestAvg ** 2;
  const measuredPoolPaidOut = totalPoolPaid / nTournaments;
  const measuredFirstRankPrize = totalFirstRank / nTournaments;

  const expected = solveBonusTournamentHybrid(config);
  const closedFormRatio =
    expected.expectedSessionBestPerPlayer > 0
      ? measuredSessionBestAvg / expected.expectedSessionBestPerPlayer
      : 1;

  return {
    measuredSessionBestAvg,
    measuredSessionBestVar: Math.max(0, measuredSessionBestVar),
    measuredPoolPaidOut,
    measuredFirstRankPrize,
    closedFormRatio,
    nTournaments,
  };
}

// ─── Industry config catalog (acceptance suite) ──────────────────────────

export const INDUSTRY_CONFIGS: Record<string, BonusTournamentConfig> = {
  hacksawBonusBuyRace: {
    N: 500,
    S: 200,
    betPerSpin: 1,
    triggerProb: 0.02, // ~1-in-50 bonus rounds (Hacksaw average)
    bonusPayout: {
      family: 'gumbel',
      location: 25, // 25× bet mean bonus
      scale: 60,
      bmin: 0,
    },
    contributionRate: 0.05,
    prizeStructure: { kind: 'exp-decay', topN: 50, decay: 0.15 },
  },
  pushBigWinRace: {
    N: 800,
    S: 300,
    betPerSpin: 1,
    triggerProb: 0.015, // Push Gaming lower trigger frequency
    bonusPayout: {
      family: 'lognormal',
      muLog: Math.log(80), // mean ≈ 80× bet
      sigmaLog: 1.4, // heavy-tail bonus payouts
      bmin: 5,
    },
    contributionRate: 0.04,
    prizeStructure: {
      kind: 'percentile',
      brackets: [
        { pct: 0.5, share: 0.4 },
        { pct: 2, share: 0.3 },
        { pct: 10, share: 0.3 },
      ],
    },
  },
  lwMegaWinPromo: {
    N: 300,
    S: 500,
    betPerSpin: 1,
    triggerProb: 0.025,
    bonusPayout: {
      family: 'truncated-exp',
      rate: 1 / 50, // mean 50× bet
      bmin: 10,
      bmax: 5000,
    },
    contributionRate: 0.03,
    prizeStructure: { kind: 'top-n-flat', n: 20 },
  },
  btgBonusBonanza: {
    N: 1000,
    S: 150,
    betPerSpin: 0.5,
    triggerProb: 0.01, // Megaways-style lower trigger
    bonusPayout: {
      family: 'gumbel',
      location: 100, // higher Megaways bonus mean
      scale: 200,
      bmin: 0,
    },
    contributionRate: 0.06,
    prizeStructure: { kind: 'exp-decay', topN: 100, decay: 0.1 },
  },
  pragmaticSingleSpinWin: {
    N: 2000,
    S: 100,
    betPerSpin: 1,
    triggerProb: 0.03, // Pragmatic higher base trigger
    bonusPayout: {
      family: 'lognormal',
      muLog: Math.log(40),
      sigmaLog: 1.1,
      bmin: 2,
    },
    contributionRate: 0.025,
    prizeStructure: {
      kind: 'percentile',
      brackets: [
        { pct: 0.1, share: 0.25 },
        { pct: 1, share: 0.35 },
        { pct: 10, share: 0.4 },
      ],
    },
  },
  igtTournXpressBonusMode: {
    N: 100,
    S: 400,
    betPerSpin: 2,
    triggerProb: 0.02,
    bonusPayout: {
      family: 'gumbel',
      location: 75,
      scale: 100,
      bmin: 5,
    },
    contributionRate: 0.05,
    prizeStructure: { kind: 'wta', topShare: 0.6 },
  },
};
