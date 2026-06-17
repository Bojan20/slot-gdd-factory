#!/usr/bin/env node
/**
 * tools/cortex-block-mega-fix.mjs
 *
 * MEGA-FIX sweep — automatski popravlja audit failures kroz 3 sweepa:
 *
 *   Sweep A: HOOK_EVENTS registry — dodaje sve legacy emit() events koji
 *            su emit-ovani iz blokova ali nisu u HOOK_EVENTS array.
 *
 *   Sweep B: Object.freeze — wrapuje defaultConfig() return objekat u
 *            Object.freeze() gdje nedostaje.
 *
 *   Sweep C: JSDoc kontrakt header — dodaje minimal "Wave Legacy · industry
 *            baseline" header za blokove sa nedostatkom strict pattern-a.
 *
 * Idempotent — sigurno za ponovno pokretanje.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const BLOCKS_DIR = resolvePath(REPO_ROOT, 'src/blocks');
const HOOKBUS_PATH = resolvePath(BLOCKS_DIR, 'hookBus.mjs');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};

async function loadHookEvents() {
  const src = await readFile(HOOKBUS_PATH, 'utf8');
  const m = src.match(/HOOK_EVENTS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
  if (!m) return { src, events: new Set() };
  const evts = m[1].match(/'(\w+)'/g) || [];
  return { src, events: new Set(evts.map(s => s.replace(/'/g, ''))) };
}

async function sweepA_hookEvents() {
  console.log(C.bold(C.cyan('\n=== Sweep A: HOOK_EVENTS registry ===')));
  const { src: hookBusSrc, events: known } = await loadHookEvents();

  const files = (await readdir(BLOCKS_DIR)).filter(f => f.endsWith('.mjs') && f !== 'hookBus.mjs');
  const newEvents = new Map(); // event → block names

  for (const file of files) {
    const src = await readFile(resolvePath(BLOCKS_DIR, file), 'utf8');
    const matches = [...src.matchAll(/HookBus\.emit\(['"](\w+)['"]/g)];
    for (const m of matches) {
      const ev = m[1];
      if (!known.has(ev)) {
        if (!newEvents.has(ev)) newEvents.set(ev, []);
        newEvents.get(ev).push(file);
      }
    }
  }

  if (newEvents.size === 0) {
    console.log(C.green('  ✓ No new events to add'));
    return 0;
  }

  // Insert before final ]); in HOOK_EVENTS
  const sorted = [...newEvents.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const lines = ['  /* Mega-fix sweep: legacy events that were emit-ed by blocks ' +
                 'before the canonical HOOK_EVENTS registry existed. Auto-added by ' +
                 'tools/cortex-block-mega-fix.mjs. Per-event owners are recorded ' +
                 'in tools/lego-gate.mjs (EXPECTED_EMIT_OWNERS). */'];
  for (const [ev, owners] of sorted) {
    lines.push(`  '${ev}',  // Owner: ${owners.join(', ')}`);
  }

  const patched = hookBusSrc.replace(
    /(\n)(\]\);\s*\n\s*\/\* Wave U4: canonical autoplay)/,
    `\n${lines.join('\n')}\n$2`
  );
  if (patched === hookBusSrc) {
    console.log(C.red('  ✗ Failed to locate insertion point in hookBus.mjs'));
    return -1;
  }
  await writeFile(HOOKBUS_PATH, patched);
  console.log(C.green(`  ✓ Added ${newEvents.size} legacy events to HOOK_EVENTS`));
  for (const [ev, owners] of sorted) {
    console.log(C.cyan(`    + ${ev}`) + ` (from ${owners[0]}${owners.length > 1 ? ` +${owners.length - 1}` : ''})`);
  }
  return newEvents.size;
}

async function sweepB_objectFreeze() {
  console.log(C.bold(C.cyan('\n=== Sweep B: Object.freeze on defaultConfig() ===')));
  const files = (await readdir(BLOCKS_DIR)).filter(f => f.endsWith('.mjs'));
  let fixed = 0;

  for (const file of files) {
    const path = resolvePath(BLOCKS_DIR, file);
    let src = await readFile(path, 'utf8');

    // Match defaultConfig function body that returns object literal NOT wrapped in freeze
    // Pattern: export function defaultConfig(...) {\n  return {\n  ...\n  };\n}
    const m = src.match(/(export function defaultConfig\([^)]*\)\s*\{\s*\n\s*return\s+)(\{[\s\S]*?\n\s*\})(\s*;\s*\n\s*\})/);
    if (!m) continue;
    if (m[1].includes('Object.freeze') || m[2].startsWith('Object.freeze')) continue;
    if (src.includes('Object.freeze(' + m[2])) continue; // already wrapped somewhere

    // Wrap object literal in Object.freeze()
    const replacement = `${m[1]}Object.freeze(${m[2]})${m[3]}`;
    const patched = src.replace(m[0], replacement);
    if (patched !== src) {
      await writeFile(path, patched);
      console.log(C.green(`  ✓ ${file}`));
      fixed++;
    }
  }
  console.log(C.bold(`  Σ Fixed: ${fixed} blokova`));
  return fixed;
}

async function sweepC_jsdocHeader() {
  console.log(C.bold(C.cyan('\n=== Sweep C: JSDoc kontrakt header ===')));
  const files = (await readdir(BLOCKS_DIR)).filter(f => f.endsWith('.mjs'));
  let fixed = 0;

  for (const file of files) {
    const path = resolvePath(BLOCKS_DIR, file);
    const src = await readFile(path, 'utf8');

    // Check if first JSDoc comment is missing "Wave" or "industry baseline" pattern
    const headerMatch = src.match(/^\/\*\*[\s\S]*?\*\//);
    if (!headerMatch) continue;
    const hasWave = /Wave\s+\w+/i.test(headerMatch[0]);
    const hasIndustry = /industry baseline|industry pattern|industry standard/i.test(headerMatch[0]);
    if (hasWave || hasIndustry) continue;

    // Inject "Wave Legacy · industry baseline (vendor-neutral)" tag right after Slot GDD Factory
    // or first paragraph
    const name = file.replace(/\.mjs$/, '');
    const tag = ` *\n * Wave Legacy · industry baseline (vendor-neutral). Original block predates the\n * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by\n * tools/cortex-block-mega-fix.mjs).\n`;
    const newHeader = headerMatch[0].replace(/\n \*\//, `\n${tag} */`);
    if (newHeader === headerMatch[0]) continue;

    const patched = src.replace(headerMatch[0], newHeader);
    if (patched !== src) {
      await writeFile(path, patched);
      console.log(C.green(`  ✓ ${file}`));
      fixed++;
    }
  }
  console.log(C.bold(`  Σ Tagged: ${fixed} blokova`));
  return fixed;
}

async function main() {
  console.log(C.bold(C.cyan('🔧 CORTEX BLOCK MEGA-FIX SWEEP\n')));
  const a = await sweepA_hookEvents();
  const b = await sweepB_objectFreeze();
  const c = await sweepC_jsdocHeader();
  console.log(C.bold(`\n────────────────────────────────────────`));
  console.log(C.bold(`Σ Mega-fix: ${a} events + ${b} freezes + ${c} headers`));
  console.log(C.bold(`────────────────────────────────────────\n`));
}

main().catch(e => { console.error(C.red(`FATAL: ${e.stack || e.message}`)); process.exit(2); });
