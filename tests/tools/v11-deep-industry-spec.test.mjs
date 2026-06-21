#!/usr/bin/env node
/**
 * tests/tools/v11-deep-industry-spec.test.mjs
 *
 * UQ-MASTERY-4 — Self-test koji DOKAZUJE da V11 deep-industry walker
 * stvarno hvata prekršaje. Bez ovog testa, V11 može da bude PASS samo
 * zato što su sva polja `null` na 338 GDD-ova — false-confidence.
 *
 * Strategija: napravi tempo `dist/real-games/_v11-test-*` slug-ove sa
 * namernim industry violations, pusti walker, asert-uj da je svaki
 * očekivani rule code HARD-flag-ovan. Po završetku — cleanup.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const V11_TOOL = join(REPO, 'tools/v11-deep-industry-spec.mjs');

const TEST_DIRS = [];

function makeFixture(slug, model) {
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

function runV11(extraArgs = []) {
  const r = spawnSync('node', [V11_TOOL, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO,
    env: process.env,
  });
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function loadLatestReport() {
  const dir = join(REPO, 'reports');
  const files = readdirSync(dir)
    .filter(f => f.startsWith('v11-deep-industry-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error('no v11 report');
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* ── Fixture set: each one violates exactly the named rule(s) ────── */

  makeFixture('_v11-test-rtp-floor', {
    compliance: { jurisdictions: ['UKGC'] },
    payback: { rtp: 70.0 },              // I1.1 — UKGC floor 85%
  });

  makeFixture('_v11-test-rtp-over-100', {
    payback: { rtp: 105.0 },             // I1.1.cap
  });

  makeFixture('_v11-test-rtp-variant-over', {
    payback: { rtpVariants: [{ label: 'buy', rtp: 120 }] }, // I1.2
  });

  makeFixture('_v11-test-vol', {
    payback: { volatilityIdx: 11 },      // I1.3
  });

  makeFixture('_v11-test-maxwin', {
    payback: { maxWinX: 50 },            // I1.4 (below 100)
  });

  makeFixture('_v11-test-jackpot-monotonic', {
    jackpot: {
      enabled: true,
      values: { MINI: 100, MINOR: 50, MAJOR: 500, GRAND: 5000 }, // I2.1
    },
  });

  makeFixture('_v11-test-jackpot-grand-too-low', {
    jackpot: { enabled: true, values: { GRAND: 50 } }, // I2.2
  });

  makeFixture('_v11-test-fs-ladder', {
    freeSpins: {
      enabled: true,
      multiplier: { ladder: [1, 2, 3, 2, 5] }, // I2.3 — non-monotonic
    },
  });

  makeFixture('_v11-test-fs-start', {
    freeSpins: {
      enabled: true,
      multiplier: { start: 0.5 },         // I2.4
    },
  });

  makeFixture('_v11-test-hnw-scatter', {
    holdAndWin: { enabled: true, scatterTrigger: 2 }, // I2.5 (below 3)
  });

  makeFixture('_v11-test-autoplay-uk', {
    compliance: { jurisdictions: ['UKGC'] },
    autoplay: { enabled: true, cap: 200 },  // I3.1 — UKGC max 100
  });

  makeFixture('_v11-test-spintime-de', {
    compliance: { jurisdictions: ['DE-WHG'] },
    spinTempo: { totalMs: 2000 },        // I3.2 — DE min 5000ms
  });

  makeFixture('_v11-test-autoplay-fr', {
    compliance: { jurisdictions: ['FR-ANJ'] },
    autoplay: { enabled: true, cap: 5 }, // I3.3 — FR allows 0
  });

  makeFixture('_v11-test-reality-uk', {
    compliance: { jurisdictions: ['UKGC'] },
    realityCheck: { intervalMs: 90 * 60 * 1000 }, // I3.4 — UK max 60min
  });

  makeFixture('_v11-test-de-netloss', {
    compliance: { jurisdictions: ['DE-WHG'] },
    netLossIndicator: false,             // I3.5
  });

  makeFixture('_v11-test-tumble-postspin', {
    tumble:   { enabled: true },
    postSpin: { enabled: false },        // I5.1
  });

  makeFixture('_v11-test-hnw-respin', {
    holdAndWin: { enabled: true, scatterTrigger: 5 },
    respin:     { enabled: false },      // I5.2
  });

  /* ── Run V11 walker ───────────────────────────────────────────────── */
  const res = runV11();

  assert(res.exit === 1, `expected exit 1 (HARD violations), got ${res.exit}\nstdout:\n${res.stdout}`);
  const report = loadLatestReport();

  const expected = new Set([
    'I1.1', 'I1.1.cap', 'I1.2', 'I1.3', 'I1.4',
    'I2.1', 'I2.2', 'I2.3', 'I2.4', 'I2.5',
    'I3.1', 'I3.2', 'I3.3', 'I3.4', 'I3.5',
    'I5.1', 'I5.2',
  ]);
  for (const rule of expected) {
    assert(
      (report.hardByRule[rule] || 0) >= 1,
      `expected rule ${rule} to be flagged, hardByRule=${JSON.stringify(report.hardByRule)}`
    );
  }

  /* ── Run on positive control (no violations) — should PASS ──────── */
  cleanup();
  TEST_DIRS.length = 0;
  makeFixture('_v11-test-clean', {
    compliance: { jurisdictions: ['UKGC'] },
    payback: { rtp: 96.0, maxWinX: 5000, volatilityIdx: 5 },
    jackpot: { enabled: true, values: { MINI: 10, MINOR: 50, MAJOR: 500, GRAND: 5000 } },
    freeSpins: { enabled: true, multiplier: { start: 1, ladder: [1, 2, 3, 5, 10] } },
    holdAndWin: { enabled: true, scatterTrigger: 6 },
    respin: { enabled: true },
    autoplay: { enabled: true, cap: 100 },
  });

  const r2 = runV11(['--slug=_v11-test-clean']);
  assert(r2.exit === 0, `clean fixture should pass, got exit ${r2.exit}\n${r2.stdout}`);

  cleanup();
  console.log('✓ v11-deep-industry-spec.test.mjs — all 17 rule codes flagged on negative fixtures, clean fixture passed');
} catch (e) {
  cleanup();
  console.error('✗ v11-deep-industry-spec.test.mjs:', e.message);
  process.exit(1);
}
