/**
 * IR-native Evaluator (Faza 2 — TypeScript dispatcher).
 *
 * Single entry point that takes a fully-validated `SlotGameIR` plus a `grid`
 * and dispatches to the appropriate per-mode evaluator. The IR drives every
 * decision — no hardcoded reels/rows/symbol roles. The bridge to the legacy
 * `GameConfig`-based evaluators lives below; it is the only place the
 * pipeline accepts the historical TS `GameConfig` shape, so future cleanups
 * can swap each evaluator for an IR-first implementation without touching
 * the dispatcher.
 *
 * Faza 3 addition:
 *   When a `BehaviorRegistry` is supplied via `IREvaluateOptions.behaviors`,
 *   the evaluator runs the full Behavior Plugin pipeline:
 *     1. createSpinState(grid)
 *     2. BehaviorPipeline.runOnLand()  — mystery reveals, expanding wilds, etc.
 *     3. win evaluation on transformed grid
 *     4. BehaviorPipeline.runOnWin()   — multiplier wilds, jackpot symbols
 *   `IRWinResult.spinMultiplier` reflects any multiplier effects applied.
 *
 * Dispatch table:
 *   evaluation.kind === 'lines'        → LineEvaluator
 *   evaluation.kind === 'ways'         → WaysEvaluator
 *   evaluation.kind === 'cluster'      → ClusterEvaluator
 *   evaluation.kind === 'pay_anywhere' → direct count-based path
 *   evaluation.kind === 'pattern'      → direct pattern-positions path
 *
 * Scatter and bonus counts are evaluated grid-wide regardless of mode so the
 * feature trigger pass (`free_spins`, `hold_and_win`) sees consistent state.
 */

import type {
  Evaluation,
  Feature,
  SlotGameIR,
  Symbol as IRSymbol,
} from '../ir/types.js';
import type {
  ClusterConfig,
  GameConfig,
  PayEntry,
  Payline,
  SymbolDef,
  SymbolRole,
  WildType,
} from '../types/config.js';
import { evaluateLines, createLineEvalContext } from '../evaluators/lineEvaluator.js';
import { evaluateWays, createWaysEvalContext } from '../evaluators/waysEvaluator.js';
import {
  evaluateClusters,
  createClusterEvalContext,
} from '../evaluators/clusterEvaluator.js';
import {
  BehaviorRegistry,
  BehaviorPipeline,
  createSpinState,
  applyEffects,
  type SpinState,
} from '../behaviors/index.js';

// ─── Public result types ───────────────────────────────────────────────────

export interface IRWin {
  /** Symbol id that produced the win (paying symbol or, for wild-only lines, the wild itself). */
  symbolId: string;
  /** Matching symbol count for lines/ways, cluster size for cluster, total count for pay_anywhere. */
  count: number;
  /** Multiplier × number-of-ways, *not* yet scaled by total_bet. */
  payout: number;
  /** [reel, row] pairs for cluster / pay_anywhere / pattern modes. */
  positions?: [number, number][];
  /** Payline index in `evaluation.paylines` for `lines` mode. */
  paylineIndex?: number;
}

export interface IRWinResult {
  wins: IRWin[];
  /** Sum of per-win `payout` values (already a total-bet multiplier). */
  totalPayout: number;
  /**
   * Combined spin-scope multiplier from the Behavior Pipeline.
   * `totalPayout` does NOT include this — callers must multiply:
   *   finalPayout = totalPayout * spinMultiplier * lineMultiplier
   * Defaults to 1.0 when no behavior registry is supplied.
   */
  spinMultiplier: number;
  lineMultiplier: number;
  evalMode: 'lines' | 'ways' | 'cluster' | 'variable_ways' | 'pay_anywhere' | 'pattern';
  scatterCount: number;
  bonusCount: number;
  /** Feature `kind` strings whose trigger condition fired this spin. */
  triggeredFeatures: string[];
  /** SpinState after pipeline run — defined only when behaviors option is set. */
  spinState?: SpinState;
}

// ─── IR → GameConfig bridge (internal) ─────────────────────────────────────

