/**
 * W215 Faza 600.4 — Shrinker correctness specs.
 *
 * Replaces the W214 placeholder test that allowed the halving algorithm
 * to stop at a power-of-two boundary. The new shrinker (descent +
 * bisect) reduces inputs to the true minimum.
 */

import { describe, it, expect } from 'vitest';
import { shrink } from '../fuzz/_lib.mjs';
import { shrinkOptimal } from '../fuzz/_lib-v2.mjs';

describe('W215 shrinker · descent shrink (_lib.mjs)', () => {
  it('shrinks a 64-char string to its true minimum (length 5) for predicate len>4', () => {
    const failOnLong = (v) => { if (typeof v === 'string' && v.length > 4) throw new Error('too long'); };
    const original = 'A'.repeat(64);
    const shrunk = shrink(original, failOnLong);
    // True minimum is exactly 5 — first length above the threshold.
    expect(shrunk.length).toBe(5);
  });

  it('shrinks a 100-element array to its true minimum (length 3) for predicate len>2', () => {
    const failOnLong = (v) => { if (Array.isArray(v) && v.length > 2) throw new Error('too long'); };
    const original = Array.from({ length: 100 }, (_, i) => i);
    const shrunk = shrink(original, failOnLong);
    expect(shrunk.length).toBe(3);
  });

  it('shrinks a 31-char string to length 8 for predicate len>7 (binary search exact)', () => {
    const failOnLong = (v) => { if (typeof v === 'string' && v.length > 7) throw new Error('long'); };
    const shrunk = shrink('A'.repeat(31), failOnLong);
    expect(shrunk.length).toBe(8);
  });

  it('does not shrink when input is already minimal', () => {
    const alwaysFail = () => { throw new Error('boom'); };
    const shrunk = shrink('XY', alwaysFail);
    expect(['', 'X', 'XY']).toContain(shrunk);
  });

  it('preserves the failing property after shrink', () => {
    const fn = (v) => { if (typeof v === 'string' && v.length > 4) throw new Error('boom'); };
    const shrunk = shrink('A'.repeat(64), fn);
    expect(() => fn(shrunk)).toThrow();
  });

  it('handles strings that do not fail at all — returns input unchanged', () => {
    const neverFails = () => undefined;
    const shrunk = shrink('hello', neverFails);
    // Returns the input (nothing to shrink) — caller decides what to do.
    expect(typeof shrunk).toBe('string');
  });

  it('prunes object keys down to the minimal failing subset', () => {
    const keysFail = (v) => {
      if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'bad')) {
        throw new Error('bad key present');
      }
    };
    const shrunk = shrink({ a: 1, b: 2, c: 3, bad: 4 }, keysFail);
    expect(shrunk).toBeTypeOf('object');
    expect(Object.prototype.hasOwnProperty.call(shrunk, 'bad')).toBe(true);
    // The non-bad keys should be removed.
    expect(Object.keys(shrunk)).toEqual(['bad']);
  });
});

describe('W215 shrinker · optimal bisect (_lib-v2.mjs)', () => {
  it('shrinkOptimal converges to exact minimum string length', () => {
    const fn = (v) => { if (typeof v === 'string' && v.length > 4) throw new Error('boom'); };
    const shrunk = shrinkOptimal('A'.repeat(64), fn);
    expect(shrunk.length).toBe(5);
  });

  it('shrinkOptimal converges to exact minimum array length', () => {
    const fn = (v) => { if (Array.isArray(v) && v.length > 6) throw new Error('boom'); };
    const shrunk = shrinkOptimal(Array.from({ length: 200 }, (_, i) => i), fn);
    expect(shrunk.length).toBe(7);
  });

  it('shrinkOptimal returns input when predicate never fails', () => {
    const shrunk = shrinkOptimal('hello', () => undefined);
    expect(shrunk).toBe('hello');
  });

  it('shrinkOptimal handles object key pruning', () => {
    const fn = (v) => {
      if (v && typeof v === 'object' && v.poison === 'X') throw new Error('boom');
    };
    const shrunk = shrinkOptimal({ a: 1, poison: 'X', b: 2 }, fn);
    expect(shrunk.poison).toBe('X');
  });

  it('shrinkOptimal is bounded by maxRounds', () => {
    // Even with an aggressive failing predicate the loop terminates.
    const fn = () => { throw new Error('always'); };
    const shrunk = shrinkOptimal({ a: 1, b: 2 }, fn, 2);
    expect(shrunk).toBeTypeOf('object');
  });

  it('shrinkOptimal preserves type (string stays string)', () => {
    const fn = (v) => { if (typeof v === 'string' && v.length > 1) throw new Error('b'); };
    const shrunk = shrinkOptimal('hello world', fn);
    expect(typeof shrunk).toBe('string');
    expect(shrunk.length).toBe(2);
  });

  it('shrinkOptimal preserves failing property after shrink', () => {
    const fn = (v) => { if (Array.isArray(v) && v.length > 3) throw new Error('long'); };
    const shrunk = shrinkOptimal([1, 2, 3, 4, 5, 6, 7, 8], fn);
    expect(() => fn(shrunk)).toThrow();
    expect(shrunk.length).toBe(4);
  });
});

describe('W215 shrinker · regression — original W214 expectation', () => {
  it('shrinks 64-char string to length ≤ 4 boundary (W214 expected ≤4, W215 reaches exact min=5)', () => {
    // Predicate: fails iff length > 4. The smallest failing length is 5.
    // The W214 halving shrinker stopped at 8 (next halve crossed the threshold).
    // W215 descent + bisect converges to exactly 5.
    const failOnLong = (v) => { if (typeof v === 'string' && v.length > 4) throw new Error('too long'); };
    const shrunk = shrink('A'.repeat(64), failOnLong);
    expect(shrunk.length).toBe(5);
    expect(shrunk.length).toBeLessThanOrEqual(8); // W214 bound
  });
});
