#!/usr/bin/env node
/**
 * tools/_block-liveness-walker.mjs
 *
 * Wave UQ-MASTERY — Block Liveness Audit (eliminates false-positives from
 * the legacy `_block-coverage-walker.mjs`).
 *
 * RAZLOG ZA POSTOJANJE
 * ───────────────────
 *   Stari walker je merio SAMO HookBus emit-e i listener-e. Veliki broj
 *   blokova (paytable, anticipation, stageBadge, turboMode, i18n, ...)
 *   koristi DIREKTNE DOM eventove (click handler na dugme, MutationObserver,
 *   CSS klase). Ti blokovi su `defaultOn: true`, mount-uju se u svaki
 *   slot.html, i ŽIVE — ali HookBus walker ih je proglasio "❌ 0 emit-a".
 *   To je false-positive za "rupa".
 *
 *   Ovaj walker kombinuje TRI nezavisna izvora dokaza:
 *
 *     1. HookBus signal       — postojeći _block-coverage-walker.mjs JSON
 *     2. Rendered-HTML mount — `grep -c <block>` po svakom dist HTML-u
 *     3. Manifest declaration — `defaultOn` iz blocks/_manifest.json
 *
 *   Klasifikator (svaki blok dobija JEDNU klasu):
 *
 *     LIVE      — ≥ 1 mount ILI ≥ 1 emit ILI ≥ 1 listener  → blok JE u
 *                 production HTML, walker ne sme da prijavi rupu.
 *     DORMANT   — 0 traga + `defaultOn=false`              → blok je
 *                 conditional, nijedan testirani GDD ga nije triggerovao.
 *                 Nije rupa, samo rezerva za buduće GDD-ove.
 *     DEAD      — 0 traga + `defaultOn=true`              → STVARNA rupa.
 *                 Blok kaže "ja sam default-on" ali nije mount-an niti
 *                 emituje. Ovo je jedina kategorija koja zaslužuje fix.
 *
 * IZLAZ
 *   tools/_eyes/block-liveness/_liveness.json
 *   tools/_eyes/block-liveness/_liveness.md
 *
 * EXIT CODE
 *   0 — 0 DEAD blokova
 *   1 — ≥ 1 DEAD blok (treba fix)
 *
 * USAGE
 *   node tools/_block-liveness-walker.mjs
 *   node tools/_block-liveness-walker.mjs --refresh-coverage   # re-run base walker first
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT        = `${REPO}/tools/_eyes/block-liveness`;
const COVERAGE   = `${REPO}/tools/_eyes/block-coverage/_coverage.json`;
const MANIFEST   = `${REPO}/blocks/_manifest.json`;

mkdirSync(OUT, { recursive: true });

const refreshCoverage = process.argv.includes('--refresh-coverage');
if (refreshCoverage || !existsSync(COVERAGE)) {
  console.log('▸ Refreshing block-coverage walker (chromium headless, ~2 min)...');
  const r = spawnSync('node', [`${REPO}/tools/_block-coverage-walker.mjs`], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('block-coverage-walker.mjs failed — cannot continue.');
    process.exit(2);
  }
}

const coverage = JSON.parse(readFileSync(COVERAGE, 'utf-8'));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));

// ── 1. Build manifest lookup ────────────────────────────────────────────
const manifestByName = {};
for (const b of manifest.blocks) manifestByName[b.name] = b;

// ── 2. Collect rendered HTML fingerprints ──────────────────────────────
//    Smart sampling: 20 synthetic grid fixtures (cover every topology) +
//    5 main ground-truth slot.html. That's 25 files × ~700KB ≈ 18MB total,
//    which keeps the walker under 2s. Full --deep flag scans all 387.
const DEEP = process.argv.includes('--deep');
const FIVE_MAIN = [
  'cash-eruption-foundry-gdd',
  'gates-of-olympus-1000-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
];

const distHtmls = [];
const distRoot  = `${REPO}/dist`;
if (existsSync(distRoot)) {
  for (const f of readdirSync(distRoot)) {
    // synthetic fixtures (cover every topology — rect, cluster, hex, plinko, wheel, ...)
    if (f.endsWith('_playable.html')) {
      const p = join(distRoot, f);
      if (statSync(p).isFile()) distHtmls.push(p);
    }
    // top-level ground-truth standalone HTMLs (game-b, game-c, etc.)
    else if (DEEP && f.endsWith('.html') && f !== 'index.html') {
      const p = join(distRoot, f);
      if (statSync(p).isFile()) distHtmls.push(p);
    }
  }
}
const realGamesDir = `${REPO}/dist/real-games`;
if (existsSync(realGamesDir)) {
  for (const g of readdirSync(realGamesDir)) {
    if (!DEEP && !FIVE_MAIN.includes(g)) continue;
    const slot = join(realGamesDir, g, 'slot.html');
    if (existsSync(slot)) distHtmls.push(slot);
  }
}
if (DEEP) {
  const galleryDir = `${REPO}/dist/gallery`;
  if (existsSync(galleryDir)) {
    for (const f of readdirSync(galleryDir)) {
      if (f.endsWith('.html')) distHtmls.push(join(galleryDir, f));
    }
  }
}

if (distHtmls.length === 0) {
  console.error('▸ No dist HTML found. Run `npm run sandbox:build` or `npm run test:parse:real-pdfs` first.');
  process.exit(2);
}

console.log(`▸ Scanning ${distHtmls.length} rendered HTML files for mount fingerprints...`);

// Build fingerprint list per block.  We use 3 signal sources:
//   (a) literal block name              — works for ui blocks (paytable, ...)
//   (b) exported `emitXxxCSS`/`emitXxxRuntime` function names — these always
//       show up because buildSlotHTML.mjs inlines them in the rendered HTML
//   (c) a hand-picked alias for engines whose IIFE bakes only their kind id
//       (e.g. plinkoSpinEngine renders "plinko-ball", "__SLOT_KIND_RUNSPIN__.plinko",
//        wheelSpinEngine renders "wheel-spin-tick", "__SLOT_KIND_RUNSPIN__.wheel",
//        slingoSpinEngine renders "slingo-cell-clear" etc.)
const KIND_ALIASES = {
  plinkoSpinEngine: ['plinko-ball', '__SLOT_KIND_RUNSPIN__.plinko', 'plinko-track'],
  wheelSpinEngine:  ['wheel-spin-tick', '__SLOT_KIND_RUNSPIN__.wheel', 'wheel-arrow'],
  crashSpinEngine:  ['crash-line', '__SLOT_KIND_RUNSPIN__.crash', 'crash-rocket'],
  slingoSpinEngine: ['slingo-cell-clear', '__SLOT_KIND_RUNSPIN__.slingo'],
  hexReelEngine:    ['hex-reel', '__SLOT_KIND_RUNSPIN__.hex'],
  pyramidGridEngine:['pyramid-cell', '__SLOT_KIND_RUNSPIN__.pyramid'],
};

const fingerprintsByBlock = {};
for (const b of manifest.blocks) {
  const fps = new Set([b.name]);
  for (const ex of (b.exports || [])) {
    if (/^emit[A-Z]/.test(ex)) fps.add(ex);  // emitXxxCSS / emitXxxRuntime / emitXxxMarkup
  }
  for (const alias of (KIND_ALIASES[b.name] || [])) fps.add(alias);
  fingerprintsByBlock[b.name] = [...fps];
}

const mountCount = {};
for (const f of distHtmls) {
  let body;
  try { body = readFileSync(f, 'utf-8'); } catch { continue; }
  for (const b of manifest.blocks) {
    let count = 0;
    for (const fp of fingerprintsByBlock[b.name]) {
      let idx = 0;
      while ((idx = body.indexOf(fp, idx)) !== -1) { count++; idx += fp.length; }
    }
    if (count > 0) mountCount[b.name] = (mountCount[b.name] || 0) + count;
  }
}

// ── 3. Classify every block ─────────────────────────────────────────────
const classes = { LIVE: [], DORMANT: [], DEAD: [] };
const detail  = {};
for (const b of manifest.blocks) {
  const name      = b.name;
  const defaultOn = inferDefaultOn(b);
  const cov       = coverage.blockStatus?.[name] || {};
  const emits     = (cov.emitsObserved || []).length;
  const hooks     = (cov.hooksRegistered || []).length;
  const gdds      = (cov.gddsWhereSeen || []).length;
  const mounts    = mountCount[name] || 0;

  let klass;
  if (mounts > 0 || emits > 0 || hooks > 0 || gdds > 0) klass = 'LIVE';
  else if (defaultOn)                                   klass = 'DEAD';
  else                                                  klass = 'DORMANT';

  classes[klass].push(name);
  detail[name] = { klass, defaultOn, mounts, emits, hooks, gdds, category: b.category || cov.category || 'uncategorised' };
}

function inferDefaultOn(b) {
  // manifest stores defaultConfig snippet — look for `enabled: true` or no-`enabled` (which implies default on)
  // OR fall back to coverage walker's `defaultOn` flag (it inspects the resolved config).
  const cov = coverage.blockStatus?.[b.name];
  if (cov && typeof cov.defaultOn === 'boolean') return cov.defaultOn;
  const dc = (b.defaultConfig || '').toString();
  if (/enabled\s*:\s*false/.test(dc)) return false;
  if (/enabled\s*:\s*true/.test(dc))  return true;
  return false;
}

// ── 4. Write artifacts ─────────────────────────────────────────────────
const summary = {
  generatedAt: new Date().toISOString(),
  totalBlocks: manifest.blocks.length,
  scanned:     distHtmls.length,
  classes:     {
    LIVE:    classes.LIVE.length,
    DORMANT: classes.DORMANT.length,
    DEAD:    classes.DEAD.length,
  },
  dead: classes.DEAD,
  detail,
};

writeFileSync(`${OUT}/_liveness.json`, JSON.stringify(summary, null, 2));

const lines = [];
lines.push(`# Block liveness audit — ${summary.generatedAt}`);
lines.push('');
lines.push(`Scanned: ${distHtmls.length} rendered HTML files, ${manifest.blocks.length} blocks.`);
lines.push('');
lines.push(`| Class    | Count | Meaning |`);
lines.push(`|:---------|:-----:|:--------|`);
lines.push(`| LIVE     | ${classes.LIVE.length} | Mounted in HTML or active in HookBus walker |`);
lines.push(`| DORMANT  | ${classes.DORMANT.length} | \`defaultOn=false\` + no GDD triggered it — expected reserve |`);
lines.push(`| DEAD     | ${classes.DEAD.length} | \`defaultOn=true\` but 0 mounts + 0 emits + 0 hooks — **GENUINE HOLE** |`);
lines.push('');
if (classes.DEAD.length > 0) {
  lines.push(`## DEAD blocks (need fix)`);
  for (const n of classes.DEAD) lines.push(`- ${n}  (${detail[n].category})`);
  lines.push('');
}
lines.push(`## DORMANT blocks (rezerva, ne rupa)`);
for (const n of classes.DORMANT.slice(0, 50)) lines.push(`- ${n}  (${detail[n].category})`);
if (classes.DORMANT.length > 50) lines.push(`- ... +${classes.DORMANT.length - 50} more`);

writeFileSync(`${OUT}/_liveness.md`, lines.join('\n'));

// ── 5. Console summary ─────────────────────────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Block liveness audit — ${manifest.blocks.length} blocks × ${distHtmls.length} HTMLs`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  LIVE    : ${classes.LIVE.length}`);
console.log(`  DORMANT : ${classes.DORMANT.length}  (defaultOn=false, no GDD triggered)`);
console.log(`  DEAD    : ${classes.DEAD.length}  (defaultOn=true, ZERO trace → genuine hole)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (classes.DEAD.length > 0) {
  console.log('DEAD blocks:');
  for (const n of classes.DEAD) console.log('  - ' + n);
  process.exit(1);
}
console.log('✓ 0 DEAD blocks — full liveness ✅');
process.exit(0);
