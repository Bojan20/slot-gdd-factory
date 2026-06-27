#!/usr/bin/env node
/**
 * tools/_par-sheet-classifier.mjs
 *
 * PAR-14-C (Boki 2026-06-27) — Classifier alat. Za bilo koji par sheet
 * (model.json), output je:
 *
 *   1. specials klasifikacija — {wild, scatter, bonus, cash, anchor}
 *      role per specials simbol, sa rationale
 *   2. mechanics detection — flags za:
 *        - Mystery reveal
 *        - Wild Expand
 *        - Coin Boost
 *        - Bonus Buy
 *        - Hold & Win
 *        - Free Spins (with awards table)
 *        - Special Reel Set
 *
 * Used by:
 *   - PAR-14-B auto-tune (axis activation)
 *   - audit reports (human-readable feature inventory)
 *   - downstream sister-side feature gate
 *
 * # USAGE
 *
 *   node tools/_par-sheet-classifier.mjs --slug skeleton-key
 *   node tools/_par-sheet-classifier.mjs --all
 *   node tools/_par-sheet-classifier.mjs --slug fortune-coin-boost-classic --json
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
/* PAR-14-I (Boki 2026-06-27): classifier detection logic lives in the
 * shared lib so auto-tune + orchestrator import the exact same
 * functions — no duplicated regex / drift risk. */
import { classifySpecials, detectMechanics } from './_par-sheet-classifier-lib.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAR_MODELS_DIR = join(REPO, 'dist', 'par-sheet-real-games');

function parseArgs(args) {
  const out = { slug: null, all: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') out.slug = args[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
  }
  return out;
}

/* PAR-14-I: classifySpecials() and detectMechanics() live in
 * `_par-sheet-classifier-lib.mjs`. Imported at top. Shared by:
 *   - this CLI (renders human + JSON)
 *   - tools/_par-sheet-auto-tune.mjs (axis gating)
 *   - tools/par-sheet-pipeline.mjs (orchestrator) */

function classifyOne(slug) {
  const slugDir = join(PAR_MODELS_DIR, slug);
  const modelPath = join(slugDir, 'model.json');
  if (!existsSync(modelPath)) {
    return null;
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf-8'));
  return {
    slug,
    specials: classifySpecials(model),
    mechanics: detectMechanics(model),
  };
}

function renderHuman(result) {
  console.log(`\n=== ${result.slug} ===`);
  console.log(`\nSpecials:`);
  for (const s of result.specials) {
    console.log(`  ${s.label.padEnd(15)}  role: ${s.declared_role.padEnd(8)} → effective: ${s.effective_role.padEnd(8)}  density: ${s.avg_density_pct.toFixed(2)}%`);
    console.log(`    rationale: ${s.rationale}`);
  }
  console.log(`\nMechanics:`);
  for (const [key, m] of Object.entries(result.mechanics)) {
    const flag = m.detected ? '✓ DETECTED' : '·  off    ';
    let extra = '';
    if (m.declared_rtp_pct) extra = ` (declared ${m.declared_rtp_pct.toFixed(2)}%)`;
    if (m.orb_tier_count) extra += ` (${m.orb_tier_count} orb tiers)`;
    if (m.awards_table) extra += ` (awards ${JSON.stringify(m.awards_table)})`;
    if (m.symbols?.length) extra += ` (${m.symbols.join(', ')})`;
    console.log(`  ${flag}  ${key}${extra}`);
  }
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const targets = [];
  if (args.all) {
    for (const slug of readdirSync(PAR_MODELS_DIR)) {
      if (existsSync(join(PAR_MODELS_DIR, slug, 'model.json'))) targets.push(slug);
    }
  } else if (args.slug) {
    targets.push(args.slug);
  } else {
    console.error('USAGE: --slug <name>  OR  --all');
    process.exit(2);
  }

  const results = [];
  for (const slug of targets) {
    const r = classifyOne(slug);
    if (r) results.push(r);
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) renderHuman(r);
  }
}

const __isCliEntry = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (__isCliEntry) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(2);
  });
}
