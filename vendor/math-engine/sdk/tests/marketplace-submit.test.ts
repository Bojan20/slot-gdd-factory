/**
 * @slot-math-engine/sdk — marketplace-submit tests.
 *
 * W209 Faza 500.0 — Agent A.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  submitKernel,
  validateManifest,
  validateKernelCode,
  manifestSkeleton,
  type KernelManifest,
} from '../index.js';

const VALID_MANIFEST: KernelManifest = {
  name: 'cascade-pyramid',
  version: '1.0.0',
  author: 'bojan-studio',
  license: 'MIT',
  p_id_target: 'P-CASCADE-MULT-PYRAMID-001',
  category: 'cascade',
  description: 'Cascade multiplier pyramid with geometric falloff.',
  math_summary: 'RTP = p_trigger * sum(m_i * (1-p_break)^i)',
  certification_level: 'verified',
};

const VALID_CODE = `
import { defineKernel } from '@slot-math-engine/sdk';
export const kernel = defineKernel({
  name: 'cascade-pyramid',
  version: '1.0.0',
  family: 'cascade',
  paramSpec: [{ key: 'p', type: 'number', min: 0, max: 1 }],
  closedForm: (ctx, params) => ({ rtp: (params.p as number) * 0.5, hitFrequency: 0.3 }),
});
`.trim();

describe('sdk · validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(() => validateManifest(VALID_MANIFEST)).not.toThrow();
  });

  it('rejects missing name', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, name: '' })).toThrow(/name required/);
  });

  it('rejects non-kebab-case name', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, name: 'BadName' })).toThrow(/kebab-case/);
  });

  it('rejects non-SemVer version', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, version: '1.0' })).toThrow(/SemVer/);
  });

  it('rejects unknown license', () => {
    // @ts-expect-error – intentional bad
    expect(() => validateManifest({ ...VALID_MANIFEST, license: 'WTFPL' })).toThrow(/license/);
  });

  it('rejects malformed p_id_target', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, p_id_target: 'cascade' })).toThrow(/p_id_target/);
  });

  it('rejects short description', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, description: 'short' })).toThrow(/description/);
  });

  it('rejects malformed dependency entry', () => {
    expect(() =>
      validateManifest({ ...VALID_MANIFEST, dependencies: [{ name: '', version: '1.0.0' }] })
    ).toThrow(/dependencies/);
  });
});

describe('sdk · validateKernelCode', () => {
  it('accepts a normal-looking kernel module', () => {
    expect(() => validateKernelCode(VALID_CODE)).not.toThrow();
  });

  it('rejects too-short code', () => {
    expect(() => validateKernelCode('abc')).toThrow(/too short/);
  });

  it('rejects reserved vendor terms', () => {
    expect(() =>
      validateKernelCode(VALID_CODE + '\n// from Vendor B catalogue\n')
    ).toThrow(/reserved term/);
  });
});

describe('sdk · submitKernel (mock path)', () => {
  it('returns a tracking id + mock verdict when no apiUrl provided', async () => {
    const r = await submitKernel(VALID_MANIFEST, VALID_CODE, 'my-author-token-x');
    expect(r.ok).toBe(true);
    expect(r.submissionId).toMatch(/^sub-[0-9a-f]{8}$/);
    expect(r.statusUrl).toContain('/mock/marketplace');
    expect(r.verdict?.gates.length).toBe(6);
    expect(r.verdict?.all_pass).toBe(true);
    expect(r.autoBadges).toContain('verified');
  });

  it('mock verdict flags Math.random() as non-deterministic', async () => {
    const badCode = VALID_CODE + '\nMath.random();';
    const r = await submitKernel(VALID_MANIFEST, badCode, 'my-author-token-x');
    const g = r.verdict?.gates.find((x) => x.name === 'determinism');
    expect(g?.pass).toBe(false);
    expect(r.verdict?.all_pass).toBe(false);
    expect(r.autoBadges).toEqual([]);
  });

  it('throws on missing/short authorToken', async () => {
    await expect(submitKernel(VALID_MANIFEST, VALID_CODE, '')).rejects.toThrow(/authorToken/);
    await expect(submitKernel(VALID_MANIFEST, VALID_CODE, 'tiny')).rejects.toThrow(/authorToken/);
  });

  it('throws when manifest is invalid (bubbles validateManifest)', async () => {
    await expect(
      submitKernel({ ...VALID_MANIFEST, name: '' }, VALID_CODE, 'my-author-token-x')
    ).rejects.toThrow(/name required/);
  });
});

describe('sdk · submitKernel (real apiUrl path)', () => {
  it('POSTs manifest+code to /api/marketplace/kernels/submit', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        submissionId: 'sub-srv00001',
        statusUrl: '/api/marketplace/submissions/sub-srv00001',
        verdict: { all_pass: true, gates: [], duration_ms: 800 },
        autoBadges: ['verified'],
        message: 'server says hi',
      }),
    });
    const r = await submitKernel(VALID_MANIFEST, VALID_CODE, 'my-author-token-x', {
      apiUrl: 'http://localhost:4000',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    expect(r.submissionId).toBe('sub-srv00001');
    expect(fakeFetch.mock.calls[0][0]).toBe('http://localhost:4000/api/marketplace/kernels/submit');
    const opts = fakeFetch.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(opts.headers['Authorization']).toBe('Bearer my-author-token-x');
    const body = JSON.parse(opts.body) as { manifest: KernelManifest };
    expect(body.manifest.name).toBe('cascade-pyramid');
  });

  it('throws ApiError-style on non-2xx', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'invalid' }),
    });
    await expect(
      submitKernel(VALID_MANIFEST, VALID_CODE, 'my-author-token-x', {
        apiUrl: 'http://x',
        fetch: fakeFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/422/);
  });
});

describe('sdk · manifestSkeleton', () => {
  it('returns a manifest that passes validateManifest after author edit', () => {
    const m = manifestSkeleton('bojan-studio');
    expect(m.author).toBe('bojan-studio');
    expect(() => validateManifest(m)).not.toThrow();
  });
});
