#!/usr/bin/env node
/**
 * tools/sgs-compiler.mjs
 *
 * UQ-DEEP-AG · industry-grade `serverConfig` kompajler (Boki 2026-06-24).
 *
 * Boki: "overi detaljno jedan po jedan fajl i uporedi sa nasim slot gdd blokovima
 * ... da rtadi automatizn=ovano i izuzetno tacno ama bas svaki jebeni put!"
 *
 * Senior audit identified: math/server pipeline ne emit-uje wire-compatible
 * serverConfig (gain_table, reels[][], special_symbols, lines flatten, integer
 * weights). To je P0 ship-blocker contract iz industry math handshake-a.
 *
 * Ovaj compiler uzima parsed model + paytable + reel-strip set, i emit-uje
 * wire-compatible serverConfig + paytable_hash + gle_version field.
 *
 * Industry spec: `industry-settings-contract.md` §4 (rule 1-8) + P2.3.
 * Naš equivalent: pre fix-a — `tools/math-backend.mjs:169` (buildExecutorInput)
 * išao direktno iz `model.payback.rtpBreakdown` → MC executor bez flat math
 * model-a u sredini.
 *
 * Public API
 *   compileServerConfig(model) → { serverConfig, paytableHash, gleVersion, diagnostics }
 *   compileGainTable(symbols, reels) → int[]
 *   compileSpecialSymbols(model) → IServerSpecialSymbol[]
 *   compileLines(paylines) → { lines: int[], number_of_lines: int }
 *
 * Vendor-neutral: no vendor brand strings in output, only the wire contract.
 */

import { createHash } from 'node:crypto';
import { convertToServerValues } from '../src/registry/integerWeightConvert.mjs';

const GLE_VERSION_DEFAULT = '4.0';
const SCATTER_FEATURE_TYPE = 'scatter';
const FREESPIN_FEATURE_TYPE = 'free_spin';
const HOLD_AND_WIN_FEATURE_TYPE = 'hold_and_win';

/* UQ-DEEP-AK · WAVE 2 · COMPILER F — IGT-canonical enum primitives.
 *
 * industry serverConfig očekuje numeric `expansion_type` enum koji opisuje
 * KAKO wild/expand feature interaguje sa gridom. Mapping je iz IGT runtime
 * docs (Boki) — 6 values; 0 = NONE (no expand feature).
 *
 * Bilo koji unknown / missing feature → 0 (NONE) za safe runtime degradation.
 */
export const EXPANSION_TYPE = Object.freeze({
  NONE: 0,
  REEL_FULL: 1,
  CLUSTER: 2,
  ROW: 3,
  PART_OF_WIN: 4,
  ANCHOR_FROM_TRIGGER: 5,
});

/* industry contract §4 rule 1: gain_table = za svaki simbol gde je
 * symbolType ∈ {Normal, Wild} → concat(symbolStrip.payouts).
 * Redosled = redosled u symbols[]. Special symbols (scatter etc) NE ulaze
 * u gain_table — one idu u special_symbols[].
 */
export function compileGainTable(symbols, paytable) {
  if (!Array.isArray(symbols)) return [];
  const result = [];
  for (const sym of symbols) {
    const symId = sym && (sym.id || sym.symbolId || sym.code);
    const symType = sym && sym.kind;
    if (!symId) continue;
    /* Scatter / Bonus / Special — skip (idu u special_symbols). */
    if (symType === 'scatter' || symType === 'bonus' || symType === 'special') continue;
    /* Per-symbol payout vector iz paytable mape. Format: {3: 50, 4: 200, 5: 1000}. */
    const payoutMap = (paytable && paytable[symId]) || {};
    /* industry order: 0, 1, 2, 3, 4, 5 (kick count); ako fali pay za N → 0. */
    for (let k = 0; k <= 5; k++) {
      result.push(typeof payoutMap[k] === 'number' ? Math.round(payoutMap[k]) : 0);
    }
  }
  return result;
}

/* industry contract §4 rule 4: special_symbols[] schema.
 * Mandatorna polja per industry-settings-contract.md:157:
 *   {feature_type, name, id, screencount_gains, trigger_count,
 *    odds_freespins?, num_respins?, has_empty_cells?, number_of_rows?, reels?}
 */
