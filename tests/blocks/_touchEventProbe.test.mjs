/**
 * tests/blocks/_touchEventProbe.test.mjs · D-6 TOUCH-EVENT REAL
 *
 * Reads touch-event probe summary (probe runs separately via
 * `npm run test:touch:probe`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/touch-event/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== touch-event probe validator (D-6) ===');

const summaryRaw = await fs.readFile(SUMMARY, 'utf8').catch(() => null);
if (!summaryRaw) {
  console.error('  ✗ summary.json missing — run `npm run test:touch:probe` first');
  process.exit(1);
}

const summary = JSON.parse(summaryRaw);
t('summary has minTargetPx=44', summary.minTargetPx === 44);
t('summary has threshold ≥ 0.70', summary.tapTargetPassThreshold >= 0.70);
t('summary 0 failures', summary.fail === 0);
t('summary has 4 fixtures', summary.fixtures.length === 4);
t('aggregate allTouchstart=true', summary.aggregate.allTouchstart === true);
t('aggregate allClick=true', summary.aggregate.allClick === true);
t('aggregate avgPassRate ≥ 0.85', summary.aggregate.avgPassRate >= 0.85,
  `${(summary.aggregate.avgPassRate * 100).toFixed(1)}%`);

for (const f of summary.fixtures) {
  t(`${f.fixture}: ≥ 70% targets pass`, f.passRate >= 0.70, `${(f.passRate * 100).toFixed(1)}%`);
  t(`${f.fixture}: touchstart fired`, f.touchstartFired === true);
  t(`${f.fixture}: click fired`, f.clickFired === true);
  t(`${f.fixture}: has viewport meta`, f.hasViewportMeta === true);
  t(`${f.fixture}: 0 console errors`, f.consoleErrors === 0);
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
