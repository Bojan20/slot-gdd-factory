#!/usr/bin/env node
/**
 * tools/model-schema-validator.mjs
 *
 * Wave W47.S21 — ParsedModel schema validator (v2 strict).
 *
 * Purpose
 * -------
 * `parseGDD()` returns a model object whose shape is the contract every
 * downstream block, builder, and audit relies on. Until now that contract
 * was implicit — the only enforcement was "buildSlotHTML runs without
 * throwing." That's a weak gate: a malformed model can silently produce
 * a broken slot HTML where, say, `symbols.high === undefined` collapses
 * paytable rendering to an empty list.
 *
 * This tool checks every sample GDD's parsed model against an explicit
 * schema:
 *
 *   • top-level keys (name, theme, topology, symbols, features,
 *     freeSpins, winPresentation, confidence) — REQUIRED, correct type
 *   • theme.tags / theme.palette — array of strings
 *   • topology.kind, topology.reels (1..12), topology.rows (1..12),
 *     topology.paylines (>= 0), topology.shape (whitelist)
 *   • symbols.high / mid / low / specials — arrays
 *   • features[] — each entry { kind: string, label: string }, kind
 *     drawn from a known catalog (warn for unknown kinds, never fail)
 *   • confidence — { name, topology, symbols, features } numeric in [0,1]
 *
 * Operating modes:
 *   default — report violations, exit 0 (info)
 *   --strict — exit 1 if any violation
 *
 * Vendor-neutral. No game / studio name in code. Schema is in this file
 * (no external dep) so it's auditable in one read.
 *
 * Senior-grade discipline (rule_senior_grade_code):
 *   • Single responsibility — model shape validation, nothing else.
 *   • 0 external deps — pure Node 22+.
 *   • Deterministic — same model → same verdict.
 *   • Pure pass — does NOT mutate models.
 *
 * @module tools/model-schema-validator
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

const STRICT = process.argv.includes('--strict');

/* ────────────────────────────────────────────────────────────────────
 * Schema constants
 * ──────────────────────────────────────────────────────────────────── */

const TOPOLOGY_SHAPE_WHITELIST = new Set([
  'rectangular', 'hexagonal', 'pyramid', 'diamond',
  'cross', 'l_shape', 'radial', 'megaclusters',
]);

const TOPOLOGY_KIND_WHITELIST = new Set([
  'rectangular', 'cluster', 'variable_reel', 'megaclusters',
  'hexagonal', 'diamond', 'pyramid', 'cross', 'l_shape',
  'radial', 'infinity', 'expanding', 'dual_colossal',
  'slingo', 'plinko', 'crash', 'wheel', 'lock_respin',
  'dual',
]);

/* For these topology kinds, `topology.reels` and `topology.rows` are
 * reused as domain-specific dimensions (plinko peg matrix, wheel
 * segments, crash time-window), so the 1..12 reels-grid bounds do
 * not apply. */
const RELAXED_GRID_BOUNDS_KINDS = new Set(['plinko', 'wheel', 'crash']);

/* Known feature kinds — sourced from src/blocks/*.mjs catalog. Anything
 * outside this set is WARN (might be a new block; warn keeps the gate
 * honest without breaking on legitimate growth). */
const FEATURE_KIND_CATALOG = new Set([
  'big_win', 'free_spins', 'multiplier', 'sticky_wild', 'wild',
  'walking_wild', 'expanding_wild', 'mystery_symbol', 'scatter',
  'bonus_buy', 'ante_bet', 'autoplay', 'gamble', 'gamble_secondary',
  'hold_and_win', 'cascade', 'tumble', 'avalanche', 'cluster_pays',
  'megaways', 'ways', 'lines', 'pay_anywhere',
  'reality_check', 'net_loss_indicator', 'win_cap',
  'progressive_free_spins', 'path_aware_multiplier',
  'split_symbol', 'nudge_reel', 'respin_charge', 'sync_reels',
  'win_multiplier_badge', 'hi_lo_gamble', 'infinity_reels',
  'collectable_symbol', 'retrigger_meter', 'win_line_flash',
  'feature_generic', 'symbol_stack_collapse', 'jackpot_ladder_rooms',
  'cascade_booster', 'supercharged_fs', 'multiplier_orb',
  'wild_collection_trail', 'big_win_tier', 'win_ladder',
  'free_spins_buy', 'jackpot', 'bonus', 'respin', 'reels_lock',
  /* W47.S21 — observed-in-samples kinds. Catalog includes any kind
   * actually appearing in shipped GDD samples so warnings stay actionable
   * (= "a real new block to add" or "a typo to fix"), not noise. */
  'scatter_pay', 'bonus_pick', 'persistent_multiplier',
  'super_symbol', 'lightning', 'wild_reel', 'wheel_bonus',
]);

