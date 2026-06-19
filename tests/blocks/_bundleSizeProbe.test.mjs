/**
 * tests/blocks/_bundleSizeProbe.test.mjs
 * C-1 LEGO-PERF — validates bundle-size probe + budgets.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/bundle-size');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== bundle-size probe (C-1 LEGO-PERF) ===');

const out = spawnSync(process.execPath, ['tools/_ultimate-bundle-size-probe.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('probe exits 0 (all budgets honored)', out.status === 0, out.stderr.slice(0, 200));

const summary = JSON.parse(await fs.readFile(path.join(REPORT_DIR, 'summary.json'), 'utf8'));
t('summary.json has budgets', summary.budgets && typeof summary.budgets.perFixtureHtmlKB === 'number');
t('summary.json has 4 fixtures', Array.isArray(summary.fixtures) && summary.fixtures.length === 4);
t('summary.json has perBlock aggregate', summary.perBlock && summary.perBlock.count > 100);
t('summary.json has top10', Array.isArray(summary.top10) && summary.top10.length === 10);
t('summary 0 fail', summary.fail === 0);

for (const f of summary.fixtures) {
  t(`${f.fixture} HTML within budget`, f.totalKB <= summary.budgets.perFixtureHtmlKB, f.totalKB + ' KB');
  t(`${f.fixture} CSS within budget`, f.cssKB <= summary.budgets.totalCssKB, f.cssKB + ' KB');
  t(`${f.fixture} JS within budget`, f.jsKB <= summary.budgets.totalRuntimeKB, f.jsKB + ' KB');
}

const perBlock = JSON.parse(await fs.readFile(path.join(REPORT_DIR, 'per-block.json'), 'utf8'));
t('per-block.json has > 100 entries', perBlock.length > 100);
t('per-block.json sorted by total desc',
  perBlock.every((b, i) => i === 0 || perBlock[i - 1].totalBytes >= b.totalBytes));

const md = await fs.readFile(path.join(REPORT_DIR, 'top20.md'), 'utf8');
t('top20.md has heading', md.startsWith('# Bundle size'));
t('top20.md has rank table', md.includes('| Rank |'));
t('top20.md has aggregate stats', md.includes('## Aggregate stats'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
