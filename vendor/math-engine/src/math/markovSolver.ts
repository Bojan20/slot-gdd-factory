/**
 * Hold & Win Markov Solver — Faza 6.
 *
 * Exact closed-form (no Monte Carlo) computation of expected payout,
 * orb count, and grid-fill probability for Hold & Win respin features
 * using bottom-up dynamic programming on the (k, r) state space.
 *
 * State: (k, r) where k = locked cells, r = respins remaining.
 * Transition: Binomial(totalCells - k, p(k)) new landings per respin.
 * Per-cell landing probability: p(k) = baseChance + (k / totalCells) * fillBonusCap
 */

import type { Feature } from '../ir/types.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HoldAndWinConfig {
  /** numCols × numRows */
  totalCells: number;
  /** feature.respins_initial */
  initialRespins: number;
  /** default 0.035 */
  baseChance: number;
  /** default 0.025 */
  fillBonusCap: number;
  /** weighted average of cash_value_distribution */
  expectedCellValue: number;
  /** feature.respin_reset_on_new */
  respinResetOnNew: boolean;
  /** 0 if no award */
  gridFullAward: number;
  /** how many cells locked at trigger (usually the trigger count) */
  initLockedCells: number;
}

export interface HoldAndWinResult {
  /** E[total payout] from initLockedCells trigger */
  expectedPayout: number;
  /** E[final locked cells] */
  expectedOrbCount: number;
  /** P(grid fills completely) */
  gridFullProbability: number;
  expectedRespinsUsed: number;
  /** V[k][r] for all states (for debugging/PAR) */
  stateValues: number[][];
}

// ─── Binomial helpers ──────────────────────────────────────────────────────

/**
 * Build Pascal's triangle of binomial coefficients C(n, k) for n in [0, maxN].
 * Returns a 2D array where pascal[n][k] = C(n, k).
 */
function buildPascalTriangle(maxN: number): number[][] {
  const C: number[][] = [];
  for (let n = 0; n <= maxN; n++) {
    C[n] = new Array<number>(n + 1).fill(0);
    C[n]![0] = 1;
    C[n]![n] = 1;
    for (let k = 1; k < n; k++) {
      C[n]![k] = (C[n - 1]![k - 1] ?? 0) + (C[n - 1]![k] ?? 0);
    }
  }
  return C;
}

/**
 * Compute Binomial PMF P(X = j) where X ~ Binomial(n, p) for all j in [0, n].
 *
 * Uses log-space arithmetic when n is large (n > 30) to avoid floating-point
 * underflow/overflow in the direct computation p^j * (1-p)^(n-j).
 */
function binomialPMF(n: number, p: number, C: number[][]): number[] {
  const pmf = new Array<number>(n + 1).fill(0);

  if (p <= 0) {
    pmf[0] = 1;
    return pmf;
  }
  if (p >= 1) {
    pmf[n] = 1;
    return pmf;
  }

  const logP = Math.log(p);
  const logQ = Math.log(1 - p);

  for (let j = 0; j <= n; j++) {
    const c = C[n]?.[j] ?? 0;
    if (c === 0) {
      pmf[j] = 0;
      continue;
    }
    // Use log-space to maintain numerical stability for large n
    const logC = Math.log(c);
    pmf[j] = Math.exp(logC + j * logP + (n - j) * logQ);
  }

  return pmf;
}

// ─── State probability tracking helpers ───────────────────────────────────

/**
 * Bottom-up DP for grid full probability and expected orb count.
 * We track P[k][r] = probability of being in state (k, r) when starting
 * from (k0, r0). This is a forward pass separate from the value DP.
 */
