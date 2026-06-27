/**
 * W152 P0-7 — Hold & Win persistent-grid Markov solver.
 *
 * Closed-form RTP estimator for the canonical "Hold & Win" feature
 * (Money Train, Tree of Life class). The mechanic is naturally
 * non-Markov at the per-spin level (the grid keeps its state across
 * respins) but maps cleanly onto a Markov chain whose state is the
 * count of orb cells currently filled, plus the number of respins
 * remaining.
 *
 * State space:
 *   `(occupied, respinsLeft)`
 *     occupied   ∈ [0, totalCells]
 *     respinsLeft ∈ [0, respinsInitial + maxResetCount]
 *
 * Transition rule (per respin):
 *   1. Each empty cell independently lands a new orb with probability
 *      `pHit(occupied)`.
 *   2. If at least one new orb landed:
 *      - occupied' = occupied + landedCount
 *      - respinsLeft' = respinsInitial   (or *respinReset*, capped)
 *   3. Otherwise:
 *      - occupied'  = occupied
 *      - respinsLeft' = respinsLeft - 1
 *   4. The feature ends when `respinsLeft' = 0` OR `occupied' = totalCells`.
 *
 * Payout (in units of base bet) at end-of-feature:
 *   * sum of orb values (weighted draw per orb cell)
 *   * + fullGridBonus  when occupied = totalCells
 *
 * The exact orb value distribution is taken as an EV — the solver
 * returns the *expected* feature payout per trigger. Variance estimation
 * is delegated to MC; this solver is the "what's the analytical RTP
 * contribution?" oracle that the MC simulator validates against.
 *
 * Numerical notes:
 *   * Pure JS doubles. State space size is bounded:
 *       |S| ≤ totalCells × (respinsInitial × 4)
 *     For a 5×3 grid with 3 initial respins this is 15 × 12 = 180 states,
 *     trivial. For a 6×6 grid it is 36 × 12 = 432 — still trivial.
 *   * The chain is acyclic (occupied is non-decreasing each transition)
 *     so a single forward DP pass produces exact expectations without
 *     iterative convergence.
 *
 * Compliance / replay:
 *   * Deterministic: same config → same EV (byte-stable across JS engines
 *     because we only use arithmetic primitives, no Math.random / clocks).
 *   * Cross-validated against MC by `tests/holdandwin_markov.test.ts`.
 */

// ─── Input shape ─────────────────────────────────────────────────────────────

export interface OrbValueDist {
  /** Value in base-bet multiples. Cash orb or "jackpot pointer" tier. */
  value: number;
  /** Selection weight (non-normalised). */
  weight: number;
}

export interface HoldAndWinMarkovConfig {
  /** Total cells in the H&W grid (rows × reels). */
  totalCells: number;
  /** Respins granted when the feature starts. */
  respinsInitial: number;
  /** Respins replenished when one or more new orbs land. */
  respinResetOn: 'new_orb' | 'never';
  /** Number of orb cells at trigger time (typically equals scatter count). */
  initialOrbsOnTrigger: number;
  /** Probability an empty cell catches an orb on a single respin. */
  pHitPerEmpty: number;
  /** Distribution of single-orb values. Weights are normalised internally. */
  orbValues: OrbValueDist[];
  /** Payout multiplier (in base-bet units) when the grid fills completely. */
  fullGridBonus: number;
}

export interface HoldAndWinSolverResult {
  /** Expected feature payout (in base-bet multiples) per trigger. */
  expectedPayoutX: number;
  /** Probability the grid fills completely during the feature. */
  pFullGrid: number;
  /** Expected number of occupied cells at feature end. */
  expectedFinalOccupancy: number;
  /** Expected number of respins consumed (≤ respinsInitial). */
  expectedRespinsConsumed: number;
  /** Mean orb value (single-orb EV in base-bet multiples). */
  meanOrbValueX: number;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function meanOrbValue(orbs: OrbValueDist[]): number {
  let totalW = 0;
  let sumWV = 0;
  for (const o of orbs) {
    if (o.weight <= 0 || !Number.isFinite(o.weight)) continue;
    if (!Number.isFinite(o.value)) continue;
    totalW += o.weight;
    sumWV += o.weight * o.value;
  }
  return totalW > 0 ? sumWV / totalW : 0;
}

/** Binomial coefficient C(n, k) using a small-table approach. */
function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let v = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) {
    v = (v * (n - i)) / (i + 1);
  }
  return v;
}

/**
 * Probability distribution of new orbs landing in `emptyCount` cells,
 * each independently with probability `p`. Returns array `dist[k]` for
 * `k = 0..emptyCount`.
 */
function landingPmf(emptyCount: number, p: number): number[] {
  if (emptyCount <= 0) {
    return [1]; // No empty cells — nothing can land.
  }
  if (p <= 0) {
    const a = new Array<number>(emptyCount + 1).fill(0);
    a[0] = 1;
    return a;
  }
  if (p >= 1) {
    const a = new Array<number>(emptyCount + 1).fill(0);
    a[emptyCount] = 1;
    return a;
  }
  const a = new Array<number>(emptyCount + 1).fill(0);
  for (let k = 0; k <= emptyCount; k++) {
    a[k] = binom(emptyCount, k) * Math.pow(p, k) * Math.pow(1 - p, emptyCount - k);
  }
  return a;
}

// ─── Solver ──────────────────────────────────────────────────────────────────

