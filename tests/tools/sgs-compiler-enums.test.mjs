/**
 * tests/tools/sgs-compiler-enums.test.mjs
 *
 * UQ-DEEP-AK · WAVE 2 · COMPILER F — sgs-compiler IGT enums extension (Boki 2026-06-24).
 * UQ-DEEP-AL · FIX-B — `nonLockedSymbolId` type/name align (string + camelCase).
 * UQ-DEEP-AN · AN-4 — EXPANSION_TYPE enum extension (6 → 11 values).
 *
 * Validates 3 new helpers + compileServerConfig integration u tools/sgs-compiler.mjs:
 *
 *   1. emitExpansionType(featureKind, featureConfig) → int (EXPANSION_TYPE enum)
 *      Baseline mapping: expandingWild/{reel,cluster,row,partOfWin},
 *      fsExpansionWilds, megaWildCluster, unknown.
 *      UQ-DEEP-AN extensions: scatterFill, symbolReplace/mysteryRevealAll,
 *      randomCellExpand, adjacentCopy, diagonalLine.
 *
 *   2. emitModifiersScreenSymbols(model) → [{symbolId, modifierKind,
 *      screencountGains, weight}]  (integers po regulator spec).
 *
 *   3. emitNonLockedSymbolId(model) → string | null
 *      UQ-DEEP-AL: IGT runtime field `LockAndRespinSpinCommand.nonLockedSymbolId`
 *      je `string` (symbol code), ne integer index. Return contract: string
 *      (npr. "L1", "sym7") ili null kad model nema HnW feature.
 *
 * Integration assertions: compileServerConfig output mora sadržati `nonLockedSymbolId`
 * (camelCase) pored postojećih (gain_table, reels, lines, special_symbols,
 * paytable_hash, wild_symbol, symbols, odds_megaways, gle_version).
 * Snake_case `non_locked_symbol_id` MORA biti odsutno (eliminated by UQ-DEEP-AL).
 *
 * 50 PASS targets total: 32 baseline + 18 UQ-DEEP-AN extension cases (33..50).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  emitExpansionType,
  EXPANSION_TYPE,
  emitModifiersScreenSymbols,
  emitNonLockedSymbolId,
  emitNumberOfResultRows,
  emitNumberOfNormalSymbols,
  emitWaysFlag,
  emitCascadesFlag,
  emitNumberOfRowsArray,
  compileServerConfig,
} from '../../tools/sgs-compiler.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SGS_COMPILER_SOURCE_PATH = resolve(__dirname, '../../tools/sgs-compiler.mjs');

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
/* UQ-DEEP-AL · FIX-B: return contract = string | null (IGT
 * `LockAndRespinSpinCommand.nonLockedSymbolId: string`). Integer indices
 * removed — IGT runtime field is a sym code string ("L1", "sym7"). */

test('UQ-DEEP-AK/AL · emitNonLockedSymbolId: model bez HnW feature → null', () => {
  const model = {
    symbols: { high: [{ id: 'D', kind: 'high' }] },
    features: [{ kind: 'free_spins' }],
  };
  assert.equal(emitNonLockedSymbolId(model), null);
  assert.equal(emitNonLockedSymbolId({}), null);
  assert.equal(emitNonLockedSymbolId(null), null);
});

test("UQ-DEEP-AL · emitNonLockedSymbolId: explicit config.nonLockedSymbolId='sym7' → 'sym7' (string)", () => {
  const model = {
    symbols: { high: [{ id: 'sym7', kind: 'high' }] },
    features: [{ kind: 'holdAndWin', config: { nonLockedSymbolId: 'sym7' } }],
  };
  const r = emitNonLockedSymbolId(model);
  assert.equal(typeof r, 'string', 'IGT string contract');
  assert.equal(r, 'sym7');
  /* Also via top-level model.holdAndWin (string). */
  const model2 = {
    symbols: { high: [{ id: 'sym7', kind: 'high' }] },
    holdAndWin: { enabled: true, nonLockedSymbolId: 'sym7' },
  };
  assert.equal(emitNonLockedSymbolId(model2), 'sym7');
});

test('UQ-DEEP-AL · emitNonLockedSymbolId: HnW bez explicit → derived lowest-tier symbol.id (string, not int)', () => {
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
  assert.equal(typeof r, 'string', 'returns string symbol code (IGT contract)');
  assert.notEqual(typeof r, 'number', 'must NOT return integer index');
  /* L1 has lowest pay sum → derived as `.id` string, not its index. */
  assert.equal(r, 'L1');
});

