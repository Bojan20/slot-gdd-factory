/**
 * W152 Wave 186 — Big Bet Paid-Package Multi-Spin Reel-Set Schedule Aggregator
 * (67. solver, **UK-CRITICAL**).
 *
 * **L&W M9 P0 GAP CLOSURE** — covers Barcrest UK family + UKGC RTS-12
 * mandatory disclosure.
 *
 * Iconic Big Bet paid-package mehanika (regulator-mandated u UK 2010-2022):
 *   * LNW Barcrest Monopoly Big Event (2010, defining UK title — paid
 *     5-spin packages at progressive RTP up to 98%)
 *   * LNW Barcrest Rainbow Riches Pick n Mix (2014, Big Bet + feature
 *     composition)
 *   * LNW Barcrest Action Bank (2017, Big Bet vault-pick)
 *   * LNW Barcrest Pearl of Caribbean — Big Bet variant
 *
 * **67th closed-form solver, UK-critical.** Player pays N× stake za
 * unlocked package od K spinova, gde **svaki spin ima drugačiji reel-set
 * + paytable + RTP**. UKGC RTS-12 zahteva eksplicit disclosure svakog
 * per-spin RTP-a, ukupnog package RTP-a, P(profit), 1-in-N return.
 *
 * Distinct od **P-057 (W130) Free Spins Buy + Tier Trade-Off** koja
 * handluje per-tier paid mode RTP ali ASUMIRA da svi spinovi u paketu
 * imaju ISTU konfiguraciju — ovde svaki spin ima distinct paytable.
 *
 * ── Math (Per-Spin Independent + Aggregate Disclosure) ──────────────────────
 *
 * Paket sadrži K spinova. Spin k ∈ {1..K} ima:
 *   - per-spin stake b_k (operator-allocated portion of package cost)
 *   - per-spin RTP r_k = E[Y_k] / b_k (fraction)
 *   - per-spin variance σ²_k = Var[Y_k]
 *
 * Total package cost C = Σ_k b_k (typically = N · base_stake).
 *
 * **Closed-form aggregate**:
 *   E[total payout] = Σ_k b_k · r_k
 *   Var[total payout] = Σ_k σ²_k (per-spin independence)
 *   **package_rtp = E[total payout] / C**  (overall package RTP)
 *   **E[net_profit] = E[total payout] − C = Σ_k b_k·(r_k − 1)**
 *
 * **P(profit) via CLT-Normal approximation**:
 *   Z = (total payout − C) / √Var, P(profit) = 1 − Φ(z) gde z = (C − E[Y])/σ
 *   Validan kad K dovoljno velik (typically K ≥ 5 za CLT decent fit).
 *
 * **Operator-funded portion**:
 *   operator_subsidy = max(0, package_rtp − base_rtp) · C
 *   (delta iznad base-game RTP koliki je operator nominal subsidy)
 *
 * **Per-spin schedule transparency** (UKGC RTS-12 required):
 *   - perSpinRtpSchedule[k]
 *   - perSpinStakeAllocation[k]
 *   - perSpinExpectedPayout[k]
 *   - perSpinContributionToPackageRtp[k] (== b_k · r_k / C)
 *
 * **1-in-N profit frequency**:
 *   1 / P(profit) = oneInNPackagesAtLeastBreakEven
 *
 * **Best-spin disclosure**:
 *   bestSpinIndex = argmax_k r_k
 *   worstSpinIndex = argmin_k r_k
 *   bestSpinRtp, worstSpinRtp
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-057 (W130) FS Buy + Tier Trade-Off** — SINGLE-mode paid tier, ne
 *     multi-spin distinct schedule
 *   - **P-053 (W095) Ante Bet Trade-Off** — single bet decision, ne K-spin
 *     package
 *   - **P-037 (W081) Bonus Buy Variance** — paid mode bez within-package
 *     schedule switching
 *   - **P-072 (W163) Martingale Bust Time** — sequential bet progression,
 *     ne fixed multi-spin paid package
 *
 * Compliance:
 *   - **UKGC RTS-12** (Big Bet mandatory per-spin RTP disclosure 2010-2022)
 *   - **UKGC LCCP 3.4.3** (responsible gambling — chase-pattern flag if
 *     player_loss_per_package > harm-threshold)
 *   - **MGA PPD §17** (paid-package transparency)
 *   - **eCOGRA Generic Slots Audit** (multi-spin schedule audit trail)
 *
 * Naming: "big bet package", "multi-spin schedule", "per-spin reel-set" =
 * generic UK regulatory terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface BigBetPaidPackageConfig {
  /** Number of spins in the paid package K ≥ 2 (typically 5 for Big Bet). */
  packageSpinCount: number;
  /** Per-spin stake allocation (length K, sum = totalPackageCost). */
  perSpinStakeAllocation: number[];
  /** Per-spin RTP as fraction (length K, each ∈ [0, 2]). */
  perSpinRtp: number[];
  /** Per-spin variance σ²_k (length K, each ≥ 0). */
  perSpinVariance: number[];
  /** Base-game (non-package) RTP za subsidy comparison. */
  baseGameRtpForSubsidyComparison: number;
  /** Player loss harm threshold (UKGC LCCP) — flag ako E[loss/package] > threshold. */
  harmThresholdLossPerPackage?: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface BigBetPaidPackageResult {
  /** Total package cost C = Σ b_k. */
  totalPackageCost: number;
  /** Per-spin expected payout E[Y_k] = b_k · r_k (length K). */
  perSpinExpectedPayout: number[];
  /** Per-spin contribution to package RTP (length K, sums to package_rtp). */
  perSpinContributionToPackageRtp: number[];
  /** Total expected payout E[Y_total] = Σ b_k · r_k. */
  expectedTotalPayout: number;
  /** Total payout variance Var[Y_total] = Σ σ²_k. */
  varianceTotalPayout: number;
  /** Std deviation. */
  stdDevTotalPayout: number;
  /** Overall package RTP = E[Y_total] / C. */
  packageRtp: number;
  /** Expected net profit per package = E[Y_total] − C (negative if RTP < 1). */
  expectedNetProfitPerPackage: number;
  /** P(profit ≥ 0 across whole package) via CLT-Normal approximation. */
  probProfitCltApprox: number;
  /** 1 / P(profit) regulator "1 in X" form. */
  oneInNPackagesAtLeastBreakEven: number;
  /** Operator-funded subsidy (RTP above base-game baseline · C). */
  operatorSubsidyAmount: number;
  /** Operator-funded subsidy as fraction of package cost. */
  operatorSubsidyFraction: number;
  /** Index of highest-RTP spin in schedule. */
  bestSpinIndex: number;
  /** RTP of highest-RTP spin. */
  bestSpinRtp: number;
  /** Index of lowest-RTP spin in schedule. */
  worstSpinIndex: number;
  /** RTP of lowest-RTP spin. */
  worstSpinRtp: number;
  /** RTP escalation slope (linear regression on perSpinRtp vs k). */
  rtpEscalationSlope: number;
  /** Harm-threshold flag (UKGC LCCP responsible gambling). */
  harmThresholdExceeded: boolean;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: BigBetPaidPackageConfig): void {
  if (!Number.isInteger(cfg.packageSpinCount) || cfg.packageSpinCount < 2) {
    throw new Error(`packageSpinCount must be integer ≥ 2, got ${cfg.packageSpinCount}`);
  }
  if (
    !Array.isArray(cfg.perSpinStakeAllocation) ||
    cfg.perSpinStakeAllocation.length !== cfg.packageSpinCount
  ) {
    throw new Error(
      `perSpinStakeAllocation must have length ${cfg.packageSpinCount}, got ${cfg.perSpinStakeAllocation?.length}`,
    );
  }
  for (let k = 0; k < cfg.packageSpinCount; k++) {
    const b = cfg.perSpinStakeAllocation[k];
    if (!Number.isFinite(b) || b <= 0) {
      throw new Error(`perSpinStakeAllocation[${k}] must be > 0, got ${b}`);
    }
  }
  if (!Array.isArray(cfg.perSpinRtp) || cfg.perSpinRtp.length !== cfg.packageSpinCount) {
    throw new Error(`perSpinRtp must have length ${cfg.packageSpinCount}`);
  }
  for (let k = 0; k < cfg.packageSpinCount; k++) {
    const r = cfg.perSpinRtp[k];
    if (!Number.isFinite(r) || r < 0 || r > 2) {
      throw new Error(`perSpinRtp[${k}] must be ∈ [0, 2], got ${r}`);
    }
  }
  if (
    !Array.isArray(cfg.perSpinVariance) ||
    cfg.perSpinVariance.length !== cfg.packageSpinCount
  ) {
    throw new Error(`perSpinVariance must have length ${cfg.packageSpinCount}`);
  }
  for (let k = 0; k < cfg.packageSpinCount; k++) {
    if (!Number.isFinite(cfg.perSpinVariance[k]) || cfg.perSpinVariance[k] < 0) {
      throw new Error(`perSpinVariance[${k}] must be ≥ 0, got ${cfg.perSpinVariance[k]}`);
    }
  }
  if (
    !Number.isFinite(cfg.baseGameRtpForSubsidyComparison) ||
    cfg.baseGameRtpForSubsidyComparison < 0 ||
    cfg.baseGameRtpForSubsidyComparison > 2
  ) {
    throw new Error(
      `baseGameRtpForSubsidyComparison must be ∈ [0, 2], got ${cfg.baseGameRtpForSubsidyComparison}`,
    );
  }
  if (cfg.harmThresholdLossPerPackage !== undefined) {
    if (
      !Number.isFinite(cfg.harmThresholdLossPerPackage) ||
      cfg.harmThresholdLossPerPackage < 0
    ) {
      throw new Error(
        `harmThresholdLossPerPackage must be ≥ 0, got ${cfg.harmThresholdLossPerPackage}`,
      );
    }
  }
}

