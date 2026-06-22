#!/usr/bin/env node
/**
 * tools/cortex-gdd-feature-integrity.mjs
 *
 * GDD ↔ SLOT FEATURE INTEGRITY VERIFIKAT
 *
 * Boki pravilo (2026-06-17 18:30):
 *   "Svaki force/feature/blok u slot-u koji se napravi MORA biti u GDD-u.
 *    Ne sme biti nicim sto nije u GDD-u (no extra), niti nedostatak
 *    necega sto je u GDD-u (no missing). 1:1 mapping."
 *
 * Algorithm per GDD:
 *   1. parseGDD(md)    → model.features[] (declared kinds)
 *   2. buildSlotHTML() → rendered HTML
 *   3. Extract force chips from HTML: `.ufp-chip[data-kind="X"]`
 *   4. Compute:
 *      • EXTRA   = chip kinds in HTML but NOT in declared features
 *      • MISSING = declared kinds with NO corresponding chip
 *   5. PASS if both sets are empty.
 *
 * Output:
 *   • Per-GDD verdict to stdout
 *   • Aggregate matrix at end
 *   • Exit 0 = all PASS, 1 = violations found
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname, basename } from 'node:path';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

/* Auto-injected kinds that EXIST in HTML even if GDD doesn't declare them
 * (universal big_win banner, dev tools). These are exempt from violation. */
const AUTO_INJECTED_KINDS = new Set(['big_win']);

/* Kinds that have a DEDICATED block (NOT through universalForcePanel) — they
 * legitimately don't appear as ufp-chip but DO render their own DOM markup. */
const DEDICATED_BLOCK_KINDS = new Map([
  ['bonus_buy',          { selector: 'id="bonusBuyBtn"' }],
  ['ante_bet',           { selector: 'id="anteBetToggle"' }],
  ['autoplay',           { selector: 'id="autoplayBackdrop"' }],
  ['reality_check',      { selector: 'id="rcOverlay"' }],
  ['net_loss_indicator', { selector: 'NLI_STATE' }],
  ['win_cap',            { selector: 'id="winCapOverlay"' }],
  ['gamble_secondary',      { selector: 'id="gsOverlay"' }],
  ['progressive_free_spins',{ selector: 'id="pfsChip"' }],
  ['path_aware_multiplier', { selector: 'window.PAW_STATE' }],
]);

/* Synthetic / parser-internal kinds — NOT real features. Filter out. */
const SYNTHETIC_KINDS = new Set(['feature_generic']);

/* Wave UQ-INTEGRITY (2026-06-21) — evaluator mechanics that the
 * universalForcePanel deliberately excludes (NON_FORCEABLE_MECHANIC_KINDS).
 * A win evaluator is core math, not a force-able feature — UFP renders no
 * chip for these by design. Probe must not flag them as "MISSING" or the
 * 1:1 invariant fires on every cluster/cascade/ways game. */
const NON_FORCEABLE_EVALUATORS = new Set([
  'cascade', 'cluster_pays', 'pay_anywhere', 'scatter_pay', 'ways',
]);

/* Lightning is declared by parser as a single kind, but UFP expands it into
 * per-tier chips at render time (lightning_x2, _x3, _x5, _x10). Map a tier
 * chip to its parent kind so the "declared lightning" satisfies any of the
 * tier chips, and tier chips don't count as EXTRA. */
const TIER_CHIP_PARENT = new Map([
  ['lightning_x2',  'lightning'],
  ['lightning_x3',  'lightning'],
  ['lightning_x5',  'lightning'],
  ['lightning_x10', 'lightning'],
]);

/* Top-level model config objects that imply a feature even when the parser
 * didn't push the matching kind into model.features[]. Wave UQ parser change
 * (2026-06-21, "dalje i dublje do kraja") promotes more keys to 'declared',
 * but model.features[] is still the canonical kind list. Treat declared
 * status in __activeFeatures__ as equivalent to a features[] entry so the
 * probe sees the same picture the UFP chip renderer does. Names mirror
 * parser model keys (camelCase) and map to chip kinds (snake_case). */
