/**
 * W152 Wave 181 — Reel-Bound Mystery Progressive Analyzer (62. solver).
 *
 * **L&W M5 GAP CLOSURE** — covers 8+ L&W titles iz Quick Hit family.
 *
 * Iconic Quick Hit reel-bound progressive mehanika:
 *   * SG Gaming Quick Hit Platinum (5-tier: Mini/Minor/Major/Grand/Super)
 *   * Quick Hit Black Gold (5-tier sa Black Gold cap)
 *   * Quick Hit Pro (9-tier extended ladder)
 *   * Quick Hit Wild (sa Wild substitution)
 *   * Quick Hit Blitz (high-vol variant)
 *   * Quick Hit Cash Wheel (kombinovan sa wheel bonus)
 *   * Triple Cash Wheel
 *   * Bally Smokin' 7s (Quick Hit dependent re-skin)
 *
 * **62nd closed-form solver, post-60-milestone.** First kernel modeling
 * **per-reel scatter-presence Bernoulli sa adjacency-reel-count tier mapping**
 * gde tier triggers iff PRVIH k reelova svi imaju Quick Hit symbol
 * (left-to-right anchored, ne arbitrary k-of-R).
 *
 * ── Math (Independent-Reel Bernoulli Adjacency Cascade) ─────────────────────
 *
 * R reels. Per reel i: P(at least one Quick Hit symbol present) = p_i
 * (independent across reels, derived iz scatter symbol weight per reel).
 *
 * **Anchored left-to-right tier**: tier T_k triggers iff reels 1..k all
 * show at least one Quick Hit AND reel k+1 (if exists) does NOT.
 *
 *   P(prefix_k) = ∏_{i=1..k} p_i  (all first k reels show QH)
 *   P(tier_k) = P(prefix_k) − P(prefix_{k+1})  for k < R_max
 *   P(tier_R_max) = P(prefix_R_max)             (top tier, all reels)
 *
 * **Tier-specific payouts** prize_k (in × bet) sa per-tier mapping
 * (tier_3 → mini, tier_4 → minor, tier_5 → major, etc.).
 *
 *   E[payout per spin] = Σ_{k=k_min..R} P(tier_k) · prize_k
 *   RTP contribution = E[payout per spin] (already in × bet units)
 *
 * **Disclosure metrics**:
 *   - oneInNSpinsTier_k = 1 / P(tier_k)  (regulator "1 in X" form)
 *   - tierBreakdown[] sa per-tier prob + payout + RTP-share
 *   - effectiveTopTierFreq = P(top tier)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-035 (W075) Multi-tier WAP Jackpot + Wheel** — wheel-trigger Markov,
 *     ne per-reel Bernoulli cascade
 *   - **P-051 (W091) Coin Accumulator Mystery** — unconditional value-sum,
 *     ne tiered adjacency
 *   - **P-033 (W071) Must-Hit-By Mystery Progressive** — single-pool seed-cap
 *     uniform draw, ne per-reel
 *   - **P-034 (W072) Pseudo-Must-Hit Level Progression** — escalating-hazard
 *     pool sa Markov, ne reel-bound
 *   - **W091 Coin Accumulator + Mystery** — Wald-compound count, ne adjacency
 *
 * Compliance:
 *   - UKGC RTS 12 (progressive jackpot disclosure, per-tier hit frequency)
 *   - MGA PPD §11 (mystery progressive transparency)
 *   - GLI-19 §3.4 (progressive contribution audit trail)
 *   - NIGC 25 CFR 542.7(c) (Class III mystery progressive)
 *
 * Naming: "reel-bound mystery progressive", "Quick Hit family" = generic
 * slot-design terms iz L&W public documentation. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface ReelBoundMysteryProgressiveConfig {
  /** Number of reels R (typically 5; Quick Hit Pro supports 9). */
  numReels: number;
  /**
   * Per-reel probability that ≥1 Quick Hit symbol lands on the reel
   * (length === numReels). Derived iz reel strip weight + visible window.
   */
  perReelScatterPresenceProb: number[];
  /**
   * Minimum tier k_min (typically 3 — 3 reels = mini tier).
   * Tier triggers only for k ∈ [k_min, R].
   */
  minTier: number;
  /**
   * Tier payouts u × bet units, indexed [k_min..R].
   * Length must equal (R − k_min + 1).
   */
  tierPayouts: number[];
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface ReelBoundMysteryProgressiveResult {
  /** Per-tier breakdown sa probability + payout + RTP-share + 1-in-N. */
  tierBreakdown: {
    tier: number;
    prefixProb: number;
    tierProb: number;
    payoutX: number;
    rtpShare: number;
    oneInNSpins: number;
  }[];
  /** E[payout per spin] aggregate (RTP contribution u × bet units). */
  expectedPayoutPerSpin: number;
  /** P(top-tier hit) = P(all reels show QH). */
  topTierProb: number;
  /** 1 / P(top-tier hit) — regulator disclosure form. */
  oneInNSpinsTopTier: number;
  /** Effective P(ANY tier triggered) = P(at least k_min reels show QH). */
  anyTierTriggerProb: number;
  /** 1 / P(any tier). */
  oneInNSpinsAnyTier: number;
  /** Max possible payout (top tier prize). */
  maxPayoutX: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: ReelBoundMysteryProgressiveConfig): void {
  if (
    !Number.isFinite(cfg.numReels) ||
    cfg.numReels < 2 ||
    !Number.isInteger(cfg.numReels)
  ) {
    throw new Error(`numReels must be integer ≥ 2, got ${cfg.numReels}`);
  }
  if (
    !Array.isArray(cfg.perReelScatterPresenceProb) ||
    cfg.perReelScatterPresenceProb.length !== cfg.numReels
  ) {
    throw new Error(
      `perReelScatterPresenceProb length must equal numReels (${cfg.numReels}), got ${cfg.perReelScatterPresenceProb?.length}`,
    );
  }
  for (const p of cfg.perReelScatterPresenceProb) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`perReelScatterPresenceProb entries must be in [0, 1], got ${p}`);
    }
  }
  if (
    !Number.isFinite(cfg.minTier) ||
    cfg.minTier < 2 ||
    cfg.minTier > cfg.numReels ||
    !Number.isInteger(cfg.minTier)
  ) {
    throw new Error(
      `minTier must be integer in [2, numReels=${cfg.numReels}], got ${cfg.minTier}`,
    );
  }
  const expectedTierCount = cfg.numReels - cfg.minTier + 1;
  if (!Array.isArray(cfg.tierPayouts) || cfg.tierPayouts.length !== expectedTierCount) {
    throw new Error(
      `tierPayouts length must equal numReels − minTier + 1 (${expectedTierCount}), got ${cfg.tierPayouts?.length}`,
    );
  }
  for (const v of cfg.tierPayouts) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`tierPayouts entries must be ≥ 0, got ${v}`);
    }
  }
}