export function compileSpecialSymbols(model) {
  const out = [];
  const symbols = (model && model.symbols) || {};
  const allSyms = Array.isArray(symbols)
    ? symbols
    : [].concat(symbols.high || [], symbols.mid || [], symbols.low || [], symbols.specials || []);

  /* Scatter symbol. */
  const scatter = allSyms.find(s => s && (s.kind === 'scatter' || s.kind === 'special' && /scatter/i.test(s.label || '')));
  if (scatter && (model.scatter || model.freeSpins)) {
    /* industry trigger_count rule (P2.10): scatter = first_nonzero_payout_index + 1. */
    const payouts = scatter.payouts || (scatter.pay && Object.values(scatter.pay)) || [];
    let firstNonzero = -1;
    for (let i = 0; i < payouts.length; i++) {
      if (typeof payouts[i] === 'number' && payouts[i] > 0) { firstNonzero = i; break; }
    }
    out.push({
      feature_type: SCATTER_FEATURE_TYPE,
      name: scatter.label || 'Scatter',
      id: scatter.id || 'S',
      screencount_gains: payouts.map(p => typeof p === 'number' ? Math.round(p) : 0),
      trigger_count: firstNonzero >= 0 ? firstNonzero + 1 : 3,    /* default 3 */
    });
  }

  /* Free spins trigger. */
  const fs = (model && model.freeSpins) || null;
  if (fs && fs.enabled !== false) {
    /* industry trigger_count rule (P2.10): FS = min(triggerCounts[]). */
    const triggerCounts = Array.isArray(fs.triggerCounts) ? fs.triggerCounts
      : (Array.isArray(fs.awards) ? fs.awards.map(a => a.count).filter(Number.isFinite) : []);
    const minTrigger = triggerCounts.length > 0 ? Math.min(...triggerCounts) : 3;
    /* odds_freespins: awarded spin count per trigger count. */
    const oddsFs = {};
    if (Array.isArray(fs.awards)) {
      for (const a of fs.awards) {
        if (Number.isFinite(a.count) && Number.isFinite(a.spins)) oddsFs[a.count] = a.spins;
      }
    }
    out.push({
      feature_type: FREESPIN_FEATURE_TYPE,
      name: fs.label || 'Free Spins',
      id: fs.triggerSymbol || scatter?.id || 'S',
      screencount_gains: [],
      trigger_count: minTrigger,
      odds_freespins: oddsFs,
    });
  }

  /* Hold-and-win. */
  const hnw = (model && model.holdAndWin) || null;
  if (hnw && hnw.enabled === true) {
    /* industry trigger_count rule (P2.10): H&W = direct (model.holdAndWin.triggerCount). */
    out.push({
      feature_type: HOLD_AND_WIN_FEATURE_TYPE,
      name: hnw.label || 'Hold & Win',
      id: hnw.bonusSymbolId || 'B',
      screencount_gains: [],
      trigger_count: Number.isFinite(hnw.triggerCount) ? hnw.triggerCount : 6,
      num_respins: Number.isFinite(hnw.respinsOnHit) ? hnw.respinsOnHit : 3,
      /* P0 symbol audit (UQ-DEEP-AG): nonLockedSymbolId + has_empty_cells.
       * Lock predicate per industry standard: cell.symbolId !== nonLockedSymbolId. */
      non_locked_symbol: hnw.nonLockedSymbolId || null,
      has_empty_cells: hnw.hasEmptyCells === true,
    });
  }

  return out;
}

/* industry contract §4 rule 3: lines flatten — `[1,1,1,1,1, 0,0,0,0,0, ...]`
 * (svi line patterns flatten u jedan niz). number_of_lines = paylines.length. */
export function compileLines(paylines, reelsCount) {
  if (!Array.isArray(paylines)) return { lines: [], number_of_lines: 0 };
  const flat = [];
  for (const line of paylines) {
    if (!Array.isArray(line)) continue;
    for (let i = 0; i < (reelsCount || line.length); i++) {
      flat.push(typeof line[i] === 'number' ? line[i] : 0);
    }
  }
  return { lines: flat, number_of_lines: paylines.length };
}

/* industry contract §4 rule 2: reels[][] padded to max length with -1 (sentinel).
 * Per-reel symbol-ID list (game-strip indexed). */
