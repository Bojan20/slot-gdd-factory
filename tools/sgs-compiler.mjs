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
