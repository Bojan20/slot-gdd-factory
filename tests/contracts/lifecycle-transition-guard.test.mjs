/**
 * UQ-DEEP-AL · FIX-F · lifecycle state machine transition matrix guard test
 *
 * Boki: 3 paralelna senior auditora (QA-3) otkrili da computeNextStage()
 * u tools/gle-response-emitter.mjs nema transition matrix guard. Mogu
 * ilegalne transicije (e.g. LOCK_AND_RESPIN → FREE_SPIN bez prelaza preko
 * BASE_GAME) proći nedetektovane.
 *
 * Ovaj test verifikuje:
 *   1. LEGAL_TRANSITIONS matrix je frozen + ima tačne destinacije
 *   2. isLegalTransition pravilno klasifikuje legal/illegal/unknown
 *   3. assertLegalTransition baca TransitionError sa code='ILLEGAL_TRANSITION'
 *   4. computeNextStage integration: strict mode throws, default mode
 *      warns + fallback na BASE_GAME
 *
 * 20 cases · target 20/20 PASS.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGAL_TRANSITIONS,
  TransitionError,
  isLegalTransition,
  assertLegalTransition,
  emitOutcomeDetail,
  STAGE,
} from '../../tools/gle-response-emitter.mjs';

/* ── LEGAL_TRANSITIONS constant ──────────────────────────────────────────── */

test('UQ-DEEP-AL #1 · LEGAL_TRANSITIONS is frozen (immutable)', () => {
  assert.equal(Object.isFrozen(LEGAL_TRANSITIONS), true,
    'LEGAL_TRANSITIONS must be Object.frozen — regulator contract is immutable');
});

test('UQ-DEEP-AL #2 · BASE_GAME has 6 legal destinations', () => {
  const dest = LEGAL_TRANSITIONS.BASE_GAME;
  assert.equal(dest.length, 6, 'BASE_GAME → 6 stages');
  for (const t of ['BASE_GAME', 'FREE_SPIN', 'LOCK_AND_RESPIN', 'JACKPOT', 'PICK_BONUS', 'END_GAME']) {
    assert.ok(dest.includes(t), `BASE_GAME must allow → ${t}`);
  }
});

test('UQ-DEEP-AL #3 · FREE_SPIN has 5 legal destinations', () => {
  const dest = LEGAL_TRANSITIONS.FREE_SPIN;
  assert.equal(dest.length, 5, 'FREE_SPIN → 5 stages');
  for (const t of ['FREE_SPIN', 'LOCK_AND_RESPIN', 'JACKPOT', 'BASE_GAME', 'END_GAME']) {
    assert.ok(dest.includes(t), `FREE_SPIN must allow → ${t}`);
  }
  /* PICK_BONUS not legal from FREE_SPIN. */
  assert.ok(!dest.includes('PICK_BONUS'), 'FREE_SPIN → PICK_BONUS is ILLEGAL');
});

test('UQ-DEEP-AL #4 · LOCK_AND_RESPIN has 4 legal destinations', () => {
  const dest = LEGAL_TRANSITIONS.LOCK_AND_RESPIN;
  assert.equal(dest.length, 4, 'LOCK_AND_RESPIN → 4 stages');
  for (const t of ['LOCK_AND_RESPIN', 'JACKPOT', 'BASE_GAME', 'END_GAME']) {
    assert.ok(dest.includes(t), `LOCK_AND_RESPIN must allow → ${t}`);
  }
  /* Cannot go directly to FS or PICK_BONUS. */
  assert.ok(!dest.includes('FREE_SPIN'), 'LOCK_AND_RESPIN → FREE_SPIN is ILLEGAL');
  assert.ok(!dest.includes('PICK_BONUS'), 'LOCK_AND_RESPIN → PICK_BONUS is ILLEGAL');
});

test('UQ-DEEP-AL #5 · JACKPOT has 2 legal destinations', () => {
  const dest = LEGAL_TRANSITIONS.JACKPOT;
  assert.equal(dest.length, 2, 'JACKPOT → 2 stages');
  for (const t of ['BASE_GAME', 'END_GAME']) {
    assert.ok(dest.includes(t), `JACKPOT must allow → ${t}`);
  }
  /* Jackpot must terminate to base; cannot chain directly into FS / HnW / pick. */
  assert.ok(!dest.includes('FREE_SPIN'), 'JACKPOT → FREE_SPIN is ILLEGAL');
});

test('UQ-DEEP-AL #6 · PICK_BONUS has 3 legal destinations', () => {
  const dest = LEGAL_TRANSITIONS.PICK_BONUS;
  assert.equal(dest.length, 3, 'PICK_BONUS → 3 stages');
  for (const t of ['BASE_GAME', 'FREE_SPIN', 'END_GAME']) {
    assert.ok(dest.includes(t), `PICK_BONUS must allow → ${t}`);
  }
  /* Cannot chain pick bonus directly into HnW. */
  assert.ok(!dest.includes('LOCK_AND_RESPIN'), 'PICK_BONUS → LOCK_AND_RESPIN is ILLEGAL');
});

test('UQ-DEEP-AL #7 · END_GAME has 1 legal destination', () => {
  const dest = LEGAL_TRANSITIONS.END_GAME;
  assert.equal(dest.length, 1, 'END_GAME → 1 stage');
  assert.ok(dest.includes('BASE_GAME'), 'END_GAME → BASE_GAME (new game restart)');
});

/* ── isLegalTransition ───────────────────────────────────────────────────── */

test('UQ-DEEP-AL #8 · BASE_GAME → FREE_SPIN is LEGAL', () => {
  assert.equal(isLegalTransition('BASE_GAME', 'FREE_SPIN'), true);
});

