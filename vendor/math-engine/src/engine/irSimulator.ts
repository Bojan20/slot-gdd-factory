/**
 * IR-native Monte Carlo Simulator (Faza 2 + Faza 3).
 *
 * Runs a configurable number of spins against a `SlotGameIR`, draws each
 * spin's grid from the IR's reel definition (weighted-per-cell or strips),
 * dispatches the win evaluation through `evaluateIR`, and accumulates RTP
 * / hit-rate / feature-trigger frequencies.
 *
 * Faza 3 additions:
 *   - Free Spins feature: scatter-triggered FS sessions with optional
 *     `global_multiplier`, `MultiplierLadder` modifier, retrigger, and
 *     FS-specific reel set.
 *   - Hold & Win feature: bonus-triggered respin sessions with per-orb
 *     cash values, jackpot tiers, optional `grid_full_award`.
 *   - Cascade feature: cascading reels with replacement strategies
 *     (`drop` | `refill_random` | `fixed_strip`) and optional
 *     `multiplier_progression`.
 *   - Buy Feature offers and Ante Bet bias hooks.
 *
 * The simulator is intentionally agnostic of the legacy `GameConfig`
 * pipeline — the entire spin loop reads from the IR directly so the same
 * code path drives lines, ways, cluster, pay-anywhere, pattern, and
 * variable-row games.
 */

import type { Feature, ReelSet, SlotGameIR, SymbolKey } from '../ir/types.js';
import { mulberry32 } from './rng.js';
import { evaluateIR, type IRWinResult } from './irEvaluator.js';
import { BehaviorRegistry } from '../behaviors/index.js';

// ─── Public API ────────────────────────────────────────────────────────────

export interface IRSimConfig {
  spins: number;
  /** Optional seed — defaults to the IR's `rng.default_seed`. */
  seed?: number;
  /** Print per-1k-spin progress / final breakdown to stderr. */
  verbose?: boolean;
  /**
   * Faza 3: when true, the simulator forces a `BuyFeature` offer purchase
   * on every spin (round-robin across offers). Used by feature-coverage
   * tests so we can prove the offer path lights up regardless of base
   * trigger probability. Default `false` — production sims never auto-buy.
   */
  forceBuyFeature?: boolean;
  /**
   * Faza 3: when true, the simulator applies the `ante_bet` feature's
   * `extra_multiplier` to scatter / bonus counts (rounded up) before
   * feature-trigger evaluation. Models the typical "Ante boosts scatter
   * frequency" payment. Default: read from `bet.ante_bet.enabled` on
   * the IR.
   */
  forceAnte?: boolean;
  /**
   * Faza 11.7: optional observability session — when provided, every
   * completed spin is recorded via `session.recordSpin(...)`.
   */
  observabilitySession?: import('../observability/index.js').ObservabilitySession;
  /**
   * Auto-MC hook (Studio): invoked after each completed spin with the
   * final win multiplier (sum of base + features + cap applied). Lets
   * external orchestrators compute volatility / percentile / histogram
   * stats without re-implementing the spin loop.  Pure side-effect — must
   * not throw or the run is aborted.
   */
  onSpinWin?: (winX: number, spinIndex: number) => void;
  /**
   * Auto-MC progress hook: invoked periodically (default every 1000 spins)
   * with the running RTP and elapsed-ms.  Designed for WebWorker
   * postMessage relay; also used by CLI progress bars.
   */
  onProgress?: (
    spinsDone: number,
    totalSpins: number,
    runningRtp: number,
    elapsedMs: number,
  ) => void;
  /**
   * Auto-MC cancellation: when set, the orchestrator polls this before each
   * spin and bails out cleanly if true (returning partial results).
   */
  shouldCancel?: () => boolean;
}

export interface IRSimResult {
  spins: number;
  rtp: number;
  hitRate: number;
  /** Feature kind → 1-in-N average frequency. `Infinity` if never triggered. */
  featureTriggerFreqs: Record<string, number>;
  /** Largest single-spin total payout (multiplier × bet === multiplier here). */
  maxWinX: number;
  /** Cumulative win contribution per RTP source. `base` is always present. */
  rtpBreakdown: {
    base: number;
    free_spins: number;
    hold_and_win: number;
    cascade: number;
  } & Record<string, number>;
  /** Jackpot contribution to RTP, per tier id. */
  jackpotBreakdown?: Record<string, number>;  // tierId → fraction of total wagered
  /** Total jackpot RTP fraction. */
  jackpotRtp?: number;
}

// ─── Grid generators ───────────────────────────────────────────────────────

interface WeightedCell {
  ids: string[];
  weights: number[];
  total: number;
}

/**
 * Pre-build per-reel weighted draw tables for an IR with `mode: 'weighted'`.
 * Keys are sorted alphabetically to match the Rust side, which stores
 * weights in a `BTreeMap<String, f64>` (sorted-order iteration). Identical
 * iteration order is the precondition for RNG-level parity with the Rust
 * simulator: the same Mulberry32 sequence must pick the same symbol on
 * both sides.
 */
function buildWeightedDrawTables(
  perReel: Array<Record<SymbolKey, number>>,
): WeightedCell[] {
  return perReel.map((map) => {
    const ids = Object.keys(map).slice().sort();
    const weights = ids.map((id) => map[id] ?? 0);
    const total = weights.reduce((s, w) => s + w, 0);
    return { ids, weights, total };
  });
}

/** Generate one grid for a weighted reel-set IR. */
function generateWeightedGrid(
  rng: () => number,
  tables: WeightedCell[],
  numRows: number,
  rowCounts?: number[],
): string[][] {
  // grid[row][col]. Variable row counts: shorter columns fill from the top
  // with a sentinel '' so consumers can ignore them. The legacy evaluators
  // honour empty strings.
  const grid: string[][] = [];
  const numCols = tables.length;
  for (let r = 0; r < numRows; r++) {
    grid.push(new Array<string>(numCols).fill(''));
  }
  for (let c = 0; c < numCols; c++) {
    const table = tables[c];
    if (!table || table.total === 0) continue;
    const rowsForReel = rowCounts ? rowCounts[c] ?? numRows : numRows;
    for (let r = 0; r < rowsForReel; r++) {
      let roll = rng() * table.total;
      let chosen = table.ids[0] ?? '';
      for (let i = 0; i < table.ids.length; i++) {
        roll -= table.weights[i] ?? 0;
        if (roll <= 0) {
          chosen = table.ids[i] ?? '';
          break;
        }
      }
      const row = grid[r];
      if (row) row[c] = chosen;
    }
  }
  return grid;
}

