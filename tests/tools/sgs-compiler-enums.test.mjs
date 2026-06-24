/**
 * tests/tools/sgs-compiler-enums.test.mjs
 *
 * UQ-DEEP-AK · WAVE 2 · COMPILER F — sgs-compiler IGT enums extension (Boki 2026-06-24).
 *
 * Validates 3 new helpers + compileServerConfig integration u tools/sgs-compiler.mjs:
 *
 *   1. emitExpansionType(featureKind, featureConfig) → int (EXPANSION_TYPE enum)
 *      Mapping: expandingWild/{reel,cluster,row,partOfWin}, fsExpansionWilds,
 *      megaWildCluster, unknown.
 *
 *   2. emitModifiersScreenSymbols(model) → [{symbolId, modifierKind,
 *      screencountGains, weight}]  (integers po regulator spec).
 *
 *   3. emitNonLockedSymbolId(model) → int | null  (HnW lock predicate
 *      sentinel; null kad nema HnW).
 *
 * Integration assertions: compileServerConfig output mora sadržati svaki od
 * 3 nova field-a pored postojećih (gain_table, reels, lines, special_symbols,
 * paytable_hash, wild_symbol, symbols, odds_megaways, gle_version).
 *
 * 20 PASS targets total.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emitExpansionType,
  EXPANSION_TYPE,
  emitModifiersScreenSymbols,
  emitNonLockedSymbolId,
  compileServerConfig,
} from '../../tools/sgs-compiler.mjs';

/* ── emitExpansionType (7 cases) ─────────────────────────────────────────── */

test('UQ-DEEP-AK · emitExpansionType: expandingWild + expandTo=reel → 1 REEL_FULL', () => {
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'reel' }), 1);
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'reel' }), EXPANSION_TYPE.REEL_FULL);
});

test('UQ-DEEP-AK · emitExpansionType: expandingWild + expandTo=cluster → 2 CLUSTER', () => {
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'cluster' }), 2);
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'cluster' }), EXPANSION_TYPE.CLUSTER);
});

test('UQ-DEEP-AK · emitExpansionType: expandingWild + expandTo=row → 3 ROW', () => {
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'row' }), 3);
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'row' }), EXPANSION_TYPE.ROW);
});

test('UQ-DEEP-AK · emitExpansionType: expandingWild + triggers=partOfWin → 4 PART_OF_WIN', () => {
  /* triggers takes precedence over expandTo. */
  assert.equal(emitExpansionType('expandingWild', { triggers: 'partOfWin', expandTo: 'reel' }), 4);
  assert.equal(emitExpansionType('expandingWild', { triggers: 'partOfWin' }), EXPANSION_TYPE.PART_OF_WIN);
});

test('UQ-DEEP-AK · emitExpansionType: fsExpansionWilds → 5 ANCHOR_FROM_TRIGGER', () => {
  assert.equal(emitExpansionType('fsExpansionWilds', {}), 5);
  assert.equal(emitExpansionType('fsExpansionWilds', null), EXPANSION_TYPE.ANCHOR_FROM_TRIGGER);
});

test('UQ-DEEP-AK · emitExpansionType: megaWildCluster → 2 CLUSTER', () => {
  assert.equal(emitExpansionType('megaWildCluster', {}), 2);
  assert.equal(emitExpansionType('megaWildCluster'), EXPANSION_TYPE.CLUSTER);
});

test('UQ-DEEP-AK · emitExpansionType: unknown / no expand feature → 0 NONE', () => {
  assert.equal(emitExpansionType(null, null), 0);
  assert.equal(emitExpansionType('totallyUnknownFeature', {}), 0);
  assert.equal(emitExpansionType(undefined), EXPANSION_TYPE.NONE);
  assert.equal(emitExpansionType('paylines', {}), EXPANSION_TYPE.NONE);
});

/* ── emitModifiersScreenSymbols (6 cases) ────────────────────────────────── */

test('UQ-DEEP-AK · emitModifiersScreenSymbols: model bez modifier feature → []', () => {
  const model = {
    symbols: { high: [{ id: 'D', kind: 'high' }] },
    topology: { reels: 5, rows: 3 },
  };
  const r = emitModifiersScreenSymbols(model);
  assert.ok(Array.isArray(r));
  assert.equal(r.length, 0);
});

test('UQ-DEEP-AK · emitModifiersScreenSymbols: sa sticky wild → 1 entry kind=sticky', () => {
  const model = {
    symbols: { specials: [{ id: 'W', kind: 'wild' }] },
    features: [{ kind: 'stickyWild', config: { symbolId: 'W', weight: 5 } }],
  };
  const r = emitModifiersScreenSymbols(model);
  assert.equal(r.length, 1);
  assert.equal(r[0].modifierKind, 'sticky');
});