const FEATURE_CONFIG_KEYS = new Map([
  ['freeSpins',          'free_spins'],
  ['holdAndWin',         'hold_and_win'],
  ['multiplierOrb',      'multiplier_orb'],
  ['respin',             'respin'],
  ['stickyWild',         'sticky_wild'],
  ['superSymbol',        'super_symbol'],
  ['expandingWild',      'expanding_wild'],
  ['walkingWild',        'walking_wild'],
  ['wildReel',           'wild_reel'],
  ['mysterySymbol',      'mystery_symbol'],
  ['bonusBuy',           'bonus_buy'],
  ['anteBet',            'ante_bet'],
  ['gamble',             'gamble'],
  ['lightning',          'lightning'],
  ['wheelBonus',         'wheel_bonus'],
  ['progressiveFreeSpins','progressive_free_spins'],
  ['cascadingWildPersistence','cascading_wild_persistence'],
  ['bonusPick',          'bonus_pick'],
  ['cascade',            'cascade'],
  ['cluster',            'cluster_pays'],
  ['clusterPays',        'cluster_pays'],
  ['ways',               'ways'],
  ['scatterCelebration', 'scatter_pay'],
]);

async function collectFixtures() {
  const out = [];
  const mainDir = resolvePath(REPO_ROOT, 'samples');
  const gridDir = resolvePath(REPO_ROOT, 'samples/grids');
  for (const f of (await readdir(mainDir)).filter(f => f.endsWith('.md'))) {
    out.push({ id: f.replace(/\.md$/, ''), path: resolvePath(mainDir, f), group: 'main' });
  }
  for (const f of (await readdir(gridDir)).filter(f => f.endsWith('.md'))) {
    out.push({ id: f.replace(/\.md$/, ''), path: resolvePath(gridDir, f), group: 'grid' });
  }
  return out;
}

