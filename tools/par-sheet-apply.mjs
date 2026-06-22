#!/usr/bin/env node
/**
 * tools/par-sheet-apply.mjs
 *
 * MATH-PRECISION-4 — Apply ingested xlsx par sheet to model.json.
 *
 * Reads reports/par-sheet-ingested/<slug>.json (output of
 * par-sheet-xlsx-ingest.py) and writes to dist/real-games/<slug>/model.json:
 *   - model.reelStrips.par_sheet_weights[reel0..reel4] = {sym: weight, ...}
 *   - model.reelStrips.par_sheet_paytable[sym][matchCount] = pay × bet
 *   - model.reelStrips.par_sheet_source = xlsx path + SWID + sheet
 *
 * ORIGINAL stop_distribution + paytable.symbols NOT TOUCHED — par sheet
 * is additive overlay so probe / V14 can opt in.
 *
 * USAGE
 *   node tools/par-sheet-apply.mjs --slug cash-eruption-foundry-gdd
 *
 * EXIT
 *   0 — applied
 *   1 — model or ingested par sheet missing
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';

const MODEL_PATH  = join(REPO, `dist/real-games/${SLUG}/model.json`);
const INGEST_PATH = join(REPO, `reports/par-sheet-ingested/${SLUG}.json`);

if (!existsSync(MODEL_PATH)) {
  console.error(`▸ model missing: ${MODEL_PATH}`);
  process.exit(1);
}
if (!existsSync(INGEST_PATH)) {
  console.error(`▸ par sheet ingest missing: ${INGEST_PATH}`);
  console.error(`  run: python3 tools/par-sheet-xlsx-ingest.py --xlsx PATH --out ${INGEST_PATH}`);
  process.exit(1);
}

const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
const par   = JSON.parse(readFileSync(INGEST_PATH, 'utf8'));

if (!model.reelStrips || typeof model.reelStrips !== 'object') model.reelStrips = {};

model.reelStrips.par_sheet_weights = par.per_reel_weights;
model.reelStrips.par_sheet_totals  = par.per_reel_totals;
model.reelStrips.par_sheet_paytable = par.paytable;
model.reelStrips.par_sheet_symbols = par.symbols;
model.reelStrips.par_sheet_source = {
  xlsx: par.source,
  sheet: par.sheet,
  title: par.title,
  swid: par.swid,
  ingestedAt: new Date().toISOString(),
};

writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2));

console.log(`✓ Applied par sheet to ${SLUG}:`);
console.log(`  ${par.symbols.length} symbols × 5 reels weights`);
console.log(`  ${Object.keys(par.paytable).length} paytable symbol entries`);
console.log(`  SWID: ${par.swid}`);
console.log(`  Source: ${par.source}`);
console.log(`  Model: ${MODEL_PATH}`);
process.exit(0);
