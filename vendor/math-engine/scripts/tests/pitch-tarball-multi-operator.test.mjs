/**
 * W213 Faza 700.1 — multi-operator pitch tarball tests.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { buildPitchTarball, parseArgs, rebrandEntry } from '../pitch/build-pitch-tarball.mjs';
import { parseTar } from '../pitch/verify-pitch-tarball.mjs';
import { loadOperatorManifest } from '../pitch/operator-branding.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function tmpDir(label) {
  const d = resolve(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

async function buildFor(operatorId, opts = {}) {
  const out = await tmpDir(`mo-${operatorId}`);
  const r = await buildPitchTarball({
    output: out,
    operatorId,
    bundleVersion: opts.bundleVersion ?? 'v20990101',
    dryRun: false,
  });
  return r;
}

describe('multi-operator parseArgs', () => {
  it('parses --operator=aristocrat as a slug into operatorId', () => {
    const a = parseArgs(['node', 'x', '--operator=aristocrat']);
    expect(a.operatorId).toBe('aristocrat');
  });

  it('parses --operator=Vendor B as legacy free-text label', () => {
    const a = parseArgs(['node', 'x', '--operator=Vendor B']);
    expect(a.operatorId).toBeNull();
    expect(a.operator).toBe('Vendor B');
  });
});

describe('multi-operator builds — output paths differ', () => {
  it('aristocrat tarball filename includes operatorId', async () => {
    const r = await buildFor('aristocrat');
    expect(r.filename).toContain('aristocrat');
    expect(r.operatorId).toBe('aristocrat');
    expect(r.operator).toBe('Vendor C');
  });

  it('lw tarball filename does NOT include operatorId (backward compat)', async () => {
    const r = await buildFor('lw');
    expect(r.filename).not.toContain('lw-');
    expect(r.filename).toMatch(/^slot-math-engine-pitch-v\d+/);
  });

  it('two different operators produce different filenames', async () => {
    const a = await buildFor('aristocrat');
    const b = await buildFor('hacksaw');
    expect(a.filename).not.toBe(b.filename);
  });
});

describe('multi-operator builds — content differs', () => {
  it('README contains operator displayName instead of Vendor B', async () => {
    const r = await buildFor('aristocrat');
    const tar = gunzipSync(await fs.readFile(r.outputPath));
    const entries = parseTar(tar);
    const readme = entries.find((e) => e.path === 'pitch-package/README.md');
    expect(readme).toBeDefined();
    const text = readme.data.toString('utf8');
    expect(text).toContain('Vendor C');
  });

  it('MANIFEST.json includes operator metadata block', async () => {
    const r = await buildFor('aristocrat');
    const tar = gunzipSync(await fs.readFile(r.outputPath));
    const entries = parseTar(tar);
    const manifestEntry = entries.find((e) => e.path === 'pitch-package/MANIFEST.json');
    const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
    expect(manifest.operator).toBeDefined();
    expect(manifest.operator.operatorId).toBe('aristocrat');
    expect(manifest.operator.displayName).toBe('Vendor C');
    expect(manifest.operator.tier).toBe('Tier-1');
    expect(manifest.pricingTier).toBe('Tier-1 Enterprise');
    expect(manifest.expiresAt).toBeDefined();
  });

  it('aristocrat README differs from Vendor B README', async () => {
    const a = await buildFor('aristocrat');
    const l = await buildFor('lw');
    const tarA = gunzipSync(await fs.readFile(a.outputPath));
    const tarL = gunzipSync(await fs.readFile(l.outputPath));
    const readmeA = parseTar(tarA).find((e) => e.path === 'pitch-package/README.md').data.toString('utf8');
    const readmeL = parseTar(tarL).find((e) => e.path === 'pitch-package/README.md').data.toString('utf8');
    expect(readmeA).not.toBe(readmeL);
    expect(readmeA).toContain('Vendor C');
    expect(readmeL).toContain('Vendor B');
  });

  it('aristocrat CONTACT.md contains Vendor C in place of Vendor B', async () => {
    const r = await buildFor('aristocrat');
    const tar = gunzipSync(await fs.readFile(r.outputPath));
    const contact = parseTar(tar).find((e) => e.path === 'pitch-package/CONTACT.md').data.toString('utf8');
    expect(contact).toContain('Vendor C');
    expect(contact).not.toContain('Vendor B Pilot');
  });
});

describe('multi-operator builds — fields + rebrand helper', () => {
  it('rebrandEntry leaves non-text payloads untouched', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const entry = { bundlePath: 'pitch-package/proof/img.png', data: Buffer.from([0x89, 0x50, 0x4e]) };
    const out = rebrandEntry(entry, m);
    expect(out).toBe(entry);
  });

  it('rebrandEntry rewrites README.md when operator differs', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const entry = { bundlePath: 'pitch-package/README.md', data: Buffer.from('Hello Vendor B team!') };
    const out = rebrandEntry(entry, m);
    expect(out.data.toString('utf8')).toBe('Hello Vendor C team!');
  });

  it('rebrandEntry returns identical object for default lw operator', async () => {
    const m = await loadOperatorManifest('lw');
    const entry = { bundlePath: 'pitch-package/README.md', data: Buffer.from('Hello Vendor B team!') };
    const out = rebrandEntry(entry, m);
    expect(out.data.toString('utf8')).toBe('Hello Vendor B team!');
  });

  it('manifest expiresAt is 90 days from generatedAt by default', async () => {
    const r = await buildFor('aristocrat', { bundleVersion: 'v20990101' });
    const expiresAt = r.manifest.expiresAt;
    const generated = new Date(r.manifest.generatedAt).getTime();
    const expires = new Date(expiresAt).getTime();
    const diffDays = (expires - generated) / 86_400_000;
    expect(diffDays).toBeGreaterThan(89.9);
    expect(diffDays).toBeLessThan(90.1);
  });

  it('intendedAudience comes from manifest decisionMakerRole', async () => {
    const r = await buildFor('aristocrat');
    expect(r.manifest.intendedAudience).toBe('Chief Mathematics Officer');
  });
});
