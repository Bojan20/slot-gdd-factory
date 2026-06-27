/**
 * W152 Wave 171 — Tumbling Cascade Chain Length Analyzer (57. solver).
 *
 * Iconic tumbling-slot mehanika — Pragmatic Sweet Bonanza / Sweet Bonanza Xmas /
 * Pragmatic Big Bass tumble bonus / Hacksaw Tombstone tumble / Push Money Cart 4
 * cascade / Quickspin Reactor Wilds / NetEnt Gonzo's Quest (original tumbling) /
 * Yggdrasil Vault of Anubis cascade.
 *
 * **57th closed-form solver** — chain length distribution u tumbling slot-u.
 * Per spin: ako winning combo postoji → winning symbols REMOVE, new symbols drop
 * → cascade. Per cascade, P(at least one win) = p (depends on grid state, but
 * approximated stationary ergodic).
 *
 * Chain length C = number of consecutive winning cascades until first failure:
 *   P(C = k) = p^k · (1 − p)   for k = 0, 1, 2, ...   (Geometric)
 *   P(C ≥ k) = p^k                                     (survival)
 *   E[C] = p / (1 − p)
 *   Var[C] = p / (1 − p)²
 *
 * Per-cascade payout Y_i (currency units in × bet) ima distribution sa
 * E[Y] and Var[Y] (operator config). Total spin payout = Σ_{i=1..C} Y_i sa
 * iid Y_i. **Wald's identity**:
 *   E[total] = E[C] · E[Y]
 *   Var[total] = E[C]·Var[Y] + Var[C]·(E[Y])²
 *
 * ── Distinct from ────────────────────────────────────────────────────────
 *   - W086 Cascade Sequential Multiplier Pyramid (deterministic per-step
 *     multiplier ladder)
 *   - W102 Cluster Compound Variance (Wald applied to compounded variance,
 *     not chain length distribution directly)
 *   - W121 Cascade Multiplier Chain Lockstep Conditional (conditional multiplier
 *     on each cascade)
 *   - W138 Tumble Multiplier with Cap (capped multiplier ladder)
 *   - W146 Cascade Meter Charge-Up (meter fires inside ONE spin's cascade run)
 *
 * Naming: "tumbling cascade", "chain length", "cascade survival" = generic
 * slot-design terms. No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface TumblingCascadeChainLengthConfig {
  /** Per-cascade probability of at least one win ∈ (0, 1). */
  probCascadeWin: number;
  /** E[payout per single winning cascade] in × bet units (≥ 0). */
  expectedPayoutPerCascade: number;
  /** Var[payout per single winning cascade] in × bet² (≥ 0). */
  variancePayoutPerCascade: number;
  /** Optional chain-length disclosure thresholds (e.g. [3, 5, 10] cascades). */
  disclosureChainThresholds?: number[];
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface TumblingCascadeChainLengthResult {
  /** E[chain length] = p / (1−p). */
  expectedChainLength: number;
  /** Var[chain length] = p / (1−p)². */
  varianceChainLength: number;
  /** Std dev. */
  stdDevChainLength: number;
  /** P(chain length ≥ k) for each threshold k (survival values). */
  chainSurvivalProbabilities: Array<{ threshold: number; survivalProb: number; oneInN: number }>;
  /** E[total spin payout] via Wald = E[C]·E[Y]. */
  expectedTotalPayoutPerSpin: number;
  /** Var[total spin payout] via Wald = E[C]·Var[Y] + Var[C]·(E[Y])². */
  varianceTotalPayoutPerSpin: number;
  /** Std dev. */
  stdDevTotalPayoutPerSpin: number;
  /** P(spin has at least one win) = p (per-spin trigger rate). */
  probAtLeastOneWinPerSpin: number;
  /** Regulator "1 in N spins" form for at-least-one-win. */
  oneInNSpinsAnyWin: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: TumblingCascadeChainLengthConfig): void {
  if (
    !Number.isFinite(cfg.probCascadeWin) ||
    cfg.probCascadeWin <= 0 ||
    cfg.probCascadeWin >= 1
  ) {
    throw new Error(`tumblingCascadeChainLength: probCascadeWin must be in (0, 1), got ${cfg.probCascadeWin}`);
  }
  if (!Number.isFinite(cfg.expectedPayoutPerCascade) || cfg.expectedPayoutPerCascade < 0) {
    throw new Error(`tumblingCascadeChainLength: expectedPayoutPerCascade must be ≥ 0, got ${cfg.expectedPayoutPerCascade}`);
  }
  if (!Number.isFinite(cfg.variancePayoutPerCascade) || cfg.variancePayoutPerCascade < 0) {
    throw new Error(`tumblingCascadeChainLength: variancePayoutPerCascade must be ≥ 0, got ${cfg.variancePayoutPerCascade}`);
  }
  if (cfg.disclosureChainThresholds !== undefined) {
    if (!Array.isArray(cfg.disclosureChainThresholds) || cfg.disclosureChainThresholds.length === 0) {
      throw new Error(`tumblingCascadeChainLength: disclosureChainThresholds must be non-empty array if given`);
    }
    for (const t of cfg.disclosureChainThresholds) {
      if (!Number.isInteger(t) || t < 1) {
        throw new Error(`tumblingCascadeChainLength: disclosureChainThresholds must contain only positive integers, got ${t}`);
      }
    }
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveTumblingCascadeChainLength(
  cfg: TumblingCascadeChainLengthConfig,
): TumblingCascadeChainLengthResult {
  validateConfig(cfg);

  const p = cfg.probCascadeWin;
  const q = 1 - p;
  const thresholds = cfg.disclosureChainThresholds ?? [3, 5, 10, 20];

  // Geometric moments (number of successes before first failure)
  const expectedChainLength = p / q;
  const varianceChainLength = p / (q * q);
  const stdDevChainLength = Math.sqrt(varianceChainLength);

  // Survival probabilities P(C ≥ k) = p^k for k = thresholds
  const chainSurvivalProbabilities = thresholds.map((k) => {
    const survivalProb = Math.pow(p, k);
    return {
      threshold: k,
      survivalProb,
      oneInN: survivalProb > 1e-300 ? 1 / survivalProb : Infinity,
    };
  });

  // Wald's identity for total spin payout
  const expectedTotalPayoutPerSpin = expectedChainLength * cfg.expectedPayoutPerCascade;
  const varianceTotalPayoutPerSpin =
    expectedChainLength * cfg.variancePayoutPerCascade +
    varianceChainLength * cfg.expectedPayoutPerCascade * cfg.expectedPayoutPerCascade;
  const stdDevTotalPayoutPerSpin = Math.sqrt(varianceTotalPayoutPerSpin);

  // P(spin has at least one winning cascade) = p (definition)
  const probAtLeastOneWinPerSpin = p;
  const oneInNSpinsAnyWin = 1 / p;

  return {
    expectedChainLength,
    varianceChainLength,
    stdDevChainLength,
    chainSurvivalProbabilities,
    expectedTotalPayoutPerSpin,
    varianceTotalPayoutPerSpin,
    stdDevTotalPayoutPerSpin,
    probAtLeastOneWinPerSpin,
    oneInNSpinsAnyWin,
  };
}

/** ── MC simulation (cross-validates closed-form) ────────────────────────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller standard-normal sample. */
function gaussianSample(rng: () => number): number {
  let u1 = rng();
  while (u1 < 1e-12) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface TumblingCascadeChainLengthMcResult {
  spins: number;
  observedExpectedChainLength: number;
  observedExpectedTotalPayoutPerSpin: number;
  observedStdDevTotalPayoutPerSpin: number;
  observedChainSurvivalProbabilities: Array<{ threshold: number; observedSurvivalProb: number }>;
}

/**
 * MC: per spin, draw cascade chain length ~ Geometric(p), then for each cascade
 * draw payout ~ Gaussian(E[Y], Var[Y]) via Box-Muller (approximation; real
 * paytable would be discrete but Wald identity holds for any iid distribution).
 */
export function simulateTumblingCascadeChainLength(
  cfg: TumblingCascadeChainLengthConfig,
  spins: number,
  seed: number,
): TumblingCascadeChainLengthMcResult {
  validateConfig(cfg);
  const rng = makeRng(seed);

  const p = cfg.probCascadeWin;
  const thresholds = cfg.disclosureChainThresholds ?? [3, 5, 10, 20];
  const stdY = Math.sqrt(cfg.variancePayoutPerCascade);

  let sumChain = 0;
  let totalPayouts: number[] = [];
  const chainCounts: number[] = [];
  const surviveCounts = new Array(thresholds.length).fill(0);

  for (let s = 0; s < spins; s++) {
    let chain = 0;
    let spinPayout = 0;
    // Each cascade succeeds with prob p; failure ends chain
    while (rng() < p) {
      // Draw payout for this cascade (raw Gaussian — Wald identity holds for
      // any iid distribution, no clipping to avoid biasing E[total] up).
      const y = cfg.expectedPayoutPerCascade + stdY * gaussianSample(rng);
      spinPayout += y;
      chain++;
    }
    sumChain += chain;
    chainCounts.push(chain);
    totalPayouts.push(spinPayout);
    for (let t = 0; t < thresholds.length; t++) {
      if (chain >= thresholds[t]) surviveCounts[t]++;
    }
  }

  const meanChain = sumChain / spins;
  const meanPayout = totalPayouts.reduce((a, b) => a + b, 0) / spins;
  const sumSq = totalPayouts.reduce((acc, x) => acc + (x - meanPayout) * (x - meanPayout), 0);
  const stdPayout = Math.sqrt(sumSq / spins);

  return {
    spins,
    observedExpectedChainLength: meanChain,
    observedExpectedTotalPayoutPerSpin: meanPayout,
    observedStdDevTotalPayoutPerSpin: stdPayout,
    observedChainSurvivalProbabilities: thresholds.map((threshold, i) => ({
      threshold,
      observedSurvivalProb: surviveCounts[i] / spins,
    })),
  };
}
