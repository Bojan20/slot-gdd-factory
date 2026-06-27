/**
 * W152 Wave 148 — Max Win Cap Truncation Analyzer (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "maximum-win cap truncation" mehaniku — UNIVERSALNI
 * regulatorni feature za sve modern slot operatore:
 *   • Pragmatic Play 5000x cap (large catalog)
 *   • Hacksaw Gaming 7500x cap
 *   • Nolimit City 25000x cap (Mental, Tombstone RIP, etc.)
 *   • NetEnt 10000x cap
 *   • Stake.com originals 5000x cap
 *   • Push Gaming 10000x-15000x cap (Wild Swarm, Razor Shark)
 *   • Yggdrasil 7777x cap
 *   • Quickspin 10000x cap
 *   • BTG Megaways often 50000x cap
 *
 * Naming policy (clean-room): "max win cap", "truncation", "overflow",
 * "RTP loss" = generic regulatory / industry terms. No vendor TM.
 *
 * ── Difference vs prior Wxx solvers ───────────────────────────────────────
 *   • W138 Tumble Multiplier with Cap — caps the CASCADE MULTIPLIER (M_max),
 *     not the total payout. M_k = min(base + (k-1)·step, M_max). Different
 *     semantics: applied per-cascade-level ne per-spin-total.
 *   • W81 Bonus Buy Variance Analyzer — RTP per buy mode (no cap operator)
 *   • W84 FS Retrigger Compound Variance — multiplicative chain, no cap
 *   • W95 Ante Bet Trade-Off — per-bet-mode decision, no cap
 *   • W121 Cascade Multiplier Chain — multiplier ladder, no payout cap
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Discrete payout distribution: Y ~ payoutPmf (operator-facing PMF of total
 * per-spin payout values in X bet units). Cap value C ∈ ℝ_+.
 *
 * Capped payout: Y_capped = min(Y, C)
 *
 * ── Closed form ───────────────────────────────────────────────────────────
 * Define P(Y = y) = π_y for each (y, π_y) in payoutPmf.
 *
 * Capped moments:
 *   E[Y_capped] = Σ_{y < C} y · π_y + C · Σ_{y ≥ C} π_y
 *               = Σ_{y < C} y · π_y + C · P_cap
 *   where P_cap = P(Y ≥ C)
 *
 *   E[Y²_capped] = Σ_{y < C} y² · π_y + C² · P_cap
 *
 *   Var[Y_capped] = E[Y²_capped] − E[Y_capped]²
 *
 * Uncapped moments (baseline):
 *   E[Y] = Σ_y y · π_y, E[Y²] = Σ_y y² · π_y, Var[Y] = E[Y²] − E[Y]²
 *
 * Key disclosure metrics:
 *   • **RTP loss to cap** (absolute) = E[Y] − E[Y_capped]
 *   • **RTP loss to cap** (relative) = (E[Y] − E[Y_capped]) / E[Y]
 *   • **P(cap hit)** = P_cap (per spin)
 *   • **1-in-N cap-hit frequency** = 1 / P_cap (regulator-style "1 in X")
 *   • **Conditional expected overflow** E[Y − C | Y ≥ C]
 *      = (Σ_{y ≥ C} (y − C) · π_y) / P_cap
 *   • **Cap-bucket RTP contribution** = C · P_cap / E[Y_capped] (% RTP from cap)
 *
 * ── Compliance ────────────────────────────────────────────────────────────
 *   • UKGC RTS 14 — max-win disclosure mandatory (B3-LCCP)
 *   • UKGC §5.A.E — operator must disclose cap impact to player
 *   • MGA PPD §11.f — cap mechanic + RTP-loss transparency
 *   • AU NCRG — Australian regulatory max-win disclosure (post-2023 reform)
 *   • BE Belgian Gaming Commission — max-win disclosure
 *   • eCOGRA Generic Slots Audit — verifies cap implementation matches engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateMaxWinCapTruncation() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface MaxWinCapPayoutPmfEntry {
  /** Payout value in X bet units (non-negative). */
  value: number;
  /** PMF probability mass (in [0, 1]). */
  probability: number;
}

export interface MaxWinCapTruncationConfig {
  /** Discrete payout PMF (e.g., from histogram of MC simulations). Sum to 1. */
  payoutPmf: MaxWinCapPayoutPmfEntry[];
  /** Maximum win cap value (in X bet units, > 0). */
  maxWinCapX: number;
}

export interface MaxWinCapTruncationResult {
  maxWinCapX: number;
  expectedPayoutUncapped: number;       // E[Y]
  variancePayoutUncapped: number;       // Var[Y]
  expectedPayoutCapped: number;          // E[Y_capped]
  variancePayoutCapped: number;          // Var[Y_capped]
  rtpLossAbsolute: number;               // E[Y] − E[Y_capped]
  rtpLossRelative: number;               // (E[Y] − E[Y_capped]) / E[Y]
  probCapHit: number;                    // P(Y ≥ C) per spin
  oneInNCapHitFrequency: number;         // 1 / P_cap (∞ if P_cap=0)
  expectedConditionalOverflow: number;   // E[Y − C | Y ≥ C]
  capBucketRtpContributionFraction: number; // C · P_cap / E[Y_capped]
  /** Diagnostic: percent of payout PMF strictly below cap. */
  probBelowCap: number;
  /** Diagnostic: max payout value in PMF (may equal or exceed cap). */
  observedMaxPayoutInPmf: number;
}