function computeStateDistribution(
  config: HoldAndWinConfig,
  C: number[][],
): { gridFullProb: number; expectedOrbs: number; expectedRespinsUsed: number } {
  const { totalCells, initialRespins, baseChance, fillBonusCap, respinResetOnNew } = config;

  // prob[k][r] = probability of being in state (k, r) at some point during play
  // We simulate forward from (initLockedCells, initialRespins)
  // termination: r = 0 (no more respins) or k = totalCells (grid full)

  // Use a map for sparsity
  const current = new Map<string, number>();
  const key = (k: number, r: number): string => `${k},${r}`;

  current.set(key(config.initLockedCells, initialRespins), 1.0);

  let gridFullProb = 0;
  // If already full at start
  if (config.initLockedCells >= totalCells) {
    return { gridFullProb: 1, expectedOrbs: totalCells, expectedRespinsUsed: 0 };
  }

  // terminal state probabilities (k at end, r=0 or k=total)
  const terminalProb = new Map<number, number>(); // k → probability of ending there
  let totalRespinsUsed = 0;

  const iterations = (totalCells + 1) * (initialRespins + 1) * 4;
  let safetyCounter = 0;

  while (current.size > 0 && safetyCounter++ < iterations) {
    const next = new Map<string, number>();

    for (const [stateKey, prob] of current) {
      const parts = stateKey.split(',');
      const k = parseInt(parts[0] ?? '0', 10);
      const r = parseInt(parts[1] ?? '0', 10);

      if (k >= totalCells) {
        // Grid full — terminal
        gridFullProb += prob;
        const prev = terminalProb.get(k) ?? 0;
        terminalProb.set(k, prev + prob);
        continue;
      }

      if (r === 0) {
        // No more respins — terminal
        const prev = terminalProb.get(k) ?? 0;
        terminalProb.set(k, prev + prob);
        continue;
      }

      // One respin: draw from Binomial(n, p(k))
      const n = totalCells - k;
      const pk = baseChance + (k / totalCells) * fillBonusCap;
      const pmf = binomialPMF(n, pk, C);

      // Count this as using 1 respin
      totalRespinsUsed += prob;

      // j = 0: no new cells, r → r-1
      const p0 = pmf[0] ?? 0;
      if (p0 > 0) {
        const nextKey = key(k, r - 1);
        next.set(nextKey, (next.get(nextKey) ?? 0) + prob * p0);
      }

      // j > 0: new cells, possibly reset respins
      for (let j = 1; j <= n; j++) {
        const pj = pmf[j] ?? 0;
        if (pj < 1e-15) continue;
        const newK = k + j;
        const newR = respinResetOnNew ? initialRespins : r - 1;

        if (newK >= totalCells) {
          gridFullProb += prob * pj;
          const prev = terminalProb.get(totalCells) ?? 0;
          terminalProb.set(totalCells, prev + prob * pj);
        } else {
          const nextKey = key(newK, newR);
          next.set(nextKey, (next.get(nextKey) ?? 0) + prob * pj);
        }
      }
    }

    current.clear();
    for (const [k2, v] of next) {
      if (v > 1e-15) current.set(k2, v);
    }
  }

  // Drain any remaining current states as terminals (safety)
  for (const [stateKey, prob] of current) {
    const parts = stateKey.split(',');
    const k = parseInt(parts[0] ?? '0', 10);
    const prev = terminalProb.get(k) ?? 0;
    terminalProb.set(k, prev + prob);
    if (k >= totalCells) gridFullProb += prob;
  }

  let expectedOrbs = 0;
  for (const [k, p] of terminalProb) {
    expectedOrbs += k * p;
  }

  return { gridFullProb, expectedOrbs, expectedRespinsUsed: totalRespinsUsed };
}

// ─── Main DP solver ────────────────────────────────────────────────────────

