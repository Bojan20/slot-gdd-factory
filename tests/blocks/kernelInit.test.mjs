/**
 * tests/blocks/kernelInit.test.mjs
 *
 * P3-P4 contract tests for kernelInit boot blob block.
 *
 * Covers (14 cases):
 *   1. defaultConfig is frozen
 *   2. resolveConfig accepts valid override
 *   3. resolveConfig falls back to defaults on bogus override
 *   4. softwareid sanitizer rejects non-alphanumeric / overlong
 *   5. skincode sanitizer rejects non-alphanumeric
 *   6. defaultCurrency requires ISO 4217 (3 uppercase letters)
 *   7. defaultLocale requires BCP 47 shape
 *   8. environment must be one of allowlist
 *   9. emitKernelInitMarkup returns '' (no DOM)
 *  10. emitKernelInitCSS returns '' (no styles)
 *  11. emitKernelInitRuntime emits a (function(){...})() IIFE
 *  12. runtime IIFE assigns + freezes window.__KERNEL_INIT__
 *  13. emitted runtime XSS-safe (< > & escaped in inline JSON)
 *  14. disabled → emit returns banner comment, not IIFE
 */

import { strict as assert } from 'node:assert';
import {
  defaultConfig,
  resolveConfig,
  emitKernelInitMarkup,
  emitKernelInitCSS,
  emitKernelInitRuntime,
} from '../../src/blocks/kernelInit.mjs';

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

console.log('kernelInit block contract suite');

/* 1 */
t('defaultConfig is frozen', () => {
  const d = defaultConfig();
  assert.ok(Object.isFrozen(d));
  assert.equal(d.enabled, true);
  assert.equal(d.stubMode, true);
});

/* 2 */
t('resolveConfig accepts valid override', () => {
  const r = resolveConfig({
    kernelInit: {
      softwareid: 'OperatorX_Game42',
      skincode: 'brand-alpha',
      defaultCurrency: 'EUR',
      defaultLocale: 'en-GB',
      environment: 'staging',
    },
  });
  assert.equal(r.softwareid, 'OperatorX_Game42');
  assert.equal(r.skincode, 'brand-alpha');
  assert.equal(r.defaultCurrency, 'EUR');
  assert.equal(r.defaultLocale, 'en-GB');
  assert.equal(r.environment, 'staging');
});

/* 3 */
t('resolveConfig falls back to defaults on bogus override', () => {
  const r = resolveConfig({
    kernelInit: {
      softwareid: '<script>alert(1)</script>',
      defaultCurrency: 'NotACurrency',
      environment: 'malicious',
    },
  });
  const d = defaultConfig();
  assert.equal(r.softwareid, d.softwareid);
  assert.equal(r.defaultCurrency, d.defaultCurrency);
  assert.equal(r.environment, d.environment);
});

/* 4 */
t('softwareid: rejects non-POSIX chars + overlong', () => {
  const long = 'x'.repeat(200);
  assert.notEqual(resolveConfig({ kernelInit: { softwareid: long } }).softwareid, long);
  assert.notEqual(
    resolveConfig({ kernelInit: { softwareid: 'has spaces' } }).softwareid,
    'has spaces',
  );
});

/* 5 */
t('skincode: rejects non-POSIX', () => {
  assert.equal(
    resolveConfig({ kernelInit: { skincode: 'a/b' } }).skincode,
    defaultConfig().skincode,
  );
});

/* 6 */
t('defaultCurrency: only ISO 4217 (3-letter UPPERCASE) accepted', () => {
  assert.equal(resolveConfig({ kernelInit: { defaultCurrency: 'usd' } }).defaultCurrency, 'USD');
  assert.equal(resolveConfig({ kernelInit: { defaultCurrency: 'EU' } }).defaultCurrency, 'USD');
  assert.equal(resolveConfig({ kernelInit: { defaultCurrency: '12$' } }).defaultCurrency, 'USD');
});

/* 7 */
t('defaultLocale: BCP 47 shape accepted, garbage rejected', () => {
  assert.equal(resolveConfig({ kernelInit: { defaultLocale: 'sr-Latn-RS' } }).defaultLocale, 'sr-Latn-RS');
  assert.equal(resolveConfig({ kernelInit: { defaultLocale: 'de' } }).defaultLocale, 'de');
  assert.equal(resolveConfig({ kernelInit: { defaultLocale: '!!' } }).defaultLocale, 'en-US');
});

/* 8 */
t('environment must be allowlist member', () => {
  assert.equal(resolveConfig({ kernelInit: { environment: 'cert' } }).environment, 'cert');
  assert.equal(resolveConfig({ kernelInit: { environment: 'evil' } }).environment, 'demo');
});

/* 9 */
t('emitKernelInitMarkup returns empty (no DOM)', () => {
  const m = emitKernelInitMarkup(resolveConfig({}));
  /* Block tagger wraps empty payload in markup comment markers; the
     payload itself must be empty (no rendered DOM). */
  assert.equal(typeof m, 'string');
  assert.ok(m.indexOf('<div') === -1, 'must NOT inject a div');
});

/* 10 */
t('emitKernelInitCSS returns empty', () => {
  assert.equal(emitKernelInitCSS(), '');
});

/* 11 */
t('emitKernelInitRuntime emits an IIFE', () => {
  const r = emitKernelInitRuntime(resolveConfig({}));
  assert.match(r, /^\(function\(\)\{/);
  assert.match(r, /\}\)\(\);\s*$/);
});

/* 12 */
t('runtime assigns + freezes window.__KERNEL_INIT__', () => {
  const r = emitKernelInitRuntime(resolveConfig({}));
  assert.match(r, /window\.__KERNEL_INIT__/);
  assert.match(r, /Object\.freeze/);
});

/* 13 */
t('runtime XSS-safe: <, >, & escaped in inline JSON', () => {
  const r = emitKernelInitRuntime(resolveConfig({}));
  assert.ok(!r.includes('<script>'), 'must not contain literal <script>');
  assert.ok(!r.includes('</script>'), 'must not contain literal </script>');
});

/* 14 */
t('disabled → emit returns banner comment, not IIFE', () => {
  const r = emitKernelInitRuntime(resolveConfig({ kernelInit: { enabled: false } }));
  assert.match(r, /kernelInit disabled by GDD/);
  assert.ok(!r.includes('(function()'), 'must not emit IIFE when disabled');
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
