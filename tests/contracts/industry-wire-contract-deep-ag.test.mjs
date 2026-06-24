/**
 * UQ-DEEP-AG · industry math engine wire contract test (Boki 2026-06-24)
 *
 * Boki: "overi detaljno jedan po jedan fajl i uporedi sa nasim slot gdd
 * blokovima, sa nasom matematikom vidi sta ultimativno fali, sta treba
 * i sta moze da se iskoristi i poboljsa futuristicki, da rtadi
 * automatizn=ovano i izuzetno tacno ama bas svaki jebeni put!"
 *
 * 3 paralelna senior auditora identifikovala 15 P0 ship-blocker rupa
 * preko 3 ose (math, server contracts, symbol engineering). Ovaj commit
 * zatvara najtransformativniji core:
 *
 * 1. industry standard serverConfig kompajler (tools/sgs-compiler.mjs)
 *    - gain_table (per-symbol payout concat, §4 rule 1)
 *    - reels[][] padded sa -1 sentinel (§4 rule 2)
 *    - lines flatten + number_of_lines (§4 rule 3)
 *    - special_symbols[] schema (scatter+FS+HnW, §4 rule 4)
 *    - paytable_hash SHA-256 canonical JSON (regulator integrity)
 *    - wild_symbol ID + symbols[] (integer index)
 *
 * 2. industry standard GameLogicResponse envelope (tools/gle-response-emitter.mjs)
 *    - OutcomeDetail{transactionId UUID, stage, nextStage, gameStatus,
 *      settled, pending, payout cents}
 *    - PopulationOutcome{Entry[].Cell[].stripIndex} (server-authoritative)
 *    - PrizeOutcome{Prize[]} u centama
 *    - FreeSpinOutcome / MultiplierOutcome lifecycle envelope
 *    - GLE_ERROR_CODES (INSUFFICIENT_BALANCE, SESSION_EXPIRED,
 *      GLE_TIMEOUT, RNG_RESEED_REQUIRED, INVALID_BET, PAYTABLE_HASH_MISMATCH)
 *
 * 3. Integer-weight conversion (src/registry/integerWeightConvert.mjs)
 *    - convertToServerValues(arr) per-element 10^k scale (industry math engine INTEGER-ONLY)
 *    - getDecimalsCountForNumber preserves industry standard scientific-notation quirk
 *
 * 4. math-backend integration:
 *    - POST /spin sa `gle: true` → vraća OutcomeDetail envelope
 *    - POST /serverConfig → emit-uje wire-compatible serverConfig + hash
 *
 * Vendor-neutral: nijedan industry standard brand string u outputu, samo wire contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileServerConfig, computePaytableHash, compileGainTable, compileLines, compileSpecialSymbols } from '../../tools/sgs-compiler.mjs';
import { emitGleResponse, emitOutcomeDetail, emitPopulationOutcome, emitErrorResponse, GLE_ERROR_CODES, STAGE } from '../../tools/gle-response-emitter.mjs';
import { convertToServerValues, restoreFloatsFromServerValues, getDecimalsCountForNumber, maxDecimalsInArray } from '../../src/registry/integerWeightConvert.mjs';

/* ── INTEGER WEIGHT CONVERSION ───────────────────────────────────────────── */

test('UQ-DEEP-AG · getDecimalsCountForNumber handles fixed + scientific notation', () => {
  assert.equal(getDecimalsCountForNumber(0.5), 1);
  assert.equal(getDecimalsCountForNumber(0.25), 2);
  assert.equal(getDecimalsCountForNumber(0.125), 3);
  assert.equal(getDecimalsCountForNumber(1.0), 0);
  assert.equal(getDecimalsCountForNumber(0), 0);
  assert.equal(getDecimalsCountForNumber(100), 0);
  /* Scientific notation: 1e-7 → 7 decimals. */
  assert.equal(getDecimalsCountForNumber(1e-7), 7);
  assert.equal(getDecimalsCountForNumber(1.5e-3), 4);    /* 1.5 mantissa + 3 exp = 4 */
});