/**
 * Map an IR `SymbolKind` to a legacy `SymbolRole`.
 * The Rust adapter has its own variant of this; the two must stay in sync.
 */
function irKindToRole(kind: IRSymbol['kind']): SymbolRole {
  switch (kind) {
    case 'wild':
    case 'chain_wild':
    case 'expanding':
      return 'WILD';
    case 'scatter':
      return 'SCATTER';
    case 'bonus':
      return 'BONUS';
    case 'lp':
      return 'LOW_PAY';
    case 'hp':
      return 'HIGH_PAY';
    case 'multiplier':
      return 'MULTIPLIER';
    case 'mystery':
      return 'MYSTERY';
    case 'sticky':
    case 'transform':
    default:
      return 'SPECIAL';
  }
}

function irKindToWildType(kind: IRSymbol['kind']): WildType | undefined {
  switch (kind) {
    case 'wild':
      return 'STANDARD';
    case 'expanding':
      return 'EXPANDING';
    case 'chain_wild':
      return 'WALKING';
    case 'sticky':
      return 'STICKY';
    default:
      return undefined;
  }
}

/** Convert IR symbols → GameConfig SymbolDef[] in declaration order. */
function buildSymbolDefs(ir: SlotGameIR): SymbolDef[] {
  return ir.symbols.map((s) => {
    const role = irKindToRole(s.kind);
    const def: SymbolDef = {
      id: s.id,
      name: s.name,
      role,
      canBeSubstituted: true,
    };

    if (role === 'WILD') {
      def.wildType = irKindToWildType(s.kind) ?? 'STANDARD';
      // Translate substitution rules: "*" → leave `substitutes` empty
      // (legacy code treats absent list as substitutes-for-all). Explicit
      // list passes through verbatim.
      if (Array.isArray(s.substitutes)) {
        def.substitutes = [...s.substitutes];
      }
    }

    return def;
  });
}

/** Convert IR paytable → legacy PayEntry[] for lines/ways/cluster evaluators. */
function buildPaytable(ir: SlotGameIR): PayEntry[] {
  const out: PayEntry[] = [];
  for (const [symbolId, countMap] of Object.entries(ir.paytable)) {
    const pays: Record<string, number> = {};
    for (const [key, val] of Object.entries(countMap)) {
      // Strip trailing "+" so the consumers can parseInt cleanly.
      const numeric = key.replace(/\+$/, '');
      if (/^\d+$/.test(numeric)) {
        pays[numeric] = val;
      }
    }
    out.push({ symbolId, pays });
  }
  return out;
}

/**
 * Build the legacy `GameConfig` shape from an IR plus the grid we are
 * about to evaluate. The grid is needed because variable-rows topologies
 * require us to feed an honest row count to the legacy evaluator so it
 * can iterate properly.
 */
function irToLegacyConfig(ir: SlotGameIR, grid: string[][]): GameConfig {
  const symbols = buildSymbolDefs(ir);
  const paytable = buildPaytable(ir);

  // Topology → grid dimensions for the legacy GameConfig. The grid we're
  // evaluating is the source of truth (handles variable-row grids too).
  const numRows = grid.length;
  const numCols = grid[0]?.length ?? 0;

  // Paylines: lines mode only; other modes leave it undefined.
  let paylines: Payline[] | undefined;
  if (ir.evaluation.kind === 'lines') {
    paylines = ir.evaluation.paylines.map((positions, i) => ({
      id: i,
      positions: [...positions],
    }));
  }

  // ClusterConfig: cluster mode only.
  let clusterConfig: ClusterConfig | undefined;
  if (ir.evaluation.kind === 'cluster') {
    const adjacency =
      ir.topology.kind === 'cluster_grid'
        ? mapAdjacency(ir.topology.adjacency)
        : 'ORTHOGONAL';
    clusterConfig = {
      minClusterSize: ir.evaluation.min_cluster_size,
      adjacency,
      cascadeEnabled: false,
    };
  }

  // Map the IR evalKind onto the legacy enum. The legacy enum drives
  // direction selection inside LineEvaluator; everything else just sees
  // its own evaluation path.
  let evalType: GameConfig['evalType'] = 'LINES_LTR';
  if (ir.evaluation.kind === 'lines') {
    evalType =
      ir.evaluation.direction === 'rtl'
        ? 'LINES_RTL'
        : ir.evaluation.direction === 'both'
        ? 'LINES_BOTH'
        : 'LINES_LTR';
  } else if (ir.evaluation.kind === 'ways') {
    evalType = 'WAYS';
  } else if (ir.evaluation.kind === 'cluster') {
    evalType = 'CLUSTER';
  }

  return {
    name: ir.meta.name,
    version: ir.meta.version,
    targetRTP: ir.limits.target_rtp,
    grid: {
      rows: numRows,
      cols: numCols,
      type: 'FIXED',
    },
    symbols,
    paytable,
    reelSets: [],
    baseGameReelSetId: 'base',
    evalType,
    paylines,
    clusterConfig,
    maxWinMultiplier: ir.limits.max_win_x,
    maxCascades: 50,
  };
}