export function compileReels(reelStrips, symbolIdMap) {
  if (!Array.isArray(reelStrips) || reelStrips.length === 0) return [];
  /* Find max strip length za padding sentinel -1. */
  const maxLen = reelStrips.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  return reelStrips.map(strip => {
    if (!Array.isArray(strip)) return new Array(maxLen).fill(-1);
    const out = strip.map(sym => {
      if (typeof sym === 'number') return sym;
      if (typeof sym === 'string') {
        return Number.isFinite(symbolIdMap[sym]) ? symbolIdMap[sym] : -1;
      }
      return -1;
    });
    /* Pad to maxLen with -1. */
    while (out.length < maxLen) out.push(-1);
    return out;
  });
}

/* industry contract §4 rule 5: paytable_hash = SHA-256 of canonical serverConfig
 * JSON (sorted keys). Regulator certifikat zahteva da je hash isti za isti
 * paytable preko sessions. */
function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

export function computePaytableHash(serverConfig) {
  return createHash('sha256').update(canonicalJSON(serverConfig)).digest('hex');
}

/* UQ-DEEP-AK · WAVE 2 · COMPILER F · Helper 1: emitExpansionType
 *
 * Maps (featureKind, featureConfig) → EXPANSION_TYPE int per IGT spec.
 *
 *   expandingWild + expandTo='reel'      → 1 REEL_FULL
 *   expandingWild + expandTo='cluster'   → 2 CLUSTER
 *   expandingWild + expandTo='row'       → 3 ROW
 *   expandingWild + triggers='partOfWin' → 4 PART_OF_WIN
 *   fsExpansionWilds (default)            → 5 ANCHOR_FROM_TRIGGER
 *   megaWildCluster                       → 2 CLUSTER
 *   unknown / missing                     → 0 NONE
 *
 * triggers='partOfWin' takes precedence over expandTo (regulator wording:
 * "expand only when symbol is part of a paying win line").
 */
export function emitExpansionType(featureKind, featureConfig) {
  if (!featureKind) return EXPANSION_TYPE.NONE;
  const cfg = featureConfig || {};
  if (featureKind === 'expandingWild') {
    if (cfg.triggers === 'partOfWin') return EXPANSION_TYPE.PART_OF_WIN;
    if (cfg.expandTo === 'reel') return EXPANSION_TYPE.REEL_FULL;
    if (cfg.expandTo === 'cluster') return EXPANSION_TYPE.CLUSTER;
    if (cfg.expandTo === 'row') return EXPANSION_TYPE.ROW;
    /* Unspecified expandTo on expandingWild → default REEL_FULL (industry default). */
    return EXPANSION_TYPE.REEL_FULL;
  }
  if (featureKind === 'fsExpansionWilds') return EXPANSION_TYPE.ANCHOR_FROM_TRIGGER;
  if (featureKind === 'megaWildCluster') return EXPANSION_TYPE.CLUSTER;
  return EXPANSION_TYPE.NONE;
}

/* UQ-DEEP-AK · WAVE 2 · COMPILER F · Helper 2: emitModifiersScreenSymbols
 *
 * Walks model.wild.special / model.symbolModifiers / model.features za
 * transform-emitting blocks i emit-uje array sa per-symbol modifier rules.
 *
 *   modifierKind ∈ 'sticky' | 'expanding' | 'copy' | 'transform' | 'multiplier'
 *   screencountGains[] = integer payout per N screen-occurrences
 *   weight = integer probability weight
 *
 * Empty array kad nemamo modifier features.
 */