/**
 * Compute the analytical H&W feature expectation via forward DP.
 *
 * Throws on negative / NaN inputs to fail loudly during config load.
 */
export function solveHoldAndWinRtp(
  cfg: HoldAndWinMarkovConfig,
): HoldAndWinSolverResult {
  // ── Validation ────────────────────────────────────────────────────────
  if (!Number.isFinite(cfg.totalCells) || cfg.totalCells <= 0) {
    throw new Error('solveHoldAndWinRtp: totalCells must be a positive number');
  }
  if (!Number.isFinite(cfg.respinsInitial) || cfg.respinsInitial < 0) {
    throw new Error('solveHoldAndWinRtp: respinsInitial must be ≥ 0');
  }
  if (
    !Number.isFinite(cfg.pHitPerEmpty) ||
    cfg.pHitPerEmpty < 0 ||
    cfg.pHitPerEmpty > 1
  ) {
    throw new Error('solveHoldAndWinRtp: pHitPerEmpty must be in [0, 1]');
  }
  if (cfg.initialOrbsOnTrigger < 0 || cfg.initialOrbsOnTrigger > cfg.totalCells) {
    throw new Error(
      'solveHoldAndWinRtp: initialOrbsOnTrigger must be in [0, totalCells]',
    );
  }

  const N = cfg.totalCells;
  const R0 = Math.max(1, Math.floor(cfg.respinsInitial)); // 0 → no respins; treat as 1 chance.
  const orbMean = meanOrbValue(cfg.orbValues);
  const fullBonus = Number.isFinite(cfg.fullGridBonus) ? cfg.fullGridBonus : 0;

  // ── DP table ──────────────────────────────────────────────────────────
  // prob[occ][respinsLeft] = probability of being in this state at some
  //                          point during the feature
  // We propagate from the initial state forwards. Terminal contributions
  // (full grid OR respinsLeft = 0) accrue to aggregates immediately.
  const prob: number[][] = [];
  for (let o = 0; o <= N; o++) prob.push(new Array<number>(R0 + 1).fill(0));

  // Initial state: occupied = initialOrbsOnTrigger, respinsLeft = R0.
  prob[cfg.initialOrbsOnTrigger][R0] = 1;

  let pFull = 0;
  let expectedOccupancyAtEnd = 0;
  let expectedRespinsConsumed = 0;

  // DP order is critical here. Each transition moves either to a *strictly
  // higher* occupancy (hit branches) or to the same occupancy with rl-1
  // (no-hit branch). Hits with respinResetOn='new_orb' bounce respinsLeft
  // back up to R0 *but only at a strictly higher occupancy* — so iterating
  // outer occupancy ascending, inner rl descending visits every state
  // exactly once and never leaves stale mass behind.
  for (let occ = cfg.initialOrbsOnTrigger; occ <= N; occ++) {
    for (let rl = R0; rl >= 1; rl--) {
      const mass = prob[occ][rl];
      if (mass === 0) continue;
      const empty = N - occ;

      // Special: occ = N means the grid is full — terminal.
      if (empty === 0) {
        pFull += mass;
        expectedOccupancyAtEnd += mass * occ;
        expectedRespinsConsumed += mass * (R0 - rl); // already done previously
        prob[occ][rl] = 0;
        continue;
      }

      const pmf = landingPmf(empty, cfg.pHitPerEmpty);
      // pmf[0] = nothing lands; pmf[k] = k new orbs land for k > 0.
      const noHitMass = mass * pmf[0];

      // No-hit branch: respinsLeft - 1.
      if (rl - 1 === 0) {
        // Terminal: ran out of respins, occupancy stays at occ.
        expectedOccupancyAtEnd += noHitMass * occ;
        expectedRespinsConsumed += noHitMass * R0;
      } else {
        prob[occ][rl - 1] += noHitMass;
      }

      // Hit branches (≥ 1 orb).
      const useReset = cfg.respinResetOn === 'new_orb';
      for (let k = 1; k <= empty; k++) {
        const hitMass = mass * pmf[k];
        if (hitMass === 0) continue;
        const occNext = occ + k;
        if (occNext >= N) {
          // Full grid → terminal.
          pFull += hitMass;
          expectedOccupancyAtEnd += hitMass * N;
          expectedRespinsConsumed += hitMass * (R0 - rl + 1);
          continue;
        }
        const rlNext = useReset ? R0 : rl - 1;
        if (rlNext === 0) {
          // Out of respins this transition.
          expectedOccupancyAtEnd += hitMass * occNext;
          expectedRespinsConsumed += hitMass * R0;
        } else {
          prob[occNext][rlNext] += hitMass;
        }
      }

      prob[occ][rl] = 0;
    }
  }

  // ── Aggregate payout ──────────────────────────────────────────────────
  // Each orb at feature end contributes the mean orb value, then full
  // grid pays its bonus on top. (This is the standard
  // money-train-class accounting: orb values are paid out PLUS the
  // full-grid bonus when applicable.)
  const expectedPayoutX = orbMean * expectedOccupancyAtEnd + pFull * fullBonus;

  return {
    expectedPayoutX,
    pFullGrid: pFull,
    expectedFinalOccupancy: expectedOccupancyAtEnd,
    expectedRespinsConsumed,
    meanOrbValueX: orbMean,
  };
}

// ─── Exposed internals (tests + tooling only) ───────────────────────────────

export const __hawMarkovInternals = { binom, landingPmf, meanOrbValue };
