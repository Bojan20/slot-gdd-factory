/**
 * tests/_rectTransform.test.mjs
 *
 * P3-P6 contract tests for the RectTransform responsive layout primitive.
 *
 * Covers (16 cases):
 *   1. defaultRectTransform: frozen center-anchored / center-pivoted
 *   2. resolveRectTransform: null → default
 *   3. resolveRectTransform: object → merged
 *   4. resolveRectTransform: non-object → throws TypeError
 *   5. anchor.x out of [0,1] clamped
 *   6. anchor.y out of [0,1] clamped
 *   7. offset.x out of ±10000 clamped
 *   8. pivot non-number falls back to default
 *   9. breakpoints.portrait honored
 *  10. breakpoints.landscape honored
 *  11. pickForOrientation falls back to base when breakpoint missing
 *  12. computeCSS lands element correctly at anchor=(0,0)
 *  13. computeCSS pivots via translate(-X%, -Y%)
 *  14. computeCSS honors safeArea offset
 *  15. computeCSS orientation auto-detect (landscape vs portrait)
 *  16. resolveAllTransforms skips malformed entries silently
 */

import { strict as assert } from 'node:assert';
import {
  defaultRectTransform,
  resolveRectTransform,
  pickForOrientation,
  computeCSS,
  resolveAllTransforms,
} from '../src/registry/rectTransform.mjs';

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

console.log('rectTransform contract suite');

/* 1 */
t('defaultRectTransform: frozen, center anchored', () => {
  const d = defaultRectTransform();
  assert.ok(Object.isFrozen(d));
  assert.equal(d.anchor.x, 0.5);
  assert.equal(d.anchor.y, 0.5);
  assert.equal(d.pivot.x, 0.5);
  assert.equal(d.pivot.y, 0.5);
  assert.equal(d.offset.x, 0);
  assert.equal(d.offset.y, 0);
});

/* 2 */
t('resolveRectTransform: null → default', () => {
  const r = resolveRectTransform(null);
  assert.deepEqual({ x: r.anchor.x, y: r.anchor.y }, { x: 0.5, y: 0.5 });
});

/* 3 */
t('resolveRectTransform: object → merged', () => {
  const r = resolveRectTransform({
    anchor: { x: 0, y: 1 },
    pivot: { x: 0, y: 1 },
    offset: { x: 12, y: -8 },
  });
  assert.equal(r.anchor.x, 0);
  assert.equal(r.anchor.y, 1);
  assert.equal(r.pivot.x, 0);
  assert.equal(r.pivot.y, 1);
  assert.equal(r.offset.x, 12);
  assert.equal(r.offset.y, -8);
});

/* 4 */
t('resolveRectTransform: non-object/non-null throws TypeError', () => {
  assert.throws(() => resolveRectTransform('not-an-object'), /expected object/);
  assert.throws(() => resolveRectTransform(123), /expected object/);
});

/* 5 */
t('anchor.x clamped to [0,1]', () => {
  const r = resolveRectTransform({ anchor: { x: -0.5, y: 0.5 } });
  assert.equal(r.anchor.x, 0);
  const r2 = resolveRectTransform({ anchor: { x: 999, y: 0.5 } });
  assert.equal(r2.anchor.x, 1);
});

/* 6 */
t('anchor.y clamped to [0,1]', () => {
  const r = resolveRectTransform({ anchor: { x: 0.5, y: -1 } });
  assert.equal(r.anchor.y, 0);
  const r2 = resolveRectTransform({ anchor: { x: 0.5, y: 5 } });
  assert.equal(r2.anchor.y, 1);
});

/* 7 */
t('offset.x clamped to ±10000', () => {
  const r = resolveRectTransform({ offset: { x: 100_000, y: 0 } });
  assert.equal(r.offset.x, 10_000);
  const r2 = resolveRectTransform({ offset: { x: -100_000, y: 0 } });
  assert.equal(r2.offset.x, -10_000);
});

/* 8 */
t('pivot non-number falls back to default 0.5', () => {
  const r = resolveRectTransform({ pivot: { x: 'left', y: 'top' } });
  assert.equal(r.pivot.x, 0.5);
  assert.equal(r.pivot.y, 0.5);
});

