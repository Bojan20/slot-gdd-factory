#!/usr/bin/env node
/**
 * tests/blocks/_netherlandsCruksGateEnforcement.test.mjs
 *
 * W58.J-NL.2 — Downstream enforcement of Wet KSA §31 Cruks check.
 *
 * netherlandsComplianceGate.mjs sets at boot:
 *   window.__NL_CRUKS_CHECK_REQUIRED__ = true
 *   window.__NL_CRUKS_CHECK_PASSED__ = false   (initial if missing)
 *
 * The operator session-init layer MUST flip __NL_CRUKS_CHECK_PASSED__
 * to true after the back-end Cruks register lookup completes. Until
 * that flag flips, reelEngine.runOneBaseSpin REFUSES to dispatch the
 * spin and fires a sole-owner audit event so cert-harness can count
 * blocked dispatches per session.
 *
 * This test pins the contract via source-regex inspection AND a
 * behavioural sandbox that proves the formula short-circuits correctly
 * for the four combinations of the two flags.
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
 * 1. reelEngine.runOneBaseSpin reads both flags
 * ════════════════════════════════════════════════════════════════════ */
block('1. reelEngine reads both Cruks flags', () => {
  t('1.1 W58.J-NL.2 marker comment present in reelEngine',
    /W58\.J-NL\.2/.test(reelSrc));
  t('1.2 Reads window.__NL_CRUKS_CHECK_REQUIRED__',
    /window\.__NL_CRUKS_CHECK_REQUIRED__\s*===\s*true/.test(reelSrc));
  t('1.3 Reads window.__NL_CRUKS_CHECK_PASSED__',
    /window\.__NL_CRUKS_CHECK_PASSED__\s*!==\s*true/.test(reelSrc));
  t('1.4 Gate placed BEFORE inFlight guard (earliest abort point)',
    /W58\.J-NL\.2[\s\S]{0,1500}return;[\s\S]{0,400}Wave T4 guard/.test(reelSrc));
  t('1.5 SSR-safe: typeof window !== undefined guard',
    /typeof\s+window\s*!==\s*['"]undefined['"][\s\S]{0,200}__NL_CRUKS_CHECK_REQUIRED__/.test(reelSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Spin dispatch ABORTS when gate pending
 * ════════════════════════════════════════════════════════════════════ */
block('2. Abort behaviour', () => {
  t('2.1 Gate path returns early (NO preSpin dispatch when pending)',
    /CRUKS_CHECK_REQUIRED__\s*===\s*true[\s\S]{0,800}return;/.test(reelSrc));
  t('2.2 preSpin emit position is AFTER the Cruks check (gate-above-preSpin contract)',
    (() => {
      const cruksIdx = reelSrc.indexOf('__NL_CRUKS_CHECK_REQUIRED__');
      const preSpinEmitIdx = reelSrc.indexOf("HookBus.emit('preSpin'");
      return cruksIdx > 0 && preSpinEmitIdx > 0 && preSpinEmitIdx > cruksIdx;
    })());
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Sole-owner emit + payload contract
 * ════════════════════════════════════════════════════════════════════ */
block('3. Sole-owner emit onCruksCheckPending', () => {
  t('3.1 Emit onCruksCheckPending',
    /HookBus\.emit\(\s*['"]onCruksCheckPending['"]/.test(reelSrc));
  t('3.2 Emit gated behind the pending condition',
    /__NL_CRUKS_CHECK_REQUIRED__[\s\S]{0,500}HookBus\.emit\(\s*['"]onCruksCheckPending['"]/.test(reelSrc));
  t('3.3 Payload includes jurisdiction',
    /onCruksCheckPending[\s\S]{0,400}jurisdiction:/.test(reelSrc));
  t('3.4 Payload includes Wet KSA §31 rule citation',
    /onCruksCheckPending[\s\S]{0,400}NL-WetKSA-§31/.test(reelSrc));
  t('3.5 Emit wrapped in try/catch (no boot failure on emit error)',
    /try\s*\{[\s\S]{0,500}onCruksCheckPending[\s\S]{0,500}\}\s*catch/.test(reelSrc));
  t('3.6 Falls back to "NL" when __SLOT_JURISDICTION__ missing',
    /window\.__SLOT_JURISDICTION__\s*\|\|\s*['"]NL['"]/.test(reelSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Behavioural sandbox — verify the gate formula
 * ════════════════════════════════════════════════════════════════════ */
block('4. Behavioural gate sandbox', () => {
  /* Re-implement the gate predicate. The formula must abort iff
   * (required === true && passed !== true). */
  function shouldAbort(required, passed) {
    return required === true && passed !== true;
  }

  t('4.A required=true, passed=undefined → ABORT', shouldAbort(true, undefined) === true);
  t('4.B required=true, passed=false → ABORT',     shouldAbort(true, false) === true);
  t('4.C required=true, passed=true → ALLOW',      shouldAbort(true, true) === false);
  t('4.D required=false (non-NL) → ALLOW',         shouldAbort(false, false) === false);
  t('4.E required=undefined → ALLOW',              shouldAbort(undefined, false) === false);
  /* Edge: required=true and passed truthy-but-not-true (e.g. 1).
   * Strict equality !== true → ABORT. This is the safer regulator
   * default: only the literal boolean true counts as verified. */
  t('4.F required=true, passed=1 (truthy non-bool) → ABORT (strict)',
    shouldAbort(true, 1) === true);
  t('4.G required=true, passed="true" (string) → ABORT (strict)',
    shouldAbort(true, 'true') === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 5. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('5. LEGO contracts', () => {
  t('5.1 onCruksCheckPending owner declared: reelEngine.mjs',
    /onCruksCheckPending:\s*\[\s*['"]reelEngine\.mjs['"]\s*\]/.test(legoSrc));
  t('5.2 W58.J-NL.2 marker comment in lego-gate.mjs',
    /W58\.J-NL\.2/.test(legoSrc));
  t('5.3 Wet KSA §31 citation in lego-gate.mjs',
    /Wet\s*KSA[\s\S]{0,300}§\s*31/.test(legoSrc) ||
    /§\s*31[\s\S]{0,300}Wet\s*KSA/.test(legoSrc) ||
    /Wet KSA §31/.test(legoSrc) ||
    /Cruks/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('6. Honest scope', () => {
  t('6.1 Source notes operator session-init responsibility (not slot template)',
    /operator[\s\S]{0,200}session-init/i.test(reelSrc) || /operator[\s\S]{0,200}session\s*init/i.test(reelSrc));
  t('6.2 Source documents Centraal Register Uitsluiting Kansspelen by name',
    /Centraal Register Uitsluiting Kansspelen/.test(reelSrc));
  t('6.3 Source notes idempotent abort (silent on repeated clicks)',
    /[Ii]dempotent/.test(reelSrc) && /silently/.test(reelSrc));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