/** Generate one grid for a strips reel-set IR. */
function generateStripsGrid(
  rng: () => number,
  strips: string[][],
  numRows: number,
  rowCounts?: number[],
): string[][] {
  const grid: string[][] = [];
  const numCols = strips.length;
  for (let r = 0; r < numRows; r++) {
    grid.push(new Array<string>(numCols).fill(''));
  }
  for (let c = 0; c < numCols; c++) {
    const strip = strips[c];
    if (!strip || strip.length === 0) continue;
    const rowsForReel = rowCounts ? rowCounts[c] ?? numRows : numRows;
    // Pick a random stop within the strip; window wraps the strip length.
    const stop = Math.floor(rng() * strip.length);
    for (let r = 0; r < rowsForReel; r++) {
      const sym = strip[(stop + r) % strip.length];
      const row = grid[r];
      if (row && sym !== undefined) row[c] = sym;
    }
  }
  return grid;
}

// ─── Topology helpers ──────────────────────────────────────────────────────

function topologyDims(ir: SlotGameIR): {
  numCols: number;
  numRows: number;
  variableRows?: Array<[number, number]>;
} {
  const t = ir.topology;
  switch (t.kind) {
    case 'rectangular':
      return { numCols: t.reels, numRows: t.rows };
    case 'variable_rows': {
      const maxRows = Math.max(...t.row_range_per_reel.map(([, hi]) => hi));
      return { numCols: t.reels, numRows: maxRows, variableRows: t.row_range_per_reel };
    }
    case 'cluster_grid':
      return { numCols: t.columns, numRows: t.rows };
  }
}

/** Draw per-reel row counts for variable_rows topology. */
function drawRowCounts(
  rng: () => number,
  ranges: Array<[number, number]>,
): number[] {
  return ranges.map(([lo, hi]) => {
    const span = hi - lo + 1;
    return lo + Math.floor(rng() * span);
  });
}

// ─── Feature lookup helpers ────────────────────────────────────────────────

function findFreeSpinsFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'free_spins' }> | undefined {
  return ir.features.find((f) => f.kind === 'free_spins') as
    | Extract<Feature, { kind: 'free_spins' }>
    | undefined;
}

function findHoldAndWinFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'hold_and_win' }> | undefined {
  return ir.features.find((f) => f.kind === 'hold_and_win') as
    | Extract<Feature, { kind: 'hold_and_win' }>
    | undefined;
}

function findCascadeFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'cascade' }> | undefined {
  return ir.features.find((f) => f.kind === 'cascade') as
    | Extract<Feature, { kind: 'cascade' }>
    | undefined;
}

function findBuyFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'buy_feature' }> | undefined {
  return ir.features.find((f) => f.kind === 'buy_feature') as
    | Extract<Feature, { kind: 'buy_feature' }>
    | undefined;
}

function findAnteBet(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'ante_bet' }> | undefined {
  return ir.features.find((f) => f.kind === 'ante_bet') as
    | Extract<Feature, { kind: 'ante_bet' }>
    | undefined;
}

function findPickFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'pick' }> | undefined {
  return ir.features.find((f) => f.kind === 'pick') as
    | Extract<Feature, { kind: 'pick' }>
    | undefined;
}

function findWheelFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'wheel' }> | undefined {
  return ir.features.find((f) => f.kind === 'wheel') as
    | Extract<Feature, { kind: 'wheel' }>
    | undefined;
}

function findRespinFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'respin' }> | undefined {
  return ir.features.find((f) => f.kind === 'respin') as
    | Extract<Feature, { kind: 'respin' }>
    | undefined;
}

function findGambleFeature(
  ir: SlotGameIR,
): Extract<Feature, { kind: 'gamble' }> | undefined {
  return ir.features.find((f) => f.kind === 'gamble') as
    | Extract<Feature, { kind: 'gamble' }>
    | undefined;
}

/** Returns all symbol_upgrade features (a game may have multiple). */
function findSymbolUpgradeFeatures(
  ir: SlotGameIR,
): Array<Extract<Feature, { kind: 'symbol_upgrade' }>> {
  return ir.features.filter((f) => f.kind === 'symbol_upgrade') as Array<
    Extract<Feature, { kind: 'symbol_upgrade' }>
  >;
}

function getScatterIds(ir: SlotGameIR): Set<string> {
  const ids = new Set<string>();
  for (const s of ir.symbols) if (s.kind === 'scatter') ids.add(s.id);
  return ids;
}

function getBonusIds(ir: SlotGameIR): Set<string> {
  const ids = new Set<string>();
  for (const s of ir.symbols) if (s.kind === 'bonus') ids.add(s.id);
  return ids;
}

// ─── Helper: weighted pick ─────────────────────────────────────────────────

function pickWeighted<T>(
  rng: () => number,
  entries: Array<{ value: T; weight: number }>,
): T {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) {
    const fallback = entries[0];
    if (!fallback) throw new Error('pickWeighted: empty pool');
    return fallback.value;
  }
  let roll = rng() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.value;
  }
  const last = entries[entries.length - 1];
  if (!last) throw new Error('pickWeighted: empty pool');
  return last.value;
}

// ─── Feature: Free Spins ───────────────────────────────────────────────────

/**
 * Read the awarded-spins count for a scatter trigger. Honours numeric keys
 * with optional `+` suffix; falls back to 10 when nothing matches.
 */
function freeSpinsAwarded(
  feature: Extract<Feature, { kind: 'free_spins' }>,
  scatterCount: number,
): number {
  const thresholds = feature.trigger.thresholds;
  if (!thresholds) return 10;

  // Build a sorted descending list of (threshold, value) — we pick the
  // highest threshold ≤ scatterCount.
  const entries = Object.entries(thresholds)
    .map(([k, v]) => ({ n: parseInt(k.replace(/\+$/, ''), 10), v }))
    .filter(({ n }) => !Number.isNaN(n))
    .sort((a, b) => b.n - a.n);
  for (const e of entries) {
    if (scatterCount >= e.n) return Math.floor(e.v);
  }
  return 10;
}