test('UQ-DEEP-AK · emitModifiersScreenSymbols: sa copy_wild → 1 entry kind=copy', () => {
  const model = {
    symbols: { specials: [{ id: 'W', kind: 'wild' }] },
    features: [{ kind: 'copy_wild', config: { symbolId: 'W', weight: 2 } }],
  };
  const r = emitModifiersScreenSymbols(model);
  assert.equal(r.length, 1);
  assert.equal(r[0].modifierKind, 'copy');
});

test('UQ-DEEP-AK · emitModifiersScreenSymbols: multiple modifiers → multiple entries', () => {
  const model = {
    symbols: { specials: [{ id: 'W', kind: 'wild' }, { id: 'M', kind: 'mystery' }] },
    features: [
      { kind: 'stickyWild', config: { symbolId: 'W', weight: 3 } },
      { kind: 'expandingWild', config: { symbolId: 'W', expandTo: 'reel' } },
      { kind: 'mysterySymbol', config: { symbolId: 'M', weight: 1 } },
    ],
  };
  const r = emitModifiersScreenSymbols(model);
  assert.ok(r.length >= 3, `expected ≥3 entries, got ${r.length}`);
  const kinds = r.map(x => x.modifierKind);
  assert.ok(kinds.includes('sticky'));
  assert.ok(kinds.includes('expanding'));
  assert.ok(kinds.includes('transform'));
});

test('UQ-DEEP-AK · emitModifiersScreenSymbols: screencountGains array of int', () => {
  const model = {
    symbols: { specials: [{ id: 'W', kind: 'wild' }] },
    symbolModifiers: [
      { kind: 'sticky', symbolId: 'W', screencountGains: [0, 0, 5.4, 25.7, 100.1, 500], weight: 2 },
    ],
  };
  const r = emitModifiersScreenSymbols(model);
  assert.equal(r.length, 1);
  assert.ok(Array.isArray(r[0].screencountGains));
  for (const v of r[0].screencountGains) {
    assert.equal(Number.isInteger(v), true, `screencountGains value ${v} must be int`);
  }
  /* Math.round preserves regulator integer constraint. */
  assert.deepEqual(r[0].screencountGains, [0, 0, 5, 26, 100, 500]);
});

test('UQ-DEEP-AK · emitModifiersScreenSymbols: weight int', () => {
  const model = {
    symbols: { specials: [{ id: 'W', kind: 'wild' }] },
    symbolModifiers: [
      { kind: 'sticky', symbolId: 'W', weight: 7.8 },
      { kind: 'copy', symbolId: 'W', weight: null },        /* fallback 1 */
    ],
  };
  const r = emitModifiersScreenSymbols(model);
  assert.equal(r.length, 2);
  for (const e of r) {
    assert.equal(Number.isInteger(e.weight), true, `weight ${e.weight} must be int`);
  }
  /* Math.round: 7.8 → 8; null → 1 (fallback). */
  assert.equal(r[0].weight, 8);
  assert.equal(r[1].weight, 1);
});

/* ── emitNonLockedSymbolId (4 cases) ─────────────────────────────────────── */

test('UQ-DEEP-AK · emitNonLockedSymbolId: model bez HnW feature → null', () => {
  const model = {
    symbols: { high: [{ id: 'D', kind: 'high' }] },
    features: [{ kind: 'free_spins' }],
  };
  assert.equal(emitNonLockedSymbolId(model), null);
  assert.equal(emitNonLockedSymbolId({}), null);
  assert.equal(emitNonLockedSymbolId(null), null);
});

test('UQ-DEEP-AK · emitNonLockedSymbolId: explicit nonLockedSymbolId=7 → 7', () => {
  const model = {
    symbols: { high: [{ id: 'D', kind: 'high' }] },
    features: [{ kind: 'holdAndWin', config: { nonLockedSymbolId: 7 } }],
  };
  assert.equal(emitNonLockedSymbolId(model), 7);
  /* Also via top-level model.holdAndWin. */
  const model2 = {
    symbols: { high: [{ id: 'D', kind: 'high' }] },
    holdAndWin: { enabled: true, nonLockedSymbolId: 7 },
  };
  assert.equal(emitNonLockedSymbolId(model2), 7);
});

