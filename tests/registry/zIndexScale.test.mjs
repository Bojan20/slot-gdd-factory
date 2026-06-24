/**
 * tests/registry/zIndexScale.test.mjs
 *
 * UQ-DEEP-AO · AO-5 · z-index scale registry test suite.
 *
 * Covers 15 cases per AO-5 spec:
 *   1. SCHEMA_VERSION === '1'
 *   2. Z is frozen
 *   3. Z.THEME_CSS_RESERVED < Z.JACKPOT_CELEBRATION (themeCSS cannot over-cover)
 *   4. Z.MODAL_DIALOG > Z.HUD_CONTROLS (modals above HUD)
 *   5. Z.COMPLIANCE_MODAL > Z.MODAL_DIALOG (compliance above paytable)
 *   6. Z.GRAND_INTERRUPTION > Z.COMPLIANCE_MODAL (interruption above all UI)
 *   7. Z.DEV_HOT_RELOAD > Z.GRAND_INTERRUPTION (devtool above all)
 *   8. All Z values <= 1000 (4-digit cap)
 *   9. All Z values >= 0
 *  10. Z values distinct (no duplicate)
 *  11. zFor('GRAND_INTERRUPTION') === 900
 *  12. zFor('UNKNOWN') === 0
 *  13. After migration: themeCSS source contains NO 2147483000 magic
 *  14. After migration: 9000 used in <= 1 place (only legacy if any)
 *  15. After migration: migrated blocks import Z from registry
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import { SCHEMA_VERSION, Z, zFor } from '../../src/registry/zIndexScale.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolvePath(__dirname, '..', '..');
const BLOCKS_DIR = resolvePath(REPO_ROOT, 'src', 'blocks');

/* ─── pure registry contract tests ──────────────────────────────────── */

test('1. SCHEMA_VERSION is the string "1"', () => {
  assert.equal(SCHEMA_VERSION, '1');
});

test('2. Z is frozen', () => {
  assert.equal(Object.isFrozen(Z), true);
  assert.throws(() => { Z.NEW_LAYER = 999; }, /./);
});

test('3. THEME_CSS_RESERVED < JACKPOT_CELEBRATION (no over-cover)', () => {
  assert.ok(Z.THEME_CSS_RESERVED < Z.JACKPOT_CELEBRATION,
    `expected ${Z.THEME_CSS_RESERVED} < ${Z.JACKPOT_CELEBRATION}`);
});

test('4. MODAL_DIALOG > HUD_CONTROLS (modals above HUD)', () => {
  assert.ok(Z.MODAL_DIALOG > Z.HUD_CONTROLS,
    `expected ${Z.MODAL_DIALOG} > ${Z.HUD_CONTROLS}`);
});

test('5. COMPLIANCE_MODAL > MODAL_DIALOG (compliance above paytable)', () => {
  assert.ok(Z.COMPLIANCE_MODAL > Z.MODAL_DIALOG,
    `expected ${Z.COMPLIANCE_MODAL} > ${Z.MODAL_DIALOG}`);
});

test('6. GRAND_INTERRUPTION > COMPLIANCE_MODAL (interruption above all UI)', () => {
  assert.ok(Z.GRAND_INTERRUPTION > Z.COMPLIANCE_MODAL,
    `expected ${Z.GRAND_INTERRUPTION} > ${Z.COMPLIANCE_MODAL}`);
});

test('7. DEV_HOT_RELOAD > GRAND_INTERRUPTION (devtool above all)', () => {
  assert.ok(Z.DEV_HOT_RELOAD > Z.GRAND_INTERRUPTION,
    `expected ${Z.DEV_HOT_RELOAD} > ${Z.GRAND_INTERRUPTION}`);
});

test('8. all Z values <= 1000 (4-digit cap)', () => {
  for (const [k, v] of Object.entries(Z)) {
    assert.ok(v <= 1000, `Z.${k} = ${v} exceeds 1000 cap`);
  }
});

test('9. all Z values >= 0', () => {
  for (const [k, v] of Object.entries(Z)) {
    assert.ok(v >= 0, `Z.${k} = ${v} is negative`);
  }
});

test('10. Z values distinct (no duplicate slot)', () => {
  const seen = new Map();
  for (const [k, v] of Object.entries(Z)) {
    if (seen.has(v)) {
      assert.fail(`duplicate z-index slot ${v} used by Z.${seen.get(v)} and Z.${k}`);
    }
    seen.set(v, k);
  }
});

test('11. zFor("GRAND_INTERRUPTION") === 900', () => {
  assert.equal(zFor('GRAND_INTERRUPTION'), 900);
});

test('12. zFor("UNKNOWN") === 0 (fallback to BACKGROUND)', () => {
  assert.equal(zFor('UNKNOWN'), 0);
  assert.equal(zFor(''), 0);
  assert.equal(zFor(null), 0);
});

/* ─── migration-state tests (source scan) ───────────────────────────── */

const MIGRATED_BLOCKS = [
  'themeCSS.mjs',
  'grandInterruptionLock.mjs',
  'hotReload.mjs',
  'jackpotRoomReveal.mjs',
  'patternWin.mjs',
  'realityCheck.mjs',
  'holdAndWin.mjs',
  'freeSpins.mjs',
  'liveRtpHud.mjs',
];

async function readBlock(name) {
  return await readFile(resolvePath(BLOCKS_DIR, name), 'utf8');
}

test('13. themeCSS source has NO live z-index: 2147483000 declaration', async () => {
  const src = await readBlock('themeCSS.mjs');
  /* Strip comments so the "was 2147483000" migration trail does not
   * trigger a false positive. We want to ensure NO live CSS declaration
   * still uses the stacking-context-killer magic. */
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(!/z-index:\s*2147483000/.test(stripped),
    'themeCSS.mjs still has a live z-index: 2147483000 declaration');
});

test('14. live "z-index: 9000" declaration appears in <= 1 migrated block', async () => {
  let hits = 0;
  const offenders = [];
  for (const name of MIGRATED_BLOCKS) {
    const src = await readBlock(name);
    /* Strip comments so migration trails do not register as live use. */
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    if (/z-index:\s*9000\b/.test(stripped)) {
      hits += 1;
      offenders.push(name);
    }
  }
  assert.ok(hits <= 1,
    `${hits} migrated blocks still use literal "z-index: 9000": ${offenders.join(', ')}`);
});

test('15. all migrated blocks import Z from ../registry/zIndexScale.mjs', async () => {
  const missing = [];
  for (const name of MIGRATED_BLOCKS) {
    const src = await readBlock(name);
    if (!/from\s+['"]\.\.\/registry\/zIndexScale\.mjs['"]/.test(src)) {
      missing.push(name);
    }
  }
  assert.deepEqual(missing, [],
    `the following migrated blocks do not import Z from registry: ${missing.join(', ')}`);
});
