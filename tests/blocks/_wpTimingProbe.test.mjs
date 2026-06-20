/**
 * tests/blocks/_wpTimingProbe.test.mjs · D-11 WP-TIMING validator
 *
 * Reads the latest run from reports/_ultimate-wp-timing/ and asserts:
 *   • finalVerdict === 'PASS'
 *   • totalViolations === 0
 *   • every game has 0 violations
 *   • every game has 0 page errors
 *   • at least one game produced wpStart > 0 + bwEnter > 0 across the run
 *     (so we know the probe actually exercised the emit sites, not just
 *      ran 0-win spins and trivially passed)
 *
 * Probe lives in tools/_ultimate-wp-timing-probe.mjs and uses page
 * addInitScript to monkey-patch HookBus.emit, capturing per-emit
 * snapshot of `.reelCol.is-spinning` count + FSM state. Any
 * onWinPresentationStart / onBigWinTierEntered emit while reels are
 * still .is-spinning = FAIL.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const DIR  = path.join(ROOT, 'reports/_ultimate-wp-timing');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== D-11 wp-timing validator ===');

let entries = [];
try {
  entries = (await fs.readdir(DIR))
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .sort();
} catch {
  console.error('  ✗ no reports/_ultimate-wp-timing/ — run probe first');
  process.exit(1);
}
if (!entries.length) {
  console.error('  ✗ no run-*.json found — probe never executed');
  process.exit(1);
}

const latest = entries[entries.length - 1];
const raw = await fs.readFile(path.join(DIR, latest), 'utf8');
const report = JSON.parse(raw);

t(`latest run loaded: ${latest}`, !!report.generatedAt);
t('finalVerdict === PASS', report.finalVerdict === 'PASS',
  `got "${report.finalVerdict}"`);
t('totalViolations === 0', report.totalViolations === 0,
  `got ${report.totalViolations}`);
t('fail count === 0', report.fail === 0, `got ${report.fail}`);
t('err count === 0', (report.err || 0) === 0, `got ${report.err}`);

let totalWpStarts = 0, totalBwEnters = 0;
for (const g of (report.perGame || [])) {
  t(`${g.game}: verdict=PASS`, g.verdict === 'PASS', `got "${g.verdict}"`);
  t(`${g.game}: 0 timing violations`, (g.violationCount || 0) === 0,
    `got ${g.violationCount}`);
  t(`${g.game}: 0 page errors`, (g.pageErrors || 0) === 0,
    `got ${g.pageErrors}`);
  totalWpStarts += (g.wpStarts || 0);
  totalBwEnters += (g.bwEnters || 0);
}

t('coverage: total wpStart > 0', totalWpStarts > 0,
  `got ${totalWpStarts} — probe did NOT exercise the emit site, trivial pass`);
t('coverage: total bwEnter > 0', totalBwEnters > 0,
  `got ${totalBwEnters} — probe did NOT reach bigWinTier emit site`);

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
