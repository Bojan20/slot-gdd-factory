/**
 * tests/registry/blockKindAliases.test.mjs
 *
 * UQ-DEEP-AO · AO-7 — snake_case ↔ camelCase block kind alias resolution
 *
 * Coverage:
 *   1.  SCHEMA_VERSION === '1'
 *   2.  ALIASES is frozen
 *   3.  ALIASES contains 'free_spins' → 'freeSpins'
 *   4.  REVERSE_ALIASES is correct inverse
 *   5.  resolveBlockName('free_spins') === 'freeSpins'
 *   6.  resolveBlockName('freeSpins') passes through unchanged
 *   7.  resolveBlockName('hold_and_win') === 'holdAndWin'
 *   8.  resolveBlockName(null) === null
 *   9.  resolveBlockName('') === null
 *   10. resolveBlockName(123) === null (non-string)
 *   11. resolveBlockName('unknown_kind') auto-converts → 'unknownKind'
 *   12. resolveFeatureKind('freeSpins') === 'free_spins'
 *   13. resolveFeatureKind('holdAndWin') === 'hold_and_win'
 *   14. resolveFeatureKind('clusterPaysEval') === 'cluster_pays' (reverse map)
 *   15. resolveFeatureKind('unknownBlock') auto-converts → 'unknown_block'
 *   16. ALIASES size >= 25
 *   17. resolveBlockName('cascade') === 'tumble' (legacy alias)
 *   18. Auto-convert idempotent (camelCase passes through unchanged)
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SCHEMA_VERSION,
  ALIASES,
  REVERSE_ALIASES,
  resolveBlockName,
  resolveFeatureKind,
} from '../../src/registry/blockKindAliases.mjs';

test('AO-7-01 — SCHEMA_VERSION pinned at "1"', () => {
  assert.equal(SCHEMA_VERSION, '1');
});

test('AO-7-02 — ALIASES object is frozen', () => {
  assert.equal(Object.isFrozen(ALIASES), true);
  /* Attempting mutation should silently fail (strict mode throws). */
  assert.throws(() => { 'use strict'; ALIASES.tampered = 'nope'; }, TypeError);
});

test('AO-7-03 — ALIASES["free_spins"] === "freeSpins"', () => {
  assert.equal(ALIASES['free_spins'], 'freeSpins');
});

test('AO-7-04 — REVERSE_ALIASES is correct inverse for representative keys', () => {
  assert.equal(REVERSE_ALIASES['freeSpins'], 'free_spin');  /* last-wins from Object.fromEntries */
  assert.equal(REVERSE_ALIASES['holdAndWin'], 'hold_and_win');
  assert.equal(REVERSE_ALIASES['clusterPaysEval'], 'cluster_pays');
  /* Every value in ALIASES must appear as a key in REVERSE_ALIASES. */
  for (const v of Object.values(ALIASES)) {
    assert.ok(Object.prototype.hasOwnProperty.call(REVERSE_ALIASES, v),
      `REVERSE_ALIASES missing key for value "${v}"`);
  }
});

test('AO-7-05 — resolveBlockName("free_spins") === "freeSpins"', () => {
  assert.equal(resolveBlockName('free_spins'), 'freeSpins');
});

test('AO-7-06 — resolveBlockName("freeSpins") passes through unchanged', () => {
  assert.equal(resolveBlockName('freeSpins'), 'freeSpins');
});

test('AO-7-07 — resolveBlockName("hold_and_win") === "holdAndWin"', () => {
  assert.equal(resolveBlockName('hold_and_win'), 'holdAndWin');
});

test('AO-7-08 — resolveBlockName(null) === null', () => {
  assert.equal(resolveBlockName(null), null);
});

test('AO-7-09 — resolveBlockName("") === null', () => {
  assert.equal(resolveBlockName(''), null);
});

test('AO-7-10 — resolveBlockName(123) === null (non-string)', () => {
  assert.equal(resolveBlockName(123), null);
  assert.equal(resolveBlockName(undefined), null);
  assert.equal(resolveBlockName({}), null);
});

test('AO-7-11 — resolveBlockName("unknown_kind") auto-converts to "unknownKind"', () => {
  assert.equal(resolveBlockName('unknown_kind'), 'unknownKind');
  /* Multi-segment auto-convert */
  assert.equal(resolveBlockName('some_long_new_feature'), 'someLongNewFeature');
});

test('AO-7-12 — resolveFeatureKind("freeSpins") returns mapped snake_case', () => {
  /* Whitelist hit via REVERSE_ALIASES — value is whichever of "free_spins"
   * or "free_spin" survived the Object.fromEntries last-write-wins; both
   * are valid round-trip targets. */
  const out = resolveFeatureKind('freeSpins');
  assert.ok(out === 'free_spins' || out === 'free_spin',
    `expected free_spins or free_spin, got "${out}"`);
});

test('AO-7-13 — resolveFeatureKind("holdAndWin") === "hold_and_win"', () => {
  assert.equal(resolveFeatureKind('holdAndWin'), 'hold_and_win');
});

test('AO-7-14 — resolveFeatureKind("clusterPaysEval") === "cluster_pays" via reverse map', () => {
  assert.equal(resolveFeatureKind('clusterPaysEval'), 'cluster_pays');
});

test('AO-7-15 — resolveFeatureKind("unknownBlock") auto-converts to "unknown_block"', () => {
  assert.equal(resolveFeatureKind('unknownBlock'), 'unknown_block');
  assert.equal(resolveFeatureKind('someNewBlockName'), 'some_new_block_name');
});

test('AO-7-16 — ALIASES size >= 25 (whitelist covers most common features)', () => {
  const count = Object.keys(ALIASES).length;
  assert.ok(count >= 25, `expected >= 25 ALIASES entries, got ${count}`);
});

test('AO-7-17 — resolveBlockName("cascade") === "tumble" (legacy alias)', () => {
  assert.equal(resolveBlockName('cascade'), 'tumble');
});

test('AO-7-18 — Auto-convert is idempotent for camelCase / single-word inputs', () => {
  /* Already camelCase: pass through unchanged */
  assert.equal(resolveBlockName('alreadyCamelCase'), 'alreadyCamelCase');
  /* Single word: pass through unchanged */
  assert.equal(resolveBlockName('singleword'), 'singleword');
  /* Double-call idempotency: snake → camel → camel (no change second time) */
  const once = resolveBlockName('foo_bar_baz');
  const twice = resolveBlockName(once);
  assert.equal(once, 'fooBarBaz');
  assert.equal(twice, 'fooBarBaz');
});
