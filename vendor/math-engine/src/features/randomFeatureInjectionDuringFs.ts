/**
 * W152 Wave 189 — Random Feature-Injection During FS Aggregator (70. solver).
 *
 * **L&W M12 P1 GAP CLOSURE** — covers Wizard of Oz Munchkinland + WMS
 * sub-feature library.
 *
 * Iconic random-feature-injection-during-FS mehanika:
 *   * LNW WMS The Wizard of Oz Munchkinland (2014, defining title — random
 *     "Munchkin" appears mid-FS to grant extra spins / wilds / multipliers)
 *   * WMS sub-feature library variants (Tin Man / Cowardly Lion / etc.)
 *
 * **70th closed-form solver.** First kernel modeling **per-FS-spin Bernoulli
 * injection of nested sub-feature** during free spins. Distinct od
 * P-005/P-014 (FS retrigger — adds spins ne sub-feature) i P-076 (W169
 * drop-stick wild — single-grid sticky, ne random per-spin injection).
 *
 * ── Math (Compound Per-FS-Spin Injection) ──────────────────────────────────
 *
 * FS bonus traje N FS spinova. Per FS spin k:
 *   - Base FS payout Y_k ~ iid sa E[Y] = μ_Y, Var[Y] = σ²_Y
 *   - Injection indicator I_k ~ Bernoulli(p_inject) iid
 *   - If injected: sub-feature payout V_k ~ iid sa E[V] = μ_V, Var[V] = σ²_V
 *
 * **Total FS payout**: S = Σ_{k=1..N} (Y_k + I_k · V_k)
 *
 * **Closed-form aggregates**:
 *   E[S] = N · μ_Y + N · p_inject · μ_V
 *   Var[S] = N · σ²_Y + N · p_inject · σ²_V + N · p_inject · (1−p_inject) · μ²_V
 *           (last term: Bernoulli mass on V; total = Var of compound Bernoulli sum)
 *
 * **# injections per FS bonus**: N_inj ~ Binomial(N, p_inject)
 *   E[N_inj] = N · p_inject
 *   Var[N_inj] = N · p_inject · (1−p_inject)
 *
 * **P(at least one injection per FS bonus)** = 1 − (1−p_inject)^N
 * **P(no injection per FS bonus)** = (1−p_inject)^N
 *
 * **Injection contribution share**:
 *   injectionContributionToTotalFs = (N · p_inject · μ_V) / E[S]
 *
 * **Sub-feature uplift ratio**:
 *   commercialUpliftVsBaseFs = E[S] / (N · μ_Y) = 1 + p_inject · μ_V / μ_Y
 *
 * **Top-tier disclosure** (Munchkin "grand" sub-feature variants):
 *   - top-injection probability p_top = π_top weight in sub-feature distribution
 *   - probAllNSpinsTopInjection = (p_inject · π_top)^N (very rare full-bonus jackpot)
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - **P-005/P-014 FS Retrigger** — retrigger adds SPINS, ne sub-feature
 *     payout injection
 *   - **P-066 (W097) FS Lookback Multiplier** — post-hoc multiplier, ne per-spin
 *     injection
 *   - **P-076 (W169) Drop-and-Stick Wild** — single-grid sticky, ne random
 *     per-spin sub-feature
 *   - **P-081 (W179) Sticky Multiplier FS Trail** — accumulator, ne random
 *     per-spin injection
 *   - **P-067 (W150) Voltage Meter Multi-Tier** — single threshold meter,
 *     ne per-spin Bernoulli injection
 *
 * Compliance:
 *   - UKGC RTS-14 (FS sub-feature mechanic disclosure)
 *   - MGA PPD §11 (per-spin injection transparency)
 *   - eCOGRA Generic Slots Audit (FS schedule audit trail)
 *   - EU GA 2024 (cross-jurisdiction baseline)
 *
 * Naming: "random injection", "sub-feature", "FS spin" = generic slot-design
 * terms. No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface RandomFeatureInjectionDuringFsConfig {
  /** Number of FS spins N ≥ 1. */
  numFreeSpins: number;
  /** Mean base FS win per spin (× bet units, ≥ 0). */
  baseFsWinMean: number;
  /** Variance of base FS win (≥ 0). */
  baseFsWinVar: number;
  /** Per-FS-spin probability of sub-feature injection ∈ (0, 1). */
  probInjectionPerFsSpin: number;
  /** Mean sub-feature payout when injected (≥ 0). */
  subFeatureMean: number;
  /** Variance of sub-feature payout (≥ 0). */
  subFeatureVar: number;
  /**
   * Optional top-tier sub-feature share — probability that an injected
   * sub-feature is the rare "grand" variant (e.g. Munchkin grand). Used za
   * top-tier disclosure / rare jackpot frequency.
   */
  topTierSubFeatureShare?: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface RandomFeatureInjectionDuringFsResult {
  /** Expected total FS bonus payout E[S]. */
  expectedTotalFsPayout: number;
  /** Variance Var[S]. */
  varianceTotalFsPayout: number;
  /** Std deviation. */
  stdDevTotalFsPayout: number;
  /** Expected number of injections per FS bonus E[N_inj] = N · p_inject. */
  expectedInjectionsPerFsBonus: number;
  /** Var[N_inj] = N · p_inject · (1−p_inject). */
  varianceInjectionsPerFsBonus: number;
  /** P(at least one injection) = 1 − (1−p_inject)^N. */
  probAtLeastOneInjection: number;
  /** P(no injection) = (1−p_inject)^N. */
  probNoInjection: number;
  /** 1 / P(at least one injection). */
  oneInNFsBonusWithoutInjection: number;
  /** Share of total FS RTP from injection contribution. */
  injectionContributionShareOfFs: number;
  /** Commercial uplift vs base-FS only: E[S] / (N · μ_Y). */
  commercialUpliftVsBaseFs: number;
  /** P(all N spins inject top-tier | topTierSubFeatureShare provided). */
  probAllNSpinsTopTier: number;
  /** Expected base FS subcomponent. */
  expectedBaseFsContribution: number;
  /** Expected injection subcomponent. */
  expectedInjectionContribution: number;
}

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: RandomFeatureInjectionDuringFsConfig): void {
  if (!Number.isInteger(cfg.numFreeSpins) || cfg.numFreeSpins < 1) {
    throw new Error(`numFreeSpins must be integer ≥ 1, got ${cfg.numFreeSpins}`);
  }
  if (!Number.isFinite(cfg.baseFsWinMean) || cfg.baseFsWinMean < 0) {
    throw new Error(`baseFsWinMean must be ≥ 0, got ${cfg.baseFsWinMean}`);
  }
  if (!Number.isFinite(cfg.baseFsWinVar) || cfg.baseFsWinVar < 0) {
    throw new Error(`baseFsWinVar must be ≥ 0, got ${cfg.baseFsWinVar}`);
  }
  if (
    !Number.isFinite(cfg.probInjectionPerFsSpin) ||
    cfg.probInjectionPerFsSpin <= 0 ||
    cfg.probInjectionPerFsSpin >= 1
  ) {
    throw new Error(
      `probInjectionPerFsSpin must be ∈ (0, 1), got ${cfg.probInjectionPerFsSpin}`,
    );
  }
  if (!Number.isFinite(cfg.subFeatureMean) || cfg.subFeatureMean < 0) {
    throw new Error(`subFeatureMean must be ≥ 0, got ${cfg.subFeatureMean}`);
  }
  if (!Number.isFinite(cfg.subFeatureVar) || cfg.subFeatureVar < 0) {
    throw new Error(`subFeatureVar must be ≥ 0, got ${cfg.subFeatureVar}`);
  }
  if (cfg.topTierSubFeatureShare !== undefined) {
    if (
      !Number.isFinite(cfg.topTierSubFeatureShare) ||
      cfg.topTierSubFeatureShare < 0 ||
      cfg.topTierSubFeatureShare > 1
    ) {
      throw new Error(
        `topTierSubFeatureShare must be ∈ [0, 1], got ${cfg.topTierSubFeatureShare}`,
      );
    }
  }
}

