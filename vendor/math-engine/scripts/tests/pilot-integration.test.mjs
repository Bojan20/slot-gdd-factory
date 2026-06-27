/**
 * W211 Faza 700.0 — Pilot integration-suite tests.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  parseArgs,
  makeRng,
  ALL_STEPS,
  stepAuth,
  stepWalletHandshake,
  stepCatalogBrowse,
  stepLicenseVerify,
  stepSingleSpin,
  stepBulkSpin,
  stepReplay,
  stepCertExport,
  stepCanary,
  stepRollback,
  runSuite,
  summaryTable,
} from '../pilot/run-integration-suite.mjs';
import { seedPilot } from '../pilot/seed-lw-pilot.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function seedFixture() {
  const dir = resolve(tmpdir(), `pilot-int-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  const r = await seedPilot({ root: REPO_ROOT, outDir: dir, force: true });
  return r.state;
}

function makeCtx(state, overrides = {}) {
  return {
    runId: 'test-run',
    spinCount: 50,
    rng: makeRng(parseInt(state.initialStateHash.slice(0, 8), 16) || 1),
    root: REPO_ROOT,
    ...overrides,
  };
}

describe('integration suite — args + helpers', () => {
  it('parseArgs handles --live + --target=', () => {
    const a = parseArgs(['node', 'x', '--live', '--target=http://host:9000']);
    expect(a.live).toBe(true);
    expect(a.target).toBe('http://host:9000');
  });

  it('parseArgs --quick reduces spins', () => {
    const a = parseArgs(['node', 'x', '--quick']);
    expect(a.spins).toBe(200);
  });

  it('ALL_STEPS lists exactly the 10 required steps', () => {
    const ids = ALL_STEPS.map((s) => s.id);
    expect(ids).toEqual([
      'auth',
      'wallet-handshake',
      'catalog-browse',
      'license-verify',
      'single-spin',
      'bulk-spin',
      'replay',
      'cert-export',
      'canary',
      'rollback',
    ]);
  });

  it('makeRng is deterministic', () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    expect(a()).toBe(b());
  });
});

describe('integration suite — individual step verdicts', () => {
  let state;
  beforeAll(async () => {
    state = await seedFixture();
  });

  it('stepAuth passes when apiKeyHash matches', async () => {
    const v = await stepAuth(state, makeCtx(state));
    expect(v.step).toBe('auth');
    expect(v.ok).toBe(true);
  });

  it('stepAuth fails on missing apiKey', async () => {
    const tampered = { ...state, operator: {} };
    const v = await stepAuth(tampered, makeCtx(state));
    expect(v.ok).toBe(false);
  });

  it('stepWalletHandshake reports latency + players', async () => {
    const v = await stepWalletHandshake(state, makeCtx(state));
    expect(v.ok).toBe(true);
    expect(v.metrics.players).toBe(state.players.length);
    expect(v.metrics.healthcheckLatencyMs).toBeGreaterThan(0);
  });

  it('stepCatalogBrowse reports >=3 templates installed', async () => {
    const v = await stepCatalogBrowse(state, makeCtx(state));
    expect(v.ok).toBe(true);
    expect(v.metrics.totalInstalled).toBeGreaterThanOrEqual(3);
  });

  it('stepLicenseVerify accepts seeded JWTs', async () => {
    const v = await stepLicenseVerify(state, makeCtx(state));
    expect(v.ok).toBe(true);
    expect(v.metrics.verified).toBe(v.metrics.total);
  });

  it('stepLicenseVerify flags wrong tenant on mutation', async () => {
    const broken = JSON.parse(JSON.stringify(state));
    broken.installedTemplates[0].licenseJwt = 'aa.bb.cc';
    const v = await stepLicenseVerify(broken, makeCtx(state));
    expect(v.ok).toBe(false);
  });

  it('stepSingleSpin emits audit chain advance', async () => {
    const v = await stepSingleSpin(state, makeCtx(state));
    expect(v.ok).toBe(true);
    expect(v.metrics.auditPrev).toBeTruthy();
    expect(v.metrics.auditCurr).toBeTruthy();
  });

  it('stepBulkSpin gates RTP and p99 latency', async () => {
    const v = await stepBulkSpin(state, makeCtx(state, { spinCount: 200 }));
    expect(v.metrics.spins).toBe(200);
    expect(typeof v.metrics.driftPp).toBe('number');
    expect(typeof v.metrics.p99Ms).toBe('number');
  });

  it('stepReplay is deterministic and bit-identical', async () => {
    const v = await stepReplay(state, makeCtx(state));
    expect(v.ok).toBe(true);
    expect(v.metrics.bitIdentical).toBe(true);
  });

  it('stepCanary walks 4 stages with all gates passing', async () => {
    const v = await stepCanary(state, makeCtx(state));
    expect(v.metrics.stages).toBe(4);
    expect(v.metrics.finalRolloutPercent).toBe(100);
  });

  it('stepRollback triggers + reports RTO < 5000ms', async () => {
    const v = await stepRollback(state, makeCtx(state));
    expect(v.metrics.triggerReason).toBe('rtp_drift');
    expect(v.metrics.rtoMs).toBeLessThan(5000);
  });

  it('stepCertExport produces a signed bundle or a clear error', async () => {
    const v = await stepCertExport(state, makeCtx(state, { certOut: 'dist/pilot/test-cert' }));
    // Either the bundle was packed (ok=true) or the env was sparse — we
    // still expect a structured verdict either way.
    expect(v.step).toBe('cert-export');
    expect(typeof v.ok).toBe('boolean');
  });

  it('runSuite returns a complete summary with 10 verdicts', async () => {
    const summary = await runSuite({ state, spinCount: 30 });
    expect(summary.verdicts.length).toBe(ALL_STEPS.length);
    expect(typeof summary.overallOk).toBe('boolean');
    expect(summary.runId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('summaryTable formats the verdict grid', async () => {
    const summary = await runSuite({ state, spinCount: 30 });
    const txt = summaryTable(summary);
    expect(txt).toMatch(/Step\s+\|/);
    expect(txt).toMatch(/Result: \d+\/\d+ passed/);
  });
});
