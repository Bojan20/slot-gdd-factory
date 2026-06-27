/**
 * W152 P1-7 — Persistent-grid Hold & Win solver (Money Train 4 class).
 *
 * Mirror of `rust-sim/src/markov_persistent.rs`. Extends the canonical H&W
 * Markov chain with **multi-class cell occupancy**: each cell that lands
 * during the feature carries a class drawn i.i.d. from a categorical
 * distribution:
 *
 *   - Cash       — contributes its value to the terminal cash sum
 *   - Multiplier — multiplies the final cash sum (global mult)
 *   - Collector  — at terminal pays `value × cash_cell_count`
 *   - Inert      — occupies a cell without paying
 *
 * Terminal payout (bet multiples):
 *
 *   payout = (Σ cash) × (Π mult) + (Σ col) × #cash + grid_full_award · 1{full}
 *
 * Conditional on terminal occupancy k, classes are i.i.d. per cell, so the
 * non-linear cross terms factorise:
 *
 *   E[Σcash · Πmult | k] = μ_v · k · p_c · (1 − p_m + p_m·μ_u)^(k−1)
 *   E[Σcol  · #cash | k] = μ_col · k(k−1) · p_col · p_c · μ_v
 *
 * The terminal occupancy PMF `P(k_terminal = i)` is reconstructed from the
 * same `(occupied, respins_left)` chain used by the standard solver — see
 * `holdAndWinMarkov.ts` for the chain dynamics.
 *
 * Byte-stability: same Math operations and ordering as the Rust mirror, so
 * shared fixtures produce identical floats within f64 precision.
 */

// ─── Input shape ─────────────────────────────────────────────────────────────

/** Occupancy chain config — mirrors `HoldAndWinConfig` (Rust). */
export interface PersistentHwOccupancy {
  /** `numCols × numRows`. */
  totalCells: number;
  /** `feature.respins_initial`. */
  initialRespins: number;
  /** Per-cell base landing chance at fill ratio 0. */
  baseChance: number;
  /** Extra per-cell chance as grid fills. */
  fillBonusCap: number;
  /** `feature.respin_reset_on_new`. */
  respinResetOnNew: boolean;
  /** Payout added if grid fills completely. */
  gridFullAward: number;
  /** Cells locked at trigger time. */
  initLockedCells: number;
}

/** Per-cell class distribution at landing time. */
export interface PersistentHwClasses {
  /** P(cell is Cash | landing event) before normalisation. */
  pCash: number;
  /** E[Cash value] in bet multiples. */
  muCash: number;
  /** P(cell is Multiplier | landing event) before normalisation. */
  pMult: number;
  /** E[Multiplier value] (×). 1.0 = neutral. */
  muMult: number;
  /** P(cell is Collector | landing event) before normalisation. */
  pCollector: number;
  /** E[Collector value] in bet multiples per cash cell it harvests. */
  muCollector: number;
  /** P(cell is Inert | landing event) before normalisation. */
  pInert: number;
}

export interface PersistentHwConfig {
  occupancy: PersistentHwOccupancy;
  classes: PersistentHwClasses;
  /** Flat multiplier applied at terminal *after* class mults. Default 1.0. */
  terminalGlobalMultiplier: number;
}

