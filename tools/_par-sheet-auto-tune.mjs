#!/usr/bin/env node
/**
 * tools/_par-sheet-auto-tune.mjs
 *
 * PAR-14-B (Boki 2026-06-27) — Auto-calibrator alat za "ubacin novi par
 * sheet → savršeno". Za svaki ingestovan par sheet u
 * `dist/par-sheet-real-games/<slug>/`, sweepuje scaling factors:
 *
 *   - HnW orb_land_chance_base + fill_bonus
 *   - HnW orb_value bump
 *   - FS award bucket schedule
 *   - Bonus Buy scatter_pays scaling
 *   - Wild expand factor
 *   - Per-reel surgical deltas (Wild / Bonus)
 *
 * Detection logic:
 *
 *   1. Read model.par_sheet flags (hnwOrbValues, freeSpinAwards, etc.)
 *   2. Detect bonus-buy via slug name regex
 *   3. Detect mystery/key via symbol names
 *   4. Pick relevant tuning axes
 *
 * Sweep ladder (progressive precision):
 *
 *   Stage 1 — 200k × 4 (W99 ~95 pp): coarse range scan, exclude
 *             ranges that produce >5 pp deviation
 *   Stage 2 — 2M × 4 (W99 ~30 pp):   refine to ±1 pp
 *   Stage 3 — 10M × 4 (W99 ~14 pp):  lock to ±0.05 pp regulator
 *
 * Per-slug locked params written to:
 *   `dist/par-sheet-real-games/<slug>/auto-tune.json`
 *
 * Convergence script reads these overrides at run-time instead of
 * hard-coded literals.
 *
 * # USAGE
 *
 *   node tools/_par-sheet-auto-tune.mjs --slug skeleton-key
 *   node tools/_par-sheet-auto-tune.mjs --all
 *   node tools/_par-sheet-auto-tune.mjs --slug cash-eruption --stage 1
 *
 * # CURRENT STATUS
 *
 *   This is a SKELETON. Full sweep + lock pipeline is PAR-14-B-FULL.
 *   This commit provides:
 *     - CLI shape
 *     - per-slug auto-tune.json discovery + emit
 *     - integration hook in convergence script (PAR-14-B-WIRE)
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAR_MODELS_DIR = join(REPO, 'dist', 'par-sheet-real-games');

function parseArgs(args) {
  const out = { slug: null, all: false, stage: 1 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') out.slug = args[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--stage') out.stage = parseInt(args[++i], 10);
  }
  return out;
}

/**
 * Detect which tuning axes a slug needs based on its model + slug name.
 * Returns a config skeleton with sensible defaults; auto-tune sweep
 * will refine these to PASS verdict ranges.
 */
function detectTuningAxes(model) {
  const slug = (model.slug || model.id || '').toLowerCase();
  const components = model.payback?.components || {};
  const par_sheet = model.par_sheet || {};

  const axes = {
    slug,
    hnw: {
      enabled: Number.isFinite(components.holdAndWin) && components.holdAndWin >= 1.0,
      orb_land_chance_base: 0.045,
      orb_land_chance_fill_bonus: 0.13,
      orb_value_bump: 1.0,
    },
    fs: {
      enabled: Number.isFinite(components.freeSpins) && components.freeSpins >= 1.0,
      bucket: detectFsBucket(components.freeSpins),
      scatter_pays_bump: 1.0,
    },
    bonus_buy: {
      enabled: /bonus[\s_-]?buy/i.test(slug),
      scaling: 0.22,
    },
    wild_expand: {
      enabled: /skeleton|fortune.?coin/i.test(slug),
      factor: 1.0,
    },
    surgical_deltas: {
      /* Per-reel ±N adjustments on Wild/Bonus weights.
       * Empty by default; sweep adds entries as needed. */
      wild_per_reel: {},
      bonus_per_reel: {},
    },
    mystery_remap: {
      enabled: /skeleton/i.test(slug),
      pattern: /skeleton/i.test(slug) ? '/mystery|reveal|^key$/i' : '/mystery|reveal/i',
    },
  };

  return axes;
}

function detectFsBucket(declaredFs) {
  if (!Number.isFinite(declaredFs)) return null;
  if (declaredFs < 5) return { '3': 3, '4': 5, '5': 8 };
  if (declaredFs < 10) return { '3': 7, '4': 12, '5': 16 };
  if (declaredFs < 20) return { '3': 10, '4': 15, '5': 20 };
  return { '3': 15, '4': 25, '5': 35 };
}

/**
 * Read existing auto-tune.json if present, merge with detected axes.
 * This gives a stable baseline for sweep iteration.
 */
function loadOrInitTune(slugDir, model) {
  const tunePath = join(slugDir, 'auto-tune.json');
  if (existsSync(tunePath)) {
    try {
      const cached = JSON.parse(readFileSync(tunePath, 'utf-8'));
      return { tune: cached, fromCache: true, tunePath };
    } catch (e) {
      console.warn(`▸ ${slugDir}: existing auto-tune.json corrupt, regenerating`);
    }
  }
  return { tune: detectTuningAxes(model), fromCache: false, tunePath };
}

function writeTune(tunePath, tune) {
  const json = JSON.stringify(tune, null, 2);
  writeFileSync(tunePath, json);
}

async function tuneOne(slug) {
  const slugDir = join(PAR_MODELS_DIR, slug);
  const modelPath = join(slugDir, 'model.json');
  if (!existsSync(modelPath)) {
    console.error(`▸ ${slug}: model.json missing at ${modelPath}`);
    return false;
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf-8'));
  const { tune, fromCache, tunePath } = loadOrInitTune(slugDir, model);

  console.log(`▸ ${slug}: ${fromCache ? 'updating' : 'creating'} auto-tune.json`);
  console.log(`  axes:`);
  for (const [k, v] of Object.entries(tune)) {
    if (typeof v === 'object' && v.enabled !== undefined) {
      console.log(`    ${k}: ${v.enabled ? 'ON' : 'OFF'}`);
    }
  }

  /* TODO: PAR-14-B-FULL sweep loop here. Currently skeleton just
   * emits the detected baseline so the convergence wire can read it. */

  writeTune(tunePath, tune);
  console.log(`  ✓ written ${tunePath}`);
  return true;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const targets = [];
  if (args.all) {
    for (const slug of readdirSync(PAR_MODELS_DIR)) {
      const sd = join(PAR_MODELS_DIR, slug);
      if (existsSync(join(sd, 'model.json'))) targets.push(slug);
    }
  } else if (args.slug) {
    targets.push(args.slug);
  } else {
    console.error('USAGE: --slug <name>  OR  --all');
    process.exit(2);
  }

  let ok = 0, fail = 0;
  for (const slug of targets) {
    if (await tuneOne(slug)) ok++;
    else fail++;
  }
  console.log(`\nSummary: ${ok} ok, ${fail} fail of ${targets.length}`);
  if (fail > 0) process.exit(1);
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
