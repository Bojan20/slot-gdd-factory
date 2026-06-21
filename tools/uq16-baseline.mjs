#!/usr/bin/env node
/**
 * tools/uq16-baseline.mjs
 *
 * Wave UQ-16 (2026-06-21) — Visual regression baseline (text-mode).
 *
 * Goal: pin every one of the 338 GDDs to a deterministic build fingerprint
 * so any future commit that quietly changes a rendered field gets caught
 * by the verify gate. We do NOT use Puppeteer here (avoids browser dep);
 * instead we hash the canonical model + key HTML signals (button count,
 * paytable row count, footer presence, archetype list) so regression
 * surfaces are easily diff-able as text.
 *
 * Modes:
 *   --bake           regenerate baseline from current build
 *                    → tests/baselines/uq16-render-baseline.json
 *   (default)        compare current build vs baseline; exit 1 on diff
 *   --limit N        smoke subset (verify gate uses this)
 *   --report-only    write report but don't exit non-zero
 *   --tolerance F    allow ≤ F % drift (default 0 — strict)
 *
 * Per-GDD fingerprint (stable, deterministic):
 *   slug, htmlBytes (rounded to nearest 100), htmlSha (first 16 hex),
 *   buttonCount, paytableRows, archetypeBackfillIds (sorted),
 *   topologyKind, featureCount, autofixedKeys (sorted), derivedKeys (sorted)
 *
 * On bake: writes baseline JSON. On compare: walks every slug, compares
 * each field, emits report with first 20 drifts.
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');
const CACHE_DIR = resolve(REPO, 'tools/_wave-v-cache');
const BASELINE  = resolve(REPO, 'tests/baselines/uq16-render-baseline.json');

const args = process.argv.slice(2);
const BAKE = args.includes('--bake');
const REPORT_ONLY = args.includes('--report-only');
const _l = args.indexOf('--limit');
const LIMIT = _l >= 0 ? parseInt(args[_l + 1], 10) : null;
const _t = args.indexOf('--tolerance');
const TOL = _t >= 0 ? parseFloat(args[_t + 1]) : 0;

/* ── fingerprint helpers ──────────────────────────────────────────────── */

function sha16(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function countMatches(s, re) {
  const m = s.match(re);
  return m ? m.length : 0;
}

async function fingerprintSlug(slug) {
  const cachePath = resolve(CACHE_DIR, slug + '.json');
  if (!existsSync(cachePath)) return null;
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  const modelDelta = cache.model_delta || {};

  /* Build the same way the corpus render parity tool does. */
  const { buildSlotHTML } = await import(resolve(REPO, 'src/buildSlotHTML.mjs'));
  const { normalizeFromJSON } = await import(resolve(REPO, 'src/parser.mjs'));
  const { applySmartDefaults } = await import(resolve(REPO, 'src/registry/smartDefaults.mjs'));

  let model;
  try { model = normalizeFromJSON(modelDelta); }
  catch (_) { return null; }
  applySmartDefaults(model);
  let html;
  try { html = buildSlotHTML(model); }
  catch (_) { return null; }
  if (!html || typeof html !== 'string') return null;

  /* Round bytes to nearest 100 to avoid noise from whitespace fluctuations. */
  const bytes100 = Math.round(html.length / 100) * 100;

  const archIds = Object.values(model._archetypeBackfill || {})
    .map(b => b.archetypeId).sort();
  const autofixedKeys = Object.keys((model.confidence || {})._autofixedBy || {}).sort();
  const derivedKeys   = Object.keys((model.confidence || {})._derivedBy || {}).sort();

  return {
    slug,
    htmlBytes100: bytes100,
    htmlSha: sha16(html),
    buttonCount:  countMatches(html, /<button\b/gi),
    paytableRows: countMatches(html, /paytable-row/gi),
    footerPresent: /<footer[\s>]/i.test(html),
    archetypeBackfillIds: archIds,
    topologyKind: (model.topology && model.topology.kind) || 'unknown',
    featureCount: (model.features || []).length,
    autofixedKeys, derivedKeys,
  };
}

/* ── main ─────────────────────────────────────────────────────────────── */

async function main() {
  let entries = (await readdir(CACHE_DIR)).filter(f => f.endsWith('.json')).sort();
  if (LIMIT && LIMIT > 0) entries = entries.slice(0, LIMIT);
  const slugs = entries.map(e => e.replace(/\.json$/, ''));

  if (BAKE) {
    console.log(`[uq16] baking baseline over ${slugs.length} slugs…`);
    const baseline = { generatedAt: new Date().toISOString(), slugCount: slugs.length, prints: {} };
    for (const slug of slugs) {
      const p = await fingerprintSlug(slug);
      if (p) baseline.prints[slug] = p;
    }
    await mkdir(resolve(REPO, 'tests/baselines'), { recursive: true });
    await writeFile(BASELINE, JSON.stringify(baseline, null, 2), 'utf8');
    console.log(`✓ baseline baked: ${Object.keys(baseline.prints).length}/${slugs.length} slugs`);
    console.log(`  → ${BASELINE}`);
    process.exit(0);
  }

  if (!existsSync(BASELINE)) {
    console.error('✗ baseline missing — run `node tools/uq16-baseline.mjs --bake` first');
    process.exit(2);
  }

  const baseline = JSON.parse(await readFile(BASELINE, 'utf8'));
  const drifts = [];
  let checked = 0;
  for (const slug of slugs) {
    const before = baseline.prints[slug];
    const after  = await fingerprintSlug(slug);
    checked++;
    if (!before) {
      drifts.push({ slug, kind: 'unbaked-slug' });
      continue;
    }
    if (!after) {
      drifts.push({ slug, kind: 'build-failure' });
      continue;
    }
    /* Diff each field.
       UQ-AUDIT fix: compare type FIRST, then value. JSON.stringify
       coerces 44 and "44" to the same string for non-quoted primitives
       inside arrays; without the typeof guard a number→string drift
       would slip through. */
    const diffFields = [];
    for (const k of Object.keys(before)) {
      const ta = typeof before[k];
      const tb = typeof after[k];
      if (ta !== tb) {
        diffFields.push({ field: k, before: before[k], after: after[k], typeDrift: ta + '→' + tb });
        continue;
      }
      const a = JSON.stringify(before[k]);
      const b = JSON.stringify(after[k]);
      if (a !== b) diffFields.push({ field: k, before: before[k], after: after[k] });
    }
    if (diffFields.length > 0) drifts.push({ slug, kind: 'field-drift', fields: diffFields });
  }

  /* Tolerance — drift rate ≤ TOL % allowed when --tolerance F passed. */
  const driftRate = checked === 0 ? 0 : (drifts.length / checked) * 100;
  const ok = drifts.length === 0 || (TOL > 0 && driftRate <= TOL);

  if (drifts.length > 0) {
    console.log(`[uq16] ${drifts.length}/${checked} drifts (${driftRate.toFixed(2)}%)`);
    for (const d of drifts.slice(0, 20)) {
      if (d.kind === 'field-drift') {
        for (const f of d.fields) {
          console.log(`  · ${d.slug.padEnd(45)} ${f.field}: ${JSON.stringify(f.before).slice(0,40)} → ${JSON.stringify(f.after).slice(0,40)}`);
        }
      } else {
        console.log(`  · ${d.slug.padEnd(45)} ${d.kind}`);
      }
    }
    if (drifts.length > 20) console.log(`  … and ${drifts.length - 20} more`);
  } else {
    console.log(`[uq16] ✓ all ${checked} fingerprints match baseline`);
  }

  if (!ok && !REPORT_ONLY) process.exit(1);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
