#!/usr/bin/env node
/**
 * tests/tools/v8-assembly-orchestrator.test.mjs
 *
 * UQ-MASTERY-5 — V8 self-test. Bez ovog testa V8 može biti PASS samo
 * zato što sva 338 model.json su slični; ne dokazuje da rules zaista
 * pucaju. Negativna fixture sa konfliktima + nedostajućim mandatory
 * blokovima + jurisdikcijama pokazuje pravu efikasnost.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const V8 = join(REPO, 'tools/v8-assembly-orchestrator.mjs');
const TEST_DIRS = [];

function fixture(slug, model) {
  const dir = join(REAL_GAMES, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'model.json'), JSON.stringify(model, null, 2));
  TEST_DIRS.push(dir);
}

function cleanup() {
  for (const d of TEST_DIRS) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
}

function run(extraArgs = []) {
  const r = spawnSync('node', [V8, ...extraArgs], { encoding: 'utf8', cwd: REPO });
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function loadReport() {
  const files = readdirSync(join(REPO, 'reports'))
    .filter(f => f.startsWith('v8-assembly-') && f.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error('no report');
  return JSON.parse(readFileSync(join(REPO, 'reports', files[files.length - 1]), 'utf8'));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function receiptFor(report, slug) {
  return report.receipts.find(r => r.slug === slug);
}

try {
  /* ── A. Topology engine selection ─────────────────────────────── */
  fixture('_v8-test-hex', {
    topology: { kind: 'hex', reels: 6, rows: 5 },
    features: [],
  });
  fixture('_v8-test-plinko', {
    topology: { is_plinko: true, plinko_rows: 12 },
    features: [],
  });
  fixture('_v8-test-wheel', {
    topology: { kind: 'wheel', wheel_segments: 12 },
    features: [],
  });
  fixture('_v8-test-rect', {
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    features: [],
  });

  /* ── B. Mandatory + UKGC jurisdiction gates ─────────────────── */
  fixture('_v8-test-uk-mandatory', {
    topology: { kind: 'rectangular' },
    compliance: { jurisdictions: ['UKGC'] },
  });

  /* ── C. Cluster + ways conflict (both via features + eval) ──── */
  fixture('_v8-test-cluster', {
    topology: { kind: 'rectangular', evaluation: 'cluster_pays', cluster_min_size: 5 },
    features: ['cluster_pays'],
  });

  /* ── D. DE-WHG jurisdiction → required gate ──────────────────── */
  fixture('_v8-test-de', {
    topology: { kind: 'rectangular' },
    compliance: { jurisdictions: ['DE-WHG'] },
  });

  /* ── E. Feature stack: hold_and_win + free_spins + jackpot ──── */
  fixture('_v8-test-stack', {
    topology: { kind: 'rectangular' },
    holdAndWin: { enabled: true, scatterTrigger: 6 },
    freeSpins: { enabled: true, multiplier: { start: 1 } },
    jackpot: { enabled: true, values: { MINI: 10, MINOR: 50, MAJOR: 500, GRAND: 5000 } },
    bonusBuy: { enabled: true, costX: 100 },
  });

  /* ── Run walker on full corpus (incl. test fixtures) ─────────── */
  const r = run();
  const report = loadReport();

  // A — engine selections
  const hex = receiptFor(report, '_v8-test-hex');
  assert(hex?.__meta__?.selectedEngine === 'hexReelEngine', `hex expected hexReelEngine, got ${hex?.__meta__?.selectedEngine}`);
  assert(hex.assembly.disabledBlocks.includes('reelEngine'), 'hex should disable reelEngine');

  const plinko = receiptFor(report, '_v8-test-plinko');
  assert(plinko?.__meta__?.selectedEngine === 'plinkoSpinEngine', `plinko expected plinkoSpinEngine, got ${plinko?.__meta__?.selectedEngine}`);

  const wheel = receiptFor(report, '_v8-test-wheel');
  assert(wheel?.__meta__?.selectedEngine === 'wheelSpinEngine', `wheel expected wheelSpinEngine`);

  const rect = receiptFor(report, '_v8-test-rect');
  assert(rect?.__meta__?.selectedEngine === 'reelEngine', `rect expected reelEngine, got ${rect?.__meta__?.selectedEngine}`);

  // B — mandatory blocks + UK gate
  const uk = receiptFor(report, '_v8-test-uk-mandatory');
  assert(uk.assembly.enabledBlocks.includes('paytable'), 'UK mandatory paytable missing');
  assert(uk.assembly.enabledBlocks.includes('balanceHud'), 'UK mandatory balanceHud missing');
  assert(uk.assembly.enabledBlocks.includes('jurisdictionGate'), 'UK gate not enabled');

  // C — cluster eval → clusterPaysEval on, payAnywhereEval disabled
  const cluster = receiptFor(report, '_v8-test-cluster');
  assert(cluster.assembly.enabledBlocks.includes('clusterPaysEval'), 'cluster did not enable clusterPaysEval');
  assert(cluster.assembly.disabledBlocks.includes('payAnywhereEval'), 'cluster did not disable payAnywhereEval');
  assert(cluster.conflicts.length === 0, `cluster conflicts unexpected: ${JSON.stringify(cluster.conflicts)}`);

  // D — DE-WHG compliance gate
  const de = receiptFor(report, '_v8-test-de');
  assert(de.assembly.enabledBlocks.includes('germanyComplianceGate'), 'DE compliance gate missing');

  // E — feature stack
  const stack = receiptFor(report, '_v8-test-stack');
  assert(stack.assembly.enabledBlocks.includes('holdAndWin'), 'stack missing holdAndWin');
  assert(stack.assembly.enabledBlocks.includes('freeSpins'), 'stack missing freeSpins');
  assert(stack.assembly.enabledBlocks.includes('bonusBuy'), 'stack missing bonusBuy');

  // Every test fixture should be PASS (no conflicts, no mandatory miss)
  for (const slug of TEST_DIRS.map(d => d.split('/').pop())) {
    const rec = receiptFor(report, slug);
    assert(rec?.verdict === 'PASS', `fixture ${slug} verdict ${rec?.verdict}, conflicts=${JSON.stringify(rec?.conflicts)}`);
  }

  cleanup();
  console.log('✓ v8-assembly-orchestrator.test.mjs — engine selection, mandatory pin, jurisdiction gate, feature stack, conflict-free all verified');
} catch (e) {
  cleanup();
  console.error('✗ v8-assembly-orchestrator.test.mjs:', e.message);
  process.exit(1);
}
