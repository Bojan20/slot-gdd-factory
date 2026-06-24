/**
 * tests/blocks/cascadeDepthGuard.test.mjs
 *
 * UQ-DEEP-AN · AN-3 — Cascade depth guard tests.
 *
 * Validates the centralized hard ceiling registry
 * (src/registry/cascadeLimits.mjs) and proves the tumble runtime bakes the
 * depth counter, halt check at 100, warning band at 50, onCascadeHalted
 * emission, and preSpin reset hook.
 *
 * Target: 15/15 PASS.
 */

import { strict as assert } from 'node:assert';
import {
  CASCADE_MAX_DEPTH,
  CASCADE_MAX_DEPTH_FALLBACK_REASON,
  CASCADE_WARNING_AT_DEPTH,
  SCHEMA_VERSION,
  shouldHaltCascade,
  shouldWarnCascade,
} from '../../src/registry/cascadeLimits.mjs';

import {
  resolveConfig,
  emitTumbleRuntime,
} from '../../src/blocks/tumble.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n=== cascade depth guard (UQ-DEEP-AN · AN-3) ===');

/* ── registry constants ─────────────────────────────────────────────── */
t('1. CASCADE_MAX_DEPTH === 100', CASCADE_MAX_DEPTH === 100,
  `got ${CASCADE_MAX_DEPTH}`);
t('2. CASCADE_WARNING_AT_DEPTH === 50 (< MAX)',
  CASCADE_WARNING_AT_DEPTH === 50 && CASCADE_WARNING_AT_DEPTH < CASCADE_MAX_DEPTH,
  `warn=${CASCADE_WARNING_AT_DEPTH} max=${CASCADE_MAX_DEPTH}`);
t('10. SCHEMA_VERSION === \'1\'', SCHEMA_VERSION === '1',
  `got ${JSON.stringify(SCHEMA_VERSION)}`);
t('   CASCADE_MAX_DEPTH_FALLBACK_REASON === CASCADE_DEPTH_EXCEEDED',
  CASCADE_MAX_DEPTH_FALLBACK_REASON === 'CASCADE_DEPTH_EXCEEDED',
  `got ${CASCADE_MAX_DEPTH_FALLBACK_REASON}`);

/* ── shouldHaltCascade band ─────────────────────────────────────────── */
t('3. shouldHaltCascade(99) → false',
  shouldHaltCascade(99) === false);
t('4. shouldHaltCascade(100) → true',
  shouldHaltCascade(100) === true);
t('5. shouldHaltCascade(150) → true',
  shouldHaltCascade(150) === true);

/* ── shouldWarnCascade band ─────────────────────────────────────────── */
t('6. shouldWarnCascade(49) → false',
  shouldWarnCascade(49) === false);
t('7. shouldWarnCascade(50) → true',
  shouldWarnCascade(50) === true);
t('8. shouldWarnCascade(99) → true',
  shouldWarnCascade(99) === true);
t('9. shouldWarnCascade(100) → false (halted, not warning)',
  shouldWarnCascade(100) === false);

/* ── tumble runtime bake — depth guard wiring ───────────────────────── */
const cfg = resolveConfig({ topology: { cascade: { enabled: true } } });
const rt = emitTumbleRuntime(cfg);

t('11. Cascade runtime contains \'__cascadeDepth\' counter',
  rt.includes('__cascadeDepth'));
t('12. Cascade runtime contains \'>= 100\' check',
  rt.includes('>= 100'));
t('13. Cascade runtime emits \'onCascadeHalted\' event',
  rt.includes("'onCascadeHalted'") || rt.includes('"onCascadeHalted"'));
t('14. Cascade runtime resets counter on preSpin',
  rt.includes('_cascadeDepthReset()'));

/* ── block import smoke ─────────────────────────────────────────────── */
t('15. Block import succeeds (no syntax error)', (() => {
  try {
    /* import already succeeded above (top of file) and rt is a string */
    return typeof emitTumbleRuntime === 'function' && typeof rt === 'string' && rt.length > 0;
  } catch (_) { return false; }
})());

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
