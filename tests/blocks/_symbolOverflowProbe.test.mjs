/**
 * tests/blocks/_symbolOverflowProbe.test.mjs · D-10 SYMBOL-OVERFLOW validator
 *
 * Reads the latest run from reports/_ultimate-symbol-overflow/ and asserts:
 *   • finalVerdict === 'PASS'
 *   • totalOverflows === 0
 *   • every game has overflowingCells === 0
 *   • every game has pageErrors === 0
 *
 * Run `node tools/_ultimate-symbol-overflow-probe.mjs` first to produce a
 * fresh run JSON. The probe forces `.has-winselection` + `.is-win` on the
 * 4 geometrical edge cells (top-left, top-right, bottom-left, bottom-right)
 * per game and measures `getBoundingClientRect()` containment vs the
 * parent `.reelCol` (or `.gridHost`) bounding box, with ±0.5px tolerance.
 *
 * The bug this guards: if a future CSS change re-introduces any transform
 * (scale/rotate/translate without a safe transform-origin) on `.is-win`
 * cells, edge cells will visually clip past `.reelCol { overflow: hidden }`
 * and the player sees "winning symbol disappears from reel frame".
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const DIR  = path.join(ROOT, 'reports/_ultimate-symbol-overflow');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== D-10 symbol-overflow validator ===');

let entries = [];
try {
  entries = (await fs.readdir(DIR))
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .sort();
} catch {
  console.error('  ✗ no reports/_ultimate-symbol-overflow/ — run ' +
                '`node tools/_ultimate-symbol-overflow-probe.mjs` first');
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
t('totalOverflows === 0', report.totalOverflows === 0,
  `got ${report.totalOverflows}`);
t('fail count === 0', report.fail === 0, `got ${report.fail}`);
t('pass count >= 4', (report.pass || 0) >= 4, `got ${report.pass}`);

for (const g of (report.perGame || [])) {
  t(`${g.game}: verdict=PASS`, g.verdict === 'PASS', `got "${g.verdict}"`);
  t(`${g.game}: 0 overflowing cells`, g.overflowingCells === 0,
    `got ${g.overflowingCells}/${g.totalWinningCells}, worst ${g.worstPx}px`);
  t(`${g.game}: 0 page errors`, (g.pageErrors || 0) === 0,
    `got ${g.pageErrors}`);
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