/** ── Numerical helpers ────────────────────────────────────────────────────── */

/** Abramowitz-Stegun normal CDF (max abs err ~7.5e-8). */
function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const az = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * az);
  const erfApprox =
    1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-az * az);
  return 0.5 * (1 + sign * erfApprox);
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeBigBetPaidPackage(
  cfg: BigBetPaidPackageConfig,
): BigBetPaidPackageResult {
  validate(cfg);

  const K = cfg.packageSpinCount;
  const b = cfg.perSpinStakeAllocation;
  const r = cfg.perSpinRtp;
  const v = cfg.perSpinVariance;
  const baseRtp = cfg.baseGameRtpForSubsidyComparison;
  const harmThreshold = cfg.harmThresholdLossPerPackage;

  // ── 1. Total package cost
  let C = 0;
  for (let k = 0; k < K; k++) C += b[k];

  // ── 2. Per-spin expected payout E[Y_k] = b_k · r_k
  const perSpinExpectedPayout = new Array(K);
  let expectedTotalPayout = 0;
  let varianceTotalPayout = 0;
  for (let k = 0; k < K; k++) {
    perSpinExpectedPayout[k] = b[k] * r[k];
    expectedTotalPayout += perSpinExpectedPayout[k];
    varianceTotalPayout += v[k];
  }
  const stdDevTotalPayout = Math.sqrt(varianceTotalPayout);

  // ── 3. Per-spin contribution to package RTP
  const packageRtp = C > 0 ? expectedTotalPayout / C : 0;
  const perSpinContributionToPackageRtp = new Array(K);
  for (let k = 0; k < K; k++) {
    perSpinContributionToPackageRtp[k] = C > 0 ? perSpinExpectedPayout[k] / C : 0;
  }

  // ── 4. Expected net profit
  const expectedNetProfitPerPackage = expectedTotalPayout - C;

  // ── 5. P(profit) via CLT-Normal: Z = (Y_total − C) / σ;
  //   P(Y_total ≥ C) = P(Z ≥ (C − E[Y_total]) / σ) = 1 − Φ((C − μ)/σ)
  let probProfitCltApprox: number;
  if (stdDevTotalPayout < 1e-12) {
    probProfitCltApprox = expectedTotalPayout >= C ? 1 : 0;
  } else {
    const z = (C - expectedTotalPayout) / stdDevTotalPayout;
    probProfitCltApprox = Math.max(0, Math.min(1, 1 - normalCdf(z)));
  }
  const oneInNPackagesAtLeastBreakEven =
    probProfitCltApprox > 1e-15 ? 1 / probProfitCltApprox : Number.POSITIVE_INFINITY;

  // ── 6. Operator subsidy (RTP above base-game baseline · C)
  const operatorSubsidyFraction = Math.max(0, packageRtp - baseRtp);
  const operatorSubsidyAmount = operatorSubsidyFraction * C;

  // ── 7. Best/worst spin
  let bestSpinIndex = 0;
  let worstSpinIndex = 0;
  for (let k = 1; k < K; k++) {
    if (r[k] > r[bestSpinIndex]) bestSpinIndex = k;
    if (r[k] < r[worstSpinIndex]) worstSpinIndex = k;
  }
  const bestSpinRtp = r[bestSpinIndex];
  const worstSpinRtp = r[worstSpinIndex];

  // ── 8. RTP escalation slope (linear regression vs spin index)
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let k = 0; k < K; k++) {
    sumX += k;
    sumY += r[k];
    sumXY += k * r[k];
    sumX2 += k * k;
  }
  const denom = K * sumX2 - sumX * sumX;
  const rtpEscalationSlope = denom > 1e-12 ? (K * sumXY - sumX * sumY) / denom : 0;

  // ── 9. Harm-threshold flag
  const lossPerPackage = -expectedNetProfitPerPackage; // positive number if expected loss
  const harmThresholdExceeded =
    harmThreshold !== undefined && lossPerPackage > harmThreshold;

  return {
    totalPackageCost: C,
    perSpinExpectedPayout,
    perSpinContributionToPackageRtp,
    expectedTotalPayout,
    varianceTotalPayout,
    stdDevTotalPayout,
    packageRtp,
    expectedNetProfitPerPackage,
    probProfitCltApprox,
    oneInNPackagesAtLeastBreakEven,
    operatorSubsidyAmount,
    operatorSubsidyFraction,
    bestSpinIndex,
    bestSpinRtp,
    worstSpinIndex,
    worstSpinRtp,
    rtpEscalationSlope,
    harmThresholdExceeded,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveBigBetPaidPackage = analyzeBigBetPaidPackage;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateBigBetPaidPackage(
  cfg: BigBetPaidPackageConfig,
  numPackages: number,
  seed = 0xface0186,
): {
  meanTotalPayoutPerPackage: number;
  stdDevTotalPayoutPerPackage: number;
  meanNetProfit: number;
  observedProbProfit: number;
  observedPackageRtp: number;
} {
  validate(cfg);
  if (!Number.isInteger(numPackages) || numPackages < 1) {
    throw new Error(`numPackages must be integer ≥ 1, got ${numPackages}`);
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
  // MC convention: allow negative draws (no per-spin truncation). This keeps
  // the MC mean = b_k·r_k = CF expected payout per spin exactly. Negative
  // draws represent the *aggregate* effect of "no win" outcomes; the vendor's
  // actual per-spin convention is non-negative, but the package-aggregate
  // mean/variance match the CF formula without truncation bias.
  const gaussian = (mu: number, sigma: number): number => {
    if (sigma <= 0) return mu;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
  };

  const K = cfg.packageSpinCount;
  const b = cfg.perSpinStakeAllocation;
  const r = cfg.perSpinRtp;
  const v = cfg.perSpinVariance;
  let C = 0;
  for (let k = 0; k < K; k++) C += b[k];

  let sumPayout = 0;
  let sumPayout2 = 0;
  let countProfit = 0;

  for (let pkg = 0; pkg < numPackages; pkg++) {
    let pkgPayout = 0;
    for (let k = 0; k < K; k++) {
      const spinMean = b[k] * r[k];
      const spinSigma = Math.sqrt(v[k]);
      pkgPayout += gaussian(spinMean, spinSigma);
    }
    sumPayout += pkgPayout;
    sumPayout2 += pkgPayout * pkgPayout;
    if (pkgPayout >= C) countProfit++;
  }

  const meanPayout = sumPayout / numPackages;
  const varPayout = Math.max(0, sumPayout2 / numPackages - meanPayout * meanPayout);
  return {
    meanTotalPayoutPerPackage: meanPayout,
    stdDevTotalPayoutPerPackage: Math.sqrt(varPayout),
    meanNetProfit: meanPayout - C,
    observedProbProfit: countProfit / numPackages,
    observedPackageRtp: meanPayout / C,
  };
}