/** ── Closed-form analyzer ──────────────────────────────────────────────────── */
export function analyzeRandomFeatureInjectionDuringFs(
  cfg: RandomFeatureInjectionDuringFsConfig,
): RandomFeatureInjectionDuringFsResult {
  validate(cfg);

  const N = cfg.numFreeSpins;
  const muY = cfg.baseFsWinMean;
  const sig2Y = cfg.baseFsWinVar;
  const p = cfg.probInjectionPerFsSpin;
  const muV = cfg.subFeatureMean;
  const sig2V = cfg.subFeatureVar;
  const topShare = cfg.topTierSubFeatureShare ?? 0;

  // ── 1. Total payout aggregates
  const expectedBaseFsContribution = N * muY;
  const expectedInjectionContribution = N * p * muV;
  const expectedTotalFsPayout = expectedBaseFsContribution + expectedInjectionContribution;

  //   Var[S] = N · σ²_Y + N · p · σ²_V + N · p · (1−p) · μ²_V
  const varianceTotalFsPayout = N * sig2Y + N * p * sig2V + N * p * (1 - p) * muV * muV;
  const stdDevTotalFsPayout = Math.sqrt(Math.max(0, varianceTotalFsPayout));

  // ── 2. Injection count
  const expectedInjectionsPerFsBonus = N * p;
  const varianceInjectionsPerFsBonus = N * p * (1 - p);

  // ── 3. P(at least one injection) / P(no injection)
  const probNoInjection = Math.pow(1 - p, N);
  const probAtLeastOneInjection = 1 - probNoInjection;
  const oneInNFsBonusWithoutInjection =
    probAtLeastOneInjection > 1e-15 ? 1 / probAtLeastOneInjection : Number.POSITIVE_INFINITY;

  // ── 4. Injection share & uplift
  const injectionContributionShareOfFs =
    expectedTotalFsPayout > 1e-12 ? expectedInjectionContribution / expectedTotalFsPayout : 0;
  const commercialUpliftVsBaseFs =
    expectedBaseFsContribution > 1e-12
      ? expectedTotalFsPayout / expectedBaseFsContribution
      : Number.POSITIVE_INFINITY;

  // ── 5. Top-tier all-N
  const probAllNSpinsTopTier = Math.pow(p * topShare, N);

  return {
    expectedTotalFsPayout,
    varianceTotalFsPayout,
    stdDevTotalFsPayout,
    expectedInjectionsPerFsBonus,
    varianceInjectionsPerFsBonus,
    probAtLeastOneInjection,
    probNoInjection,
    oneInNFsBonusWithoutInjection,
    injectionContributionShareOfFs,
    commercialUpliftVsBaseFs,
    probAllNSpinsTopTier,
    expectedBaseFsContribution,
    expectedInjectionContribution,
  };
}

