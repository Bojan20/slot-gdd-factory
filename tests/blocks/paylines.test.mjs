/**
 * Unit test for src/blocks/paylines.mjs
 *
 * Validates the LEGO block contract:
 *   1. buildStandardPaylines is deterministic + pure (same input → same output)
 *   2. paylineConfig respects GDD override (model.winPresentation.paylines)
 *   3. paylineConfig falls back to industry standard for line-pay shapes
 *   4. paylineConfig returns empty pool + cluster mode for non-line shapes
 *   5. Line-count contracts: 5×3 → 16 unique, 5×4 → 21 unique
 *      (after dedupe — pool was [16, 25] but several rows collide on tiny grids)
 *   6. Each line is reels-long and every row index is in [0, rows-1]
 */

import { strict as assert } from 'node:assert';
import {
  buildStandardPaylines,
  paylineConfig,
  LINE_PAYS_KINDS,
} from '../../src/blocks/paylines.mjs';

let fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n— blocks/paylines.mjs —');

t('buildStandardPaylines: reels < 3 → empty', () => {
  assert.deepEqual(buildStandardPaylines(2, 3), []);
  assert.deepEqual(buildStandardPaylines(0, 3), []);
});

t('buildStandardPaylines(5,3) → 16 unique lines', () => {
  const out = buildStandardPaylines(5, 3);
  assert.equal(out.length, 16, `expected 16 unique lines, got ${out.length}`);
});

t('buildStandardPaylines(5,4) → 21 unique lines (16 base + 5 deep)', () => {
  const out = buildStandardPaylines(5, 4);
  assert.equal(out.length, 21, `expected 21 unique lines, got ${out.length}`);
});

t('every line has reels-many entries', () => {
  for (const reels of [3, 5, 6, 7]) {
    const out = buildStandardPaylines(reels, 3);
    for (const line of out) {
      assert.equal(line.length, reels, `line length != reels (${reels})`);
    }
  }
});

t('every row index is within [0, rows-1]', () => {
  for (const [reels, rows] of [[5,3],[5,4],[6,4],[7,3]]) {
    const out = buildStandardPaylines(reels, rows);
    for (const line of out) {
      for (const r of line) {
        assert.ok(r >= 0 && r < rows, `row ${r} out of range for ${reels}x${rows}`);
      }
    }
  }
});

t('deterministic: same input → identical output across calls', () => {
  const a = buildStandardPaylines(5, 3);
  const b = buildStandardPaylines(5, 3);
  assert.deepEqual(a, b);
});

t('paylineConfig: explicit GDD pool wins', () => {
  const explicit = [[0,1,2,1,0], [2,1,0,1,2]];
  const model = { winPresentation: { paylines: explicit } };
  const shape = { kind: 'rectangular', reels: 5, rows: 3 };
  const cfg = paylineConfig(model, shape);
  assert.equal(cfg.mode, 'line-pays');
  assert.deepEqual(cfg.pool, explicit);
});

t('paylineConfig: line-pay shape, no GDD override → industry standard', () => {
  const model = {};
  const shape = { kind: 'rectangular', reels: 5, rows: 3 };
  const cfg = paylineConfig(model, shape);
  assert.equal(cfg.mode, 'line-pays');
  assert.equal(cfg.pool.length, 16);
});

t('paylineConfig: cluster shape → empty pool + cluster mode', () => {
  const model = {};
  const shape = { kind: 'cluster', reels: 6, rows: 5 };
  const cfg = paylineConfig(model, shape);
  assert.equal(cfg.mode, 'cluster');
  assert.deepEqual(cfg.pool, []);
});

t('paylineConfig: wheel/SVG shape → empty pool + cluster mode', () => {
  for (const kind of ['wheel', 'crash', 'radial', 'slingo', 'plinko', 'megaclusters', 'hex', 'diamond', 'pyramid', 'cross', 'l_shape']) {
    const cfg = paylineConfig({}, { kind, reels: 5, rows: 3 });
    assert.equal(cfg.mode, 'cluster', `${kind} should fall through to cluster mode`);
    assert.deepEqual(cfg.pool, []);
  }
});

t('LINE_PAYS_KINDS export covers expected shapes', () => {
  for (const kind of ['rectangular', 'variable_reel', 'lock_respin', 'expanding']) {
    assert.ok(LINE_PAYS_KINDS.has(kind), `expected ${kind} in LINE_PAYS_KINDS`);
  }
  for (const kind of ['cluster', 'wheel', 'hex']) {
    assert.ok(!LINE_PAYS_KINDS.has(kind), `${kind} should NOT be in LINE_PAYS_KINDS`);
  }
});

t('paylineConfig: explicit empty array falls through (treated as no override)', () => {
  const model = { winPresentation: { paylines: [] } };
  const shape = { kind: 'rectangular', reels: 5, rows: 3 };
  const cfg = paylineConfig(model, shape);
  // Empty array means "no explicit override" → industry standard kicks in
  assert.equal(cfg.pool.length, 16);
});

if (fail > 0) {
  console.error(`\n${fail} FAILED`);
  process.exit(1);
}
console.log(`\n  All tests passed.`);
