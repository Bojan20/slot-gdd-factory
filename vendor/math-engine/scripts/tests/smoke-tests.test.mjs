/**
 * W210 Faza 600.0 — Smoke harness validation.
 *
 * Validates the smoke-test harness itself: each smoke script must exit
 * cleanly in synthetic mode, emit a JSON result envelope on stdout, and
 * the orchestrator must aggregate results into a summary.json.
 *
 * These tests run as part of the root vitest suite (scripts/tests/**).
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE_DIR = resolve(HERE, '..', 'smoke-tests');
const REPO_ROOT = resolve(HERE, '..', '..');

function runNode(script, extraArgs = []) {
  return new Promise((res) => {
    const t0 = Date.now();
    const child = spawn(
      process.execPath,
      [script, '--synthetic', ...extraArgs],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b.toString('utf8')));
    child.stderr.on('data', (b) => (err += b.toString('utf8')));
    child.on('close', (code) =>
      res({ code, out, err, durationMs: Date.now() - t0 })
    );
  });
}

function findEnvelope(out) {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // keep walking
    }
  }
  return null;
}

describe('smoke harness — script catalogue', () => {
  it('lists at least 6 smoke scripts', () => {
    const files = readdirSync(SMOKE_DIR).filter(
      (f) => f.startsWith('smoke-') && f.endsWith('.mjs')
    );
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('includes the expected named smokes', () => {
    const files = readdirSync(SMOKE_DIR);
    for (const name of [
      'smoke-spin-flow.mjs',
      'smoke-license-verify.mjs',
      'smoke-jurisdiction-rules.mjs',
      'smoke-rng-determinism.mjs',
      'smoke-cert-export.mjs',
      'smoke-wallet-providers.mjs',
    ]) {
      expect(files).toContain(name);
    }
  });
});

describe('smoke harness — individual scripts in synthetic mode', () => {
  for (const file of [
    'smoke-spin-flow.mjs',
    'smoke-license-verify.mjs',
    'smoke-jurisdiction-rules.mjs',
    'smoke-rng-determinism.mjs',
    'smoke-cert-export.mjs',
    'smoke-wallet-providers.mjs',
  ]) {
    it(`${file} exits 0 and emits an ok envelope`, async () => {
      const { code, out } = await runNode(resolve(SMOKE_DIR, file));
      expect(code).toBe(0);
      const env = findEnvelope(out);
      expect(env).not.toBeNull();
      expect(env.name).toMatch(/^smoke-/);
      expect(env.ok).toBe(true);
    });
  }
});

describe('smoke harness — orchestrator', () => {
  it('aggregates results and writes summary.json in synthetic mode', async () => {
    const { code } = await runNode(
      resolve(SMOKE_DIR, 'run-all-smoke.mjs')
    );
    expect(code).toBe(0);
    const summaryPath = resolve(REPO_ROOT, 'reports', 'smoke', 'summary.json');
    expect(existsSync(summaryPath)).toBe(true);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    expect(summary.failCount).toBe(0);
    expect(summary.okCount).toBeGreaterThanOrEqual(6);
    expect(summary.totalMs).toBeLessThan(5 * 60 * 1000);
  }, 60_000);

  it('rng-determinism produces identical digest on repeated runs', async () => {
    const r1 = await runNode(resolve(SMOKE_DIR, 'smoke-rng-determinism.mjs'));
    const r2 = await runNode(resolve(SMOKE_DIR, 'smoke-rng-determinism.mjs'));
    const e1 = findEnvelope(r1.out);
    const e2 = findEnvelope(r2.out);
    expect(e1.details.digest).toBe(e2.details.digest);
  });

  it('orchestrator respects --only filter', async () => {
    const { code, out } = await runNode(
      resolve(SMOKE_DIR, 'run-all-smoke.mjs'),
      ['--only=rng-determinism']
    );
    expect(code).toBe(0);
    expect(out).toContain('smoke-rng-determinism');
  });
});