export async function simulateFreeSpins(
  ir: SlotGameIR,
  feature: Extract<Feature, { kind: 'free_spins' }>,
  triggerScatterCount: number,
  rng: () => number,
  totalBet: number,
  behaviorRegistry?: BehaviorRegistry,
): Promise<{ payout: number; spinsPlayed: number; retriggers: number }> {
  void totalBet; // per-spin RTP uses bet=1 in the outer loop

  const initialSpins = freeSpinsAwarded(feature, triggerScatterCount);
  if (initialSpins <= 0) {
    return { payout: 0, spinsPlayed: 0, retriggers: 0 };
  }

  // Build the FS grid generator. Prefer the FS reel set, fall back to base.
  const { numCols, numRows, variableRows } = topologyDims(ir);
  let fsWeightedTables: WeightedCell[] | null = null;
  let fsStrips: string[][] | null = null;

  if (ir.reels.mode === 'weighted') {
    const reels = ir.reels as Extract<ReelSet, { mode: 'weighted' }>;
    const tableSrc = reels.free_spins ?? reels.base;
    fsWeightedTables = buildWeightedDrawTables(tableSrc);
  } else {
    const reels = ir.reels as Extract<ReelSet, { mode: 'strips' }>;
    fsStrips = reels.free_spins ?? reels.base;
  }
  void numCols;

  const globalMult = feature.global_multiplier ?? 1;
  const hasLadder =
    (feature.modifiers ?? []).includes('multiplier_ladder');
  const retrigger = feature.retrigger;
  const maxTotal = retrigger?.max_total ?? Infinity;

  // Retrigger threshold: explicit min, else lowest numeric threshold key.
  let retriggerMin: number | undefined = retrigger?.min;
  if (retrigger && retriggerMin == null && retrigger.thresholds) {
    const keys = Object.keys(retrigger.thresholds)
      .map((k) => parseInt(k.replace(/\+$/, ''), 10))
      .filter((n) => !Number.isNaN(n));
    if (keys.length > 0) retriggerMin = Math.min(...keys);
  }

  // Cap on number of FS "loops" we ever execute — prevents runaway retriggers.
  const MAX_FS_LOOPS = 10_000;

  // Detect scatter symbols for retrigger / scatter-pay accounting.
  const scatterIds = getScatterIds(ir);

  let remaining = initialSpins;
  let played = 0;
  let retriggers = 0;
  let totalAwarded = initialSpins;
  let payout = 0;
  let ladderMult = 1;

  let loopCount = 0;
  while (remaining > 0 && loopCount < MAX_FS_LOOPS) {
    loopCount++;
    remaining--;
    played++;

    const rowCounts = variableRows ? drawRowCounts(rng, variableRows) : undefined;

    let grid: string[][];
    if (fsWeightedTables) {
      grid = generateWeightedGrid(rng, fsWeightedTables, numRows, rowCounts);
    } else if (fsStrips) {
      grid = generateStripsGrid(rng, fsStrips, numRows, rowCounts);
    } else {
      throw new Error('FS simulator: no reel data available');
    }

    const result = evaluateIR(
      ir,
      grid,
      behaviorRegistry ? { behaviors: behaviorRegistry } : {},
    );
    // Apply behavior multipliers (multiplier wilds, etc.) to FS spin win.
    let spinWin = result.totalPayout * result.spinMultiplier * result.lineMultiplier;

    // Scatter pays during FS (pay_anywhere semantics for scatter ids).
    // Honours the paytable: if the scatter id has a paytable row, count
    // anywhere on the FS grid and grant the highest matching tier.
    for (const sid of scatterIds) {
      const payMap = ir.paytable[sid];
      if (!payMap) continue;
      let count = 0;
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (row[c] === sid) count++;
        }
      }
      if (count <= 0) continue;
      // Pick highest tier ≤ count.
      let scatPay = 0;
      const sorted = Object.keys(payMap)
        .map((k) => ({ k, n: parseInt(k.replace(/\+$/, ''), 10) }))
        .filter(({ n }) => !Number.isNaN(n))
        .sort((a, b) => a.n - b.n);
      for (const { k, n } of sorted) {
        if (n <= count) {
          const v = payMap[k];
          if (v != null && v > scatPay) scatPay = v;
        }
      }
      // Only add scatter pays the standard evaluator wouldn't have already
      // booked (lines/ways/cluster don't pay scatter via the normal path).
      const evalKind = ir.evaluation.kind;
      if (evalKind !== 'pay_anywhere') {
        spinWin += scatPay;
      }
    }

    const effectiveMult = globalMult * (hasLadder ? ladderMult : 1);
    payout += spinWin * effectiveMult;

    // MultiplierLadder progression: increment after each spin, regardless
    // of win/no-win (typical "+1 each spin" interpretation).
    if (hasLadder) ladderMult += 1;

    // Retrigger handling.
    if (retrigger && retriggerMin != null && result.scatterCount >= retriggerMin) {
      const extra = freeSpinsAwarded(
        // Synthesize a free_spins shape from the retrigger trigger so the
        // helper can read awarded spins from the same thresholds.
        {
          kind: 'free_spins',
          trigger: {
            by: retrigger.by,
            thresholds: retrigger.thresholds,
            min: retrigger.min,
          },
        },
        result.scatterCount,
      );
      const canAward = Math.max(0, maxTotal - totalAwarded);
      const actual = Math.min(extra, canAward);
      if (actual > 0) {
        remaining += actual;
        totalAwarded += actual;
        retriggers++;
      }
    }
  }

  return { payout, spinsPlayed: played, retriggers };
}

// ─── Feature: Hold & Win ───────────────────────────────────────────────────

