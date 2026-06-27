/**
 * W213 Faza 700.1 — CDN distribute tests.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  distributeToCdn,
  buildCdnIndex,
  verifyCdnIndex,
  generateSignedUrl,
  CDN_INDEX_SCHEMA,
  DEFAULT_BASE_URL,
} from '../pitch/cdn-distribute.mjs';

async function tmpCdn() {
  const d = resolve(tmpdir(), `cdn-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('cdn-distribute — generateSignedUrl', () => {
  it('produces a URL with expires + sig params', () => {
    const r = generateSignedUrl({
      operatorId: 'aristocrat',
      bundleVersion: 'v20990101',
      now: '2099-01-01T00:00:00.000Z',
    });
    expect(r.url).toContain('/aristocrat/v20990101.tar.gz');
    expect(r.url).toContain('expires=');
    expect(r.url).toContain('sig=');
    expect(r.signature.length).toBe(32);
  });

  it('signed URL is deterministic for the same inputs', () => {
    const a = generateSignedUrl({ operatorId: 'lw', bundleVersion: 'v1', now: '2099-01-01T00:00:00.000Z' });
    const b = generateSignedUrl({ operatorId: 'lw', bundleVersion: 'v1', now: '2099-01-01T00:00:00.000Z' });
    expect(a.url).toBe(b.url);
  });

  it('throws on missing operatorId / bundleVersion', () => {
    expect(() => generateSignedUrl({ bundleVersion: 'x' })).toThrow();
    expect(() => generateSignedUrl({ operatorId: 'x' })).toThrow();
  });
});

describe('cdn-distribute — distributeToCdn', () => {
  it('writes per-operator directory layout + index.json', async () => {
    const root = await tmpCdn();
    const r = await distributeToCdn({
      root,
      tarballs: [
        { operatorId: 'aristocrat', bundleVersion: 'v20990101', data: Buffer.from('A'.repeat(100)) },
        { operatorId: 'lw',         bundleVersion: 'v20990101', data: Buffer.from('L'.repeat(200)) },
      ],
      now: '2099-01-01T00:00:00.000Z',
    });
    expect(existsSync(resolve(root, 'pitch/aristocrat/v20990101.tar.gz'))).toBe(true);
    expect(existsSync(resolve(root, 'pitch/lw/v20990101.tar.gz'))).toBe(true);
    expect(existsSync(resolve(root, 'index.json'))).toBe(true);
    expect(r.entries.length).toBe(2);
    expect(r.index.schema).toBe(CDN_INDEX_SCHEMA);
  });

  it('records correct size + sha256 for each upload', async () => {
    const root = await tmpCdn();
    const data = Buffer.from('hello world');
    const r = await distributeToCdn({
      root,
      tarballs: [{ operatorId: 'lw', bundleVersion: 'v1', data }],
    });
    expect(r.entries[0].size).toBe(data.length);
    expect(r.entries[0].sha256).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
  });
});

describe('cdn-distribute — buildCdnIndex + verifyCdnIndex', () => {
  it('buildCdnIndex sorts by operatorId', () => {
    const entries = [
      { operatorId: 'lw', bundleVersion: 'v1', size: 100, sha256: 'a'.repeat(64),
        url: 'https://x/pitch/lw/v1.tar.gz?expires=1&sig=aa', signature: 'aa' },
      { operatorId: 'aristocrat', bundleVersion: 'v1', size: 100, sha256: 'b'.repeat(64),
        url: 'https://x/pitch/aristocrat/v1.tar.gz?expires=1&sig=bb', signature: 'bb' },
    ];
    const idx = buildCdnIndex(entries);
    expect(idx.bundles[0].operatorId).toBe('aristocrat');
    expect(idx.bundles[1].operatorId).toBe('lw');
    expect(idx.bundleCount).toBe(2);
  });

  it('verifyCdnIndex passes for a freshly built index', async () => {
    const root = await tmpCdn();
    const r = await distributeToCdn({
      root,
      tarballs: [
        { operatorId: 'aristocrat', bundleVersion: 'v1', data: Buffer.from('a') },
      ],
      now: '2099-01-01T00:00:00.000Z',
    });
    const v = verifyCdnIndex(r.index);
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
  });

  it('verifyCdnIndex detects tampered signature', async () => {
    const root = await tmpCdn();
    const r = await distributeToCdn({
      root,
      tarballs: [{ operatorId: 'aristocrat', bundleVersion: 'v1', data: Buffer.from('a') }],
      now: '2099-01-01T00:00:00.000Z',
    });
    r.index.bundles[0].signature = '00'.repeat(16);
    const v = verifyCdnIndex(r.index);
    expect(v.ok).toBe(false);
    expect(v.issues.join('\n')).toMatch(/signature mismatch/);
  });
});
