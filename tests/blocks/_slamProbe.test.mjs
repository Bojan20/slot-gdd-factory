/**
 * tests/blocks/_slamProbe.test.mjs
 * FIX-8 MED+ — Slam probe validator.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/slam-cascade/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== slam probe validator (FIX-8 MED+) ===');

const out = spawnSync(process.execPath, ['tools/_ultimate-slam-during-cascade-probe.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('probe exits 0', out.status === 0, out.stderr.slice(0, 200));

const summary = JSON.parse(await fs.readFile(SUMMARY, 'utf8'));
t('summary 0 failures', summary.fail === 0);
t('summary has 4 fixtures', summary.fixtures.length === 4);

/* Scenario A: cascade results (8 entries — 4 fixtures × 2 runs) */
const cascadeResults = summary.results.filter(r => !r.scenario);
t('8 cascade probe results', cascadeResults.length === 8, `got ${cascadeResults.length}`);

/* Scenario B: spin results (4 entries) */
const spinResults = summary.results.filter(r => r.scenario === 'spin');
t('4 spin probe results', spinResults.length === 4, `got ${spinResults.length}`);

for (const sp of spinResults) {
  t(`${sp.fixture} SPIN: slam button visible during spin`, sp.visibleOk === true);
  t(`${sp.fixture} SPIN: 0 console errors`, sp.consoleErrors === 0);
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