export async function simulateHoldAndWin(
  ir: SlotGameIR,
  feature: Extract<Feature, { kind: 'hold_and_win' }>,
  initialBonusPositions: Map<string, number>,
  rng: () => number,
  totalBet: number,
): Promise<{ payout: number; jackpots: Record<string, number>; orbCount: number }> {
  void totalBet; // per-spin RTP uses bet=1 in the outer loop

  const { numCols, numRows } = topologyDims(ir);
  const totalCells = numCols * numRows;

  const dist = feature.cash_value_distribution.map((d) => ({
    value: d,
    weight: d.weight,
  }));

  // Map jackpot id → multiplier so we can attribute by id.
  const jackpotById = new Map<string, number>();
  for (const t of feature.jackpot_tiers) jackpotById.set(t.id, t.multiplier);

  const jackpots: Record<string, number> = {};
  let payout = 0;

  // Locked cells, keyed by `r,c` (sentinel) plus their numeric values.
  const locked = new Map<string, { value: number; jackpotId?: string }>();

  // Seed the locked grid from initialBonusPositions. The position key is
  // already `r,c`. If the value is a positive number we treat it as a
  // pre-rolled cash value (used by KAT tests). Otherwise we roll fresh.
  for (const [posKey, presetValue] of initialBonusPositions) {
    let entry: { value: number; jackpotId?: string };
    if (presetValue > 0) {
      entry = { value: presetValue };
    } else {
      const draw = pickWeighted(rng, dist);
      const value = draw.value;
      const jackpotId = feature.jackpot_tiers.find(
        (t) => Math.abs(t.multiplier - value) < 1e-9,
      )?.id;
      entry = jackpotId ? { value, jackpotId } : { value };
    }
    locked.set(posKey, entry);
  }

  let respinsRemaining = feature.respins_initial;
  let loopCount = 0;
  const MAX_HNW_LOOPS = 200;

  // Per-cell landing chance. Modelled after the in-house holdAndWin.ts
  // probability ramp (3-6% per empty position depending on fill).
  const baseChance = 0.035;
  const fillBonusCap = 0.025;

  while (
    respinsRemaining > 0 &&
    locked.size < totalCells &&
    loopCount < MAX_HNW_LOOPS
  ) {
    loopCount++;
    respinsRemaining--;

    const fillRatio = locked.size / totalCells;
    const chance = baseChance + fillRatio * fillBonusCap;

    let newLands = 0;
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const key = `${r},${c}`;
        if (locked.has(key)) continue;
        if (rng() < chance) {
          const draw = pickWeighted(rng, dist);
          const value = draw.value;
          const jackpotId = feature.jackpot_tiers.find(
            (t) => Math.abs(t.multiplier - value) < 1e-9,
          )?.id;
          locked.set(key, jackpotId ? { value, jackpotId } : { value });
          newLands++;
        }
      }
    }

    if (newLands > 0 && feature.respin_reset_on_new) {
      respinsRemaining = feature.respins_initial;
    }
  }

  // Payout: sum of cash values + per-symbol jackpots already encoded
  // through `jackpotById`. We treat each orb's value as a bet multiplier.
  for (const entry of locked.values()) {
    payout += entry.value;
    if (entry.jackpotId) {
      jackpots[entry.jackpotId] = (jackpots[entry.jackpotId] ?? 0) + 1;
    }
  }

  // Full-grid award: maps to a jackpot tier id.
  if (locked.size >= totalCells && feature.grid_full_award) {
    const mult = jackpotById.get(feature.grid_full_award);
    if (mult != null) {
      payout += mult;
      jackpots[feature.grid_full_award] =
        (jackpots[feature.grid_full_award] ?? 0) + 1;
    }
  }

  return { payout, jackpots, orbCount: locked.size };
}

// ─── Feature: Pick Bonus ──────────────────────────────────────────────────

/**
 * Simulate a pick-bonus screen. Player picks from `prize_pool` — one
 * weighted draw determines the prize. Returns the pay_multiplier of the
 * selected prize entry.
 *
 * Trigger convention (no trigger field in IR): fires when `bonusCount >= 3`
 * in the main spin loop (configurable minimum at the call site).
 */
export function simulatePick(
  feature: Extract<Feature, { kind: 'pick' }>,
  rng: () => number,
): number {
  return pickWeighted(
    rng,
    feature.prize_pool.map((p) => ({ value: p.pay_multiplier, weight: p.weight })),
  );
}

// ─── Feature: Wheel ───────────────────────────────────────────────────────

/**
 * Simulate a bonus wheel spin. One weighted draw selects the segment.
 * Returns the pay_multiplier of the landed segment.
 *
 * Trigger convention: fires when `scatterCount >= 3` AND no FS triggered.
 */
export function simulateWheel(
  feature: Extract<Feature, { kind: 'wheel' }>,
  rng: () => number,
): number {
  return pickWeighted(
    rng,
    feature.segments.map((s) => ({ value: s.pay_multiplier, weight: s.weight })),
  );
}

// ─── Feature: Respin ──────────────────────────────────────────────────────

/**
 * Simulate a player-purchased respin.
 *
 * The player pays `cost_x` and gets one fresh base-game spin in return.
 * Simulation policy: one respin is always purchased (models "player buys
 * when base win = 0" EV scenario). `generateGrid` is a closure the caller
 * provides so respin can pull a new grid from the same RNG stream.
 *
 * Returns:
 *   `payout`   — gross win on the respin grid (before accounting for cost).
 *   `costPaid` — feature.cost_x (caller adds to totalWagered).
 */
export async function simulateRespin(
  ir: SlotGameIR,
  feature: Extract<Feature, { kind: 'respin' }>,
  rng: () => number,
  generateGrid: () => string[][],
  behaviorRegistry?: BehaviorRegistry,
): Promise<{ payout: number; costPaid: number }> {
  void rng; // grid generator already advances the RNG stream
  const grid = generateGrid();
  const result = evaluateIR(
    ir,
    grid,
    behaviorRegistry ? { behaviors: behaviorRegistry } : {},
  );
  const payout = result.totalPayout * result.spinMultiplier * result.lineMultiplier;
  return { payout, costPaid: feature.cost_x };
}

// ─── Feature: Gamble ──────────────────────────────────────────────────────

/**
 * Simulate one gamble step on the current win.
 *
 * - `red_black`: 50 % chance to double; 50 % to lose all.
 *   With `tie_resolution: 'house'`, the 50/50 boundary gives the house the
 *   edge on ties — modelled by strict `roll < 0.5` (ties go to house).
 * - `suit`: 25 % chance to 4×; 75 % to lose all.
 *
 * The simulator applies exactly one gamble step per triggering spin. Using
 * max_steps iterations would model "player gambles until bust or max", but
 * one step is the conservative, most-common model.
 *
 * Returns the new win amount (0 on loss, 2× or 4× on win).
 */
