/**
 * W152 Wave 54 — Megacluster Stack-Reveal Ways hybrid (Faza 12 ⚠️→✅).
 *
 * Closes Faza 12 scenario "⚠️ Megacluster + reveal-stack-ways hybrid" by
 * adding a clean-room closed-form solver for the popular mechanic family
 * where each reel position represents a STACK of cells that all reveal
 * the same symbol. Total "ways" for a winning symbol = product of stack
 * sizes across the reels that contain the target symbol.
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * Pattern P-001 (Variable-Ways Cascade) generalized to N independent reels
 * with per-reel STACK_SIZE drawn from a discrete PMF + per-reel symbol
 * match probability. Different from a fixed-rows variable-ways evaluator
 * because the reveal step expands cells dynamically per spin.
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Megacluster" + "stack reveal" + "ways" are generic descriptive
 *     terms; no vendor-specific marks.
 *   • Verified by `check-reserved-terms.sh`.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N reels independently:
 *   1. Stack size S_c ∼ stackSizePmf (discrete, S_c ≥ 1)
 *   2. Lead symbol = TARGET with probability p, else not target
 *
 * Both are independent across reels.
 *
 * A spin produces a "k-match" if exactly k of N reels show TARGET. Given
 * k matches, the ways count for TARGET is:
 *
 *   W_k = Π_{c: matched} S_c
 *
 * Conditional on k matches, the matched stack sizes are k iid samples of
 * stackSizePmf, so:
 *
 *   E[W_k | k matches]  = (E[S])^k
 *   E[W_k² | k matches] = (E[S²])^k
 *
 * If paytable(k) is the per-way payout in X for k-match (paytable[k_min..N]):
 *
 *   payout Y = paytable(k) × W_k   (Y = 0 if k < k_min)
 *
 *   E[Y]  = Σ_{k=k_min..N} P(K=k) · paytable(k) · E[S]^k
 *   E[Y²] = Σ_{k=k_min..N} P(K=k) · paytable(k)² · E[S²]^k
 *   Var[Y] = E[Y²] − E[Y]²
 *
 *   P(K=k) = C(N, k) · p^k · (1−p)^(N−k)
 *
 * ── Optional max-ways cap ─────────────────────────────────────────────────
 * If maxWaysCap is provided, W_k is clipped at the cap. The truncated
 * expectation is computed by enumerating the exact joint PMF of matched
 * stack sizes (k ≤ N, stack PMF small) — O(N × |stackPmf|^N) worst case,
 * fine for typical N ≤ 8 with |stackPmf| ≤ 6.
 *
 * ── Cluster reveal extension ──────────────────────────────────────────────
 * Some games apply a cluster bonus when the same target appears on
 * ALL N reels (k=N). Modeled here as `bonusOnFullMatchX` added to the
 * payout when k = N.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateMegaclusterStackWays() MC reference. Acceptance script
 * validates 6 synthetic configs × 200K MC spinova within ±2% relative
 * on E[Y] and ±10% on Var[Y].
 *
 * ── References ────────────────────────────────────────────────────────────
 * Norris 1997: independence + product of expectations.
 * Standard binomial + paytable formulas.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface StackOutcome {
  /** Stack size (cells revealed per reel). Must be integer ≥ 1. */
  stackSize: number;
  /** Weight in discrete distribution. */
  weight: number;
}

export interface MegaclusterConfig {
  /** Number of reels (N ≥ 2). */
  numReels: number;
  /** Stack size discrete distribution (shared by all reels). */
  stackSizePmf: StackOutcome[];
  /** Probability that a reel's lead symbol = TARGET. */
  pTargetPerReel: number;
  /**
   * Per-k-match payout in X. Index 0..N. paytable[k] = 0 for k < k_min.
   * Length must be numReels + 1.
   */
  paytableByMatches: number[];
  /** Optional cap on ways product W (clip W_k at this value). Default: no cap. */
  maxWaysCap?: number;
  /** Bonus added on full-match (k = N) in X. Default 0. */
  bonusOnFullMatchX?: number;
}

export interface MegaclusterResult {
  /** E[S]. */
  expectedStackSize: number;
  /** E[S²]. */
  expectedStackSizeSquared: number;
  /** P(K = k) for k ∈ [0..N]. */
  matchCountPmf: number[];
  /** E[ways product | K = k] = E[S]^k for k matches. */
  expectedWaysByK: number[];
  /** E[Y | K = k] = paytable(k) × E[W_k]. */
  expectedPayoutByK: number[];
  /** P(K = k) × E[payout | k] sum: E[Y]. */
  expectedPayoutPerSpin: number;
  /** Var[Y]. */
  variancePayoutPerSpin: number;
  /** σ[Y]. */
  stdDevPayoutPerSpin: number;
  /** P(Y > 0). */
  probAnyPayout: number;
  /** Hit rate target ≥ k_min (where paytable becomes non-zero). */
  hitRate: number;
}