function mapAdjacency(adj: 'orthogonal' | 'diagonal' | 'hex'): ClusterConfig['adjacency'] {
  // The legacy ClusterConfig type doesn't have a "hex" variant — fall back
  // to BOTH (orthogonal + diagonal), which is the closest approximation
  // that exists in the current enum. Faza 2.x should add HEX properly.
  switch (adj) {
    case 'orthogonal':
      return 'ORTHOGONAL';
    case 'diagonal':
      return 'DIAGONAL';
    case 'hex':
      return 'BOTH';
  }
}

// ─── Scatter / bonus / trigger helpers ─────────────────────────────────────

/** Build symbol kind lookup for fast role checks. */
function buildKindIndex(ir: SlotGameIR): Map<string, IRSymbol['kind']> {
  const m = new Map<string, IRSymbol['kind']>();
  for (const s of ir.symbols) m.set(s.id, s.kind);
  return m;
}

function countByKind(
  grid: string[][],
  kindIndex: Map<string, IRSymbol['kind']>,
  predicate: (k: IRSymbol['kind']) => boolean,
): number {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      const kind = kindIndex.get(cell);
      if (kind && predicate(kind)) count++;
    }
  }
  return count;
}

/**
 * Evaluate trigger conditions on a feature. Returns `true` if the feature
 * fired. Pass already-aggregated scatter / bonus counts to avoid traversing
 * the grid once per feature.
 *
 * Faza 3 additions:
 *   mystery_symbol  — fires every spin (handled by MysteryBehavior.onLand)
 *   symbol_upgrade  — fires based on probability (handled by SymbolUpgrade simulator)
 *   pick / wheel    — fires based on scatter/bonus count trigger
 *   respin          — fires if player is willing to pay (cost_x model; eval returns true
 *                     so the simulator can decide whether to simulate it)
 *   gamble          — fires if there was a win > 0 this spin
 */
function isFeatureTriggered(
  feat: Feature,
  scatterCount: number,
  bonusCount: number,
  _options?: { hadWin?: boolean; evalGrid?: string[][] },
): boolean {
  // Structural features that require separate simulation paths.
  if (
    feat.kind === 'cascade' ||
    feat.kind === 'buy_feature' ||
    feat.kind === 'ante_bet'
  ) {
    return false;
  }

  // mystery_symbol and symbol_upgrade fire every spin — the simulator
  // handles them unconditionally so we do not flag them here.
  if (feat.kind === 'mystery_symbol' || feat.kind === 'symbol_upgrade') {
    return false;
  }

  // respin / pick / wheel / gamble — use their own trigger logic
  if (feat.kind === 'respin' || feat.kind === 'pick' || feat.kind === 'wheel' || feat.kind === 'gamble') {
    // These have TriggerByCount triggers — fall through to count-based logic below.
    // gamble specifically fires when a win occurred (handled in irSimulator by checking spinWon > 0)
    return false;
  }

  // W4.7 — linear_progressive has no per-spin trigger; runtime is handled by
  // the jackpot subsystem reading SlotGameIR.progressive_link directly.
  if (feat.kind === 'linear_progressive') {
    return false;
  }

  const trig = feat.trigger;
  let value = 0;
  switch (trig.by) {
    case 'scatter_count':
      value = scatterCount;
      break;
    case 'bonus_count':
      value = bonusCount;
      break;
    case 'special_count':
      value = scatterCount + bonusCount;
      break;
  }

  // Inclusive minimum: prefer explicit `min`, else lowest numeric threshold
  // key in `thresholds`. If neither is set we cannot trigger.
  let min: number | undefined = trig.min;
  if (min == null && trig.thresholds) {
    const keys = Object.keys(trig.thresholds)
      .map((k) => parseInt(k.replace(/\+$/, ''), 10))
      .filter((n) => !Number.isNaN(n));
    if (keys.length > 0) min = Math.min(...keys);
  }
  if (min == null) return false;
  return value >= min;
}

