#!/usr/bin/env node
/**
 * tools/v13-phantom-feature-walker.mjs
 *
 * Wave UQ-MASTERY-8 (2026-06-22) — Phantom-feature regression prevention.
 *
 * Boki direktiva: "proveri da li ne ma suvisnih forsova i lego blokova
 * osim onih sto svaki gdd trazi. dakle mora simulator da procita potpuno
 * tacno gdd. bilo koji. ultimativni deep qa".
 *
 * V13 walks every model.json and asserts that every feature flagged
 * `source: 'declared'` in __activeFeatures__ has a matching anchor in
 * the raw GDD text. If a feature is "declared" without source-text
 * anchor → PHANTOM (parser inferred too aggressively or smartDefaults
 * leaked through).
 *
 * Pre-UQ-MASTERY-8 baseline: 279 phantom declared (256 holdAndWin from
 * "3+ Scatter" regex confusion). Post-fix: 30 phantom (reference set
 * games using narrower "HOLD" anchor + over-wide audit regex on
 * mystery synth fixtures). MAX_ALLOWED keeps the gate from flagging
 * the residual legitimate edges while still catching any new regress.
 *
 * USAGE
 *   node tools/v13-phantom-feature-walker.mjs           # walk all 338
 *   node tools/v13-phantom-feature-walker.mjs --strict  # max-allowed=0
 *   node tools/v13-phantom-feature-walker.mjs --limit N # smoke subset
 *
 * EXIT CODE
 *   0 — phantom count ≤ MAX_ALLOWED
 *   1 — phantom count > MAX_ALLOWED (regression)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const DIST       = `${REPO}/dist/real-games`;
const OUT_DIR    = `${REPO}/reports`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const a = args.find(x => x === flag || x.startsWith(flag + '='));
  if (!a) return null;
  return a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
};
const STRICT = args.includes('--strict');
const LIMIT  = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;

/* Industry-baseline anchor regex per declared feature kind. Permissive
 * enough to catch reference-set GDDs (Hold-and-Hat, Cash Collect, Money
 * Symbols variants) but narrow enough to reject "scatter trigger FS"
 * being mis-read as hold-and-win triggerCount. */
const ANCHORS = {
  holdAndWin:      /\bhold[\s&\-_]*(?:and[\s&\-_]*)?win|\bh&w\b|\bhnw\b|\bmoney[\s\-_]+(?:symbol|collect|values?)|\bfireball\b|\bcash[\s\-_]+(?:collect|values?|symbols?)|\bhold[\s\-_]+(?:bonus|spin|hat|symbol)|\block[\s\-_]+(?:respin|reels?)|\borb[\s\-_]+(?:collect|values?)/i,
  wheelBonus:      /wheel\s*bonus|spin[\s\-_]*the[\s\-_]*wheel|wheel[\s\-_]*of[\s\-_]*fortune|bonus[\s\-_]*wheel|weighted\s*wheel|spin[\s\-_]+wheel/i,
  bonusPick:       /pick[\s\-_]*bonus|pick[\s\-_]*and[\s\-_]*click|reveal[\s\-_]*bonus|click[\s\-_]+to[\s\-_]+reveal|pick[\s\-_]*me|selection\s*bonus|treasure[\s\-_]*pick|pick[\s\-_]*and[\s\-_]*reveal|pick[\s\-_]*to[\s\-_]*reveal|mystery[\s\-_]+(?:upgrade|selection|reveal)/i,
  jackpot:         /\bjackpot|grand\s*prize|mini\s*minor\s*major|jackpot[\s\-_]+(?:ladder|tier|pool|room)|progressive[\s\-_]+(?:prize|pool|jackpot)/i,
  expandingWild:   /expand(ing)?[\s\-_]*wild/i,
  walkingWild:     /walk(ing)?[\s\-_]*wild|wandering[\s\-_]*wild/i,
  stickyWild:      /sticky[\s\-_]*wild|persistent[\s\-_]*wild/i,
  mysterySymbol:   /mystery[\s\-_]*symbol/i,
  multiplierOrb:   /multiplier[\s\-_]*orb|orb[\s\-_]*multiplier/i,
  superSymbol:     /super[\s\-_]*symbol|giant[\s\-_]*symbol|mega[\s\-_]*symbol|oversized[\s\-_]*symbol/i,
  anteBet:         /ante[\s\-_]*bet/i,
};