test('UQ-DEEP-AK/AL · emitNonLockedSymbolId: HnW + only specials → null', () => {
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

test('UQ-DEEP-AL · compileServerConfig output contains nonLockedSymbolId field (camelCase, IGT-aligned)', () => {
  /* Case A: HnW present sa explicit nonLockedSymbolId (string). */
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
  assert.ok(Object.prototype.hasOwnProperty.call(r1.serverConfig, 'nonLockedSymbolId'),
    'nonLockedSymbolId (camelCase) field must be present');
  assert.equal(typeof r1.serverConfig.nonLockedSymbolId, 'string',
    'IGT contract: string sym code, not integer index');
  assert.equal(r1.serverConfig.nonLockedSymbolId, 'L1');

  /* Case B: no HnW → field present sa null. */
  const modelNoHnw = {
    topology: { reels: 5, rows: 3, paylines: [[0, 0, 0, 0, 0]] },
    symbols: { high: [{ id: 'D', kind: 'high' }], specials: [{ id: 'W', kind: 'wild' }] },
    reelStrips: { strips: [['D'], ['W']] },
  };
  const r2 = compileServerConfig(modelNoHnw);
  assert.ok(Object.prototype.hasOwnProperty.call(r2.serverConfig, 'nonLockedSymbolId'),
    'field must exist even when null');
  assert.equal(r2.serverConfig.nonLockedSymbolId, null);
});

/* ── UQ-DEEP-AL · FIX-D · IGT mandatory field gap-fillers (cases 23-32) ────── */

/* Case 23: emitNumberOfResultRows. */
test('UQ-DEEP-AL · FIX-D · emitNumberOfResultRows: 5×3 → 3, 6×5 → 5, variable [2,3,4,5,6,7] → 7', () => {
  assert.equal(emitNumberOfResultRows({ topology: { reels: 5, rows: 3 } }), 3);
  assert.equal(emitNumberOfResultRows({ topology: { reels: 6, rows: 5 } }), 5);
  assert.equal(
    emitNumberOfResultRows({ topology: { reels: 6, rowsPerReel: [2, 3, 4, 5, 6, 7] } }),
    7,
  );
  /* Defensive defaults. */
  assert.equal(emitNumberOfResultRows({}), 3);
  assert.equal(emitNumberOfResultRows(null), 3);
});

/* Case 24: emitNumberOfNormalSymbols sa 5 high + 4 mid + 3 low + 1 wild → 13. */
test('UQ-DEEP-AL · FIX-D · emitNumberOfNormalSymbols: 5 high + 4 mid + 3 low + 1 wild → 13', () => {
  const model = {
    symbols: {
      high: [
        { id: 'H1', kind: 'high' }, { id: 'H2', kind: 'high' },
        { id: 'H3', kind: 'high' }, { id: 'H4', kind: 'high' },
        { id: 'H5', kind: 'high' },
      ],
      mid: [
        { id: 'M1', kind: 'mid' }, { id: 'M2', kind: 'mid' },
        { id: 'M3', kind: 'mid' }, { id: 'M4', kind: 'mid' },
      ],
      low: [
        { id: 'L1', kind: 'low' }, { id: 'L2', kind: 'low' }, { id: 'L3', kind: 'low' },
      ],
      specials: [{ id: 'W', kind: 'wild' }],
    },
  };
  assert.equal(emitNumberOfNormalSymbols(model), 13);
});

/* Case 25: emitNumberOfNormalSymbols ignoriše scatter/bonus/special. */
test('UQ-DEEP-AL · FIX-D · emitNumberOfNormalSymbols: scatter/bonus/special excluded from count', () => {
  const model = {
    symbols: {
      high: [{ id: 'H1', kind: 'high' }],
      low: [{ id: 'L1', kind: 'low' }],
      specials: [
        { id: 'W', kind: 'wild' },          /* included (wild) */
        { id: 'S', kind: 'scatter' },        /* excluded */
        { id: 'B', kind: 'bonus' },          /* excluded */
        { id: 'O', kind: 'special' },        /* excluded */
      ],
    },
  };
  /* 1 high + 1 low + 1 wild = 3, exclude scatter/bonus/special. */
  assert.equal(emitNumberOfNormalSymbols(model), 3);
  /* Empty / null model defensives. */
  assert.equal(emitNumberOfNormalSymbols({}), 0);
  assert.equal(emitNumberOfNormalSymbols(null), 0);
});

/* Case 26: emitWaysFlag — ways → true; rectangular → false. */
test('UQ-DEEP-AL · FIX-D · emitWaysFlag: ways → true; rectangular → false', () => {
  assert.equal(emitWaysFlag({ topology: { kind: 'ways' } }), true);
  assert.equal(emitWaysFlag({ topology: { ways: 1024 } }), true);
  assert.equal(emitWaysFlag({ topology: { kind: 'rectangular' } }), false);
  assert.equal(emitWaysFlag({ topology: { kind: 'cluster' } }), false);
  assert.equal(emitWaysFlag({ topology: { evaluation: 'ways' } }), true);
  assert.equal(emitWaysFlag({}), false);
  assert.equal(emitWaysFlag(null), false);
});

/* Case 27: emitCascadesFlag — cascade/tumble → true; freeSpins only → false. */
test('UQ-DEEP-AL · FIX-D · emitCascadesFlag: cascade/tumble → true; freeSpins only → false', () => {
  assert.equal(emitCascadesFlag({ features: [{ kind: 'cascade' }] }), true);
  assert.equal(emitCascadesFlag({ features: [{ kind: 'tumble' }] }), true);
  assert.equal(emitCascadesFlag({ features: [{ kind: 'freeSpins' }] }), false);
  assert.equal(emitCascadesFlag({ features: [{ kind: 'free_spins' }] }), false);
  /* Object features map. */
  assert.equal(emitCascadesFlag({ features: { cascade: { enabled: true } } }), true);
  assert.equal(emitCascadesFlag({ features: { tumble: { enabled: true } } }), true);
  assert.equal(emitCascadesFlag({ features: { freeSpins: { enabled: true } } }), false);
  /* Empty / null defensives. */
  assert.equal(emitCascadesFlag({}), false);
  assert.equal(emitCascadesFlag(null), false);
});

/* Case 28: emitNumberOfRowsArray uniform — 5×3 → [3,3,3,3,3]; 6×5 → [5,5,5,5,5,5]. */
test('UQ-DEEP-AL · FIX-D · emitNumberOfRowsArray: 5×3 uniform → [3,3,3,3,3]; 6×5 → [5,5,5,5,5,5]', () => {
  assert.deepEqual(
    emitNumberOfRowsArray({ topology: { reels: 5, rows: 3 } }),
    [3, 3, 3, 3, 3],
  );
  assert.deepEqual(
    emitNumberOfRowsArray({ topology: { reels: 6, rows: 5 } }),
    [5, 5, 5, 5, 5, 5],
  );
  /* Default fallback when topology missing. */
  assert.deepEqual(emitNumberOfRowsArray({}), [3, 3, 3, 3, 3]);
});

/* Case 29: emitNumberOfRowsArray variable_rows topology. */
test('UQ-DEEP-AL · FIX-D · emitNumberOfRowsArray: variable rowsPerReel=[2,3,4,5,6,7] → that array', () => {
  assert.deepEqual(
    emitNumberOfRowsArray({ topology: { reels: 6, rowsPerReel: [2, 3, 4, 5, 6, 7] } }),
    [2, 3, 4, 5, 6, 7],
  );
  /* rowsPerReel preempts scalar rows. */
  assert.deepEqual(
    emitNumberOfRowsArray({ topology: { reels: 5, rows: 3, rowsPerReel: [3, 4, 5, 4, 3] } }),
    [3, 4, 5, 4, 3],
  );
});

/* Case 30: compileServerConfig output contains all 5 new fields. */
test('UQ-DEEP-AL · FIX-D · compileServerConfig contains all 5 new IGT mandatory fields', () => {
  const model = {
    topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
    symbols: {
      high: [{ id: 'D', kind: 'high' }],
      specials: [{ id: 'W', kind: 'wild' }],
    },
    paytable: { D: { 5: 500 } },
    reelStrips: { strips: [['D', 'W'], ['D', 'W']] },
  };
  const r = compileServerConfig(model);
  const sc = r.serverConfig;
  assert.ok(Object.prototype.hasOwnProperty.call(sc, 'number_of_result_rows'),
    'number_of_result_rows field must be present');
  assert.ok(Object.prototype.hasOwnProperty.call(sc, 'number_of_normal_symbols'),
    'number_of_normal_symbols field must be present');
  assert.ok(Object.prototype.hasOwnProperty.call(sc, 'ways'),
    'ways field must be present');
  assert.ok(Object.prototype.hasOwnProperty.call(sc, 'cascades'),
    'cascades field must be present');
  assert.ok(Object.prototype.hasOwnProperty.call(sc, 'enable_math_recording'),
    'enable_math_recording field must be present');
  /* Type spot checks. */
  assert.equal(typeof sc.number_of_result_rows, 'number');
  assert.equal(typeof sc.number_of_normal_symbols, 'number');
  assert.equal(typeof sc.ways, 'boolean');
  assert.equal(typeof sc.cascades, 'boolean');
  assert.equal(typeof sc.enable_math_recording, 'boolean');
});

/* Case 31: compileServerConfig number_of_rows is array (Array.isArray === true). */
test('UQ-DEEP-AL · FIX-D · compileServerConfig number_of_rows is int[] per IGT spec', () => {
  const model = {
    topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
    symbols: { high: [{ id: 'D', kind: 'high' }], specials: [{ id: 'W', kind: 'wild' }] },
    paytable: { D: { 5: 500 } },
    reelStrips: { strips: [['D', 'W'], ['D', 'W']] },
  };
  const r = compileServerConfig(model);
  assert.equal(Array.isArray(r.serverConfig.number_of_rows), true,
    'number_of_rows must be Array.isArray === true (IGT spec line 124)');
  assert.deepEqual(r.serverConfig.number_of_rows, [3, 3, 3, 3, 3]);
  /* Every element int per regulator integer constraint. */
  for (const v of r.serverConfig.number_of_rows) {
    assert.equal(Number.isInteger(v), true, `every element must be int, got ${v}`);
  }
});

/* Case 32: enable_math_recording defaults false. */
test('UQ-DEEP-AL · FIX-D · enable_math_recording defaults to false (IGT spec line 144)', () => {
  const model = {
    topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
    symbols: { high: [{ id: 'D', kind: 'high' }] },
    paytable: { D: { 5: 500 } },
    reelStrips: { strips: [['D'], ['D']] },
  };
  const r = compileServerConfig(model);
  assert.equal(r.serverConfig.enable_math_recording, false,
    'IGT default debug flag = false');
  /* Also verify cascades=false (no cascade feature) i ways=false (rect topology). */
  assert.equal(r.serverConfig.cascades, false);
  assert.equal(r.serverConfig.ways, false);
});

/* ── UQ-DEEP-AL gate cases (21, 22) ──────────────────────────────────────── */

test('UQ-DEEP-AL · emitNonLockedSymbolId: tip uvek string (typeof === "string") kad nije null', () => {
  /* (a) Explicit string passthrough. */
  const m1 = {
    symbols: { low: [{ id: 'L1', kind: 'low' }] },
    holdAndWin: { enabled: true, nonLockedSymbolId: 'BLANK' },
  };
  const r1 = emitNonLockedSymbolId(m1);
  assert.equal(typeof r1, 'string');
  assert.equal(r1, 'BLANK');

  /* (b) Derived lowest tier. */
  const m2 = {
    symbols: {
      low: [{ id: 'L9', kind: 'low', payouts: [0, 0, 0, 1, 2, 3] }],
      specials: [{ id: 'W', kind: 'wild' }],
    },
    holdAndWin: { enabled: true, triggerCount: 6 },
  };
  const r2 = emitNonLockedSymbolId(m2);
  assert.equal(typeof r2, 'string');
  assert.equal(r2, 'L9');

  /* (c) Legacy integer override → resolved to string via symbol index. */
  const m3 = {
    symbols: { low: [{ id: 'L1', kind: 'low' }, { id: 'L2', kind: 'low' }] },
    holdAndWin: { enabled: true, nonLockedSymbolId: 1 },              /* legacy int */
  };
  const r3 = emitNonLockedSymbolId(m3);
  assert.equal(typeof r3, 'string', 'legacy integer override coerced to string code');
  assert.equal(r3, 'L2');

  /* Null case stays null. */
  assert.equal(emitNonLockedSymbolId({}), null);
});

test('UQ-DEEP-AL · serverConfig MUST NOT emit snake_case non_locked_symbol_id (camelCase only)', () => {
  const modelHnw = {
    topology: { reels: 5, rows: 3, paylines: [[0, 0, 0, 0, 0]] },
    symbols: {
      low: [{ id: 'L1', kind: 'low' }],
      specials: [{ id: 'W', kind: 'wild' }],
    },
    reelStrips: { strips: [['L1'], ['W']] },
    holdAndWin: { enabled: true, triggerCount: 6, nonLockedSymbolId: 'L1' },
  };
  const r = compileServerConfig(modelHnw);
  assert.equal(Object.prototype.hasOwnProperty.call(r.serverConfig, 'non_locked_symbol_id'), false,
    'snake_case non_locked_symbol_id must be eliminated (UQ-DEEP-AL FIX-B)');
  assert.equal(Object.prototype.hasOwnProperty.call(r.serverConfig, 'nonLockedSymbolId'), true,
    'only camelCase nonLockedSymbolId must remain');

  /* Same negative assertion for no-HnW model. */
  const modelNoHnw = {
    topology: { reels: 5, rows: 3, paylines: [[0, 0, 0, 0, 0]] },
    symbols: { high: [{ id: 'D', kind: 'high' }], specials: [{ id: 'W', kind: 'wild' }] },
    reelStrips: { strips: [['D'], ['W']] },
  };
  const r2 = compileServerConfig(modelNoHnw);
  assert.equal(Object.prototype.hasOwnProperty.call(r2.serverConfig, 'non_locked_symbol_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(r2.serverConfig, 'nonLockedSymbolId'), true);
});

/* ── UQ-DEEP-AN · AN-4 · EXPANSION_TYPE enum extension (cases 33-50) ────────
 *
 * Extends 6 baseline values (0..5) sa 5 industry-pattern values (6..10):
 *   6  SCATTER_FILL      — scatter triggers symbol fill across grid
 *   7  SYMBOL_REPLACE    — all instances of one symbol → another
 *   8  RANDOM_CELLS      — random N cells expand
 *   9  ADJACENT_COPY     — expands to adjacent cells
 *  10  DIAGONAL_LINE     — diagonal fill
 *
 * Source: cross-reference sister-repo (slot-math-engine-template) potvrdjuje
 * vendor-neutral status (no canonical EXPANSION_TYPE enum tamo). Naša lista
 * derived iz 338 GDD korpus analize.
 */

/* Case 33: enum has 11 keys. */
test('UQ-DEEP-AN · EXPANSION_TYPE has 11 keys (6 baseline + 5 industry extensions)', () => {
  const keys = Object.keys(EXPANSION_TYPE);
  assert.equal(keys.length, 11, `expected 11 keys, got ${keys.length}: ${keys.join(',')}`);
});

/* Case 34: SCATTER_FILL = 6. */
test('UQ-DEEP-AN · EXPANSION_TYPE.SCATTER_FILL === 6', () => {
  assert.equal(EXPANSION_TYPE.SCATTER_FILL, 6);
});

/* Case 35: SYMBOL_REPLACE = 7. */
test('UQ-DEEP-AN · EXPANSION_TYPE.SYMBOL_REPLACE === 7', () => {
  assert.equal(EXPANSION_TYPE.SYMBOL_REPLACE, 7);
});

/* Case 36: RANDOM_CELLS = 8. */
test('UQ-DEEP-AN · EXPANSION_TYPE.RANDOM_CELLS === 8', () => {
  assert.equal(EXPANSION_TYPE.RANDOM_CELLS, 8);
});

/* Case 37: ADJACENT_COPY = 9. */
test('UQ-DEEP-AN · EXPANSION_TYPE.ADJACENT_COPY === 9', () => {
  assert.equal(EXPANSION_TYPE.ADJACENT_COPY, 9);
});

/* Case 38: DIAGONAL_LINE = 10. */
test('UQ-DEEP-AN · EXPANSION_TYPE.DIAGONAL_LINE === 10', () => {
  assert.equal(EXPANSION_TYPE.DIAGONAL_LINE, 10);
});

/* Case 39: emitExpansionType('scatterFill') → 6. */
test("UQ-DEEP-AN · emitExpansionType('scatterFill', {}) → 6 SCATTER_FILL", () => {
  assert.equal(emitExpansionType('scatterFill', {}), 6);
  assert.equal(emitExpansionType('scatterFill', {}), EXPANSION_TYPE.SCATTER_FILL);
});

/* Case 40: emitExpansionType('symbolReplace') → 7. */
test("UQ-DEEP-AN · emitExpansionType('symbolReplace', {}) → 7 SYMBOL_REPLACE", () => {
  assert.equal(emitExpansionType('symbolReplace', {}), 7);
  assert.equal(emitExpansionType('symbolReplace', {}), EXPANSION_TYPE.SYMBOL_REPLACE);
});

/* Case 41: emitExpansionType('mysteryRevealAll') → 7 (alias). */
test("UQ-DEEP-AN · emitExpansionType('mysteryRevealAll', {}) → 7 SYMBOL_REPLACE (alias)", () => {
  assert.equal(emitExpansionType('mysteryRevealAll', {}), 7);
  assert.equal(emitExpansionType('mysteryRevealAll', {}), EXPANSION_TYPE.SYMBOL_REPLACE);
});

/* Case 42: emitExpansionType('randomCellExpand') → 8. */
test("UQ-DEEP-AN · emitExpansionType('randomCellExpand', {}) → 8 RANDOM_CELLS", () => {
  assert.equal(emitExpansionType('randomCellExpand', {}), 8);
  assert.equal(emitExpansionType('randomCellExpand', {}), EXPANSION_TYPE.RANDOM_CELLS);
});

/* Case 43: emitExpansionType('adjacentCopy') → 9. */
test("UQ-DEEP-AN · emitExpansionType('adjacentCopy', {}) → 9 ADJACENT_COPY", () => {
  assert.equal(emitExpansionType('adjacentCopy', {}), 9);
  assert.equal(emitExpansionType('adjacentCopy', {}), EXPANSION_TYPE.ADJACENT_COPY);
});

/* Case 44: emitExpansionType('diagonalLine') → 10. */
test("UQ-DEEP-AN · emitExpansionType('diagonalLine', {}) → 10 DIAGONAL_LINE", () => {
  assert.equal(emitExpansionType('diagonalLine', {}), 10);
  assert.equal(emitExpansionType('diagonalLine', {}), EXPANSION_TYPE.DIAGONAL_LINE);
});

/* Case 45: Enum frozen — write attempt has no effect (strict mode would throw,
 * non-strict silently no-ops). Either way: Object.isFrozen must be true. */
test('UQ-DEEP-AN · EXPANSION_TYPE Object.isFrozen === true (immutability gate)', () => {
  assert.equal(Object.isFrozen(EXPANSION_TYPE), true,
    'EXPANSION_TYPE must be frozen — operator-side tampering forbidden');
  /* Even strict mode write fails — verify defineProperty also rejects. */
  assert.throws(() => {
    Object.defineProperty(EXPANSION_TYPE, 'INJECTED', { value: 99, writable: true });
  }, /Cannot|read.?only|frozen/i);
});

/* Case 46: Existing 6 mappings preserved (back-compat sa UQ-DEEP-AK). */
test('UQ-DEEP-AN · Existing 6 mappings preserved (REEL_FULL/CLUSTER/ROW/PART_OF_WIN/ANCHOR/NONE)', () => {
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'reel' }), 1);
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'cluster' }), 2);
  assert.equal(emitExpansionType('expandingWild', { expandTo: 'row' }), 3);
  assert.equal(emitExpansionType('expandingWild', { triggers: 'partOfWin' }), 4);
  assert.equal(emitExpansionType('fsExpansionWilds', {}), 5);
  assert.equal(emitExpansionType('megaWildCluster', {}), 2);
  assert.equal(emitExpansionType(null, null), 0);
});