// ─── Per-mode direct paths ─────────────────────────────────────────────────

/**
 * pay_anywhere evaluator. For each paying symbol in the IR paytable, count
 * how many times it appears anywhere on the grid (wilds also count if the
 * symbol can be substituted). If the count is at least `min_count`, look up
 * the payout from `paytable[symbol][count]` (with "5+" fallback).
 */
function evaluatePayAnywhereIR(
  ir: SlotGameIR,
  grid: string[][],
  minCount: number,
): IRWin[] {
  const wins: IRWin[] = [];
  const kindIndex = buildKindIndex(ir);

  // Collect wild ids that substitute for all non-special symbols.
  const wildIds = new Set<string>();
  for (const s of ir.symbols) {
    const role = irKindToRole(s.kind);
    if (role === 'WILD') wildIds.add(s.id);
  }

  // Count occurrences of every symbol id on the grid plus collect positions.
  const counts = new Map<string, number>();
  const positions = new Map<string, [number, number][]>();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const sym = row[c];
      if (sym === undefined) continue;
      counts.set(sym, (counts.get(sym) ?? 0) + 1);
      const arr = positions.get(sym) ?? [];
      // Note: [reel, row] pair so reel = column index, row = row index.
      arr.push([c, r]);
      positions.set(sym, arr);
    }
  }

  // For every symbol with an entry in the paytable, total = own count +
  // applicable wild count (any wild covers any non-special symbol unless
  // the wild's `substitutes` list explicitly excludes it).
  for (const [symbolId, payMap] of Object.entries(ir.paytable)) {
    const ownCount = counts.get(symbolId) ?? 0;
    let wildCount = 0;
    for (const wildId of wildIds) {
      const wildDef = ir.symbols.find((s) => s.id === wildId);
      if (!wildDef) continue;
      const canSubstitute =
        wildDef.substitutes == null ||
        wildDef.substitutes === '*' ||
        wildDef.substitutes.includes(symbolId);
      if (canSubstitute) wildCount += counts.get(wildId) ?? 0;
    }

    const total = ownCount + wildCount;
    if (total < minCount) continue;

    // Look up payout: prefer exact key, else largest key ≤ total.
    const numericKeys = Object.keys(payMap)
      .map((k) => ({ k, n: parseInt(k.replace(/\+$/, ''), 10) }))
      .filter(({ n }) => !Number.isNaN(n))
      .sort((a, b) => a.n - b.n);

    let payout = 0;
    let payCount = total;
    for (const { k, n } of numericKeys) {
      if (n <= total) {
        const v = payMap[k];
        if (v != null && v > payout) {
          payout = v;
          payCount = n;
        }
      }
    }
    if (payout === 0) continue;

    wins.push({
      symbolId,
      count: payCount,
      payout,
      positions: positions.get(symbolId),
    });

    // Suppress unused-variable lint for kindIndex even though we keep it
    // around for future role-aware filtering (e.g. excluding scatter/bonus
    // from generic pay_anywhere evaluation when the IR adds that flag).
    void kindIndex;
  }

  return wins;
}

/**
 * pattern evaluator. For each pattern in `evaluation.patterns`, walk the
 * declared positions and require all symbols to match the first non-wild
 * symbol on the pattern (with wild substitution). If matched, pay the
 * pattern's `pay_multiplier`.
 */
