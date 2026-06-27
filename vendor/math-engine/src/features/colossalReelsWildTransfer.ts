/**
 * W152 Wave 184 — Colossal Reels Wild-Transfer Coupled Two-Grid Aggregator (65. solver).
 *
 * **L&W M7 P0 GAP CLOSURE** — covers Spartacus family + ≥50 WMS land-based titles.
 *
 * Iconic two-grid wild-transfer mehanika:
 *   * WMS Spartacus Gladiator of Rome (2012, defining title — 5×4 main + 5×12 colossal, 100 paylines)
 *   * Spartacus Super Colossal Reels (2019)
 *   * Spartacus Call to Arms (2017, 50 paylines)
 *   * 50+ WMS land-based dependent titles (Caesar's Empire, Forbidden Dragons, etc.)
 *
 * **65th closed-form solver.** First kernel modeling **two-grid joint payout
 * with conditional symbol propagation** — distinct od P-030 (Parallel Screens
 * Aggregate W058) koja assume independence.
 *
 * ── Math (2-Stage Binomial sa Conditional Coupling) ────────────────────────
 *
 * Setup: N reels, main grid N×M_main, colossal grid N×M_colossal.
 * Per reel i: P(wild present u main) = p_w_i (independent across reels).
 *
 * **Stage 1 — main grid wild count**: K_main ~ Binomial(N, p_w) ako
 * p_w jednako po reel-ima. Inače per-reel-non-uniform: dynamic programming
 * preko reel-ova daje exact PMF.
 *
 * **Stage 2 — colossal transfer (conditional)**: ako reel i ima wild u main,
 * sa verovatnoćom q_transfer dolazi do full-column wild u colossal reel-u i
 * (full M_colossal rows wild). Inače colossal reel ostaje normalan.
 * K_colossal | K_main = k ~ Binomial(k, q_transfer).
 *
 * **Per-config payout schedule** (operator-provided):
 *   - payoutMain[k] = × bet kada main grid ima k wild reels (vendor-tuned)
 *   - payoutColossal[j] = × bet kada colossal grid ima j wild reels
 *   - Optional joint-bonus payoutBoth[k][j] dodatak za "both grids same wild count"
 *
 * **Closed-form aggregate**:
 *   E[Y] = Σ_{k=0..N} P(K_main=k) · [payoutMain[k]
 *                                   + Σ_{j=0..k} P(K_col=j|K_main=k) · payoutCol[j]]
 *
 * Sa per-reel non-uniform p_w, prvo enumerišemo joint pmf P(K_main=k) preko
 * standard reel-by-reel DP O(N²); zatim per fixed K_main=k, Binomial(k, q_t)
 * eksplicitno.
 *
 * **Disclosure metrics**:
 *   - E[K_main], Var[K_main]
 *   - E[K_colossal] = E[K_main] · q_transfer
 *   - P(both grids ≥ 1 wild reel) = grid-coverage analyzer
 *   - P(K_main = N AND K_colossal = N) = "full-screen wild" jackpot probability
 *   - oneInNSpinsFullWildBothGrids = 1 / P_full_full
 *   - commercialUpliftVsIndependentSplit = E[Y_coupled] / E[Y_independent_assume_no_transfer]
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-030 (W058) Parallel Screens Aggregate** — INDEPENDENT screens, ne
 *     conditional-propagation coupling
 *   - **P-058 (W132) Multi-Level Wild Tier Markov** — single-wild Markov state,
 *     ne grid-wild propagation
 *   - **P-064 (W123) Mega Symbol Multi-Cell Expansion** — single grid mega-symbol,
 *     ne two-grid wild transfer
 *   - **P-076 (W169) Drop-and-Stick Wild Expansion** — single grid sticky,
 *     ne two-grid coupling
 *
 * Compliance:
 *   - UKGC RTS 14 (multi-grid feature disclosure)
 *   - MGA PPD §11 (coupled-grid mechanic transparency)
 *   - eCOGRA Generic Slots Audit (joint-grid evaluation audit)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "two-grid", "wild transfer", "coupled grid" = generic slot-design
 * terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface ColossalReelsWildTransferConfig {
  /** Number of reels N ≥ 1 (shared across both grids). */
  numReels: number;
  /** Per-reel probability of wild presence on main grid (length N). */
  perReelMainWildProb: number[];
  /** Conditional P(colossal wild reel | main wild reel) ∈ [0, 1]. */
  probTransferToColossal: number;
  /**
   * Payout when k of N main reels have wild (length N+1).
   * Vendor-tuned; typically 0 for k < threshold, exponential growth past.
   */
  payoutMainGivenWildReels: number[];
  /**
   * Payout when j of N colossal reels have wild (length N+1).
   * Higher than main due to longer paylines on colossal grid.
   */
  payoutColossalGivenWildReels: number[];
  /**
   * Optional joint bonus payout when (k_main = k, k_colossal = j); 2D length
   * (N+1)×(N+1). Defaults to all zeros if omitted.
   */
  jointBonusPayoutMatrix?: number[][];
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface ColossalReelsWildTransferResult {
  /** PMF of K_main = # wild reels on main grid (length N+1). */
  pmfWildReelsMain: number[];
  /** PMF of K_colossal = # wild reels on colossal grid (length N+1). */
  pmfWildReelsColossal: number[];
  /** Joint PMF[k_main][k_col] = P(K_main=k, K_col=j) (length (N+1)×(N+1)). */
  jointPmfWildReels: number[][];
  /** E[K_main]. */
  expectedWildReelsMain: number;
  /** Var[K_main]. */
  varianceWildReelsMain: number;
  /** E[K_colossal] = q_t · E[K_main] (since K_col | K_main ~ Bin(K_main, q_t)). */
  expectedWildReelsColossal: number;
  /** Var[K_colossal] = q_t·(1−q_t)·E[K_main] + q_t²·Var[K_main]. */
  varianceWildReelsColossal: number;
  /** E[total payout per spin] = main + colossal + joint-bonus aggregation. */
  expectedTotalPayoutPerSpin: number;
  /** P(both grids ≥ 1 wild reel). */
  probBothGridsAtLeastOneWild: number;
  /** P(K_main = N AND K_colossal = N) — "full-screen wild" jackpot. */
  probFullWildBothGrids: number;
  /** 1 / P_full_wild_both_grids regulator "1 in X" form. */
  oneInNSpinsFullWildBothGrids: number;
  /** E[Y] / E[Y_no_transfer_baseline] commercial coupling uplift. */
  commercialUpliftVsIndependentSplit: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: ColossalReelsWildTransferConfig): void {
  if (!Number.isInteger(cfg.numReels) || cfg.numReels < 1) {
    throw new Error(`numReels must be integer ≥ 1, got ${cfg.numReels}`);
  }
  if (
    !Array.isArray(cfg.perReelMainWildProb) ||
    cfg.perReelMainWildProb.length !== cfg.numReels
  ) {
    throw new Error(
      `perReelMainWildProb must have length ${cfg.numReels}, got ${cfg.perReelMainWildProb?.length}`,
    );
  }
  for (let i = 0; i < cfg.numReels; i++) {
    const p = cfg.perReelMainWildProb[i];
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`perReelMainWildProb[${i}] must be ∈ [0, 1], got ${p}`);
    }
  }
  if (
    !Number.isFinite(cfg.probTransferToColossal) ||
    cfg.probTransferToColossal < 0 ||
    cfg.probTransferToColossal > 1
  ) {
    throw new Error(
      `probTransferToColossal must be ∈ [0, 1], got ${cfg.probTransferToColossal}`,
    );
  }
  const Np1 = cfg.numReels + 1;
  if (
    !Array.isArray(cfg.payoutMainGivenWildReels) ||
    cfg.payoutMainGivenWildReels.length !== Np1
  ) {
    throw new Error(
      `payoutMainGivenWildReels must have length ${Np1}, got ${cfg.payoutMainGivenWildReels?.length}`,
    );
  }
  if (
    !Array.isArray(cfg.payoutColossalGivenWildReels) ||
    cfg.payoutColossalGivenWildReels.length !== Np1
  ) {
    throw new Error(
      `payoutColossalGivenWildReels must have length ${Np1}, got ${cfg.payoutColossalGivenWildReels?.length}`,
    );
  }
  for (let k = 0; k <= cfg.numReels; k++) {
    if (
      !Number.isFinite(cfg.payoutMainGivenWildReels[k]) ||
      cfg.payoutMainGivenWildReels[k] < 0
    ) {
      throw new Error(
        `payoutMainGivenWildReels[${k}] must be ≥ 0, got ${cfg.payoutMainGivenWildReels[k]}`,
      );
    }
    if (
      !Number.isFinite(cfg.payoutColossalGivenWildReels[k]) ||
      cfg.payoutColossalGivenWildReels[k] < 0
    ) {
      throw new Error(
        `payoutColossalGivenWildReels[${k}] must be ≥ 0, got ${cfg.payoutColossalGivenWildReels[k]}`,
      );
    }
  }
  if (cfg.jointBonusPayoutMatrix !== undefined) {
    if (
      !Array.isArray(cfg.jointBonusPayoutMatrix) ||
      cfg.jointBonusPayoutMatrix.length !== Np1
    ) {
      throw new Error(
        `jointBonusPayoutMatrix must be (N+1)×(N+1) = ${Np1}×${Np1}`,
      );
    }
    for (let k = 0; k <= cfg.numReels; k++) {
      const row = cfg.jointBonusPayoutMatrix[k];
      if (!Array.isArray(row) || row.length !== Np1) {
        throw new Error(`jointBonusPayoutMatrix[${k}] must have length ${Np1}`);
      }
      for (let j = 0; j <= cfg.numReels; j++) {
        if (!Number.isFinite(row[j]) || row[j] < 0) {
          throw new Error(`jointBonusPayoutMatrix[${k}][${j}] must be ≥ 0, got ${row[j]}`);
        }
      }
    }
  }
}

