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

/* Wave H5 — per-game Big-Win Tier label overrides. Each entry mirrors the
 * matching sample GDD's §big-win section verbatim (so the dist HTML reads
 * the same tier vocabulary the design doc specifies). The block itself
 * stays vendor-neutral — these labels live only in samples + this tool
 * harness, never in src/blocks/. The lego-gate vendor scan covers
 * src/blocks/ only, so theme-flavoured labels here are kosher. */
const PER_GAME_BIGWIN = {
  /* Rectangular 5×3 — generic placeholder ladder. Boki rule 05.06.2026:
   * "bigwintier1-5 da se zna da je big win" — when a GDD doesn't author
   * its own tier vocabulary, the dist demo MUST show the identifier
   * itself ("BIGWINTIER1"..."BIGWINTIER5"), not a made-up vendor-style
   * substitute. Real per-game GDDs override with their own copy. */
  '01_rectangular_5x3_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [1800, 2400, 3200, 4800, 6400],
  },
  /* Wrath-of-Olympus — §6.4 BIG/MEGA/EPIC tier 1..3 with two extra
   * climax tiers extrapolated up the same curve. 4s plaque per tier. */
  'wrath-of-olympus.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIG WIN', 'MEGA WIN', 'EPIC WIN', 'ZEUS WIN', 'OLYMPUS WIN'],
    durations:  [4000, 4000, 4000, 4500, 5500],
  },
  /* Gates-of-Olympus 1000 — mirror BIG / MEGA / SUPER / EPIC structure
   * with a final mythic peak. Slightly faster banners (peak rapid play). */
  'gates-of-olympus-1000.html': {
    thresholds: [10, 30, 60, 200, 800],
    labels:     ['BIG WIN', 'MEGA WIN', 'SUPER WIN', 'EPIC WIN', 'MYTHIC WIN'],
    durations:  [1800, 2200, 3000, 4400, 6000],
  },
};

for (const t of targets) {
  const md = readFileSync(resolve(REPO, t.src), 'utf8');
  const model = parseGDD(md, 'md');
  /* Wave H5 — auto-enable Big-Win Tier ladder on every dist demo and
   * attach per-game labels/thresholds/durations. Per-game `model.bigWinTier`
   * is what the player actually reads on screen. */
  if (!Array.isArray(model.features)) model.features = [];
  const alreadyDeclared = model.features.some(f =>
    f && typeof f.kind === 'string' &&
    /^(big[_-]?win[_-]?tier|win[_-]?ladder|big[_-]?win[_-]?ladder)$/i.test(f.kind),
  );
  if (!alreadyDeclared) {
    model.features.push({ kind: 'big_win_tier', label: 'Big-Win Tier Ladder' });
  }
  const outBase = t.out.split('/').pop();
  const perGame = PER_GAME_BIGWIN[outBase];
  if (perGame) {
    model.bigWinTier = Object.assign({}, model.bigWinTier || {}, { enabled: true }, perGame);
  }
  const html = buildSlotHTML(model);
  writeFileSync(resolve(REPO, t.out), html);
  console.log(`✅ ${t.out}  (${(html.length/1024).toFixed(1)} KB)`);
}
