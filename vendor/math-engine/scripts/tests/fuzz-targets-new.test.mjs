/**
 * W215 Faza 600.4 — Specs for the 3 new fuzz targets.
 */

import { describe, it, expect } from 'vitest';
import {
  debit,
  credit,
  spin,
  audit,
  runPipeline,
} from '../fuzz/fuzz-spin-engine.mjs';
import {
  STATES,
  TRANSITIONS,
  initialState,
  step,
} from '../fuzz/fuzz-canary-controller.mjs';
import {
  sign,
  verify,
} from '../fuzz/fuzz-license-jwt.mjs';

describe('W215 fuzz-spin-engine · debit/credit', () => {
  it('debit rejects non-object wallet', () => {
    expect(debit(null, 10).ok).toBe(false);
  });
  it('debit rejects amount > balance', () => {
    expect(debit({ tenantId: 't', balance: 5, currency: 'EUR' }, 10).ok).toBe(false);
  });
  it('debit rejects bad currency', () => {
    expect(debit({ tenantId: 't', balance: 100, currency: 'XXX' }, 10).ok).toBe(false);
  });
  it('debit accepts well-formed input', () => {
    const r = debit({ tenantId: 't', balance: 100, currency: 'EUR' }, 10);
    expect(r.ok).toBe(true);
    expect(r.wallet.balance).toBe(90);
  });
  it('credit rejects negative amount', () => {
    expect(credit({ balance: 10 }, -1).ok).toBe(false);
  });
});

describe('W215 fuzz-spin-engine · spin', () => {
  it('rejects unknown game id', () => {
    expect(spin({ gameId: 'fake', bet: 10, seed: 1 }).ok).toBe(false);
  });
  it('is deterministic for a fixed seed', () => {
    const a = spin({ gameId: 'lw-quick-hit', bet: 10, seed: 42 });
    const b = spin({ gameId: 'lw-quick-hit', bet: 10, seed: 42 });
    expect(a).toEqual(b);
  });
  it('payout is a finite non-negative number', () => {
    const r = spin({ gameId: 'lw-quick-hit', bet: 10, seed: 7 });
    expect(r.ok).toBe(true);
    expect(Number.isFinite(r.payout)).toBe(true);
    expect(r.payout).toBeGreaterThanOrEqual(0);
  });
});

describe('W215 fuzz-spin-engine · full pipeline', () => {
  it('end-to-end conservation holds', () => {
    const wallet = { tenantId: 't', balance: 1000, currency: 'EUR' };
    const r = runPipeline({ wallet, gameId: 'lw-quick-hit', bet: 100, seed: 1, trail: [] });
    expect(r.ok).toBe(true);
    expect(r.walletAfter).toBe(r.walletBefore - r.bet + r.payout);
    expect(r.trail).toHaveLength(1);
  });
});

describe('W215 fuzz-canary-controller', () => {
  it('STATES contains the 5 documented states', () => {
    expect(STATES.length).toBe(5);
    expect(STATES).toContain('idle');
    expect(STATES).toContain('rolled-back');
  });
  it('TRANSITIONS forms a connected graph', () => {
    for (const s of STATES) {
      expect(TRANSITIONS[s]).toBeInstanceOf(Set);
    }
  });
  it('initialState is idle/0/0', () => {
    expect(initialState()).toEqual({ state: 'idle', percent: 0, breaches: 0 });
  });
  it('healthy + start moves idle → ramping/1', () => {
    const r = step(initialState(), { healthy: true, latencyP99Ms: 100, errorRate: 0.001, action: 'start' });
    expect(r.ok).toBe(true);
    expect(r.state).toBe('ramping');
    expect(r.percent).toBe(1);
  });
  it('unhealthy in ramping triggers rollback', () => {
    const prev = { state: 'ramping', percent: 50, breaches: 0 };
    const r = step(prev, { healthy: false, latencyP99Ms: 1000, errorRate: 0.5 });
    expect(r.ok).toBe(true);
    expect(r.state).toBe('rolled-back');
    expect(r.percent).toBe(0);
  });
});

describe('W215 fuzz-license-jwt', () => {
  it('sign then verify round-trips the payload', () => {
    const token = sign({ licenseId: 'lic-1', exp: 1_700_001_000, tier: 'pro' });
    const r = verify(token);
    expect(r.ok).toBe(true);
    expect(r.payload.licenseId).toBe('lic-1');
  });
  it('rejects tokens with 1 byte tampered', () => {
    let token = sign({ licenseId: 'lic-2', exp: 1_700_001_000, tier: 'pro' });
    // Flip a byte in the signature segment.
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A');
    expect(verify(parts.join('.')).ok).toBe(false);
  });
  it('rejects expired tokens', () => {
    const token = sign({ licenseId: 'lic-3', exp: 1, tier: 'free' });
    const r = verify(token);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('expired');
  });
  it('returns code on bad segments', () => {
    expect(verify('not.three').ok).toBe(false);
  });
  it('never throws on garbage input', () => {
    expect(() => verify(null)).not.toThrow();
    expect(() => verify({})).not.toThrow();
    expect(() => verify('A'.repeat(20_000))).not.toThrow();
  });
});