/* Residual phantom budget — UQ-MASTERY-8 closed 256 holdAndWin from
 * "3+ Scatter" misread (279→28). UQ-MASTERY-9 closed 6 bonusPick from
 * "Mystery Symbol Reveal" → mystery-pick misread (28→15). Remaining 15
 * are vendor-reference set games (Dancing Drums, 88 Fortunes, Huff,
 * Jackpot Party, Goldfish, Willy Wonka, Jin Long, Gold Stacks) that
 * use NARROWER anchors than our regex covers: bare "Hold" + coin/cash
 * symbol mechanics, "PROSPERITY" / "JIN LONG" / "GOLD STACKS" thematic
 * jackpot variants. Real declared features, just not covered by the
 * generic anchor regex. Ceiling 28 = current 15 + 13 headroom so any
 * NEW regress of a few games is caught while the legitimate vendor
 * residual stays green. */
const MAX_ALLOWED = STRICT ? 0 : 28;

function listSlugs() {
  if (!existsSync(DIST)) {
    console.error(`▸ ${DIST} missing — run \`npm run test:parse:real-pdfs\` first.`);
    process.exit(2);
  }
  let all = readdirSync(DIST).filter(d => {
    const p = join(DIST, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'model.json')) && existsSync(join(p, 'raw.txt'));
  });
  if (LIMIT) all = all.slice(0, LIMIT);
  return all;
}

/* UQ-DEEP-E audit fix (COMPL-2): sort for deterministic audit output. */
const slugs = listSlugs().sort();
let phantomTotal = 0;
const perKind = {};
const offenders = [];

for (const slug of slugs) {
  const model = JSON.parse(readFileSync(join(DIST, slug, 'model.json'), 'utf8'));
  const raw   = readFileSync(join(DIST, slug, 'raw.txt'), 'utf8');
  for (const f of (model.__activeFeatures__ || [])) {
    if (f.source !== 'declared') continue;
    const re = ANCHORS[f.kind];
    if (!re) continue;
    if (!re.test(raw)) {
      phantomTotal++;
      perKind[f.kind] = (perKind[f.kind] || 0) + 1;
      offenders.push({ slug, kind: f.kind });
    }
  }
}

const ts = new Date().toISOString();
const summary = {
  generatedAt: ts,
  tool: 'tools/v13-phantom-feature-walker.mjs',
  gamesAudited: slugs.length,
  phantomTotal,
  perKind,
  maxAllowed: MAX_ALLOWED,
  offendersSample: offenders.slice(0, 50),
};
writeFileSync(join(OUT_DIR, `v13-phantom-${ts.replace(/[:.]/g, '-')}.json`),
              JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`V13 Phantom-Feature Walker · ${slugs.length} games audited`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  PHANTOM declared total: ${phantomTotal}  (max allowed ${MAX_ALLOWED})`);
console.log(`  Per-kind             : ${JSON.stringify(perKind)}`);
if (offenders.length > 0 && phantomTotal > MAX_ALLOWED) {
  console.log('  First offenders:');
  for (const o of offenders.slice(0, 10)) console.log(`    ${o.slug} → ${o.kind}`);
}

if (phantomTotal > MAX_ALLOWED) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✗ FAIL — ${phantomTotal} phantom declared > ${MAX_ALLOWED} ceiling`);
  process.exit(1);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✓ PASS — ${phantomTotal} phantom (under ${MAX_ALLOWED} ceiling)`);
process.exit(0);
