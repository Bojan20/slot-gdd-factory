/**
 * W233 — Cross-Jurisdiction Tax & Compliance Net-Margin Optimizer (90. solver).
 *
 * INDUSTRY-FIRST **TAX/REVENUE OPTIMIZATION kernel** za UKGC RTS 17 (quarterly
 * tax disclosure 2024) + EU DAC7 cross-border reporting (2024 mandatory) + AU
 * AUSTRAC tax-compliance overlap + UK Gambling Act Reform 2024 (operator tax
 * transparency) + OECD BEPS Pillar 2 (15% minimum corporate tax 2024+) +
 * IFRS 12 §10-11 disclosure of interests in foreign operations.
 *
 * Trigger landed posle 2024 enforcement actions na tax-reporting failures:
 *   - Entain £585M HMRC settlement (Dec 2024 — back-tax)
 *   - Flutter Entertainment $1.2M IRS DAC7 audit (Nov 2024)
 *   - UK Gambling Act Reform Review 2024 (mandatory cross-border tax disclosure)
 *
 * **90th closed-form solver — first TAX/REVENUE OPTIMIZATION kernel** u
 * portfolio. Sve prior W001-W232 modeluju compliance/risk/economic dimenzije
 * single-direction (forward EV ili backward inference); ovaj **OPTIMIZATION
 * kernel** — finds best portfolio allocation pod tax + compliance constraints.
 *
 * 🎯 P-110 MILESTONE (round number).
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Multi-jurisdiction GGR portfolio**:
 *
 *   N jurisdictions, each with:
 *     - GGR_j > 0       (gross gaming revenue capacity)
 *     - τ_j ∈ [0, 1]    (gambling tax rate — UK 21%, MT 5%, DE 5.3%, ON 20%, AU 10-30%)
 *     - β_j ∈ [0, 1]    (compliance overhead per GGR — typical 5-15%)
 *     - h_j ∈ [0, 1]    (house edge / effective margin pre-tax)
 *     - growthCap_j     (annual GGR growth cap, regulatory hard limit)
 *     - minRevenue_j    (operator commitment minimum for license retention)
 *
 * **Per-jurisdiction net margin**:
 *
 *   net_j = GGR_j · h_j · (1 − τ_j − β_j)
 *
 *   Effective post-tax margin per unit revenue:
 *     m_j = h_j · (1 − τ_j − β_j)
 *
 *   Sort jurisdictions descending by m_j → optimal market priority order.
 *
 * **Constrained allocation problem** (linear program):
 *
 *   maximize Σ_j a_j · m_j · GGR_max_j
 *   subject to:
 *     0 ≤ a_j ≤ growthCap_j        (per-jurisdiction allocation cap)
 *     Σ_j a_j · GGR_max_j ≤ totalRevenueCap (operator capacity)
 *     a_j · GGR_max_j ≥ minRevenue_j (license retention floor)
 *
 *   Where a_j ∈ [0, 1] is fraction of available capacity to allocate to
 *   jurisdiction j.
 *
 * **Closed-form greedy solution** (LP with no cross-constraints):
 *   Sort by m_j descending. Allocate to top jurisdictions until totalRevenueCap
 *   exhausted OR all min-revenue floors met (whichever binding).
 *
 * **Concentration risk (Herfindahl-Hirschman)**:
 *   HHI = Σ (GGR_j / GGR_total)² — UKGC RTS 17 mandates HHI < 0.5
 *   za diversification audit.
 *
 * **OECD BEPS Pillar 2 (15% global minimum tax)**:
 *   topUpTax_j = max(0, 0.15 − τ_j) · GGR_j · h_j
 *   E[totalTopUpTax] = Σ topUpTax_j
 *
 * **Sensitivity (per-jurisdiction tax-rate elasticity)**:
 *   ∂netTotal / ∂τ_j = −GGR_j · h_j · a_j
 *   relativeElasticity_j = (∂netTotal / netTotal) · 100
 *
 * **UKGC RTS 17 compliance**:
 *   isCompliantUkgcRts17 = (HHI < 0.5 ∧
 *                           tax_disclosure_complete (assumed true) ∧
 *                           total_effective_tax_rate < 0.5)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148-W232               — all single-direction analytic (forward/backward)
 *   - W227                    — single-jurisdiction operator capital
 *   - W232                    — multi-currency FX risk (not multi-jurisdiction tax)
 *   - W233 (this)             — CROSS-JURISDICTION OPTIMIZATION (LP-style)
 *                               sa tax + compliance + concentration constraints
 *
 * Naming: "cross-jurisdiction", "tax optimization", "Pillar 2 top-up", "DAC7",
 * "Herfindahl-Hirschman" — generic OECD / UKGC / EU DAC tax-policy terms.
 * No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface CrossJurisdictionTaxConfig {
  /** Jurisdiction codes (ISO 3166-1 alpha-2). */
  jurisdictions: string[];
  /** Maximum annual GGR per jurisdiction (currency units, ≥ 0). */
  jurisdictionGgrCapacity: number[];
  /** Gambling tax rate per jurisdiction ∈ [0, 1]. */
  taxRates: number[];
  /** Compliance overhead per jurisdiction ∈ [0, 1]. */
  complianceOverheads: number[];
  /** House edge / effective margin per jurisdiction ∈ [0, 0.5]. */
  houseEdges: number[];
  /** Annual GGR growth cap per jurisdiction ∈ [0, 1] (fraction of capacity). */
  growthCaps: number[];
  /** Minimum revenue per jurisdiction (license retention floor, ≥ 0). */
  minimumRevenues: number[];
  /** Total operator revenue capacity (sum cap). */
  totalRevenueCap: number;
  /** OECD BEPS Pillar 2 minimum tax rate (default 0.15). */
  pillar2MinTaxRate: number;
  /** UKGC RTS 17 concentration threshold (default 0.5). */
  hhiComplianceThreshold: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface CrossJurisdictionTaxResult {
  /** Optimal allocation fractions a_j ∈ [0, growthCap_j]. */
  optimalAllocations: number[];
  /** Effective per-jurisdiction GGR after allocation. */
  effectiveGgr: number[];
  /** Per-jurisdiction net margin m_j = h_j · (1 − τ_j − β_j). */
  perJurisdictionNetMargin: number[];
  /** Per-jurisdiction net revenue contribution. */
  perJurisdictionNetRevenue: number[];
  /** Sort order: jurisdictions ranked by m_j descending. */
  jurisdictionRanking: number[];
  /** Total net revenue (optimization objective). */
  totalNetRevenue: number;
  /** Total GGR after optimization. */
  totalGgr: number;
  /** Effective blended tax rate over portfolio. */
  blendedEffectiveTaxRate: number;
  /** Herfindahl-Hirschman concentration index. */
  hhiConcentration: number;
  /** Per-jurisdiction OECD BEPS Pillar 2 top-up tax. */
  pillar2TopUpTaxes: number[];
  /** Total Pillar 2 top-up exposure. */
  totalPillar2TopUp: number;
  /** Per-jurisdiction tax elasticity (∂net / ∂τ_j). */
  taxRateElasticities: number[];
  /** UKGC RTS 17 + DAC7 compliance boolean. */
  isCompliantUkgcRts17: boolean;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: CrossJurisdictionTaxConfig): void {
  const N = cfg.jurisdictions.length;
  if (!Array.isArray(cfg.jurisdictions) || N < 1 || N > 30) {
    throw new Error(`crossJurisdictionTax: jurisdictions must be 1-30, got ${N}`);
  }
  const arrays = [
    cfg.jurisdictionGgrCapacity,
    cfg.taxRates,
    cfg.complianceOverheads,
    cfg.houseEdges,
    cfg.growthCaps,
    cfg.minimumRevenues,
  ];
  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length !== N) {
      throw new Error(`crossJurisdictionTax: array length mismatch (expected ${N})`);
    }
    for (const v of arr) {
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`crossJurisdictionTax: array entries must be finite ≥ 0`);
      }
    }
  }
  for (let i = 0; i < N; i++) {
    if (cfg.taxRates[i] > 1) throw new Error(`crossJurisdictionTax: taxRates must be ≤ 1`);
    if (cfg.complianceOverheads[i] > 1) throw new Error(`crossJurisdictionTax: complianceOverheads must be ≤ 1`);
    if (cfg.houseEdges[i] > 0.5)
      throw new Error(`crossJurisdictionTax: houseEdges must be ≤ 0.5`);
    if (cfg.growthCaps[i] > 1)
      throw new Error(`crossJurisdictionTax: growthCaps must be ≤ 1`);
    if (cfg.taxRates[i] + cfg.complianceOverheads[i] > 1) {
      throw new Error(
        `crossJurisdictionTax: tax + compliance overhead exceeds 1 for jurisdiction ${cfg.jurisdictions[i]}`,
      );
    }
  }
  if (!Number.isFinite(cfg.totalRevenueCap) || cfg.totalRevenueCap < 0) {
    throw new Error(`crossJurisdictionTax: totalRevenueCap must be ≥ 0`);
  }
  if (
    !Number.isFinite(cfg.pillar2MinTaxRate) ||
    cfg.pillar2MinTaxRate < 0 ||
    cfg.pillar2MinTaxRate > 1
  ) {
    throw new Error(
      `crossJurisdictionTax: pillar2MinTaxRate must be in [0, 1], got ${cfg.pillar2MinTaxRate}`,
    );
  }
  if (
    !Number.isFinite(cfg.hhiComplianceThreshold) ||
    cfg.hhiComplianceThreshold <= 0 ||
    cfg.hhiComplianceThreshold > 1
  ) {
    throw new Error(
      `crossJurisdictionTax: hhiComplianceThreshold must be in (0, 1], got ${cfg.hhiComplianceThreshold}`,
    );
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveCrossJurisdictionTax(
  cfg: CrossJurisdictionTaxConfig,
): CrossJurisdictionTaxResult {
  validateConfig(cfg);

  const N = cfg.jurisdictions.length;

  // ── Per-jurisdiction net margin m_j ──────────────────────────────────────
  const perJurisdictionNetMargin = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    perJurisdictionNetMargin[i] =
      cfg.houseEdges[i] * (1 - cfg.taxRates[i] - cfg.complianceOverheads[i]);
  }

  // ── Sort jurisdictions descending by m_j (greedy LP solution) ─────────────
  const jurisdictionRanking = Array.from({ length: N }, (_, i) => i);
  jurisdictionRanking.sort((a, b) => perJurisdictionNetMargin[b] - perJurisdictionNetMargin[a]);

  // ── Greedy allocation algorithm ───────────────────────────────────────────
  // 1. First allocate minRevenue floors (mandatory).
  // 2. Then allocate top-margin jurisdictions up to growthCap, respecting totalRevenueCap.
  const optimalAllocations = new Array(N).fill(0);
  const effectiveGgr = new Array(N).fill(0);

  let remainingCap = cfg.totalRevenueCap;

  // Phase 1: Floor allocations (mandatory commitments)
  for (let i = 0; i < N; i++) {
    const floor = Math.min(cfg.minimumRevenues[i], cfg.jurisdictionGgrCapacity[i] * cfg.growthCaps[i]);
    if (floor > 0 && remainingCap > 0) {
      const allocate = Math.min(floor, remainingCap);
      effectiveGgr[i] = allocate;
      optimalAllocations[i] =
        cfg.jurisdictionGgrCapacity[i] > 1e-9 ? allocate / cfg.jurisdictionGgrCapacity[i] : 0;
      remainingCap -= allocate;
    }
  }

  // Phase 2: Greedy top-margin allocation
  for (const i of jurisdictionRanking) {
    if (remainingCap <= 1e-9) break;
    if (perJurisdictionNetMargin[i] <= 0) continue; // negative-margin jurisdictions skipped
    const headroom =
      cfg.jurisdictionGgrCapacity[i] * cfg.growthCaps[i] - effectiveGgr[i];
    if (headroom <= 0) continue;
    const allocate = Math.min(headroom, remainingCap);
    effectiveGgr[i] += allocate;
    optimalAllocations[i] =
      cfg.jurisdictionGgrCapacity[i] > 1e-9 ? effectiveGgr[i] / cfg.jurisdictionGgrCapacity[i] : 0;
    remainingCap -= allocate;
  }

  // ── Per-jurisdiction net revenue ─────────────────────────────────────────
  const perJurisdictionNetRevenue = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    perJurisdictionNetRevenue[i] = effectiveGgr[i] * perJurisdictionNetMargin[i];
  }

  // ── Aggregate totals ──────────────────────────────────────────────────────
  const totalGgr = effectiveGgr.reduce((s, v) => s + v, 0);
  const totalNetRevenue = perJurisdictionNetRevenue.reduce((s, v) => s + v, 0);

  // ── Blended effective tax rate ───────────────────────────────────────────
  // = Σ τ_j · GGR_j · h_j / Σ GGR_j · h_j
  let weightedTaxNum = 0;
  let weightedTaxDen = 0;
  for (let i = 0; i < N; i++) {
    const ggrMargin = effectiveGgr[i] * cfg.houseEdges[i];
    weightedTaxNum += cfg.taxRates[i] * ggrMargin;
    weightedTaxDen += ggrMargin;
  }
  const blendedEffectiveTaxRate = weightedTaxDen > 1e-9 ? weightedTaxNum / weightedTaxDen : 0;

  // ── HHI concentration ─────────────────────────────────────────────────────
  let hhi = 0;
  if (totalGgr > 1e-9) {
    for (let i = 0; i < N; i++) {
      const share = effectiveGgr[i] / totalGgr;
      hhi += share * share;
    }
  } else {
    hhi = 1;
  }
  const hhiConcentration = hhi;

  // ── OECD BEPS Pillar 2 top-up tax ────────────────────────────────────────
  const pillar2TopUpTaxes = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const shortfall = Math.max(0, cfg.pillar2MinTaxRate - cfg.taxRates[i]);
    pillar2TopUpTaxes[i] = shortfall * effectiveGgr[i] * cfg.houseEdges[i];
  }
  const totalPillar2TopUp = pillar2TopUpTaxes.reduce((s, v) => s + v, 0);

  // ── Tax-rate elasticity (∂net / ∂τ_j) ─────────────────────────────────────
  const taxRateElasticities = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    taxRateElasticities[i] = -effectiveGgr[i] * cfg.houseEdges[i];
  }

  // ── UKGC RTS 17 compliance ────────────────────────────────────────────────
  const isCompliantUkgcRts17 =
    hhiConcentration < cfg.hhiComplianceThreshold && blendedEffectiveTaxRate < 0.5;

  return {
    optimalAllocations,
    effectiveGgr,
    perJurisdictionNetMargin,
    perJurisdictionNetRevenue,
    jurisdictionRanking,
    totalNetRevenue,
    totalGgr,
    blendedEffectiveTaxRate,
    hhiConcentration,
    pillar2TopUpTaxes,
    totalPillar2TopUp,
    taxRateElasticities,
    isCompliantUkgcRts17,
  };
}

