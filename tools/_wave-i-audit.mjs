#!/usr/bin/env node
/**
 * Wave I — parse every samples/grids/*.md, log topology.kind so we
 * know which grid kinds each fixture produces. Compare with the
 * UNIFORM_REEL_KINDS set in buildSlotHTML to identify which fixtures
 * the H5.x block stack can render as playable.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRIDS = resolve(REPO, 'samples/grids');

const UNIFORM_REEL_KINDS = new Set([
  'rectangular', 'cluster', 'megaclusters', 'lock_respin',
  'expanding', 'infinity', 'variable_reel',
  'diamond', 'pyramid', 'cross', 'l_shape',
]);

console.log('═══ Wave I audit — fixture → topology.kind ═══\n');
const files = readdirSync(GRIDS).filter(f => f.endsWith('.md')).sort();
const byKind = {};

for (const f of files) {
  const text = readFileSync(resolve(GRIDS, f), 'utf8');
  try {
    const model = parseGDD(text, 'md');
    const kind = model.topology?.kind || '(unknown)';
    const reels = model.topology?.reels;
    const rows  = model.topology?.rows;
    const uniform = UNIFORM_REEL_KINDS.has(kind);
    console.log(`  ${uniform ? '✓' : '✗'} ${f.padEnd(48)} kind=${kind.padEnd(16)} ${reels}×${rows} ${uniform ? '(UNIFORM)' : '(non-uniform — H5.x N/A)'}`);
    if (!byKind[kind]) byKind[kind] = [];
    byKind[kind].push(f);
  } catch (e) {
    console.log(`  ! ${f.padEnd(48)} PARSE ERROR: ${e.message}`);
  }
}

console.log('\n═══ Grouped by kind ═══\n');
for (const k of Object.keys(byKind).sort()) {
  const uniform = UNIFORM_REEL_KINDS.has(k);
  console.log(`  ${uniform ? '✓' : '✗'} ${k.padEnd(16)} (${byKind[k].length}): ${byKind[k].join(', ')}`);
}

console.log('\n═══ UNIFORM kinds NOT yet covered as dist fixture ═══\n');
const coveredInRegen = new Set(['rectangular', 'cluster', 'variable_reel']);
const missing = [];
for (const k of UNIFORM_REEL_KINDS) {
  if (!coveredInRegen.has(k)) missing.push(k);
}
missing.forEach(k => {
  const fixtures = byKind[k] || [];
  console.log(`  ⚠ ${k.padEnd(16)} ${fixtures.length ? '→ ' + fixtures.join(', ') : '(no fixture)'}`);
});
