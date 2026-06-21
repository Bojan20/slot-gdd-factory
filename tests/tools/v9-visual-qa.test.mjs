#!/usr/bin/env node
/**
 * tests/tools/v9-visual-qa.test.mjs
 *
 * UQ-MASTERY-5 — V9 self-test. Bez ovog testa V9 može biti PASS samo
 * zato što sva 338 slot.html imaju iste mandatory markere. Negativna
 * fixture sa namernim missing controls / blank theme variables / kratak
 * body pokazuje da check-ovi stvarno pucaju.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const V9 = join(REPO, 'tools/v9-visual-qa.mjs');
const TEST_DIRS = [];

function fixture(slug, slotHtml, model) {
  const dir = join(REAL_GAMES, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slot.html'), slotHtml);
  writeFileSync(join(dir, 'model.json'), JSON.stringify(model || {}, null, 2));
  TEST_DIRS.push(dir);
}

function cleanup() {
  for (const d of TEST_DIRS) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
}

function run(extraArgs = []) {
  const r = spawnSync('node', [V9, ...extraArgs], { encoding: 'utf8', cwd: REPO });
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function loadReport() {
  const files = readdirSync(join(REPO, 'reports'))
    .filter(f => f.startsWith('v9-visual-qa-') && f.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error('no v9 report');
  return JSON.parse(readFileSync(join(REPO, 'reports', files[files.length - 1]), 'utf8'));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function r(report, slug) {
  return report.receipts.find(x => x.slug === slug);
}

const longBody = 'X'.repeat(60_000);
const CLEAN_HTML = `<!DOCTYPE html><html lang="en"><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="manifest" href="data:application/manifest+json;base64,eyJ9">
<title>Test Slot</title>
<style>:root{--bg-base:#000;--accent:#fff;}</style>
</head><body>
<div class="hub">
  <div class="balance-hud">€100</div>
  <div class="bet-steps"><div class="bet-step"></div></div>
  <button class="spin-btn">SPIN</button>
  <button class="paytable-btn">PT</button>
  <div class="paytable-row"></div><div class="paytable-row"></div>
  <!-- reelEngine BLOCK -->
</div>
${longBody}
</body></html>`;

const NO_BALANCE_HTML = CLEAN_HTML.replace('class="balance-hud"', 'class="x-removed"');
const NO_VIEWPORT_HTML = CLEAN_HTML.replace('name="viewport"', 'name="other"');
const NO_THEME_HTML = CLEAN_HTML.replace('--bg-base:#000;--accent:#fff;', '/* stripped */');
const SHORT_HTML = CLEAN_HTML.replace(longBody, '');

try {
  /* Clean fixture — should PASS */
  fixture('_v9-test-clean', CLEAN_HTML, { topology: { kind: 'rectangular' } });

  /* No balanceHud — should FAIL (mandatory hub control missing) */
  fixture('_v9-test-no-balance', NO_BALANCE_HTML, { topology: { kind: 'rectangular' } });

  /* No viewport meta — should FAIL */
  fixture('_v9-test-no-viewport', NO_VIEWPORT_HTML, { topology: { kind: 'rectangular' } });

  /* No theme CSS vars — should WARN (not FAIL) */
  fixture('_v9-test-no-theme', NO_THEME_HTML, { topology: { kind: 'rectangular' } });

  /* Short body — should WARN */
  fixture('_v9-test-short', SHORT_HTML, { topology: { kind: 'rectangular' } });

  const res = run();
  // Walker exit 1 if any FAIL, else 0. We expect 1 (from no-balance + no-viewport).
  const report = loadReport();

  const clean = r(report, '_v9-test-clean');
  assert(clean?.verdict === 'PASS', `clean fixture verdict=${clean?.verdict}, score=${clean?.score}`);

  const noBal = r(report, '_v9-test-no-balance');
  assert(noBal?.verdict === 'FAIL', `no-balance verdict=${noBal?.verdict}`);
  assert((noBal.checks || []).some(c => c.name.includes('balanceHud') && c.verdict === 'FAIL'),
    'no-balance should fail the balanceHud check');

  const noVp = r(report, '_v9-test-no-viewport');
  assert(noVp?.verdict === 'FAIL', `no-viewport verdict=${noVp?.verdict}`);

  const noTheme = r(report, '_v9-test-no-theme');
  // No theme is WARN (not FAIL — passes everything else)
  assert(noTheme?.verdict !== 'FAIL', `no-theme should not be FAIL (got ${noTheme?.verdict})`);
  assert((noTheme.checks || []).some(c => c.name.includes('CSS theme') && c.verdict === 'WARN'),
    'no-theme should WARN on CSS theme check');

  const short = r(report, '_v9-test-short');
  assert((short.checks || []).some(c => c.name.includes('body length') && c.verdict === 'WARN'),
    'short fixture should WARN on body length');

  // Walker exit code should be 1 (because we have 2 FAILs)
  assert(res.exit === 1, `walker exit expected 1 (FAILs present), got ${res.exit}`);

  cleanup();
  console.log('✓ v9-visual-qa.test.mjs — clean PASS, no-balance/no-viewport FAIL, no-theme/short WARN all asserted');
} catch (e) {
  cleanup();
  console.error('✗ v9-visual-qa.test.mjs:', e.message);
  process.exit(1);
}