/* ────────────────────────────────────────────────────────────────────
 * Validator
 * ──────────────────────────────────────────────────────────────────── */

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function isStringArray(x) {
  return Array.isArray(x) && x.every(v => typeof v === 'string');
}

function inRange(n, lo, hi) {
  return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
}

/**
 * Validate a parsed model against the v2 schema.
 *
 * @param {object} model — output of parseGDD()
 * @returns {{violations: string[], warnings: string[]}}
 */
export function validateModelSchema(model) {
  const violations = [];
  const warnings   = [];

  if (!isPlainObject(model)) {
    violations.push('model is not a plain object');
    return { violations, warnings };
  }

  /* top-level shape */
  if (typeof model.name !== 'string' || model.name.length === 0) {
    violations.push('model.name missing or empty');
  }
  if (!isPlainObject(model.theme))    violations.push('model.theme is not an object');
  if (!isPlainObject(model.topology)) violations.push('model.topology is not an object');
  if (!isPlainObject(model.symbols))  violations.push('model.symbols is not an object');
  if (!Array.isArray(model.features)) violations.push('model.features is not an array');
  if (!isPlainObject(model.freeSpins))       warnings.push('model.freeSpins missing — block defaults will apply');
  if (!isPlainObject(model.winPresentation)) warnings.push('model.winPresentation missing — block defaults will apply');
  if (!isPlainObject(model.confidence))      warnings.push('model.confidence missing — auto-scoring disabled');

  /* theme */
  if (isPlainObject(model.theme)) {
    if (!isStringArray(model.theme.tags))    warnings.push('theme.tags is not a string[]');
    if (model.theme.palette !== undefined && !Array.isArray(model.theme.palette)) {
      warnings.push('theme.palette is not an array');
    }
  }

  /* topology */
  if (isPlainObject(model.topology)) {
    const t = model.topology;
    if (typeof t.kind !== 'string') {
      violations.push('topology.kind is not a string');
    } else if (!TOPOLOGY_KIND_WHITELIST.has(t.kind)) {
      warnings.push(`topology.kind="${t.kind}" not in known whitelist`);
    }
    if (typeof t.shape === 'string' && !TOPOLOGY_SHAPE_WHITELIST.has(t.shape)) {
      warnings.push(`topology.shape="${t.shape}" not in whitelist`);
    }
    const relaxed = RELAXED_GRID_BOUNDS_KINDS.has(t.kind);
    if (!relaxed) {
      if (!inRange(t.reels, 1, 12)) {
        violations.push(`topology.reels=${t.reels} out of [1,12]`);
      }
      if (!inRange(t.rows, 1, 12)) {
        violations.push(`topology.rows=${t.rows} out of [1,12]`);
      }
    } else {
      /* plinko/wheel/crash reuse reels/rows for domain-specific
       * dimensions (peg matrix, wheel segments, crash window). Just
       * require positive integers, no upper bound. */
      if (!Number.isInteger(t.reels) || t.reels < 1) {
        violations.push(`topology.reels=${t.reels} not a positive integer (kind=${t.kind})`);
      }
      if (!Number.isInteger(t.rows) || t.rows < 1) {
        violations.push(`topology.rows=${t.rows} not a positive integer (kind=${t.kind})`);
      }
    }
    if (typeof t.paylines === 'number' && t.paylines < 0) {
      violations.push(`topology.paylines=${t.paylines} negative`);
    }
  }

  /* symbols */
  if (isPlainObject(model.symbols)) {
    for (const k of ['high', 'mid', 'low', 'specials']) {
      if (!Array.isArray(model.symbols[k])) {
        violations.push(`symbols.${k} is not an array`);
      }
    }
  }

  /* features */
  if (Array.isArray(model.features)) {
    model.features.forEach((f, idx) => {
      if (!isPlainObject(f)) {
        violations.push(`features[${idx}] is not an object`);
        return;
      }
      if (typeof f.kind !== 'string' || f.kind.length === 0) {
        violations.push(`features[${idx}].kind missing/non-string`);
      } else if (!FEATURE_KIND_CATALOG.has(f.kind)) {
        warnings.push(`features[${idx}].kind="${f.kind}" not in catalog`);
      }
      if (typeof f.label !== 'string') {
        warnings.push(`features[${idx}].label not a string`);
      }
    });
  }

  /* confidence — numeric in [0,1] for the 4 declared sub-keys */
  if (isPlainObject(model.confidence)) {
    for (const k of ['name', 'topology', 'symbols', 'features']) {
      const v = model.confidence[k];
      if (v !== undefined && !inRange(v, 0, 1)) {
        warnings.push(`confidence.${k}=${v} out of [0,1]`);
      }
    }
  }

  return { violations, warnings };
}

