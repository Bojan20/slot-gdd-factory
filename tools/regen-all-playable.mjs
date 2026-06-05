#!/usr/bin/env node
/**
 * Regenerate the three primary playable demos in dist/ from samples/.
 * Used by SlotGDDBuilder.command and ad-hoc by Corti after block changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { src: 'samples/grids/01_rectangular_5x3_GAME_GDD.md', out: 'dist/01_rectangular_5x3_playable.html' },
  { src: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md',         out: 'dist/wrath-of-olympus.html' },
  { src: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md',    out: 'dist/gates-of-olympus-1000.html' },
];

for (const t of targets) {
  const md = readFileSync(resolve(REPO, t.src), 'utf8');
  const model = parseGDD(md, 'md');
  /* Wave H5 — auto-enable Big-Win Tier ladder on every dist demo. Until
   * per-game GDDs declare their own tier vocabulary explicitly, this
   * places a vendor-neutral placeholder feature kind so the bigWinTier
   * block opts in. Per-game `model.bigWinTier = { thresholds, labels,
   * durations, colors, ... }` overrides land in samples once GDD-side
   * copy/QA is signed off. */
  if (!Array.isArray(model.features)) model.features = [];
  const alreadyDeclared = model.features.some(f =>
    f && typeof f.kind === 'string' &&
    /^(big[_-]?win[_-]?tier|win[_-]?ladder|big[_-]?win[_-]?ladder)$/i.test(f.kind),
  );
  if (!alreadyDeclared) {
    model.features.push({ kind: 'big_win_tier', label: 'Big-Win Tier Ladder' });
  }
  const html = buildSlotHTML(model);
  writeFileSync(resolve(REPO, t.out), html);
  console.log(`✅ ${t.out}  (${(html.length/1024).toFixed(1)} KB)`);
}
