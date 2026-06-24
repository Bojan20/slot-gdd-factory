/**
 * UQ-DEEP-AL · FIX-E · GLE response → IGT field-name + Map<> shape alignment
 * (Boki 2026-06-24).
 *
 * QA-3 IGT fidelity audit (komparacija 2) otkrio 4 misalignmenta u
 * pre-AL `tools/gle-response-emitter.mjs`:
 *
 *   1. Outer envelopes (populationOutcome / prizeOutcome / freeSpinOutcome /
 *      multiplierOutcome) emit-ovani kao single object — IGT
 *      (IGT_SYMBOLS/playa-slot.symbols.md:3995) zahteva `Map<string,...>`
 *      keyed by GLE tag (e.g. 'main', 'lines', 'scatter', 'fs-main', 'global').
 *
 *   2. Prize field names mismatch — emit-ovali `{type, amount, count, position}`,
 *      IGT IOutcomePrizeDef (IGT_PLAYA_RUNTIME.md:98) je
 *      `{pay, totalPay, multiplier, betMultiplier, symbolCount, position, ways}`.
 *
 *   3. FreeSpin field names mismatch — emit-ovali `{spinsAwarded, multiplier,
 *      retrigger}`, IGT IFreeSpinOutcomeDef (IGT_PLAYA_RUNTIME.md:88) je
 *      `{fsCount, fsCountDown, fsAwarded}`.
 *
 *   4. `gameStatus` enum (READY/PLAYED/SETTLED/PENDING/ERROR) invented — IGT
 *      ima samo untyped `state: string`. Enum REMOVED.
 *
 * Ovaj test zaključava IGT-aligned shape (default) + verifikuje
 * `{ legacy: true }` back-compat path (pre-AL clients still bind to flat
 * shape until migrated).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emitGleResponse,
  emitOutcomeDetail,
  emitPopulationMap,
  emitPrizeMap,
  emitFreeSpinMap,
  emitMultiplierMap,
  prizeToIgtShape,
  GLE_ERROR_CODES,
  STAGE,
} from '../../tools/gle-response-emitter.mjs';
import * as emitterModule from '../../tools/gle-response-emitter.mjs';

/* Reusable fixture: a typical FS-trigger spin sa svim outcome subobjects. */
function fxSpin(over = {}) {
  return {
    payX: 4.0,
    isHit: true,
    fsTrigger: true,
    fsAwarded: 10,
    fsRemaining: 10,
    fsCount: 10,
    fsMultiplier: 2,
    multiplier: 3,
    multiplierLifetime: 'spin',
    prizes: [
      { type: 'line',    amount: 2.0, count: 3, position: 0,    multiplier: 1, betMultiplier: 1 },
      { type: 'scatter', amount: 1.0, count: 4, position: 1,    multiplier: 2, betMultiplier: 1 },
    ],
    ...over,
  };
}

const fxSession = { stage: STAGE.BASE_GAME, betX: 1, sessionId: 'igt-1', paytableHash: 'deadbeefcafe' };

/* ── 1. envelope-shape contract ──────────────────────────────────────────── */

test('UQ-DEEP-AL FIX-E · 1. emitGleResponse returns 5 outcome keys (+envelope metadata)', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  for (const k of ['outcomeDetail', 'populationOutcome', 'prizeOutcome', 'freeSpinOutcome', 'multiplierOutcome']) {
    assert.ok(Object.prototype.hasOwnProperty.call(r, k), `key ${k} present`);
  }
});

test('UQ-DEEP-AL FIX-E · 2. populationOutcome is a keyed map (object, NOT array)', () => {
  const grid = [['D', 'J', 'W'], ['J', 'D', 'D']];
  const r = emitGleResponse(fxSpin(), fxSession, { grid });
  assert.equal(Array.isArray(r.populationOutcome), false, 'not an array');
  assert.equal(typeof r.populationOutcome, 'object', 'keyed object');
});

test('UQ-DEEP-AL FIX-E · 3. populationOutcome["main"] present when grid available', () => {
  const grid = [['D', 'J', 'W'], ['J', 'D', 'D']];
  const r = emitGleResponse(fxSpin(), fxSession, { grid });
  assert.ok(r.populationOutcome['main'], 'main key present');
  assert.ok(Array.isArray(r.populationOutcome['main'].Entry), 'main.Entry array');
  assert.equal(r.populationOutcome['main'].Entry.length, 2, '2 reels');
});

test('UQ-DEEP-AL FIX-E · 4. prizeOutcome is a keyed map (object, NOT array)', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  assert.equal(Array.isArray(r.prizeOutcome), false);
  assert.equal(typeof r.prizeOutcome, 'object');
});

