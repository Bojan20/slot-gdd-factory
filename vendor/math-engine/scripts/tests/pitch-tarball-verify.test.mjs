/**
 * W212 Faza 800.0 — pitch tarball verifier tests.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

import {
  parseArgs,
  parseTar,
  parseZip,
  extractArchive,
  verifyEntries,
  verifyTarball,
  sha256Hex,
  VERDICT_OK,
  VERDICT_FAIL,
  VERDICT_CORRUPT,
} from '../pitch/verify-pitch-tarball.mjs';
import {
  buildPitchTarball,
  buildTar,
} from '../pitch/build-pitch-tarball.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function tmpDir(label) {
  const d = resolve(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('pitch verify parseArgs', () => {
  it('takes tarball path as positional + flags', () => {
    const a = parseArgs(['node', 'x', '/tmp/foo.tar.gz', '--verbose']);
    expect(a.tarball).toBe('/tmp/foo.tar.gz');
    expect(a.verbose).toBe(true);
    expect(a.json).toBe(false);
  });

  it('parses --json flag', () => {
    const a = parseArgs(['node', 'x', '--json', '/tmp/x']);
    expect(a.tarball).toBe('/tmp/x');
    expect(a.json).toBe(true);
  });
});

describe('pitch verify — tar/zip parsing', () => {
  it('parseTar reads back what buildTar emitted', () => {
    const files = [
      { path: 'one.txt', data: Buffer.from('first') },
      { path: 'two.txt', data: Buffer.from('second') },
    ];
    const tar = buildTar(files);
    const back = parseTar(tar);
    expect(back.length).toBe(2);
    expect(back[0].path).toBe('one.txt');
    expect(back[0].data.toString('utf8')).toBe('first');
  });

  it('extractArchive auto-detects gzip via magic bytes', () => {
    const tar = buildTar([{ path: 'a', data: Buffer.from('hi') }]);
    const gz = gzipSync(tar);
    const entries = extractArchive('something-without-extension', gz);
    expect(entries.length).toBe(1);
    expect(entries[0].path).toBe('a');
  });

  it('parseTar throws on garbage input', () => {
    expect(() => parseTar(Buffer.from('garbage'))).toThrow();
  });
});

describe('pitch verify — verifyEntries verdicts', () => {
  function makeEntries(files) {
    const manifest = {
      schema: 'pitch-tarball-manifest-v1',
      files: files.map((f) => ({
        path: f.path,
        size: f.data.length,
        sha256: sha256Hex(f.data),
        mime: 'text/plain',
      })),
    };
    const manifestData = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return [
      ...files,
      { path: 'pitch-package/MANIFEST.json', data: manifestData },
    ];
  }

  it('returns OK when every file matches', () => {
    const entries = makeEntries([
      { path: 'pitch-package/a.txt', data: Buffer.from('aa') },
      { path: 'pitch-package/b.txt', data: Buffer.from('bb') },
    ]);
    const r = verifyEntries(entries);
    expect(r.verdict).toBe(VERDICT_OK);
    expect(r.filesChecked).toBe(2);
    expect(r.tampered.length).toBe(0);
    expect(r.missing.length).toBe(0);
    expect(r.extra.length).toBe(0);
  });

  it('detects tampered file (sha256 mismatch)', () => {
    const entries = makeEntries([
      { path: 'pitch-package/a.txt', data: Buffer.from('aa') },
    ]);
    // Mutate the file payload after manifest is built.
    entries[0].data = Buffer.from('AA');
    const r = verifyEntries(entries);
    expect(r.verdict).toBe(VERDICT_FAIL);
    expect(r.tampered.length).toBeGreaterThanOrEqual(1);
    expect(r.tampered[0].path).toBe('pitch-package/a.txt');
  });

  it('detects missing file', () => {
    const entries = makeEntries([
      { path: 'pitch-package/a.txt', data: Buffer.from('aa') },
      { path: 'pitch-package/b.txt', data: Buffer.from('bb') },
    ]);
    // Drop b.txt from the archive (leave it in the manifest).
    const reduced = entries.filter((e) => e.path !== 'pitch-package/b.txt');
    const r = verifyEntries(reduced);
    expect(r.verdict).toBe(VERDICT_FAIL);
    expect(r.missing).toContain('pitch-package/b.txt');
  });

  it('detects extra file (in archive but not manifest)', () => {
    const entries = makeEntries([
      { path: 'pitch-package/a.txt', data: Buffer.from('aa') },
    ]);
    entries.splice(0, 0, { path: 'pitch-package/extra.txt', data: Buffer.from('???') });
    const r = verifyEntries(entries);
    expect(r.verdict).toBe(VERDICT_FAIL);
    expect(r.extra).toContain('pitch-package/extra.txt');
  });

  it('returns CORRUPT when MANIFEST.json missing', () => {
    const r = verifyEntries([{ path: 'foo.txt', data: Buffer.from('x') }]);
    expect(r.verdict).toBe(VERDICT_CORRUPT);
    expect(r.reason).toMatch(/MANIFEST/);
  });

  it('returns CORRUPT when MANIFEST.json is malformed JSON', () => {
    const r = verifyEntries([
      { path: 'pitch-package/MANIFEST.json', data: Buffer.from('{not json') },
    ]);
    expect(r.verdict).toBe(VERDICT_CORRUPT);
  });
});

describe('pitch verify — end-to-end against a real tarball', () => {
  it('build → verify → OK', async () => {
    const out = await tmpDir('pitch-verify-e2e-ok');
    const r = await buildPitchTarball({ output: out, bundleVersion: 'v20990101' });
    const verdict = await verifyTarball(r.outputPath);
    expect(verdict.verdict).toBe(VERDICT_OK);
    expect(verdict.filesChecked).toBeGreaterThan(10);
  });

  it('tamper one byte → verifier reports FAIL', async () => {
    const out = await tmpDir('pitch-verify-e2e-fail');
    const r = await buildPitchTarball({
      output: out,
      format: 'tar', // skip gzip so we can mutate cleartext entries
      bundleVersion: 'v20990101',
    });
    // Read tar, mutate one byte of README, re-emit, then verify.
    const raw = await fs.readFile(r.outputPath);
    const entries = parseTar(raw);
    const readme = entries.find((e) => e.path === 'pitch-package/README.md');
    readme.data[10] ^= 0xff;
    const remixed = buildTar(entries);
    const tamperedPath = r.outputPath + '.tampered.tar';
    await fs.writeFile(tamperedPath, remixed);
    const verdict = await verifyTarball(tamperedPath);
    expect(verdict.verdict).toBe(VERDICT_FAIL);
    expect(verdict.tampered.length).toBeGreaterThan(0);
  });
});
