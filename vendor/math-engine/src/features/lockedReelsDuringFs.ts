/**
 * W152 Wave 136 — Locked/Held Reels During FS Analyzer (Faza 4.3 ext, post-W100 roadmap).
 *
 * Closed-form solver za "lock-and-spin during free spins" mehaniku —
 * Pragmatic Wolf Gold / Buffalo King / John Hunter's Tomb of the Scarab
 * Queen / Push Gaming Mount Magmas / Yggdrasil Vault of Anubis style.
 * Trigger reels (K) held throughout M FS spins, non-held reels respin sa
 * scatter probability q; retrigger fires kada total scatters ≥ T u single
 * FS spin.
 *
 * Naming policy (clean-room): "locked reels", "held reels", "retrigger"
 * = generic industry terms. No vendor TM.
 *
 * Distinct from:
 *   • W84 FS Retrigger Compound Variance — multiplicative retrigger inside FS
 *     (assumes Bernoulli per-spin); ovaj solver computes RETRIGGER prob from
 *     reel-by-reel scatter density (compositional with held-reel state)
 *   • W110 Bonus Trigger Wait Time — long-run base-game trigger wait
 *   • W118 Bonus Collect-N — collect-N threshold w/o held semantics
 *   • W127 Anticipation/Tease — Bayesian per-reel reveal, no held state
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N reels total, K of which are HELD (locked scatter visible throughout FS).
 * M FS spins. Per non-held reel per FS spin: P(fresh scatter) = q (Bernoulli,
 * independent). Per FS spin, fresh scatter count J ~ Binomial(N − K, q).
 *
 * Total scatters per FS spin S = K + J (held + fresh).
 * Retrigger triggers when S ≥ T, i.e. J ≥ T − K (need = max(0, T−K) fresh).
 *
 * Per-spin retrigger probability:
 *   P_re = P(J ≥ T − K) = Σ_{j=max(0,T-K)}^{N-K} C(N-K, j) · q^j · (1-q)^(N-K-j)
 *
 * Across M FS spins (no resets):
 *   E[retriggers] = M · P_re
 *   P(no retrigger) = (1 − P_re)^M
 *   P(≥ 1 retrigger) = 1 − (1 − P_re)^M
 *   Var[retriggers] = M · P_re · (1 − P_re)
 *
 * Time-to-first-retrigger T_re ~ shifted-Geometric(P_re):
 *   E[T_re | triggered] = 1/P_re (subject to M cap)
 *   E[T_re truncated by M] = (1 − (1 − P_re)^M) · (1/P_re) [approximation]
 *
 * Held-cell contribution to per-FS-spin payout (held scatters re-pay every spin):
 *   E[held contribution per spin] = K · scatterPayoutX
 *   E[fresh contribution per spin] = E[J] · scatterPayoutX = (N−K)·q · scatterPayoutX
 *   E[total scatter pay per FS spin] = (K + (N−K)·q) · scatterPayoutX
 *
 * Cross-FS aggregate (M spins):
 *   E[total scatter pay during FS] = M · (K + (N−K)·q) · scatterPayoutX
 *
 * Industry compliance:
 *   • UKGC RTS 14 — retrigger frequency disclosure
 *   • MGA PPD §11.f — operator-facing held-reel retrigger rate
 *   • eCOGRA Generic Slots Audit — verifies retrigger probability
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateLockedReelsDuringFs() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface LockedReelsDuringFsConfig {
  /** Total reel count (positive integer ≥ 2). */
  totalReels: number;
  /** Held reels (trigger scatters locked through FS). 0 ≤ heldReels ≤ totalReels. */
  heldReels: number;
  /** Free spin count (positive integer ≥ 1). */
  freeSpins: number;
  /** Per non-held reel per FS spin: P(fresh scatter). */
  freshScatterProbabilityPerReel: number;
  /** Retrigger threshold (total scatters ≥ T fires retrigger). */
  retriggerScatterThreshold: number;
  /** Optional per-scatter pay (typically 0 — scatters trigger feature, ne pay; default 0). */
  scatterPayoutPerSymbolX?: number;
}

export interface LockedReelsDuringFsResult {
  totalReels: number;
  heldReels: number;
  freeSpins: number;
  freshScatterProbabilityPerReel: number;
  retriggerScatterThreshold: number;
  // Per-spin metrics
  probRetriggerPerSpin: number;
  expectedFreshScattersPerSpin: number;
  expectedTotalScattersPerSpin: number;
  // Across FS
  expectedRetriggersAcrossFs: number;
  probAnyRetriggerAcrossFs: number;
  varianceRetriggers: number;
  // Time-to-first
  expectedTimeToFirstRetrigger: number; // truncated by FS count
  // Pay aggregate (if scatterPayoutPerSymbolX provided)
  expectedTotalScatterPayAcrossFs: number;
}