/** ── Main analyzer ───────────────────────────────────────────────────────── */
export function analyzeReelBoundMysteryProgressive(
  cfg: ReelBoundMysteryProgressiveConfig,
): ReelBoundMysteryProgressiveResult {
  validate(cfg);

  const R = cfg.numReels;
  const kMin = cfg.minTier;
  const probs = cfg.perReelScatterPresenceProb;
  const payouts = cfg.tierPayouts;

  // Build prefix product table: prefixProb[k] = ∏_{i=0..k-1} probs[i]
  // (i.e. "prob that first k reels all show QH")
  const prefixProb = new Array<number>(R + 2).fill(0);
  prefixProb[0] = 1; // empty prefix
  for (let k = 1; k <= R; k++) {
    prefixProb[k] = prefixProb[k - 1] * probs[k - 1];
  }
  prefixProb[R + 1] = 0; // "prefix of R+1 reels" impossible

  // tierProb[k] = P(exactly k reels prefix QH) for k ∈ [kMin, R]
  // = prefixProb[k] − prefixProb[k+1] for k < R
  // = prefixProb[R] for k = R
  const tierBreakdown: ReelBoundMysteryProgressiveResult['tierBreakdown'] = [];
  let totalExpectedPayout = 0;

  for (let k = kMin; k <= R; k++) {
    const pk = k === R ? prefixProb[R] : prefixProb[k] - prefixProb[k + 1];
    const idx = k - kMin;
    const payoutX = payouts[idx];
    const rtpShare = pk * payoutX;
    totalExpectedPayout += rtpShare;
    tierBreakdown.push({
      tier: k,
      prefixProb: prefixProb[k],
      tierProb: pk,
      payoutX,
      rtpShare,
      oneInNSpins: pk > 1e-15 ? 1 / pk : Number.POSITIVE_INFINITY,
    });
  }

  const topTierProb = prefixProb[R];
  const anyTierProb = prefixProb[kMin];

  return {
    tierBreakdown,
    expectedPayoutPerSpin: totalExpectedPayout,
    topTierProb,
    oneInNSpinsTopTier: topTierProb > 1e-15 ? 1 / topTierProb : Number.POSITIVE_INFINITY,
    anyTierTriggerProb: anyTierProb,
    oneInNSpinsAnyTier: anyTierProb > 1e-15 ? 1 / anyTierProb : Number.POSITIVE_INFINITY,
    maxPayoutX: payouts[payouts.length - 1],
  };
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solveReelBoundMysteryProgressive = analyzeReelBoundMysteryProgressive;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateReelBoundMysteryProgressive(
  cfg: ReelBoundMysteryProgressiveConfig,
  numSpins: number,
  seed = 0xface0181,
): {
  observedExpectedPayoutPerSpin: number;
  observedTierFreqs: { tier: number; observedProb: number }[];
  observedTopTierProb: number;
  observedAnyTierTriggerProb: number;
} {
  validate(cfg);
  if (!Number.isFinite(numSpins) || numSpins < 1 || !Number.isInteger(numSpins)) {
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

  const R = cfg.numReels;
  const kMin = cfg.minTier;
  const probs = cfg.perReelScatterPresenceProb;
  const payouts = cfg.tierPayouts;
  const tierCount = R - kMin + 1;
  const tierCounts = new Array<number>(tierCount).fill(0);
  let sumPayout = 0;
  let topTierCount = 0;
  let anyTierCount = 0;

  for (let spin = 0; spin < numSpins; spin++) {
    // Determine longest left-anchored prefix of reels that show QH
    let prefixLen = 0;
    for (let i = 0; i < R; i++) {
      if (rng() < probs[i]) {
        prefixLen++;
      } else {
        break;
      }
    }
    // Determine tier triggered (prefixLen ≥ kMin → tier = prefixLen)
    if (prefixLen >= kMin) {
      const tier = prefixLen;
      const idx = tier - kMin;
      tierCounts[idx]++;
      sumPayout += payouts[idx];
      anyTierCount++;
      if (tier === R) topTierCount++;
    }
  }

  return {
    observedExpectedPayoutPerSpin: sumPayout / numSpins,
    observedTierFreqs: tierCounts.map((c, i) => ({
      tier: kMin + i,
      observedProb: c / numSpins,
    })),
    observedTopTierProb: topTierCount / numSpins,
    observedAnyTierTriggerProb: anyTierCount / numSpins,
  };
}