export function emitModifiersScreenSymbols(model) {
  if (!model || typeof model !== 'object') return [];
  const out = [];

  const symbols = model.symbols || {};
  const allSyms = Array.isArray(symbols)
    ? symbols
    : [].concat(symbols.high || [], symbols.mid || [], symbols.low || [], symbols.specials || []);

  const symbolIdMap = {};
  allSyms.forEach((s, idx) => {
    const sid = s && (s.id || s.symbolId || s.code);
    if (sid) symbolIdMap[sid] = idx;
  });

  /* Round helper — regulator integer constraint. */
  const toInt = (v, fallback) => (Number.isFinite(v) ? Math.round(v) : fallback);
  const toIntArr = (arr) => (Array.isArray(arr) ? arr.map(v => toInt(v, 0)) : []);

  const resolveId = (sym) => {
    if (typeof sym === 'number') return sym;
    if (typeof sym === 'string') return Number.isFinite(symbolIdMap[sym]) ? symbolIdMap[sym] : 0;
    return 0;
  };

  /* (a) model.wild.special — {kind, symbolId, screencountGains?, weight?}. */
  const wildSpecial = model.wild && model.wild.special;
  if (Array.isArray(wildSpecial)) {
    for (const ws of wildSpecial) {
      if (!ws || !ws.kind) continue;
      out.push({
        symbolId: resolveId(ws.symbolId ?? ws.id),
        modifierKind: ws.kind,
        screencountGains: toIntArr(ws.screencountGains || ws.payouts),
        weight: toInt(ws.weight, 1),
      });
    }
  } else if (wildSpecial && typeof wildSpecial === 'object' && wildSpecial.kind) {
    out.push({
      symbolId: resolveId(wildSpecial.symbolId ?? wildSpecial.id),
      modifierKind: wildSpecial.kind,
      screencountGains: toIntArr(wildSpecial.screencountGains || wildSpecial.payouts),
      weight: toInt(wildSpecial.weight, 1),
    });
  }

  /* (b) model.symbolModifiers[] — explicit modifier rules. */
  const symMods = model.symbolModifiers;
  if (Array.isArray(symMods)) {
    for (const sm of symMods) {
      if (!sm || !sm.kind) continue;
      out.push({
        symbolId: resolveId(sm.symbolId ?? sm.id),
        modifierKind: sm.kind,
        screencountGains: toIntArr(sm.screencountGains || sm.payouts),
        weight: toInt(sm.weight, 1),
      });
    }
  }

  /* (c) model.features[] — transform-emitting blocks. */
  const features = model.features;
  const transformKinds = new Set([
    'stickyWild', 'sticky_wild', 'expandingWild', 'expanding_wild',
    'copyWild', 'copy_wild', 'copyWildOrchestrator',
    'mysterySymbol', 'mystery_symbol', 'symbolUpgrade', 'symbol_upgrade',
    'multiplier', 'multiplierOrb', 'transform',
  ]);
  const kindToModifier = (k) => {
    if (!k) return 'transform';
    if (/sticky/i.test(k)) return 'sticky';
    if (/expand/i.test(k)) return 'expanding';
    if (/copy/i.test(k)) return 'copy';
    if (/multiplier/i.test(k)) return 'multiplier';
    return 'transform';
  };
  const collectFromFeature = (key, feat) => {
    if (!feat) return;
    const cfg = feat.config || feat;
    if (!transformKinds.has(key) && !transformKinds.has(feat.kind)) return;
    out.push({
      symbolId: resolveId(cfg.symbolId ?? cfg.targetSymbol ?? cfg.symbol ?? 0),
      modifierKind: kindToModifier(feat.kind || key),
      screencountGains: toIntArr(cfg.screencountGains || cfg.payouts),
      weight: toInt(cfg.weight, 1),
    });
  };
  if (Array.isArray(features)) {
    for (const f of features) collectFromFeature(f && f.kind, f);
  } else if (features && typeof features === 'object') {
    for (const [key, f] of Object.entries(features)) collectFromFeature(key, f);
  }

  return out;
}

/* UQ-DEEP-AK · WAVE 2 · COMPILER F · Helper 3: emitNonLockedSymbolId
 *
 * U HnW kontekstu: integer symbolId za "blank" / non-orb simbol koji se NE
 * lock-uje tokom respina. Lock predicate = cell.symbolId !== nonLockedSymbolId.
 *
 *   1. Iz model.features['holdAndWin'].config.nonLockedSymbolId (explicit)
 *   2. Inače derive iz model.symbols: najniže-tier simbol koji NIJE
 *      wild/scatter/bonus/orb (typically L1 / lowest pay)
 *   3. null ako model nema HnW feature
 */
