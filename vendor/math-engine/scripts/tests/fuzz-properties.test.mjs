/**
 * W215 Faza 600.4 — Property-based invariants tests.
 */

import { describe, it, expect } from 'vitest';
import {
  propDeterminism,
  propConservation,
  propIdempotency,
  propMonotonicity,
  propRoundTrip,
  ALL_PROPERTIES,
  runProperties,
} from '../fuzz/properties.mjs';

describe('W215 properties · determinism', () => {
  it('reports zero violations for the spin stub', () => {
    const r = propDeterminism(100);
    expect(r.property).toBe('determinism');
    expect(r.iterations).toBe(100);
    expect(r.violations).toHaveLength(0);
  });
  it('returns iteration count back to caller', () => {
    const r = propDeterminism(50);
    expect(r.iterations).toBe(50);
  });
});

describe('W215 properties · conservation', () => {
  it('reports zero violations for the spin pipeline', () => {
    const r = propConservation(100);
    expect(r.property).toBe('conservation');
    expect(r.violations).toHaveLength(0);
  });
  it('handles bet > balance gracefully (skip, not violate)', () => {
    const r = propConservation(200);
    // Some inputs are unable to debit (insufficient_funds) — they are skipped, not counted as violations.
    expect(r.violations.length).toBe(0);
  });
});

describe('W215 properties · idempotency', () => {
  it('debit + credit round-trip preserves balance', () => {
    const r = propIdempotency(100);
    expect(r.property).toBe('idempotency');
    expect(r.violations).toHaveLength(0);
  });
});

describe('W215 properties · monotonicity', () => {
  it('doubling the bet doubles the payout (within rounding)', () => {
    const r = propMonotonicity(100);
    expect(r.property).toBe('monotonicity');
    expect(r.violations).toHaveLength(0);
  });
});

describe('W215 properties · round-trip', () => {
  it('JWT sign → verify preserves the payload', () => {
    const r = propRoundTrip(100);
    expect(r.property).toBe('round_trip');
    expect(r.violations).toHaveLength(0);
  });
});

describe('W215 properties · runner', () => {
  it('ALL_PROPERTIES has 5 entries', () => {
    expect(ALL_PROPERTIES).toHaveLength(5);
  });
  it('runProperties returns aggregate with each property', () => {
    const summary = runProperties(20);
    expect(summary.results).toHaveLength(5);
    expect(summary.iterations).toBe(20);
    expect(summary.totalViolations).toBe(0);
  });
  it('property names are unique', () => {
    const summary = runProperties(10);
    const names = summary.results.map((r) => r.property);
    expect(new Set(names).size).toBe(names.length);
  });
});
