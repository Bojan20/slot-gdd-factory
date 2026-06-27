/**
 * IR → GameConfig adapter (Faza 1.2 — TypeScript side).
 *
 * Mirrors the Rust `ir/adapter.rs` logic exactly so that the TS preview
 * engine and the Rust MC simulator produce identical GameConfig values for
 * the same IR input — a prerequisite for the Faza 10.3 parity gate.
 *
 * Mapping rules (authoritative spec):
 *   SymbolKind
 *     wild | chain_wild | expanding → isWild
 *     scatter                       → isScatter
 *     bonus                         → isBonus
 *     lp | hp | multiplier | sticky | mystery | transform → all false
 *
 *   Topology
 *     rectangular   → numReels, numRows directly
 *     variable_rows → numReels; numRows = max(row_range_per_reel[][1])
 *     cluster_grid  → columns → numReels, rows → numRows
 *
 *   ReelSet
 *     weighted → (f64 × 10_000).round() → weight integer
 *     strips   → count occurrences → weight integer
 *
 *   Evaluation
 *     lines       → paylines array passed through
 *     ways        → generate synthetic paylines (rows^reels combos)
 *     cluster / pay_anywhere → empty paylines (own evaluator path)
 *     pattern     → empty paylines (future evaluator path)
 *
 *   Paytable
 *     keys "3"/"3+" → pay3, "4"/"4+" → pay4, "5"/"5+" → pay5
 *     other keys (cluster sizes) → ignored in PayEntry
 *
 *   Feature.free_spins  → FreeSpinsConfig
 *   Feature.hold_and_win → HoldAndWinConfig
 *   All other Feature kinds → ignored (TODO per-feature config structs)
 */

import type {
  Evaluation,
  Feature,
  ReelSet,
  SlotGameIR,
  SymbolKind,
  Topology,
} from './types.js';

// ─── GameConfig shape (TS engine format) ──────────────────────────────────

export interface TSSymbolDef {
  id: string;
  name: string;
  isWild: boolean;
  isScatter: boolean;
  isBonus: boolean;
}

export interface TSPayEntry {
  pay3: number;
  pay4: number;
  pay5: number;
}

export interface TSReelWeight {
  symbol: string;
  weight: number;
}

export interface TSFreeSpinsConfig {
  awards: Record<number, number>; // scatter_count → spins_awarded
  multStart: number;
  multIncrement: number;
  multMax: number;
  retriggerEnabled: boolean;
  scatterPays: Record<number, number>; // scatter_count → pay multiplier
}

export interface TSOrbValue {
  value: number;
  weight: number;
  jackpot?: string;
}

export interface TSHoldAndWinConfig {
  triggerCount: number;
  initialRespins: number;
  respinsOnNewOrb: number;
  fullGridBonus: number;
  orbValues: TSOrbValue[];
  orbLandChanceBase: number;
  orbLandChanceFillBonus: number;
}

// ─── W152 P0-3 — IR feature configs ──────────────────────────────────────────
//
// Mirror of `rust-sim/src/config.rs::{CascadeConfig, RespinConfig,
// MysteryConfig}`. Field names use camelCase on the TS side (idiomatic)
// vs snake_case in Rust; the adapter is the single transition point.
// The IR ↔ runtime conversion is byte-stable: a deterministic IR JSON
// produces an identical config in both languages (W152 P0-5 parity
// gate).

export type TSCascadeReplacement = 'drop' | 'refill_random' | 'fixed_strip';

export interface TSCascadeConfig {
  replacement: TSCascadeReplacement;
  maxChain: number;
  multiplierProgression?: number[];
}

export interface TSRespinConfig {
  costX: number;
  maxUsesPerSpin: number;
}

export interface TSMysteryConfig {
  symbolId: string;
  /**
   * Symbol-id → raw weight. The consumer normalises across the full map
   * per spin (same strategy both sides — see parity test fixture).
   */
  revealDistribution: Record<string, number>;
}

// ─── W152 P0-3 round 2 — Pick / Wheel / BuyFeature / AnteBet / Gamble /
// SymbolUpgrade configs ──────────────────────────────────────────────────
//
// Mirror of `rust-sim/src/config.rs::{PrizeSlot, PickConfig, WheelConfig,
// BuyFeatureOffer, BuyFeatureConfig, AnteBetConfig, GambleType,
// GambleTieResolution, GambleConfig, SymbolUpgradeConfig}`. Wire format is
// identical (snake_case on the wire via JSON); the TS adapter exposes
// camelCase fields idiomatically.

