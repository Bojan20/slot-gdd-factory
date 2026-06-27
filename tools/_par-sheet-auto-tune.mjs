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
/* PAR-14-I (Boki 2026-06-27): classifier ↔ auto-tune glue. detectMechanics()
 * is the canonical signal for which tuning axes apply per slug. Re-using it
 * here ensures auto-tune and classifier never drift apart. */
import { detectMechanics } from './_par-sheet-classifier-lib.mjs';

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
 *
 * PAR-14-I refactor: this function NOW reads `detectMechanics()` from the
 * shared classifier-lib instead of duplicating regex checks. The
 * mechanics flags become the authoritative source for axis activation —
 * if classifier says `coin_boost.detected = true`, auto-tune flips the
 * matching tuning axis ON. Any drift between classifier-vs-auto-tune is
 * impossible by construction.
 *
 * @param {object} model  par-sheet ingested model.json
 * @returns {object}      tuning axes config skeleton (sweep refines)
 */
function detectTuningAxes(model) {
  const slug = (model.slug || model.id || '').toLowerCase();
  const mechanics = detectMechanics(model);
  const components = model.payback?.components || {};

  return {
    slug,
    /* Each axis carries:
     *   - enabled: classifier mechanic detection
     *   - <param>: tuning knobs (initial baseline; sweep refines) */
    hnw: {
      enabled: mechanics.hold_and_win.detected,
      orb_land_chance_base: 0.045,
      orb_land_chance_fill_bonus: 0.13,
      orb_value_bump: 1.0,
      /* Forward auxiliary detection signals so sweep can reason about
       * orb table presence without re-deriving them. */
      orb_table_extracted: mechanics.hold_and_win.orb_table_extracted,
      orb_tier_count: mechanics.hold_and_win.orb_tier_count,
    },
    fs: {
      enabled: mechanics.free_spins.detected,
      bucket: detectFsBucket(components.freeSpins),
      scatter_pays_bump: 1.0,
      explicit_awards: mechanics.free_spins.explicit_awards,
    },
    bonus_buy: {
      enabled: mechanics.bonus_buy.detected,
      scaling: 0.22,
    },
    wild_expand: {
      enabled: mechanics.wild_expand.detected,
      factor: 1.0,
    },
    coin_boost: {
      enabled: mechanics.coin_boost.detected,
      /* When detected, multipliers come directly from the par-sheet
       * extraction (`ENHANCED_CE_0` table); auto-tune knob only governs
       * downstream density / carrier coverage. */
      multipliers: mechanics.coin_boost.multipliers,
      density_target_pct: 0.667,
    },
    special_reel_set: {
      enabled: mechanics.special_reel_set.detected,
      set_count: mechanics.special_reel_set.set_count,
    },
    surgical_deltas: {
      /* Per-reel ±N adjustments on Wild/Bonus weights.
       * Empty by default; sweep adds entries as needed. */
      wild_per_reel: {},
      bonus_per_reel: {},
    },
    mystery_remap: {
      /* Mystery → Wild remap stays scoped to slugs with Mystery cash
       * specials AND a "spreading wild" game design (currently only
       * Skel Key). The mechanic flag from classifier carries the
       * structural detection; the slug gate keeps the remap path
       * Skel-Key-only. */
      enabled: mechanics.mystery_reveal.detected
        && /skeleton/i.test(slug),
      pattern: /skeleton/i.test(slug) ? '/mystery|reveal|^key$/i' : '/mystery|reveal/i',
    },
  };
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
 *
 * PAR-14-I (Boki 2026-06-27): cache merge strategy is now classifier-
 * FIRST. Always re-derive axes from the model via `detectTuningAxes`
 * so new mechanics (e.g. coin_boost, special_reel_set) get added when
 * the schema evolves. THEN overlay any cached per-axis manual overrides
 * (preserving sweep-found scaling values from prior runs).
 *
 * Semantics:
 *   - Fresh derive gives every NEW axis that exists in the latest
 *     mechanic detector.
 *   - Cached values overlay matching axes' tuning knobs (factor,
 *     scaling, bucket, etc.) BUT the `enabled` flag always reflects the
 *     latest classifier output. Slug that lost a feature won't keep an
 *     orphan enabled axis around.
 */
function loadOrInitTune(slugDir, model) {
  const tunePath = join(slugDir, 'auto-tune.json');
  const fresh = detectTuningAxes(model);
  if (existsSync(tunePath)) {
    try {
      const cached = JSON.parse(readFileSync(tunePath, 'utf-8'));
      /* Deep merge: for each axis present in fresh, overlay cached
       * tunable values (everything except `enabled`). */
      const merged = { slug: fresh.slug };
      for (const [axisName, freshAxis] of Object.entries(fresh)) {
        if (axisName === 'slug') continue;
        if (typeof freshAxis !== 'object' || freshAxis === null) {
          merged[axisName] = freshAxis;
          continue;
        }
        const cachedAxis = (cached && typeof cached[axisName] === 'object')
          ? cached[axisName] : {};
        merged[axisName] = { ...freshAxis };
        for (const [k, v] of Object.entries(cachedAxis)) {
          /* Skip `enabled` — classifier owns activation, not cache. */
          if (k === 'enabled') continue;
          /* Carry over tuning knob if it exists on fresh axis. */
          if (k in freshAxis) merged[axisName][k] = v;
        }
      }
      return { tune: merged, fromCache: true, tunePath };
    } catch (e) {
      console.warn(`▸ ${slugDir}: existing auto-tune.json corrupt, regenerating`);
    }
  }
  return { tune: fresh, fromCache: false, tunePath };
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
