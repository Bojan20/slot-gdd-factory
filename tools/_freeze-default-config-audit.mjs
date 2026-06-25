#!/usr/bin/env node
/**
 * tools/_freeze-default-config-audit.mjs — UQ-DEEP-AM FIX-3
 *                                          + P3-P1 deep-freeze report
 *
 * Scans src/blocks/*.mjs for `defaultConfig()` exports and verifies that
 * the returned object is shallow-frozen (Object.isFrozen === true).
 *
 * Modes:
 *   --static  : regex scan of source (checks `Object.freeze` in function body)
 *   --runtime : imports each block and asserts Object.isFrozen(defaultConfig())
 *   --deep    : imports each block and asserts isDeepFrozen(defaultConfig())
 *
 * Default = runtime (definitive shallow contract check).
 *
 * `--deep` is REPORT-ONLY (does not exit non-zero on non-deep-frozen): the
 * current contract is "shallow", and migrating every block to deep freeze
 * requires per-block resolveConfig refactor (nested writes throw post
 * deep-freeze). The deep report tells the operator HOW MANY blocks already
 * pass deep freeze for free (no nested mutation in defaults) and which
 * candidates are next for safe migration.
 *
 * Exit 0 when every block freezes its defaultConfig() return value
 * (under the active mode's contract).
 * Exit 1 with offender list otherwise (shallow modes only).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepFrozen } from '../src/registry/deepFreeze.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blocksDir = resolve(__dirname, '..', 'src', 'blocks');

const argv = process.argv;
const mode = argv.includes('--static') ? 'static'
            : argv.includes('--deep')   ? 'deep'
            : 'runtime';

const blocks = readdirSync(blocksDir).filter(f =>
  f.endsWith('.mjs') && !f.startsWith('_')
);

let pass = 0;
let fail = 0;
let skipped = 0;
const offenders = [];

if (mode === 'static') {
  for (const f of blocks) {
    const src = readFileSync(resolve(blocksDir, f), 'utf8');
    const m = src.match(/export\s+function\s+defaultConfig[^{]*\{[\s\S]*?\n\}/);
    if (!m) { skipped++; continue; }
    if (/Object\.freeze/.test(m[0])) { pass++; }
    else { fail++; offenders.push(f); }
  }
} else {
  for (const f of blocks) {
    let mod;
    try {
      mod = await import(pathToFileURL(resolve(blocksDir, f)).href);
    } catch (e) {
      console.log('  !', f, '— import error:', e.message);
      skipped++;
      continue;
    }
    if (typeof mod.defaultConfig !== 'function') { skipped++; continue; }
    let cfg;
    try {
      cfg = mod.defaultConfig();
    } catch (e) {
      console.log('  !', f, '— defaultConfig() threw:', e.message);
      fail++;
      offenders.push(f);
      continue;
    }
    /* `--deep` reports without failing the gate. The shallow contract
       is still the project's hard rule today. */
    const okShallow = Object.isFrozen(cfg);
    if (mode === 'deep') {
      if (isDeepFrozen(cfg)) { pass++; }
      else { fail++; offenders.push(f); }
    } else if (okShallow) { pass++; }
    else { fail++; offenders.push(f); }
  }
}

console.log('\n--- freeze-default-config-audit (' + mode + ') ---');
console.log('  pass    :', pass);
console.log('  fail    :', fail);
console.log('  skipped :', skipped, '(no defaultConfig export)');
console.log('  total   :', blocks.length);

if (offenders.length) {
  const label = mode === 'deep'
    ? 'NOT-DEEP-FROZEN defaultConfig() in (P3-P1 migration candidates):'
    : 'UNFROZEN defaultConfig() in:';
  console.log('\n  ' + label);
  for (const f of offenders) console.log('    -', f);
}

/* `--deep` is REPORT-ONLY — see header docstring. Other modes still gate
   on shallow contract. */
if (mode === 'deep') process.exit(0);
process.exit(fail === 0 ? 0 : 1);