export function simulateGamble(
  feature: Extract<Feature, { kind: 'gamble' }>,
  rng: () => number,
  currentWin: number,
): number {
  if (currentWin <= 0) return currentWin;

  const roll = rng();
  if (feature.type === 'red_black') {
    // Strict < 0.5: ties resolve to house (house wins).
    return roll < 0.5 ? currentWin * 2 : 0;
  } else {
    // suit: 1 in 4 suits → 4× win; 3 in 4 → lose.
    return roll < 0.25 ? currentWin * 4 : 0;
  }
}

// ─── Feature: Symbol Upgrade ──────────────────────────────────────────────

/**
 * Apply a probability-gated symbol upgrade to a grid, **before** win
 * evaluation. Returns the input grid unchanged if the RNG roll misses
 * the probability gate; otherwise returns a **new** grid (does not mutate)
 * with every occurrence of `feature.from` replaced by `feature.to`.
 *
 * Multiple `symbol_upgrade` features are applied sequentially by the caller
 * (each has its own probability roll).
 */
export function simulateSymbolUpgrade(
  feature: Extract<Feature, { kind: 'symbol_upgrade' }>,
  grid: string[][],
  rng: () => number,
): string[][] {
  if (rng() > feature.probability) return grid;
  return grid.map((row) =>
    row.map((cell) => (cell === feature.from ? feature.to : cell)),
  );
}

// ─── Feature: Cascade ──────────────────────────────────────────────────────

/**
 * Resolve cascade replacement for `'drop'`: empty cells "fall" downward
 * with refill at the top from a random pull of the per-reel weighted
 * distribution (or strip stop). This is the canonical "drop" cascade.
 */
function dropAndRefill(
  ir: SlotGameIR,
  grid: string[][],
  removedKeys: Set<string>,
  rng: () => number,
  tables: WeightedCell[] | null,
  strips: string[][] | null,
): void {
  const numCols = grid[0]?.length ?? 0;
  const numRows = grid.length;
  for (let c = 0; c < numCols; c++) {
    // Collect surviving symbols from bottom to top.
    const survivors: string[] = [];
    for (let r = numRows - 1; r >= 0; r--) {
      const key = `${r},${c}`;
      if (removedKeys.has(key)) continue;
      const sym = grid[r]?.[c];
      if (sym !== undefined && sym !== '') survivors.push(sym);
    }
    // Refill from top with new symbols until we have numRows entries.
    while (survivors.length < numRows) {
      let newSym = '';
      if (tables) {
        const table = tables[c];
        if (table && table.total > 0) {
          let roll = rng() * table.total;
          let chosen = table.ids[0] ?? '';
          for (let i = 0; i < table.ids.length; i++) {
            roll -= table.weights[i] ?? 0;
            if (roll <= 0) {
              chosen = table.ids[i] ?? '';
              break;
            }
          }
          newSym = chosen;
        }
      } else if (strips) {
        const strip = strips[c];
        if (strip && strip.length > 0) {
          const idx = Math.floor(rng() * strip.length);
          newSym = strip[idx] ?? '';
        }
      }
      survivors.push(newSym);
    }
    // Pour back into grid: survivors[0] is the bottom-most.
    for (let r = numRows - 1, i = 0; r >= 0; r--, i++) {
      const row = grid[r];
      if (row) row[c] = survivors[i] ?? '';
    }
  }
  // Suppress unused-binding lint for ir on this helper (kept for future
  // role-aware refill behaviour like sticky/expanding wilds).
  void ir;
}

function refillRandom(
  ir: SlotGameIR,
  grid: string[][],
  removedKeys: Set<string>,
  rng: () => number,
): void {
  // Sample uniformly from all symbol ids. Maintains simple semantics for
  // tests where the IR doesn't define a strip.
  const symbolIds = ir.symbols.map((s) => s.id);
  for (const key of removedKeys) {
    const [rs, cs] = key.split(',');
    const r = parseInt(rs ?? '0', 10);
    const c = parseInt(cs ?? '0', 10);
    const row = grid[r];
    if (row && symbolIds.length > 0) {
      const pick = symbolIds[Math.floor(rng() * symbolIds.length)] ?? '';
      row[c] = pick;
    }
  }
}

function refillFixedStrip(
  grid: string[][],
  removedKeys: Set<string>,
  strips: string[][] | null,
  rng: () => number,
): void {
  // Each emptied cell pulls the next symbol from a fresh strip stop.
  if (!strips) return;
  for (const key of removedKeys) {
    const [rs, cs] = key.split(',');
    const r = parseInt(rs ?? '0', 10);
    const c = parseInt(cs ?? '0', 10);
    const strip = strips[c];
    const row = grid[r];
    if (row && strip && strip.length > 0) {
      const idx = Math.floor(rng() * strip.length);
      row[c] = strip[idx] ?? '';
    }
  }
}

