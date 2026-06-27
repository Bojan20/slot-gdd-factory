/**
 * W215 Faza 600.4 — Discovery runner correctness specs.
 */

import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveBudget,
  BUDGETS,
  runFuzzV2,
  CoverageMap,
  dedupKey,
  instrument,
  loadSeedCorpus,
  saveInterestingSeed,
} from '../fuzz/_lib-v2.mjs';

describe('W215 discovery · budget resolver', () => {
  it('synthetic mode → 10_000 iterations', () => {
    expect(resolveBudget('synthetic')).toBe(10_000);
  });
  it('discovery mode → 1_000_000 iterations', () => {
    expect(resolveBudget('discovery')).toBe(1_000_000);
  });
  it('exhaustive mode → 100_000_000 iterations', () => {
    expect(resolveBudget('exhaustive')).toBe(100_000_000);
  });
  it('numeric override is preserved', () => {
    expect(resolveBudget(42)).toBe(42);
  });
  it('unknown mode falls back to synthetic', () => {
    expect(resolveBudget('mystery')).toBe(BUDGETS.synthetic);
  });
  it('undefined falls back to synthetic', () => {
    expect(resolveBudget(undefined)).toBe(BUDGETS.synthetic);
  });
});

describe('W215 discovery · runFuzzV2 reports', () => {
  it('returns iterations + iterPerSec + branches', () => {
    const r = runFuzzV2({
      name: 'spec-noop',
      makeInput: (rng) => rng.next(),
      body: (_, cov) => cov.mark('branch:1'),
      budget: 200,
      maxWallMs: 5000,
    });
    expect(r.iterations).toBe(200);
    expect(typeof r.iterPerSec).toBe('number');
    expect(r.branches).toBeGreaterThanOrEqual(1);
    expect(r.uniqueCrashes).toBe(0);
  });

  it('captures crashes with dedup keys', () => {
    const r = runFuzzV2({
      name: 'spec-crash',
      makeInput: (rng) => rng.next(),
      body: () => { throw new Error('boom'); },
      budget: 10,
      maxWallMs: 5000,
    });
    expect(r.crashes.length).toBeGreaterThan(0);
    // All crashes should have a 16-hex dedup key.
    for (const c of r.crashes) {
      expect(c.key).toMatch(/^[0-9a-f]{16}$/);
    }
    // Should dedup to exactly 1 unique crash (same error, same stack).
    expect(r.uniqueCrashes).toBe(1);
  });

  it('respects maxWallMs as a circuit-breaker', () => {
    const start = Date.now();
    const r = runFuzzV2({
      name: 'spec-wallcap',
      makeInput: (rng) => rng.next(),
      body: (_, cov) => { cov.mark('x'); for (let k = 0; k < 1000; k++) Math.sqrt(k); },
      budget: 10_000_000,
      maxWallMs: 200,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(r.iterations).toBeLessThan(10_000_000);
  });
});

describe('W215 discovery · coverage map', () => {
  it('mark() accumulates hits', () => {
    const cov = new CoverageMap();
    cov.mark('a');
    cov.mark('a');
    cov.mark('b');
    expect(cov.size()).toBe(2);
    expect(cov.toJSON()).toEqual({ a: 2, b: 1 });
  });

  it('instrument() wraps a body fn with a cov param', () => {
    const { body, cov } = instrument((input, c) => { c.mark(input < 0.5 ? 'lo' : 'hi'); });
    body(0.3); body(0.7); body(0.4);
    expect(cov.size()).toBe(2);
  });
});

describe('W215 discovery · dedup key', () => {
  it('same kernel + same stack → same key', () => {
    expect(dedupKey('k', 'a\nb')).toBe(dedupKey('k', 'a\nb'));
  });
  it('different stacks → different keys', () => {
    expect(dedupKey('k', 'a\nb')).not.toBe(dedupKey('k', 'a\nc'));
  });
  it('different kernels → different keys', () => {
    expect(dedupKey('k1', 'a')).not.toBe(dedupKey('k2', 'a'));
  });
});

describe('W215 discovery · seed corpus persistence', () => {
  it('save → load round-trips an interesting seed', () => {
    const harness = `spec-corpus-${Date.now()}`;
    saveInterestingSeed(harness, 42, 'cov+1');
    const loaded = loadSeedCorpus(harness);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded[0].seed).toBe(42);
    expect(loaded[0].label).toBe('cov+1');
  });
});
