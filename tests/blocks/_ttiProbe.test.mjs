/**
 * tests/blocks/_ttiProbe.test.mjs · D-7 TIME-TO-INTERACTIVE
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/tti/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== TTI probe validator (D-7) ===');

const summaryRaw = await fs.readFile(SUMMARY, 'utf8').catch(() => null);
if (!summaryRaw) {
  console.error('  ✗ summary.json missing — run `npm run test:tti:probe` first');
  process.exit(1);
}

const summary = JSON.parse(summaryRaw);
t('summary has budgets', typeof summary.budgets === 'object');
t('summary 0 failures', summary.fail === 0);
t('summary has 4 fixtures', summary.fixtures.length === 4);

t('aggregate avgFCP within budget',
  summary.aggregate.avgFCP <= summary.budgets.fcpMs,
  `${summary.aggregate.avgFCP}ms`);
t('aggregate avgLCP within budget',
  summary.aggregate.avgLCP <= summary.budgets.lcpMs);
t('aggregate avgTTI within budget',
  summary.aggregate.avgTTI <= summary.budgets.ttiMs);
t('aggregate avgTBT within budget',
  summary.aggregate.avgTBT <= summary.budgets.tbtMs);
t('aggregate avgDCL within budget',
  summary.aggregate.avgDCL <= summary.budgets.domContentLoadedMs);

t('max FCP within budget', summary.aggregate.maxFCP <= summary.budgets.fcpMs);
t('max LCP within budget', summary.aggregate.maxLCP <= summary.budgets.lcpMs);
t('max TTI within budget', summary.aggregate.maxTTI <= summary.budgets.ttiMs);

for (const f of summary.fixtures) {
  t(`${f.fixture}: FCP measured`, f.metrics.firstContentfulPaintMs !== null);
  t(`${f.fixture}: interactive=true`, f.interactive === true);
  t(`${f.fixture}: 0 console errors`, f.consoleErrors === 0);
  t(`${f.fixture}: FCP within budget`,
    f.metrics.firstContentfulPaintMs <= summary.budgets.fcpMs);
  t(`${f.fixture}: TTI within budget`,
    f.metrics.ttiMs <= summary.budgets.ttiMs);
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
