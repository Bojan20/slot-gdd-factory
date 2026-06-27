/**
 * W152 Wave 191 — Bonus Bank Running-Balance Offset Aggregator (72. solver).
 *
 * **L&W M10 P0 GAP CLOSURE** — covers Barcrest Rainbow Riches Megaways
 * "Bonus Bank" + future L&W banking-mode flagship variants.
 *
 * Iconic Bonus Bank mehanika sa player-elected aggregation:
 *   * LNW Barcrest Rainbow Riches Megaways (2020, defining title — Bonus Bank
 *     sa 3 izbora "Bank Off Wins" / "Bank All Wins" / "Bank Small Wins")
 *   * Barcrest Bonus Bank variants koji nude banking-offset preko FS sesije
 *   * Future L&W titles sa player-elected pay/bank toggling
 *
 * **72nd closed-form solver.** First kernel modeling **per-spin player-elected
 * banking transformation sa per-bucket multiplier**. Distinct od P-066 (W097)
 * FS Lookback (POST-HOC max-sum disjoint segment) — Bank operates PER-spin
 * with multiplier application. Distinct od P-039/P-089 player-elects (mode
 * picks single FS variant) — Bonus Bank applies aggregation transformation
 * over FS payout STREAM, dimensionally different.
 *
 * ── Math (Per-Spin Bucketed Aggregation w/ Bank Multiplier) ───────────────
 *
 * N = FS spins. Per-spin payout W_k ~ iid:
 *   E[W] = μ_W = p_low·μ_low + (1−p_low)·μ_high
 *   Var[W] = σ²_W (overall)
 *   p_low = P(W ≤ τ)         (small-win bucket fraction)
 *   μ_low, σ²_low = conditional mean/var | W ≤ τ
 *   μ_high, σ²_high = conditional mean/var | W > τ
 *   (μ_W = p_low·μ_low + (1−p_low)·μ_high holds by tower property)
 *
 * **Three player-elected modes**:
 *
 * **Mode A "bank_off_wins"** (no banking, baseline):
 *   T_A = Σ_{k=1..N} W_k
 *   E[T_A] = N·μ_W
 *   Var[T_A] = N·σ²_W
 *
 * **Mode B "bank_all_wins"** (multiplier m_B on entire pool):
 *   T_B = m_B · Σ_{k=1..N} W_k
 *   E[T_B] = m_B · N · μ_W
 *   Var[T_B] = m_B² · N · σ²_W
 *
 * **Mode C "bank_small_wins"** (multiplier m_S on W ≤ τ only):
 *   Z_k = (1 − I_low) · W_k + I_low · m_S · W_k = W_k · (1 + (m_S−1)·I_low)
 *   E[Z]   = p_low · m_S · μ_low + (1−p_low) · μ_high
 *          = μ_W + (m_S − 1) · p_low · μ_low
 *   E[Z²]  = p_low · m_S² · (σ²_low + μ²_low) + (1−p_low) · (σ²_high + μ²_high)
 *   Var[Z] = E[Z²] − E[Z]²
 *   T_C    = Σ_{k} Z_k
 *   E[T_C] = N · E[Z]
 *   Var[T_C] = N · Var[Z]
 *
 * **Disclosure metrics**:
 *   - modeRtps_A/B/C
 *   - bestModeIndex (0=A, 1=B, 2=C) by RTP
 *   - rtpSpread = max − min over modes
 *   - skillPremiumVsUniform = bestMode − meanOverModes
 *   - bonusBankAdditiveOffsetB = E[T_B] − E[T_A] = (m_B−1)·N·μ_W
 *   - bankSmallContributionShareC = (m_S−1)·p_low·μ_low / E[Z] (per-spin share)
 *   - commercialUpliftBVsBaselineA = E[T_B] / E[T_A]
 *   - commercialUpliftCVsBaselineA = E[T_C] / E[T_A]
 *   - perModeStdDev sa N²-quadratic risk for mode B
 *
 * ── Distinct from ──────────────────────────────────────────────────────────
 *   - **P-066 (W097) FS Lookback Multiplier** — POST-HOC max-sum disjoint
 *     segment, ne per-spin bucket banking.
 *   - **P-089 (W188) Player-Elects Feature Composition** — combinatorial m-of-N
 *     mode subset, ne aggregation transformation.
 *   - **P-087 (W186) Big Bet Paid-Package** — paid pre-spin tier, ne post-spin
 *     banking aggregation.
 *   - **P-067 (W150) Voltage Meter K-Tier** — cumulative meter, ne per-spin
 *     bucket gating.
 *   - **P-005/P-014 FS retrigger** — same FS engine ne banking.
 *
 * Compliance:
 *   - **UKGC RTS-12** mandatory player-elected mode RTP disclosure
 *   - **UKGC RTS-14** Bonus Bank transparency (Barcrest UK title)
 *   - **MGA PPD §11** per-mode contribution & banking-offset disclosure
 *   - **eCOGRA** per-mode RTP audit trail
 *   - **EU GA 2024** cross-jurisdiction baseline
 *
 * Naming: "bonus bank", "running balance", "bank wins", "small win bucket"
 * = generic slot-design + UK regulatory terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface BonusBankRunningBalanceOffsetConfig {
  /** Number of FS spins N ≥ 1. */
  numFreeSpins: number;
  /** Overall per-spin variance σ²_W ≥ 0. */
  perSpinVariance: number;
  /** Probability per spin that W ≤ τ (small win bucket) ∈ [0, 1]. */
  probSmallBucket: number;
  /** Conditional mean E[W | W ≤ τ] ≥ 0. */
  smallBucketMean: number;
  /** Conditional variance Var[W | W ≤ τ] ≥ 0. */
  smallBucketVariance: number;
  /** Conditional mean E[W | W > τ] ≥ 0. */
  highBucketMean: number;
  /** Conditional variance Var[W | W > τ] ≥ 0. */
  highBucketVariance: number;
  /** Bank All Wins multiplier m_B ≥ 0 (Mode B). */
  bankAllMultiplier: number;
  /** Bank Small Wins multiplier m_S ≥ 0 (Mode C). */
  bankSmallMultiplier: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface BonusBankRunningBalanceOffsetResult {
  /** Overall per-spin mean μ_W = p_low·μ_low + (1−p_low)·μ_high. */
  perSpinMean: number;
  /** E[T_A] = N·μ_W (Mode A: bank_off_wins, baseline). */
  expectedPayoutModeA: number;
  /** Var[T_A] = N·σ²_W. */
  variancePayoutModeA: number;
  /** Std dev T_A. */
  stdDevPayoutModeA: number;
  /** E[T_B] = m_B·N·μ_W (Mode B: bank_all_wins). */
  expectedPayoutModeB: number;
  /** Var[T_B] = m_B²·N·σ²_W. */
  variancePayoutModeB: number;
  /** Std dev T_B. */
  stdDevPayoutModeB: number;
  /** E[T_C] = N·E[Z] (Mode C: bank_small_wins). */
  expectedPayoutModeC: number;
  /** Var[T_C] = N·Var[Z]. */
  variancePayoutModeC: number;
  /** Std dev T_C. */
  stdDevPayoutModeC: number;
  /** E[Z] per-spin under Mode C. */
  perSpinMeanModeC: number;
  /** Var[Z] per-spin under Mode C. */
  perSpinVarianceModeC: number;
  /** 0 = Mode A best, 1 = Mode B, 2 = Mode C (by RTP). */
  bestModeIndex: number;
  /** Best mode's E[T] payout. */
  bestModeExpectedPayout: number;
  /** Worst mode's E[T]. */
  worstModeExpectedPayout: number;
  /** Best − Worst (E[T] spread). */
  rtpSpread: number;
  /** Best − ⟨A,B,C⟩ (skill-rational premium over flat pick). */
  skillPremiumVsUniform: number;
  /** E[T_B] − E[T_A] = (m_B−1)·N·μ_W (additive offset mode B over baseline). */
  bonusBankAdditiveOffsetB: number;
  /** Per-spin share of Mode C uplift attributable to small-bucket boost. */
  bankSmallContributionShareC: number;
  /** E[T_B] / E[T_A] (multiplicative uplift, undefined → ∞ if baseline=0). */
  commercialUpliftBVsBaselineA: number;
  /** E[T_C] / E[T_A] (multiplicative uplift, undefined → ∞ if baseline=0). */
  commercialUpliftCVsBaselineA: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: BonusBankRunningBalanceOffsetConfig): void {
  if (!Number.isInteger(cfg.numFreeSpins) || cfg.numFreeSpins < 1) {
    throw new Error(`numFreeSpins must be integer ≥ 1, got ${cfg.numFreeSpins}`);
  }
  if (!Number.isFinite(cfg.perSpinVariance) || cfg.perSpinVariance < 0) {
    throw new Error(`perSpinVariance must be ≥ 0, got ${cfg.perSpinVariance}`);
  }
  if (
    !Number.isFinite(cfg.probSmallBucket) ||
    cfg.probSmallBucket < 0 ||
    cfg.probSmallBucket > 1
  ) {
    throw new Error(`probSmallBucket must be ∈ [0, 1], got ${cfg.probSmallBucket}`);
  }
  if (!Number.isFinite(cfg.smallBucketMean) || cfg.smallBucketMean < 0) {
    throw new Error(`smallBucketMean must be ≥ 0, got ${cfg.smallBucketMean}`);
  }
  if (!Number.isFinite(cfg.smallBucketVariance) || cfg.smallBucketVariance < 0) {
    throw new Error(`smallBucketVariance must be ≥ 0, got ${cfg.smallBucketVariance}`);
  }
  if (!Number.isFinite(cfg.highBucketMean) || cfg.highBucketMean < 0) {
    throw new Error(`highBucketMean must be ≥ 0, got ${cfg.highBucketMean}`);
  }
  if (!Number.isFinite(cfg.highBucketVariance) || cfg.highBucketVariance < 0) {
    throw new Error(`highBucketVariance must be ≥ 0, got ${cfg.highBucketVariance}`);
  }
  if (!Number.isFinite(cfg.bankAllMultiplier) || cfg.bankAllMultiplier < 0) {
    throw new Error(`bankAllMultiplier must be ≥ 0, got ${cfg.bankAllMultiplier}`);
  }
  if (!Number.isFinite(cfg.bankSmallMultiplier) || cfg.bankSmallMultiplier < 0) {
    throw new Error(`bankSmallMultiplier must be ≥ 0, got ${cfg.bankSmallMultiplier}`);
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeBonusBankRunningBalanceOffset(
  cfg: BonusBankRunningBalanceOffsetConfig,
): BonusBankRunningBalanceOffsetResult {
  validate(cfg);

  const N = cfg.numFreeSpins;
  const sig2W = cfg.perSpinVariance;
  const pL = cfg.probSmallBucket;
  const muL = cfg.smallBucketMean;
  const v2L = cfg.smallBucketVariance;
  const muH = cfg.highBucketMean;
  const v2H = cfg.highBucketVariance;
  const mB = cfg.bankAllMultiplier;
  const mS = cfg.bankSmallMultiplier;

  // ── Overall per-spin mean (tower property)
  const muW = pL * muL + (1 - pL) * muH;

  // ── Mode A: bank_off_wins (baseline)
  const expectedPayoutModeA = N * muW;
  const variancePayoutModeA = N * sig2W;
  const stdDevPayoutModeA = Math.sqrt(Math.max(0, variancePayoutModeA));

  // ── Mode B: bank_all_wins
  const expectedPayoutModeB = mB * expectedPayoutModeA;
  const variancePayoutModeB = mB * mB * variancePayoutModeA;
  const stdDevPayoutModeB = Math.sqrt(Math.max(0, variancePayoutModeB));

  // ── Mode C: bank_small_wins
  //   E[Z] = p_low · m_S · μ_low + (1 − p_low) · μ_high
  //   E[Z²] = p_low · m_S² · (σ²_low + μ²_low) + (1−p_low) · (σ²_high + μ²_high)
  //   Var[Z] = E[Z²] − E[Z]²
  const perSpinMeanModeC = pL * mS * muL + (1 - pL) * muH;
  const eZ2 =
    pL * mS * mS * (v2L + muL * muL) + (1 - pL) * (v2H + muH * muH);
  const perSpinVarianceModeC = Math.max(0, eZ2 - perSpinMeanModeC * perSpinMeanModeC);
  const expectedPayoutModeC = N * perSpinMeanModeC;
  const variancePayoutModeC = N * perSpinVarianceModeC;
  const stdDevPayoutModeC = Math.sqrt(Math.max(0, variancePayoutModeC));

  // ── Best/worst/spread
  const modePayouts = [expectedPayoutModeA, expectedPayoutModeB, expectedPayoutModeC];
  let bestModeIndex = 0;
  let bestVal = modePayouts[0]!;
  for (let i = 1; i < modePayouts.length; i++) {
    if (modePayouts[i]! > bestVal) {
      bestVal = modePayouts[i]!;
      bestModeIndex = i;
    }
  }
  const worstVal = Math.min(...modePayouts);
  const meanOverModes =
    (expectedPayoutModeA + expectedPayoutModeB + expectedPayoutModeC) / 3;
  const rtpSpread = bestVal - worstVal;
  const skillPremiumVsUniform = bestVal - meanOverModes;

  // ── Disclosure
  const bonusBankAdditiveOffsetB = expectedPayoutModeB - expectedPayoutModeA;
  // Mode C per-spin uplift attributable to small bucket boost
  const smallBoost = (mS - 1) * pL * muL;
  const bankSmallContributionShareC =
    perSpinMeanModeC > 1e-12 ? smallBoost / perSpinMeanModeC : 0;
  const commercialUpliftBVsBaselineA =
    expectedPayoutModeA > 1e-12
      ? expectedPayoutModeB / expectedPayoutModeA
      : Number.POSITIVE_INFINITY;
  const commercialUpliftCVsBaselineA =
    expectedPayoutModeA > 1e-12
      ? expectedPayoutModeC / expectedPayoutModeA
      : Number.POSITIVE_INFINITY;

  return {
    perSpinMean: muW,
    expectedPayoutModeA,
    variancePayoutModeA,
    stdDevPayoutModeA,
    expectedPayoutModeB,
    variancePayoutModeB,
    stdDevPayoutModeB,
    expectedPayoutModeC,
    variancePayoutModeC,
    stdDevPayoutModeC,
    perSpinMeanModeC,
    perSpinVarianceModeC,
    bestModeIndex,
    bestModeExpectedPayout: bestVal,
    worstModeExpectedPayout: worstVal,
    rtpSpread,
    skillPremiumVsUniform,
    bonusBankAdditiveOffsetB,
    bankSmallContributionShareC,
    commercialUpliftBVsBaselineA,
    commercialUpliftCVsBaselineA,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveBonusBankRunningBalanceOffset = analyzeBonusBankRunningBalanceOffset;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateBonusBankRunningBalanceOffset(
  cfg: BonusBankRunningBalanceOffsetConfig,
  numBonusSessions: number,
  seed = 0xface0191,
): {
  meanPayoutModeA: number;
  stdDevPayoutModeA: number;
  meanPayoutModeB: number;
  stdDevPayoutModeB: number;
  meanPayoutModeC: number;
  stdDevPayoutModeC: number;
  observedSmallBucketRate: number;
  observedPerSpinMean: number;
} {
  validate(cfg);
  if (!Number.isInteger(numBonusSessions) || numBonusSessions < 1) {
    throw new Error(`numBonusSessions must be integer ≥ 1, got ${numBonusSessions}`);
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

  const sigL = Math.sqrt(cfg.smallBucketVariance);
  const sigH = Math.sqrt(cfg.highBucketVariance);

  let sumA = 0,
    sumA2 = 0;
  let sumB = 0,
    sumB2 = 0;
  let sumC = 0,
    sumC2 = 0;
  let smallCount = 0;
  let totalSpins = 0;
  let sumPerSpin = 0;

  for (let session = 0; session < numBonusSessions; session++) {
    let TA = 0;
    let TC = 0;
    for (let k = 0; k < cfg.numFreeSpins; k++) {
      const isLow = rng() < cfg.probSmallBucket;
      let W: number;
      if (isLow) {
        W = gaussian(cfg.smallBucketMean, sigL);
        smallCount++;
        TC += cfg.bankSmallMultiplier * W;
      } else {
        W = gaussian(cfg.highBucketMean, sigH);
        TC += W;
      }
      TA += W;
      totalSpins++;
      sumPerSpin += W;
    }
    const TB = cfg.bankAllMultiplier * TA;
    sumA += TA;
    sumA2 += TA * TA;
    sumB += TB;
    sumB2 += TB * TB;
    sumC += TC;
    sumC2 += TC * TC;
  }

  const meanA = sumA / numBonusSessions;
  const varA = Math.max(0, sumA2 / numBonusSessions - meanA * meanA);
  const meanB = sumB / numBonusSessions;
  const varB = Math.max(0, sumB2 / numBonusSessions - meanB * meanB);
  const meanC = sumC / numBonusSessions;
  const varC = Math.max(0, sumC2 / numBonusSessions - meanC * meanC);

  return {
    meanPayoutModeA: meanA,
    stdDevPayoutModeA: Math.sqrt(varA),
    meanPayoutModeB: meanB,
    stdDevPayoutModeB: Math.sqrt(varB),
    meanPayoutModeC: meanC,
    stdDevPayoutModeC: Math.sqrt(varC),
    observedSmallBucketRate: totalSpins > 0 ? smallCount / totalSpins : 0,
    observedPerSpinMean: totalSpins > 0 ? sumPerSpin / totalSpins : 0,
  };
}
