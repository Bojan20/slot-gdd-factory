/**
 * tests/blocks/_winPresentationCrossGdd.test.mjs · Cross-GDD winPresentation
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/winpresentation-cross-gdd/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== winPresentation cross-GDD validator ===');

const summaryRaw = await fs.readFile(SUMMARY, 'utf8').catch(() => null);
if (!summaryRaw) {
  console.error('  ✗ summary.json missing — run `npm run test:wp:cross` first');
  process.exit(1);
}

const summary = JSON.parse(summaryRaw);
t('summary 0 failures', summary.fail === 0);
t('summary has 4 fixtures', summary.fixtures.length === 4);
t('aggregate allEmittedStart=true', summary.aggregate.allEmittedStart === true);
t('aggregate allEmittedEnd=true', summary.aggregate.allEmittedEnd === true);
t('aggregate allClean=true', summary.aggregate.allClean === true);
t('aggregate allZeroErrors=true', summary.aggregate.allZeroErrors === true);

for (const f of summary.fixtures) {
  t(`${f.fixture}: ≥ 1 winPresentationStart`, f.startEvents >= 1);
  t(`${f.fixture}: ≥ 1 winPresentationEnd`, f.endEvents >= 1);
  t(`${f.fixture}: endFired=true`, f.endFired === true);
  t(`${f.fixture}: no stuck banner`, !f.stuckBanner);
  t(`${f.fixture}: 0 console errors`, f.consoleErrors === 0);
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
