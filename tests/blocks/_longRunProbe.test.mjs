/**
 * tests/blocks/_longRunProbe.test.mjs · D-1 LONG-RUN
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SUMMARY = path.join(ROOT, 'reports/long-run/summary.json');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== long-run probe validator (D-1) ===');

const out = spawnSync(process.execPath, ['tools/_ultimate-long-run-probe.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('probe exits 0', out.status === 0, out.stderr.slice(0, 200));

const summary = JSON.parse(await fs.readFile(SUMMARY, 'utf8'));
t('summary 0 failures', summary.fail === 0);
t('total spins ≥ 60000', summary.totalSpins >= 60000);
t('heap delta within budget', summary.heapDeltaMB <= summary.heapBudgetMB);
t('GC reclaim happened (NOT monotonic)', summary.monotonicAscend === false);
t('spin history bounded ≤ 100', summary.spinHistorySize <= 100);
t('player XP > 0', summary.xpEarned > 0);
t('player level > 0', summary.xpLevel > 0);
t('0 console errors', summary.consoleErrors === 0);
t('wall-clock < 120s', summary.wallMs < 120000);
t('per-spin avg ≤ 5ms', summary.msPerSpin <= 5);
t('throughput ≥ 200 spins/sec', summary.spinsPerSecond >= 200);
t('heap trend has ≥ 5 samples', Array.isArray(summary.heapSamples) && summary.heapSamples.length >= 5);

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