export interface LockedReelsDuringFsMCResult {
  episodes: number;
  observedMeanRetriggersPerEpisode: number;
  observedAnyRetriggerFraction: number;
  observedMeanFreshScattersPerSpin: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: LockedReelsDuringFsConfig): void {
  if (!Number.isInteger(cfg.totalReels) || cfg.totalReels < 2) {
    throw new Error(`totalReels must be integer ≥ 2 (got ${cfg.totalReels})`);
  }
  if (!Number.isInteger(cfg.heldReels) || cfg.heldReels < 0 || cfg.heldReels > cfg.totalReels) {
    throw new Error(`heldReels must be integer in [0, totalReels] (got ${cfg.heldReels})`);
  }
  if (!Number.isInteger(cfg.freeSpins) || cfg.freeSpins < 1) {
    throw new Error(`freeSpins must be integer ≥ 1 (got ${cfg.freeSpins})`);
  }
  const q = cfg.freshScatterProbabilityPerReel;
  if (!Number.isFinite(q) || q < 0 || q > 1) {
    throw new Error(`freshScatterProbabilityPerReel must be in [0, 1] (got ${q})`);
  }
  if (!Number.isInteger(cfg.retriggerScatterThreshold) || cfg.retriggerScatterThreshold < 1 || cfg.retriggerScatterThreshold > cfg.totalReels) {
    throw new Error(`retriggerScatterThreshold must be integer in [1, totalReels] (got ${cfg.retriggerScatterThreshold})`);
  }
  if (cfg.scatterPayoutPerSymbolX !== undefined) {
    if (!Number.isFinite(cfg.scatterPayoutPerSymbolX) || cfg.scatterPayoutPerSymbolX < 0) {
      throw new Error(`scatterPayoutPerSymbolX must be ≥ 0 (got ${cfg.scatterPayoutPerSymbolX})`);
    }
  }
}

// ── Binomial helpers ───────────────────────────────────────────────────────

function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  const kEff = Math.min(k, n - k);
  for (let i = 0; i < kEff; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

/** P(X ≥ k | X ~ Binomial(n, p)). */
function probBinomGE(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  for (let j = k; j <= n; j++) {
    sum += binomCoeff(n, j) * Math.pow(p, j) * Math.pow(1 - p, n - j);
  }
  return Math.max(0, Math.min(1, sum));
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveLockedReelsDuringFs(
  config: LockedReelsDuringFsConfig,
): LockedReelsDuringFsResult {
  validate(config);
  const N = config.totalReels;
  const K = config.heldReels;
  const M = config.freeSpins;
  const q = config.freshScatterProbabilityPerReel;
  const T = config.retriggerScatterThreshold;
  const scatterPay = config.scatterPayoutPerSymbolX ?? 0;

  const nonHeld = N - K;
  const need = Math.max(0, T - K);

  // Per-spin retrigger probability
  let P_re = 0;
  if (need === 0) {
    // Already at/above threshold from held alone → every spin retriggers
    P_re = 1;
  } else if (need > nonHeld) {
    // Can't reach threshold even sa max fresh
    P_re = 0;
  } else if (q === 0) {
    P_re = need === 0 ? 1 : 0;
  } else {
    P_re = probBinomGE(nonHeld, need, q);
  }

  // Across M FS
  const eRetriggers = M * P_re;
  const probAnyRe = 1 - Math.pow(1 - P_re, M);
  const varRe = M * P_re * (1 - P_re);

  // Time-to-first (truncated at M)
  // E[T | first occurs] ≈ ∫_0^M (1 - F(t)) dt where F(t) = 1 - (1-P_re)^t
  // Discrete: E[min(T, M)] = Σ_{t=1..M} (1-P_re)^(t-1) (truncated)
  let eTimeToFirst = 0;
  if (P_re > 0 && P_re < 1) {
    // E[min(Geom(P_re), M)] = (1 − (1−P_re)^M) / P_re
    eTimeToFirst = (1 - Math.pow(1 - P_re, M)) / P_re;
  } else if (P_re === 1) {
    eTimeToFirst = 1;
  } else {
    eTimeToFirst = M; // never triggers
  }

  // Per-spin scatter metrics
  const eFresh = nonHeld * q;
  const eTotalScatter = K + eFresh;
  const eTotalScatterPay = M * eTotalScatter * scatterPay;

  return {
    totalReels: N,
    heldReels: K,
    freeSpins: M,
    freshScatterProbabilityPerReel: q,
    retriggerScatterThreshold: T,
    probRetriggerPerSpin: P_re,
    expectedFreshScattersPerSpin: eFresh,
    expectedTotalScattersPerSpin: eTotalScatter,
    expectedRetriggersAcrossFs: eRetriggers,
    probAnyRetriggerAcrossFs: probAnyRe,
    varianceRetriggers: varRe,
    expectedTimeToFirstRetrigger: eTimeToFirst,
    expectedTotalScatterPayAcrossFs: eTotalScatterPay,
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

export function simulateLockedReelsDuringFs(
  config: LockedReelsDuringFsConfig,
  episodes: number,
  seed: number,
): LockedReelsDuringFsMCResult {
  validate(config);
  const rng = makePrng(seed);
  const N = config.totalReels;
  const K = config.heldReels;
  const M = config.freeSpins;
  const q = config.freshScatterProbabilityPerReel;
  const T = config.retriggerScatterThreshold;
  const nonHeld = N - K;

  let sumRetriggers = 0;
  let sumFreshScatters = 0;
  let anyRetriggerCount = 0;

  for (let ep = 0; ep < episodes; ep++) {
    let retriggers = 0;
    let anyRe = false;
    for (let m = 0; m < M; m++) {
      let fresh = 0;
      for (let r = 0; r < nonHeld; r++) {
        if (rng() < q) fresh++;
      }
      sumFreshScatters += fresh;
      if (K + fresh >= T) {
        retriggers++;
        anyRe = true;
      }
    }
    sumRetriggers += retriggers;
    if (anyRe) anyRetriggerCount++;
  }

  return {
    episodes,
    observedMeanRetriggersPerEpisode: sumRetriggers / episodes,
    observedAnyRetriggerFraction: anyRetriggerCount / episodes,
    observedMeanFreshScattersPerSpin: sumFreshScatters / (episodes * M),
  };
}
