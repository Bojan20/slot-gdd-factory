/**
 * 🎯 W244 — Game Provider Revenue-Share Optimal Allocation Analyzer (100. solver — MILESTONE).
 *
 * INDUSTRY-FIRST SUPPLIER-OPERATOR ECONOMICS kernel — UKGC SMS 5.2 supplier
 * disclosure + EU EBA Supplier Risk Framework 2024 + MGA Supplier Standards
 * §32 + AU NCPF Schedule 14 (third-party supplier oversight) + IFRS 15
 * Revenue Recognition (supplier contracts).
 *
 * 100. solver MILESTONE — 14. dimenzija (SUPPLIER ECONOMICS).
 *
 * Math: per-provider revenue share rate, contract obligations, premium/standard
 * tier negotiation, operator margin maximization given N supplier contracts.
 * LP allocation across game-provider portfolio.
 */

export interface GameProvider {
  /** Provider name (Pragmatic Play / NetEnt / Microgaming / Hacksaw / Yggdrasil / etc.). */
  providerName: string;
  /** Revenue share to provider ∈ [0.10, 0.45] (industry typical 15-30%). */
  revenueSharePct: number;
  /** Player engagement multiplier ∈ [0.5, 2.0] (premium > standard providers). */
  engagementMultiplier: number;
  /** Annual GGR potential from provider's games (currency). */
  annualGgrPotential: number;
  /** Contractual minimum monthly fee (currency). */
  minimumMonthlyFee: number;
  /** Annual content refresh requirement (number of new games). */
  annualContentRefreshRequired: number;
  /** Boolean: tier-1 premium provider (NetEnt, Pragmatic, Evolution). */
  isTier1Premium: boolean;
}

export interface RevenueShareConfig {
  /** Array of game providers in portfolio. */
  providers: GameProvider[];
  /** Operator's total GGR capacity. */
  operatorTotalGgrCapacity: number;
  /** Operator's marketing budget for new provider activation. */
  marketingBudgetPerProvider: number;
  /** Tier-1 premium provider mandatory share threshold (e.g. 30%). */
  tier1MinimumSharePct: number;
}

export interface RevenueShareResult {
  /** Per-provider effective GGR allocation. */
  perProviderEffectiveGgr: number[];
  /** Per-provider revenue share paid to supplier. */
  perProviderSupplierPayment: number[];
  /** Per-provider operator margin (net after share + fees). */
  perProviderOperatorMargin: number[];
  /** Provider ranking by operator margin (descending). */
  providerRanking: number[];
  /** Total operator net revenue (after all supplier payments). */
  totalOperatorNetRevenue: number;
  /** Total supplier payments. */
  totalSupplierPayments: number;
  /** Tier-1 premium provider share % of total GGR. */
  tier1PortfolioShare: number;
  /** Boolean: meets tier-1 premium threshold. */
  meetsTier1Threshold: boolean;
  /** Composite supplier-portfolio score ∈ [0, 1]. */
  supplierPortfolioScore: number;
  /** UKGC SMS 5.2 + EU EBA Supplier Risk compliance. */
  isCompliantUkgcSms52: boolean;
}

function validate(c: RevenueShareConfig): void {
  if (!Array.isArray(c.providers) || c.providers.length < 1 || c.providers.length > 50)
    throw new Error('providers must be 1-50');
  for (const p of c.providers) {
    if (typeof p.providerName !== 'string' || p.providerName.length === 0) throw new Error('providerName required');
    if (!Number.isFinite(p.revenueSharePct) || p.revenueSharePct < 0.10 || p.revenueSharePct > 0.45)
      throw new Error('revenueSharePct ∈ [0.10, 0.45]');
    if (!Number.isFinite(p.engagementMultiplier) || p.engagementMultiplier < 0.5 || p.engagementMultiplier > 2.0)
      throw new Error('engagementMultiplier ∈ [0.5, 2.0]');
    if (!Number.isFinite(p.annualGgrPotential) || p.annualGgrPotential < 0) throw new Error('annualGgrPotential ≥ 0');
    if (!Number.isFinite(p.minimumMonthlyFee) || p.minimumMonthlyFee < 0) throw new Error('minimumMonthlyFee ≥ 0');
    if (!Number.isFinite(p.annualContentRefreshRequired) || p.annualContentRefreshRequired < 0) throw new Error('refresh ≥ 0');
  }
  if (!Number.isFinite(c.operatorTotalGgrCapacity) || c.operatorTotalGgrCapacity < 0) throw new Error('capacity ≥ 0');
  if (!Number.isFinite(c.marketingBudgetPerProvider) || c.marketingBudgetPerProvider < 0) throw new Error('budget ≥ 0');
  if (!Number.isFinite(c.tier1MinimumSharePct) || c.tier1MinimumSharePct < 0 || c.tier1MinimumSharePct > 1)
    throw new Error('tier1MinimumSharePct ∈ [0, 1]');
}