test('UQ-DEEP-AG · convertToServerValues per-element integer scale', () => {
  /* Basic: [0.5, 0.25, 0.125] → max_decimals=3, scale=1000. */
  const r1 = convertToServerValues([0.5, 0.25, 0.125]);
  assert.deepEqual(r1.values, [500, 250, 125]);
  assert.equal(r1.scale, 1000);
  assert.equal(r1.max_decimals, 3);
  /* Empty input. */
  assert.deepEqual(convertToServerValues([]).values, []);
  /* All integers. */
  assert.deepEqual(convertToServerValues([1, 2, 3]).values, [1, 2, 3]);
  /* IEEE-754 drift guard: 0.1 + 0.2 = 0.30000000000000004 → Math.round. */
  const r3 = convertToServerValues([0.1, 0.2, 0.3]);
  assert.deepEqual(r3.values, [1, 2, 3]);
  /* Round-trip stability. */
  const orig = [0.0085, 0.009, 0.5];
  const srv = convertToServerValues(orig);
  const back = restoreFloatsFromServerValues(srv);
  for (let i = 0; i < orig.length; i++) {
    assert.ok(Math.abs(orig[i] - back[i]) < 1e-9, `round-trip ${orig[i]} → ${back[i]}`);
  }
});

/* ── SERVER CONFIG COMPILER ──────────────────────────────────────────────── */

test('UQ-DEEP-AG · compileGainTable concatenates per-symbol payouts in symbols[] order', () => {
  const symbols = [
    { id: 'D', kind: 'high' },
    { id: 'J', kind: 'low' },
    { id: 'W', kind: 'wild' },
    { id: 'S', kind: 'scatter' },                     /* must be skipped */
  ];
  const paytable = {
    D: { 3: 50, 4: 200, 5: 1000 },
    J: { 3: 5, 4: 25, 5: 100 },
    W: { 5: 500 },                                    /* sparse */
    S: { 3: 0, 4: 5, 5: 25 },                          /* skipped */
  };
  const gt = compileGainTable(symbols, paytable);
  /* industry standard order: each symbol contributes [pay0, pay1, pay2, pay3, pay4, pay5]. */
  /* D: [0,0,0,50,200,1000]; J: [0,0,0,5,25,100]; W: [0,0,0,0,0,500] */
  assert.deepEqual(gt, [
    0, 0, 0, 50, 200, 1000,
    0, 0, 0, 5, 25, 100,
    0, 0, 0, 0, 0, 500,
  ]);
});

test('UQ-DEEP-AG · compileLines flattens 2D paylines into 1D', () => {
  const paylines = [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2]];
  const r = compileLines(paylines, 5);
  assert.deepEqual(r.lines, [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2]);
  assert.equal(r.number_of_lines, 3);
});

test('UQ-DEEP-AG · compileSpecialSymbols emits scatter + FS + HnW per industry spec P2.10', () => {
  const model = {
    symbols: {
      specials: [
        { id: 'S', kind: 'scatter', label: 'Scatter', payouts: [0, 0, 5, 25, 100] },
      ],
    },
    freeSpins: { enabled: true, label: 'Free Spins', triggerCounts: [3, 4, 5],
                 awards: [{ count: 3, spins: 10 }, { count: 4, spins: 15 }] },
    holdAndWin: { enabled: true, label: 'Hold & Win', triggerCount: 6,
                  bonusSymbolId: 'B', respinsOnHit: 3, nonLockedSymbolId: 'BLANK', hasEmptyCells: true },
  };
  const specials = compileSpecialSymbols(model);
  /* industry spec P2.10 trigger_count rules:
   *   Scatter: first_nonzero_payout_index + 1 → index 2 (val 5) + 1 = 3
   *   FS: min(triggerCounts) → 3
   *   HnW: direct → 6
   */
  const sc = specials.find(s => s.feature_type === 'scatter');
  assert.ok(sc, 'scatter special emitted');
  assert.equal(sc.trigger_count, 3, 'scatter trigger_count = first_nonzero_index+1');
  const fs = specials.find(s => s.feature_type === 'free_spin');
  assert.ok(fs, 'free_spin special emitted');
  assert.equal(fs.trigger_count, 3, 'FS trigger_count = min(triggerCounts)');
  assert.deepEqual(fs.odds_freespins, { 3: 10, 4: 15 }, 'odds_freespins map');
  const hnw = specials.find(s => s.feature_type === 'hold_and_win');
  assert.ok(hnw, 'hold_and_win special emitted');
  assert.equal(hnw.trigger_count, 6, 'HnW trigger_count = direct');
  assert.equal(hnw.non_locked_symbol, 'BLANK', 'industry standard lock predicate field');
  assert.equal(hnw.has_empty_cells, true, 'industry standard empty cells field');
});

