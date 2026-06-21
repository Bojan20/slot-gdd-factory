#!/usr/bin/env node
/**
 * tests/tools/v12-deeper-industry-spec.test.mjs
 *
 * UQ-MASTERY-6 — V12 self-test. Dokazuje da deeper-industry rule codes
 * stvarno hvataju prekršaje na sintetičkim negative fixture-ima.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const V12 = join(REPO, 'tools/v12-deeper-industry-spec.mjs');
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
  const r = spawnSync('node', [V12, ...extraArgs], { encoding: 'utf8', cwd: REPO });
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function loadReport() {
  const files = readdirSync(join(REPO, 'reports'))
    .filter(f => f.startsWith('v12-deeper-industry-') && f.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error('no v12 report');
  return JSON.parse(readFileSync(join(REPO, 'reports', files[files.length - 1]), 'utf8'));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* HARD-fixturing negative cases — each should fire its rule */
  fixture('_v12-test-hp-tiers', {
    symbols: Array.from({ length: 12 }, (_, i) => ({ tier: 'hp', name: `H${i + 1}` })),
  });

  fixture('_v12-test-lp-tiers', {
    symbols: Array.from({ length: 1 }, (_, i) => ({ tier: 'lp', name: `L${i + 1}` })),
  });

  fixture('_v12-test-sym-name', {
    symbols: [{ tier: 'hp', name: '' }, { tier: 'hp', name: 'OK' }],
  });

  fixture('_v12-test-fs-trigger', {
    freeSpins: { enabled: true, triggerCount: 2 },     // below FS_MIN_TRIGGER_SCATTERS=3
  });

  fixture('_v12-test-fs-negative-award', {
    freeSpins: { enabled: true, awards: [{ value: -5 }] },
  });

  fixture('_v12-test-fs-mult-cap-over', {
    freeSpins: { enabled: true, multiplier: { cap: 5000 } }, // above FS_MULT_CAP_MAX=1000
  });

  fixture('_v12-test-bb-cost-over', {
    bonusBuy: { enabled: true, costX: 500 }, // above BB_COST_MAX=200
  });

  fixture('_v12-test-uk-bb', {
    compliance: { jurisdictions: ['UKGC'] },
    bonusBuy: { enabled: true, costX: 100 },  // UKGC bans bonus buy
  });

  fixture('_v12-test-bigwintier-no-wp', {
    bigWinTier: { enabled: true },
    winPresentation: { enabled: false },
  });

  const res = run();
  assert(res.exit === 1, `expected exit 1 (HARDs present), got ${res.exit}\n${res.stdout}`);

  const report = loadReport();
  const expected = ['I6.1', 'I6.2', 'I6.3', 'I7.1', 'I7.2', 'I7.3', 'I8.1', 'I8.2', 'I10.3'];
  for (const rule of expected) {
    assert(
      (report.hardByRule[rule] || 0) >= 1,
      `expected ${rule} to fire HARD, got ${JSON.stringify(report.hardByRule)}`
    );
  }

  /* Clean positive control — should PASS */
  cleanup();
  TEST_DIRS.length = 0;
  fixture('_v12-test-clean', {
    topology: { kind: 'rectangular', reels: 5, rows: 3, evaluation: 'lines' },
    symbols: [
      { tier: 'hp', name: 'Hero', kind: 'hp', pay: { '5': 200 } },
      { tier: 'hp', name: 'Coin', kind: 'hp', pay: { '5': 150 } },
      { tier: 'hp', name: 'Ring', kind: 'hp', pay: { '5': 100 } },
      { tier: 'hp', name: 'Cup',  kind: 'hp', pay: { '5':  75 } },
      { tier: 'lp', name: '9',    kind: 'lp', pay: { '5':  10 } },
      { tier: 'lp', name: 'A',    kind: 'lp', pay: { '5':  15 } },
      { tier: 'lp', name: 'K',    kind: 'lp', pay: { '5':  12 } },
      { kind: 'wild',    name: 'W', pay: { '5': 250 } },
      { kind: 'scatter', name: 'S' },
    ],
    freeSpins: { enabled: true, triggerCount: 3, awards: [{ value: 10 }, { value: 20 }], multiplier: { cap: 50 } },
    bonusBuy: { enabled: true, costX: 100 },
    bigWinTier: { enabled: true },
    winPresentation: { enabled: true },
  });
  const r2 = run(['--slug=_v12-test-clean']);
  assert(r2.exit === 0, `clean fixture should pass, got exit ${r2.exit}\n${r2.stdout}`);

  cleanup();
  console.log(`✓ v12-deeper-industry-spec.test.mjs — ${expected.length} HARD codes flagged on negative fixtures, clean fixture passed`);
} catch (e) {
  cleanup();
  console.error('✗ v12-deeper-industry-spec.test.mjs:', e.message);
  process.exit(1);
}