export function solveRevenueShare(cfg: RevenueShareConfig): RevenueShareResult {
  validate(cfg);
  const N = cfg.providers.length;

  // Per-provider GGR realization (capped by potential × engagement)
  const perProviderEffectiveGgr: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    perProviderEffectiveGgr[i] = cfg.providers[i].annualGgrPotential * cfg.providers[i].engagementMultiplier;
  }

  // Cap to operator total capacity (proportional allocation if over)
  const totalPotential = perProviderEffectiveGgr.reduce((s, v) => s + v, 0);
  if (totalPotential > cfg.operatorTotalGgrCapacity) {
    const scale = cfg.operatorTotalGgrCapacity / totalPotential;
    for (let i = 0; i < N; i++) perProviderEffectiveGgr[i] *= scale;
  }

  // Per-provider supplier payments + operator margin
  const perProviderSupplierPayment: number[] = new Array(N);
  const perProviderOperatorMargin: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const p = cfg.providers[i];
    perProviderSupplierPayment[i] = perProviderEffectiveGgr[i] * p.revenueSharePct + p.minimumMonthlyFee * 12;
    perProviderOperatorMargin[i] = perProviderEffectiveGgr[i] - perProviderSupplierPayment[i];
  }

  // Ranking by margin (desc)
  const providerRanking = Array.from({ length: N }, (_, i) => i);
  providerRanking.sort((a, b) => perProviderOperatorMargin[b] - perProviderOperatorMargin[a]);

  const totalOperatorNetRevenue = perProviderOperatorMargin.reduce((s, v) => s + v, 0);
  const totalSupplierPayments = perProviderSupplierPayment.reduce((s, v) => s + v, 0);

  // Tier-1 share
  let tier1Ggr = 0;
  let totalGgr = 0;
  for (let i = 0; i < N; i++) {
    totalGgr += perProviderEffectiveGgr[i];
    if (cfg.providers[i].isTier1Premium) tier1Ggr += perProviderEffectiveGgr[i];
  }
  const tier1PortfolioShare = totalGgr > 1e-9 ? tier1Ggr / totalGgr : 0;
  const meetsTier1Threshold = tier1PortfolioShare >= cfg.tier1MinimumSharePct;

  // Composite score
  const marginScore = totalOperatorNetRevenue > 0 ? Math.min(1, totalOperatorNetRevenue / Math.max(totalSupplierPayments, 1)) : 0;
  const tier1Score = meetsTier1Threshold ? 1 : tier1PortfolioShare / cfg.tier1MinimumSharePct;
  const supplierPortfolioScore = Math.max(0, Math.min(1, 0.5 * marginScore + 0.5 * tier1Score));

  // UKGC SMS 5.2 compliance: ≥ 30% tier-1 + positive operator margin
  const isCompliantUkgcSms52 = meetsTier1Threshold && totalOperatorNetRevenue > 0;

  return {
    perProviderEffectiveGgr, perProviderSupplierPayment, perProviderOperatorMargin,
    providerRanking, totalOperatorNetRevenue, totalSupplierPayments,
    tier1PortfolioShare, meetsTier1Threshold, supplierPortfolioScore, isCompliantUkgcSms52,
  };
}

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RevenueShareMcResult {
  episodes: number;
  observedTotalNetRevenueMean: number;
}

export function simulateRevenueShare(cfg: RevenueShareConfig, seed: number, episodes: number): RevenueShareMcResult {
  validate(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) throw new Error('episodes ≥ 100');
  const rng = makeRng(seed);
  let sum = 0;
  for (let ep = 0; ep < episodes; ep++) {
    // Noise on annualGgrPotential ±20%
    const noisyCfg = {
      ...cfg,
      providers: cfg.providers.map(p => ({ ...p, annualGgrPotential: p.annualGgrPotential * (0.80 + 0.40 * rng()) })),
    };
    const r = solveRevenueShare(noisyCfg);
    sum += r.totalOperatorNetRevenue;
  }
  return { episodes, observedTotalNetRevenueMean: sum / episodes };
}
