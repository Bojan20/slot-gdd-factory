/**
 * W152 Wave 95 — Ante Bet / Bet Boost Trade-Off Analyzer (Faza 4.8 ext).
 *
 * Closed-form solver za "ante bet" / "bet boost" mehaniku gde igrač
 * može da plati X·(1+a) umesto baseline X za boostovani feature trigger
 * (npr. 2× scatter density za FS) ili boost direktnog payout-a.
 *
 * Industry standard since 2018 (Pragmatic Ante Bet, Wazdan Ante Bet,
 * NetEnt Bet Boost). Operator and regulator both require:
 *   • Per-mode RTP disclosure (UKGC RTS 12 requires every mode listed)
 *   • Variance comparison across modes (MGA PPD §11.f)
 *   • Decision EV: when is ante +EV vs −EV?
 *
 * Naming policy (clean-room): "ante bet", "bet boost", "feature buy
 * boost" = generic industry terms. No vendor-specific implementation.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Two modes: baseline ("no ante") and boosted ("ante").
 *
 * Baseline mode:
 *   stake_0     = 1  (normalized base bet)
 *   μ_0         = E[win per spin]
 *   σ²_0        = Var[win per spin]
 *   RTP_0       = μ_0 / stake_0 = μ_0
 *   E[net_0]    = μ_0 − 1
 *
 * Ante mode:
 *   stake_a     = 1 + a    (a > 0 is ante premium ratio)
 *   μ_a         = E[win per ante spin]    (boosted; provided as input)
 *   σ²_a        = Var[win per ante spin]
 *   RTP_a       = μ_a / (1 + a)
 *   E[net_a]    = μ_a − (1 + a)
 *
 * Decision:
 *   Ante is +EV iff RTP_a > RTP_0   ⟺   μ_a/(1+a) > μ_0
 *   "Boost premium" = (RTP_a − RTP_0) / RTP_0  (relative RTP advantage)
 *
 * After N spins (independent), Wald + linearity:
 *   E[total net base]  = N · (μ_0 − 1)
 *   Var[total net base] = N · σ²_0
 *   E[total net ante]  = N · (μ_a − (1 + a))
 *   Var[total net ante] = N · σ²_a
 *
 * Crossover point: smallest N for which |E[net]| > k·SD[net]:
 *   For base mode (if μ_0 > 1, otherwise −EV):
 *     N* = (k · σ_0 / (μ_0 − 1))²        if μ_0 > 1; else +∞
 *   Similarly for ante.
 *
 * Aggregate operator metric (revenue-weighted):
 *   If fraction f of spins are ante, aggregate stake = f·(1+a) + (1−f)·1,
 *   aggregate win = f·μ_a + (1−f)·μ_0.
 *   Aggregate RTP = (f·μ_a + (1−f)·μ_0) / (f·(1+a) + (1−f))
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateAnteBetTradeOff() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface AnteBetTradeOffConfig {
  /** Baseline expected win per spin (mean payout in stake multiples). */
  baseMeanWinPerSpinX: number;
  /** Baseline variance of win per spin. */
  baseVarianceWinPerSpinX: number;
  /** Ante premium ratio (a > 0). Stake under ante = 1 + a. */
  antePremiumRatio: number;
  /** Boosted expected win per ante spin. */
  anteMeanWinPerSpinX: number;
  /** Boosted variance of win per ante spin. */
  anteVarianceWinPerSpinX: number;
  /** (Optional) Aggregate ante-mode adoption fraction f ∈ [0,1]. */
  anteAdoptionFraction?: number;
}

export interface AnteBetTradeOffResult {
  // Baseline
  baseRtp: number;
  baseHouseEdge: number;
  baseExpectedNetPerSpin: number;
  baseStdNetPerSpin: number;
  // Ante
  anteRtp: number;
  anteHouseEdge: number;
  anteExpectedNetPerSpin: number;
  anteStdNetPerSpin: number;
  anteStake: number;
  // Decision
  anteIsPositiveEV: boolean;
  boostPremium: number;
  /** Smallest N for which |E[net]| > 2·SD[net] (2-sigma confidence). */
  baseCrossover2Sigma: number | null;
  anteCrossover2Sigma: number | null;
  // Aggregate (if adoption fraction provided)
  aggregateRtp: number | null;
  aggregateHouseEdge: number | null;
}