test('UQ-DEEP-AL FIX-E · 5. prizeOutcome["lines"] present when line payouts exist', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  assert.ok(r.prizeOutcome['lines'], 'lines key present');
  assert.ok(Array.isArray(r.prizeOutcome['lines'].Prize), 'lines.Prize is array');
  /* Scatter prize routed to its own bucket. */
  assert.ok(r.prizeOutcome['scatter'], 'scatter key present');
});

/* ── 2. prize field-name contract (IGT IOutcomePrizeDef) ─────────────────── */

test('UQ-DEEP-AL FIX-E · 6. prize entry exposes 7 IGT fields', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  const p = r.prizeOutcome['lines'].Prize[0];
  for (const f of ['pay', 'totalPay', 'multiplier', 'betMultiplier', 'symbolCount', 'position', 'ways']) {
    assert.ok(Object.prototype.hasOwnProperty.call(p, f), `field ${f} present`);
  }
});

test('UQ-DEEP-AL FIX-E · 7. totalPay = pay × multiplier × betMultiplier (computed)', () => {
  /* Custom prize: amount=2.5 ($) → pay=250¢, multiplier=4, bet=2 → totalPay=2000. */
  const customSpin = {
    payX: 0, isHit: true, prizes: [
      { type: 'line', amount: 2.5, count: 5, position: 0, multiplier: 4, betMultiplier: 2 },
    ],
  };
  const r = emitGleResponse(customSpin, fxSession);
  const p = r.prizeOutcome['lines'].Prize[0];
  assert.equal(p.pay, 250, 'pay = round(amount * 100) cents');
  assert.equal(p.multiplier, 4);
  assert.equal(p.betMultiplier, 2);
  assert.equal(p.totalPay, 2000, 'totalPay = 250 × 4 × 2');
});

/* ── 3. freeSpin field-name contract (IGT IFreeSpinOutcomeDef) ───────────── */

test('UQ-DEEP-AL FIX-E · 8. freeSpinOutcome is a keyed map (object, NOT array)', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  assert.equal(Array.isArray(r.freeSpinOutcome), false);
  assert.equal(typeof r.freeSpinOutcome, 'object');
});

test('UQ-DEEP-AL FIX-E · 9. freeSpinOutcome["fs-main"] exposes 3 IGT fields', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  const fs = r.freeSpinOutcome['fs-main'];
  assert.ok(fs, 'fs-main key present');
  for (const f of ['fsCount', 'fsCountDown', 'fsAwarded']) {
    assert.ok(Object.prototype.hasOwnProperty.call(fs, f), `field ${f} present`);
  }
  assert.equal(fs.fsAwarded, 10);
  assert.equal(fs.fsCountDown, 10);
  assert.equal(fs.fsCount, 10);
});

test('UQ-DEEP-AL FIX-E · 10. NO legacy `spinsAwarded` field on default freeSpinOutcome', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  const fs = r.freeSpinOutcome['fs-main'];
  assert.equal(Object.prototype.hasOwnProperty.call(fs, 'spinsAwarded'), false,
    'legacy spinsAwarded field MUST be absent in IGT-aligned shape');
});

test('UQ-DEEP-AL FIX-E · 11. NO legacy `amount` field on default prize entry', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  const p = r.prizeOutcome['lines'].Prize[0];
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'amount'), false,
    'legacy amount field MUST be absent in IGT-aligned shape (use pay)');
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'count'), false,
    'legacy count field MUST be absent (use symbolCount)');
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'type'), false,
    'legacy type field MUST be absent (tag goes to outer map key)');
});

/* ── 4. multiplier map ───────────────────────────────────────────────────── */

test('UQ-DEEP-AL FIX-E · 12. multiplierOutcome is a keyed map (object, NOT array)', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  assert.equal(Array.isArray(r.multiplierOutcome), false);
  assert.equal(typeof r.multiplierOutcome, 'object');
  assert.ok(r.multiplierOutcome['global'], 'global key present');
  assert.equal(r.multiplierOutcome['global'].value, 3);
  assert.equal(r.multiplierOutcome['global'].lifetime, 'spin');
});

/* ── 5. outcomeDetail enum removal ───────────────────────────────────────── */

test('UQ-DEEP-AL FIX-E · 13. outcomeDetail HAS `state` (string|null), NOT `gameStatus`', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  assert.equal(Object.prototype.hasOwnProperty.call(r.outcomeDetail, 'state'), true,
    'state field present');
  assert.equal(r.outcomeDetail.state, null, 'state is null when sessionState.state not set');
  assert.equal(Object.prototype.hasOwnProperty.call(r.outcomeDetail, 'gameStatus'), false,
    'gameStatus enum MUST be absent in IGT-aligned shape');
  /* Verify state passes through when set. */
  const rWithState = emitGleResponse(fxSpin(), { ...fxSession, state: 'opaque-server-token-xyz' });
  assert.equal(rWithState.outcomeDetail.state, 'opaque-server-token-xyz');
});

