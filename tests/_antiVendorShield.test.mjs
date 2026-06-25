/**
 * tests/_antiVendorShield.test.mjs
 *
 * MATH-INTEGRATION-LV3 atom #11 (Boki 2026-06-26) — Contract tests
 * for the shared anti-vendor sanitization registry.
 *
 * Covers (12 cases):
 *   1.  VENDOR_RX matches every name in listVendors()
 *   2.  isVendorTainted: true for known vendors, false for clean
 *   3.  isVendorTainted: non-string input returns false
 *   4.  sanitizeStr: replaces vendor token with default '[vendor]'
 *   5.  sanitizeStr: custom replacement honoured
 *   6.  sanitizeStr: non-string passes through unchanged
 *   7.  sanitizeStr: hyphen/underscore/dot/whitespace token variants matched
 *   8.  sanitizeObj: deep walk replaces nested string values
 *   9.  sanitizeObj: array elements recursed
 *  10.  sanitizeObj: object KEYS are NOT scrubbed (intentional)
 *  11.  sanitizeObj: cycle-safe (self-referencing graph)
 *  12.  sanitizeObj: class instance (Date) opaque, not recursed
 */

import { strict as assert } from 'node:assert';
import {
  VENDOR_RX,
  isVendorTainted,
  sanitizeStr,
  sanitizeObj,
  listVendors,
} from '../src/registry/antiVendorShield.mjs';

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

console.log('antiVendorShield contract suite');

/* 1 */
t('VENDOR_RX matches every name in listVendors()', () => {
  const vendors = listVendors();
  assert.ok(vendors.length >= 10, 'expected ≥ 10 known vendors');
  for (const v of vendors) {
    VENDOR_RX.lastIndex = 0;
    /* The regex is the runtime form (tolerates whitespace variants);
       the listed name is one canonical variant — must match. */
    assert.ok(VENDOR_RX.test(v), `regex must match canonical vendor '${v}'`);
    VENDOR_RX.lastIndex = 0;
  }
});

/* 2 */
t('isVendorTainted: true for known vendors, false for clean', () => {
  assert.equal(isVendorTainted('IGT'), true);
  assert.equal(isVendorTainted('Pragmatic Play'), true);
  assert.equal(isVendorTainted('this is a clean string'), false);
  assert.equal(isVendorTainted(''), false);
});

/* 3 */
t('isVendorTainted: non-string input returns false', () => {
  assert.equal(isVendorTainted(null), false);
  assert.equal(isVendorTainted(undefined), false);
  assert.equal(isVendorTainted(42), false);
  assert.equal(isVendorTainted({ a: 1 }), false);
  assert.equal(isVendorTainted([]), false);
});

/* 4 */
t('sanitizeStr: replaces vendor with default [vendor]', () => {
  assert.equal(sanitizeStr('powered by IGT'), 'powered by [vendor]');
  assert.equal(sanitizeStr('a NetEnt classic'), 'a [vendor] classic');
});

/* 5 */
t('sanitizeStr: custom replacement honoured', () => {
  assert.equal(sanitizeStr('powered by IGT', '[redacted]'), 'powered by [redacted]');
  assert.equal(sanitizeStr('a Megaways game', '<X>'), 'a <X> game');
});

/* 6 */
t('sanitizeStr: non-string passes through unchanged', () => {
  assert.equal(sanitizeStr(null), null);
  assert.equal(sanitizeStr(undefined), undefined);
  assert.equal(sanitizeStr(42), 42);
  const obj = { a: 1 };
  assert.equal(sanitizeStr(obj), obj);
});

/* 7 */
t('sanitizeStr: hyphen/underscore/dot/whitespace variants matched', () => {
  assert.equal(sanitizeStr('Pragmatic-Play'),    '[vendor]');
  assert.equal(sanitizeStr('Pragmatic_Play'),    '[vendor]');
  assert.equal(sanitizeStr('Pragmatic.Play'),    '[vendor]');
  assert.equal(sanitizeStr('Cash-Eruption'),     '[vendor]');
  assert.equal(sanitizeStr('Cash_Eruption'),     '[vendor]');
  assert.equal(sanitizeStr('Cash Eruption'),     '[vendor]');
});

/* 8 */
t('sanitizeObj: deep walk replaces nested string values', () => {
  const input = {
    title: 'A demo game',
    description: 'powered by IGT',
    nested: { sub: 'features a NetEnt feature' },
  };
  const out = sanitizeObj(input);
  assert.equal(out.title, 'A demo game');
  assert.equal(out.description, 'powered by [vendor]');
  assert.equal(out.nested.sub, 'features a [vendor] feature');
  /* Input NOT mutated. */
  assert.equal(input.description, 'powered by IGT');
});

/* 9 */
t('sanitizeObj: array elements recursed', () => {
  const out = sanitizeObj(['clean', 'IGT here', { tag: 'NetEnt vibe' }]);
  assert.deepEqual(out, ['clean', '[vendor] here', { tag: '[vendor] vibe' }]);
});

/* 10 */
t('sanitizeObj: object KEYS are NOT scrubbed (structural significance)', () => {
  /* A vendor-named KEY is a configuration drift symptom we want to
     surface, not silently rewrite. */
  const out = sanitizeObj({ IGT: 'tainted', clean: 'IGT' });
  /* Key still 'IGT', value scrubbed. */
  assert.ok('IGT' in out);
  assert.equal(out.IGT, 'tainted');
  assert.equal(out.clean, '[vendor]');
});

/* 11 */
t('sanitizeObj: cycle-safe (self-referencing graph)', () => {
  const a = { name: 'has IGT inside' };
  a.self = a;
  /* Must not blow the stack. */
  const out = sanitizeObj(a);
  assert.equal(out.name, 'has [vendor] inside');
});

/* 12 */
t('sanitizeObj: class instance (Date) opaque, not recursed', () => {
  const d = new Date();
  const out = sanitizeObj({ when: d, label: 'IGT date' });
  assert.equal(out.label, '[vendor] date');
  /* The Date instance passes through by reference (we treat class
     instances as opaque). */
  assert.equal(out.when, d);
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
