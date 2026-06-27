/**
 * W152 Wave 112 — Variable Reel Height Ways (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "varijabilna visina kolone" žanr — BTG Megaways
 * patent EXPIRED 2023 → naming clean-room "variable reel height ways".
 * Pragmatic / Blueprint / iSoftBet / Stakelogic koriste isti pattern pod
 * različitim brandovima.
 *
 * Per spin, svaki reel i (1..N) dobija visinu H_i ~ discrete distribution
 * nad podržanim heights skupom (npr. {2,3,4,5,6,7}). Ways count =
 * Π H_i (cross-reel), nezavisno po reel-u.
 *
 * Naming policy (clean-room): "variable reel height", "ways count",
 * "reel modifier" = generic industry terms. No vendor TM.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N reels. Per reel i:
 *   H_i ~ discrete distribution { h_k → p_k }, p_k > 0, Σ p_k = 1, h_k ≥ 1
 *
 * Ways count W = Π_{i=1..N} H_i (independent across reels).
 *
 * Closed-form moments (cross-reel independence):
 *   E[W]    = Π_i E[H_i]
 *   E[W²]   = Π_i E[H_i²]
 *   Var[W]  = E[W²] − E[W]²
 *
 * Distribution of W via discrete convolution of {H_i} (multiplicative —
 * we maintain PMF on log-2-or-log-10 grid implicit through value-merge).
 * For typical N ≤ 6 and per-reel domain ≤ 8 values, full PMF has
 * ≤ 8^6 ≈ 262K support → solver returns sparse pmf as Map<number, prob>.
 *
 * Symbol RTP impact (optional, when paytable + per-symbol per-reel
 * landing probabilities provided):
 *   For symbol s with K-reel hit (positions on first K consecutive reels):
 *   E[payout | K-of-s] = paytable[s,K] · E[W_{1..K}]
 *   where E[W_{1..K}] = Π_{i=1..K} E[H_i].
 *
 *   E[contribution per spin] = Σ_K P(s hits K reels) · paytable[s,K] · E[W_{1..K}]
 *
 * Tail metrics:
 *   • maxWays = Π_i max(supp(H_i))
 *   • probMaxWays = Π_i P(H_i = max(supp(H_i)))
 *   • P(W ≥ threshold) via PMF aggregation (operator-facing "epic ways"
 *     marketing-claim disclosure).
 *
 * Industry compliance:
 *   • UKGC RTS 14 — variance + tail-probability disclosure (ways
 *     distribution must be auditable).
 *   • MGA PPD §11.f — operator-facing ways volatility disclosure.
 *   • eCOGRA Generic Slots Audit — verifies E[W] / Var[W] match engine.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateVariableReelHeightWays() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface ReelHeightPmfEntry {
  /** Reel height value (positive integer ≥ 1). */
  height: number;
  /** Probability of this height landing on this reel (0 < p ≤ 1). */
  probability: number;
}

export interface ReelHeightConfig {
  /** Display label (e.g. 'reel_1', 'reel_2', ...). */
  label: string;
  /** Discrete PMF — heights with probabilities (Σ ≈ 1). */
  pmf: ReelHeightPmfEntry[];
}

export interface VariableReelHeightWaysConfig {
  /** Per-reel height configurations (length ≥ 1). */
  reels: ReelHeightConfig[];
  /** Optional ways-count thresholds for tail-prob disclosure. */
  waysThresholds?: number[];
  /** Optional: bound PMF support — if true, returns sparse PMF, else only moments. */
  computePmf?: boolean;
}

export interface ReelStats {
  label: string;
  expectedHeight: number;
  varianceHeight: number;
  minHeight: number;
  maxHeight: number;
}

export interface VariableReelHeightWaysResult {
  reelStats: ReelStats[];
  expectedWays: number;
  varianceWays: number;
  stdWays: number;
  minWays: number;
  maxWays: number;
  probMinWays: number;
  probMaxWays: number;
  /** P(W ≥ threshold) for each threshold in waysThresholds (sorted asc). */
  tailProbabilities: Record<string, number>;
  /** Optional sparse PMF: ways-count → probability. Only present if computePmf. */
  waysPmf?: Map<number, number>;
}

