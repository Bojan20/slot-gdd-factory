#!/usr/bin/env node
/**
 * tests/blocks/_germanyMinSpinPaceEnforcement.test.mjs
 *
 * W58.J-DE.2 — Downstream enforcement of GlüStV §11(2) spin-pace floor.
 *
 * The gate (germanyComplianceGate.mjs) sets `window.__DE_MIN_SPIN_MS__ = 5000`
 * at boot when jurisdiction === 'DE'. Downstream consumers MUST respect
 * the floor:
 *
 *   • reelEngine writes `window.__lastSpinAt__ = Date.now()` on each spin
 *     trigger so the gate has a reference point.
 *   • autoplay._scheduleNextSpin reads both flags and clamps its
 *     setTimeout delay to `max(rawDelay, floor - (now - lastAt))`.
 *     When the floor extends the delay beyond what autoplay asked for,
 *     a sole-owner `onMinSpinPaceDeferred` audit event fires.
 *
 * This test pins each contract via source-regex inspection so a future
 * refactor can't silently break GlüStV compliance.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const reelSrc = readFileSync(resolve(here, '../../src/blocks/reelEngine.mjs'), 'utf8');
const autoSrc = readFileSync(resolve(here, '../../src/blocks/autoplay.mjs'), 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

/* ════════════════════════════════════════════════════════════════════
 * 1. reelEngine.mjs writes the timestamp
 * ════════════════════════════════════════════════════════════════════ */
