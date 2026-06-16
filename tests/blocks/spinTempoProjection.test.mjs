#!/usr/bin/env node
/**
 * tests/blocks/spinTempoProjection.test.mjs
 *
 * Wave 2 — `projectSpinProfile(kind, profile)` unit test.
 *
 * Single canonical tempo source for 6 engines. Asserts the projector
 * produces consistent engine-shaped fields and is pure.
 */

import { projectSpinProfile, resolveConfig } from '../../src/blocks/spinTempo.mjs';

const WOO = resolveConfig({});                       /* default = woo */
const CLASSIC = resolveConfig({ spinTempo: { preset: 'classic' } });
const FAST = resolveConfig({ spinTempo: { preset: 'fast' } });

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— projectSpinProfile —');

/* 1. Pure-function contract */
const a = projectSpinProfile('hex', WOO);
const b = projectSpinProfile('hex', WOO);
t('pure: same inputs → same output (hex)', JSON.stringify(a) === JSON.stringify(b));

const c = projectSpinProfile('plinko', WOO);
const d = projectSpinProfile('plinko', WOO);
t('pure: same inputs → same output (plinko)', JSON.stringify(c) === JSON.stringify(d));

/* 2. Rectangular identity — no projection */
const rect = projectSpinProfile('rectangular', WOO);
t('rectangular returns canonical fields verbatim',
  rect.steadyMs === WOO.steadyMs &&
  rect.staggerMs === WOO.staggerMs &&
  rect.accelMs === WOO.accelMs);

const rectAlias = projectSpinProfile('rect', WOO);
t('"rect" alias = "rectangular"', rectAlias.steadyMs === WOO.steadyMs);

/* 3. Hex projection */
const hex = projectSpinProfile('hex', WOO);
const fullCycleWoo = WOO.windupMs + WOO.accelMs + WOO.steadyMs + WOO.decelMs;
t('hex.spinDurationMs = full cycle of woo profile',
  hex.spinDurationMs === fullCycleWoo,
  `${hex.spinDurationMs} vs ${fullCycleWoo}`);
t('hex.staggerMs inherits canonical staggerMs',
  hex.staggerMs === WOO.staggerMs);

/* 4. Wheel projection — full cycle plus half decel overshoot */
const wheel = projectSpinProfile('wheel', WOO);
const expectedWheel = fullCycleWoo + (WOO.decelMs >> 1);
t('wheel.spinDurationMs = full cycle + half-decel overshoot',
  wheel.spinDurationMs === expectedWheel,
  `${wheel.spinDurationMs} vs ${expectedWheel}`);

/* 5. Crash projection — full cycle */
const crash = projectSpinProfile('crash', WOO);
t('crash.spinDurationMs = full cycle', crash.spinDurationMs === fullCycleWoo);

/* 6. Plinko — staggerMs clamped to [40, 500] */
const plinko = projectSpinProfile('plinko', WOO);
t('plinko.rowStepMs = staggerMs (woo=180, within bounds)',
  plinko.rowStepMs === WOO.staggerMs);

const plinkoSlow = projectSpinProfile('plinko', { ...WOO, staggerMs: 30 });
t('plinko.rowStepMs clamped to 40 (slow)',
  plinkoSlow.rowStepMs === 40);

const plinkoFast = projectSpinProfile('plinko', { ...WOO, staggerMs: 800 });
t('plinko.rowStepMs clamped to 500 (fast)',
  plinkoFast.rowStepMs === 500);

/* 7. Slingo */
const slingo = projectSpinProfile('slingo', WOO);
t('slingo.perColumnSpinMs = full cycle',
  slingo.perColumnSpinMs === fullCycleWoo);
t('slingo.staggerMs inherits canonical staggerMs',
  slingo.staggerMs === WOO.staggerMs);

/* 8. Preset switch propagates across engines */
const hexClassic = projectSpinProfile('hex', CLASSIC);
const hexWoo = projectSpinProfile('hex', WOO);
t('preset switch (classic→woo) shortens hex spinDurationMs',
  hexClassic.spinDurationMs > hexWoo.spinDurationMs,
  `classic=${hexClassic.spinDurationMs}, woo=${hexWoo.spinDurationMs}`);

const wheelFast = projectSpinProfile('wheel', FAST);
const wheelWoo = projectSpinProfile('wheel', WOO);
t('preset switch (woo→fast) shortens wheel spinDurationMs',
  wheelFast.spinDurationMs < wheelWoo.spinDurationMs);

/* 9. Unknown kind → safe fallback */
const unknown = projectSpinProfile('does-not-exist', WOO);
t('unknown kind → identity fallback',
  unknown.steadyMs === WOO.steadyMs);

/* 10. Defensive null inputs */
const nullKind = projectSpinProfile(null, WOO);
t('null kind → identity fallback',
  nullKind.steadyMs === WOO.steadyMs);

const noProfile = projectSpinProfile('hex');
t('no profile → uses DEFAULTS internally',
  typeof noProfile.spinDurationMs === 'number' && noProfile.spinDurationMs > 0);

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
