/**
 * Faza 13.7 — Generic → IR conversion framework.
 *
 * Takes a normalised GenericGameConfig and produces a SlotGameIR,
 * collecting warnings for lossy or ambiguous mappings.
 */

import type { SlotGameIR, Symbol, Feature, ReelSet, Evaluation, SchemaVersion } from '../ir/types.js';
import { validateUSIF } from '../usif/validator.js';
import type { ConversionResult, ConversionWarning, DialectId, GenericGameConfig } from './types.js';

// ─── Known GenericGameConfig field names ──────────────────────────────

const KNOWN_GENERIC_FIELDS = new Set([
  'gameId', 'gameName', 'gameVersion', 'provider',
  'reels', 'rows',
  'symbolList', 'symbols',
  'paytable', 'pays',
  'reelWeights', 'reelStrips', 'weightedReels',
  'rtp', 'paylines',
  'minBet', 'maxBet', 'defaultBet',
  'hasFreeSpins', 'freeSpinsCount', 'hasWild', 'hasScatter',
  'hasBuyFeature', 'hasGamble', 'hasCascade', 'hasHoldAndWin',
]);

const MAX_PAYLINES = 20;

// ─── Main function ────────────────────────────────────────────────────

export function genericToIR(generic: GenericGameConfig, dialectId: DialectId): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const lossyFields: string[] = [];

  // ── Topology ─────────────────────────────────────────────────────────
  const numReels = generic.reels ?? 5;
  const numRows = generic.rows ?? 3;

  // ── Symbols ──────────────────────────────────────────────────────────
  const symbols: Symbol[] = buildSymbols(generic, warnings);

  // ── Reels ────────────────────────────────────────────────────────────
  const reelSet: ReelSet = buildReels(generic, numReels, symbols, warnings);

  // ── Paytable ─────────────────────────────────────────────────────────
  const rawPaytable = generic.paytable ?? generic.pays ?? {};
  const paytable: SlotGameIR['paytable'] = normalizePaytable(rawPaytable, symbols);

  // ── Paylines / Evaluation ─────────────────────────────────────────────
  const { evaluation, evalWarnings } = buildEvaluation(generic, numReels, numRows);
  warnings.push(...evalWarnings);
  if (evalWarnings.some((w) => w.field === 'paylines.truncated')) {
    lossyFields.push('paylines.truncated');
  }

  // ── Features ─────────────────────────────────────────────────────────
  const features: Feature[] = buildFeatures(generic, symbols, lossyFields);

  // ── Warn about unknown fields ─────────────────────────────────────────
  for (const key of Object.keys(generic)) {
    if (!KNOWN_GENERIC_FIELDS.has(key)) {
      warnings.push({
        field: key,
        message: `unknown field '${key}' — not mapped to IR`,
        originalValue: (generic as Record<string, unknown>)[key],
      });
      lossyFields.push(key);
    }
  }

  // ── Build IR ──────────────────────────────────────────────────────────
  const ir: SlotGameIR = {
    schema_version: '1.0.0',
    meta: {
      id: generic.gameId ?? 'unknown',
      name: generic.gameName ?? 'Unknown Game',
      version: normalizeVersion(generic.gameVersion),
      theme_tags: [],
    },
    topology: {
      kind: 'rectangular',
      reels: numReels,
      rows: numRows,
    },
    symbols,
    reels: reelSet,
    evaluation,
    paytable,
    features,
    rng: {
      kind: 'mulberry32',
      default_seed: 42,
    },
    bet: {
      currency: 'EUR',
      base_bet: generic.defaultBet ?? generic.minBet ?? 1,
      denominations: buildDenominations(generic),
    },
    limits: {
      target_rtp: generic.rtp ?? 0.96,
      rtp_tolerance: 0.01,
      max_win_x: 5000,
      win_cap_apply: 'per_spin',
      target_volatility: 'medium',
      hit_freq_target: 0.35,
    },
    compliance: {
      jurisdictions: ['MGA'],
      rtp_range_required: [0.85, 0.99],
      max_win_cap_required: 5000,
      near_miss_rule: 'must_be_random',
      ldw_disclosure: true,
      session_time_display: true,
    },
    rtp_allocation: {
      base_game: 0.70,
      free_spins: generic.hasFreeSpins ? 0.26 : 0.0,
      hold_and_win: generic.hasHoldAndWin ? 0.10 : 0.0,
      jackpot: 0.0,
      tolerance: 0.01,
    },
  };

  // Fix rtp_allocation sum
  const alloc = ir.rtp_allocation;
  const sum = alloc.base_game + alloc.free_spins + alloc.hold_and_win + alloc.jackpot;
  if (Math.abs(sum - ir.limits.target_rtp) > alloc.tolerance) {
    ir.rtp_allocation = {
      ...alloc,
      base_game: ir.limits.target_rtp - alloc.free_spins - alloc.hold_and_win - alloc.jackpot,
    };
  }

  // ── USIF validation ────────────────────────────────────────────────────
  const usifResult = validateUSIF(ir);
  const usifValid = usifResult.valid;

  return {
    ir,
    dialect: dialectId,
    warnings,
    lossyFields,
    usifValid,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function buildSymbols(generic: GenericGameConfig, warnings: ConversionWarning[]): Symbol[] {
  const symbols: Symbol[] = [];

  if (generic.symbolList && generic.symbolList.length > 0) {
    for (const s of generic.symbolList) {
      const isWild = s.isWild ?? false;
      const isScatter = s.isScatter ?? false;
      const kind: Symbol['kind'] = isWild ? 'wild' : isScatter ? 'scatter' : 'lp';
      symbols.push({
        id: s.id,
        name: s.id,
        kind,
        ...(isWild ? { substitutes: '*' as const } : {}),
      });
    }
  } else if (generic.symbols) {
    for (const [id, attrs] of Object.entries(generic.symbols)) {
      const isWild = attrs.wild ?? false;
      const isScatter = attrs.scatter ?? false;
      const kind: Symbol['kind'] = isWild ? 'wild' : isScatter ? 'scatter' : 'lp';
      symbols.push({
        id,
        name: id,
        kind,
        ...(isWild ? { substitutes: '*' as const } : {}),
      });
    }
  } else {
    // Infer from paytable keys + wild/scatter flags
    const paytable = generic.paytable ?? generic.pays ?? {};
    const symIds = Object.keys(paytable);
    if (symIds.length === 0) {
      // Fallback: create placeholder symbols
      warnings.push({ field: 'symbols', message: 'no symbol definitions found; using placeholder symbols' });
      symbols.push({ id: 'LP1', name: 'LP1', kind: 'lp' });
      symbols.push({ id: 'LP2', name: 'LP2', kind: 'lp' });
    } else {
      for (const id of symIds) {
        symbols.push({ id, name: id, kind: 'lp' });
      }
    }
    // Add wild/scatter symbols if flagged but not in paytable
    if (generic.hasWild && !symbols.some((s) => s.kind === 'wild')) {
      symbols.push({ id: 'WLD', name: 'Wild', kind: 'wild', substitutes: '*' });
    }
    if (generic.hasScatter && !symbols.some((s) => s.kind === 'scatter')) {
      symbols.push({ id: 'SCT', name: 'Scatter', kind: 'scatter' });
    }
  }

  return symbols;
}

function buildReels(
  generic: GenericGameConfig,
  numReels: number,
  symbols: Symbol[],
  warnings: ConversionWarning[],
): ReelSet {
  // 1. weightedReels (weighted-pairs shape): array of [{symbol, weight}, ...]
  if (generic.weightedReels && generic.weightedReels.length > 0) {
    const base: Array<Record<string, number>> = generic.weightedReels.map((reelArr) => {
      const map: Record<string, number> = {};
      for (const { symbol, weight } of reelArr) {
        map[symbol] = weight;
      }
      return map;
    });
    return { mode: 'weighted', base };
  }

  // 2. reelWeights (reel-weight-map shape): array of {symbolId: weight}
  if (generic.reelWeights && generic.reelWeights.length > 0) {
    return { mode: 'weighted', base: generic.reelWeights };
  }

  // 3. reelStrips (reel-strips shape): array of symbol strips
  if (generic.reelStrips && generic.reelStrips.length > 0) {
    // Convert strips to weighted by counting occurrences
    const base: Array<Record<string, number>> = generic.reelStrips.map((strip) => {
      const counts: Record<string, number> = {};
      for (const sym of strip) {
        counts[sym] = (counts[sym] ?? 0) + 1;
      }
      return counts;
    });
    return { mode: 'weighted', base };
  }

  // 4. Default: equal weights for all symbols across all reels
  warnings.push({ field: 'reels', message: 'no reel definitions found; using equal-weight defaults' });
  const defaultWeights: Record<string, number> = {};
  for (const sym of symbols) {
    defaultWeights[sym.id] = 1;
  }
  const base: Array<Record<string, number>> = Array.from({ length: numReels }, () => ({ ...defaultWeights }));
  return { mode: 'weighted', base };
}

function normalizePaytable(
  rawPaytable: Record<string, number[] | Record<string, number>>,
  _symbols: Symbol[],
): SlotGameIR['paytable'] {
  const result: SlotGameIR['paytable'] = {};
  for (const [symId, pays] of Object.entries(rawPaytable)) {
    if (Array.isArray(pays)) {
      // Convert array to { "3": val, "4": val, ... } — index 0 → count 3
      const map: Record<string, number> = {};
      pays.forEach((v, i) => {
        map[String(i + 3)] = v;
      });
      result[symId] = map;
    } else if (typeof pays === 'object' && pays !== null) {
      result[symId] = pays as Record<string, number>;
    }
  }
  return result;
}

function buildEvaluation(
  generic: GenericGameConfig,
  numReels: number,
  numRows: number,
): { evaluation: Evaluation; evalWarnings: ConversionWarning[] } {
  const evalWarnings: ConversionWarning[] = [];

  if (generic.paylines === undefined) {
    // Default: single centre line
    const centerRow = Math.floor(numRows / 2);
    const paylines = [Array.from({ length: numReels }, () => centerRow)];
    return {
      evaluation: {
        kind: 'lines',
        paylines,
        direction: 'ltr',
        min_match: 3,
        pay_left_to_right_only: true,
      },
      evalWarnings,
    };
  }

  if (typeof generic.paylines === 'number') {
    // Generate N standard paylines
    const count = generic.paylines;
    const paylines = generatePaylines(count, numReels, numRows, evalWarnings);
    return {
      evaluation: {
        kind: 'lines',
        paylines,
        direction: 'ltr',
        min_match: 3,
        pay_left_to_right_only: true,
      },
      evalWarnings,
    };
  }

  // Array of paylines
  let paylines = generic.paylines as number[][];
  if (paylines.length > MAX_PAYLINES) {
    evalWarnings.push({
      field: 'paylines.truncated',
      message: `paylines truncated from ${paylines.length} to ${MAX_PAYLINES}`,
      originalValue: paylines.length,
    });
    paylines = paylines.slice(0, MAX_PAYLINES);
  }
  return {
    evaluation: {
      kind: 'lines',
      paylines,
      direction: 'ltr',
      min_match: 3,
      pay_left_to_right_only: true,
    },
    evalWarnings,
  };
}

function generatePaylines(
  count: number,
  numReels: number,
  numRows: number,
  warnings: ConversionWarning[],
): number[][] {
  // Generate simple paylines (horizontal rows, then variations)
  const lines: number[][] = [];
  const centerRow = Math.floor(numRows / 2);

  // Row-by-row
  for (let row = 0; row < numRows && lines.length < count; row++) {
    lines.push(Array.from({ length: numReels }, () => row));
  }

  // Diagonal patterns
  if (lines.length < count && numRows > 1) {
    // V-shape
    const v = Array.from({ length: numReels }, (_, i) => {
      const mid = Math.floor(numReels / 2);
      return i <= mid ? i % numRows : (numReels - 1 - i) % numRows;
    });
    if (lines.length < count) lines.push(v);
  }

  // Fill remaining with center line variants
  while (lines.length < count && lines.length < MAX_PAYLINES) {
    lines.push(Array.from({ length: numReels }, () => centerRow));
  }

  if (count > MAX_PAYLINES) {
    warnings.push({
      field: 'paylines.truncated',
      message: `payline count ${count} exceeds max ${MAX_PAYLINES}; truncated`,
      originalValue: count,
    });
  }

  return lines.slice(0, Math.min(count, MAX_PAYLINES));
}

function buildFeatures(generic: GenericGameConfig, symbols: Symbol[], lossyFields: string[]): Feature[] {
  const features: Feature[] = [];

  if (generic.hasFreeSpins) {
    const hasScatterSym = symbols.some((s) => s.kind === 'scatter');
    features.push({
      kind: 'free_spins',
      trigger: {
        by: hasScatterSym ? 'scatter_count' : 'bonus_count',
        thresholds: { '3': generic.freeSpinsCount ?? 10 },
      },
      global_multiplier: 1,
    });
  }

  if (generic.hasCascade) {
    features.push({
      kind: 'cascade',
      replacement: 'drop',
      max_chain: 10,
    });
  }

  if (generic.hasGamble) {
    features.push({
      kind: 'gamble',
      type: 'red_black',
      max_steps: 5,
      tie_resolution: 'house',
    });
  }

  if (generic.hasBuyFeature) {
    const offers = [{ id: 'buy_fs', cost_x: 100, guaranteed: 'free_spins' }];
    features.push({ kind: 'buy_feature', offers });
    lossyFields.push('buy_feature.offers');
  }

  if (generic.hasHoldAndWin) {
    const hasBonusSym = symbols.some((s) => s.kind === 'bonus');
    if (!hasBonusSym) {
      symbols.push({ id: 'BNS', name: 'Bonus', kind: 'bonus' });
    }
    features.push({
      kind: 'hold_and_win',
      trigger: { by: 'bonus_count', min: 6 },
      respins_initial: 3,
      respin_reset_on_new: true,
      cash_value_distribution: [{ value: 1, weight: 100 }],
      jackpot_tiers: [{ id: 'MINI', multiplier: 50 }],
    });
  }

  return features;
}

function normalizeVersion(raw: string | undefined): SchemaVersion {
  if (!raw) return '1.0.0';
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.').filter((p) => p.length > 0);
  const major = parts[0] ?? '1';
  const minor = parts[1] ?? '0';
  const patch = parts[2] ?? '0';
  return `${major}.${minor}.${patch}` as SchemaVersion;
}

function buildDenominations(generic: GenericGameConfig): number[] {
  const base = generic.defaultBet ?? generic.minBet ?? 1;
  return [base * 0.1, base, base * 10].filter((v) => v > 0);
}
