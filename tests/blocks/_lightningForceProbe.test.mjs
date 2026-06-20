/**
 * tests/blocks/_lightningForceProbe.test.mjs · D-12 LIGHTNING FORCE validator
 *
 * Reads the latest run from reports/_ultimate-lightning-force/ and asserts:
 *   • finalVerdict === 'PASS'
 *   • every game verified all 4 multiplier values (×2 ×3 ×5 ×10)
 *   • every per-value test had observedMultX === forced value (no
 *     pick-randomly fallback)
 *   • forced flag cleared after consume (no leak into next spin)
 *
 * Probe lives in tools/_ultimate-lightning-force-probe.mjs and clicks
 * each `.ufp-chip[data-ufp-kind="lightning_xN"]` chip in sequence per
 * game, captures the resulting `onLightningStrike` event payload, and
 * verifies multX === N exactly.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const DIR  = path.join(ROOT, 'reports/_ultimate-lightning-force');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== D-12 lightning-force validator ===');

let entries = [];
try {
  entries = (await fs.readdir(DIR))
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .sort();
} catch {
  console.error('  ✗ no reports/_ultimate-lightning-force/ — run probe first');
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
t('fail count === 0', report.fail === 0, `got ${report.fail}`);
t('err count === 0', (report.err || 0) === 0, `got ${report.err}`);
t('pass count >= 1', (report.pass || 0) >= 1, `got ${report.pass}`);

const FORCED = [2, 3, 5, 10];
for (const g of (report.perGame || [])) {
  t(`${g.game}: verdict=PASS`, g.verdict === 'PASS', `got "${g.verdict}"`);
  t(`${g.game}: all 4 values verified`,
    g.passCount === 4, `got ${g.passCount}/4`);
  for (const v of FORCED) {
    const entry = (g.perValue || []).find(p => p.value === v);
    if (!entry) {
      t(`${g.game}: ⚡×${v} entry present`, false, 'missing');
      continue;
    }
    t(`${g.game}: ⚡×${v} chip clicked OK`, entry.chipClicked === true,
      entry.clickError || 'click failed');
    t(`${g.game}: ⚡×${v} strikeCount === 1`, entry.strikeCount === 1,
      `got ${entry.strikeCount}`);
    t(`${g.game}: ⚡×${v} observedMultX === ${v}`,
      entry.observedMultX === v, `got ${entry.observedMultX}`);
    t(`${g.game}: ⚡×${v} forced flag cleared after consume`,
      entry.forcedFlagClearedAfter === true,
      `forcedAfter=${entry.forcedFlagAfter}`);
  }
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