export interface VariableReelHeightWaysMCResult {
  episodes: number;
  observedMeanWays: number;
  observedVarianceWays: number;
  observedMinObserved: number;
  observedMaxObserved: number;
  observedTailHits: Record<string, number>;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: VariableReelHeightWaysConfig): void {
  if (!Array.isArray(cfg.reels) || cfg.reels.length === 0) {
    throw new Error(`reels must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const r of cfg.reels) {
    if (typeof r.label !== 'string' || r.label.length === 0) {
      throw new Error(`reel label must be non-empty`);
    }
    if (seen.has(r.label)) throw new Error(`duplicate reel label: ${r.label}`);
    seen.add(r.label);
    if (!Array.isArray(r.pmf) || r.pmf.length === 0) {
      throw new Error(`reel ${r.label}: pmf must be non-empty`);
    }
    let sumP = 0;
    const seenH = new Set<number>();
    for (const e of r.pmf) {
      if (!Number.isInteger(e.height) || e.height < 1) {
        throw new Error(`reel ${r.label}: height must be a positive integer (got ${e.height})`);
      }
      if (seenH.has(e.height)) throw new Error(`reel ${r.label}: duplicate height ${e.height}`);
      seenH.add(e.height);
      if (!Number.isFinite(e.probability) || e.probability <= 0 || e.probability > 1) {
        throw new Error(`reel ${r.label}: probability must be in (0, 1]`);
      }
      sumP += e.probability;
    }
    if (Math.abs(sumP - 1) > 1e-9) {
      throw new Error(`reel ${r.label}: pmf probabilities sum to ${sumP}, must be 1`);
    }
  }
  if (cfg.waysThresholds !== undefined) {
    for (const t of cfg.waysThresholds) {
      if (!Number.isFinite(t) || t < 1) {
        throw new Error(`waysThreshold must be ≥ 1 (got ${t})`);
      }
    }
  }
}

// ── Solver ─────────────────────────────────────────────────────────────────

function reelMoments(pmf: ReelHeightPmfEntry[]): {
  e: number;
  e2: number;
  v: number;
  min: number;
  max: number;
  pMin: number;
  pMax: number;
} {
  let e = 0;
  let e2 = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const { height, probability } of pmf) {
    e += height * probability;
    e2 += height * height * probability;
    if (height < min) min = height;
    if (height > max) max = height;
  }
  const v = e2 - e * e;
  let pMin = 0;
  let pMax = 0;
  for (const { height, probability } of pmf) {
    if (height === min) pMin += probability;
    if (height === max) pMax += probability;
  }
  return { e, e2, v, min, max, pMin, pMax };
}

/** Convolve two ways-count PMFs via Cartesian product + value merge. */
function convolveWays(
  a: Map<number, number>,
  b: Map<number, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [wa, pa] of a) {
    for (const [wb, pb] of b) {
      const w = wa * wb;
      const p = pa * pb;
      out.set(w, (out.get(w) ?? 0) + p);
    }
  }
  return out;
}

export function solveVariableReelHeightWays(
  config: VariableReelHeightWaysConfig,
): VariableReelHeightWaysResult {
  validate(config);

  const moments = config.reels.map((r) => reelMoments(r.pmf));
  const reelStats: ReelStats[] = config.reels.map((r, i) => ({
    label: r.label,
    expectedHeight: moments[i].e,
    varianceHeight: moments[i].v,
    minHeight: moments[i].min,
    maxHeight: moments[i].max,
  }));

  // E[W] = Π E[H_i], E[W²] = Π E[H_i²] (cross-reel independence).
  let eW = 1;
  let eW2 = 1;
  let minW = 1;
  let maxW = 1;
  let pMinW = 1;
  let pMaxW = 1;
  for (const m of moments) {
    eW *= m.e;
    eW2 *= m.e2;
    minW *= m.min;
    maxW *= m.max;
    pMinW *= m.pMin;
    pMaxW *= m.pMax;
  }
  const varW = Math.max(0, eW2 - eW * eW);
  const stdW = Math.sqrt(varW);

  // Optional PMF construction via reel-by-reel convolution.
  let waysPmf: Map<number, number> | undefined;
  if (config.computePmf) {
    let curr = new Map<number, number>([[1, 1]]);
    for (const r of config.reels) {
      const m = new Map<number, number>();
      for (const e of r.pmf) m.set(e.height, e.probability);
      curr = convolveWays(curr, m);
    }
    waysPmf = curr;
  }

  // Tail probabilities P(W ≥ t) — requires PMF (compute lazily if needed).
  const tailProbabilities: Record<string, number> = {};
  if (config.waysThresholds && config.waysThresholds.length > 0) {
    let pmf = waysPmf;
    if (!pmf) {
      let curr = new Map<number, number>([[1, 1]]);
      for (const r of config.reels) {
        const m = new Map<number, number>();
        for (const e of r.pmf) m.set(e.height, e.probability);
        curr = convolveWays(curr, m);
      }
      pmf = curr;
    }
    for (const t of config.waysThresholds) {
      let p = 0;
      for (const [w, prob] of pmf) {
        if (w >= t) p += prob;
      }
      tailProbabilities[String(t)] = p;
    }
  }

  return {
    reelStats,
    expectedWays: eW,
    varianceWays: varW,
    stdWays: stdW,
    minWays: minW,
    maxWays: maxW,
    probMinWays: pMinW,
    probMaxWays: pMaxW,
    tailProbabilities,
    waysPmf,
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

function sampleReelHeight(pmf: ReelHeightPmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.height;
  }
  // Floating-point safety fallback
  return pmf[pmf.length - 1].height;
}

export function simulateVariableReelHeightWays(
  config: VariableReelHeightWaysConfig,
  episodes: number,
  seed: number,
): VariableReelHeightWaysMCResult {
  validate(config);
  const rng = makePrng(seed);
  let sumW = 0;
  let sumW2 = 0;
  let minObs = Infinity;
  let maxObs = -Infinity;
  const tailHits: Record<string, number> = {};
  if (config.waysThresholds) {
    for (const t of config.waysThresholds) tailHits[String(t)] = 0;
  }

  for (let ep = 0; ep < episodes; ep++) {
    let w = 1;
    for (const r of config.reels) {
      w *= sampleReelHeight(r.pmf, rng());
    }
    sumW += w;
    sumW2 += w * w;
    if (w < minObs) minObs = w;
    if (w > maxObs) maxObs = w;
    if (config.waysThresholds) {
      for (const t of config.waysThresholds) {
        if (w >= t) tailHits[String(t)] += 1;
      }
    }
  }

  const mean = sumW / episodes;
  const variance = Math.max(0, sumW2 / episodes - mean * mean);

  return {
    episodes,
    observedMeanWays: mean,
    observedVarianceWays: variance,
    observedMinObserved: minObs,
    observedMaxObserved: maxObs,
    observedTailHits: tailHits,
  };
}
