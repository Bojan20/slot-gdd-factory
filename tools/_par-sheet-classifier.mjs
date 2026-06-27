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

/**
 * Classify each special symbol — promote based on name + paytable
 * membership + reel weight density.
 */
function classifySpecials(model) {
  const specials = model.symbols?.specials || [];
  const paytableIds = new Set((model.paytable || []).map((r) => r.symbolId));
  const reelWeights = model.par_sheet?.reelStrips || [];
  const totalPerReel = reelWeights.map((reel) =>
    reel.reduce((s, e) => s + (e.weight || 0), 0));

  return specials.map((s) => {
    const weightPerReel = reelWeights.map((reel) => {
      const e = reel.find((x) => String(x.symbol || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) === s.id);
      return e?.weight || 0;
    });
    const totalWeight = weightPerReel.reduce((a, b) => a + b, 0);
    const avgDensity = totalPerReel.length > 0
      ? weightPerReel.map((w, i) => totalPerReel[i] > 0 ? w / totalPerReel[i] : 0)
        .reduce((a, b) => a + b, 0) / totalPerReel.length
      : 0;
    const inPaytable = paytableIds.has(s.id);
    const name = String(s.label || s.id || '').toLowerCase();

    /* Derived effective role for sister kernel consumption. */
    let effective = s.role;
    const rationale = [];

    if (/wild/.test(name)) {
      effective = 'wild';
      rationale.push('name matches /wild/');
    } else if (/scatter|book/.test(name) && !inPaytable) {
      effective = 'scatter';
      rationale.push('name matches /scatter|book/ + no paytable');
    } else if (/bonus/.test(name) && !inPaytable) {
      effective = 'bonus';
      rationale.push('name matches /bonus/ + no paytable');
    } else if (!inPaytable) {
      if (avgDensity >= 0.05) {
        effective = 'cash';
        rationale.push(`no paytable + density ${(avgDensity * 100).toFixed(1)}% (frequent → HnW trigger candidate)`);
      } else {
        effective = 'anchor';
        rationale.push(`no paytable + density ${(avgDensity * 100).toFixed(1)}% (rare → pattern anchor)`);
      }
    } else {
      effective = 'lp';
      rationale.push('paytable entry present (regular paying)');
    }

    return {
      id: s.id,
      label: s.label,
      declared_role: s.role,
      effective_role: effective,
      in_paytable: inPaytable,
      total_weight: totalWeight,
      avg_density_pct: Math.round(avgDensity * 10000) / 100,
      rationale: rationale.join('; '),
    };
  });
}

/**
 * Detect feature mechanics from model + slug name patterns.
 */
function detectMechanics(model) {
  const slug = (model.slug || model.id || '').toLowerCase();
  const components = model.payback?.components || {};
  const par_sheet = model.par_sheet || {};
  const specials = model.symbols?.specials || [];

  const mechanics = {
    free_spins: {
      detected: Number.isFinite(components.freeSpins) && components.freeSpins >= 1.0,
      declared_rtp_pct: components.freeSpins ?? null,
      explicit_awards: !!par_sheet.freeSpinAwards,
      awards_table: par_sheet.freeSpinAwards ?? null,
      scatter_pays_extracted: !!par_sheet.freeSpinAvgPays,
    },
    hold_and_win: {
      detected: Number.isFinite(components.holdAndWin) && components.holdAndWin >= 1.0,
      declared_rtp_pct: components.holdAndWin ?? null,
      orb_table_extracted: !!par_sheet.hnwOrbValues,
      orb_tier_count: par_sheet.hnwOrbValues?.length ?? 0,
    },
    bonus_buy: {
      detected: /bonus[\s_-]?buy/i.test(slug),
      slug_match: /bonus[\s_-]?buy/i.test(slug) ? slug : null,
      declared_bonus_rtp_pct: components.bonus ?? null,
    },
    wild_expand: {
      /* Heuristic: slug contains "fortune coin", "lightning", or has Wild
       * specials but no separate Wild Expand explicit hook. */
      detected: /skeleton|fortune.?coin/i.test(slug)
        && specials.some((s) => s.role === 'wild'),
      slug_match: slug,
    },
    mystery_reveal: {
      detected: specials.some((s) => /mystery|reveal/i.test(s.label || '')),
      symbols: specials.filter((s) => /mystery|reveal/i.test(s.label || '')).map((s) => s.id),
    },
    coin_boost: {
      detected: /coin.?boost/i.test(slug),
      slug_match: slug,
    },
    special_reel_set: {
      /* Heuristic: slug is skeleton-key (well-known) or par sheet has
       * a "Special Reel Sets" table. */
      detected: /skeleton/i.test(slug),
      slug_match: slug,
    },
  };

  return mechanics;
}

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
