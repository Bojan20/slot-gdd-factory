/* Unit tests for FREESPINS.countMode detection in parser.mjs.
 *
 * Two modes:
 *   'perReel' (DEFAULT)  — every reel column adds at most 1 to the scatter
 *                          total. GDD silent ⇒ this. Industry default.
 *   'any'                — every scatter cell counts (stacked scatters,
 *                          multi-row scatter symbols). GDD must explicitly
 *                          opt in via a clear phrase.
 *
 * Coverage:
 *   1. GDD silent → 'perReel'
 *   2. Explicit EN "one scatter per reel" phrasings → 'perReel'
 *   3. Explicit EN "scatters may stack" phrasings → 'any'
 *   4. Explicit SR "po jedan sketer po rilu" phrasings → 'perReel'
 *   5. Explicit SR "vise sketera po rilu" phrasings → 'any'
 *   6. Ambiguous (both phrases) → 'any' wins (explicit stacked intent)
 *   7. Stacked Storm fixture → 'any'
 */

import { extractFreeSpinsConfig } from '../src/parser.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let pass = 0, fail = 0;
const fails = [];

function check(name, expected, actual) {
  if (expected === actual) {
    pass++;
    console.log(`  ✅ ${name}  → ${actual}`);
  } else {
    fail++;
    fails.push(`${name}: expected ${expected}, got ${actual}`);
    console.log(`  ❌ ${name}  → expected ${expected}, got ${actual}`);
  }
}

function run(label, text, expected) {
  const fs = extractFreeSpinsConfig(text, { symbols: { specials: [] } });
  check(label, expected, fs.countMode);
}

console.log('=== FREESPINS.countMode parser tests ===\n');

console.log('-- 1. Silent → perReel (default) --');
run('bare "Free Spins"', 'Free Spins available.', 'perReel');
run('GDD with only ladder', '# Free Spins\n| 3 | 10 |\n| 4 | 15 |\n', 'perReel');

console.log('\n-- 2. Explicit EN per-reel phrases → perReel --');
run('"one scatter per reel"', 'Free Spins. One scatter per reel max.', 'perReel');
run('"1 scatter per reel"', 'Free Spins. 1 scatter per reel.', 'perReel');
run('"single scatter per reel"', 'Free Spins. Single scatter per reel.', 'perReel');
run('"only one scatter per reel"', 'Free Spins. Only one scatter per reel.', 'perReel');
run('"max one scatter per reel"', 'Free Spins. Max one scatter per reel.', 'perReel');
run('"scatters on different reels"', 'Free Spins. Scatters land on different reels.', 'perReel');
run('"unique reels required"', 'Free Spins. Unique reels required for trigger.', 'perReel');
run('"per-reel scatter"', 'Free Spins. Per-reel scatter only.', 'perReel');
run('"must land on distinct reels"', 'Free Spins. Scatters must land on distinct reels.', 'perReel');

console.log('\n-- 3. Explicit EN any (stacked) phrases → any --');
run('"scatters may stack"', 'Free Spins. Scatters may stack on a reel.', 'any');
run('"scatters can stack"', 'Free Spins. Scatters can stack vertically.', 'any');
run('"stacked scatters"', 'Free Spins with stacked scatters.', 'any');
run('"multiple scatters per reel"', 'Free Spins. Multiple scatters per reel allowed.', 'any');
run('"scatters can land on the same reel"',
    'Free Spins. Scatters can land on the same reel.', 'any');
run('"more than one scatter per reel"',
    'Free Spins. More than one scatter per reel possible.', 'any');
run('"3x Scatter" (column scatter)',
    'Free Spins. 3x Scatter symbol covers whole reel.', 'any');

console.log('\n-- 4. Explicit SR per-reel phrases → perReel --');
run('"po jedan sketer po rilu"',
    'Free Spins. Po jedan sketer po rilu.', 'perReel');
run('"jedan sketer po rilu"',
    'Free Spins. Jedan sketer po rilu.', 'perReel');
run('"po rilu jedan sketer"',
    'Free Spins. Po rilu jedan sketer.', 'perReel');
run('"samo jedan sketer po rilu"',
    'Free Spins. Samo jedan sketer po rilu.', 'perReel');
run('"samo po jedan sketer"',
    'Free Spins. Samo po jedan sketer dozvoljen.', 'perReel');
run('"jedinstveni rilovi"',
    'Free Spins. Jedinstveni rilovi za trigger.', 'perReel');
run('"razliciti rilovi"',
    'Free Spins. Razliciti rilovi su uslov.', 'perReel');
run('"jedan skater po rilu" (alt spelling)',
    'Free Spins. Jedan skater po rilu max.', 'perReel');

console.log('\n-- 5. Explicit SR any phrases → any --');
run('"vise sketera po rilu"',
    'Free Spins. Vise sketera po rilu moguce.', 'any');
run('"više skatera po rilu" (diacritics)',
    'Free Spins. Više skatera po rilu moguće.', 'any');
run('"moze vise sketera po rilu"',
    'Free Spins. Moze vise sketera po rilu.', 'any');
run('"stack-ovani sketeri"',
    'Free Spins. Stack-ovani sketeri.', 'any');
run('"stakovani sketeri"',
    'Free Spins. Stakovani sketeri.', 'any');

console.log('\n-- 6. Ambiguous → "any" wins (explicit stacked intent) --');
run('both phrases (any first in text)',
    'Free Spins. Scatters may stack. One scatter per reel also possible.', 'any');
run('both phrases (perReel first in text)',
    'Free Spins. One scatter per reel typical. Stacked scatters also possible.', 'any');

console.log('\n-- 7. Stacked Storm fixture (real file) → any --');
const stacked = readFileSync(
  resolve(ROOT, 'samples/grids/20_rectangular_stacked_scatter_GAME_GDD.md'),
  'utf8'
);
run('20_rectangular_stacked_scatter fixture', stacked, 'any');

console.log('\n-- 8. Existing fixtures (silent on count-mode) → perReel --');
for (const f of [
  '01_rectangular_5x3_GAME_GDD.md',
  '02_rectangular_6x4_GAME_GDD.md',
]) {
  const t = readFileSync(resolve(ROOT, 'samples/grids', f), 'utf8');
  run(f, t, 'perReel');
}
for (const f of ['WRATH_OF_OLYMPUS_GAME_GDD.md', 'CRYSTAL_FORGE_GAME_GDD.md']) {
  const t = readFileSync(resolve(ROOT, 'samples', f), 'utf8');
  run(f, t, 'perReel');
}

console.log(`\n=== RESULTS ===`);
console.log(`PASS : ${pass}`);
console.log(`FAIL : ${fail}`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of fails) console.log('  • ' + f);
  process.exit(1);
}
console.log('\n✅ ALL CLEAN');