function evaluatePatternIR(
  ir: SlotGameIR,
  grid: string[][],
  patterns: Array<{
    id: string;
    positions: Array<[number, number]> | 'all';
    pay_multiplier: number;
  }>,
): IRWin[] {
  const wins: IRWin[] = [];

  // Collect wild ids.
  const wildIds = new Set<string>();
  for (const s of ir.symbols) {
    if (irKindToRole(s.kind) === 'WILD') wildIds.add(s.id);
  }

  for (const pattern of patterns) {
    const cells: Array<{ row: number; reel: number; sym: string }> = [];
    if (pattern.positions === 'all') {
      // "all" — every grid cell counts.
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const sym = row[c];
          if (sym !== undefined) cells.push({ row: r, reel: c, sym });
        }
      }
    } else {
      for (const [rowIdx, reelIdx] of pattern.positions) {
        const sym = grid[rowIdx]?.[reelIdx];
        if (sym === undefined) {
          // Missing cell — pattern can't match.
          cells.length = 0;
          break;
        }
        cells.push({ row: rowIdx, reel: reelIdx, sym });
      }
    }
    if (cells.length === 0) continue;

    // Find first non-wild symbol — every other cell must match it (or be wild).
    let target: string | undefined;
    for (const c of cells) {
      if (!wildIds.has(c.sym)) {
        target = c.sym;
        break;
      }
    }
    // All-wild pattern: pay with first wild as the symbol.
    if (target === undefined) {
      target = cells[0]?.sym;
    }
    if (target === undefined) continue;

    const allMatch = cells.every((c) => c.sym === target || wildIds.has(c.sym));
    if (!allMatch) continue;

    wins.push({
      symbolId: target,
      count: cells.length,
      payout: pattern.pay_multiplier,
      positions: cells.map((c) => [c.reel, c.row]),
    });
  }

  return wins;
}

// ─── Public entry point ────────────────────────────────────────────────────

export interface IREvaluateOptions {
  /**
   * When the topology is variable_rows, the dispatcher reports
   * `evalMode: 'variable_ways'` instead of `'ways'`. Default: auto-detect
   * from `ir.topology.kind`.
   */
  forceVariableWays?: boolean;
  /**
   * Faza 3: if supplied, the Behavior Plugin Pipeline runs around win
   * evaluation. The registry is auto-populated from the IR symbols when
   * not provided here — pass `BehaviorRegistry.forIR(ir)` for default
   * behaviour or a custom registry for game-specific overrides.
   */
  behaviors?: BehaviorRegistry;
  /**
   * Faza 3: seeded RNG for behavior hooks that need randomness (e.g.
   * MysteryBehavior reveal). Defaults to Math.random if omitted.
   */
  rng?: () => number;
}

/**
 * Evaluate a grid against the IR and produce an `IRWinResult`.
 *
 * The grid is `grid[row][col]` (the same shape the legacy TS evaluators
 * expect). Pay-anywhere / pattern paths return `[reel, row]` pairs
 * (matching the IR's coordinate convention); lines / ways / cluster paths
 * inherit positions from their respective evaluators.
 *
 * When `options.behaviors` is provided the pipeline runs:
 *   1. BehaviorPipeline.runOnLand()  → transform/expand/reveal effects on grid
 *   2. Win evaluation on (possibly mutated) grid
 *   3. BehaviorPipeline.runOnWin()   → multiplier / jackpot effects
 */