test('UQ-DEEP-AG · compileServerConfig emits valid industry standard envelope + paytable hash', () => {
  const model = {
    topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
    symbols: {
      high: [{ id: 'D', kind: 'high' }],
      low: [{ id: 'J', kind: 'low' }],
      specials: [{ id: 'W', kind: 'wild' }, { id: 'S', kind: 'scatter' }],
    },
    paytable: { D: { 5: 500 }, J: { 5: 50 }, W: { 5: 1000 } },
    reelStrips: { strips: [['D', 'J', 'W'], ['D', 'J', 'S', 'W']] },
    freeSpins: { enabled: true, triggerCounts: [3], awards: [{ count: 3, spins: 10 }] },
  };
  const r = compileServerConfig(model);
  assert.ok(r.serverConfig, 'serverConfig present');
  assert.equal(r.gleVersion, '4.0');
  assert.ok(r.paytableHash && r.paytableHash.length === 64, 'paytable_hash SHA-256 hex');
  assert.equal(r.serverConfig.number_of_columns, 5);
  /* UQ-DEEP-AL · FIX-D: `number_of_rows` upgraded scalar int → int[] per IGT
   * spec line 124 (per-reel array). Za uniform 5×3 grid → [3,3,3,3,3]. */
  assert.ok(Array.isArray(r.serverConfig.number_of_rows),
    'number_of_rows must be int[] per IGT spec line 124');
  assert.deepEqual(r.serverConfig.number_of_rows, [3, 3, 3, 3, 3]);
  assert.equal(r.serverConfig.number_of_lines, 1);
  assert.equal(typeof r.serverConfig.wild_symbol, 'number');
  assert.ok(Array.isArray(r.serverConfig.gain_table));
  assert.ok(Array.isArray(r.serverConfig.reels));
  assert.ok(Array.isArray(r.serverConfig.special_symbols));
});

test('UQ-DEEP-AG · paytable hash is DETERMINISTIC for same input', () => {
  const sc = {
    gle_version: '4.0',
    gain_table: [50, 100],
    reels: [[0, 1, 2]],
    lines: [1, 1, 1, 1, 1],
    number_of_lines: 1,
    number_of_columns: 5,
    number_of_rows: 3,
    wild_symbol: 0,
  };
  const h1 = computePaytableHash(sc);
  const h2 = computePaytableHash(sc);
  assert.equal(h1, h2, 'deterministic');
  /* Same content, different key order → SAME hash (canonical JSON). */
  const scReordered = {
    wild_symbol: 0,
    number_of_rows: 3,
    number_of_columns: 5,
    number_of_lines: 1,
    lines: [1, 1, 1, 1, 1],
    reels: [[0, 1, 2]],
    gain_table: [50, 100],
    gle_version: '4.0',
  };
  assert.equal(computePaytableHash(scReordered), h1, 'order-independent (canonical JSON)');
});

/* ── GLE RESPONSE EMITTER ────────────────────────────────────────────────── */