/* Case 47: Unknown feature kind → NONE (0). */
test('UQ-DEEP-AN · Unknown feature kind → 0 NONE (safe degradation invariant)', () => {
  assert.equal(emitExpansionType('totallyUnknownKindXYZ', {}), 0);
  assert.equal(emitExpansionType('paylines', {}), 0);
  assert.equal(emitExpansionType('', {}), 0);
  assert.equal(emitExpansionType(undefined, undefined), 0);
});

/* Case 48: Header comment u source documents vendor-neutral extension. */
test('UQ-DEEP-AN · sgs-compiler.mjs header comment documents vendor-neutral extension', () => {
  const src = readFileSync(SGS_COMPILER_SOURCE_PATH, 'utf8');
  /* Must contain vendor-neutral documentation. */
  assert.ok(/vendor-neutral/i.test(src),
    'source must document vendor-neutral status');
  assert.ok(/EXPANSION_TYPE/.test(src),
    'source must reference EXPANSION_TYPE enum');
  /* Must reference operator-side categorization (not IGT-canonical). */
  assert.ok(/operator-side/i.test(src),
    'source must clarify operator-side categorization (not IGT-canonical)');
  /* Must reference UQ-DEEP-AN extension marker. */
  assert.ok(/UQ-DEEP-AN/.test(src),
    'source must reference UQ-DEEP-AN extension lineage');
});