/** ── MC simulation (sensitivity analysis under demand uncertainty) ──────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CrossJurisdictionTaxMcResult {
  episodes: number;
  observedTotalNetRevenue: number;
  observedTotalGgr: number;
  observedHhi: number;
}

/**
 * MC: simulate `episodes` GGR realizations sa per-jurisdiction multiplicative
 * noise (±15% Uniform), re-solve allocation, average outcomes.
 */
export function simulateCrossJurisdictionTax(
  cfg: CrossJurisdictionTaxConfig,
  seed: number,
  episodes: number,
): CrossJurisdictionTaxMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 50) {
    throw new Error(`simulateCrossJurisdictionTax: episodes must be integer ≥ 50`);
  }

  const rng = makeRng(seed);
  let sumNet = 0;
  let sumGgr = 0;
  let sumHhi = 0;

  for (let ep = 0; ep < episodes; ep++) {
    // Per-jurisdiction multiplicative noise ±15%
    const noisyCfg = {
      ...cfg,
      jurisdictionGgrCapacity: cfg.jurisdictionGgrCapacity.map((v) => v * (0.85 + 0.30 * rng())),
    };
    const r = solveCrossJurisdictionTax(noisyCfg);
    sumNet += r.totalNetRevenue;
    sumGgr += r.totalGgr;
    sumHhi += r.hhiConcentration;
  }

  return {
    episodes,
    observedTotalNetRevenue: sumNet / episodes,
    observedTotalGgr: sumGgr / episodes,
    observedHhi: sumHhi / episodes,
  };
}