export interface MegaclusterMCResult {
  observedSpins: number;
  observedMeanPayout: number;
  observedVariancePayout: number;
  observedStdDevPayout: number;
  observedHitRate: number;
  observedMeanWays: number;
  observedMeanK: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: MegaclusterConfig): void {
  if (!Number.isInteger(cfg.numReels) || cfg.numReels < 2) {
    throw new Error(`numReels must be integer ≥ 2, got ${cfg.numReels}`);
  }
  if (!Array.isArray(cfg.stackSizePmf) || cfg.stackSizePmf.length === 0) {
    throw new Error(`stackSizePmf must be non-empty array`);
  }
  for (const o of cfg.stackSizePmf) {
    if (!Number.isInteger(o.stackSize) || o.stackSize < 1) {
      throw new Error(`stackSize must be positive integer, got ${o.stackSize}`);
    }
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      throw new Error(`stackSizePmf: weight must be positive finite, got ${o.weight}`);
    }
  }
  if (cfg.pTargetPerReel < 0 || cfg.pTargetPerReel > 1) {
    throw new Error(`pTargetPerReel must be in [0,1], got ${cfg.pTargetPerReel}`);
  }
  if (!Array.isArray(cfg.paytableByMatches) || cfg.paytableByMatches.length !== cfg.numReels + 1) {
    throw new Error(`paytableByMatches must have length numReels+1 = ${cfg.numReels + 1}`);
  }
  for (const v of cfg.paytableByMatches) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`paytable entries must be non-negative finite, got ${v}`);
    }
  }
  if (cfg.maxWaysCap !== undefined) {
    if (!Number.isFinite(cfg.maxWaysCap) || cfg.maxWaysCap <= 0) {
      throw new Error(`maxWaysCap must be positive finite if provided`);
    }
  }
  if (cfg.bonusOnFullMatchX !== undefined) {
    if (!Number.isFinite(cfg.bonusOnFullMatchX) || cfg.bonusOnFullMatchX < 0) {
      throw new Error(`bonusOnFullMatchX must be non-negative finite`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function meanStack(dist: StackOutcome[]): number {
  let totalW = 0;
  let totalV = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalV += o.weight * o.stackSize;
  }
  return totalV / totalW;
}

export function meanStackSquared(dist: StackOutcome[]): number {
  let totalW = 0;
  let totalSq = 0;
  for (const o of dist) {
    totalW += o.weight;
    totalSq += o.weight * o.stackSize * o.stackSize;
  }
  return totalSq / totalW;
}

function logBinomial(n: number, k: number): number {
  let lg = 0;
  for (let i = 0; i < k; i++) lg += Math.log(n - i) - Math.log(i + 1);
  return lg;
}

function binomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logBinomial(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

// ── Closed-form solver ─────────────────────────────────────────────────────

export function solveMegaclusterStackWays(config: MegaclusterConfig): MegaclusterResult {
  validate(config);

  const N = config.numReels;
  const p = config.pTargetPerReel;
  const eS = meanStack(config.stackSizePmf);
  const eS2 = meanStackSquared(config.stackSizePmf);
  const bonus = config.bonusOnFullMatchX ?? 0;
  const cap = config.maxWaysCap;

  // P(K = k)
  const matchPmf = new Array<number>(N + 1).fill(0);
  for (let k = 0; k <= N; k++) {
    matchPmf[k] = binomialPmf(N, k, p);
  }

  // Compute E[W_k] and E[W_k²] either via E[S]^k / E[S²]^k closed form
  // OR enumeration if cap is specified.
  const eWaysByK = new Array<number>(N + 1).fill(0);
  const eWaysSqByK = new Array<number>(N + 1).fill(0);

  if (cap === undefined) {
    for (let k = 0; k <= N; k++) {
      eWaysByK[k] = Math.pow(eS, k);
      eWaysSqByK[k] = Math.pow(eS2, k);
    }
  } else {
    // Enumerate joint stack distribution conditional on k matches.
    // Since matched stacks are iid, the joint PMF of (S_1, ..., S_k) factors.
    // Enumerate by recursion / iterative product.
    const totalW = config.stackSizePmf.reduce((a, o) => a + o.weight, 0);
    const pmf = config.stackSizePmf.map((o) => ({ s: o.stackSize, p: o.weight / totalW }));
    // For each k, dp = map(productSoFar → probability)
    for (let k = 0; k <= N; k++) {
      if (k === 0) {
        eWaysByK[0] = 1; // empty product
        eWaysSqByK[0] = 1;
        continue;
      }
      let dist = new Map<number, number>();
      dist.set(1, 1);
      for (let step = 0; step < k; step++) {
        const next = new Map<number, number>();
        for (const [prod, pr] of dist) {
          for (const { s, p: ps } of pmf) {
            const newProd = Math.min(prod * s, cap);
            next.set(newProd, (next.get(newProd) ?? 0) + pr * ps);
          }
        }
        dist = next;
      }
      let mw = 0;
      let mwSq = 0;
      for (const [w, pr] of dist) {
        mw += w * pr;
        mwSq += w * w * pr;
      }
      eWaysByK[k] = mw;
      eWaysSqByK[k] = mwSq;
    }
  }

  // E[Y | K=k] = paytable(k) × E[W_k]  (+ bonus if k==N)
  // E[Y²| K=k] = paytable(k)² × E[W_k²] + 2 × paytable(k) × bonus × E[W_k] + bonus²
  //             (when k == N; else bonus contribution is 0)
  const eYByK = new Array<number>(N + 1).fill(0);
  const eY2ByK = new Array<number>(N + 1).fill(0);
  for (let k = 0; k <= N; k++) {
    const pay = config.paytableByMatches[k];
    const isFull = k === N;
    const bn = isFull ? bonus : 0;
    eYByK[k] = pay * eWaysByK[k] + bn;
    // (paytable × W + bn)² = paytable² × W² + 2·paytable·bn·W + bn²
    eY2ByK[k] = pay * pay * eWaysSqByK[k] + 2 * pay * bn * eWaysByK[k] + bn * bn;
  }

  let eY = 0;
  let eY2 = 0;
  let hitRate = 0;
  let probAny = 0;
  for (let k = 0; k <= N; k++) {
    eY += matchPmf[k] * eYByK[k];
    eY2 += matchPmf[k] * eY2ByK[k];
    if (config.paytableByMatches[k] > 0 || (k === N && bonus > 0)) {
      hitRate += matchPmf[k];
    }
    if (eYByK[k] > 0) probAny += matchPmf[k];
  }
  const varY = Math.max(0, eY2 - eY * eY);

  return {
    expectedStackSize: eS,
    expectedStackSizeSquared: eS2,
    matchCountPmf: matchPmf,
    expectedWaysByK: eWaysByK,
    expectedPayoutByK: eYByK,
    expectedPayoutPerSpin: eY,
    variancePayoutPerSpin: varY,
    stdDevPayoutPerSpin: Math.sqrt(varY),
    probAnyPayout: probAny,
    hitRate,
  };
}

// ── Monte Carlo reference solver ───────────────────────────────────────────

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

function sampleStackSize(dist: StackOutcome[], rng: () => number): number {
  let total = 0;
  for (const o of dist) total += o.weight;
  let r = rng() * total;
  for (const o of dist) {
    r -= o.weight;
    if (r < 0) return o.stackSize;
  }
  return dist[dist.length - 1].stackSize;
}

export function simulateMegaclusterStackWays(
  config: MegaclusterConfig,
  spins: number,
  seed: number,
): MegaclusterMCResult {
  validate(config);
  const rng = makePrng(seed);
  const N = config.numReels;
  const p = config.pTargetPerReel;
  const cap = config.maxWaysCap;
  const bonus = config.bonusOnFullMatchX ?? 0;
  let sumY = 0;
  let sumY2 = 0;
  let hits = 0;
  let sumWays = 0;
  let sumK = 0;
  for (let s = 0; s < spins; s++) {
    let ways = 1;
    let k = 0;
    for (let c = 0; c < N; c++) {
      const sc = sampleStackSize(config.stackSizePmf, rng);
      const isTarget = rng() < p;
      if (isTarget) {
        k++;
        ways *= sc;
        if (cap !== undefined && ways > cap) ways = cap;
      }
    }
    const pay = config.paytableByMatches[k];
    const fullBonus = k === N ? bonus : 0;
    const y = (k > 0 ? pay * ways : 0) + fullBonus;
    sumY += y;
    sumY2 += y * y;
    sumK += k;
    sumWays += k > 0 ? ways : 0;
    if (y > 0) hits++;
  }
  const meanY = sumY / spins;
  const varY = sumY2 / spins - meanY * meanY;
  return {
    observedSpins: spins,
    observedMeanPayout: meanY,
    observedVariancePayout: varY,
    observedStdDevPayout: Math.sqrt(Math.max(0, varY)),
    observedHitRate: hits / spins,
    observedMeanWays: sumWays / spins,
    observedMeanK: sumK / spins,
  };
}
