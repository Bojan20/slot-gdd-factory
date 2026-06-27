/**
 * W152 Wave 125 — Bi-Directional Line Pay Aggregator (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "both-ways pays" mehaniku — Microgaming Avalon /
 * NetEnt Lights / Witches Wheel / IGT Cleopatra Bi-Way / Stakelogic
 * Witchcraft Academy style. Per spin, line evaluation matches symbol
 * from LEFT (reels 1..k) AND from RIGHT (reels N-k+1..N).
 *
 * Naming policy (clean-room): "bi-directional", "line pay", "both-ways"
 * = generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • Standard left-to-right line evaluation (single direction)
 *   • W47 Walking Wild — position-based, not line-based
 *   • W101 Symbol Upgrade Chain — single symbol upgrade ladder
 *   • W116 Mystery Symbol Reveal — symbol substitution, not directional pay
 *   • All other Wxxx — none compute bi-directional line pay aggregate
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N reels, independent per-reel symbol density:
 *   q_s = P(symbol s lands on reel) — assume uniform across reels for clean form
 *
 * Left-line k-match (start from reel 1):
 *   L(s, k) = "reels 1..k all show s, reel k+1 does NOT show s"
 *   P(L_k) = q_s^k · (1 − q_s)         for k = k_min..N-1
 *   P(L_N) = q_s^N                     (all reels match, no stopper needed)
 *
 * Right-line k-match (symmetric, from reel N):
 *   R(s, k) = "reels N-k+1..N all show s, reel N-k does NOT show s"
 *   P(R_k) = q_s^k · (1 − q_s)         for k = k_min..N-1
 *   P(R_N) = q_s^N                     (same event as L_N — full match)
 *
 * Bi-directional aggregate per symbol s:
 *   E[pay_L]  = Σ_{k=k_min}^{N} paytable[s, k] · P(L_k)
 *   E[pay_R]  = Σ_{k=k_min}^{N} paytable[s, k] · P(R_k)
 *   E[pay_BD] = E[pay_L] + E[pay_R] − paytable[s, N] · q_s^N
 *               ── −last term: L_N and R_N are the SAME event, deduct overlap
 *
 * Aggregate hit frequency:
 *   hit_freq_L  = Σ_{k≥k_min} P(L_k)
 *   hit_freq_R  = Σ_{k≥k_min} P(R_k)
 *   hit_freq_BD = hit_freq_L + hit_freq_R − P(L_N)
 *
 * Total bi-directional E[pay per spin] = Σ_s E[pay_BD per symbol s]
 *   (assuming non-overlapping symbol events for cross-symbol sum)
 *
 * Variance per spin (per-symbol cross-independence assumption):
 *   E[(pay_BD)²] = Σ_k paytable[k]² · P_BD_k
 *                  where P_BD_k = P(L_k) + P(R_k) − [k=N ? P(L_N) : 0]
 *   Var[pay_BD] = E[(pay_BD)²] − E[pay_BD]²
 *
 * Industry compliance:
 *   • UKGC RTS 14 — pay-frequency disclosure both-directions
 *   • MGA PPD §11.f — operator-facing line-evaluation rule disclosure
 *   • eCOGRA Generic Slots Audit — verifies bi-directional pay match engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateBiDirectionalLinePay() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface SymbolPaytableEntry {
  /** Symbol label. */
  label: string;
  /** Per-reel symbol density (probability that this symbol appears, 0 < q ≤ 1). */
  density: number;
  /** Paytable: paytable[k] = payoutX for k consecutive matches (k=1..N). */
  paytable: number[];
}

export interface BiDirectionalLinePayConfig {
  /** Number of reels (positive integer ≥ 2). */
  reelCount: number;
  /** Minimum match length k_min for payout (typically 3, sometimes 2 for scatter). */
  minMatchLength: number;
  /** Per-symbol entries (densities + paytable). */
  symbols: SymbolPaytableEntry[];
}

export interface PerSymbolBiDirectionalStats {
  label: string;
  density: number;
  expectedPayLeft: number;
  expectedPayRight: number;
  expectedPayBidirectional: number;
  hitFrequencyLeft: number;
  hitFrequencyRight: number;
  hitFrequencyBidirectional: number;
  // Per-match-length probability table (for transparency)
  probLeftAtK: number[];   // index k → P(L_k) for k = 0..N
  probRightAtK: number[];  // index k → P(R_k) for k = 0..N
}