/* Case 49: compileServerConfig output expansion_type accepts 0..10 range. */
test('UQ-DEEP-AN · compileServerConfig expansion_type covers full 0..10 range (sweep)', () => {
  const seen = new Set();
  /* Per-pattern probe — each kind → distinct expansion_type. */
  const probes = [
    { kind: null, expected: 0 },                                       /* NONE */
    { kind: 'expandingWild', cfg: { expandTo: 'reel' }, expected: 1 }, /* REEL_FULL */
    { kind: 'megaWildCluster', cfg: {}, expected: 2 },                 /* CLUSTER */
    { kind: 'expandingWild', cfg: { expandTo: 'row' }, expected: 3 },  /* ROW */
    { kind: 'expandingWild', cfg: { triggers: 'partOfWin' }, expected: 4 }, /* PART_OF_WIN */
    { kind: 'fsExpansionWilds', cfg: {}, expected: 5 },                /* ANCHOR */
    { kind: 'scatterFill', cfg: {}, expected: 6 },                     /* SCATTER_FILL */
    { kind: 'symbolReplace', cfg: {}, expected: 7 },                   /* SYMBOL_REPLACE */
    { kind: 'randomCellExpand', cfg: {}, expected: 8 },                /* RANDOM_CELLS */
    { kind: 'adjacentCopy', cfg: {}, expected: 9 },                    /* ADJACENT_COPY */
    { kind: 'diagonalLine', cfg: {}, expected: 10 },                   /* DIAGONAL_LINE */
  ];
  for (const p of probes) {
    const features = p.kind ? [{ kind: p.kind, config: p.cfg || {} }] : [];
    const model = {
      topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
      symbols: {
        high: [{ id: 'D', kind: 'high' }],
        specials: [{ id: 'W', kind: 'wild' }],
      },
      paytable: { D: { 5: 500 } },
      reelStrips: { strips: [['D', 'W'], ['D', 'W']] },
      features,
    };
    const r = compileServerConfig(model);
    seen.add(r.serverConfig.expansion_type);
    assert.equal(r.serverConfig.expansion_type, p.expected,
      `kind=${p.kind} expected expansion_type=${p.expected}, got ${r.serverConfig.expansion_type}`);
  }
  /* Confirm every 0..10 value reachable. */
  for (let i = 0; i <= 10; i++) {
    assert.ok(seen.has(i), `expansion_type value ${i} never emitted by sweep`);
  }
});

