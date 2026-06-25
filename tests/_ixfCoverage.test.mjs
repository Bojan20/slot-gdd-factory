/**
 * tests/_ixfCoverage.test.mjs
 *
 * P3-P2 (Boki 2026-06-25) — IXF 15-stage smoke test.
 *
 * Anchor hooks must exist for the regulator integration contract to
 * be honoured. These five assertions are the canonical "is the 15-stage
 * lifecycle wired?" smoke; the deep walker `tools/_ixf-coverage-audit.mjs`
 * runs the full stage-by-stage check.
 *
 * Covers:
 *   1. preSpin exists (S04 anchor)
 *   2. postSpin exists (S13 anchor)
 *   3. onSpinResult exists (S05 + S07 dual-stage anchor)
 *   4. onFsTrigger + onFsEnd exist (S10 + S12 anchors)
 *   5. HOOK_EVENTS.length >= 15 (room to cover every stage)
 *   6. HOOK_EVENTS is frozen (immutable registry contract)
 *   7. Walker tool exits 0 against current source-of-truth doc
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_EVENTS } from '../src/blocks/hookBus.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    fail++;
  }
}

console.log('IXF 15-stage coverage smoke');

t('S04 anchor: preSpin exists', () => {
  assert.ok(HOOK_EVENTS.includes('preSpin'), 'preSpin missing — S04 broken');
});

t('S13 anchor: postSpin exists', () => {
  assert.ok(HOOK_EVENTS.includes('postSpin'), 'postSpin missing — S13 broken');
});

t('S05 + S07 anchor: onSpinResult exists', () => {
  assert.ok(HOOK_EVENTS.includes('onSpinResult'), 'onSpinResult missing — S05/S07 broken');
});

t('S10 + S12 anchors: onFsTrigger + onFsEnd exist', () => {
  assert.ok(HOOK_EVENTS.includes('onFsTrigger'), 'onFsTrigger missing — S10 broken');
  assert.ok(HOOK_EVENTS.includes('onFsEnd'),     'onFsEnd missing — S12 broken');
});

t('HOOK_EVENTS.length >= 15 (room to cover every stage)', () => {
  assert.ok(HOOK_EVENTS.length >= 15, `only ${HOOK_EVENTS.length} hooks — too few for IXF`);
});

t('HOOK_EVENTS is frozen (immutable registry contract)', () => {
  assert.ok(Object.isFrozen(HOOK_EVENTS), 'HOOK_EVENTS must be Object.freeze()-d');
});

t('Walker tool exits 0 on current doc / source pair', () => {
  /* Smoke: invoke the walker as a child process and assert exit 0.
     If the doc drifts from the registry the walker exits 1 and this
     test catches it. */
  const bin = resolve(REPO, 'tools', '_ixf-coverage-audit.mjs');
  /* Throws when exit != 0 — perfect for assert. */
  try {
    execFileSync('node', [bin, '--quiet'], { stdio: 'pipe' });
  } catch (e) {
    const out = e.stdout?.toString() || '';
    const err = e.stderr?.toString() || '';
    throw new Error(`walker non-zero exit ${e.status}: ${out}${err}`);
  }
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