test('UQ-DEEP-AG · emitOutcomeDetail produces transactionId UUID + stage transitions', () => {
  const spinResult = { payX: 5.0, isHit: true };
  /* UQ-DEEP-AL FIX-E: default = IGT-aligned (state present, no gameStatus). */
  const r1 = emitOutcomeDetail(spinResult, { stage: STAGE.BASE_GAME, betX: 1 });
  assert.ok(r1.transactionId.length === 36, 'transactionId is UUID');
  assert.equal(r1.stage, STAGE.BASE_GAME);
  assert.equal(r1.gameStatus, undefined, 'IGT-aligned: no gameStatus enum (UQ-DEEP-AL FIX-E)');
  assert.equal(r1.state, null, 'IGT free-form `state` present (null when unset)');
  assert.equal(r1.payout, 500, 'payout in cents (payX * betCents)');
  /* legacy:true reinstates the pre-AL gameStatus enum for back-compat consumers. */
  const r1Legacy = emitOutcomeDetail(spinResult, { stage: STAGE.BASE_GAME, betX: 1 }, { legacy: true });
  assert.equal(r1Legacy.gameStatus, 'PLAYED', 'legacy mode echoes invented enum');
  /* FS trigger → next stage = FreeSpin. */
  const r2 = emitOutcomeDetail({ fsTrigger: true }, { stage: STAGE.BASE_GAME });
  assert.equal(r2.nextStage, STAGE.FREE_SPIN);
  /* H&W trigger → next stage = LockAndRespin. */
  const r3 = emitOutcomeDetail({ hnwTrigger: true }, { stage: STAGE.BASE_GAME });
  assert.equal(r3.nextStage, STAGE.LOCK_AND_RESPIN);
  /* FS finishing → back to BaseGame, settled=true. */
  const r4 = emitOutcomeDetail({ fsRemaining: 0 }, { stage: STAGE.FREE_SPIN });
  assert.equal(r4.nextStage, STAGE.BASE_GAME);
  assert.equal(r4.settled, true);
});

test('UQ-DEEP-AG · emitPopulationOutcome maps grid → Entry[].Cell[] sa stripIndex', () => {
  const grid = [
    ['D', 'J', 'W'],                 /* reel 0, rows 0..2 */
    ['J', 'D', 'D'],                 /* reel 1 */
  ];
  const reelStrips = [
    ['D', 'J', 'W', 'D', 'J'],
    ['J', 'D', 'D', 'W'],
  ];
  const symbolIdMap = { D: 0, J: 1, W: 2, S: 3 };
  const pop = emitPopulationOutcome(grid, reelStrips, symbolIdMap);
  assert.ok(Array.isArray(pop.Entry), 'Entry array');
  assert.equal(pop.Entry.length, 2, '2 reels');
  assert.equal(pop.Entry[0].Cell.length, 3, '3 rows');
  /* Each cell has stripIndex + symbolId. */
  assert.equal(typeof pop.Entry[0].Cell[0].stripIndex, 'number');
  assert.equal(typeof pop.Entry[0].Cell[0].symbolId, 'number');
});

test('UQ-DEEP-AG · emitGleResponse builds full envelope sa svim subobjects', () => {
  const spinResult = {
    payX: 10.5,
    isHit: true,
    fsTrigger: true,
    fsAwarded: 15,
    fsMultiplier: 2,
    multiplier: 3,
    prizes: [{ type: 'line', amount: 5.0, count: 3, position: [0, 0, 0] }],
  };
  /* UQ-DEEP-AL FIX-E: default = IGT-aligned Map<> shape. */
  const r = emitGleResponse(spinResult, { stage: STAGE.BASE_GAME, betX: 1, sessionId: 'test', paytableHash: 'deadbeef' });
  assert.equal(r.gle_version, '4.0');
  assert.ok(r.outcomeDetail.transactionId);
  assert.equal(r.outcomeDetail.nextStage, STAGE.FREE_SPIN);
  assert.equal(r.outcomeDetail.payout, 1050, 'cents');
  assert.equal(r.paytableHash, 'deadbeef', 'echo paytable hash');
  /* Map<> shape: freeSpinOutcome is keyed by tag, entries use IGT field names. */
  assert.ok(r.freeSpinOutcome['fs-main'], 'FS map keyed by fs-main');
  assert.equal(r.freeSpinOutcome['fs-main'].fsAwarded, 15, 'IGT fsAwarded (was spinsAwarded)');
  assert.ok(r.multiplierOutcome['global'], 'multiplier map keyed by global');
  assert.equal(r.multiplierOutcome['global'].value, 3);
  assert.ok(r.prizeOutcome['lines'], 'prize map keyed by lines');
  assert.equal(r.prizeOutcome['lines'].Prize[0].pay, 500, 'IGT pay (was amount), in cents');
  assert.equal(r.prizeOutcome['lines'].Prize[0].totalPay, 500, 'IGT totalPay = pay × multiplier × betMultiplier');

  /* legacy:true reproduces the pre-AL flat shape for back-compat consumers. */
  const rLegacy = emitGleResponse(spinResult, { stage: STAGE.BASE_GAME, betX: 1, sessionId: 'test', paytableHash: 'deadbeef' }, { legacy: true });
  assert.equal(rLegacy.freeSpinOutcome.spinsAwarded, 15, 'legacy: spinsAwarded preserved');
  assert.equal(rLegacy.freeSpinOutcome.multiplier, 2, 'legacy: fsMultiplier surfaced as multiplier');
  assert.equal(rLegacy.prizeOutcome.Prize[0].amount, 500, 'legacy: prize Prize[].amount in cents');
});