/**
 * Solve Hold & Win using bottom-up DP on state (k, r).
 *
 * V[k][r] = E[total payout from state (k, r)]
 *
 * Cell values are collected AT GAME END (in the base case), NOT when cells
 * land during respins.  The base case already accounts for all k locked cells.
 *
 * Base cases:
 *   V[k][0] = k * E_cell + (k === totalCells ? gridFullAward : 0)
 *   V[totalCells][r] = totalCells * E_cell + gridFullAward  for all r
 *
 * Recursion (respinResetOnNew = true):
 *   V[k][r] = P(B(n,p)=0) × V[k][r-1]
 *            + Σ_{j=1}^{n} P(B(n,p)=j) × V[k+j][initialRespins]
 *
 * Recursion (respinResetOnNew = false):
 *   V[k][r] = P(B(n,p)=0) × V[k][r-1]
 *            + Σ_{j=1}^{n} P(B(n,p)=j) × V[k+j][r-1]
 *
 * Note: no "j × E_cell" addend in the transition — those cells are captured
 * via V[k+j][...] which eventually terminates at V[k+j][0] = (k+j)×E_cell.
 * Adding them here would double-count.
 */
export function solveHoldAndWin(config: HoldAndWinConfig): HoldAndWinResult {
  const {
    totalCells,
    initialRespins,
    baseChance,
    fillBonusCap,
    expectedCellValue,
    respinResetOnNew,
    gridFullAward,
    initLockedCells,
  } = config;

  if (totalCells > 100) {
    throw new Error(`totalCells ${totalCells} exceeds safety cap of 100`);
  }
  if (totalCells <= 0) {
    throw new Error(`totalCells must be positive, got ${totalCells}`);
  }

  const C = buildPascalTriangle(totalCells);

  // Allocate V[k][r]: (totalCells+1) rows × (initialRespins+1) columns
  const V: number[][] = [];
  for (let k = 0; k <= totalCells; k++) {
    V.push(new Array<number>(initialRespins + 1).fill(0));
  }

  // ── Base cases ────────────────────────────────────────────────────────

  // V[k][0] for k < totalCells: collect existing k cells, no more respins
  for (let k = 0; k <= totalCells; k++) {
    const base = k * expectedCellValue + (k === totalCells ? gridFullAward : 0);
    V[k]![0] = base;
  }

  // V[totalCells][r] for all r: grid is full, collect everything
  const fullGridPayout = totalCells * expectedCellValue + gridFullAward;
  for (let r = 0; r <= initialRespins; r++) {
    V[totalCells]![r] = fullGridPayout;
  }

  // ── Bottom-up DP ──────────────────────────────────────────────────────
  //
  // For respinResetOnNew = false:
  //   Standard layered DP: fill r=1..R, within each r fill k from totalCells-1
  //   to 0.  Hit branch uses V[k+j][r-1] (already filled).
  //
  // For respinResetOnNew = true:
  //   All hit transitions reset to V[k+j][R] (R = initialRespins), creating a
  //   circular dependency: V[k][R] uses V[k][R-1] (miss) AND V[k+j][R] (hit).
  //   After substituting the recurrence for miss layers we get a closed-form
  //   for the initialRespins layer that only depends on higher-k values:
  //
  //     Let p0 = P(Binom(n,p) = 0),  H(k) = Σ_{j≥1} P(j) × V[k+j][R]
  //
  //     V[k][r] = p0^r × V[k][0]  +  H(k) × (1 - p0^r) / (1 - p0)
  //
  //   The special case p0 = 1 (n=0 empty cells, impossible since k < totalCells;
  //   handled by the boundary V[totalCells][r] above): not reached.
  //   When 1-p0 ≈ 0 but n > 0 we fall back to: H(k) × r  (L'Hôpital limit).
  //
  //   Algorithm:
  //     1. Sweep k from totalCells-1 to 0:
  //        a. Compute H(k) = Σ_{j≥1} P(j) × V[k+j][R]  (V[k+j][R] already ready)
  //        b. For each r = 1..R, set V[k][r] = p0^r × V[k][0] + H(k) × geo(r, p0)
  //           where geo(r, p0) = (1 - p0^r) / (1 - p0)  [or r if p0 ≈ 1]
  //     This fills all layers simultaneously per k, bottom-up in k.

  if (respinResetOnNew) {
    const R = initialRespins;
    if (R >= 1) {
      // Sweep k from totalCells-1 down to 0
      for (let k = totalCells - 1; k >= 0; k--) {
        const n = totalCells - k;
        const pk = baseChance + (k / totalCells) * fillBonusCap;
        const pmf = binomialPMF(n, pk, C);
        const p0 = pmf[0] ?? 0;

        // H(k) = Σ_{j=1}^{n} P(j) × V[k+j][R]
        // All V[k+j][R] have been set for k+j > k in previous iterations.
        let H = 0;
        for (let j = 1; j <= n; j++) {
          const pj = pmf[j] ?? 0;
          if (pj < 1e-15) continue;
          H += pj * (V[k + j]![R] ?? 0);
        }

        // Fill all r-layers for this k simultaneously
        const v0 = V[k]![0] ?? 0;
        for (let r = 1; r <= R; r++) {
          const p0r = Math.pow(p0, r);
          let geoSum: number;
          if (Math.abs(1 - p0) < 1e-14) {
            // p0 ≈ 1 → all n cells land with probability ≈ 0 → degenerate
            // geo(r, 1) = r (L'Hôpital: limit as p0→1 of (1-p0^r)/(1-p0) = r)
            geoSum = r;
          } else {
            geoSum = (1 - p0r) / (1 - p0);
          }
          V[k]![r] = p0r * v0 + H * geoSum;
        }
      }
    }
  } else {
    // respinResetOnNew=false: standard layered DP.
    for (let r = 1; r <= initialRespins; r++) {
      for (let k = totalCells - 1; k >= 0; k--) {
        const n = totalCells - k;
        const pk = baseChance + (k / totalCells) * fillBonusCap;
        const pmf = binomialPMF(n, pk, C);

        const p0 = pmf[0] ?? 0;
        // j=0: go to (k, r-1)
        let val = p0 * (V[k]![r - 1] ?? 0);
        // j≥1: go to (k+j, r-1) — no reset
        for (let j = 1; j <= n; j++) {
          const pj = pmf[j] ?? 0;
          if (pj < 1e-15) continue;
          val += pj * (V[k + j]![r - 1] ?? 0);
        }
        V[k]![r] = val;
      }
    }
  }

  // ── Compute additional statistics via forward pass ─────────────────────
  const { gridFullProb, expectedOrbs, expectedRespinsUsed } =
    computeStateDistribution(config, C);

  const expectedPayout = V[initLockedCells]![initialRespins] ?? 0;

  return {
    expectedPayout,
    expectedOrbCount: expectedOrbs,
    gridFullProbability: Math.min(1, Math.max(0, gridFullProb)),
    expectedRespinsUsed,
    stateValues: V,
  };
}