export async function applyCascade(
  ir: SlotGameIR,
  feature: Extract<Feature, { kind: 'cascade' }>,
  grid: string[][],
  rng: () => number,
  totalBet: number,
  behaviorRegistry?: BehaviorRegistry,
): Promise<{ totalPayout: number; cascadeCount: number; maxMultiplier: number }> {
  void totalBet;

  let weightedTables: WeightedCell[] | null = null;
  let strips: string[][] | null = null;
  if (ir.reels.mode === 'weighted') {
    weightedTables = buildWeightedDrawTables(ir.reels.base);
  } else if (ir.reels.mode === 'strips') {
    strips = ir.reels.base;
  }

  let totalPayout = 0;
  let cascadeCount = 0;
  let maxMultiplier = 1;
  const progression = feature.multiplier_progression ?? [];

  // Cap absolute chains to feature.max_chain (also bounded by safety).
  const HARD_CAP = 100;
  const chainCap = Math.min(feature.max_chain, HARD_CAP);

  // First evaluation is the "initial" grid the caller passed in.
  // We loop: evaluate → if wins → remove → replace → re-evaluate.
  for (let chain = 0; chain < chainCap; chain++) {
    const result = evaluateIR(
      ir,
      grid,
      behaviorRegistry ? { behaviors: behaviorRegistry } : {},
    );
    if (result.totalPayout <= 0) break;

    const multiplier =
      chain < progression.length ? progression[chain] ?? 1 : 1;
    if (multiplier > maxMultiplier) maxMultiplier = multiplier;

    // Cascade multiplier stacks with any behavior-layer spinMultiplier.
    totalPayout += result.totalPayout * result.spinMultiplier * result.lineMultiplier * multiplier;
    cascadeCount++;

    // Collect positions to remove. Pay-anywhere/cluster/pattern provide
    // them directly; lines/ways do not — for those modes we fall back to
    // marking all cells that contain the winning symbols.
    const removed = new Set<string>();
    for (const w of result.wins) {
      if (w.positions && w.positions.length > 0) {
        for (const [colOrReel, row] of w.positions) {
          removed.add(`${row},${colOrReel}`);
        }
      } else {
        // No positions — fall back to clearing every cell whose symbol
        // matches the winning symbol (lines / ways).
        for (let r = 0; r < grid.length; r++) {
          const row = grid[r];
          if (!row) continue;
          for (let c = 0; c < row.length; c++) {
            if (row[c] === w.symbolId) removed.add(`${r},${c}`);
          }
        }
      }
    }
    if (removed.size === 0) break;

    switch (feature.replacement) {
      case 'drop':
        dropAndRefill(ir, grid, removed, rng, weightedTables, strips);
        break;
      case 'refill_random':
        refillRandom(ir, grid, removed, rng);
        break;
      case 'fixed_strip':
        refillFixedStrip(grid, removed, strips, rng);
        break;
    }
  }

  return { totalPayout, cascadeCount, maxMultiplier };
}

// ─── Internal: ante / buy helpers ──────────────────────────────────────────

/**
 * Apply the ante-bet bias: when ante is "on", scatter / bonus counts are
 * scaled up by `extra_multiplier` (rounded up). Models the operator-side
 * convention where ante pays for *higher trigger frequency*, not a flat
 * multiplier on wins. Conservative — only inflates feature counts.
 */
