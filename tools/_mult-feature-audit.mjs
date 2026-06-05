#!/usr/bin/env node
/**
 * Wave I.2 — audit which fixtures enable a multiplier-style feature
 * so we know per-demo whether the MULT force button is meaningful.
 *
 * Multiplier blocks detected:
 *   multiplierOrb           — collects orb-symbol payouts
 *   persistentMultiplier    — escalates over consecutive losses
 *   lightning               — random zap that multiplies a single win
 *   progressiveFreeSpins    — multiplier grows during FS
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';

const REPO  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRIDS = resolve(REPO, 'samples/grids');

const MULT_FEATURE_KINDS = ['multiplier_orb', 'persistent_multiplier', 'lightning', 'progressive_free_spins', 'multiplier'];
const SOURCES = [
  ...readdirSync(GRIDS).filter(f => f.endsWith('.md')).map(f => ({ src: `samples/grids/${f}`, name: f })),
  { src: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md',      name: 'WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { src: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md', name: 'GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
];

console.log('═══ Multiplier-feature audit per fixture ═══\n');
for (const { src, name } of SOURCES) {
  const text = readFileSync(resolve(REPO, src), 'utf8');
  let model;
  try { model = parseGDD(text, 'md'); }
  catch (e) { console.log(`  ! ${name.padEnd(48)} PARSE ERROR`); continue; }
  const feats = Array.isArray(model.features) ? model.features : [];
  const multFeats = feats.filter(f => f && typeof f.kind === 'string' && MULT_FEATURE_KINDS.some(k =>
    f.kind.toLowerCase().includes(k.replace('_', '_')) || f.kind.toLowerCase().includes(k.replace('_', ''))
  ));
  const hasMult = multFeats.length > 0;
  console.log(`  ${hasMult ? '✓' : ' '} ${name.padEnd(48)} kind=${(model.topology?.kind || '?').padEnd(14)} mult=${hasMult ? multFeats.map(f => f.kind).join(',') : '(none)'}`);
}