export interface AnteBetTradeOffMCResult {
  spins: number;
  baseTotalWin: number;
  baseTotalStake: number;
  baseObservedRtp: number;
  anteTotalWin: number;
  anteTotalStake: number;
  anteObservedRtp: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: AnteBetTradeOffConfig): void {
  if (!Number.isFinite(cfg.baseMeanWinPerSpinX) || cfg.baseMeanWinPerSpinX < 0) {
    throw new Error(`baseMeanWinPerSpinX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.baseVarianceWinPerSpinX) || cfg.baseVarianceWinPerSpinX < 0) {
    throw new Error(`baseVarianceWinPerSpinX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.antePremiumRatio) || cfg.antePremiumRatio <= 0) {
    throw new Error(`antePremiumRatio must be > 0`);
  }
  if (!Number.isFinite(cfg.anteMeanWinPerSpinX) || cfg.anteMeanWinPerSpinX < 0) {
    throw new Error(`anteMeanWinPerSpinX must be ≥ 0`);
  }
  if (!Number.isFinite(cfg.anteVarianceWinPerSpinX) || cfg.anteVarianceWinPerSpinX < 0) {
    throw new Error(`anteVarianceWinPerSpinX must be ≥ 0`);
  }
  if (cfg.anteAdoptionFraction !== undefined) {
    const f = cfg.anteAdoptionFraction;
    if (!Number.isFinite(f) || f < 0 || f > 1) {
      throw new Error(`anteAdoptionFraction must be in [0, 1]`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveAnteBetTradeOff(
  config: AnteBetTradeOffConfig,
): AnteBetTradeOffResult {
  validate(config);
  const muBase = config.baseMeanWinPerSpinX;
  const sigma2Base = config.baseVarianceWinPerSpinX;
  const a = config.antePremiumRatio;
  const muAnte = config.anteMeanWinPerSpinX;
  const sigma2Ante = config.anteVarianceWinPerSpinX;
  const anteStake = 1 + a;

  // RTPs
  const rtpBase = muBase / 1;
  const rtpAnte = muAnte / anteStake;
  const houseBase = 1 - rtpBase;
  const houseAnte = 1 - rtpAnte;

  // Net per spin
  const eNetBase = muBase - 1;
  const eNetAnte = muAnte - anteStake;
  const sdBase = Math.sqrt(sigma2Base);
  const sdAnte = Math.sqrt(sigma2Ante);

  // Decision
  const anteIsPositive = rtpAnte > rtpBase;
  const boostPremium = rtpBase > 0 ? (rtpAnte - rtpBase) / rtpBase : 0;

  // Crossover: smallest N for which |E[total net]| > 2·SD[total net]
  // E[total net] = N · μ_net, SD[total net] = √N · σ_net
  // Condition: N · |μ_net| > 2·√N·σ_net ⟹ √N > 2σ/|μ| ⟹ N > 4σ²/μ²
  function crossover2(muNet: number, sigma2: number): number | null {
    if (muNet === 0) return null;
    if (sigma2 === 0) return 1;
    return Math.ceil(4 * sigma2 / (muNet * muNet));
  }
  const baseCrossover = crossover2(eNetBase, sigma2Base);
  const anteCrossover = crossover2(eNetAnte, sigma2Ante);

  // Aggregate operator metric (optional)
  let aggregateRtp: number | null = null;
  let aggregateHouseEdge: number | null = null;
  if (config.anteAdoptionFraction !== undefined) {
    const f = config.anteAdoptionFraction;
    const aggregateStake = f * anteStake + (1 - f) * 1;
    const aggregateWin = f * muAnte + (1 - f) * muBase;
    aggregateRtp = aggregateWin / aggregateStake;
    aggregateHouseEdge = 1 - aggregateRtp;
  }

  return {
    baseRtp: rtpBase,
    baseHouseEdge: houseBase,
    baseExpectedNetPerSpin: eNetBase,
    baseStdNetPerSpin: sdBase,
    anteRtp: rtpAnte,
    anteHouseEdge: houseAnte,
    anteExpectedNetPerSpin: eNetAnte,
    anteStdNetPerSpin: sdAnte,
    anteStake,
    anteIsPositiveEV: anteIsPositive,
    boostPremium,
    baseCrossover2Sigma: baseCrossover,
    anteCrossover2Sigma: anteCrossover,
    aggregateRtp,
    aggregateHouseEdge,
  };
}

// ── MC reference solver ────────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePayoutTwoPoint(rng: () => number, mu: number, sigma2: number): number {
  if (mu === 0) return 0;
  if (sigma2 <= 0) return mu;
  const x = mu + sigma2 / mu;
  const probability = (mu * mu) / (mu * mu + sigma2);
  return rng() < probability ? x : 0;
}

export function simulateAnteBetTradeOff(
  config: AnteBetTradeOffConfig,
  spins: number,
  seed: number,
): AnteBetTradeOffMCResult {
  validate(config);
  const rng = makePrng(seed);
  const muBase = config.baseMeanWinPerSpinX;
  const sigma2Base = config.baseVarianceWinPerSpinX;
  const a = config.antePremiumRatio;
  const muAnte = config.anteMeanWinPerSpinX;
  const sigma2Ante = config.anteVarianceWinPerSpinX;
  const anteStake = 1 + a;

  let baseTotalWin = 0;
  let anteTotalWin = 0;
  for (let i = 0; i < spins; i++) {
    baseTotalWin += samplePayoutTwoPoint(rng, muBase, sigma2Base);
    anteTotalWin += samplePayoutTwoPoint(rng, muAnte, sigma2Ante);
  }
  const baseStake = spins * 1;
  const anteStakeTotal = spins * anteStake;

  return {
    spins,
    baseTotalWin,
    baseTotalStake: baseStake,
    baseObservedRtp: baseTotalWin / baseStake,
    anteTotalWin,
    anteTotalStake: anteStakeTotal,
    anteObservedRtp: anteTotalWin / anteStakeTotal,
  };
}
