/**
 * W152 Wave 130 — Free Spins Buy + Tier Escalation Trade-Off Analyzer (Faza 4.8 ext, post-W100).
 *
 * Closed-form decision-math solver za "buy bonus / feature buy sa multiple
 * tiers" mehaniku — Pragmatic Big Bass family (Bigger Bass, Bass Bonanza
 * Megaways sa Super Bonus Buy) / Hacksaw Money Hunt tiers (66x/100x/150x) /
 * Push Gaming Razor Shark 50x Buy / Nolimit City Mental Bonus Buy + xWays
 * Buy / Stakelogic Megaways Bonus Buy. Operator nudi multiple price tiers,
 * svaki sa different feature variant; igrač bira tier ili skip.
 *
 * Naming policy (clean-room): "feature buy", "tier", "buy bonus" = generic
 * industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W95 Ante Bet Trade-Off — SINGLE ante per-spin (not multi-tier buy)
 *   • W110 Bonus Trigger Wait Time — waits for FREE trigger
 *   • W107 Pick Bonus N-Stage — single bonus, no buy tier choice
 *   • W118 Bonus Collect-N — threshold collector
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Base game: per-spin RTP_b = baseRtp (no buy), Var_b = baseVariance
 * Tiers t = 1..T: per-tier buyCostX_t, expectedReturnX_t, varianceReturnX_t
 *
 * Per-tier metrics:
 *   • RTP_t        = expectedReturnX_t / buyCostX_t
 *   • net edge_t   = RTP_t − 1 (positive means +EV for player)
 *   • σ_t          = √varianceReturnX_t
 *   • σ_relative_t = σ_t / buyCostX_t
 *   • Sharpe-like_t = (RTP_t − 1) / σ_relative_t (risk-adjusted edge)
 *
 * Decision modes (operator/regulator disclosure):
 *   • max-EV:       argmax_t RTP_t              (best edge)
 *   • max-volatility: argmax_t σ_relative_t     (volatility hunter)
 *   • max-Sharpe:    argmax_t Sharpe-like_t     (risk-adjusted best)
 *   • max-payout:   argmax_t max_payout_t      (jackpot hunter)
 *
 * Vs base game (no buy) comparison:
 *   uplift_t       = (RTP_t − RTP_b) · buyCostX_t (absolute uplift in betX)
 *   premium_t      = (RTP_t − RTP_b) / RTP_b · 100 (% relative)
 *   isPositiveEV_t = RTP_t > RTP_b  (player advantage vs base)
 *
 * Adoption-weighted aggregate:
 *   Given per-tier adoption fractions f_t (Σ f_t + f_base = 1):
 *   weighted_RTP = f_base · RTP_b + Σ_t f_t · RTP_t
 *   weighted_revenue_per_unit = base + Σ tier purchases (operator analytics)
 *
 * 2-sigma crossover N* (estimate spins/episodes until edge dominates noise):
 *   N* = 4 · σ_relative² / (RTP - 1)²    (when RTP ≠ 1)
 *   = ∞ when RTP = 1 (no edge → cannot dominate noise)
 *
 * Industry compliance:
 *   • UKGC RTS 14 — per-tier RTP disclosure required
 *   • MGA PPD §11.f — operator buy-bonus tier transparency
 *   • Australian NCRG — Bonus Buy ban (must compute "ban impact" = lost RTP)
 *   • Belgian regulator — Bonus Buy ban; same impact metric
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateFreeSpinsBuyTier() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface BuyTierConfig {
  /** Tier label (e.g. 'basic', 'super', 'mega'). */
  label: string;
  /** Cost as multiplier of base bet (e.g. 100 = 100×bet). */
  buyCostX: number;
  /** Expected return E[Y | purchased] (in betX units). */
  expectedReturnX: number;
  /** Variance of return Var[Y | purchased] (in betX² units). */
  varianceReturnX: number;
  /** Max payout (top-prize cap, in betX units). */
  maxPayoutX?: number;
}

export interface FreeSpinsBuyTierTradeOffConfig {
  /** Base-game RTP (per spin, no buy). */
  baseRtp: number;
  /** Base-game variance per spin. */
  baseVariance: number;
  /** Tier configurations (length ≥ 1). */
  tiers: BuyTierConfig[];
  /** Optional adoption fractions per tier + base (must sum to 1, omitted = uniform). */
  adoptionFractions?: { base: number; tiers: number[] };
}

export interface PerTierTradeOffStats {
  label: string;
  buyCostX: number;
  expectedReturnX: number;
  varianceReturnX: number;
  rtp: number;
  netEdge: number;
  stdReturnX: number;
  stdRelative: number;
  sharpeRatio: number;
  upliftVsBase: number;
  premiumVsBase: number;
  isPositiveEvVsBase: boolean;
  twoSigmaCrossoverN: number; // can be Infinity
  maxPayoutX?: number;
}

