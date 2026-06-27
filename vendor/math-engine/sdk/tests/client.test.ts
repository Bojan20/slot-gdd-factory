/**
 * @slot-math-engine/sdk — client + IRBuilder + kernel-author tests.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SlotMathClient,
  IRBuilder,
  defineKernel,
  validateParams,
  defaultMC,
  SDK_VERSION,
} from '../index.js';
import type { IRDocument, KernelDefinition } from '../index.js';

describe('sdk · SDK_VERSION', () => {
  it('exposes a SemVer-shaped version string', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('sdk · IRBuilder', () => {
  it('builds a minimal valid IR', () => {
    const ir = new IRBuilder()
      .gameId('test-1')
      .topology({ kind: 'rectangular', reels: 5, rows: 3 })
      .symbolPool({ HP: 3, MP: 3, LP: 3 })
      .build();
    expect(ir.gameId).toBe('test-1');
    expect(ir.topology.reels).toBe(5);
    expect(ir.symbols.HP).toBe(3);
    expect(ir.schemaVersion).toBe('2.0');
  });

  it('chains features into the document', () => {
    const ir = new IRBuilder()
      .gameId('t')
      .topology({ kind: 'rectangular', reels: 5, rows: 3 })
      .symbolPool({ A: 1 })
      .feature('free_spins', { trigger: 3, count: 10 })
      .feature('respin', { count: 1 })
      .build();
    expect(ir.features?.free_spins?.count).toBe(10);
    expect(ir.features?.respin?.count).toBe(1);
  });

  it('throws when gameId is missing', () => {
    const b = new IRBuilder()
      .topology({ kind: 'rectangular', reels: 5, rows: 3 })
      .symbolPool({ A: 1 });
    expect(() => b.build()).toThrow(/gameId/);
  });

  it('throws when topology is missing', () => {
    const b = new IRBuilder().gameId('x').symbolPool({ A: 1 });
    expect(() => b.build()).toThrow(/topology/);
  });

  it('throws on empty symbol pool', () => {
    const b = new IRBuilder()
      .gameId('x')
      .topology({ kind: 'rectangular', reels: 5, rows: 3 })
      .symbolPool({});
    expect(() => b.build()).toThrow(/symbolPool/);
  });

  it('accepts rtpTarget + jurisdictions + metadata', () => {
    const ir = new IRBuilder()
      .gameId('x')
      .topology({ kind: 'rectangular', reels: 5, rows: 3 })
      .symbolPool({ A: 1 })
      .rtpTarget(0.955)
      .jurisdictions(['UKGC', 'MGA'])
      .metadata({ author: 'me' })
      .build();
    expect(ir.rtpTarget).toBe(0.955);
    expect(ir.jurisdictions).toEqual(['UKGC', 'MGA']);
    expect(ir.metadata?.author).toBe('me');
  });
});

describe('sdk · SlotMathClient', () => {
  it('throws when apiUrl is missing', () => {
    // @ts-expect-error – intentional bad call
    expect(() => new SlotMathClient({})).toThrow(/apiUrl/);
  });

  it('strips trailing slash from apiUrl', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, name: 'x', version: '1' }),
    });
    const c = new SlotMathClient({ apiUrl: 'http://x/', fetch: fakeFetch as unknown as typeof fetch });
    await c.health();
    expect(fakeFetch).toHaveBeenCalledWith(
      'http://x/api/health',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('passes apiKey via x-api-key header when set', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    });
    const c = new SlotMathClient({ apiUrl: 'http://x', apiKey: 'KEY', fetch: fakeFetch as unknown as typeof fetch });
    await c.health();
    expect(fakeFetch.mock.calls[0][1].headers['x-api-key']).toBe('KEY');
  });

  it('computeRTP posts IR document', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ rtp: 0.955, hitFrequency: 0.3, variance: 1.2, method: 'closed-form' }),
    });
    const c = new SlotMathClient({ apiUrl: 'http://x', fetch: fakeFetch as unknown as typeof fetch });
    const ir: IRDocument = {
      schemaVersion: '2.0', gameId: 'g', topology: { kind: 'rectangular', reels: 5, rows: 3 }, symbols: { A: 1 },
    };
    const r = await c.computeRTP(ir);
    expect(r.rtp).toBeCloseTo(0.955);
    expect(fakeFetch.mock.calls[0][0]).toBe('http://x/api/gaas/compute-rtp');
  });

  it('throws ApiError on non-2xx', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: 'not_found' }),
    });
    const c = new SlotMathClient({ apiUrl: 'http://x', fetch: fakeFetch as unknown as typeof fetch });
    await expect(c.health()).rejects.toThrow(/404/);
  });

  it('seamlessHandshake encodes operatorId', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        operatorId: 'op&1', walletEndpoint: 'x', spinEndpoint: 'y', publicKey: 'p', timestamp: 't',
      }),
    });
    const c = new SlotMathClient({ apiUrl: 'http://x', fetch: fakeFetch as unknown as typeof fetch });
    await c.seamlessHandshake('op&1');
    expect(fakeFetch.mock.calls[0][0]).toContain('operatorId=op%261');
  });
});

describe('sdk · defineKernel + validateParams', () => {
  const k: KernelDefinition<{ p: number; n: number }> = defineKernel({
    name: 'demo',
    version: '1.0.0',
    family: 'cascade',
    paramSpec: [
      { key: 'p', type: 'number', min: 0, max: 1 },
      { key: 'n', type: 'integer', min: 1, max: 100 },
    ],
    closedForm: (_ctx, params) => ({ rtp: params.p * params.n * 0.5, hitFrequency: params.p }),
  });

  it('defineKernel preserves all definition fields', () => {
    expect(k.name).toBe('demo');
    expect(k.family).toBe('cascade');
    expect(k.paramSpec.length).toBe(2);
  });

  it('closedForm returns deterministic RTP', () => {
    const ctx = { rng: () => 0.5, bet: 1, symbolPool: { A: 1 } };
    const r = k.closedForm(ctx, { p: 0.5, n: 10 });
    expect(r.rtp).toBeCloseTo(2.5);
    expect(r.hitFrequency).toBeCloseTo(0.5);
  });

  it('validateParams accepts valid params', () => {
    expect(() => validateParams(k.paramSpec, { p: 0.5, n: 10 })).not.toThrow();
  });

  it('validateParams rejects out-of-range numbers', () => {
    expect(() => validateParams(k.paramSpec, { p: 1.5, n: 10 })).toThrow(/above max/);
  });

  it('validateParams rejects wrong type', () => {
    expect(() => validateParams(k.paramSpec, { p: 0.5, n: 1.5 })).toThrow(/integer/);
  });

  it('defaultMC produces a Monte-Carlo average', () => {
    const ctx = { rng: () => 0.5, bet: 1, symbolPool: { A: 1 } };
    const mc = defaultMC(k, ctx, { p: 0.4, n: 10 }, 1000);
    expect(mc.rtp).toBeCloseTo(2.0, 4);
    expect(mc.hitFrequency).toBeCloseTo(1.0);
  });
});