test('UQ-DEEP-AG · emitErrorResponse structured envelope sa error codes', () => {
  const r = emitErrorResponse(GLE_ERROR_CODES.INSUFFICIENT_BALANCE, 'Balance < bet');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'INSUFFICIENT_BALANCE');
  assert.equal(r.retryable, false, 'balance not retryable');
  assert.equal(r.severity, 'recoverable');
  /* Hash mismatch → fatal. */
  const r2 = emitErrorResponse(GLE_ERROR_CODES.PAYTABLE_HASH_MISMATCH, 'Hash drift');
  assert.equal(r2.severity, 'fatal', 'paytable hash mismatch is fatal');
  /* Timeout → retryable. */
  const r3 = emitErrorResponse(GLE_ERROR_CODES.GLE_TIMEOUT, 'Slow');
  assert.equal(r3.retryable, true);
});

/* ── LIVE E2E sa math-backend ───────────────────────────────────────────── */

test('UQ-DEEP-AG · live POST /serverConfig endpoint returns industry standard envelope', async () => {
  const model = {
    name: 'Test Slot',
    topology: { reels: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] },
    symbols: { high: [{ id: 'D', kind: 'high' }], specials: [{ id: 'W', kind: 'wild' }] },
    paytable: { D: { 5: 500 }, W: { 5: 1000 } },
    reelStrips: { strips: [['D', 'W'], ['D', 'W']] },
  };
  const r = await fetch('http://127.0.0.1:9001/serverConfig', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(j.serverConfig, 'serverConfig present');
  assert.equal(j.gleVersion, '4.0');
  assert.ok(j.paytableHash, 'paytable hash returned');
  assert.equal(j.serverConfig.gle_version, '4.0');
  assert.ok(Array.isArray(j.serverConfig.gain_table));
});

test('UQ-DEEP-AG · live POST /spin sa gle:true vraća OutcomeDetail envelope', async () => {
  const model = {
    name: 'Test',
    payback: { rtp: 96, hitFrequency: 0.2, maxWinX: 5000 },
    freeSpins: { enabled: true },
    features: [{ kind: 'free_spins' }],
  };
  /* First spin sa standard endpoint (legacy back-compat). */
  const r1 = await fetch('http://127.0.0.1:9001/spin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'test_session_1', model }),
  });
  const j1 = await r1.json();
  assert.equal(j1.ok, true);
  assert.equal(j1.gle, undefined, 'legacy mode (gle field absent)');

  /* Second spin sa gle:true → industry standard envelope. */
  const r2 = await fetch('http://127.0.0.1:9001/spin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'test_session_2', model, gle: true, betX: 1, paytableHash: 'abc123' }),
  });
  const j2 = await r2.json();
  assert.equal(j2.ok, true);
  assert.ok(j2.gle, 'gle envelope present');
  assert.equal(j2.gle.gle_version, '4.0');
  assert.ok(j2.gle.outcomeDetail.transactionId, 'transactionId UUID');
  assert.equal(j2.gle.paytableHash, 'abc123', 'paytable hash echo');
  assert.equal(typeof j2.gle.outcomeDetail.payout, 'number', 'payout integer cents');
});