export interface PersistentHwResult {
  expectedPayout: number;
  expectedCashCells: number;
  expectedMultCells: number;
  expectedCollectorCells: number;
  expectedMultProduct: number;
  expectedCashMultPayout: number;
  expectedCollectorPayout: number;
  expectedGridFullPayout: number;
  gridFullProbability: number;
  expectedOrbCount: number;
  /** P(k_terminal = i) for i ∈ 0..=totalCells. */
  terminalOccupancyPmf: number[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export function defaultPersistentHwOccupancy(): PersistentHwOccupancy {
  return {
    totalCells: 15,
    initialRespins: 3,
    baseChance: 0.035,
    fillBonusCap: 0.025,
    respinResetOnNew: true,
    gridFullAward: 0,
    initLockedCells: 6,
  };
}

export function defaultPersistentHwClasses(): PersistentHwClasses {
  return {
    pCash: 0.75,
    muCash: 1.5,
    pMult: 0.15,
    muMult: 2.0,
    pCollector: 0.05,
    muCollector: 3.0,
    pInert: 0.05,
  };
}

export function defaultPersistentHwConfig(): PersistentHwConfig {
  return {
    occupancy: defaultPersistentHwOccupancy(),
    classes: defaultPersistentHwClasses(),
    terminalGlobalMultiplier: 1.0,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function normaliseClasses(c: PersistentHwClasses): {
  pc: number;
  pm: number;
  pcol: number;
  pinert: number;
} {
  const raw = [
    Math.max(0, c.pCash),
    Math.max(0, c.pMult),
    Math.max(0, c.pCollector),
    Math.max(0, c.pInert),
  ];
  const sum = raw[0] + raw[1] + raw[2] + raw[3];
  if (sum <= 0) {
    return { pc: 1, pm: 0, pcol: 0, pinert: 0 };
  }
  return { pc: raw[0] / sum, pm: raw[1] / sum, pcol: raw[2] / sum, pinert: raw[3] / sum };
}

function binomProb(n: number, j: number, p: number): number {
  if (j > n) return 0;
  if (p <= 0) return j === 0 ? 1 : 0;
  if (p >= 1) return j === n ? 1 : 0;
  const k = Math.min(j, n - j);
  let binom = 1.0;
  for (let i = 0; i < k; i++) {
    binom *= n - i;
    binom /= i + 1;
  }
  return binom * Math.pow(p, j) * Math.pow(1 - p, n - j);
}

function binomPmf(n: number, p: number): number[] {
  const pmf = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) pmf[j] = binomProb(n, j, p);
  let sum = 0;
  for (const v of pmf) sum += v;
  if (sum > 0 && Math.abs(sum - 1) > 1e-12) {
    for (let i = 0; i < pmf.length; i++) pmf[i] /= sum;
  }
  return pmf;
}

/** Reconstruct P(k_terminal = i) from the occupancy chain forward pass. */
function terminalOccupancyPmf(occ: PersistentHwOccupancy): number[] {
  const t = occ.totalCells;
  const ir = occ.initialRespins;
  const initK = Math.min(occ.initLockedCells, t);

  const prob = new Array<number>((t + 1) * (ir + 1)).fill(0);
  const idx = (k: number, r: number) => k * (ir + 1) + r;
  prob[idx(initK, ir)] = 1;

  const pTermK = new Array<number>(t + 1).fill(0);

  if (occ.respinResetOnNew) {
    for (let k = 0; k <= t; k++) {
      for (let r = ir; r >= 0; r--) {
        const pHere = prob[idx(k, r)];
        if (pHere < 1e-18) continue;
        if (r === 0 || k === t) {
          pTermK[k] += pHere;
          continue;
        }
        const n = t - k;
        const pLand = occ.baseChance + (k / t) * occ.fillBonusCap;
        const pmf = binomPmf(n, pLand);
        prob[idx(k, r - 1)] += pHere * pmf[0];
        for (let j = 1; j <= n; j++) {
          const nk = k + j;
          if (nk <= t) prob[idx(nk, ir)] += pHere * pmf[j];
        }
      }
    }
  } else {
    for (let r = ir; r >= 0; r--) {
      for (let k = 0; k <= t; k++) {
        const pHere = prob[idx(k, r)];
        if (pHere < 1e-18) continue;
        if (r === 0 || k === t) {
          pTermK[k] += pHere;
          continue;
        }
        const n = t - k;
        const pLand = occ.baseChance + (k / t) * occ.fillBonusCap;
        const pmf = binomPmf(n, pLand);
        prob[idx(k, r - 1)] += pHere * pmf[0];
        for (let j = 1; j <= n; j++) {
          const nk = k + j;
          if (nk <= t) prob[idx(nk, r - 1)] += pHere * pmf[j];
        }
      }
    }
  }

  let sum = 0;
  for (const v of pTermK) sum += v;
  if (sum > 0 && Math.abs(sum - 1) > 1e-12) {
    for (let i = 0; i < pTermK.length; i++) pTermK[i] /= sum;
  }
  return pTermK;
}

// ─── Solver ──────────────────────────────────────────────────────────────────

export function solvePersistentGridHw(cfg: PersistentHwConfig): PersistentHwResult {
  const occ = cfg.occupancy;
  if (occ.totalCells > 100) {
    throw new Error(
      `solvePersistentGridHw: totalCells=${occ.totalCells} exceeds safety cap of 100`,
    );
  }

  const pmf = terminalOccupancyPmf(occ);

  const { pc, pm, pcol } = normaliseClasses(cfg.classes);
  const muV = Math.max(0, cfg.classes.muCash);
  const muU = Math.max(0, cfg.classes.muMult);
  const muCol = Math.max(0, cfg.classes.muCollector);
  const gMult = Math.max(0, cfg.terminalGlobalMultiplier);

  // E[k_terminal] from PMF.
  let eK = 0;
  for (let i = 0; i < pmf.length; i++) eK += i * pmf[i];

  const zeta = 1 - pm + pm * muU;

  let eMultProduct = 0;
  for (let k = 0; k < pmf.length; k++) {
    eMultProduct += pmf[k] * Math.pow(zeta, k);
  }

  let eCashMult = 0;
  for (let k = 1; k < pmf.length; k++) {
    eCashMult += pmf[k] * k * pc * muV * Math.pow(zeta, k - 1);
  }
  eCashMult *= gMult;

  let eColPayout = 0;
  for (let k = 2; k < pmf.length; k++) {
    const kk = k * (k - 1);
    eColPayout += pmf[k] * kk * pcol * pc * muCol * muV;
  }
  eColPayout *= gMult;

  // Grid full probability = P(k_terminal = t).
  const gridFullProbability = pmf[occ.totalCells] ?? 0;
  const eGridFull = occ.gridFullAward * gridFullProbability * gMult;

  return {
    expectedPayout: eCashMult + eColPayout + eGridFull,
    expectedCashCells: eK * pc,
    expectedMultCells: eK * pm,
    expectedCollectorCells: eK * pcol,
    expectedMultProduct: eMultProduct,
    expectedCashMultPayout: eCashMult,
    expectedCollectorPayout: eColPayout,
    expectedGridFullPayout: eGridFull,
    gridFullProbability,
    expectedOrbCount: eK,
    terminalOccupancyPmf: pmf,
  };
}

// ─── Exposed internals (tests only) ──────────────────────────────────────────

export const __persistentHwInternals = {
  binomPmf,
  terminalOccupancyPmf,
  normaliseClasses,
};