export function emitNonLockedSymbolId(model) {
  if (!model || typeof model !== 'object') return null;

  /* Detect HnW presence. */
  let hnwCfg = null;
  if (model.holdAndWin && model.holdAndWin.enabled !== false) {
    hnwCfg = model.holdAndWin;
  }
  const features = model.features;
  if (Array.isArray(features)) {
    const f = features.find(x => x && (x.kind === 'holdAndWin' || x.kind === 'hold_and_win'));
    if (f) hnwCfg = (f.config || f);
  } else if (features && typeof features === 'object') {
    if (features.holdAndWin) hnwCfg = features.holdAndWin.config || features.holdAndWin;
    else if (features.hold_and_win) hnwCfg = features.hold_and_win.config || features.hold_and_win;
  }
  if (!hnwCfg) return null;

  const symbols = model.symbols || {};
  const allSyms = Array.isArray(symbols)
    ? symbols
    : [].concat(symbols.high || [], symbols.mid || [], symbols.low || [], symbols.specials || []);
  const symbolIdMap = {};
  allSyms.forEach((s, idx) => {
    const sid = s && (s.id || s.symbolId || s.code);
    if (sid) symbolIdMap[sid] = idx;
  });

  /* (1) Explicit override. */
  if (hnwCfg.nonLockedSymbolId !== undefined && hnwCfg.nonLockedSymbolId !== null) {
    const v = hnwCfg.nonLockedSymbolId;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number.isFinite(symbolIdMap[v]) ? symbolIdMap[v] : null;
  }

  /* (2) Derive from lowest non-special symbol. */
  const SPECIAL_KINDS = new Set(['wild', 'scatter', 'bonus', 'orb', 'special', 'jackpot']);
  const candidates = allSyms.filter(s => s && !SPECIAL_KINDS.has(s.kind));
  if (candidates.length === 0) {
    /* (3) Only specials → null. */
    return null;
  }
  /* Sort by lowest pay vector (sum of payouts) — lowest tier first. */
  const payOf = (s) => {
    const p = s.payouts || (s.pay && Object.values(s.pay)) || [];
    return Array.isArray(p) ? p.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) : 0;
  };
  candidates.sort((a, b) => payOf(a) - payOf(b));
  const lowest = candidates[0];
  const lowestId = lowest && (lowest.id || lowest.symbolId || lowest.code);
  return Number.isFinite(symbolIdMap[lowestId]) ? symbolIdMap[lowestId] : null;
}

/**
 * Main entry: compile parsed model → wire-compatible serverConfig.
 *
 * @param {object} model — parser output (src/parser.mjs ParsedModel shape)
 * @param {object} options — { gleVersion?, paytableSource? }
 * @returns {object} {
 *   serverConfig: {
 *     gain_table: int[],
 *     reels: int[][],
 *     special_symbols: object[],
 *     lines: int[],
 *     number_of_lines: int,
 *     number_of_columns: int,
 *     number_of_rows: int,
 *     wild_symbol: int|null,
 *     symbols: {id, name, kind}[],
 *     odds_megaways?: object[],          // P1-3
 *     modifiers_screen_symbols?: object[],// P1-4
 *   },
 *   paytableHash: string,
 *   gleVersion: string,
 *   diagnostics: { warnings: string[], scaledWeights?: object[] },
 * }
 */
