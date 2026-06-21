#!/usr/bin/env node
/**
 * tests/tools/agent-trainer-v2.test.mjs
 *
 * UQ-TRAIN-2 — Multi-provider trainer V2 self-test.
 *
 * Verifikuje:
 *   1. Trainer učitava fixtures.<KEY> i konvertuje u cache slug
 *   2. Provider availability matrix korektno popunjen
 *   3. Winner per lane je provider sa najvišim avg score-om
 *   4. Globalni winner = provider sa najviše lane wins
 *   5. Exit code 0 na trenutnoj konfiguraciji (Opus 5/5 dostupan)
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools/agent-trainer-v2-multiprovider.mjs');

function run(extraArgs = []) {
  const r = spawnSync('node', [TOOL, ...extraArgs], { encoding: 'utf8', cwd: REPO });
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function loadLatestReport() {
  const dir = join(REPO, 'reports');
  const files = readdirSync(dir)
    .filter(f => f.startsWith('agent-trainer-v2-') && f.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error('no trainer v2 report');
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* ── Default run — all 4 providers, Opus is 5/5 dostupan ──────────── */
  const res = run();
  assert(res.exit === 0, `default run should exit 0, got ${res.exit}\n${res.stdout}`);

  const report = loadLatestReport();

  /* 1. Slugs derived from fixture keys */
  assert(report.slugCount === 5, `expected 5 slugs, got ${report.slugCount}`);
  assert(Array.isArray(report.providers) && report.providers.length === 4,
    `expected 4 providers, got ${report.providers?.length}`);

  /* 2. Availability matrix */
  assert(report.availability.opus.available === 5,
    `opus should have 5/5 snapshots, got ${report.availability.opus.available}`);
  assert(report.availability.kimi.available === 0,
    `kimi archive should be 0/5 (no archived snapshots yet), got ${report.availability.kimi.available}`);

  /* 3. Winner per lane — opus should win all 5 lanes given it's only available */
  const lanes = ['V1', 'V2', 'V3', 'V4', 'V5'];
  for (const lane of lanes) {
    assert(report.winnerPerLane[lane].provider === 'opus',
      `lane ${lane} winner should be opus, got ${report.winnerPerLane[lane].provider}`);
    assert(report.winnerPerLane[lane].avgScore > 0,
      `lane ${lane} avgScore should be > 0`);
  }

  /* 4. Global winner */
  assert(report.globalWinnerByLaneCount === 'opus',
    `global winner should be opus, got ${report.globalWinnerByLaneCount}`);

  /* ── Strict mode test (--strict) — should still pass jer Opus dostupan ── */
  const strict = run(['--strict']);
  assert(strict.exit === 0, `strict mode should pass with Opus dostupan, got ${strict.exit}`);

  /* ── --providers=opus only — single provider works ─────────────────── */
  const single = run(['--providers=opus']);
  assert(single.exit === 0, `single provider opus run should pass`);
  const singleReport = loadLatestReport();
  assert(singleReport.providers.length === 1, `single provider should have 1 provider`);
  assert(singleReport.providers[0] === 'opus', `single provider should be opus`);

  console.log('✓ agent-trainer-v2.test.mjs — slug mapping, availability matrix, winner-per-lane, global winner, strict mode, single-provider all verified');
} catch (e) {
  console.error('✗ agent-trainer-v2.test.mjs:', e.message);
  process.exit(1);
}
