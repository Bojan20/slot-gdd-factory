/**
 * tests/blocks/_rngBiasProbe.test.mjs · D-4 RNG-BIAS REAL
 *
 * Validates the split-half stability probe output.
 * Probe runs separately via `npm run test:rng:probe`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/rng-bias/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== rng-bias probe validator (D-4) ===');

const summaryRaw = await fs.readFile(SUMMARY, 'utf8').catch(() => null);
if (!summaryRaw) {
  console.error('  ✗ summary.json missing — run `npm run test:rng:probe` first');
  process.exit(1);
}

const summary = JSON.parse(summaryRaw);
t('summary has testType=split-half-stability', summary.testType === 'split-half-stability');
t('summary has spinsPerFixture', summary.spinsPerFixture >= 50);
t('summary has pThreshold 0.001', summary.pThreshold === 0.001);
t('summary has fixture results', summary.fixtures.length >= 1);
t('summary 0 failures', summary.fail === 0);
t('aggregate totalSpins > 0', summary.aggregate.totalSpins > 0);
t('aggregate allStable === true', summary.aggregate.allStable === true);
t('aggregate avgDominantFrac < 50%', summary.aggregate.avgDominantFrac < 0.5);

for (const f of summary.fixtures) {
  t(`${f.fixture}: spins completed > 0`, f.spinsCompleted > 0);
  t(`${f.fixture}: split-half p > ${summary.pThreshold}`,
    f.splitHalfP > summary.pThreshold, `p=${f.splitHalfP}`);
  t(`${f.fixture}: stable=true`, f.stable === true);
  t(`${f.fixture}: 0 console errors`, f.consoleErrors === 0);
  t(`${f.fixture}: minCellVariety ≥ 3`, f.minCellVariety >= 3);
  t(`${f.fixture}: dominantFrac < 60%`, f.dominantFrac < 0.6);
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
