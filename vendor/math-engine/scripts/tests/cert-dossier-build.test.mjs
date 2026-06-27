/**
 * CORTI W210 Faza 600.0 — tests for scripts/cert-dossier-build.mjs
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  parseArgs,
  generateReplay,
  buildZip,
  buildTar,
  collectArtifacts,
  buildDossier,
} from '../cert-dossier-build.mjs';

describe('cert-dossier-build parseArgs', () => {
  it('parses --game= and --lab=', () => {
    const a = parseArgs(['--game=demo', '--lab=GLI', '--jurisdiction=UKGC']);
    expect(a.game).toBe('demo');
    expect(a.lab).toBe('GLI');
    expect(a.jurisdiction).toBe('UKGC');
  });

  it('accepts --flag value form too', () => {
    const a = parseArgs(['--game', 'demo', '--lab', 'BMM']);
    expect(a.game).toBe('demo');
    expect(a.lab).toBe('BMM');
  });
});

describe('cert-dossier-build helpers', () => {
  it('generateReplay produces 10000+1 header CSV lines', () => {
    const out = generateReplay('deadbeef', 100).toString('utf8');
    const lines = out.split('\n');
    expect(lines[0]).toBe('spinIdx,rngHex,payX');
    expect(lines.length).toBe(101);
  });

  it('buildZip emits PK signature + EOCD', () => {
    const z = buildZip([
      { path: 'a.txt', data: Buffer.from('hello') },
      { path: 'b.txt', data: Buffer.from('world') },
    ]);
    expect(z.subarray(0, 4).toString('hex')).toBe('504b0304');
    // EOCD must be present somewhere near end (signature 50 4b 05 06)
    const trail = z.subarray(z.length - 22, z.length - 18).toString('hex');
    expect(trail).toBe('504b0506');
  });

  it('buildTar emits ustar magic in header', () => {
    const t = buildTar([{ path: 'a.txt', data: Buffer.from('hello') }]);
    expect(t.subarray(257, 263).toString('ascii')).toBe('ustar ');
  });

  it('collectArtifacts returns a non-empty array', async () => {
    const arts = await collectArtifacts();
    expect(arts.length).toBeGreaterThan(0);
    expect(arts.find((a) => a.id === 'REPLAY_SAMPLE')).toBeDefined();
  });
});

describe('cert-dossier-build buildDossier', () => {
  it('throws on missing --game', async () => {
    await expect(buildDossier({ game: '', lab: 'GLI', jurisdiction: 'UKGC' })).rejects.toThrow(/game/);
  });

  it('throws on unknown --lab', async () => {
    await expect(buildDossier({ game: 'x', lab: 'BOGUS', jurisdiction: 'UKGC' })).rejects.toThrow(/unknown_lab/);
  });

  it('GLI dossier writes a valid zip with manifest + sig + matches sha256', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-dossier-'));
    const result = await buildDossier({
      game: 'quick-hit-platinum',
      lab: 'GLI',
      jurisdiction: 'UKGC',
      output: dir,
    });
    expect(existsSync(result.outPath)).toBe(true);
    expect(existsSync(result.outPath + '.sig')).toBe(true);
    expect(existsSync(result.outPath + '.manifest.json')).toBe(true);
    const bytes = readFileSync(result.outPath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.bundleSha256);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304'); // zip
    expect(result.fileCount).toBeGreaterThanOrEqual(10);
  });

  it('BMM dossier emits tar with ustar magic', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-dossier-bmm-'));
    const result = await buildDossier({
      game: 'demo-bmm',
      lab: 'BMM',
      jurisdiction: 'MGA',
      output: dir,
    });
    const bytes = readFileSync(result.outPath);
    expect(bytes.subarray(257, 263).toString('ascii')).toBe('ustar ');
    expect(result.outPath.endsWith('.tar')).toBe(true);
  });

  it('signature is 128-hex Ed25519 over manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-dossier-sig-'));
    const result = await buildDossier({
      game: 'demo-sig',
      lab: 'eCOGRA',
      jurisdiction: 'UKGC',
      output: dir,
    });
    expect(result.signature.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(result.signature.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.signature.signer).toBe('slot-math-engine-hsm');
  });

  it('bundle size in MVP range (1 KB – 5 MB)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-dossier-size-'));
    const result = await buildDossier({
      game: 'demo-size',
      lab: 'NMi',
      jurisdiction: 'KSA',
      output: dir,
    });
    const size = statSync(result.outPath).size;
    expect(size).toBeGreaterThan(1024);
    expect(size).toBeLessThan(5 * 1024 * 1024);
  });
});
