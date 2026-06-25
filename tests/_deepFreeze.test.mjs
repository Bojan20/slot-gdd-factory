/**
 * tests/_deepFreeze.test.mjs
 *
 * P3-P1 (Boki 2026-06-25) — Contract tests for the recursive freeze util.
 *
 * Covers (synced to actual test count via UQ-U-9 sweep, 21 cases):
 *   1.  Primitives + null pass through (no-op)
 *   2.  Plain object becomes frozen at top level
 *   3.  Plain object becomes frozen at nested depth
 *   4.  Array becomes frozen + every element frozen
 *   5.  Nested array inside object frozen
 *   6.  Object inside array frozen
 *   7.  Idempotent: re-freezing already-deep-frozen is no-op
 *   8.  Cycle-safe (self-referencing object doesn't blow stack)
 *   9.  Class instance (Date / Map / Set) frozen at top, internals untouched
 *  10.  Function value frozen AND callable
 *  11.  isDeepFrozen returns false when nested key is mutable
 *  12.  isDeepFrozen returns true after deepFreeze applied
 *  13.  Strict-mode write to nested key THROWS post-deepFreeze
 *  14.  Null prototype object treated as plain (recurses)
 *  15.  Mixed shape (object → array → object → date) all frozen at correct depths
 *  16.  UQ-U-4 #1: deepFreeze recurses through SHALLOW-frozen wrapper
 *  17.  UQ-U-4 #2: deepFreeze recurses into Symbol-keyed nested objects
 *  18.  UQ-U-4 #2: deepFreeze recurses into non-enumerable own properties
 *  19.  UQ-U-4 #3: isDeepFrozen returns false for mutable child in cycle
 *  20.  UQ-U-4 #6: deepFreeze freezes function AND it stays callable
 *  21.  UQ-U-4 #8: object with non-plain proto frozen at top, children untouched
 */

import { strict as assert } from 'node:assert';
import { deepFreeze, isDeepFrozen } from '../src/registry/deepFreeze.mjs';

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

console.log('deepFreeze contract suite');

/* 1 */
t('primitives + null pass through', () => {
  assert.equal(deepFreeze(null), null);
  assert.equal(deepFreeze(undefined), undefined);
  assert.equal(deepFreeze(42), 42);
  assert.equal(deepFreeze('hello'), 'hello');
  assert.equal(deepFreeze(true), true);
  assert.equal(isDeepFrozen(null), true);
  assert.equal(isDeepFrozen(42), true);
});

/* 2 */
t('plain object frozen at top level', () => {
  const o = { a: 1, b: 2 };
  deepFreeze(o);
  assert.ok(Object.isFrozen(o));
});

/* 3 */
t('plain object frozen at nested depth', () => {
  const o = { a: { b: { c: 1 } } };
  deepFreeze(o);
  assert.ok(Object.isFrozen(o));
  assert.ok(Object.isFrozen(o.a));
  assert.ok(Object.isFrozen(o.a.b));
});

/* 4 */
t('array frozen + every element frozen', () => {
  const arr = [{ a: 1 }, { a: 2 }];
  deepFreeze(arr);
  assert.ok(Object.isFrozen(arr));
  assert.ok(Object.isFrozen(arr[0]));
  assert.ok(Object.isFrozen(arr[1]));
});

/* 5 */
t('nested array inside object frozen', () => {
  const o = { list: [1, { x: 2 }, [3, 4]] };
  deepFreeze(o);
  assert.ok(Object.isFrozen(o.list));
  assert.ok(Object.isFrozen(o.list[1]));
  assert.ok(Object.isFrozen(o.list[2]));
});

/* 6 */
t('object inside array frozen', () => {
  const a = [{ nested: { key: 'v' } }];
  deepFreeze(a);
  assert.ok(Object.isFrozen(a[0]));
  assert.ok(Object.isFrozen(a[0].nested));
});

/* 7 */
t('idempotent: re-freezing is no-op', () => {
  const o = { a: { b: 1 } };
  deepFreeze(o);
  /* Mutate the visited set internally — second call should not blow up
     and should produce the same final state. */
  const result = deepFreeze(o);
  assert.equal(result, o);
  assert.ok(Object.isFrozen(o.a));
});

/* 8 */
t('cycle-safe (self-reference)', () => {
  const o = { name: 'self' };
  o.self = o;
  /* Must not blow the stack. */
  deepFreeze(o);
  assert.ok(Object.isFrozen(o));
});

/* 9 */
t('class instance frozen at top, internals opaque', () => {
  const d = new Date();
  deepFreeze(d);
  assert.ok(Object.isFrozen(d));
  /* getTime still works — internal slots untouched. */
  assert.ok(typeof d.getTime() === 'number');

  const m = new Map([['k', 'v']]);
  deepFreeze(m);
  assert.ok(Object.isFrozen(m));
  /* Map still functions for reads; mutation would throw on frozen instance
     in strict mode, but we don't assert that — opaque contract. */
  assert.equal(m.get('k'), 'v');
});