function applyAnteBias(
  base: number,
  enabled: boolean,
  extra: number,
): number {
  if (!enabled || extra <= 1) return base;
  return Math.ceil(base * extra);
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Run the simulation. Returns aggregated metrics — does NOT keep per-spin
 * grids in memory (so 1M spins is fine). All randomness comes from a single
 * Mulberry32 stream seeded from `config.seed` (falls back to the IR's
 * `rng.default_seed`).
 */
export async function runIRSimulation(
  ir: SlotGameIR,
  config: IRSimConfig,
): Promise<IRSimResult> {
  const seed = config.seed ?? ir.rng.default_seed;
  const rng = mulberry32(seed);
  const { numCols, numRows, variableRows } = topologyDims(ir);
  void numCols;

  // Pre-build draw tables for weighted mode (cheap to do once).
  let weightedTables: WeightedCell[] | null = null;
  let baseStrips: string[][] | null = null;
  if (ir.reels.mode === 'weighted') {
    weightedTables = buildWeightedDrawTables(ir.reels.base);
  } else {
    baseStrips = ir.reels.base;
  }

  // Build behavior registry once — same instance reused across all spins.
  // Faza 3: mystery reveals, expanding wilds, multiplier wilds etc. are
  // applied automatically by the BehaviorPipeline inside evaluateIR.
  const behaviorRegistry = BehaviorRegistry.forIR(ir);

  // Resolve feature handles up-front so the hot loop just branches on
  // pre-computed pointers instead of re-scanning `ir.features`.
  const fsFeature = findFreeSpinsFeature(ir);
  const hnwFeature = findHoldAndWinFeature(ir);
  const cascadeFeature = findCascadeFeature(ir);
  const buyFeature = findBuyFeature(ir);
  const anteFeature = findAnteBet(ir);
  const pickFeature = findPickFeature(ir);
  const wheelFeature = findWheelFeature(ir);
  const respinFeature = findRespinFeature(ir);
  const gambleFeature = findGambleFeature(ir);
  const symbolUpgradeFeatures = findSymbolUpgradeFeatures(ir);

  const anteOn = config.forceAnte ?? ir.bet.ante_bet?.enabled ?? false;
  const anteExtra =
    anteFeature?.extra_multiplier ?? ir.bet.ante_bet?.extra_multiplier ?? 1;

  const bonusIds = getBonusIds(ir);

  let totalWagered = 0;
  let totalWon = 0;
  let totalHits = 0;
  let maxWinX = 0;
  const featureCounts: Record<string, number> = {};

  // RTP breakdown buckets (cumulative win contribution per source).
  let baseWon = 0;
  let fsWon = 0;
  let hnwWon = 0;
  let cascadeWon = 0;
  let pickWon = 0;
  let wheelWon = 0;
  let respinWon = 0;
  // gambleNet: net effect of gambling (can be negative — house edge).
  let gambleNet = 0;

  // Buy-feature: when forced, rotate through offers round-robin so any
  // offer mapped to a known feature gets exercised at least once.
  let buyIndex = 0;

  // Auto-MC plumbing — sample epoch + cancellation timestamps, no-ops
  // when the orchestrator hooks are absent.
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const progressEvery = Math.max(1000, Math.floor(config.spins / 100));

  for (let i = 0; i < config.spins; i++) {
    // Cancellation poll — checked before each spin so callers can bail
    // out cleanly within ~one-spin granularity (sub-ms in practice).
    if (config.shouldCancel && config.shouldCancel()) break;
    totalWagered += 1; // one unit per spin — RTP is win/wager
    let spinWon = 0;

    const rowCounts = variableRows ? drawRowCounts(rng, variableRows) : undefined;

    let grid: string[][];
    if (weightedTables) {
      grid = generateWeightedGrid(rng, weightedTables, numRows, rowCounts);
    } else if (baseStrips) {
      grid = generateStripsGrid(rng, baseStrips, numRows, rowCounts);
    } else {
      throw new Error('Unsupported reel set mode');
    }

    // ── Symbol upgrades (probability-gated transform before eval) ──────
    // Applied in declaration order; each upgrade has its own RNG roll.
    let evalGrid = grid;
    for (const upgFeat of symbolUpgradeFeatures) {
      const upgraded = simulateSymbolUpgrade(upgFeat, evalGrid, rng);
      if (upgraded !== evalGrid) {
        featureCounts.symbol_upgrade = (featureCounts.symbol_upgrade ?? 0) + 1;
      }
      evalGrid = upgraded;
    }

    // ── Base spin evaluation (behaviors wired) ─────────────────────────
    let result: IRWinResult = evaluateIR(ir, evalGrid, { behaviors: behaviorRegistry });
    // Apply behavior multipliers (multiplier wilds etc.) to base payout.
    let baseSpinPayout =
      result.totalPayout * result.spinMultiplier * result.lineMultiplier;

    // ── Cascade (operates on the (possibly upgraded) base grid) ────────
    if (cascadeFeature) {
      const cascadeResult = await applyCascade(
        ir,
        cascadeFeature,
        evalGrid,
        rng,
        1,
        behaviorRegistry,
      );
      // The first chain already consumed the base evaluation, so we
      // record cascade payout in full and zero-out base attribution for
      // this spin. cascadeCount > 0 implies the base eval did fire.
      if (cascadeResult.cascadeCount > 0) {
        cascadeWon += cascadeResult.totalPayout;
        spinWon += cascadeResult.totalPayout;
        baseSpinPayout = 0;
        featureCounts.cascade = (featureCounts.cascade ?? 0) + 1;
      }
    }

    spinWon += baseSpinPayout;
    baseWon += baseSpinPayout;
    if (baseSpinPayout > 0) totalHits++;

    // ── Ante-biased scatter / bonus counts for feature triggers ────────
    const effectiveScatter = applyAnteBias(
      result.scatterCount,
      anteOn,
      anteExtra,
    );
    const effectiveBonus = applyAnteBias(
      result.bonusCount,
      anteOn,
      anteExtra,
    );

    // ── Hold & Win trigger ─────────────────────────────────────────────
    let hnwTriggered = false;
    if (hnwFeature) {
      const trig = hnwFeature.trigger;
      let count = 0;
      if (trig.by === 'bonus_count') count = effectiveBonus;
      else if (trig.by === 'scatter_count') count = effectiveScatter;
      else count = effectiveScatter + effectiveBonus;
      const minHnw = trig.min ?? 6;
      if (count >= minHnw) hnwTriggered = true;
    }

    if (hnwTriggered && hnwFeature) {
      featureCounts.hold_and_win = (featureCounts.hold_and_win ?? 0) + 1;
      const positions = new Map<string, number>();
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (bonusIds.has(row[c] ?? '')) positions.set(`${r},${c}`, 0);
        }
      }
      const hnw = await simulateHoldAndWin(ir, hnwFeature, positions, rng, 1);
      hnwWon += hnw.payout;
      spinWon += hnw.payout;
    }

    // ── Free Spins trigger ─────────────────────────────────────────────
    let fsTriggered = false;
    if (fsFeature) {
      const trig = fsFeature.trigger;
      let count = 0;
      if (trig.by === 'scatter_count') count = effectiveScatter;
      else if (trig.by === 'bonus_count') count = effectiveBonus;
      else count = effectiveScatter + effectiveBonus;
      let min: number | undefined = trig.min;
      if (min == null && trig.thresholds) {
        const keys = Object.keys(trig.thresholds)
          .map((k) => parseInt(k.replace(/\+$/, ''), 10))
          .filter((n) => !Number.isNaN(n));
        if (keys.length > 0) min = Math.min(...keys);
      }
      if (min != null && count >= min) fsTriggered = true;
    }

    if (fsTriggered && fsFeature) {
      featureCounts.free_spins = (featureCounts.free_spins ?? 0) + 1;
      const fs = await simulateFreeSpins(
        ir,
        fsFeature,
        result.scatterCount,
        rng,
        1,
        behaviorRegistry,
      );
      fsWon += fs.payout;
      spinWon += fs.payout;
    }

    // ── Pick Bonus trigger (bonus_count >= 3 convention) ───────────────
    // pick features have no trigger field in the IR — we trigger them
    // when ≥ 3 bonus symbols land (standard operator convention).
    if (pickFeature && effectiveBonus >= 3) {
      featureCounts.pick = (featureCounts.pick ?? 0) + 1;
      const pickPayout = simulatePick(pickFeature, rng);
      pickWon += pickPayout;
      spinWon += pickPayout;
    }

    // ── Wheel trigger (scatter_count >= 3, no FS this spin) ────────────
    // Wheel triggered by scatter when FS is NOT also triggered (avoids
    // double-counting the same scatter landing). If a game has both
    // wheel and FS, the FS takes priority.
    if (wheelFeature && effectiveScatter >= 3 && !fsTriggered) {
      featureCounts.wheel = (featureCounts.wheel ?? 0) + 1;
      const wheelPayout = simulateWheel(wheelFeature, rng);
      wheelWon += wheelPayout;
      spinWon += wheelPayout;
    }

    // ── Respin (player buys one respin when base win = 0) ──────────────
    // Models the most common use-case: player opts in when no base win.
    // Each respin costs feature.cost_x (added to totalWagered).
    if (respinFeature && baseSpinPayout === 0 && !cascadeFeature) {
      // Closure so simulateRespin pulls from the same RNG stream.
      const gridFn = (): string[][] => {
        const rc = variableRows ? drawRowCounts(rng, variableRows) : undefined;
        if (weightedTables) {
          return generateWeightedGrid(rng, weightedTables, numRows, rc);
        } else if (baseStrips) {
          return generateStripsGrid(rng, baseStrips, numRows, rc);
        }
        throw new Error('No reel data for respin');
      };
      featureCounts.respin = (featureCounts.respin ?? 0) + 1;
      const respinResult = await simulateRespin(
        ir,
        respinFeature,
        rng,
        gridFn,
        behaviorRegistry,
      );
      totalWagered += respinResult.costPaid; // player pays for the respin
      respinWon += respinResult.payout;
      spinWon += respinResult.payout;
    }

    // ── Gamble (player gambles entire win, one step) ───────────────────
    // Triggered when spinWon > 0. EV is neutral (red_black = 1.0×,
    // suit = 1.0×) so gamble does not shift average RTP — only volatility.
    // gambleNet tracks the net effect for breakdown attribution.
    if (gambleFeature && spinWon > 0) {
      const preGamble = spinWon;
      featureCounts.gamble = (featureCounts.gamble ?? 0) + 1;
      spinWon = simulateGamble(gambleFeature, rng, spinWon);
      gambleNet += spinWon - preGamble; // positive on win, negative on loss
    }

    // ── Buy Feature (forced for coverage) ──────────────────────────────
    if (config.forceBuyFeature && buyFeature && buyFeature.offers.length > 0) {
      const offer = buyFeature.offers[buyIndex % buyFeature.offers.length];
      buyIndex++;
      if (offer) {
        const guarantee = offer.guaranteed;
        // The contract is open-ended: we map common ids to feature
        // simulation calls. Unknown ids degrade to a no-op.
        if (guarantee === 'free_spins' && fsFeature) {
          featureCounts.buy_feature = (featureCounts.buy_feature ?? 0) + 1;
          // Synthesize the highest threshold count so the FS sim awards
          // the maximum spin count the operator advertises.
          let highest = 0;
          if (fsFeature.trigger.thresholds) {
            for (const k of Object.keys(fsFeature.trigger.thresholds)) {
              const n = parseInt(k.replace(/\+$/, ''), 10);
              if (!Number.isNaN(n)) highest = Math.max(highest, n);
            }
          }
          const fs = await simulateFreeSpins(
            ir,
            fsFeature,
            Math.max(highest, fsFeature.trigger.min ?? 3),
            rng,
            1,
            behaviorRegistry,
          );
          fsWon += fs.payout;
          spinWon += fs.payout;
        } else if (guarantee === 'hold_and_win' && hnwFeature) {
          featureCounts.buy_feature = (featureCounts.buy_feature ?? 0) + 1;
          // Force a 6-cell seed (typical H&W min trigger) at arbitrary
          // positions so the simulation has something to grow from.
          const hnwSeed = new Map<string, number>();
          for (let k = 0; k < 6; k++) hnwSeed.set(`0,${k % numCols}`, 0);
          const hnw = await simulateHoldAndWin(ir, hnwFeature, hnwSeed, rng, 1);
          hnwWon += hnw.payout;
          spinWon += hnw.payout;
        } else if (guarantee === 'pick' && pickFeature) {
          featureCounts.buy_feature = (featureCounts.buy_feature ?? 0) + 1;
          const pickPayout = simulatePick(pickFeature, rng);
          pickWon += pickPayout;
          spinWon += pickPayout;
        } else if (guarantee === 'wheel' && wheelFeature) {
          featureCounts.buy_feature = (featureCounts.buy_feature ?? 0) + 1;
          const wheelPayout = simulateWheel(wheelFeature, rng);
          wheelWon += wheelPayout;
          spinWon += wheelPayout;
        }
      }
    }

    // ── Feature trigger frequency counts ───────────────────────────────
    for (const featKind of result.triggeredFeatures) {
      featureCounts[featKind] = (featureCounts[featKind] ?? 0) + 1;
    }

    if (spinWon > maxWinX) maxWinX = spinWon;
    if (spinWon > 0 && baseSpinPayout === 0) totalHits++; // count feature-only hits
    totalWon += spinWon;

    // ── Auto-MC hooks ──────────────────────────────────────────────────
    // Per-spin win callback (volatility / percentile / histogram outside
    // the engine). Wrapped in try/catch so a misbehaving caller never
    // aborts the simulator mid-run.
    if (config.onSpinWin) {
      try { config.onSpinWin(spinWon, i); } catch (_) { /* swallow */ }
    }
    if (config.onProgress && (i % progressEvery === 0 || i === config.spins - 1)) {
      try {
        const rtpSoFar = totalWagered > 0 ? totalWon / totalWagered : 0;
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        config.onProgress(i + 1, config.spins, rtpSoFar, elapsed);
      } catch (_) { /* swallow */ }
    }

    // ── Observability hook (Faza 11.7) ─────────────────────────────────
    if (config.observabilitySession) {
      const featureHits: Array<{ kind: string; payout: number }> = [];
      if (fsTriggered && fsFeature) featureHits.push({ kind: 'free_spins', payout: 0 });
      if (hnwTriggered && hnwFeature) featureHits.push({ kind: 'hold_and_win', payout: 0 });
      config.observabilitySession.recordSpin({
        bet: 1,
        payout: spinWon,
        features: featureHits,
      });
    }

    if (config.verbose && (i + 1) % 100000 === 0) {
      const rtpSoFar = totalWon / totalWagered;
      process.stderr.write(
        `[irSim] ${i + 1} spins · RTP=${(rtpSoFar * 100).toFixed(3)}%\n`,
      );
    }
  }

  const featureTriggerFreqs: Record<string, number> = {};
  for (const [kind, cnt] of Object.entries(featureCounts)) {
    featureTriggerFreqs[kind] = cnt > 0 ? config.spins / cnt : Infinity;
  }

  const rtp = totalWagered > 0 ? totalWon / totalWagered : 0;
  const hitRate = config.spins > 0 ? totalHits / config.spins : 0;

  const rtpBreakdown: IRSimResult['rtpBreakdown'] = {
    base: totalWagered > 0 ? baseWon / totalWagered : 0,
    free_spins: totalWagered > 0 ? fsWon / totalWagered : 0,
    hold_and_win: totalWagered > 0 ? hnwWon / totalWagered : 0,
    cascade: totalWagered > 0 ? cascadeWon / totalWagered : 0,
    pick: totalWagered > 0 ? pickWon / totalWagered : 0,
    wheel: totalWagered > 0 ? wheelWon / totalWagered : 0,
    respin: totalWagered > 0 ? respinWon / totalWagered : 0,
    gamble: totalWagered > 0 ? gambleNet / totalWagered : 0,
  };

  return {
    spins: config.spins,
    rtp,
    hitRate,
    featureTriggerFreqs,
    maxWinX,
    rtpBreakdown,
    jackpotBreakdown: {},
    jackpotRtp: 0,
  };
}

// ─── Test exports ──────────────────────────────────────────────────────────

export const _internal = {
  simulateFreeSpins,
  simulateHoldAndWin,
  applyCascade,
  simulatePick,
  simulateWheel,
  simulateRespin,
  simulateGamble,
  simulateSymbolUpgrade,
  freeSpinsAwarded,
};