function extractChipKinds(html) {
  const kinds = new Set();
  /* Universal Force Panel uses data-ufp-kind on each chip. */
  const re = /data-ufp-kind=['"]([\w]+)['"]/g;
  let m;
  while ((m = re.exec(html)) !== null) kinds.add(m[1]);
  return kinds;
}

function declaredKinds(model) {
  const set = new Set();
  if (Array.isArray(model.features)) {
    for (const f of model.features) {
      if (f && typeof f.kind === 'string') set.add(f.kind);
    }
  }
  /* Wave UQ-INTEGRITY — read model.__activeFeatures__ (parser-canonical
   * declared list) and map its camelCase kinds to the snake_case chip kinds
   * that universalForcePanel emits. Parser may extract feature data even
   * when the matching features[] entry was never pushed (smart-defaults +
   * promotion logic). __activeFeatures__ is the single source of truth for
   * "what the parser declared after reading the GDD". */
  if (Array.isArray(model.__activeFeatures__)) {
    for (const af of model.__activeFeatures__) {
      if (!af || af.source !== 'declared') continue;
      const chipKind = FEATURE_CONFIG_KEYS.get(af.kind);
      if (chipKind) set.add(chipKind);
    }
  }
  /* Fallback — top-level feature config objects with .enabled=true also
   * count as declared (older parser output shape). */
  for (const [modelKey, kind] of FEATURE_CONFIG_KEYS) {
    const cfg = model[modelKey];
    if (cfg && typeof cfg === 'object' && cfg.enabled === true) set.add(kind);
  }
  return set;
}

async function auditOne(fixture) {
  const md = await readFile(fixture.path, 'utf8');
  let model, html;
  try { model = parseGDD(md); } catch (e) { return { id: fixture.id, group: fixture.group, error: `parse: ${e.message}` }; }
  try { html = buildSlotHTML(model); } catch (e) { return { id: fixture.id, group: fixture.group, error: `build: ${e.message}` }; }

  const declared = declaredKinds(model);
  const chipped = extractChipKinds(html);

  /* Wave UQ-INTEGRITY — collapse tier chips to their parent kind so the
   * "declared lightning" check sees lightning_x2/3/5/10 chips as one
   * satisfaction. Keep original tier chip set for diagnostics. */
  const chippedNormalised = new Set();
  for (const c of chipped) {
    chippedNormalised.add(TIER_CHIP_PARENT.get(c) || c);
  }

  /* For each "missing" candidate, check if it has a dedicated block
   * rendering its own DOM marker. If yes → satisfied (not really missing). */
  const trulyMissing = [];
  for (const k of declared) {
    if (chippedNormalised.has(k)) continue;
    if (SYNTHETIC_KINDS.has(k)) continue;        /* skip parser-internal */
    if (NON_FORCEABLE_EVALUATORS.has(k)) continue; /* evaluators have no chip by design */
    if (DEDICATED_BLOCK_KINDS.has(k)) {
      const sel = DEDICATED_BLOCK_KINDS.get(k).selector;
      if (html.includes(sel)) continue;          /* dedicated block satisfied */
    }
    trulyMissing.push(k);
  }
  /* Extra = chip kinds (collapsed to parent) the model didn't declare. Tier
   * chips never count as extra on their own — only their parent kind does. */
  const extra = [...chippedNormalised].filter(k => !declared.has(k) && !AUTO_INJECTED_KINDS.has(k));

  return {
    id: fixture.id,
    group: fixture.group,
    declared: [...declared].filter(k => !SYNTHETIC_KINDS.has(k)).sort(),
    chipped: [...chipped].sort(),
    extra,
    missing: trulyMissing,
    pass: extra.length === 0 && trulyMissing.length === 0,
  };
}

async function main() {
  console.log(C.bold(C.cyan('\n🔍 GDD ↔ SLOT FEATURE INTEGRITY VERIFIKAT\n')));

  const fixtures = await collectFixtures();
  console.log(C.dim(`Auditing ${fixtures.length} GDDs (${fixtures.filter(f => f.group === 'main').length} main + ${fixtures.filter(f => f.group === 'grid').length} grid)\n`));

  const reports = [];
  let pass = 0, fail = 0;
  for (const fx of fixtures) {
    const r = await auditOne(fx);
    reports.push(r);
    if (r.error) {
      console.log(C.red(`✗ ${r.id.padEnd(50)} ERROR: ${r.error}`));
      fail++;
      continue;
    }
    if (r.pass) {
      console.log(C.green(`✓ ${r.id.padEnd(50)} ${r.declared.length} feature(s)`));
      pass++;
    } else {
      console.log(C.red(`✗ ${r.id.padEnd(50)} EXTRA: ${r.extra.join(', ') || '—'}  MISSING: ${r.missing.join(', ') || '—'}`));
      fail++;
    }
  }

  console.log(C.bold(`\n────────────────────────────────────────`));
  console.log(C.bold(`Σ ${fixtures.length} GDDs · ✅ ${pass} · ❌ ${fail}`));
  console.log(C.bold(`────────────────────────────────────────\n`));

  /* Aggregate violations */
  const extraByKind = new Map();
  const missingByKind = new Map();
  for (const r of reports) {
    if (!r.extra || !r.missing) continue;
    for (const k of r.extra)   extraByKind.set(k,   (extraByKind.get(k) || 0) + 1);
    for (const k of r.missing) missingByKind.set(k, (missingByKind.get(k) || 0) + 1);
  }
  if (extraByKind.size > 0 || missingByKind.size > 0) {
    console.log(C.bold('Aggregate violations:'));
    if (extraByKind.size > 0) {
      console.log(C.red('  EXTRA (chip but no GDD feature):'));
      for (const [k, n] of [...extraByKind.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${C.red('•')} ${k.padEnd(28)} ${n}×`);
      }
    }
    if (missingByKind.size > 0) {
      console.log(C.red('  MISSING (GDD feature but no chip):'));
      for (const [k, n] of [...missingByKind.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${C.red('•')} ${k.padEnd(28)} ${n}×`);
      }
    }
    console.log();
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(C.red(`FATAL: ${e.stack || e.message}`)); process.exit(2); });
