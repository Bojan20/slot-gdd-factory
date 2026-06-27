/**
 * CORTI 200.6-DEVOPS — tests for scripts/cert-lab-submit.mjs
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseArgs,
  buildEnvelope,
  stubLab,
  runSubmit,
} from '../cert-lab-submit.mjs';

function makeIrFile() {
  const dir = mkdtempSync(join(tmpdir(), 'cert-lab-test-'));
  const file = join(dir, 'demo.ir.json');
  const ir = {
    schema_version: '1.0.0',
    meta: { id: 'demo', name: 'Demo' },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
  };
  writeFileSync(file, JSON.stringify(ir), 'utf8');
  return { dir, file };
}

describe('cert-lab-submit parseArgs', () => {
  it('parses --game and --jurisdiction', () => {
    const args = parseArgs(['--game', 'demo', '--jurisdiction', 'UKGC']);
    expect(args.game).toBe('demo');
    expect(args.jurisdiction).toBe('UKGC');
  });

  it('--stub forces stub mode', () => {
    const args = parseArgs(['--stub']);
    expect(args.stub).toBe(true);
  });

  it('--lab-url disables stub', () => {
    const args = parseArgs(['--lab-url', 'https://lab.example.com']);
    expect(args.stub).toBe(false);
    expect(args.labUrl).toBe('https://lab.example.com');
  });
});

describe('cert-lab-submit buildEnvelope', () => {
  it('produces envelope with irSha256 + ir bytes', () => {
    const { file } = makeIrFile();
    const out = buildEnvelope({ game: 'demo', jurisdiction: 'UKGC', irPath: file });
    expect(out.envelope.irSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.envelope.irBytes).toBeGreaterThan(0);
    expect(out.envelope.game).toBe('demo');
    expect(out.ir.meta.id).toBe('demo');
  });

  it('throws when IR path missing', () => {
    expect(() =>
      buildEnvelope({ game: 'no-such', jurisdiction: 'UKGC', irPath: '/no/such/file.json' })
    ).toThrow(/ir_not_found/);
  });
});

describe('cert-lab-submit stubLab orchestration', () => {
  it('happy path: submit → poll → approved → download', async () => {
    const { dir, file } = makeIrFile();
    const lab = stubLab();
    const outDir = join(dir, 'out');
    const result = await runSubmit({
      game: 'demo',
      jurisdiction: 'UKGC',
      irPath: file,
      out: outDir,
      sleep: async () => {},
      now: () => Date.now(),
      stub: true,
      labUrl: '',
    }, lab);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('approved');
    expect(result.submissionId).toMatch(/^stub-demo-/);
    expect(result.certPath).toContain(outDir);
  });

  it('rejected path returns ok:false and feedback', async () => {
    const { file } = makeIrFile();
    const lab = stubLab();
    const result = await runSubmit({
      game: 'demo',
      jurisdiction: 'REJECT_TEST',
      irPath: file,
      out: '/tmp/should-not-write',
      sleep: async () => {},
      now: () => Date.now(),
      stub: true,
      labUrl: '',
    }, lab);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.feedback).toBeDefined();
  });

  it('runSubmit requires --game and --jurisdiction', async () => {
    const lab = stubLab();
    await expect(
      runSubmit({ game: '', jurisdiction: 'UKGC', sleep: async () => {} }, lab)
    ).rejects.toThrow(/--game required/);
    await expect(
      runSubmit({ game: 'x', jurisdiction: '', sleep: async () => {} }, lab)
    ).rejects.toThrow(/--jurisdiction required/);
  });
});