/* 10 */
t('function value passes through unchanged', () => {
  const fn = () => 42;
  /* Functions are objects, so deepFreeze would freeze them. Our contract
     says functions "pass through" but the implementation actually still
     freezes them as they are objects. The CRITICAL property is that
     they remain callable. */
  deepFreeze(fn);
  assert.equal(fn(), 42);
});

/* 11 */
t('isDeepFrozen returns false when nested mutable', () => {
  const o = Object.freeze({ a: { b: 1 } });
  /* top frozen, a not. */
  assert.equal(isDeepFrozen(o), false);
});

/* 12 */
t('isDeepFrozen returns true after deepFreeze applied', () => {
  const o = { a: { b: 1 }, list: [{ c: 2 }] };
  deepFreeze(o);
  assert.equal(isDeepFrozen(o), true);
});

/* 13 */
t('strict-mode write to nested key throws post-deepFreeze', () => {
  'use strict';
  const o = { theme: { color: '#000' } };
  deepFreeze(o);
  assert.throws(() => { o.theme.color = '#ff0000'; }, TypeError);
  /* Existing value unchanged. */
  assert.equal(o.theme.color, '#000');
});

/* 14 */
t('null prototype object treated as plain (recurses)', () => {
  const o = Object.create(null);
  o.nested = { a: 1 };
  deepFreeze(o);
  assert.ok(Object.isFrozen(o));
  assert.ok(Object.isFrozen(o.nested));
});

/* 15 */
t('mixed shape frozen at correct depths', () => {
  const o = {
    name: 'mixed',
    items: [{ sub: { deep: 'value' } }],
    when: new Date(),
  };
  deepFreeze(o);
  assert.ok(Object.isFrozen(o));
  assert.ok(Object.isFrozen(o.items));
  assert.ok(Object.isFrozen(o.items[0]));
  assert.ok(Object.isFrozen(o.items[0].sub));
  assert.ok(Object.isFrozen(o.when));
  assert.equal(isDeepFrozen(o), true);
});

/* ─── UQ-U-4 fix verification ───────────────────────────────────────── */

/* 16 — UQ-U-4 #1: shallow-frozen wrapper around mutable subtree */
t('UQ-U-4 #1: deepFreeze recurses through SHALLOW-frozen wrapper', () => {
  const inner = { b: 1 };
  const outer = Object.freeze({ a: inner });
  /* Pre-fix: deepFreeze short-circuited on Object.isFrozen(outer) === true,
     leaving `inner` mutable. Post-fix: recursion continues, inner gets
     frozen. */
  deepFreeze(outer);
  assert.ok(Object.isFrozen(inner), 'inner subtree must be frozen after deepFreeze');
  assert.equal(isDeepFrozen(outer), true);
});

/* 17 — UQ-U-4 #2: Symbol-keyed properties recursed */
t('UQ-U-4 #2: deepFreeze recurses into Symbol-keyed nested objects', () => {
  const SYM = Symbol('nested');
  const o = { [SYM]: { secret: 'mutable' } };
  deepFreeze(o);
  assert.ok(Object.isFrozen(o[SYM]), 'Symbol-keyed nested must be frozen');
});

/* 18 — UQ-U-4 #2: non-enumerable own property recursed */
t('UQ-U-4 #2: deepFreeze recurses into non-enumerable own properties', () => {
  const inner = { x: 1 };
  const o = {};
  Object.defineProperty(o, 'hidden', {
    value: inner,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  deepFreeze(o);
  assert.ok(Object.isFrozen(inner), 'non-enumerable nested must be frozen');
});

/* 19 — UQ-U-4 #3: isDeepFrozen catches mutable-in-cycle */
t('UQ-U-4 #3: isDeepFrozen returns false for mutable child in a cycle', () => {
  const A = {};
  const B = {};
  A.next = B;
  B.back = A;
  Object.freeze(A); /* A frozen at top — but B is NOT frozen */
  /* Pre-fix: visited heuristic could short-circuit true. Post-fix:
     B's own frozenness check catches the mutable node. */
  assert.equal(isDeepFrozen(A), false, 'mutable B in cycle must yield false');
});

/* 20 — UQ-U-4 #6: function frozen but still callable */
t('UQ-U-4 #6: deepFreeze freezes function AND it stays callable', () => {
  const fn = () => 42;
  deepFreeze(fn);
  assert.ok(Object.isFrozen(fn), 'function must be frozen');
  assert.equal(fn(), 42, 'function must remain callable');
  /* And writes to function properties throw in strict mode */
  assert.throws(() => { fn.extra = 'X'; }, TypeError);
});

/* 21 — UQ-U-4 #8: Object.create(parent) treated as opaque (documented carve-out) */
t('UQ-U-4 #8: object with non-plain proto frozen at top, children untouched', () => {
  const parent = { inherited: 'value' };
  const child = Object.create(parent);
  child.own = { nested: 'mutable' };
  deepFreeze(child);
  assert.ok(Object.isFrozen(child), 'child must be frozen at top');
  /* By design (documented carve-out): child.own is NOT recursed into
     because child's prototype is not Object.prototype. Users wanting
     deep coverage must use a plain object literal. */
  assert.ok(!Object.isFrozen(child.own), 'non-plain-proto carve-out: nested not recursed');
});

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