// ─── IR builder ────────────────────────────────────────────────────────────

/**
 * Build HoldAndWinConfig from an IR Feature (hold_and_win kind).
 *
 * @param feature   The hold_and_win Feature from the IR.
 * @param totalCells  numCols × numRows of the game grid.
 * @param initLockedCells  How many cells are locked at trigger (e.g. scatter count).
 */
export function buildHnwConfig(
  feature: Extract<Feature, { kind: 'hold_and_win' }>,
  totalCells: number,
  initLockedCells: number,
): HoldAndWinConfig {
  // Weighted average of cash_value_distribution
  const dist = feature.cash_value_distribution;
  const totalWeight = dist.reduce((s, d) => s + d.weight, 0);
  const expectedCellValue =
    totalWeight > 0
      ? dist.reduce((s, d) => s + d.value * d.weight, 0) / totalWeight
      : 0;

  // grid_full_award: the IR stores it as a string reference to a jackpot tier id.
  // For the analytical model we use 0 unless the caller overrides — the
  // jackpot tier multiplier is handled separately by JackpotManager.
  const gridFullAward = 0;

  return {
    totalCells,
    initialRespins: feature.respins_initial,
    baseChance: 0.035,
    fillBonusCap: 0.025,
    expectedCellValue,
    respinResetOnNew: feature.respin_reset_on_new,
    gridFullAward,
    initLockedCells,
  };
}
