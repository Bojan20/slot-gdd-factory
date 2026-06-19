/**
 * tests/blocks/_loadProbe.test.mjs · C-5 LEGO-LOAD
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/load-probe/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== load probe validator (C-5) ===');

const out = spawnSync(process.execPath, ['tools/_ultimate-load-probe.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('probe exits 0 (within memory budget)', out.status === 0, out.stderr.slice(0, 200));

const summary = JSON.parse(await fs.readFile(SUMMARY, 'utf8'));
t('summary has spin count', summary.spinCount === 1000);
t('summary has heap budget', summary.heapBudgetMB === 8);
t('summary 0 failures', summary.fail === 0);
t('heap delta within budget', summary.heapDeltaMB <= summary.heapBudgetMB);
t('0 console errors during loop', summary.consoleErrors === 0);
t('spin history bounded ≤ 100', summary.historySize <= 100);
t('player XP accumulated', summary.xp > 0);
t('wall-clock < 30s for 1000 spins', summary.wallMs < 30000);
t('per-spin avg ≤ 5ms', summary.msPerSpin <= 5);

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
