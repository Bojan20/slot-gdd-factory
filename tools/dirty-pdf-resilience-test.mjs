#!/usr/bin/env node
/**
 * tools/dirty-pdf-resilience-test.mjs · Wave UQ-FORTIFY2 G7
 *
 * Runs parseGDD on dirty PDF fixtures (OCR artifacts / Unicode confusion
 * / watermarks) and asserts the parser's defensive layers still produce
 * a sane model. Validates that prose extractor and autofix don't melt
 * down on realistic noise.
 *
 * Exit 0 = all fixtures within tolerance, 1 = at least one fail.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIR = resolve(REPO, 'tests/fixtures/dirty-pdf-samples');

const { parseGDD } = await import('../src/parser.mjs');

const fixtures = readdirSync(DIR).filter(f => f.endsWith('.txt'));
let pass = 0, fail = 0;

console.log('UQ-FORTIFY2 G7 — dirty PDF resilience test');
console.log('═'.repeat(60));

for (const name of fixtures) {
  const text = readFileSync(resolve(DIR, name), 'utf8');
  let m;
  try { m = parseGDD(text, 'md'); } catch (e) {
    console.log(`  ${name.padEnd(30)} ❌ parser threw: ${e.message.slice(0, 60)}`);
    fail++;
    continue;
  }
  /* Minimum sanity asserts that must hold for ANY dirty fixture: */
  const sanity = [];
  /* 1. Topology resolved to something other than null. */
  const t = m.topology || {};
  sanity.push({ k: 'topology.reels-resolved', ok: Number.isFinite(t.reels) });
  sanity.push({ k: 'topology.rows-resolved', ok: Number.isFinite(t.rows) });
  /* 2. At least one feature detected (smartDefaults will fill if extractor 0). */
  sanity.push({ k: 'features.non-empty', ok: Array.isArray(m.features) && m.features.length >= 1 });
  /* 3. Specials bucket has at least synthetic wild + scatter (autofix). */
  const specCount = m.symbols && Array.isArray(m.symbols.specials) ? m.symbols.specials.length : 0;
  sanity.push({ k: 'specials.non-empty', ok: specCount >= 2 });
  /* 4. ≤ 3 `_failures` entries (parser walked end-to-end with at most
   *    a handful of section-level recoveries — dirty fixtures will trip
   *    a few extractors, that's expected behavior). */
  const failCount = (m.confidence && Array.isArray(m.confidence._failures)) ? m.confidence._failures.length : 0;
  sanity.push({ k: 'failures-≤3', ok: failCount <= 3 });
  const failed = sanity.filter(s => !s.ok);
  if (failed.length === 0) {
    console.log(`  ${name.padEnd(30)} ✅ ${sanity.length}/${sanity.length} sanity asserts passed`);
    pass++;
  } else {
    console.log(`  ${name.padEnd(30)} ❌ ${sanity.length - failed.length}/${sanity.length} (${failed.map(f => f.k).join(', ')})`);
    fail++;
  }
}

console.log('═'.repeat(60));
console.log(`Fixtures: ${pass}/${pass + fail} pass, ${fail} fail`);

process.exit(fail > 0 ? 1 : 0);
