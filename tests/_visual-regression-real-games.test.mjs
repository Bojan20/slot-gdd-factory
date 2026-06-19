#!/usr/bin/env node
/**
 * tests/_visual-regression-real-games.test.mjs · C-3 LEGO-VISREG layer 2
 *
 * Verifies the real-game visual-regression tool produces a valid baseline
 * shape and that the tool source itself is structurally sound. Does NOT
 * launch chromium (that's the job of `npm run test:visreg:real`).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, ok, hint) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? ' — ' + hint : '')); }
};

console.log('— visual-regression-real-games tool —');

const toolPath = resolve(REPO, 'tools/visual-regression-real-games.mjs');
const baselinePath = resolve(REPO, 'tests/baselines/visual-regression-real-games.json');

t('tool file exists', existsSync(toolPath));

const toolSrc = readFileSync(toolPath, 'utf8');
t('tool exports node shebang', toolSrc.startsWith('#!/usr/bin/env node'));
t('tool imports playwright chromium', /from 'playwright'/.test(toolSrc));
t('tool supports --bake mode', /BAKE\s*=\s*argv\.includes\('--bake'\)/.test(toolSrc));
t('tool supports --visualize mode', /VISUALIZE\s*=\s*argv\.includes\('--visualize'\)/.test(toolSrc));
t('tool injects animation-kill CSS', /animation-duration:\s*0s\s*!important/.test(toolSrc));
t('tool uses prefers-reduced-motion: reduce context', /reducedMotion:\s*'reduce'/.test(toolSrc));
t('tool hashes with SHA-256', /createHash\('sha256'\)/.test(toolSrc));
t('tool covers 2 viewports', /desktop[\s\S]*portrait/.test(toolSrc));
t('tool reads dist/real-games', /dist\/real-games/.test(toolSrc));
t('tool writes reports/visreg-real', /reports\/visreg-real/.test(toolSrc));
t('tool exit-codes 0 success', /process\.exit\(0\)/.test(toolSrc));
t('tool exit-codes 1 drift', /process\.exit\(1\)/.test(toolSrc));
t('tool exit-codes 2 fatal', /process\.exit\(2\)/.test(toolSrc));

if (existsSync(baselinePath)) {
  const b = JSON.parse(readFileSync(baselinePath, 'utf8'));
  t('baseline schema is visreg-real-v1', b.schema === 'visreg-real-v1');
  t('baseline has entries object', b.entries && typeof b.entries === 'object');
  t('baseline has ≥ 8 entries (4 games × 2 viewports)', Object.keys(b.entries).length >= 8);
  t('baseline lists desktop + portrait viewports', Array.isArray(b.viewports) && b.viewports.includes('desktop') && b.viewports.includes('portrait'));
  for (const [key, entry] of Object.entries(b.entries)) {
    t(`entry "${key}" has 64-char sha-256 hash`, typeof entry.hash === 'string' && entry.hash.length === 64);
    t(`entry "${key}" has bytes count`, Number.isInteger(entry.bytes) && entry.bytes > 0);
    t(`entry "${key}" has ISO timestamp`, typeof entry.ts === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(entry.ts));
  }
} else {
  t('baseline file exists', false, 'run `npm run test:visreg:real:bake` first');
}

/* package.json script registration */
const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8'));
t('npm script test:visreg:real registered', typeof pkg.scripts['test:visreg:real'] === 'string');
t('npm script test:visreg:real:bake registered', typeof pkg.scripts['test:visreg:real:bake'] === 'string');
t('npm script test:visreg:real:visualize registered', typeof pkg.scripts['test:visreg:real:visualize'] === 'string');

console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