/* Case 50: compileServerConfig validates expansion_type ≥ 0 ≤ 10 invariant. */
test('UQ-DEEP-AN · compileServerConfig expansion_type ∈ [0..10] invariant (across all known kinds)', () => {
  const knownKinds = [
    'expandingWild', 'fsExpansionWilds', 'megaWildCluster',
    'scatterFill', 'symbolReplace', 'mysteryRevealAll',
    'randomCellExpand', 'adjacentCopy', 'diagonalLine',
    /* Plus unknowns → 0. */
    'totallyUnknown', 'xyz', '',
  ];
  for (const kind of knownKinds) {
    const model = {
      topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
      symbols: {
        high: [{ id: 'D', kind: 'high' }],
        specials: [{ id: 'W', kind: 'wild' }],
      },
      paytable: { D: { 5: 500 } },
      reelStrips: { strips: [['D', 'W'], ['D', 'W']] },
      features: kind ? [{ kind, config: {} }] : [],
    };
    const r = compileServerConfig(model);
    const et = r.serverConfig.expansion_type;
    assert.equal(Number.isInteger(et), true,
      `expansion_type must be int (kind=${kind}, got ${et})`);
    assert.ok(et >= 0 && et <= 10,
      `expansion_type ∈ [0..10] invariant violated (kind=${kind}, value=${et})`);
  }
});