export function evaluateIR(
  ir: SlotGameIR,
  grid: string[][],
  options: IREvaluateOptions = {},
): IRWinResult {
  const kindIndex = buildKindIndex(ir);

  // ── Behavior pipeline: onLand pass ───────────────────────────────────────
  let spinState: SpinState | undefined;
  let evalGrid = grid;

  if (options.behaviors) {
    spinState = createSpinState(grid);
    const pipeline = new BehaviorPipeline(options.behaviors.toMap(), spinState);
    pipeline.runOnLand();
    // Use the (possibly transformed) grid for win evaluation.
    evalGrid = spinState.grid;
  }

  const scatterCount = countByKind(evalGrid, kindIndex, (k) => k === 'scatter');
  const bonusCount = countByKind(evalGrid, kindIndex, (k) => k === 'bonus');

  const triggeredFeatures: string[] = [];
  for (const feat of ir.features) {
    if (isFeatureTriggered(feat, scatterCount, bonusCount)) {
      triggeredFeatures.push(feat.kind);
    }
  }

  let wins: IRWin[] = [];
  let evalMode: IRWinResult['evalMode'];

  switch (ir.evaluation.kind) {
    case 'lines': {
      const cfg = irToLegacyConfig(ir, evalGrid);
      const ctx = createLineEvalContext(cfg);
      const direction =
        ir.evaluation.direction === 'rtl'
          ? 'RTL'
          : ir.evaluation.direction === 'both'
          ? 'BOTH'
          : 'LTR';
      const lineWins = evaluateLines(evalGrid, cfg.paylines ?? [], ctx, direction, true);
      wins = lineWins.map((w) => ({
        symbolId: w.symbolId,
        count: w.count,
        payout: w.totalWin,
        paylineIndex: w.paylineId,
        positions: w.positions.map((p) => [p.col, p.row] as [number, number]),
      }));
      evalMode = 'lines';
      break;
    }

    case 'ways': {
      const cfg = irToLegacyConfig(ir, evalGrid);
      const ctx = createWaysEvalContext(cfg);
      const wayWins = evaluateWays(evalGrid, ctx, true);
      wins = wayWins.map((w) => ({
        symbolId: w.symbolId,
        count: w.count,
        payout: w.totalWin,
      }));
      evalMode =
        options.forceVariableWays || ir.topology.kind === 'variable_rows' ? 'variable_ways' : 'ways';
      break;
    }

    case 'cluster': {
      const cfg = irToLegacyConfig(ir, evalGrid);
      const ctx = createClusterEvalContext(cfg, cfg.clusterConfig);
      const clusterWins = evaluateClusters(evalGrid, ctx, true);
      wins = clusterWins.map((w) => ({
        symbolId: w.symbolId,
        count: w.count,
        payout: w.totalWin,
        positions: w.positions.map((p) => [p.col, p.row] as [number, number]),
      }));
      evalMode = 'cluster';
      break;
    }

    case 'pay_anywhere': {
      wins = evaluatePayAnywhereIR(ir, evalGrid, ir.evaluation.min_count);
      evalMode = 'pay_anywhere';
      break;
    }

    case 'pattern': {
      wins = evaluatePatternIR(ir, evalGrid, ir.evaluation.patterns);
      evalMode = 'pattern';
      break;
    }

    default: {
      const _exhaustive: never = ir.evaluation;
      throw new Error(`Unknown evaluation kind: ${JSON.stringify(_exhaustive)}`);
    }
  }

  // ── Behavior pipeline: onWin pass ────────────────────────────────────────
  if (spinState && options.behaviors && wins.length > 0) {
    const pipeline = new BehaviorPipeline(options.behaviors.toMap(), spinState);
    // Collect all winning positions for onWin hooks.
    const winningPositions: Array<{ symbolId: string; reel: number; row: number }> = [];
    for (const w of wins) {
      if (w.positions) {
        for (const [reel, row] of w.positions) {
          winningPositions.push({ symbolId: w.symbolId, reel, row });
        }
      }
    }
    pipeline.runOnWin(winningPositions);
  }

  const totalPayout = wins.reduce((s, w) => s + w.payout, 0);

  return {
    wins,
    totalPayout,
    spinMultiplier: spinState?.spinMultiplier ?? 1,
    lineMultiplier: spinState?.lineMultiplier ?? 1,
    evalMode,
    scatterCount,
    bonusCount,
    triggeredFeatures,
    spinState,
  };
}

// ─── Public re-exports of helpers (test convenience) ───────────────────────

export const _internal = {
  irToLegacyConfig,
  buildSymbolDefs,
  buildPaytable,
  evaluatePayAnywhereIR,
  evaluatePatternIR,
  isFeatureTriggered,
};

// Helper used by Evaluation discriminator inference in tests.
export function evaluationKind(ev: Evaluation): Evaluation['kind'] {
  return ev.kind;
}
