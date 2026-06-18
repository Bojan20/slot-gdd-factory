/**
 * tests/blocks/_engineSpinResultEmit.test.mjs
 *
 * 2026-06-18 WASH PASS — Lifecycle integrity gate.
 *
 * Background
 * ──────────
 *   Pre-WASH PASS the 5 topology-specific spin engines (crash, plinko,
 *   hex, slingo, wheel) declared in their JSDoc / comments that
 *   "onSpinResult is emitted by the dispatcher (reelEngine)". This was
 *   a LIE — at runtime each engine is dispatched via
 *   `window.__SLOT_KIND_RUNSPIN__.<kind>` for its own topology, NOT
 *   through reelEngine. Result: 40+ downstream listeners
 *   (multiplierOrb, mysterySymbolMultiplier, wildCollisionMultiplier,
 *   stickyWild, etc.) NEVER FIRED on these topologies — silent broken
 *   lifecycle.
 *
 *   This test pins each engine source to actually emit `onSpinResult`
 *   in its settle path. Regression: if a future edit removes the emit,
 *   this test fails BEFORE lifecycle silently breaks again.
 */
import { test as t } from 'node:test';
import { ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO  = resolve(new URL('../..', import.meta.url).pathname);
const ENGINES = [
  { name: 'crashSpinEngine',  topology: 'crash'  },
  { name: 'plinkoSpinEngine', topology: 'plinko' },
  { name: 'hexReelEngine',    topology: 'hex'    },
  { name: 'slingoSpinEngine', topology: 'slingo' },
  { name: 'wheelSpinEngine',  topology: 'wheel'  },
];

for (const e of ENGINES) {
  t(`${e.name}: emits HookBus.emit('onSpinResult', ...) in settle path`, () => {
    const src = readFileSync(`${REPO}/src/blocks/${e.name}.mjs`, 'utf8');
    /* Must contain the literal canonical emit invocation. */
    ok(/HookBus\.emit\('onSpinResult'/.test(src), `${e.name} must emit onSpinResult`);
  });

  t(`${e.name}: emit payload carries duringFs flag`, () => {
    const src = readFileSync(`${REPO}/src/blocks/${e.name}.mjs`, 'utf8');
    /* Defensive: payload must include duringFs derived from FSM phase
     * so FS-aware listeners (winMultiplierBadge, perFsSpinMultiplier,
     * etc.) can branch on FS vs base game without re-checking globals. */
    ok(/duringFs/.test(src), `${e.name} must include duringFs in payload`);
  });

  t(`${e.name}: emit is guarded by try/catch (idempotent + safe)`, () => {
    const src = readFileSync(`${REPO}/src/blocks/${e.name}.mjs`, 'utf8');
    /* Anchor the regex around the emit so we know the try/catch is
     * specifically wrapping the canonical emit path, not some unrelated
     * defensive block. */
    const emitIdx = src.indexOf("HookBus.emit('onSpinResult'");
    ok(emitIdx > 0, `${e.name}: onSpinResult emit not found`);
    /* Look backwards for the nearest `try {` within 400 chars. */
    const back = src.slice(Math.max(0, emitIdx - 400), emitIdx);
    ok(/try\s*\{/.test(back), `${e.name}: emit not wrapped in try/catch`);
  });

  t(`${e.name}: WASH PASS comment is present (regression breadcrumb)`, () => {
    const src = readFileSync(`${REPO}/src/blocks/${e.name}.mjs`, 'utf8');
    ok(/WASH PASS fix/i.test(src), `${e.name}: missing WASH PASS regression breadcrumb`);
  });
}

t('lego-gate.mjs ownership lists all 5 engines + reelEngine as owners', () => {
  const src = readFileSync(`${REPO}/tools/lego-gate.mjs`, 'utf8');
  /* All 6 owners must appear in the onSpinResult ownership row. */
  const rowMatch = src.match(/onSpinResult:\s*\[[^\]]+\]/);
  ok(rowMatch, 'onSpinResult row missing in lego-gate ownership table');
  const row = rowMatch[0];
  for (const owner of ['reelEngine.mjs', 'crashSpinEngine.mjs', 'plinkoSpinEngine.mjs',
                       'hexReelEngine.mjs', 'slingoSpinEngine.mjs', 'wheelSpinEngine.mjs']) {
    ok(row.includes(owner), `${owner} missing from onSpinResult ownership`);
  }
});