block('1. reelEngine writes window.__lastSpinAt__', () => {
  t('1.1 W58.J-DE.2 marker comment present in reelEngine',
    /W58\.J-DE\.2/.test(reelSrc));
  t('1.2 window.__lastSpinAt__ = Date.now() set on spin trigger',
    /window\.__lastSpinAt__\s*=\s*Date\.now\(\)/.test(reelSrc));
  t('1.3 SSR-safe (typeof window === undefined guard)',
    /typeof\s+window\s*!==\s*['"]undefined['"][\s\S]{0,80}window\.__lastSpinAt__/.test(reelSrc));
  t('1.4 Uses Date.now (NOT performance.now) for audit-trail comparability',
    /window\.__lastSpinAt__\s*=\s*Date\.now\(\)/.test(reelSrc) &&
    !(/window\.__lastSpinAt__\s*=\s*performance\.now\(\)/.test(reelSrc)));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. autoplay.mjs clamps the schedule
 * ════════════════════════════════════════════════════════════════════ */
block('2. autoplay clamps _scheduleNextSpin', () => {
  t('2.1 W58.J-DE.2 marker comment present in autoplay',
    /W58\.J-DE\.2/.test(autoSrc));
  t('2.2 Reads window.__DE_MIN_SPIN_MS__ as the floor',
    /window\.__DE_MIN_SPIN_MS__/.test(autoSrc));
  t('2.3 Reads window.__lastSpinAt__ as the reference timestamp',
    /window\.__lastSpinAt__/.test(autoSrc));
  t('2.4 Computes floorRemaining = max(0, (lastAt + floor) - Date.now())',
    /floorRemaining\s*=\s*Math\.max\(\s*0\s*,\s*\(\s*lastAt\s*\+\s*floor\s*\)\s*-\s*Date\.now\(\)\s*\)/.test(autoSrc));
  t('2.5 finalDelay = max(rawDelay, floorRemaining)',
    /finalDelay\s*=\s*Math\.max\(\s*rawDelay\s*,\s*floorRemaining\s*\)/.test(autoSrc));
  t('2.6 setTimeout uses finalDelay (NOT rawDelay)',
    /setTimeout\([\s\S]{0,600}finalDelay\s*\)/.test(autoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. autoplay.mjs emits onMinSpinPaceDeferred when floor extends
 * ════════════════════════════════════════════════════════════════════ */
block('3. autoplay sole-owner emit', () => {
  t('3.1 Emit onMinSpinPaceDeferred (sole-owner)',
    /HookBus\.emit\(\s*['"]onMinSpinPaceDeferred['"]/.test(autoSrc));
  t('3.2 Emit gated behind (floorRemaining > rawDelay) condition',
    /if\s*\(\s*floorRemaining\s*>\s*rawDelay[\s\S]{0,500}HookBus\.emit\(\s*['"]onMinSpinPaceDeferred['"]/.test(autoSrc));
  t('3.3 Payload includes requestedMs',     /onMinSpinPaceDeferred[\s\S]{0,300}requestedMs:/.test(autoSrc));
  t('3.4 Payload includes deferredMs',      /onMinSpinPaceDeferred[\s\S]{0,300}deferredMs:/.test(autoSrc));
  t('3.5 Payload includes floorMs',         /onMinSpinPaceDeferred[\s\S]{0,300}floorMs:/.test(autoSrc));
  t('3.6 Payload includes DE rule citation',/onMinSpinPaceDeferred[\s\S]{0,400}DE-GluStV-2021-§11\(2\)/.test(autoSrc));
  t('3.7 Emit wrapped in try/catch',        /try\s*\{[\s\S]{0,500}onMinSpinPaceDeferred[\s\S]{0,500}\}\s*catch/.test(autoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Behavioural sandbox — verify the clamp formula
 * ════════════════════════════════════════════════════════════════════ */
block('4. Behavioural clamp sandbox', () => {
  /* Re-implement the formula and prove the floor wins when remaining
   * floor exceeds the requested delay. */
  function clampFinalDelay(rawDelay, lastAt, floor, nowMs) {
    var floorRemaining = (floor > 0 && lastAt > 0)
      ? Math.max(0, (lastAt + floor) - nowMs) : 0;
    return Math.max(rawDelay, floorRemaining);
  }

  /* Scenario A: floor 5000ms, last spin 1500ms ago, autoplay wants 200ms
     → should defer 3500ms */
  t('4.A floor 5000 + lastAt 1500ms ago + autoplay 200ms → final 3500',
    clampFinalDelay(200, 100000, 5000, 101500) === 3500);

  /* Scenario B: floor 5000, last spin 6000ms ago, autoplay 200ms
     → no defer, return 200 */
  t('4.B floor 5000 + lastAt 6000ms ago → final == raw 200',
    clampFinalDelay(200, 100000, 5000, 106000) === 200);

  /* Scenario C: floor 5000, autoplay wants 10000 (longer than floor)
     → no defer, return 10000 */
  t('4.C autoplay > floor → final == autoplay 10000',
    clampFinalDelay(10000, 100000, 5000, 101500) === 10000);

  /* Scenario D: floor 0 (jurisdiction not DE) → no clamp */
  t('4.D floor 0 → final == raw',
    clampFinalDelay(200, 100000, 0, 101500) === 200);

  /* Scenario E: lastAt 0 (no spin yet) → no clamp */
  t('4.E lastAt 0 → final == raw',
    clampFinalDelay(200, 0, 5000, 101500) === 200);
});

/* ════════════════════════════════════════════════════════════════════
 * 5. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('5. LEGO contracts', () => {
  t('5.1 onMinSpinPaceDeferred owner declared: autoplay.mjs',
    /onMinSpinPaceDeferred:\s*\[\s*['"]autoplay\.mjs['"]\s*\]/.test(legoSrc));
  t('5.2 W58.J-DE.2 marker comment in lego-gate.mjs',
    /W58\.J-DE\.2/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('6. Honest scope', () => {
  t('6.1 reelEngine cites W58.J-DE.2 in JSDoc-style comment',
    /W58\.J-DE\.2[\s\S]{0,200}autoplay/.test(reelSrc));
  t('6.2 autoplay cites the GlüStV rule by section reference',
    /§\s*11\s*\(2\)/.test(autoSrc) || /GluStV-2021-§11\(2\)/.test(autoSrc));
  t('6.3 Source documents tracker as Date.now (not performance.now) by design',
    /Date\.now\(\)\s*\(not\s*performance\.now\(\)\)/.test(reelSrc) ||
    /Date\.now[\s\S]{0,100}audit-trail/.test(reelSrc));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