/* 9 */
t('breakpoints.portrait honored', () => {
  const r = resolveRectTransform({
    anchor: { x: 0.5, y: 0.5 },
    breakpoints: {
      portrait: { anchor: { x: 0, y: 0 } },
    },
  });
  assert.equal(r.breakpoints.portrait.anchor.x, 0);
  assert.equal(r.breakpoints.portrait.anchor.y, 0);
});

/* 10 */
t('breakpoints.landscape honored', () => {
  const r = resolveRectTransform({
    anchor: { x: 0.5, y: 0.5 },
    breakpoints: {
      landscape: { anchor: { x: 1, y: 1 } },
    },
  });
  assert.equal(r.breakpoints.landscape.anchor.x, 1);
});

/* 11 */
t('pickForOrientation: fallback to base when breakpoint missing', () => {
  const tx = resolveRectTransform({ anchor: { x: 0.25, y: 0.25 } });
  const r = pickForOrientation(tx, 'portrait');
  assert.equal(r.anchor.x, 0.25);
  assert.equal(r.anchor.y, 0.25);
});

/* 12 */
t('computeCSS: anchor=(0,0) → element at origin', () => {
  const tx = resolveRectTransform({
    anchor: { x: 0, y: 0 },
    pivot: { x: 0, y: 0 },
  });
  const css = computeCSS(tx, { viewport: { w: 1440, h: 900 } });
  assert.equal(css.left, '0.00px');
  assert.equal(css.top, '0.00px');
  /* -0 * 100 = 0 in JS (signed zero collapses), so transform is "0.00%" not "-0.00%". */
  assert.equal(css.transform, 'translate(0.00%, 0.00%)');
});

/* 13 */
t('computeCSS: pivot=(1,1) → translate(-100%, -100%)', () => {
  const tx = resolveRectTransform({
    anchor: { x: 1, y: 1 },
    pivot: { x: 1, y: 1 },
  });
  const css = computeCSS(tx, { viewport: { w: 1440, h: 900 } });
  assert.equal(css.left, '1440.00px');
  assert.equal(css.top, '900.00px');
  assert.equal(css.transform, 'translate(-100.00%, -100.00%)');
});

/* 14 */
t('computeCSS honors safeArea offset', () => {
  const tx = resolveRectTransform({ anchor: { x: 0, y: 0 } });
  const css = computeCSS(tx, {
    viewport: { w: 1440, h: 900 },
    safeArea: { x: 40, y: 60, w: 1360, h: 780 },
  });
  /* anchor=(0,0) → element at safeArea origin. */
  assert.equal(css.left, '40.00px');
  assert.equal(css.top, '60.00px');
});

/* 15 */
t('computeCSS: auto landscape vs portrait detection picks correct breakpoint', () => {
  const tx = resolveRectTransform({
    anchor: { x: 0.5, y: 0.5 },
    breakpoints: {
      portrait: { anchor: { x: 0, y: 0 } },
      landscape: { anchor: { x: 1, y: 1 } },
    },
  });
  /* Landscape viewport: anchor (1,1). */
  const land = computeCSS(tx, { viewport: { w: 1440, h: 900 } });
  assert.equal(land.left, '1440.00px');
  /* Portrait viewport: anchor (0,0). */
  const port = computeCSS(tx, { viewport: { w: 390, h: 844 } });
  assert.equal(port.left, '0.00px');
});

/* 16 */
t('resolveAllTransforms: skips malformed entries silently', () => {
  const map = resolveAllTransforms({
    rectTransforms: {
      'good-block': { anchor: { x: 0.1, y: 0.1 } },
      '99bad': null, // invalid id (starts with digit)
      'evil block': null, // space in id
      'silly-input': 'not-an-object', // throws on resolve, swallow
    },
  });
  assert.ok(map['good-block']);
  assert.equal(map['good-block'].anchor.x, 0.1);
  assert.equal(map['99bad'], undefined);
  assert.equal(map['evil block'], undefined);
  /* silly-input throws inside try/catch — skipped */
  assert.equal(map['silly-input'], undefined);
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
