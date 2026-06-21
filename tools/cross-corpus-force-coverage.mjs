#!/usr/bin/env node
/**
 * tools/cross-corpus-force-coverage.mjs · Wave UQ-COVER
 *
 * Boki direktiva (2026-06-21): "svaka prvera sad ubacenim agentima i ai
 * orkestratorom a saki moguci gdd, da sdve radi savrseno bezobrezira na
 * gdde. da sve bude pokriveno i forsovima koji su neophodni, i da nema
 * nepotrebnih foprsova i featurea".
 *
 * Walks every V6 reconcile cache entry (338+) and computes a per-GDD
 * verdict on:
 *
 *   1. parser + V6 → buildSlotHTML success (no throw)
 *   2. declared features set (from __activeFeatures__ + features[])
 *   3. force chips present in rendered HTML (literal `'<kind>'`)
 *   4. mapping rules:
 *      - required forces = declared features ∩ UFP ALL_KNOWN_KINDS
 *      - missing forces = required − present
 *      - phantom forces = present − required (chip without GDD declaration)
 *
 * Aggregates:
 *   - "always missing" kinds (≥ N GDDs declared but chip absent → engine bug)
 *   - "always phantom" kinds (≥ N GDDs render chip without declaration → noise)
 *   - per-GDD verdict count
 *
 * Exit codes:
 *   0  every GDD passes (build OK, ≤ tolerance missing/phantom)
 *   1  ≥ 1 GDD has missing/phantom beyond tolerance
 *   2  tool-internal error
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const CACHE = resolve(REPO, 'tools/_wave-v-cache');
const REPORTS = resolve(REPO, 'reports');
if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });

/* ── Force chip kinds SSOT (same logic as orchestrator-e2e). */
function _extractFrozenList(src, varName) {
  const m = src.match(new RegExp(`const\\s+${varName}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) return [];
  /* Pull each quoted identifier literal — comments and other noise
   * don't interfere. */
  const out = [];
  const re = /['"]([a-z][a-z0-9_]*)['"]/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) out.push(mm[1]);
  return out;
}

const _ufpSrc = (() => {
  try { return readFileSync(resolve(REPO, 'src/blocks/universalForcePanel.mjs'), 'utf8'); }
  catch { return ''; }
})();

const FORCE_CHIP_KINDS = _extractFrozenList(_ufpSrc, 'ALL_KNOWN_KINDS');
const FORCE_SET = new Set(FORCE_CHIP_KINDS);
/* UFP intentionally strips these kinds — they're either evaluator-only
 * mechanics (ways, cluster_pays, pay_anywhere, scatter_pay, cascade) or
 * owned by other blocks (bonus_buy → bonusBuy.mjs, ante_bet → anteBet.mjs).
 * If the GDD declares them, we don't expect a UFP chip — they're "declared
 * but no chip" by design, NOT a bug. */
const NON_FORCEABLE = new Set([
  ..._extractFrozenList(_ufpSrc, 'NON_FORCEABLE_MECHANIC_KINDS'),
  ..._extractFrozenList(_ufpSrc, 'DEDUPE_OWNED_BY_OTHER_BLOCK'),
]);

/* ── Camel→snake normalization for cross-source comparison. */
function toSnake(s) {
  return String(s).replace(/[A-Z]/g, m => '_' + m.toLowerCase()).replace(/^_/, '');
}

const { normalizeFromJSON } = await import('../src/parser.mjs');
const { buildSlotHTML } = await import('../src/buildSlotHTML.mjs');
const { adaptV6SymbolsShape } = await import('../src/parser.mjs');

const entries = readdirSync(CACHE).filter(f => f.endsWith('.json')).sort();

/* Limit support for fast smoke runs. */
const _limitIdx = process.argv.indexOf('--limit');
const LIMIT = _limitIdx >= 0 ? parseInt(process.argv[_limitIdx + 1], 10) : entries.length;
const targets = entries.slice(0, LIMIT);

/* Tolerance: a GDD may have up to N phantom chips before being flagged. */
const _phantomIdx = process.argv.indexOf('--phantom-tolerance');
const PHANTOM_TOL = _phantomIdx >= 0 ? parseInt(process.argv[_phantomIdx + 1], 10) : 3;
const _missingIdx = process.argv.indexOf('--missing-tolerance');
const MISSING_TOL = _missingIdx >= 0 ? parseInt(process.argv[_missingIdx + 1], 10) : 2;

console.log(`UQ-COVER — cross-corpus force coverage (${targets.length} GDDs)`);
console.log(`  Force kinds in SSOT: ${FORCE_CHIP_KINDS.length}`);
console.log(`  Tolerance: ≤${PHANTOM_TOL} phantom, ≤${MISSING_TOL} missing`);
console.log('═'.repeat(74));

const aggregate = {
  totalGdds: targets.length,
  buildOk: 0,
  buildFail: 0,
  withinTolerance: 0,
  outsideTolerance: 0,
  missingHistogram: {},     /* kind → count of GDDs declaring it but chip absent */
  phantomHistogram: {},     /* kind → count of GDDs rendering chip without declaration */
  totalDeclared: 0,
  totalRequired: 0,
  totalPresent: 0,
  totalMissing: 0,
  totalPhantom: 0,
};

const flaggedGdds = [];

for (const file of targets) {
  const slug = file.replace(/\.json$/, '');
  let cache;
  try {
    cache = JSON.parse(readFileSync(resolve(CACHE, file), 'utf8'));
  } catch (e) {
    aggregate.buildFail++;
    continue;
  }
  const delta = cache.model_delta || {};
  let html = null;
  try {
    const model = normalizeFromJSON(delta);
    /* V6 stores symbols as flat array — adapt to bucketed shape. */
    if (typeof adaptV6SymbolsShape === 'function') {
      model.symbols = adaptV6SymbolsShape(model.symbols, delta);
    }
    html = buildSlotHTML(model);
  } catch (e) {
    aggregate.buildFail++;
    flaggedGdds.push({ slug, reason: 'build threw: ' + e.message.slice(0, 80) });
    continue;
  }
  if (!html) {
    aggregate.buildFail++;
    flaggedGdds.push({ slug, reason: 'no html' });
    continue;
  }
  aggregate.buildOk++;

  /* Declared features from V6 meta (__meta__ field marks gdd-declared) +
   * raw delta.features kinds. Use snake_case canonical for comparison. */
  const declared = new Set();
  const meta = cache.__meta__ || {};
  for (const [k, v] of Object.entries(meta)) {
    if (v && v.source === 'gdd-declared') declared.add(toSnake(k.split('.')[0]));
  }
  for (const f of (Array.isArray(delta.features) ? delta.features : [])) {
    if (f && f.kind) declared.add(toSnake(f.kind));
  }

  /* Required forces = intersection with UFP catalog MINUS non-forceable
   * mechanic kinds and chips owned by other blocks. */
  const required = new Set([...declared]
    .filter(k => FORCE_SET.has(k))
    .filter(k => !NON_FORCEABLE.has(k)));
  /* Present forces — match the rendered DOM marker only.
   * UFP emits `<button class="ufp-chip" data-ufp-kind="<kind>">` per chip.
   * Searching for the data attribute literal is a precise proxy for "chip
   * actually painted in DOM" — far more accurate than scanning for the
   * kind string anywhere in HTML (which also hits the static ALL_KNOWN_KINDS
   * list embedded in UFP runtime JS). */
  const present = new Set();
  for (const k of FORCE_SET) {
    if (html.includes(`data-ufp-kind="${k}"`)) {
      present.add(k);
    }
  }

  /* Diffs (legacy `const missing` here was redundant — see lightning-aware
   * computation above. Keep only required for telemetry intent.) */
  /* Phantom: chip is present in HTML, kind NOT in declared features, AND
   * kind isn't always-on infra. Baseline chips are infrastructure forces
   * that the engine paints regardless of GDD declaration:
   *   - big_win (bigWinTier — every slot can force a big-win)
   *   - free_spins (almost every slot, also auto-promoted via reels)
   *   - multiplier (mandatory infra for win evaluation)
   * Plus when 'lightning' is declared, UFP auto-expands it to
   *   lightning_x2 / x3 / x5 / x10 sub-chips and drops the base chip.
   *   Treat those sub-chips as derivative, NOT phantom. */
  const ALWAYS_BASELINE = new Set(['free_spins', 'multiplier', 'big_win']);
  /* Lightning detection covers all UFP-aliased names: `lightning`,
   * `randomLightningMultiplier`, `random_lightning_multiplier`. UFP
   * featureKeyToChipKind maps both to the same chip family. */
  const hasLightningFamily =
    declared.has('lightning') ||
    declared.has('random_lightning_multiplier') ||
    [...declared].some(k => /lightning/i.test(k));
  const lightningDerivatives = hasLightningFamily
    ? new Set(['lightning_x2', 'lightning_x3', 'lightning_x5', 'lightning_x10'])
    : new Set();
  const phantom = [...present].filter(k =>
    !declared.has(k) && !ALWAYS_BASELINE.has(k) && !lightningDerivatives.has(k)
  );
  /* Reciprocally, if `lightning` is declared but only the x-variants are
   * present, that's NOT missing — it's the expected expansion. */
  const missingPre = [...required].filter(k => !present.has(k));
  const lightningVariantPresent = ['lightning_x2', 'lightning_x3', 'lightning_x5', 'lightning_x10']
    .some(k => present.has(k));
  const missing = missingPre.filter(k => !(k === 'lightning' && lightningVariantPresent));

  aggregate.totalDeclared += declared.size;
  aggregate.totalRequired += required.size;
  aggregate.totalPresent += present.size;
  aggregate.totalMissing += missing.length;
  aggregate.totalPhantom += phantom.length;

  for (const k of missing) aggregate.missingHistogram[k] = (aggregate.missingHistogram[k] || 0) + 1;
  for (const k of phantom) aggregate.phantomHistogram[k] = (aggregate.phantomHistogram[k] || 0) + 1;

  const withinTol = missing.length <= MISSING_TOL && phantom.length <= PHANTOM_TOL;
  if (withinTol) {
    aggregate.withinTolerance++;
  } else {
    aggregate.outsideTolerance++;
    flaggedGdds.push({
      slug,
      reason: `missing=${missing.length} phantom=${phantom.length}`,
      declared: declared.size,
      required: required.size,
      present: present.size,
      missing: missing.slice(0, 5),
      phantom: phantom.slice(0, 5),
    });
  }
}

/* ── Summary ──────────────────────────────────────────────────────── */
console.log('');
console.log('Per-GDD verdict:');
console.log(`  buildOk:             ${aggregate.buildOk}/${aggregate.totalGdds}`);
console.log(`  buildFail:           ${aggregate.buildFail}`);
console.log(`  withinTolerance:     ${aggregate.withinTolerance}`);
console.log(`  outsideTolerance:    ${aggregate.outsideTolerance}`);
console.log('');
console.log('Aggregate force counts:');
console.log(`  Σ declared kinds:    ${aggregate.totalDeclared}`);
console.log(`  Σ required forces:   ${aggregate.totalRequired}`);
console.log(`  Σ present forces:    ${aggregate.totalPresent}`);
console.log(`  Σ missing forces:    ${aggregate.totalMissing}`);
console.log(`  Σ phantom forces:    ${aggregate.totalPhantom}`);
console.log('');

const topMissing = Object.entries(aggregate.missingHistogram).sort((a, b) => b[1] - a[1]).slice(0, 10);
const topPhantom = Object.entries(aggregate.phantomHistogram).sort((a, b) => b[1] - a[1]).slice(0, 10);

console.log('Top missing (declared but chip absent):');
for (const [k, n] of topMissing) console.log(`  ${k.padEnd(28)} ${n} GDDs`);
console.log('');
console.log('Top phantom (chip rendered, not declared):');
for (const [k, n] of topPhantom) console.log(`  ${k.padEnd(28)} ${n} GDDs`);
console.log('');

if (flaggedGdds.length > 0) {
  console.log(`Flagged GDDs (showing first 10 of ${flaggedGdds.length}):`);
  for (const f of flaggedGdds.slice(0, 10)) {
    console.log(`  ${f.slug.padEnd(40)} ${f.reason}`);
    if (f.missing && f.missing.length) console.log(`    missing: ${f.missing.join(', ')}`);
    if (f.phantom && f.phantom.length) console.log(`    phantom: ${f.phantom.join(', ')}`);
  }
}

/* ── Markdown report ──────────────────────────────────────────────── */
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const md = [];
md.push('# UQ-COVER · Cross-corpus force coverage report');
md.push('');
md.push(`Generated: ${new Date().toISOString()}`);
md.push(`Corpus: ${aggregate.totalGdds} V6 reconcile cache entries`);
md.push(`Force kinds (SSOT): ${FORCE_CHIP_KINDS.length}`);
md.push(`Tolerance: ≤${PHANTOM_TOL} phantom, ≤${MISSING_TOL} missing per GDD`);
md.push('');
md.push('## Per-GDD verdict');
md.push('');
md.push(`- buildOk:           ${aggregate.buildOk}/${aggregate.totalGdds}`);
md.push(`- buildFail:         ${aggregate.buildFail}`);
md.push(`- withinTolerance:   ${aggregate.withinTolerance}`);
md.push(`- outsideTolerance:  ${aggregate.outsideTolerance}`);
md.push('');
md.push('## Top missing forces (declared kind, chip absent)');
md.push('');
md.push('| Kind | GDDs missing |');
md.push('|------|-------------:|');
for (const [k, n] of topMissing) md.push(`| \`${k}\` | ${n} |`);
md.push('');
md.push('## Top phantom forces (chip present, not declared)');
md.push('');
md.push('| Kind | GDDs phantom |');
md.push('|------|-------------:|');
for (const [k, n] of topPhantom) md.push(`| \`${k}\` | ${n} |`);
md.push('');
if (flaggedGdds.length) {
  md.push(`## Flagged GDDs (${flaggedGdds.length})`);
  md.push('');
  md.push('| Slug | Reason | Missing | Phantom |');
  md.push('|------|--------|---------|---------|');
  for (const f of flaggedGdds) {
    md.push(`| ${f.slug.slice(0, 40)} | ${f.reason} | ${(f.missing || []).join(' ') || '—'} | ${(f.phantom || []).join(' ') || '—'} |`);
  }
  md.push('');
}

const mdPath = resolve(REPORTS, `uq-cover-${ts}.md`);
writeFileSync(mdPath, md.join('\n'));
console.log(`Report: ${mdPath}`);

/* Pin a summary JSON for time-series tracking. */
const seriesPath = resolve(REPORTS, 'uq-cover-series.json');
let series = { runs: [] };
if (existsSync(seriesPath)) {
  try { series = JSON.parse(readFileSync(seriesPath, 'utf8')); } catch (_) {}
}
series.runs.push({ ts: new Date().toISOString(), ...aggregate });
if (series.runs.length > 100) series.runs = series.runs.slice(-100);
writeFileSync(seriesPath, JSON.stringify(series, null, 2) + '\n');
console.log(`Series: ${seriesPath} (${series.runs.length} runs tracked)`);

const fail = aggregate.buildFail > 0 || aggregate.outsideTolerance > 0;
process.exit(fail ? 1 : 0);