export interface BiDirectionalLinePayResult {
  reelCount: number;
  minMatchLength: number;
  perSymbol: PerSymbolBiDirectionalStats[];
  // Aggregate (sum over symbols, assuming disjoint hit events at line level)
  totalExpectedPayLeft: number;
  totalExpectedPayRight: number;
  totalExpectedPayBidirectional: number;
  totalHitFrequencyLeft: number;
  totalHitFrequencyRight: number;
  totalHitFrequencyBidirectional: number;
  // Volatility decomposition
  varianceBidirectional: number;
  // Industry-disclosure
  bidirectionalUpliftRatio: number; // E[pay_BD] / E[pay_L] (typically ~1.5-2 for non-scatter)
}

export interface BiDirectionalLinePayMCResult {
  spins: number;
  observedTotalPayLeft: number;
  observedTotalPayRight: number;
  observedTotalPayBidirectional: number;
  observedHitsLeft: number;
  observedHitsRight: number;
  observedHitsBidirectional: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: BiDirectionalLinePayConfig): void {
  if (!Number.isInteger(cfg.reelCount) || cfg.reelCount < 2) {
    throw new Error(`reelCount must be integer ≥ 2 (got ${cfg.reelCount})`);
  }
  if (!Number.isInteger(cfg.minMatchLength) || cfg.minMatchLength < 1 || cfg.minMatchLength > cfg.reelCount) {
    throw new Error(`minMatchLength must be integer in [1, reelCount] (got ${cfg.minMatchLength})`);
  }
  if (!Array.isArray(cfg.symbols) || cfg.symbols.length === 0) {
    throw new Error(`symbols must be non-empty`);
  }
  const seenLabel = new Set<string>();
  let totalDensity = 0;
  for (const s of cfg.symbols) {
    if (typeof s.label !== 'string' || s.label.length === 0) {
      throw new Error(`symbol.label must be non-empty string`);
    }
    if (seenLabel.has(s.label)) throw new Error(`symbols: duplicate label ${s.label}`);
    seenLabel.add(s.label);
    if (!Number.isFinite(s.density) || s.density <= 0 || s.density > 1) {
      throw new Error(`symbol ${s.label}: density must be in (0, 1] (got ${s.density})`);
    }
    totalDensity += s.density;
    if (!Array.isArray(s.paytable) || s.paytable.length !== cfg.reelCount) {
      throw new Error(`symbol ${s.label}: paytable must have length = reelCount (${cfg.reelCount})`);
    }
    for (const p of s.paytable) {
      if (!Number.isFinite(p) || p < 0) {
        throw new Error(`symbol ${s.label}: paytable entries must be ≥ 0`);
      }
    }
  }
  // Density sanity (allow ≤ 1 sum since wild + scatter density may overlap; warn only)
  if (totalDensity > 1.5) {
    throw new Error(`symbol densities sum to ${totalDensity}, exceeds reasonable 1.5 bound`);
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveBiDirectionalLinePay(
  config: BiDirectionalLinePayConfig,
): BiDirectionalLinePayResult {
  validate(config);
  const N = config.reelCount;
  const kMin = config.minMatchLength;

  const perSymbol: PerSymbolBiDirectionalStats[] = [];
  let totalEL = 0;
  let totalER = 0;
  let totalEBD = 0;
  let totalHFL = 0;
  let totalHFR = 0;
  let totalHFBD = 0;
  let totalE2_BD = 0; // sum of E[(pay)²] for variance

  for (const s of config.symbols) {
    const q = s.density;
    const probLeft: number[] = new Array<number>(N + 1).fill(0);
    const probRight: number[] = new Array<number>(N + 1).fill(0);

    // P(L_k) and P(R_k) for k = kMin..N
    for (let k = kMin; k <= N; k++) {
      if (k < N) {
        probLeft[k] = Math.pow(q, k) * (1 - q);
        probRight[k] = Math.pow(q, k) * (1 - q);
      } else {
        // k = N — full match, no stopper
        probLeft[N] = Math.pow(q, N);
        probRight[N] = Math.pow(q, N); // same event as L_N
      }
    }

    let eL = 0;
    let eR = 0;
    let hfL = 0;
    let hfR = 0;
    let e2 = 0;
    for (let k = kMin; k <= N; k++) {
      eL += s.paytable[k - 1] * probLeft[k];
      eR += s.paytable[k - 1] * probRight[k];
      hfL += probLeft[k];
      hfR += probRight[k];
      // P_BD_k = P(L_k) + P(R_k) − [k=N : P(L_N)] (deduct overlap at k=N)
      const pbdk = probLeft[k] + probRight[k] - (k === N ? probLeft[N] : 0);
      e2 += s.paytable[k - 1] * s.paytable[k - 1] * pbdk;
    }
    // E[pay_BD per symbol] = eL + eR − paytable[N] · P(L_N)
    const eBD = eL + eR - s.paytable[N - 1] * probLeft[N];
    const hfBD = hfL + hfR - probLeft[N];

    perSymbol.push({
      label: s.label,
      density: q,
      expectedPayLeft: eL,
      expectedPayRight: eR,
      expectedPayBidirectional: eBD,
      hitFrequencyLeft: hfL,
      hitFrequencyRight: hfR,
      hitFrequencyBidirectional: hfBD,
      probLeftAtK: probLeft,
      probRightAtK: probRight,
    });

    totalEL += eL;
    totalER += eR;
    totalEBD += eBD;
    totalHFL += hfL;
    totalHFR += hfR;
    totalHFBD += hfBD;
    totalE2_BD += e2;
  }

  const variance = Math.max(0, totalE2_BD - totalEBD * totalEBD);
  const upliftRatio = totalEL > 1e-12 ? totalEBD / totalEL : 1;

  return {
    reelCount: N,
    minMatchLength: kMin,
    perSymbol,
    totalExpectedPayLeft: totalEL,
    totalExpectedPayRight: totalER,
    totalExpectedPayBidirectional: totalEBD,
    totalHitFrequencyLeft: totalHFL,
    totalHitFrequencyRight: totalHFR,
    totalHitFrequencyBidirectional: totalHFBD,
    varianceBidirectional: variance,
    bidirectionalUpliftRatio: upliftRatio,
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

export function simulateBiDirectionalLinePay(
  config: BiDirectionalLinePayConfig,
  spins: number,
  seed: number,
): BiDirectionalLinePayMCResult {
  validate(config);
  const rng = makePrng(seed);
  const N = config.reelCount;
  const kMin = config.minMatchLength;

  let sumPayL = 0;
  let sumPayR = 0;
  let sumPayBD = 0;
  let hitsL = 0;
  let hitsR = 0;
  let hitsBD = 0;

  for (let t = 0; t < spins; t++) {
    // Each reel independently: which symbol (or none) lands. Bernoulli per symbol.
    // We model each reel as a single-symbol slot: per reel, sample which symbol is present
    // (densities NOT mutually exclusive — for simplicity, sample independently per-symbol).
    // To compute pays, for EACH symbol independently check left-chain & right-chain matches.

    let spinPayL = 0;
    let spinPayR = 0;
    let spinPayBD = 0;
    let hadHitL = false;
    let hadHitR = false;
    let hadHitBD = false;

    for (const s of config.symbols) {
      const q = s.density;
      // Per-reel Bernoulli: does symbol s appear on reel i?
      const reels: boolean[] = new Array<boolean>(N);
      for (let i = 0; i < N; i++) reels[i] = rng() < q;

      // Left chain: count consecutive trues from reel 0
      let leftK = 0;
      for (let i = 0; i < N; i++) {
        if (reels[i]) leftK++;
        else break;
      }
      // Right chain: count from reel N-1 backward
      let rightK = 0;
      for (let i = N - 1; i >= 0; i--) {
        if (reels[i]) rightK++;
        else break;
      }

      // Pay if chain ≥ kMin
      if (leftK >= kMin) {
        const pay = s.paytable[leftK - 1];
        spinPayL += pay;
        hadHitL = true;
      }
      if (rightK >= kMin) {
        const pay = s.paytable[rightK - 1];
        spinPayR += pay;
        hadHitR = true;
      }
      // BD: pay both directions BUT for k=N (full match) deduct once
      let bdPay = 0;
      if (leftK >= kMin) bdPay += s.paytable[leftK - 1];
      if (rightK >= kMin) bdPay += s.paytable[rightK - 1];
      if (leftK === N && rightK === N) {
        // overlap: deduct one paytable[N]
        bdPay -= s.paytable[N - 1];
      }
      if (bdPay > 0) {
        spinPayBD += bdPay;
        hadHitBD = true;
      }
    }

    sumPayL += spinPayL;
    sumPayR += spinPayR;
    sumPayBD += spinPayBD;
    if (hadHitL) hitsL++;
    if (hadHitR) hitsR++;
    if (hadHitBD) hitsBD++;
  }

  return {
    spins,
    observedTotalPayLeft: sumPayL / spins,
    observedTotalPayRight: sumPayR / spins,
    observedTotalPayBidirectional: sumPayBD / spins,
    observedHitsLeft: hitsL / spins,
    observedHitsRight: hitsR / spins,
    observedHitsBidirectional: hitsBD / spins,
  };
}
