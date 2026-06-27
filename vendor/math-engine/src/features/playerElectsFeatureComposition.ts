/**
 * W152 Wave 188 — Player-Elects Feature Composition Aggregator (69. solver).
 *
 * **L&W M11 P1 GAP CLOSURE** — covers 4 L&W titles where player elects
 * m-of-N feature/mode composition pre-spin or pre-bonus.
 *
 * Iconic player-elect mehanika:
 *   * LNW Barcrest Rainbow Riches Pick n Mix (2014 — pick 3 of 5 bonuses)
 *   * LNW Bally Michael Jackson King of Pop (2013 — 3 FS modes: Smooth
 *     Criminal / Beat It / Billie Jean)
 *   * LNW Bally KISS (band-member FS variants)
 *   * LNW Shuffle Master 5 Treasures (2017 — 5 FS-mode selection menu)
 *
 * **69th closed-form solver.** First kernel modeling **combinatorial
 * m-of-N feature-mode selection** sa per-mode RTP/Var i player-rational
 * pick analysis (greedy top-m).
 *
 * ── Math (m-of-N Combinatorial Composition) ────────────────────────────────
 *
 * N kandidat-modes, svaki sa:
 *   - per-mode RTP r_i (E[Y_i] per spin if mode i enabled)
 *   - per-mode variance σ²_i
 *   - per-mode trigger probability p_i (some modes "fire" only on trigger)
 *
 * Player elects subset S ⊆ {1..N} sa |S| = m (vendor-fixed m). All elected
 * modes are active simultaneously per spin → contributions sum (independence
 * assumption — vendor-typical for distinct FS variants).
 *
 * **Composition payout given subset S**:
 *   E[Y | S] = Σ_{i ∈ S} r_i
 *   Var[Y | S] = Σ_{i ∈ S} σ²_i   (modes independent)
 *
 * **Best player-rational pick** (top-m by RTP):
 *   S* = argmax_{|S|=m} E[Y | S] = top m modes sorted by r_i desc
 *   E[Y | S*] = Σ_{top-m} r_i
 *
 * **Worst pick** (bottom-m by RTP):
 *   S_worst = bottom m modes
 *   E[Y | S_worst] = Σ_{bottom-m} r_i
 *
 * **Uniform-random pick** (player picks uniformly):
 *   E[Y | uniform pick] = (m/N) · Σ r_i   (linearity of expectation across all C(N,m) subsets)
 *
 * **RTP spread** (player-knowledge value):
 *   spread = E[Y | S*] − E[Y | S_worst]
 *   = top-m − bottom-m sum
 *
 * **Skill premium** (player-rational vs naive):
 *   skillPremium = E[Y | S*] − E[Y | uniform]
 *   = sum_top_m - (m/N)·sum_all
 *
 * **Per-mode contribution** disclosure (UKGC RTS-14 transparency):
 *   for each mode i: contributionIfPicked = r_i, probInRationalPick = 1 if rank_i ≤ m else 0
 *
 * **Number of distinct compositions** = C(N, m) (binomial coefficient).
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-053 (W095) Ante Bet Trade-Off** — single bet decision, ne m-of-N
 *     composition
 *   - **P-057 (W130) FS Buy + Tier Trade-Off** — paid mode tier, ne combinatorial
 *     subset selection
 *   - **P-024 (W107) Pick Bonus N-Stage Tree** — sequential pick stages, ne
 *     simultaneous subset
 *   - **P-087 (W186) Big Bet Paid-Package** — multi-spin same schedule, ne
 *     player-elected modes
 *
 * Compliance:
 *   - UKGC RTS-12 (player choice mechanic disclosure)
 *   - UKGC RTS-14 (per-mode contribution transparency)
 *   - MGA PPD §11 (composition transparency — must disclose RTP spread)
 *   - eCOGRA Generic Slots Audit (per-mode audit trail)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "player-elect", "mode composition", "feature subset" = generic
 * slot-design terms. No vendor TM.
 */