export function compileServerConfig(model, options = {}) {
  const diagnostics = { warnings: [] };
  const gleVersion = options.gleVersion || GLE_VERSION_DEFAULT;

  const symbols = (model && model.symbols) || {};
  const allSyms = Array.isArray(symbols)
    ? symbols
    : [].concat(symbols.high || [], symbols.mid || [], symbols.low || [], symbols.specials || []);

  /* Symbol-ID → integer index map (integer arithmetic). */
  const symbolIdMap = {};
  allSyms.forEach((s, idx) => {
    const sid = s && (s.id || s.symbolId || s.code);
    if (sid) symbolIdMap[sid] = idx;
  });

  /* Identify wild symbol (single — industry default; multi-wild via P1 extension). */
  const wildSym = allSyms.find(s => s && (s.kind === 'wild' || s.id === 'W'));
  const wildSymbolId = wildSym ? symbolIdMap[wildSym.id || wildSym.symbolId] : null;

  /* gain_table — industry spec §4 rule 1. */
  const paytable = (model.par_sheet_paytable) || (model.paytable) || {};
  const gainTable = compileGainTable(allSyms, paytable);
  if (gainTable.length === 0) diagnostics.warnings.push('gain_table empty — paytable not in model');

  /* reels[][] — industry spec §4 rule 2. */
  const reelStrips = (model.reelStrips && (model.reelStrips.strips || model.reelStrips.par_sheet_strips)) || [];
  const reelsCount = (model.topology && model.topology.reels) || 5;
  const rowsCount = (model.topology && model.topology.rows) || 3;
  const reels = compileReels(reelStrips, symbolIdMap);
  if (reels.length === 0) diagnostics.warnings.push('reels[][] empty — par_sheet_strips not in model');

  /* lines flatten — industry spec §4 rule 3. */
  const paylines = (model.topology && model.topology.paylines) || [];
  const { lines, number_of_lines } = compileLines(paylines, reelsCount);

  /* special_symbols — industry spec §4 rule 4. */
  const specialSymbols = compileSpecialSymbols(model);

  /* industry contract §4 rule 6: odds_megaways (P1-3 placeholder — emit only when topology=ways).
   * Per-column {weights, values} sa 100-sum prepend. */
  let oddsMegaways = null;
  if (model.topology && model.topology.kind === 'ways' && Array.isArray(model.topology.dynamicRows)) {
    oddsMegaways = model.topology.dynamicRows.map(col => {
      if (!col || !Array.isArray(col.weights)) return null;
      const sum = col.weights.reduce((s, w) => s + w, 0);
      const w0 = Math.max(0, 100 - sum);                       /* 100-sum prepend normalization */
      const wScaled = convertToServerValues([w0, ...col.weights]);
      return { weights: wScaled.values, values: [0, ...(col.values || [])] };
    });
  }

  /* Assemble serverConfig. */
  const serverConfig = {
    gle_version: gleVersion,
    gain_table: gainTable,
    reels,
    special_symbols: specialSymbols,
    lines,
    number_of_lines,
    number_of_columns: reelsCount,
    number_of_rows: rowsCount,
    wild_symbol: wildSymbolId,
    symbols: allSyms.map(s => ({
      id: symbolIdMap[s.id || s.symbolId || s.code] ?? -1,
      name: s.label || s.name || s.id || '',
      kind: s.kind || 'normal',
    })),
  };
  if (oddsMegaways) serverConfig.odds_megaways = oddsMegaways;

  /* UQ-DEEP-AK · WAVE 2 · COMPILER F — IGT-canonical enum + modifier primitives.
   * Adds 3 new fields preserving back-compat sa svim postojećim polja iznad:
   *   expansion_type            — int enum (EXPANSION_TYPE)
   *   modifiers_screen_symbols  — per-symbol modifier rules array
   *   non_locked_symbol_id      — HnW lock-predicate sentinel (int | null)
   */
  let primaryExpandKind = null;
  let primaryExpandCfg = null;
  const featList = model && model.features;
  const visitFeat = (key, feat) => {
    if (primaryExpandKind || !feat) return;
    const k = feat.kind || key;
    if (k === 'expandingWild' || k === 'fsExpansionWilds' || k === 'megaWildCluster') {
      primaryExpandKind = k;
      primaryExpandCfg = feat.config || feat;
    }
  };
  if (Array.isArray(featList)) {
    for (const f of featList) visitFeat(f && f.kind, f);
  } else if (featList && typeof featList === 'object') {
    for (const [k, f] of Object.entries(featList)) visitFeat(k, f);
  }
  serverConfig.expansion_type = emitExpansionType(primaryExpandKind, primaryExpandCfg);
  serverConfig.modifiers_screen_symbols = emitModifiersScreenSymbols(model);
  serverConfig.non_locked_symbol_id = emitNonLockedSymbolId(model);

  const paytableHash = computePaytableHash(serverConfig);

  return {
    serverConfig,
    paytableHash,
    gleVersion,
    diagnostics,
  };
}

/* CLI entry — compile a model.json and dump serverConfig to stdout. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node tools/sgs-compiler.mjs <model.json>');
    process.exit(1);
  }
  const fs = await import('node:fs');
  const model = JSON.parse(fs.readFileSync(path, 'utf8'));
  const result = compileServerConfig(model);
  console.log(JSON.stringify(result, null, 2));
}
