/**
 * W152 Wave 192 — Race/Competitive Pick One-Winner-Among-N Aggregator (73. solver).
 *
 * **L&W M8 P1 GAP CLOSURE** — covers WMS Goldfish family + Reel'em In family
 * fishing-contest mechanic.
 *
 * Iconic race/competitive-pick mehanika sa player-elected candidate:
 *   * LNW WMS Goldfish Race for the Gold (2017 defining title — 4 fish race,
 *     player picks one, winning fish awards prize)
 *   * LNW WMS Reel'em In Big Bass Bucks (2014, fishing contest sa multiplier
 *     14×–55× per fisherman pick)
 *   * Future L&W competitive-pick flagship variants
 *
 * **73rd closed-form solver.** First kernel modeling **categorical winner
 * distribution sa player-elect picks** — distinct od P-089 (W188) Player-Elects
 * Feature Composition (m-of-N subset sa additive contributions) — ovde
 * **exactly-one-winner** sa player-pick gating per-spin RTP.
 *
 * ── Math (Categorical Winner + Player Pick × Multiplier Draw) ──────────────
 *
 * N candidates (fish/fisherman). Per-candidate weights w_i ≥ 0:
 *   p_i = w_i / Σ_j w_j     (win prob, i ∈ {1..N})
 *
 * Per race: exactly one winner K ~ Categorical(p_1, ..., p_N).
 *
 * Per-candidate prize structure:
 *   - V_i = base prize (× bet, ≥ 0)
 *   - M_i = multiplier random draw sa (μ_M_i, σ²_M_i), iid per race
 *   - Total prize if i wins = V_i · M_i
 *
 * **Player pre-race elects candidate s ∈ {1..N}** (skill-rational choice
 * matters). Payout rule (vendor canonical): pick collects ONLY when their
 * elected candidate wins (else 0).
 *
 *   Y(pick=s) = V_s · M_s · 𝟙{K = s}
 *
 *   **E[Y | pick=s] = p_s · V_s · μ_M_s**
 *
 *   E[Y² | pick=s] = p_s · V_s² · (σ²_M_s + μ_M_s²)
 *   **Var[Y | pick=s] = p_s · V_s² · (σ²_M_s + μ_M_s²)
 *                       − (p_s · V_s · μ_M_s)²**
 *
 * **Best pick** (rational, max EV): s* = argmax_s p_s · V_s · μ_M_s
 * **Worst pick**: argmin_s
 * **Uniform pick** (random player, no info): (1/N) · Σ_s E[Y | pick=s]
 *
 *   **skillPremiumVsUniform = bestRtp − uniformRtp**
 *   **rtpSpread = bestRtp − worstRtp**
 *
 * **Disclosure metrics**:
 *   - perCandidateExpectedReturnIfPicked[i] = p_i · V_i · μ_M_i
 *   - perCandidateRankByExpectedReturn (sorted desc)
 *   - rationalPickIndex (best)
 *   - probabilityBestPickWins = p_{s*}
 *   - expectedRacesToFirstBestWin = 1 / p_{s*}  (Geometric expectation)
 *   - commercialUpliftOverSymmetric = bestRtp / (1/N · Σ p_i · V_i · μ_M_i)
 *   - P(best pick wins at least once in K races) = 1 − (1−p_{s*})^K (helper)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────
 *   - **P-089 (W188) Player-Elects Feature Composition** — m-of-N **subset**
 *     sa additive Σ r_i contributions; ovde **one winner** exactly + pick
 *     gating (multiplicative, not additive).
 *   - **P-024 (W107) Pick Bonus N-Stage Tree** — sequential picks across
 *     stages; ovde single pre-race election + categorical winner.
 *   - **P-022 (W104) Wheel Bonus** — wheel slice categorical bez pre-pick
 *     gating; ovde player pick determines payout collection.
 *   - **P-046 (W118) Bonus Wheel Respin** — multi-wheel respin Markov.
 *   - **P-068 (W155) Bonus Trigger Stratification** — scatter-trigger
 *     stratification, ne race.
 *
 * Compliance:
 *   - **UKGC RTS-12** mandatory player-skill mechanic RTP disclosure
 *   - **UKGC RTS-14** per-candidate RTP transparency (race mechanic)
 *   - **MGA PPD §11** competitive-pick mode disclosure
 *   - **eCOGRA** per-candidate prize+probability audit trail
 *   - **EU GA 2024** cross-jurisdiction baseline
 *
 * Naming: "race", "competitive pick", "candidate", "winner-among-N"
 * = generic slot-design + game-design terms. No vendor TM.
 */