/** Alias for portfolio runner naming convention. */
export const solveRandomFeatureInjectionDuringFs = analyzeRandomFeatureInjectionDuringFs;

/** ── Monte Carlo cross-validation ──────────────────────────────────────────── */
export function simulateRandomFeatureInjectionDuringFs(
  cfg: RandomFeatureInjectionDuringFsConfig,
  numFsBonusRuns: number,
  seed = 0xface0189,
): {
  meanTotalFsPayout: number;
  stdDevTotalFsPayout: number;
  meanInjectionsPerBonus: number;
  observedProbAtLeastOneInjection: number;
} {
  validate(cfg);
  if (!Number.isInteger(numFsBonusRuns) || numFsBonusRuns < 1) {
    throw new Error(`numFsBonusRuns must be integer ≥ 1, got ${numFsBonusRuns}`);
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
  const sigY = Math.sqrt(cfg.baseFsWinVar);
  const sigV = Math.sqrt(cfg.subFeatureVar);

  let sumS = 0;
  let sumS2 = 0;
  let sumInj = 0;
  let countAtLeastOne = 0;
  for (let r = 0; r < numFsBonusRuns; r++) {
    let s_total = 0;
    let inj = 0;
    for (let k = 0; k < cfg.numFreeSpins; k++) {
      s_total += gaussian(cfg.baseFsWinMean, sigY);
      if (rng() < cfg.probInjectionPerFsSpin) {
        s_total += gaussian(cfg.subFeatureMean, sigV);
        inj++;
      }
    }
    sumS += s_total;
    sumS2 += s_total * s_total;
    sumInj += inj;
    if (inj > 0) countAtLeastOne++;
  }
  const meanS = sumS / numFsBonusRuns;
  const varS = Math.max(0, sumS2 / numFsBonusRuns - meanS * meanS);
  return {
    meanTotalFsPayout: meanS,
    stdDevTotalFsPayout: Math.sqrt(varS),
    meanInjectionsPerBonus: sumInj / numFsBonusRuns,
    observedProbAtLeastOneInjection: countAtLeastOne / numFsBonusRuns,
  };
}
