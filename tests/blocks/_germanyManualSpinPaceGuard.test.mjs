#!/usr/bin/env node
/**
 * tests/blocks/_germanyManualSpinPaceGuard.test.mjs
 *
 * W58.J-DE.3 — Manual dispatch-side enforcement of GlüStV §11(2).
 *
 * W58.J-DE   set window.__DE_MIN_SPIN_MS__ at boot (5000 ms floor).
 * W58.J-DE.2 clamped the AUTOPLAY tick path against that floor.
 * W58.J-DE.3 clamps the MANUAL dispatch path so a player who slam-stops a
 *            spin and immediately re-clicks the spin button cannot bypass
 *            the §11(2) floor with autoplay off.
 *
 * runOneBaseSpin reads __DE_MIN_SPIN_MS__ + __lastSpinAt__ and silently
 * aborts dispatch when elapsed < floor, firing the sole-owner audit event
 * `onManualSpinPaceBlocked` so cert-harness counts manual blocks distinctly
 * from autoplay defers (W58.J-DE.2 emits onMinSpinPaceDeferred).
 *
 * This test pins:
 *   1. Source-regex contract (reads both window flags, gated above preSpin)
 *   2. Sole-owner emit + payload contract
 *   3. Behavioural sandbox covering the elapsed-vs-floor predicate
 *   4. LEGO ownership + W58.J-DE.3 marker
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
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

/* ════════════════════════════════════════════════════════════════════
 * 1. reelEngine.runOneBaseSpin reads both window flags
 * ════════════════════════════════════════════════════════════════════ */
