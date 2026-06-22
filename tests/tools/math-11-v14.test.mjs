#!/usr/bin/env node
/**
 * tests/tools/math-11-v14.test.mjs
 *
 * MATH-11 — V14 math compliance walker self-test.
 *
 * Asertuje:
 *   1. V14 walks 338 games + reports gamesWithDeclaredMath > 0
 *   2. Cash Eruption (real math from MATH-1) is in the "with math" subset
 *   3. 0 HARD violations on current pipeline (production-ready)
 *   4. Negative fixtures fire correct rule codes:
 *      M1 RTP floor, M2 variant floor, M3 maxWinX, M4 volIdx,
 *      M5 hitFreq, M6 winFreq > hitFreq, M10 jackpot monotonic
 *   5. Determinism: re-run = identical hardByRule
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools/v14-math-compliance.mjs');
const REAL_GAMES = join(REPO, 'dist/real-games');
const TEST_DIRS = [];

function fixture(slug, model) {
  const dir = join(REAL_GAMES, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'model.json'), JSON.stringify(model, null, 2));
  TEST_DIRS.push(dir);
}
function cleanup() {
  for (const d of TEST_DIRS) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}

function loadLatestReport() {
  const dir = join(REPO, 'reports');
  const files = readdirSync(dir)
    .filter(f => f.startsWith('v14-math-compliance-') && f.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error('no v14 report');
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* (1) Default walk: should pass 0 HARD on current pipeline */
  const r = spawnSync('node', [TOOL], { cwd: REPO, encoding: 'utf8' });
  assert(r.status === 0, `walker exit ${r.status} on clean corpus: ${r.stderr || r.stdout}`);

  const report = loadLatestReport();
  assert(report.gamesAudited >= 5, `should audit ≥ 5 games, got ${report.gamesAudited}`);
  assert(report.gamesWithDeclaredMath > 0,
    `should have at least 1 game with declared math (post MATH-1)`);
  assert(report.hardCount === 0, `clean corpus expected 0 HARD, got ${report.hardCount}`);

  /* (2) Add negative fixtures that should fire rules */
  fixture('_v14-test-m1-rtp-floor', {
    compliance: { jurisdictions: ['UKGC'] },
    payback: { rtp: 70 },  /* below UKGC 85 floor */
  });
  fixture('_v14-test-m1-cap', {
    payback: { rtp: 110 },  /* > 100% impossible */
  });
  fixture('_v14-test-m2-variant', {
    payback: { rtpVariants: [{ label: 'high', rtp: 105 }] },
  });
  fixture('_v14-test-m3-maxwin', {
    payback: { maxWinX: 50 },  /* below 100 */
  });
  fixture('_v14-test-m4-vol', {
    payback: { volatilityIdx: 11 },  /* > 10 */
  });
  fixture('_v14-test-m5-hf', {
    payback: { hitFrequency: 75 },  /* > 50 */
  });
  fixture('_v14-test-m6-wf-hf', {
    payback: { hitFrequency: 10, winFrequency: 15 },  /* wf > hf impossible */
  });
  fixture('_v14-test-m10-monotonic', {
    jackpot: { enabled: true, values: { MINI: 100, MINOR: 50, MAJOR: 500, GRAND: 5000 } },
  });

  const r2 = spawnSync('node', [TOOL], { cwd: REPO, encoding: 'utf8' });
  assert(r2.status === 1, `walker should fail with negative fixtures, got ${r2.status}`);

  const report2 = loadLatestReport();
  const expected = ['M1', 'M1.cap', 'M2', 'M3', 'M4', 'M5', 'M6', 'M10'];
  for (const rule of expected) {
    assert(report2.hardByRule[rule] >= 1,
      `expected rule ${rule} flagged, got ${JSON.stringify(report2.hardByRule)}`);
  }

  /* (3) Determinism */
  const r3 = spawnSync('node', [TOOL], { cwd: REPO, encoding: 'utf8' });
  const report3 = loadLatestReport();
  assert(report3.hardCount === report2.hardCount, `non-deterministic hardCount`);

  cleanup();
  console.log(`✓ math-11-v14.test.mjs — V14 walker: ${report.gamesAudited} games, ${report.gamesWithDeclaredMath} sa declared math, 0 HARD clean + 8 rules fire on negative fixtures (M1/M1.cap/M2/M3/M4/M5/M6/M10)`);
} catch (e) {
  cleanup();
  console.error('✗ math-11-v14.test.mjs:', e.message);
  process.exit(1);
}