export interface FreeSpinsBuyTierTradeOffResult {
  baseRtp: number;
  baseVariance: number;
  perTier: PerTierTradeOffStats[];
  // Decision-mode picks
  argmaxRtpTier: string;
  argmaxVolatilityTier: string;
  argmaxSharpeTier: string;
  argmaxPayoutTier: string;
  // Adoption-weighted
  weightedRtp?: number;
  weightedRevenuePerUnit?: number; // base 1 + Σ tier costs · f_t
  // Compliance — Bonus Buy ban impact
  bonusBuyBanImpactPercent: number; // RTP loss if banned (assumes all buy-RTP lost)
}

export interface FreeSpinsBuyTierTradeOffMCResult {
  trials: number;
  perTierObservedRtp: number[];
  perTierObservedVariance: number[];
  bestTierObservedRtp: { tier: string; rtp: number };
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: FreeSpinsBuyTierTradeOffConfig): void {
  if (!Number.isFinite(cfg.baseRtp) || cfg.baseRtp <= 0 || cfg.baseRtp > 2) {
    throw new Error(`baseRtp must be in (0, 2] (got ${cfg.baseRtp})`);
  }
  if (!Number.isFinite(cfg.baseVariance) || cfg.baseVariance < 0) {
    throw new Error(`baseVariance must be ≥ 0 (got ${cfg.baseVariance})`);
  }
  if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) {
    throw new Error(`tiers must be non-empty`);
  }
  const seenLabel = new Set<string>();
  for (const t of cfg.tiers) {
    if (typeof t.label !== 'string' || t.label.length === 0) {
      throw new Error(`tier.label must be non-empty string`);
    }
    if (seenLabel.has(t.label)) throw new Error(`tiers: duplicate label ${t.label}`);
    seenLabel.add(t.label);
    if (!Number.isFinite(t.buyCostX) || t.buyCostX <= 0) {
      throw new Error(`tier ${t.label}: buyCostX must be > 0 (got ${t.buyCostX})`);
    }
    if (!Number.isFinite(t.expectedReturnX) || t.expectedReturnX < 0) {
      throw new Error(`tier ${t.label}: expectedReturnX must be ≥ 0`);
    }
    if (!Number.isFinite(t.varianceReturnX) || t.varianceReturnX < 0) {
      throw new Error(`tier ${t.label}: varianceReturnX must be ≥ 0`);
    }
    if (t.maxPayoutX !== undefined && (!Number.isFinite(t.maxPayoutX) || t.maxPayoutX < 0)) {
      throw new Error(`tier ${t.label}: maxPayoutX must be ≥ 0`);
    }
  }
  if (cfg.adoptionFractions !== undefined) {
    const a = cfg.adoptionFractions;
    if (a.tiers.length !== cfg.tiers.length) {
      throw new Error(`adoptionFractions.tiers length must match tiers length`);
    }
    let sum = a.base;
    for (const f of a.tiers) {
      if (!Number.isFinite(f) || f < 0 || f > 1) {
        throw new Error(`adoptionFractions entries must be in [0, 1]`);
      }
      sum += f;
    }
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`adoptionFractions must sum to 1 (got ${sum})`);
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveFreeSpinsBuyTierTradeOff(
  config: FreeSpinsBuyTierTradeOffConfig,
): FreeSpinsBuyTierTradeOffResult {
  validate(config);
  const RTP_b = config.baseRtp;

  const perTier: PerTierTradeOffStats[] = config.tiers.map((t) => {
    const rtp = t.expectedReturnX / t.buyCostX;
    const netEdge = rtp - 1;
    const stdReturn = Math.sqrt(t.varianceReturnX);
    const stdRel = stdReturn / t.buyCostX;
    const sharpe = stdRel > 1e-12 ? netEdge / stdRel : netEdge > 0 ? Infinity : 0;
    const uplift = (rtp - RTP_b) * t.buyCostX;
    const premium = ((rtp - RTP_b) / RTP_b) * 100;
    const isPositive = rtp > RTP_b;
    // 2-sigma crossover: N* = 4σ_rel² / (RTP - 1)² (when edge against fair)
    const edge = rtp - 1;
    const twoSigmaN = Math.abs(edge) > 1e-12
      ? (4 * stdRel * stdRel) / (edge * edge)
      : Infinity;
    return {
      label: t.label,
      buyCostX: t.buyCostX,
      expectedReturnX: t.expectedReturnX,
      varianceReturnX: t.varianceReturnX,
      rtp,
      netEdge,
      stdReturnX: stdReturn,
      stdRelative: stdRel,
      sharpeRatio: sharpe,
      upliftVsBase: uplift,
      premiumVsBase: premium,
      isPositiveEvVsBase: isPositive,
      twoSigmaCrossoverN: twoSigmaN,
      maxPayoutX: t.maxPayoutX,
    };
  });

  // Decision-mode picks
  let argMaxRtp = perTier[0].label;
  let argMaxVol = perTier[0].label;
  let argMaxSharpe = perTier[0].label;
  let argMaxPayout = perTier[0].label;
  let bestRtp = perTier[0].rtp;
  let bestVol = perTier[0].stdRelative;
  let bestSharpe = perTier[0].sharpeRatio;
  let bestPayout = perTier[0].maxPayoutX ?? -Infinity;
  for (let i = 1; i < perTier.length; i++) {
    const p = perTier[i];
    if (p.rtp > bestRtp) { bestRtp = p.rtp; argMaxRtp = p.label; }
    if (p.stdRelative > bestVol) { bestVol = p.stdRelative; argMaxVol = p.label; }
    if (p.sharpeRatio > bestSharpe) { bestSharpe = p.sharpeRatio; argMaxSharpe = p.label; }
    const mp = p.maxPayoutX ?? -Infinity;
    if (mp > bestPayout) { bestPayout = mp; argMaxPayout = p.label; }
  }

  // Adoption-weighted aggregate
  let weightedRtp: number | undefined;
  let weightedRevenue: number | undefined;
  if (config.adoptionFractions) {
    const f = config.adoptionFractions;
    weightedRtp = f.base * RTP_b;
    weightedRevenue = f.base * 1; // base spin costs 1 unit
    for (let i = 0; i < perTier.length; i++) {
      weightedRtp += f.tiers[i] * perTier[i].rtp;
      weightedRevenue += f.tiers[i] * perTier[i].buyCostX;
    }
  }

  // Bonus Buy ban impact: assume bans remove all buy purchases.
  // Players default to base, so per-player aggregate RTP loss = weighted_buy_premium.
  // If no adoption provided, assume 100% would buy max-EV tier.
  let banImpactPct = 0;
  if (config.adoptionFractions) {
    const f = config.adoptionFractions;
    let totalBuyRtp = 0;
    let totalBuyFrac = 0;
    for (let i = 0; i < perTier.length; i++) {
      totalBuyRtp += f.tiers[i] * perTier[i].rtp;
      totalBuyFrac += f.tiers[i];
    }
    if (totalBuyFrac > 1e-12) {
      const avgBuyRtp = totalBuyRtp / totalBuyFrac;
      banImpactPct = ((avgBuyRtp - RTP_b) / RTP_b) * 100;
    }
  } else {
    // Default: max-EV tier counterfactual
    const best = perTier.find((t) => t.label === argMaxRtp)!;
    banImpactPct = ((best.rtp - RTP_b) / RTP_b) * 100;
  }

  return {
    baseRtp: RTP_b,
    baseVariance: config.baseVariance,
    perTier,
    argmaxRtpTier: argMaxRtp,
    argmaxVolatilityTier: argMaxVol,
    argmaxSharpeTier: argMaxSharpe,
    argmaxPayoutTier: argMaxPayout,
    weightedRtp,
    weightedRevenuePerUnit: weightedRevenue,
    bonusBuyBanImpactPercent: banImpactPct,
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

/**
 * MC sample per-tier returns from N(μ_t, σ_t²) Gaussian (approximation —
 * actual return distributions are skewed; this MC only verifies CF moment
 * calculations, not actual game-distribution sampling).
 */
function gaussianSample(rng: () => number, mu: number, sigma: number): number {
  // Box-Muller
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mu + sigma * z);
}

export function simulateFreeSpinsBuyTierTradeOff(
  config: FreeSpinsBuyTierTradeOffConfig,
  trials: number,
  seed: number,
): FreeSpinsBuyTierTradeOffMCResult {
  validate(config);
  const rng = makePrng(seed);
  const perTierSums: number[] = new Array<number>(config.tiers.length).fill(0);
  const perTierSumsSq: number[] = new Array<number>(config.tiers.length).fill(0);

  for (let i = 0; i < config.tiers.length; i++) {
    const t = config.tiers[i];
    const sigma = Math.sqrt(t.varianceReturnX);
    for (let j = 0; j < trials; j++) {
      const r = gaussianSample(rng, t.expectedReturnX, sigma);
      perTierSums[i] += r;
      perTierSumsSq[i] += r * r;
    }
  }

  const perTierObservedRtp: number[] = [];
  const perTierObservedVariance: number[] = [];
  let bestTierLabel = config.tiers[0].label;
  let bestRtp = -Infinity;
  for (let i = 0; i < config.tiers.length; i++) {
    const mean = perTierSums[i] / trials;
    const variance = Math.max(0, perTierSumsSq[i] / trials - mean * mean);
    const rtp = mean / config.tiers[i].buyCostX;
    perTierObservedRtp.push(rtp);
    perTierObservedVariance.push(variance);
    if (rtp > bestRtp) {
      bestRtp = rtp;
      bestTierLabel = config.tiers[i].label;
    }
  }

  return {
    trials,
    perTierObservedRtp,
    perTierObservedVariance,
    bestTierObservedRtp: { tier: bestTierLabel, rtp: bestRtp },
  };
}
