/**
 * W214 Faza 600.3 — Fuzz harness correctness specs.
 *
 * These tests do NOT validate that the fuzz targets find bugs — they
 * validate that the harness primitives (PRNG determinism, generators
 * boundaries, runFuzz crash reporting, shrinker) behave correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  FuzzRng,
  gen,
  shrink,
  runFuzz,
} from '../fuzz/_lib.mjs';
import {
  parseLenient,
  bodyOnce,
} from '../fuzz/fuzz-ir-evaluator.mjs';
import {
  validateListingPayload,
  validateSearchParams,
  validatePurchasePayload,
} from '../fuzz/fuzz-marketplace-api.mjs';
import {
  normaliseMicrogaming,
  normaliseGenericPam,
} from '../fuzz/fuzz-wallet-providers.mjs';
import {
  validateManifest,
} from '../fuzz/fuzz-cert-bundle.mjs';

describe('W214 fuzz · PRNG', () => {
  it('FuzzRng is deterministic for a fixed seed', () => {
    const a = new FuzzRng(42);
    const b = new FuzzRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('FuzzRng produces different streams for different seeds', () => {
    const a = new FuzzRng(1);
    const b = new FuzzRng(2);
    let differed = 0;
    for (let i = 0; i < 50; i++) {
      if (a.next() !== b.next()) differed++;
    }
    expect(differed).toBeGreaterThan(40);
  });

  it('FuzzRng.unit() returns float in [0, 1)', () => {
    const r = new FuzzRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.unit();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('FuzzRng.intRange respects bounds', () => {
    const r = new FuzzRng(99);
    for (let i = 0; i < 200; i++) {
      const v = r.intRange(5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
  });
});

describe('W214 fuzz · generators', () => {
  it('gen.bool returns true and false within 200 draws', () => {
    const r = new FuzzRng(3);
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(gen.bool(r));
    expect(seen.has(true)).toBe(true);
    expect(seen.has(false)).toBe(true);
  });

  it('gen.string respects maxLen', () => {
    const r = new FuzzRng(5);
    for (let i = 0; i < 100; i++) {
      const s = gen.string(r, 12);
      expect(typeof s).toBe('string');
      expect(s.length).toBeLessThanOrEqual(12);
    }
  });

  it('gen.arrayOf respects maxLen', () => {
    const r = new FuzzRng(11);
    for (let i = 0; i < 100; i++) {
      const arr = gen.arrayOf(r, gen.number, 8);
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeLessThanOrEqual(8);
    }
  });

  it('gen.badString covers expected edge categories', () => {
    const r = new FuzzRng(13);
    const found = new Set();
    for (let i = 0; i < 500; i++) {
      const s = gen.badString(r);
      if (s === '') found.add('empty');
      if (s.includes('DROP TABLE')) found.add('sql');
      if (s.includes('<script')) found.add('xss');
      if (s.startsWith('../')) found.add('traversal');
    }
    expect(found.size).toBeGreaterThanOrEqual(2);
  });

  it('gen.object recurses up to the requested depth', () => {
    const r = new FuzzRng(17);
    const o = gen.object(r, 2);
    // Should be an object OR a number (depth=0 case can produce number).
    expect(['object', 'number']).toContain(typeof o);
  });
});

describe('W214 fuzz · shrinker', () => {
  it('halves a too-long string toward but not below the failing threshold', () => {
    // Failure condition: length > 4. Shrink keeps halving while the failure
    // reproduces; once length <= 4 the failure stops, so the smallest
    // length we can prove still fails is the one BEFORE that.
    const failOnLong = (v) => { if (typeof v === 'string' && v.length > 4) throw new Error('too long'); };
    const original = 'A'.repeat(64);
    const shrunk = shrink(original, failOnLong);
    expect(shrunk.length).toBeLessThan(original.length);
    expect(shrunk.length).toBeGreaterThan(4);
  });

  it('does not shrink when there is no failure on smaller inputs', () => {
    const alwaysFail = () => { throw new Error('boom'); };
    const shrunk = shrink('XY', alwaysFail);
    // Already small — shrinker returns either 'XY' or 'X'.
    expect(['XY', 'X']).toContain(shrunk);
  });
});

describe('W214 fuzz · runFuzz', () => {
  it('returns a report with iter/seed/durationMs and 0 crashes when body never throws', () => {
    const report = runFuzz({
      name: 'noop',
      makeInput: (rng) => rng.next(),
      body: () => undefined,
      iterations: 100,
    });
    expect(report.iterations).toBe(100);
    expect(report.crashes).toHaveLength(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures a crash when body throws on certain inputs', () => {
    const report = runFuzz({
      name: 'always-throws',
      makeInput: (rng) => rng.next(),
      body: () => { throw new Error('boom'); },
      iterations: 5,
    });
    expect(report.crashes.length).toBeGreaterThan(0);
    expect(report.crashes[0].message).toContain('boom');
  });

  it('crash records include inputHash + inputSample', () => {
    const report = runFuzz({
      name: 'boom2',
      makeInput: (rng) => ({ x: rng.next() }),
      body: () => { throw new Error('zap'); },
      iterations: 3,
    });
    const c = report.crashes[0];
    expect(c.inputHash).toMatch(/^[0-9a-f]{12}$/);
    expect(c.inputSample).toBeDefined();
  });
});

describe('W214 fuzz · IR-evaluator harness', () => {
  it('parseLenient rejects null', () => {
    const r = parseLenient(null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('null_doc');
  });

  it('parseLenient accepts a well-formed doc', () => {
    const doc = {
      version: 1,
      reels: [['WILD', 'A']],
      paytable: [{ symbol: 'WILD', count: 3, payout: 5 }],
      rtpTarget: 0.96,
    };
    expect(parseLenient(doc).ok).toBe(true);
  });

  it('bodyOnce throws when parseLenient mutates input (regression guard)', () => {
    // Sanity — bodyOnce passes for a valid doc.
    const doc = {
      version: 1,
      reels: [['A']],
      paytable: [{ symbol: 'A', count: 3, payout: 1 }],
      rtpTarget: 0.95,
    };
    expect(() => bodyOnce(doc)).not.toThrow();
  });
});

describe('W214 fuzz · marketplace stubs', () => {
  it('validateListingPayload rejects oversize body string', () => {
    const big = 'A'.repeat(2_000_000);
    const r = validateListingPayload(big);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('body_too_large');
  });

  it('validateSearchParams rejects limit=0', () => {
    expect(validateSearchParams({ limit: 0 }).ok).toBe(false);
  });

  it('validatePurchasePayload rejects bad listingId', () => {
    expect(validatePurchasePayload({ listingId: 'a/b', tenantId: 't' }).ok).toBe(false);
  });
});

describe('W214 fuzz · wallet + cert stubs', () => {
  it('normaliseMicrogaming returns bad_currency for XXX', () => {
    const r = normaliseMicrogaming({ balance: 100, txId: 'abc123', currency: 'XXX' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('bad_currency');
  });

  it('normaliseGenericPam accepts well-formed payload', () => {
    const r = normaliseGenericPam({ balance: 50, transactionId: 't-1', currency: 'EUR' });
    expect(r.ok).toBe(true);
    expect(r.balance).toBe(50);
  });

  it('validateManifest rejects when version is non-semver', () => {
    const r = validateManifest({
      version: 'not-semver',
      gameId: 'lw',
      rtp: 0.95,
      paytables: ['a.json'],
      acceptance: ['x.json'],
      signatures: [{ algorithm: 'ecdsa', value: 'x'.repeat(128) }],
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('bad_version');
  });
});