export interface MaxWinCapTruncationMcResult {
  spins: number;
  observedMeanPayoutUncapped: number;
  observedMeanPayoutCapped: number;
  observedCapHitFraction: number;
  observedMaxPayoutUncappedSeen: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateConfig(cfg: MaxWinCapTruncationConfig): void {
  if (!Array.isArray(cfg.payoutPmf) || cfg.payoutPmf.length === 0) {
    throw new Error('payoutPmf must be non-empty array');
  }
  if (!Number.isFinite(cfg.maxWinCapX) || cfg.maxWinCapX <= 0) {
    throw new Error(`maxWinCapX must be finite positive (got ${cfg.maxWinCapX})`);
  }
  let sumP = 0;
  for (const e of cfg.payoutPmf) {
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`payoutPmf value must be finite non-negative (got ${e.value})`);
    }
    if (!(e.probability >= 0 && e.probability <= 1)) {
      throw new Error(`payoutPmf probability must be in [0, 1] (got ${e.probability})`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`payoutPmf probabilities must sum to 1 (got ${sumP})`);
  }
}

// ── Closed-form solver ──────────────────────────────────────────────────────

export function solveMaxWinCapTruncation(cfg: MaxWinCapTruncationConfig): MaxWinCapTruncationResult {
  validateConfig(cfg);
  const C = cfg.maxWinCapX;

  let eY = 0;
  let eY2 = 0;
  let eYcap = 0;
  let eY2cap = 0;
  let pCap = 0;
  let overflowSum = 0;
  let probBelow = 0;
  let maxPmfValue = 0;

  for (const e of cfg.payoutPmf) {
    const y = e.value;
    const w = e.probability;
    eY += y * w;
    eY2 += y * y * w;
    if (y > maxPmfValue) maxPmfValue = y;

    if (y < C) {
      eYcap += y * w;
      eY2cap += y * y * w;
      probBelow += w;
    } else {
      // y ≥ C → contribute C (and C²) to capped, count P_cap, overflow (y−C)
      pCap += w;
      overflowSum += (y - C) * w;
    }
  }
  // Add cap contribution
  eYcap += C * pCap;
  eY2cap += C * C * pCap;

  const varY = Math.max(0, eY2 - eY * eY);
  const varYcap = Math.max(0, eY2cap - eYcap * eYcap);

  const rtpLossAbs = eY - eYcap;
  const rtpLossRel = eY > 1e-15 ? rtpLossAbs / eY : 0;
  const oneInN = pCap > 1e-15 ? 1 / pCap : Infinity;
  const expCondOverflow = pCap > 1e-15 ? overflowSum / pCap : 0;
  const capBucketFrac = eYcap > 1e-15 ? (C * pCap) / eYcap : 0;

  return {
    maxWinCapX: C,
    expectedPayoutUncapped: eY,
    variancePayoutUncapped: varY,
    expectedPayoutCapped: eYcap,
    variancePayoutCapped: varYcap,
    rtpLossAbsolute: rtpLossAbs,
    rtpLossRelative: rtpLossRel,
    probCapHit: pCap,
    oneInNCapHitFrequency: oneInN,
    expectedConditionalOverflow: expCondOverflow,
    capBucketRtpContributionFraction: capBucketFrac,
    probBelowCap: probBelow,
    observedMaxPayoutInPmf: maxPmfValue,
  };
}

// ── MC reference ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePmf(pmf: MaxWinCapPayoutPmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

export function simulateMaxWinCapTruncation(
  cfg: MaxWinCapTruncationConfig,
  spins: number,
  seed: number,
): MaxWinCapTruncationMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(spins) || spins < 1) {
    throw new Error(`Invalid spins: ${spins}`);
  }
  const rng = mulberry32(seed);
  const C = cfg.maxWinCapX;

  let totalUncapped = 0;
  let totalCapped = 0;
  let capHits = 0;
  let maxSeen = 0;

  for (let i = 0; i < spins; i++) {
    const y = samplePmf(cfg.payoutPmf, rng());
    totalUncapped += y;
    const yCap = y < C ? y : C;
    totalCapped += yCap;
    if (y >= C) capHits += 1;
    if (y > maxSeen) maxSeen = y;
  }

  return {
    spins,
    observedMeanPayoutUncapped: totalUncapped / spins,
    observedMeanPayoutCapped: totalCapped / spins,
    observedCapHitFraction: capHits / spins,
    observedMaxPayoutUncappedSeen: maxSeen,
  };
}