/** Per-mode definition. */
export interface FeatureModeDefinition {
  /** Human-readable mode name (operator-supplied). */
  name: string;
  /** Per-mode RTP contribution u × bet units kada je mode aktiviran. */
  rtp: number;
  /** Per-mode variance σ²_i kada je mode aktiviran. */
  variance: number;
}

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface PlayerElectsFeatureCompositionConfig {
  /** Total number of available modes N. */
  candidateModes: FeatureModeDefinition[];
  /** Number of modes player must elect (1 ≤ m ≤ N). */
  numModesToElect: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface PlayerElectsFeatureCompositionResult {
  /** Total number of possible compositions = C(N, m). */
  numDistinctCompositions: number;
  /** E[Y] under best player-rational pick (top-m by RTP). */
  expectedPayoutBestPick: number;
  /** Var[Y] under best player-rational pick. */
  varianceBestPick: number;
  /** Std dev best pick. */
  stdDevBestPick: number;
  /** Best subset indices (sorted by RTP desc, top-m). */
  bestPickIndices: number[];
  /** Best subset names. */
  bestPickNames: string[];
  /** E[Y] under worst pick (bottom-m by RTP). */
  expectedPayoutWorstPick: number;
  /** Worst subset indices. */
  worstPickIndices: number[];
  /** Worst subset names. */
  worstPickNames: string[];
  /** E[Y] under uniform-random pick = (m/N) · Σ_i r_i. */
  expectedPayoutUniformPick: number;
  /** RTP spread = bestPick − worstPick (player-knowledge value). */
  rtpSpread: number;
  /** Skill premium = bestPick − uniform pick. */
  skillPremium: number;
  /** Per-mode disclosure: RTP, probInRationalPick, contributionIfPicked. */
  perModeDisclosure: Array<{
    name: string;
    rtp: number;
    variance: number;
    rankByRtp: number;
    inRationalTopMPick: boolean;
    contributionIfPicked: number;
  }>;
  /** Sum of all candidate-mode RTPs (full-portfolio E[Y] if all enabled). */
  fullPortfolioExpectedPayout: number;
  /** Player-rationality ratio = bestPick / fullPortfolio (m/N if uniform; >m/N if positive selection). */
  rationalityCoverageRatio: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: PlayerElectsFeatureCompositionConfig): void {
  if (!Array.isArray(cfg.candidateModes) || cfg.candidateModes.length < 1) {
    throw new Error('candidateModes must be non-empty array');
  }
  for (let i = 0; i < cfg.candidateModes.length; i++) {
    const m = cfg.candidateModes[i];
    if (typeof m.name !== 'string' || m.name.length === 0) {
      throw new Error(`candidateModes[${i}].name must be non-empty string`);
    }
    if (!Number.isFinite(m.rtp) || m.rtp < 0) {
      throw new Error(`candidateModes[${i}].rtp must be ≥ 0, got ${m.rtp}`);
    }
    if (!Number.isFinite(m.variance) || m.variance < 0) {
      throw new Error(`candidateModes[${i}].variance must be ≥ 0, got ${m.variance}`);
    }
  }
  if (
    !Number.isInteger(cfg.numModesToElect) ||
    cfg.numModesToElect < 1 ||
    cfg.numModesToElect > cfg.candidateModes.length
  ) {
    throw new Error(
      `numModesToElect must be integer ∈ [1, ${cfg.candidateModes.length}], got ${cfg.numModesToElect}`,
    );
  }
}

/** Binomial coefficient C(n, k). */
function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return Math.round(c);
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzePlayerElectsFeatureComposition(
  cfg: PlayerElectsFeatureCompositionConfig,
): PlayerElectsFeatureCompositionResult {
  validate(cfg);

  const N = cfg.candidateModes.length;
  const m = cfg.numModesToElect;
  const modes = cfg.candidateModes;

  // ── 1. Sort indices by RTP desc
  const sortedByRtpDesc = modes
    .map((mode, idx) => ({ idx, rtp: mode.rtp }))
    .sort((a, b) => b.rtp - a.rtp);

  const bestPickIndices = sortedByRtpDesc.slice(0, m).map((e) => e.idx);
  const worstPickIndices = sortedByRtpDesc.slice(N - m).map((e) => e.idx);

  // ── 2. Best & worst pick aggregation
  let expectedPayoutBestPick = 0;
  let varianceBestPick = 0;
  for (const idx of bestPickIndices) {
    expectedPayoutBestPick += modes[idx].rtp;
    varianceBestPick += modes[idx].variance;
  }
  const bestPickNames = bestPickIndices.map((i) => modes[i].name);

  let expectedPayoutWorstPick = 0;
  for (const idx of worstPickIndices) {
    expectedPayoutWorstPick += modes[idx].rtp;
  }
  const worstPickNames = worstPickIndices.map((i) => modes[i].name);

  // ── 3. Uniform-random pick = (m/N) · Σ r_i (linearity)
  let sumAllRtp = 0;
  for (const mode of modes) sumAllRtp += mode.rtp;
  const expectedPayoutUniformPick = (m / N) * sumAllRtp;

  // ── 4. Spreads & premiums
  const rtpSpread = expectedPayoutBestPick - expectedPayoutWorstPick;
  const skillPremium = expectedPayoutBestPick - expectedPayoutUniformPick;

  // ── 5. Per-mode disclosure
  const rankByRtp: number[] = new Array(N);
  sortedByRtpDesc.forEach((e, rank) => {
    rankByRtp[e.idx] = rank + 1; // 1-indexed
  });
  const perModeDisclosure = modes.map((mode, idx) => ({
    name: mode.name,
    rtp: mode.rtp,
    variance: mode.variance,
    rankByRtp: rankByRtp[idx],
    inRationalTopMPick: rankByRtp[idx] <= m,
    contributionIfPicked: mode.rtp,
  }));

  // ── 6. Full-portfolio E[Y] (all modes enabled hypothetically)
  const fullPortfolioExpectedPayout = sumAllRtp;
  const rationalityCoverageRatio =
    fullPortfolioExpectedPayout > 1e-9
      ? expectedPayoutBestPick / fullPortfolioExpectedPayout
      : 0;

  return {
    numDistinctCompositions: binomialCoefficient(N, m),
    expectedPayoutBestPick,
    varianceBestPick,
    stdDevBestPick: Math.sqrt(varianceBestPick),
    bestPickIndices,
    bestPickNames,
    expectedPayoutWorstPick,
    worstPickIndices,
    worstPickNames,
    expectedPayoutUniformPick,
    rtpSpread,
    skillPremium,
    perModeDisclosure,
    fullPortfolioExpectedPayout,
    rationalityCoverageRatio,
  };
}

/** Alias for portfolio runner naming convention. */
export const solvePlayerElectsFeatureComposition = analyzePlayerElectsFeatureComposition;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulatePlayerElectsFeatureComposition(
  cfg: PlayerElectsFeatureCompositionConfig,
  numSpins: number,
  pickStrategy: 'rational' | 'uniform' | 'worst' = 'rational',
  seed = 0xface0188,
): {
  meanPayoutPerSpin: number;
  stdDevPayoutPerSpin: number;
  observedPickStrategy: string;
} {
  validate(cfg);
  if (!Number.isInteger(numSpins) || numSpins < 1) {
    throw new Error(`numSpins must be integer ≥ 1, got ${numSpins}`);
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

  const N = cfg.candidateModes.length;
  const m = cfg.numModesToElect;
  const modes = cfg.candidateModes;

  // Determine pick based on strategy
  const sortedByRtpDesc = modes
    .map((mode, idx) => ({ idx, rtp: mode.rtp }))
    .sort((a, b) => b.rtp - a.rtp);

  let sumPayout = 0;
  let sumPayout2 = 0;
  for (let spin = 0; spin < numSpins; spin++) {
    let pickIndices: number[];
    if (pickStrategy === 'rational') {
      pickIndices = sortedByRtpDesc.slice(0, m).map((e) => e.idx);
    } else if (pickStrategy === 'worst') {
      pickIndices = sortedByRtpDesc.slice(N - m).map((e) => e.idx);
    } else {
      // uniform: random m-subset
      const allIndices = Array.from({ length: N }, (_, i) => i);
      // Fisher-Yates shuffle (partial)
      for (let i = 0; i < m; i++) {
        const j = i + Math.floor(rng() * (N - i));
        const tmp = allIndices[i];
        allIndices[i] = allIndices[j];
        allIndices[j] = tmp;
      }
      pickIndices = allIndices.slice(0, m);
    }

    let payout = 0;
    for (const idx of pickIndices) {
      payout += gaussian(modes[idx].rtp, Math.sqrt(modes[idx].variance));
    }
    sumPayout += payout;
    sumPayout2 += payout * payout;
  }
  const meanPayout = sumPayout / numSpins;
  const varPayout = Math.max(0, sumPayout2 / numSpins - meanPayout * meanPayout);

  return {
    meanPayoutPerSpin: meanPayout,
    stdDevPayoutPerSpin: Math.sqrt(varPayout),
    observedPickStrategy: pickStrategy,
  };
}