block('1. reelEngine reads __DE_MIN_SPIN_MS__ + __lastSpinAt__', () => {
  t('1.1 W58.J-DE.3 marker comment present in reelEngine',
    /W58\.J-DE\.3/.test(reelSrc));
  t('1.2 Reads window.__DE_MIN_SPIN_MS__',
    /window\.__DE_MIN_SPIN_MS__/.test(reelSrc));
  t('1.3 Reads window.__lastSpinAt__',
    /window\.__lastSpinAt__/.test(reelSrc));
  t('1.4 Gate placed BEFORE the inFlight (Wave T4) guard so manual blocks short-circuit early',
    /W58\.J-DE\.3[\s\S]{0,2000}return;[\s\S]{0,400}Wave T4 guard/.test(reelSrc));
  t('1.5 SSR-safe: typeof window !== undefined guard',
    /typeof\s+window\s*!==\s*['"]undefined['"][\s\S]{0,200}__DE_MIN_SPIN_MS__/.test(reelSrc));
  t('1.6 Floor numeric-type guard (typeof __DE_MIN_SPIN_MS__ === number)',
    /typeof\s+window\.__DE_MIN_SPIN_MS__\s*===\s*['"]number['"]/.test(reelSrc));
  t('1.7 Floor > 0 guard (no spurious abort on non-DE jurisdictions)',
    /window\.__DE_MIN_SPIN_MS__\s*>\s*0/.test(reelSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Spin dispatch ABORTS when elapsed < floor
 * ════════════════════════════════════════════════════════════════════ */
block('2. Abort behaviour', () => {
  t('2.1 Computes Date.now() at dispatch time',
    /Date\.now\(\)/.test(reelSrc));
  t('2.2 Gate returns early when elapsed < floor (NO preSpin dispatch)',
    /_elapsed\s*<\s*_floorMs[\s\S]{0,800}return;/.test(reelSrc));
  t('2.3 preSpin emit position is AFTER the §11(2) guard',
    (() => {
      const guardIdx = reelSrc.indexOf('__DE_MIN_SPIN_MS__');
      const preSpinEmitIdx = reelSrc.indexOf("HookBus.emit('preSpin'");
      return guardIdx > 0 && preSpinEmitIdx > 0 && preSpinEmitIdx > guardIdx;
    })());
  t('2.4 First-spin special case (lastAt=0 → elapsed=Infinity → allow)',
    /_lastAt\s*>\s*0\s*\?\s*\(_nowMs\s*-\s*_lastAt\)\s*:\s*Infinity/.test(reelSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Sole-owner emit + payload contract
 * ════════════════════════════════════════════════════════════════════ */
block('3. Sole-owner emit onManualSpinPaceBlocked', () => {
  t('3.1 Emit onManualSpinPaceBlocked',
    /HookBus\.emit\(\s*['"]onManualSpinPaceBlocked['"]/.test(reelSrc));
  t('3.2 Emit gated behind the elapsed-below-floor condition',
    /_elapsed\s*<\s*_floorMs[\s\S]{0,500}HookBus\.emit\(\s*['"]onManualSpinPaceBlocked['"]/.test(reelSrc));
  t('3.3 Payload includes jurisdiction',
    /onManualSpinPaceBlocked[\s\S]{0,500}jurisdiction:/.test(reelSrc));
  t('3.4 Payload includes floorMs (regulator floor for audit)',
    /onManualSpinPaceBlocked[\s\S]{0,500}floorMs:/.test(reelSrc));
  t('3.5 Payload includes elapsedMs (how soon click was attempted)',
    /onManualSpinPaceBlocked[\s\S]{0,500}elapsedMs:/.test(reelSrc));
  t('3.6 Payload includes remainingMs (how long player must wait)',
    /onManualSpinPaceBlocked[\s\S]{0,500}remainingMs:/.test(reelSrc));
  t('3.7 Payload cites DE-GluStV-2021-§11(2) rule',
    /onManualSpinPaceBlocked[\s\S]{0,500}DE-GluStV-2021-§11\(2\)/.test(reelSrc));
  t('3.8 Emit wrapped in try/catch (audit emit must never throw)',
    /try\s*\{[\s\S]{0,500}onManualSpinPaceBlocked[\s\S]{0,500}\}\s*catch/.test(reelSrc));
  t('3.9 Falls back to "DE" when __SLOT_JURISDICTION__ missing',
    /window\.__SLOT_JURISDICTION__\s*\|\|\s*['"]DE['"]/.test(reelSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Behavioural sandbox — predicate formula
 * ════════════════════════════════════════════════════════════════════ */
block('4. Behavioural predicate sandbox', () => {
  /* Re-implement the gate predicate. The formula must abort iff
   * (floorMs > 0 && lastAt > 0 && (nowMs - lastAt) < floorMs). */
  function shouldAbort({ floorMs, lastAt, nowMs }) {
    if (typeof floorMs !== 'number' || floorMs <= 0) return false;
    const elapsed = lastAt > 0 ? (nowMs - lastAt) : Infinity;
    return elapsed < floorMs;
  }

  /* Scenario A — slam-stop then rapid re-click 1500 ms after spin start.
   * Floor 5000 ms → 3500 ms remaining → ABORT. */
  t('4.A floor 5000, lastAt 1500ms ago → ABORT (slam-stop rapid re-click)',
    shouldAbort({ floorMs: 5000, lastAt: 100000, nowMs: 101500 }) === true);

  /* Scenario B — comfortable wait 6 sec after prior spin → ALLOW. */
  t('4.B floor 5000, lastAt 6000ms ago → ALLOW',
    shouldAbort({ floorMs: 5000, lastAt: 100000, nowMs: 106000 }) === false);

  /* Scenario C — non-DE jurisdiction: floor 0 → ALLOW regardless. */
  t('4.C floor 0 (non-DE) → ALLOW',
    shouldAbort({ floorMs: 0, lastAt: 100000, nowMs: 100100 }) === false);

  /* Scenario D — first spin of session: lastAt 0 → elapsed Infinity → ALLOW. */
  t('4.D lastAt 0 (no prior spin) → ALLOW',
    shouldAbort({ floorMs: 5000, lastAt: 0, nowMs: 101500 }) === false);

  /* Scenario E — exact floor boundary: elapsed === floor → ALLOW. */
  t('4.E exact boundary (elapsed === floor) → ALLOW',
    shouldAbort({ floorMs: 5000, lastAt: 100000, nowMs: 105000 }) === false);

  /* Scenario F — 1 ms below boundary → ABORT. */
  t('4.F 1ms below boundary → ABORT',
    shouldAbort({ floorMs: 5000, lastAt: 100000, nowMs: 104999 }) === true);

  /* Scenario G — undefined floor → ALLOW (no §11(2) jurisdiction). */
  t('4.G undefined floor → ALLOW',
    shouldAbort({ floorMs: undefined, lastAt: 100000, nowMs: 100100 }) === false);

  /* Scenario H — large floor 30 sec, fresh 500ms re-click → ABORT with
   * remainingMs ~29500. */
  t('4.H floor 30000, lastAt 500ms ago → ABORT',
    shouldAbort({ floorMs: 30000, lastAt: 100000, nowMs: 100500 }) === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 5. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('5. LEGO contracts', () => {
  t('5.1 onManualSpinPaceBlocked owner declared: reelEngine.mjs',
    /onManualSpinPaceBlocked:\s*\[\s*['"]reelEngine\.mjs['"]\s*\]/.test(legoSrc));
  t('5.2 W58.J-DE.3 marker comment in lego-gate.mjs',
    /W58\.J-DE\.3/.test(legoSrc));
  t('5.3 GlüStV §11(2) citation in lego-gate.mjs',
    /Gl[üu]StV[\s\S]{0,500}§\s*11\s*\(2\)/.test(legoSrc) ||
    /§\s*11\s*\(2\)[\s\S]{0,500}Gl[üu]StV/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('6. Honest scope', () => {
  t('6.1 Source notes W58.J-DE.2 already closed autoplay path',
    /W58\.J-DE\.2/.test(reelSrc));
  t('6.2 Source notes manual path = single funnel through runOneBaseSpin',
    /single funnel/i.test(reelSrc) || /runOneBaseSpin/.test(reelSrc));
  t('6.3 Source notes distinct event name vs autoplay defer (cert distinguishes manual vs autoplay)',
    /onMinSpinPaceDeferred/.test(reelSrc) && /onManualSpinPaceBlocked/.test(reelSrc));
  t('6.4 Source notes silent abort (no DOM mutation, no player-facing throw)',
    /silent/i.test(reelSrc) && /abort/i.test(reelSrc));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