test('UQ-DEEP-AK · emitNonLockedSymbolId: derived from lowest non-special symbol (int)', () => {
  const model = {
    symbols: {
      high: [
        { id: 'D', kind: 'high', payouts: [0, 0, 0, 50, 200, 1000] },
        { id: 'J', kind: 'low', payouts: [0, 0, 0, 5, 25, 100] },
        { id: 'L1', kind: 'low', payouts: [0, 0, 0, 2, 10, 50] },         /* lowest */
      ],
      specials: [{ id: 'W', kind: 'wild' }, { id: 'B', kind: 'bonus' }],
    },
    holdAndWin: { enabled: true, triggerCount: 6 },
  };
  const r = emitNonLockedSymbolId(model);
  assert.equal(typeof r, 'number', 'returns int symbol index');
  assert.equal(Number.isInteger(r), true);
  /* L1 is at index 2 in flattened [high..., low..., specials...] */
  assert.equal(r, 2);
});

test('UQ-DEEP-AK · emitNonLockedSymbolId: HnW + only specials → null', () => {
  const model = {
    symbols: {
      specials: [
        { id: 'W', kind: 'wild' },
        { id: 'S', kind: 'scatter' },
        { id: 'B', kind: 'bonus' },
        { id: 'O', kind: 'orb' },
      ],
    },
    holdAndWin: { enabled: true, triggerCount: 6 },
  };
  assert.equal(emitNonLockedSymbolId(model), null);
});

/* ── Integration (3 cases) ───────────────────────────────────────────────── */

test('UQ-DEEP-AK · compileServerConfig output contains expansion_type field', () => {
  const model = {
    topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
    symbols: {
      high: [{ id: 'D', kind: 'high' }],
      specials: [{ id: 'W', kind: 'wild' }],
    },
    paytable: { D: { 5: 500 } },
    reelStrips: { strips: [['D', 'W'], ['D', 'W']] },
    features: [
      { kind: 'expandingWild', config: { expandTo: 'reel' } },
    ],
  };
  const r = compileServerConfig(model);
  assert.ok(Object.prototype.hasOwnProperty.call(r.serverConfig, 'expansion_type'),
    'expansion_type field must be present');
  assert.equal(r.serverConfig.expansion_type, EXPANSION_TYPE.REEL_FULL);
  /* Back-compat: existing fields untouched. */
  assert.ok(Array.isArray(r.serverConfig.gain_table));
  assert.ok(Array.isArray(r.serverConfig.reels));
  assert.equal(r.serverConfig.gle_version, '4.0');
});

test('UQ-DEEP-AK · compileServerConfig output contains modifiers_screen_symbols field', () => {
  const model = {
    topology: { reels: 5, rows: 3, paylines: [[0, 0, 0, 0, 0]] },
    symbols: { specials: [{ id: 'W', kind: 'wild' }] },
    reelStrips: { strips: [['W'], ['W']] },
    symbolModifiers: [
      { kind: 'sticky', symbolId: 'W', weight: 3 },
    ],
  };
  const r = compileServerConfig(model);
  assert.ok(Object.prototype.hasOwnProperty.call(r.serverConfig, 'modifiers_screen_symbols'),
    'modifiers_screen_symbols field must be present');
  assert.ok(Array.isArray(r.serverConfig.modifiers_screen_symbols));
  assert.equal(r.serverConfig.modifiers_screen_symbols.length, 1);
  assert.equal(r.serverConfig.modifiers_screen_symbols[0].modifierKind, 'sticky');
});

test('UQ-DEEP-AK · compileServerConfig output contains non_locked_symbol_id field', () => {
  /* Case A: HnW present sa explicit nonLockedSymbolId. */
  const modelHnw = {
    topology: { reels: 5, rows: 3, paylines: [[0, 0, 0, 0, 0]] },
    symbols: {
      low: [{ id: 'L1', kind: 'low' }],
      specials: [{ id: 'W', kind: 'wild' }, { id: 'B', kind: 'bonus' }],
    },
    reelStrips: { strips: [['L1'], ['W']] },
    holdAndWin: { enabled: true, triggerCount: 6, nonLockedSymbolId: 'L1' },
  };
  const r1 = compileServerConfig(modelHnw);
  assert.ok(Object.prototype.hasOwnProperty.call(r1.serverConfig, 'non_locked_symbol_id'),
    'non_locked_symbol_id field must be present');
  assert.equal(typeof r1.serverConfig.non_locked_symbol_id, 'number');

  /* Case B: no HnW → field present sa null. */
  const modelNoHnw = {
    topology: { reels: 5, rows: 3, paylines: [[0, 0, 0, 0, 0]] },
    symbols: { high: [{ id: 'D', kind: 'high' }], specials: [{ id: 'W', kind: 'wild' }] },
    reelStrips: { strips: [['D'], ['W']] },
  };
  const r2 = compileServerConfig(modelNoHnw);
  assert.ok(Object.prototype.hasOwnProperty.call(r2.serverConfig, 'non_locked_symbol_id'),
    'field must exist even when null');
  assert.equal(r2.serverConfig.non_locked_symbol_id, null);
});