/** ── Binomial PMF (n, p) for small n. */
function binomialPmf(n: number, p: number): number[] {
  const pmf = new Array(n + 1).fill(0);
  if (n === 0) {
    pmf[0] = 1;
    return pmf;
  }
  if (p <= 0) {
    pmf[0] = 1;
    return pmf;
  }
  if (p >= 1) {
    pmf[n] = 1;
    return pmf;
  }
  const oneMinusP = 1 - p;
  pmf[0] = Math.pow(oneMinusP, n);
  const ratio = p / oneMinusP;
  for (let k = 1; k <= n; k++) {
    pmf[k] = (pmf[k - 1] * ratio * (n - k + 1)) / k;
  }
  return pmf;
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeColossalReelsWildTransfer(
  cfg: ColossalReelsWildTransferConfig,
): ColossalReelsWildTransferResult {
  validate(cfg);

  const N = cfg.numReels;
  const p = cfg.perReelMainWildProb;
  const q_t = cfg.probTransferToColossal;

  // ── 1. PMF za K_main via per-reel-non-uniform DP O(N²)
  //    pmfMain[k] = P(exactly k of N reels have main wild)
  let pmfMain = [1];
  for (let i = 0; i < N; i++) {
    const next = new Array(pmfMain.length + 1).fill(0);
    const pi = p[i];
    for (let k = 0; k < pmfMain.length; k++) {
      next[k] += pmfMain[k] * (1 - pi);
      next[k + 1] += pmfMain[k] * pi;
    }
    pmfMain = next;
  }

  // ── 2. Joint PMF[k_main][k_col]: K_col | K_main ~ Binomial(K_main, q_t)
  const jointPmf: number[][] = new Array(N + 1);
  for (let k = 0; k <= N; k++) {
    jointPmf[k] = new Array(N + 1).fill(0);
  }
  const pmfCol = new Array(N + 1).fill(0);
  for (let k = 0; k <= N; k++) {
    if (pmfMain[k] < 1e-18) continue;
    const condPmf = binomialPmf(k, q_t);
    for (let j = 0; j <= k; j++) {
      jointPmf[k][j] = pmfMain[k] * condPmf[j];
      pmfCol[j] += pmfMain[k] * condPmf[j];
    }
  }

  // ── 3. Moments
  let expK_main = 0;
  let expK_main_sq = 0;
  for (let k = 0; k <= N; k++) {
    expK_main += k * pmfMain[k];
    expK_main_sq += k * k * pmfMain[k];
  }
  const varK_main = Math.max(0, expK_main_sq - expK_main * expK_main);
  // E[K_col] = q_t · E[K_main]; Var[K_col] from law of total variance:
  //   Var[K_col] = E[Var[K_col|K_main]] + Var[E[K_col|K_main]]
  //             = E[K_main·q_t·(1−q_t)] + Var[K_main·q_t]
  //             = q_t·(1−q_t)·E[K_main] + q_t²·Var[K_main]
  const expK_col = q_t * expK_main;
  const varK_col = q_t * (1 - q_t) * expK_main + q_t * q_t * varK_main;

  // ── 4. Expected payout aggregation
  let expY = 0;
  for (let k = 0; k <= N; k++) {
    if (pmfMain[k] < 1e-18) continue;
    let condPart = cfg.payoutMainGivenWildReels[k];
    for (let j = 0; j <= k; j++) {
      const condProb = jointPmf[k][j] / pmfMain[k];
      let segment = cfg.payoutColossalGivenWildReels[j];
      if (cfg.jointBonusPayoutMatrix) segment += cfg.jointBonusPayoutMatrix[k][j];
      condPart += condProb * segment;
    }
    expY += pmfMain[k] * condPart;
  }

  // ── 5. Disclosure: P(both grids ≥ 1) = 1 − P(K_main=0) − P(K_col=0 | K_main>0)·P(K_main>0)
  //   Easier: 1 − Σ_{k,j: k=0 OR j=0} P(K_main=k, K_col=j)
  let probBothAtLeastOne = 0;
  for (let k = 1; k <= N; k++) {
    for (let j = 1; j <= N; j++) {
      probBothAtLeastOne += jointPmf[k][j];
    }
  }
  const probFullWild = jointPmf[N][N];
  const oneInNFullWild =
    probFullWild > 1e-18 ? 1 / probFullWild : Number.POSITIVE_INFINITY;

  // ── 6. Commercial uplift vs independent split (q_t = 0 baseline)
  //   Baseline: no transfer → E[Y_main] only + E[Y_col @ q_t=0] = payoutCol[0]
  let baselineY = 0;
  for (let k = 0; k <= N; k++) {
    baselineY += pmfMain[k] * (cfg.payoutMainGivenWildReels[k] + cfg.payoutColossalGivenWildReels[0]);
  }
  const upliftRatio = baselineY > 1e-12 ? expY / baselineY : 1;

  return {
    pmfWildReelsMain: pmfMain,
    pmfWildReelsColossal: pmfCol,
    jointPmfWildReels: jointPmf,
    expectedWildReelsMain: expK_main,
    varianceWildReelsMain: varK_main,
    expectedWildReelsColossal: expK_col,
    varianceWildReelsColossal: varK_col,
    expectedTotalPayoutPerSpin: expY,
    probBothGridsAtLeastOneWild: probBothAtLeastOne,
    probFullWildBothGrids: probFullWild,
    oneInNSpinsFullWildBothGrids: oneInNFullWild,
    commercialUpliftVsIndependentSplit: upliftRatio,
  };
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solveColossalReelsWildTransfer = analyzeColossalReelsWildTransfer;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateColossalReelsWildTransfer(
  cfg: ColossalReelsWildTransferConfig,
  numSpins: number,
  seed = 0xface0184,
): {
  meanWildReelsMain: number;
  meanWildReelsColossal: number;
  meanTotalPayoutPerSpin: number;
  observedPmfWildReelsMain: number[];
  observedPmfWildReelsColossal: number[];
  observedProbBothGridsAtLeastOne: number;
  observedProbFullWildBothGrids: number;
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

  const N = cfg.numReels;
  const p = cfg.perReelMainWildProb;
  const q_t = cfg.probTransferToColossal;
  let sumMain = 0;
  let sumCol = 0;
  let sumPayout = 0;
  const countMain = new Array(N + 1).fill(0);
  const countCol = new Array(N + 1).fill(0);
  let countBothAtLeastOne = 0;
  let countFullWild = 0;

  for (let spin = 0; spin < numSpins; spin++) {
    let kMain = 0;
    let kCol = 0;
    for (let i = 0; i < N; i++) {
      if (rng() < p[i]) {
        kMain++;
        if (rng() < q_t) kCol++;
      }
    }
    sumMain += kMain;
    sumCol += kCol;
    let payout = cfg.payoutMainGivenWildReels[kMain] + cfg.payoutColossalGivenWildReels[kCol];
    if (cfg.jointBonusPayoutMatrix) payout += cfg.jointBonusPayoutMatrix[kMain][kCol];
    sumPayout += payout;
    countMain[kMain]++;
    countCol[kCol]++;
    if (kMain > 0 && kCol > 0) countBothAtLeastOne++;
    if (kMain === N && kCol === N) countFullWild++;
  }

  return {
    meanWildReelsMain: sumMain / numSpins,
    meanWildReelsColossal: sumCol / numSpins,
    meanTotalPayoutPerSpin: sumPayout / numSpins,
    observedPmfWildReelsMain: countMain.map((c) => c / numSpins),
    observedPmfWildReelsColossal: countCol.map((c) => c / numSpins),
    observedProbBothGridsAtLeastOne: countBothAtLeastOne / numSpins,
    observedProbFullWildBothGrids: countFullWild / numSpins,
  };
}