test('UQ-DEEP-AL #9 · BASE_GAME → LOCK_AND_RESPIN is LEGAL', () => {
  assert.equal(isLegalTransition('BASE_GAME', 'LOCK_AND_RESPIN'), true);
});

test('UQ-DEEP-AL #10 · LOCK_AND_RESPIN → FREE_SPIN is ILLEGAL (must go through BASE_GAME)', () => {
  assert.equal(isLegalTransition('LOCK_AND_RESPIN', 'FREE_SPIN'), false,
    'HnW → FS direct transition would skip session settlement — forbidden');
});

test('UQ-DEEP-AL #11 · JACKPOT → FREE_SPIN is ILLEGAL', () => {
  assert.equal(isLegalTransition('JACKPOT', 'FREE_SPIN'), false,
    'Jackpot must terminate to BASE_GAME first (final award settlement)');
});

test('UQ-DEEP-AL #12 · PICK_BONUS → LOCK_AND_RESPIN is ILLEGAL', () => {
  assert.equal(isLegalTransition('PICK_BONUS', 'LOCK_AND_RESPIN'), false,
    'Pick bonus must complete before HnW can trigger');
});

test('UQ-DEEP-AL #13 · END_GAME → BASE_GAME is LEGAL (game restart)', () => {
  assert.equal(isLegalTransition('END_GAME', 'BASE_GAME'), true);
});

test('UQ-DEEP-AL #14 · undefined → BASE_GAME is LEGAL (initial cold-start state)', () => {
  assert.equal(isLegalTransition(undefined, 'BASE_GAME'), true,
    'Cold-start has no prior state — all transitions are valid as initial');
});

test('UQ-DEEP-AL #15 · UNKNOWN_STAGE → BASE_GAME is ILLEGAL (unknown from)', () => {
  assert.equal(isLegalTransition('UNKNOWN_STAGE', 'BASE_GAME'), false);
});

test('UQ-DEEP-AL #16 · BASE_GAME → UNKNOWN is ILLEGAL (unknown to)', () => {
  assert.equal(isLegalTransition('BASE_GAME', 'UNKNOWN'), false);
});

/* ── assertLegalTransition ───────────────────────────────────────────────── */

test('UQ-DEEP-AL #17 · assertLegalTransition does NOT throw on legal transition', () => {
  assert.doesNotThrow(() => assertLegalTransition('BASE_GAME', 'FREE_SPIN'));
});

test('UQ-DEEP-AL #18 · assertLegalTransition THROWS TransitionError on illegal transition', () => {
  let caught;
  try {
    assertLegalTransition('LOCK_AND_RESPIN', 'FREE_SPIN');
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'must throw');
  assert.ok(caught instanceof TransitionError, 'must be TransitionError instance');
  assert.equal(caught.code, 'ILLEGAL_TRANSITION', 'error code must be ILLEGAL_TRANSITION');
});

test('UQ-DEEP-AL #19 · TransitionError instance has from/to/code fields', () => {
  const err = new TransitionError('JACKPOT', 'FREE_SPIN');
  assert.equal(err.from, 'JACKPOT', 'from field set');
  assert.equal(err.to, 'FREE_SPIN', 'to field set');
  assert.equal(err.code, 'ILLEGAL_TRANSITION', 'code field set');
  assert.ok(err instanceof Error, 'extends Error');
  assert.equal(err.name, 'TransitionError', 'error name');
});

/* ── computeNextStage integration via emitOutcomeDetail ─────────────────── */

test('UQ-DEEP-AL #20 · computeNextStage: GLE_STRICT_TRANSITIONS throws on illegal; default mode warns + fallback', () => {
  /* Force an illegal candidate transition: currentStage = JACKPOT, but
   * spinResult.fsTrigger=true would push computeNextStage toward FREE_SPIN.
   * JACKPOT → FREE_SPIN is NOT in LEGAL_TRANSITIONS, so the guard fires.
   *
   * Note: STAGE.JACKPOT value is 'Jackpot' (camelCase). The guard reverse-maps
   * via stageKey() to recognize it as the JACKPOT enum key.
   */
  const prevStrict = process.env.GLE_STRICT_TRANSITIONS;

  /* Strict mode → throws via TransitionError. */
  process.env.GLE_STRICT_TRANSITIONS = 'true';
  let strictThrown;
  try {
    emitOutcomeDetail({ fsTrigger: true }, { stage: STAGE.JACKPOT });
  } catch (e) {
    strictThrown = e;
  }
  /* Restore env before further asserts (test isolation). */
  if (prevStrict === undefined) delete process.env.GLE_STRICT_TRANSITIONS;
  else process.env.GLE_STRICT_TRANSITIONS = prevStrict;

  assert.ok(strictThrown, 'strict mode must throw on illegal transition');
  assert.equal(strictThrown.code, 'ILLEGAL_TRANSITION',
    'strict mode throws TransitionError with ILLEGAL_TRANSITION code');

  /* Default mode → warn + safe fallback to BASE_GAME. */
  delete process.env.GLE_STRICT_TRANSITIONS;
  const origWarn = console.warn;
  let warnedMsg = '';
  console.warn = (msg) => { warnedMsg = String(msg); };
  let softResult;
  try {
    softResult = emitOutcomeDetail({ fsTrigger: true }, { stage: STAGE.JACKPOT });
  } finally {
    console.warn = origWarn;
    if (prevStrict !== undefined) process.env.GLE_STRICT_TRANSITIONS = prevStrict;
  }
  assert.ok(warnedMsg.includes('Illegal transition'),
    `expected console.warn("Illegal transition ..."), got: ${warnedMsg}`);
  assert.equal(softResult.nextStage, STAGE.BASE_GAME,
    'default mode falls back to BASE_GAME on illegal transition');
});