export interface TSPrizeSlot {
  id: string;
  weight: number;
  payMultiplier: number;
}

export interface TSPickConfig {
  prizePool: TSPrizeSlot[];
}

export interface TSWheelConfig {
  segments: TSPrizeSlot[];
}

export interface TSBuyFeatureOffer {
  id: string;
  costX: number;
  guaranteed: string;
}

/**
 * Bonus-buy menu config. Jurisdiction-gated downstream (UKGC SI 2025/215,
 * NL KSA May 2024, DE GGL, DK SP all prohibit bonus-buys). The adapter
 * carries the offers verbatim; gating happens in `jurisdiction.validate`.
 */
export interface TSBuyFeatureConfig {
  offers: TSBuyFeatureOffer[];
}

export interface TSAnteBetConfig {
  extraMultiplier: number;
  enabledByDefault: boolean;
}

export type TSGambleType = 'red_black' | 'suit';
export type TSGambleTieResolution = 'house' | 'push';

export interface TSGambleConfig {
  type: TSGambleType;
  maxSteps: number;
  tieResolution: TSGambleTieResolution;
}

export interface TSSymbolUpgradeConfig {
  from: string;
  to: string;
  probability: number;
}

// ─── W152 Faza 2.4 — Pattern evaluator config ───────────────────────────────
//
// Mirror of `rust-sim/src/config.rs::{PatternRuleConfig, PatternConfig}`.
// Positions are `[row, reel]` tuples — same wire shape as the IR
// `PatternPositions::List` variant.

export interface TSPatternRuleConfig {
  id: string;
  /** `[row, reel]` per cell. */
  positions: Array<[number, number]>;
  payMultiplier: number;
}

export interface TSPatternConfig {
  rules: TSPatternRuleConfig[];
}

export interface TSGameConfig {
  name: string;
  version: string;
  targetRtp: number; // 0–100 (percentage)
  maxWinCap: number;

  // Grid
  numReels: number;
  numRows: number;
  paylines: number[][];

  // Symbols
  symbols: TSSymbolDef[];
  paytable: Record<string, TSPayEntry>;

  // Reel weights
  baseWeights: TSReelWeight[][];
  fsWeights: TSReelWeight[][];

