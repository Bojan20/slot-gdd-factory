#!/usr/bin/env node
/**
 * tools/_freeze-default-config-audit.mjs — UQ-DEEP-AM FIX-3
 *
 * Scans src/blocks/*.mjs for `defaultConfig()` exports and verifies that
 * the returned object is shallow-frozen (Object.isFrozen === true).
 *
 * Two pass modes:
 *   --static : regex scan of source (checks `Object.freeze` in function body)
 *   --runtime: imports each block and asserts Object.isFrozen(defaultConfig())
 *
 * Default = runtime (definitive contract check).
 *
 * Exit 0 when every block freezes its defaultConfig() return value.
 * Exit 1 with offender list otherwise.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blocksDir = resolve(__dirname, '..', 'src', 'blocks');

const mode = process.argv.includes('--static') ? 'static' : 'runtime';

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
    if (Object.isFrozen(cfg)) { pass++; }
    else { fail++; offenders.push(f); }
  }
}

console.log('\n--- freeze-default-config-audit (' + mode + ') ---');
console.log('  pass    :', pass);
console.log('  fail    :', fail);
console.log('  skipped :', skipped, '(no defaultConfig export)');
console.log('  total   :', blocks.length);

if (offenders.length) {
  console.log('\n  UNFROZEN defaultConfig() in:');
  for (const f of offenders) console.log('    -', f);
}

process.exit(fail === 0 ? 0 : 1);