/** ── Per-candidate config ─────────────────────────────────────────────────── */
export interface RaceCandidateConfig {
  /** Optional candidate label (audit trail only). */
  label?: string;
  /** Non-negative weight; p_i = w_i / Σ w_j. */
  weight: number;
  /** Base prize × bet ≥ 0 if this candidate wins AND player picked it. */
  basePrize: number;
  /** Mean of multiplier draw (per-race iid) ≥ 0. */
  multiplierMean: number;
  /** Variance of multiplier draw ≥ 0. */
  multiplierVariance: number;
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface RaceCompetitivePickWinnerConfig {
  /** Race candidates (N ≥ 2). */
  candidates: RaceCandidateConfig[];
}

/** ── Per-candidate disclosure ──────────────────────────────────────────────── */
export interface RaceCandidateDisclosure {
  index: number;
  label: string;
  probWin: number;
  basePrize: number;
  multiplierMean: number;
  expectedReturnIfPicked: number;
  rankByExpectedReturn: number;
  isRationalPick: boolean;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface RaceCompetitivePickWinnerResult {
  /** N (number of candidates). */
  numCandidates: number;
  /** Per-candidate disclosure rows. */
  perCandidate: RaceCandidateDisclosure[];
  /** E[Y | pick=s*] (best rational pick). */
  bestPickExpectedReturn: number;
  /** E[Y | worst pick]. */
  worstPickExpectedReturn: number;
  /** E[Y | uniform random pick over N candidates]. */
  uniformPickExpectedReturn: number;
  /** Variance of best-pick E[Y² | pick=s*] − E[Y]². */
  bestPickVariance: number;
  /** Std dev best-pick. */
  bestPickStdDev: number;
  /** Index of rational best pick (0..N-1). */
  bestPickIndex: number;
  /** Index of worst pick. */
  worstPickIndex: number;
  /** Best − Worst (E[Y] spread). */
  rtpSpread: number;
  /** Best − Uniform (skill-rational premium over flat pick). */
  skillPremiumVsUniform: number;
  /** P(best pick wins | single race). */
  probabilityBestPickWins: number;
  /** 1 / P(best pick wins) (Geometric expected races to first win). */
  expectedRacesToFirstBestWin: number;
  /** bestRtp / symmetricRtp = bestRtp / uniformRtp (commercial uplift). */
  commercialUpliftOverSymmetric: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: RaceCompetitivePickWinnerConfig): void {
  if (!Array.isArray(cfg.candidates) || cfg.candidates.length < 2) {
    throw new Error(`candidates must be array of length ≥ 2, got ${cfg.candidates?.length ?? 0}`);
  }
  let sumW = 0;
  for (let i = 0; i < cfg.candidates.length; i++) {
    const c = cfg.candidates[i]!;
    if (!Number.isFinite(c.weight) || c.weight < 0) {
      throw new Error(`candidates[${i}].weight must be ≥ 0, got ${c.weight}`);
    }
    if (!Number.isFinite(c.basePrize) || c.basePrize < 0) {
      throw new Error(`candidates[${i}].basePrize must be ≥ 0, got ${c.basePrize}`);
    }
    if (!Number.isFinite(c.multiplierMean) || c.multiplierMean < 0) {
      throw new Error(`candidates[${i}].multiplierMean must be ≥ 0, got ${c.multiplierMean}`);
    }
    if (!Number.isFinite(c.multiplierVariance) || c.multiplierVariance < 0) {
      throw new Error(`candidates[${i}].multiplierVariance must be ≥ 0, got ${c.multiplierVariance}`);
    }
    sumW += c.weight;
  }
  if (sumW <= 0) {
    throw new Error(`sum of candidate weights must be > 0, got ${sumW}`);
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeRaceCompetitivePickWinner(
  cfg: RaceCompetitivePickWinnerConfig,
): RaceCompetitivePickWinnerResult {
  validate(cfg);

  const N = cfg.candidates.length;
  const sumW = cfg.candidates.reduce((acc, c) => acc + c.weight, 0);
  const probs = cfg.candidates.map((c) => c.weight / sumW);

  // per-candidate E[Y | pick=i] = p_i · V_i · μ_M_i
  const erIfPicked = cfg.candidates.map((c, i) => probs[i]! * c.basePrize * c.multiplierMean);

  // best / worst / uniform
  let bestIdx = 0;
  let worstIdx = 0;
  for (let i = 1; i < N; i++) {
    if (erIfPicked[i]! > erIfPicked[bestIdx]!) bestIdx = i;
    if (erIfPicked[i]! < erIfPicked[worstIdx]!) worstIdx = i;
  }
  const bestRtp = erIfPicked[bestIdx]!;
  const worstRtp = erIfPicked[worstIdx]!;
  const uniformRtp = erIfPicked.reduce((acc, x) => acc + x, 0) / N;

  // rank by expected return (descending) — produces rank 1..N
  const sortedByEr = [...erIfPicked.keys()].sort((a, b) => erIfPicked[b]! - erIfPicked[a]!);
  const rankByEr = new Array<number>(N);
  for (let r = 0; r < N; r++) {
    rankByEr[sortedByEr[r]!] = r + 1;
  }

  const perCandidate: RaceCandidateDisclosure[] = cfg.candidates.map((c, i) => ({
    index: i,
    label: c.label ?? `c_${i}`,
    probWin: probs[i]!,
    basePrize: c.basePrize,
    multiplierMean: c.multiplierMean,
    expectedReturnIfPicked: erIfPicked[i]!,
    rankByExpectedReturn: rankByEr[i]!,
    isRationalPick: i === bestIdx,
  }));

  // Variance of best-pick Y = V_s · M_s · 𝟙{K=s} with s = bestIdx
  //   E[Y²] = p_s · V_s² · (σ²_M + μ_M²)  (since 𝟙² = 𝟙)
  //   Var[Y] = E[Y²] − E[Y]²
  const cBest = cfg.candidates[bestIdx]!;
  const eY2Best =
    probs[bestIdx]! * cBest.basePrize * cBest.basePrize *
    (cBest.multiplierVariance + cBest.multiplierMean * cBest.multiplierMean);
  const bestPickVariance = Math.max(0, eY2Best - bestRtp * bestRtp);
  const bestPickStdDev = Math.sqrt(bestPickVariance);

  const rtpSpread = bestRtp - worstRtp;
  const skillPremiumVsUniform = bestRtp - uniformRtp;

  const probabilityBestPickWins = probs[bestIdx]!;
  const expectedRacesToFirstBestWin =
    probabilityBestPickWins > 1e-15
      ? 1 / probabilityBestPickWins
      : Number.POSITIVE_INFINITY;

  const commercialUpliftOverSymmetric =
    uniformRtp > 1e-12 ? bestRtp / uniformRtp : Number.POSITIVE_INFINITY;

  return {
    numCandidates: N,
    perCandidate,
    bestPickExpectedReturn: bestRtp,
    worstPickExpectedReturn: worstRtp,
    uniformPickExpectedReturn: uniformRtp,
    bestPickVariance,
    bestPickStdDev,
    bestPickIndex: bestIdx,
    worstPickIndex: worstIdx,
    rtpSpread,
    skillPremiumVsUniform,
    probabilityBestPickWins,
    expectedRacesToFirstBestWin,
    commercialUpliftOverSymmetric,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveRaceCompetitivePickWinner = analyzeRaceCompetitivePickWinner;

/** Helper: P(best pick wins at least once in K races). */
export function probBestPickWinsAtLeastOnce(
  cfg: RaceCompetitivePickWinnerConfig,
  numRaces: number,
): number {
  if (!Number.isInteger(numRaces) || numRaces < 1) {
    throw new Error(`numRaces must be integer ≥ 1, got ${numRaces}`);
  }
  const r = analyzeRaceCompetitivePickWinner(cfg);
  return 1 - Math.pow(1 - r.probabilityBestPickWins, numRaces);
}

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateRaceCompetitivePickWinner(
  cfg: RaceCompetitivePickWinnerConfig,
  numRaces: number,
  pickStrategy: 'rational_best' | 'uniform_random' | 'fixed_index',
  fixedPickIndex = 0,
  seed = 0xface0192,
): {
  meanPayoutPerRace: number;
  stdDevPayoutPerRace: number;
  observedWinFrequencies: number[];
  observedPickWinRate: number;
} {
  validate(cfg);
  if (!Number.isInteger(numRaces) || numRaces < 1) {
    throw new Error(`numRaces must be integer ≥ 1, got ${numRaces}`);
  }

  const N = cfg.candidates.length;
  const sumW = cfg.candidates.reduce((acc, c) => acc + c.weight, 0);
  const cdf: number[] = [];
  let cum = 0;
  for (const c of cfg.candidates) {
    cum += c.weight / sumW;
    cdf.push(cum);
  }
  // floating safety
  cdf[N - 1] = 1;

  // Determine player's pick once per race (depending on strategy)
  // rational_best is pre-computed; uniform_random per race draws; fixed_index static.
  let bestIdx = 0;
  if (pickStrategy === 'rational_best') {
    const r = analyzeRaceCompetitivePickWinner(cfg);
    bestIdx = r.bestPickIndex;
  }

  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return (z >>> 0) / 4294967296;
  };
  const gaussian = (mu: number, sigma: number): number => {
    if (sigma <= 0) return mu;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
  };
  const sampleCandidate = (): number => {
    const u = rng();
    for (let i = 0; i < N; i++) {
      if (u <= cdf[i]!) return i;
    }
    return N - 1;
  };

  const winFreq = new Array<number>(N).fill(0);
  let sumY = 0;
  let sumY2 = 0;
  let pickWinCount = 0;

  for (let race = 0; race < numRaces; race++) {
    let pickIdx: number;
    if (pickStrategy === 'rational_best') {
      pickIdx = bestIdx;
    } else if (pickStrategy === 'fixed_index') {
      pickIdx = fixedPickIndex;
    } else {
      pickIdx = Math.min(N - 1, Math.floor(rng() * N));
    }
    const winner = sampleCandidate();
    winFreq[winner]!++;
    let y = 0;
    if (winner === pickIdx) {
      pickWinCount++;
      const cWin = cfg.candidates[winner]!;
      const sigM = Math.sqrt(cWin.multiplierVariance);
      const m = Math.max(0, gaussian(cWin.multiplierMean, sigM));
      y = cWin.basePrize * m;
    }
    sumY += y;
    sumY2 += y * y;
  }

  const meanY = sumY / numRaces;
  const varY = Math.max(0, sumY2 / numRaces - meanY * meanY);
  return {
    meanPayoutPerRace: meanY,
    stdDevPayoutPerRace: Math.sqrt(varY),
    observedWinFrequencies: winFreq.map((c) => c / numRaces),
    observedPickWinRate: pickWinCount / numRaces,
  };
}