  // Features
  freeSpins: TSFreeSpinsConfig;
  holdAndWin: TSHoldAndWinConfig;
  // W152 P0-3 — IR feature unstub. Optional so games that don't declare
  // the feature get `undefined` and downstream branches via truthiness.
  cascade?: TSCascadeConfig;
  respin?: TSRespinConfig;
  mystery?: TSMysteryConfig;
  // W152 P0-3 round 2 — Pick / Wheel / BuyFeature / AnteBet / Gamble /
  // SymbolUpgrade. Same Optional pattern.
  pick?: TSPickConfig;
  wheel?: TSWheelConfig;
  buyFeature?: TSBuyFeatureConfig;
  anteBet?: TSAnteBetConfig;
  gamble?: TSGambleConfig;
  symbolUpgrade?: TSSymbolUpgradeConfig;
  // W152 Faza 2.4 — Pattern evaluator (kind === "pattern"). Populated
  // only when the IR evaluation is `pattern`, otherwise undefined.
  pattern?: TSPatternConfig;
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class AdapterError extends Error {
  constructor(
    public readonly kind: 'unsupported_topology' | 'unsupported_evaluation' | 'missing_weights',
    message: string,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

// ─── Weight scale constant ────────────────────────────────────────────────────

const WEIGHT_SCALE = 10_000;

function f64ToWeight(v: number): number {
  return Math.round(v * WEIGHT_SCALE);
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Convert a validated `SlotGameIR` into `TSGameConfig`.
 * Call `crossValidate` on the IR before calling this function.
 * @throws {AdapterError} on unsupported topology/evaluation or missing weights.
 */
export function irToGameConfig(ir: SlotGameIR): TSGameConfig {
  const [numReels, numRows] = topologyToDims(ir.topology);
  const symbols = convertSymbols(ir);
  const { baseWeights, fsWeights } = convertReels(ir, symbols);
  const paylines = convertPaylines(ir, numReels, numRows);
  const paytable = convertPaytable(ir);
  const {
    freeSpins,
    holdAndWin,
    cascade,
    respin,
    mystery,
    pick,
    wheel,
    buyFeature,
    anteBet,
    gamble,
    symbolUpgrade,
  } = convertFeatures(ir);
  // W152 Faza 2.4 — Pattern evaluator. Lives on `evaluation`, not
  // `features[]`, so we extract it through a dedicated helper.
  const pattern = convertPatternConfig(ir.evaluation);

  return {
    name: ir.meta.name,
    version: ir.meta.version,
    targetRtp: ir.limits.target_rtp * 100,
    maxWinCap: ir.limits.max_win_x,
    numReels,
    numRows,
    paylines,
    symbols,
    paytable,
    baseWeights,
    fsWeights,
    freeSpins,
    holdAndWin,
    // W152 P0-3 — IR feature unstub. Only emit the key if the IR
    // declared the feature; otherwise omit so JSON stays compact and
    // matches Rust's `skip_serializing_if = "Option::is_none"`.
    ...(cascade !== undefined ? { cascade } : {}),
    ...(respin !== undefined ? { respin } : {}),
    ...(mystery !== undefined ? { mystery } : {}),
    ...(pick !== undefined ? { pick } : {}),
    ...(wheel !== undefined ? { wheel } : {}),
    ...(buyFeature !== undefined ? { buyFeature } : {}),
    ...(anteBet !== undefined ? { anteBet } : {}),
    ...(gamble !== undefined ? { gamble } : {}),
    ...(symbolUpgrade !== undefined ? { symbolUpgrade } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
  };
}

// W152 Faza 2.4 — Pattern config extraction. Returns `undefined` if the
// IR's evaluation kind is anything other than `pattern`. An empty
// patterns list yields `{ rules: [] }` (NOT `undefined`) so downstream
// code can tell "game uses pattern mode with zero rules" apart from
// "game does not use pattern mode".
function convertPatternConfig(evaluation: Evaluation): TSPatternConfig | undefined {
  if (evaluation.kind !== 'pattern') {
    return undefined;
  }
  const rules: TSPatternRuleConfig[] = evaluation.patterns.map((p) => {
    const positions: Array<[number, number]> =
      p.positions === 'all'
        ? [] // "all" expanded by the evaluator factory against grid dims.
        : p.positions.map(([row, reel]) => [row, reel] as [number, number]);
    return {
      id: p.id,
      positions,
      payMultiplier: p.pay_multiplier,
    };
  });
  return { rules };
}

// ─── Topology ────────────────────────────────────────────────────────────────

function topologyToDims(topology: Topology): [number, number] {
  switch (topology.kind) {
    case 'rectangular':
      return [topology.reels, topology.rows];

    case 'variable_rows': {
      const maxRows = Math.max(...topology.row_range_per_reel.map(([, hi]) => hi));
      return [topology.reels, maxRows];
    }

    case 'cluster_grid':
      return [topology.columns, topology.rows];

    default: {
      // TypeScript exhaustiveness guard
      const _exhaustive: never = topology;
      throw new AdapterError('unsupported_topology', `Unknown topology kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Symbols ─────────────────────────────────────────────────────────────────

function convertSymbols(ir: SlotGameIR): TSSymbolDef[] {
  return ir.symbols.map((s) => {
    const [isWild, isScatter, isBonus] = mapSymbolKind(s.kind);
    return { id: s.id, name: s.name, isWild, isScatter, isBonus };
  });
}

function mapSymbolKind(kind: SymbolKind): [boolean, boolean, boolean] {
  switch (kind) {
    case 'wild':
    case 'chain_wild':
    case 'expanding':
      return [true, false, false];
    case 'scatter':
      return [false, true, false];
    case 'bonus':
      return [false, false, true];
    case 'lp':
    case 'hp':
    case 'multiplier':
    case 'sticky':
    case 'mystery':
    case 'transform':
      return [false, false, false];
    default: {
      // Exhaustiveness guard
      const _exhaustive: never = kind;
      return [false, false, false];
    }
  }
}

// ─── Reels ───────────────────────────────────────────────────────────────────

function convertReels(
  ir: SlotGameIR,
  symbols: TSSymbolDef[],
): { baseWeights: TSReelWeight[][]; fsWeights: TSReelWeight[][] } {
  const symIndex = new Map<string, number>(symbols.map((s, i) => [s.id, i]));

  const reelSet: ReelSet = ir.reels;

  if (reelSet.mode === 'weighted') {
    const baseWeights = weightedMapToReelWeights(reelSet.base, symIndex);
    const fsWeights = reelSet.free_spins
      ? weightedMapToReelWeights(reelSet.free_spins, symIndex)
      : baseWeights.map((reel) => [...reel]);
    return { baseWeights, fsWeights };
  }

  // strips mode
  const baseWeights = stripsToReelWeights(reelSet.base, symIndex);
  const fsWeights = reelSet.free_spins
    ? stripsToReelWeights(reelSet.free_spins, symIndex)
    : baseWeights.map((reel) => [...reel]);
  return { baseWeights, fsWeights };
}

function weightedMapToReelWeights(
  reels: Array<Record<string, number>>,
  symIndex: Map<string, number>,
): TSReelWeight[][] {
  return reels.map((map, reelIdx) => {
    const entries = Object.entries(map).filter(([id]) => symIndex.has(id));
    if (entries.length === 0) {
      throw new AdapterError('missing_weights', `Reel ${reelIdx} has no valid symbol weights`);
    }
    return entries.map(([symbol, raw]) => ({
      symbol,
      weight: f64ToWeight(raw),
    }));
  });
}

function stripsToReelWeights(
  reels: string[][],
  symIndex: Map<string, number>,
): TSReelWeight[][] {
  return reels.map((strip, reelIdx) => {
    const counts = new Map<string, number>();
    for (const sym of strip) {
      if (symIndex.has(sym)) {
        counts.set(sym, (counts.get(sym) ?? 0) + 1);
      }
    }
    if (counts.size === 0) {
      throw new AdapterError('missing_weights', `Reel ${reelIdx} strip has no valid symbols`);
    }
    return Array.from(counts.entries()).map(([symbol, count]) => ({
      symbol,
      weight: count,
    }));
  });
}

// ─── Paylines ─────────────────────────────────────────────────────────────────

function convertPaylines(ir: SlotGameIR, numReels: number, numRows: number): number[][] {
  const evaluation: Evaluation = ir.evaluation;

  switch (evaluation.kind) {
    case 'lines':
      return evaluation.paylines.map((pl) => [...pl]);

    case 'ways':
      return generateWaysPaylines(numReels, numRows);

    case 'cluster':
    case 'pay_anywhere':
    case 'pattern':
      // Own evaluator path — paylines unused.
      return [];

    default: {
      const _exhaustive: never = evaluation;
      throw new AdapterError('unsupported_evaluation', `Unknown evaluation kind`);
    }
  }
}

/**
 * Generate all-ways synthetic paylines.
 * Each combination of row indices across all reels becomes one payline.
 * For 5 reels × 3 rows → 3^5 = 243 paylines.
 */
function generateWaysPaylines(numReels: number, numRows: number): number[][] {
  const total = Math.pow(numRows, numReels);
  const paylines: number[][] = [];

  for (let combo = 0; combo < total; combo++) {
    const pl: number[] = new Array(numReels);
    let rem = combo;
    for (let reel = numReels - 1; reel >= 0; reel--) {
      pl[reel] = rem % numRows;
      rem = Math.floor(rem / numRows);
    }
    paylines.push(pl);
  }

  return paylines;
}

// ─── Paytable ────────────────────────────────────────────────────────────────

function convertPaytable(ir: SlotGameIR): Record<string, TSPayEntry> {
  const out: Record<string, TSPayEntry> = {};

  for (const [symId, countMap] of Object.entries(ir.paytable)) {
    const entry: TSPayEntry = { pay3: 0, pay4: 0, pay5: 0 };

    for (const [key, val] of Object.entries(countMap)) {
      const numeric = key.replace(/\+$/, '');
      switch (numeric) {
        case '3': entry.pay3 = val; break;
        case '4': entry.pay4 = val; break;
        case '5': entry.pay5 = val; break;
        default:
          // Higher cluster counts — not stored in PayEntry.
          break;
      }
    }

    out[symId] = entry;
  }

  return out;
}

// ─── Features ────────────────────────────────────────────────────────────────

function convertFeatures(ir: SlotGameIR): {
  freeSpins: TSFreeSpinsConfig;
  holdAndWin: TSHoldAndWinConfig;
  cascade?: TSCascadeConfig;
  respin?: TSRespinConfig;
  mystery?: TSMysteryConfig;
  pick?: TSPickConfig;
  wheel?: TSWheelConfig;
  buyFeature?: TSBuyFeatureConfig;
  anteBet?: TSAnteBetConfig;
  gamble?: TSGambleConfig;
  symbolUpgrade?: TSSymbolUpgradeConfig;
} {
  let freeSpins = defaultFreeSpins();
  let holdAndWin = defaultHoldAndWin();
  let cascade: TSCascadeConfig | undefined;
  let respin: TSRespinConfig | undefined;
  let mystery: TSMysteryConfig | undefined;
  let pick: TSPickConfig | undefined;
  let wheel: TSWheelConfig | undefined;
  let buyFeature: TSBuyFeatureConfig | undefined;
  let anteBet: TSAnteBetConfig | undefined;
  let gamble: TSGambleConfig | undefined;
  let symbolUpgrade: TSSymbolUpgradeConfig | undefined;

  for (const feat of ir.features) {
    switch (feat.kind) {
      case 'free_spins':
        freeSpins = convertFreeSpins(feat);
        break;

      case 'hold_and_win':
        holdAndWin = convertHoldAndWin(feat);
        break;

      // W152 P0-3 — Cascade (drop / refill / fixed-strip).
      case 'cascade':
        cascade = convertCascade(feat);
        break;

      // W152 P0-3 — Respin (paid extra spin).
      case 'respin':
        respin = convertRespin(feat);
        break;

      // W152 P0-3 — MysterySymbol (placeholder reveal).
      case 'mystery_symbol':
        mystery = convertMystery(feat);
        break;

      // W152 P0-3 round 2 — Pick bonus.
      case 'pick':
        pick = convertPick(feat);
        break;

      // W152 P0-3 round 2 — Wheel bonus.
      case 'wheel':
        wheel = convertWheel(feat);
        break;

      // W152 P0-3 round 2 — BuyFeature (jurisdiction-gated downstream).
      case 'buy_feature':
        buyFeature = convertBuyFeature(feat);
        break;

      // W152 P0-3 round 2 — AnteBet stake modifier.
      case 'ante_bet':
        anteBet = convertAnteBet(feat);
        break;

      // W152 P0-3 round 2 — Gamble post-win double-up (jurisdiction-gated).
      case 'gamble':
        gamble = convertGamble(feat);
        break;

      // W152 P0-3 round 2 — SymbolUpgrade transform.
      case 'symbol_upgrade':
        symbolUpgrade = convertSymbolUpgrade(feat);
        break;

      default:
        break;
    }
  }

  return {
    freeSpins,
    holdAndWin,
    cascade,
    respin,
    mystery,
    pick,
    wheel,
    buyFeature,
    anteBet,
    gamble,
    symbolUpgrade,
  };
}

// W152 P0-3 — Cascade
function convertCascade(
  feat: Extract<Feature, { kind: 'cascade' }>,
): TSCascadeConfig {
  return {
    replacement: feat.replacement,
    maxChain: feat.max_chain,
    multiplierProgression: feat.multiplier_progression
      ? [...feat.multiplier_progression]
      : undefined,
  };
}

// W152 P0-3 — Respin
function convertRespin(
  feat: Extract<Feature, { kind: 'respin' }>,
): TSRespinConfig {
  return {
    costX: feat.cost_x,
    maxUsesPerSpin: feat.max_uses_per_spin,
  };
}

// W152 P0-3 — MysterySymbol
function convertMystery(
  feat: Extract<Feature, { kind: 'mystery_symbol' }>,
): TSMysteryConfig {
  // Sort keys alphabetically so the resulting record iterates in the
  // same order as the Rust BTreeMap → parity-safe.
  const sortedKeys = Object.keys(feat.reveal_distribution).sort();
  const distribution: Record<string, number> = {};
  for (const key of sortedKeys) {
    distribution[key] = feat.reveal_distribution[key];
  }
  return {
    symbolId: feat.symbol_id,
    revealDistribution: distribution,
  };
}

// ─── W152 P0-3 round 2 — Pick / Wheel / BuyFeature / AnteBet / Gamble /
// SymbolUpgrade converters ──────────────────────────────────────────────

/** IR `{ id, weight, pay_multiplier }` → TS `{ id, weight, payMultiplier }`. */
function prizeEntryToSlot(entry: {
  id: string;
  weight: number;
  pay_multiplier: number;
}): TSPrizeSlot {
  return {
    id: entry.id,
    weight: entry.weight,
    payMultiplier: entry.pay_multiplier,
  };
}

function convertPick(feat: Extract<Feature, { kind: 'pick' }>): TSPickConfig {
  return {
    prizePool: feat.prize_pool.map(prizeEntryToSlot),
  };
}

function convertWheel(feat: Extract<Feature, { kind: 'wheel' }>): TSWheelConfig {
  return {
    segments: feat.segments.map(prizeEntryToSlot),
  };
}

function convertBuyFeature(
  feat: Extract<Feature, { kind: 'buy_feature' }>,
): TSBuyFeatureConfig {
  return {
    offers: feat.offers.map((o) => ({
      id: o.id,
      costX: o.cost_x,
      guaranteed: o.guaranteed,
    })),
  };
}

function convertAnteBet(
  feat: Extract<Feature, { kind: 'ante_bet' }>,
): TSAnteBetConfig {
  return {
    extraMultiplier: feat.extra_multiplier,
    enabledByDefault: feat.enabled_by_default,
  };
}

function convertGamble(
  feat: Extract<Feature, { kind: 'gamble' }>,
): TSGambleConfig {
  return {
    type: feat.type,
    maxSteps: feat.max_steps,
    tieResolution: feat.tie_resolution,
  };
}

function convertSymbolUpgrade(
  feat: Extract<Feature, { kind: 'symbol_upgrade' }>,
): TSSymbolUpgradeConfig {
  return {
    from: feat.from,
    to: feat.to,
    probability: feat.probability,
  };
}

function convertFreeSpins(feat: Extract<Feature, { kind: 'free_spins' }>): TSFreeSpinsConfig {
  const awards: Record<number, number> = {};
  const scatterPays: Record<number, number> = {};

  if (feat.trigger.thresholds) {
    for (const [key, val] of Object.entries(feat.trigger.thresholds)) {
      const count = parseInt(key.replace(/\+$/, ''), 10);
      if (!isNaN(count)) {
        awards[count] = val;
      }
    }
  }

  if (Object.keys(awards).length === 0 && feat.trigger.min != null) {
    awards[feat.trigger.min] = 10;
  }

  const multStart = feat.global_multiplier != null ? feat.global_multiplier : 1;
  const multIncrement = feat.global_multiplier != null ? 0 : 1;
  const multMax = feat.global_multiplier != null ? multStart : 10;
  const retriggerEnabled = feat.retrigger != null;

  return { awards, scatterPays, multStart, multIncrement, multMax, retriggerEnabled };
}

function convertHoldAndWin(feat: Extract<Feature, { kind: 'hold_and_win' }>): TSHoldAndWinConfig {
  // Trigger count: prefer min, else lowest threshold key.
  let triggerCount = feat.trigger.min;
  if (triggerCount == null && feat.trigger.thresholds) {
    const keys = Object.keys(feat.trigger.thresholds)
      .map((k) => parseInt(k.replace(/\+$/, ''), 10))
      .filter((n) => !isNaN(n));
    if (keys.length > 0) triggerCount = Math.min(...keys);
  }
  triggerCount ??= 6;

  const orbValues: TSOrbValue[] = feat.cash_value_distribution.map((dist) => {
    const jackpot = feat.jackpot_tiers.find(
      (t) => Math.abs(t.multiplier - dist.value) < 0.01,
    )?.id;
    return { value: dist.value, weight: f64ToWeight(dist.weight), jackpot };
  });

  const fullGridBonus =
    feat.grid_full_award != null
      ? (feat.jackpot_tiers.find((t) => t.id === feat.grid_full_award)?.multiplier ?? 500)
      : 500;

  return {
    triggerCount,
    initialRespins: feat.respins_initial,
    respinsOnNewOrb: feat.respins_initial,
    fullGridBonus,
    orbValues,
    orbLandChanceBase: 0.035,
    orbLandChanceFillBonus: 0.015,
  };
}

// ─── Defaults (when IR has no matching feature) ───────────────────────────────

function defaultFreeSpins(): TSFreeSpinsConfig {
  return {
    awards: { 3: 10, 4: 12, 5: 15 },
    scatterPays: {},
    multStart: 1,
    multIncrement: 1,
    multMax: 10,
    retriggerEnabled: true,
  };
}

function defaultHoldAndWin(): TSHoldAndWinConfig {
  return {
    triggerCount: 6,
    initialRespins: 3,
    respinsOnNewOrb: 3,
    fullGridBonus: 500,
    orbValues: [
      { value: 1, weight: 6000 },
      { value: 2, weight: 2500 },
      { value: 5, weight: 1000 },
    ],
    orbLandChanceBase: 0.035,
    orbLandChanceFillBonus: 0.015,
  };
}