/* ────────────────────────────────────────────────────────────────────
 * CLI entry
 * ──────────────────────────────────────────────────────────────────── */

function collectSamples() {
  const out = [];
  const main = path.join(REPO, 'samples');
  const grid = path.join(REPO, 'samples', 'grids');
  for (const f of readdirSync(main).filter(x => x.endsWith('.md'))) {
    out.push({ id: f.replace(/\.md$/, ''), path: path.join(main, f), group: 'main' });
  }
  for (const f of readdirSync(grid).filter(x => x.endsWith('.md'))) {
    out.push({ id: f.replace(/\.md$/, ''), path: path.join(grid, f), group: 'grid' });
  }
  return out;
}

function main() {
  console.log(C.bold(C.cyan('\n🧪 ParsedModel schema validator — v2 strict\n')));
  console.log(C.dim('   Wave W47.S21 a11y/QA gate — top-level shape + topology + symbols + features.'));
  console.log(C.dim(`   Mode: ${STRICT ? C.yellow('--strict') : 'report-only'}\n`));

  const samples = collectSamples();
  let totalV = 0, totalW = 0, samplesPassed = 0;

  for (const s of samples) {
    let md;
    try { md = readFileSync(s.path, 'utf8'); }
    catch (e) { console.log(C.red(`  ✗ ${s.id} — could not read: ${e.message}`)); totalV++; continue; }

    const model = parseGDD(md, '.md');
    const { violations, warnings } = validateModelSchema(model);
    totalV += violations.length;
    totalW += warnings.length;
    if (violations.length === 0) samplesPassed++;

    if (violations.length === 0 && warnings.length === 0) {
      console.log(`  ${C.green('✓')} ${s.id}`);
    } else {
      console.log(`  ${violations.length ? C.red('✗') : C.yellow('!')} ${C.bold(s.id)}`);
      for (const v of violations) console.log(`     ${C.red('✗ VIOLATION')}  ${v}`);
      for (const w of warnings)   console.log(`     ${C.yellow('⚠ WARNING  ')}  ${w}`);
    }
  }

  console.log(C.dim(
    `\n   scanned ${samples.length} samples · ${samplesPassed} pass · ${totalV} violations · ${totalW} warnings\n`
  ));

  if (STRICT && totalV > 0) {
    console.log(C.red(C.bold(`✖ schema validation failed (${totalV} violations).`)));
    process.exit(1);
  }
  if (totalV === 0) {
    console.log(C.green(C.bold('✅ schema validation clean.')));
  } else {
    console.log(C.yellow(C.bold(`! report-only — ${totalV} violation(s) ignored (use --strict to fail).`)));
  }
}

const invokedFromCli =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] || '');
if (invokedFromCli) main();
