/**
 * tests/_parserCache.test.mjs
 *
 * UQ-U-9 (Boki 2026-06-25, performance U-8-B #5) — LRU memo for parseGDD.
 *
 * Covers (8 cases):
 *   1.  First call populates cache (size: 0 → 1)
 *   2.  Second call with identical input is a cache hit
 *   3.  Cache hit returns a DEEP CLONE — caller mutation doesn't poison
 *   4.  Different ext = different cache key
 *   5.  Different text length = different cache key
 *   6.  Null / undefined input bypasses cache (failure-shape models not cached)
 *   7.  LRU eviction: 65th unique entry evicts the oldest
 *   8.  `_clearParseCache()` resets size to 0
 */

import { strict as assert } from 'node:assert';
import {
  parseGDD,
  _clearParseCache,
  _parseCacheSize,
} from '../src/parser.mjs';

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

console.log('parser LRU cache contract suite');

const SAMPLE = `# Demo Slot

## Topology
| Reels | 5 |
| Rows  | 3 |
| Paylines | 10 |
`;

/* 1 */
t('first call populates cache', () => {
  _clearParseCache();
  assert.equal(_parseCacheSize(), 0);
  parseGDD(SAMPLE, 'md');
  assert.equal(_parseCacheSize(), 1);
});

/* 2 */
t('second call with identical input is a cache hit (size stays at 1)', () => {
  _clearParseCache();
  const a = parseGDD(SAMPLE, 'md');
  const sizeAfter1 = _parseCacheSize();
  const b = parseGDD(SAMPLE, 'md');
  const sizeAfter2 = _parseCacheSize();
  assert.equal(sizeAfter1, 1);
  assert.equal(sizeAfter2, 1);
  /* Sanity: both calls return equivalent data. */
  assert.equal(a.topology.reels, b.topology.reels);
});

/* 3 */
t('cache hit returns deep clone — caller mutation does NOT poison cache', () => {
  _clearParseCache();
  const a = parseGDD(SAMPLE, 'md');
  a.name = 'MUTATED';
  a.topology.reels = 999;
  /* Second call must NOT see the mutation. */
  const b = parseGDD(SAMPLE, 'md');
  assert.notEqual(b.name, 'MUTATED');
  assert.notEqual(b.topology.reels, 999);
});

/* 4 */
t('different ext = different cache key (both md-path)', () => {
  /* Use `md` and `txt` (both go through markdown extractor — no JSON
     fallback path) so the cache-key differentiation is what we test,
     not the JSON-fallback diagnostic. */
  _clearParseCache();
  parseGDD(SAMPLE, 'md');
  parseGDD(SAMPLE, 'txt');
  assert.equal(_parseCacheSize(), 2);
});

/* 5 */
t('different text length = different cache key', () => {
  _clearParseCache();
  parseGDD(SAMPLE, 'md');
  parseGDD(SAMPLE + '\n## Extra\n| Bet | 1 |', 'md');
  assert.equal(_parseCacheSize(), 2);
});

/* 6 */
t('null input bypasses cache (no failure-shape caching)', () => {
  _clearParseCache();
  parseGDD(null);
  assert.equal(_parseCacheSize(), 0);
});

/* 7 */
t('LRU eviction: 65th unique entry evicts the oldest', () => {
  _clearParseCache();
  /* Fill the cache to capacity (64). Each entry has a unique trailing
     marker so the cache key differs (length AND prefix/suffix shift). */
  for (let i = 0; i < 64; i++) {
    parseGDD(SAMPLE + `\n<!-- unique ${i} -->\n`, 'md');
  }
  assert.equal(_parseCacheSize(), 64);
  /* Adding one more evicts the oldest (LRU). */
  parseGDD(SAMPLE + `\n<!-- unique 65 -->\n`, 'md');
  assert.equal(_parseCacheSize(), 64);
});

/* 8 */
t('_clearParseCache() resets size to 0', () => {
  parseGDD(SAMPLE, 'md');
  assert.ok(_parseCacheSize() > 0);
  _clearParseCache();
  assert.equal(_parseCacheSize(), 0);
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