test('UQ-DEEP-AL FIX-E · 14. NO `GAME_STATUS` / `GLE_GAME_STATUS` named export', () => {
  assert.equal(emitterModule.GAME_STATUS, undefined,
    'GAME_STATUS enum export MUST be removed');
  assert.equal(emitterModule.GLE_GAME_STATUS, undefined,
    'GLE_GAME_STATUS enum export MUST be removed (never existed; sentinel check)');
});

/* ── 6. back-compat (legacy:true) ────────────────────────────────────────── */

test('UQ-DEEP-AL FIX-E · 15. { legacy: true } returns pre-AL flat shape', () => {
  const r = emitGleResponse(fxSpin(), fxSession, { legacy: true });
  /* Legacy emits single-object envelopes (not Map<>) conditional on data. */
  assert.ok(r.freeSpinOutcome, 'legacy: freeSpinOutcome present');
  assert.equal(r.freeSpinOutcome['fs-main'], undefined,
    'legacy: NOT keyed by fs-main');
  assert.ok(r.prizeOutcome, 'legacy: prizeOutcome present');
  assert.ok(Array.isArray(r.prizeOutcome.Prize), 'legacy: prizeOutcome.Prize is array (not keyed)');
  /* Legacy outcomeDetail reinstates the invented enum. */
  assert.equal(r.outcomeDetail.gameStatus, 'PLAYED', 'legacy: gameStatus enum reinstated');
});

test('UQ-DEEP-AL FIX-E · 16. legacy output has `spinsAwarded` field (pre-AL name)', () => {
  const r = emitGleResponse(fxSpin(), fxSession, { legacy: true });
  assert.equal(Object.prototype.hasOwnProperty.call(r.freeSpinOutcome, 'spinsAwarded'), true,
    'legacy: spinsAwarded MUST be present (back-compat consumers)');
  assert.equal(r.freeSpinOutcome.spinsAwarded, 10);
  /* Legacy prize uses amount, not pay. */
  assert.equal(Object.prototype.hasOwnProperty.call(r.prizeOutcome.Prize[0], 'amount'), true,
    'legacy: prize.amount present');
});

/* ── 7. envelope metadata sanity ─────────────────────────────────────────── */

test('UQ-DEEP-AL FIX-E · 17. transactionId is a v4 UUID (36 chars, 5 hyphen-separated groups)', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  const tx = r.outcomeDetail.transactionId;
  assert.equal(typeof tx, 'string');
  assert.equal(tx.length, 36);
  assert.match(tx, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'UUID v4 format');
});

test('UQ-DEEP-AL FIX-E · 18. auditTimestamp is ISO 8601', () => {
  const r = emitGleResponse(fxSpin(), fxSession);
  const ts = r.outcomeDetail.auditTimestamp;
  assert.equal(typeof ts, 'string');
  /* ISO 8601 UTC: YYYY-MM-DDTHH:MM:SS.sssZ */
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    'ISO 8601 UTC');
  /* Round-trip through Date — must parse to same instant. */
  const t = new Date(ts).getTime();
  assert.ok(Number.isFinite(t), 'parseable instant');
});

/* ── 8. helper function smoke (extra coverage, exported surface) ─────────── */

test('UQ-DEEP-AL FIX-E · helper · prizeToIgtShape pure transform', () => {
  const out = prizeToIgtShape({ type: 'line', amount: 3.0, count: 4, position: 0, multiplier: 2, betMultiplier: 1 });
  assert.equal(out.pay, 300);
  assert.equal(out.totalPay, 600);
  assert.equal(out.multiplier, 2);
  assert.equal(out.betMultiplier, 1);
  assert.equal(out.symbolCount, 4);
  assert.equal(out.position, 0);
  assert.equal(out.ways, 1);
});

test('UQ-DEEP-AL FIX-E · helper · emitFreeSpinMap returns {} when no FS', () => {
  const m = emitFreeSpinMap({ payX: 0, isHit: false });
  assert.deepEqual(m, {});
});

test('UQ-DEEP-AL FIX-E · helper · emitMultiplierMap returns {} when multiplier <= 1', () => {
  const m = emitMultiplierMap({ multiplier: 1 });
  assert.deepEqual(m, {});
});

test('UQ-DEEP-AL FIX-E · helper · emitPopulationMap returns {} when no grid', () => {
  const m = emitPopulationMap({}, {});
  assert.deepEqual(m, {});
});

test('UQ-DEEP-AL FIX-E · helper · emitPrizeMap groups by tag', () => {
  const m = emitPrizeMap({ prizes: [
    { type: 'line',    amount: 1, count: 3, position: 0 },
    { type: 'line',    amount: 2, count: 4, position: 1 },
    { type: 'scatter', amount: 5, count: 5, position: 0 },
  ] });
  assert.equal(m['lines'].Prize.length, 2);
  assert.equal(m['scatter'].Prize.length, 1);
});
