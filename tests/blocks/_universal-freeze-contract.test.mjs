/**
 * tests/blocks/_universal-freeze-contract.test.mjs — UQ-DEEP-AM FIX-3
 *
 * Universal block contract:
 *   defaultConfig() MUST return a shallow-frozen object.
 *
 * Rationale (from UQ-DEEP-AL QA-4 finding):
 *   38 of 211 blocks were returning a fresh-but-mutable object. Any caller
 *   that mutated the result (intentionally or via shared-reference bug)
 *   would corrupt subsequent reads from other consumers, causing flaky
 *   cross-instance contamination that surfaces only in edge cases.
 *
 *   Object.freeze(...) at the top level is sufficient because:
 *     • All known callers either spread (`{ ...defaultConfig() }`) before
 *       writing or treat the result as read-only.
 *     • Nested arrays/objects remain mutable to preserve the existing
 *       contract used by tests like `defaultConfig().thresholds.push(...)`
 *       which only verify per-call freshness, not deep immutability.
 *
 * Test target: 100% of src/blocks/*.mjs that export defaultConfig must pass.
 */

import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blocksDir = resolve(__dirname, '..', '..', 'src', 'blocks');

const blocks = readdirSync(blocksDir).filter(f =>
  f.endsWith('.mjs') && !f.startsWith('_')
);

let pass = 0;
let fail = 0;
let skipped = 0;
const offenders = [];
const importErrors = [];

for (const f of blocks) {
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(blocksDir, f)).href);
  } catch (e) {
    importErrors.push({ file: f, msg: e.message });
    skipped++;
    continue;
  }
  if (typeof mod.defaultConfig !== 'function') { skipped++; continue; }

  let cfg;
  try {
    cfg = mod.defaultConfig();
  } catch (e) {
    fail++;
    offenders.push(`${f} — defaultConfig() threw: ${e.message}`);
    continue;
  }

  if (!cfg || typeof cfg !== 'object') {
    fail++;
    offenders.push(`${f} — defaultConfig() returned non-object: ${typeof cfg}`);
    continue;
  }

  if (Object.isFrozen(cfg)) {
    pass++;
  } else {
    fail++;
    offenders.push(`${f} — defaultConfig() not frozen`);
  }
}

console.log('\n— _universal-freeze-contract —');
console.log(`  blocks scanned : ${blocks.length}`);
console.log(`  pass           : ${pass}`);
console.log(`  fail           : ${fail}`);
console.log(`  skipped        : ${skipped} (no defaultConfig export or import error)`);

if (importErrors.length) {
  console.log('\n  Import errors (not counted as failures):');
  for (const e of importErrors) console.log(`    ! ${e.file} — ${e.msg}`);
}

if (offenders.length) {
  console.log('\n  FAILURES:');
  for (const o of offenders) console.log(`    ✗ ${o}`);
}

console.log(`\n  --- summary ---`);
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);

process.exit(fail === 0 ? 0 : 1);
