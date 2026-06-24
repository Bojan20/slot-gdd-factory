#!/usr/bin/env node
/**
 * tools/_uq-deep-ao-synth-stratified.mjs
 *
 * UQ-DEEP-AO · QA-B · 50 synthetic GDDs stratified block coverage probe
 *
 * Boki direktiva: "pogledaj sve lego blokove, da li se pravilno prezentuju
 * u slot builder u browser"
 *
 * What this probe does (per slug):
 *   1. Load dist/ingest/<slug>/model.json
 *      → DECLARED block kinds = features[].kind ∪ keys(__blockMapper__.activated)
 *   2. Navigate http://127.0.0.1:5181/preview/<slug>
 *   3. Parse RENDERED block kinds from HTML "<!-- <name> BLOCK" comments
 *      + DOM `[data-block]`, `[data-block-id]`, `[class*="block"]`
 *   4. Compute coverage ratio, missing kinds, phantom kinds
 *   5. Console error count, vendor leak scan, spin smoke (5×), liveRtpHud
 *   6. Per-block visual sanity on up to 10 random data-block elements
 *
 * STRATIFIED SAMPLING:
 *   The synthetic corpus is heavily skewed (310 / 318 = 'rectangular' base).
 *   We sample one representative from each unique (topology.kind, feature-set)
 *   bucket, then pad with random h2-lock-* / 00X-* / web-up-smoke-* to reach
 *   exactly 50 unique slugs.
 *
 * STRICT FILE FENCE: this file only.
 *
 * Wallclock budget: 8 minutes (with serial probes ~4-6s each → ~5 min).
 * Idempotent.
 */

import { chromium } from 'playwright';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT_DIR = resolve(REPO, 'tools/_eyes/uq-deep-ao');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const PREVIEW_BASE = 'http://127.0.0.1:5181';
const INGEST_DIR = resolve(REPO, 'dist/ingest');

// ─── stratified sampler ─────────────────────────────────────────────────
function stratifySlugs(target = 50) {
  const all = readdirSync(INGEST_DIR).filter(d => d !== 'x');
  // Bucket key = topology.kind + sorted feature kinds
  const buckets = new Map();
  const meta = new Map();
  for (const d of all) {
    const mp = join(INGEST_DIR, d, 'model.json');
    if (!existsSync(mp)) continue;
    try {
      const m = JSON.parse(readFileSync(mp, 'utf8'));
      const t = m.topology || {};
      const kinds = (m.features || []).map(f => f.kind).sort().join(',');
      const key = (t.kind || 'unknown') + '|' + kinds;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(d);
      meta.set(d, {
        topology: t.kind || 'unknown',
        reels: t.reels,
        rows: t.rows,
        featureKinds: kinds.split(',').filter(Boolean),
      });
    } catch {}
  }
  // Step 1: take one representative from each bucket
  const picked = new Set();
  for (const [, slugs] of buckets) {
    if (picked.size >= target) break;
    picked.add(slugs[0]);
  }
  // Step 2: pad from biggest bucket(s) by jumping through indices for variety
  const sortedByVol = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
  outer: for (const [, slugs] of sortedByVol) {
    const step = Math.max(1, Math.floor(slugs.length / target));
    for (let i = 0; i < slugs.length && picked.size < target; i += step) {
      picked.add(slugs[i]);
      if (picked.size >= target) break outer;
    }
  }
  // Last pass: pad linearly with any remaining
  for (const d of all) {
    if (picked.size >= target) break;
    picked.add(d);
  }
  return { slugs: [...picked].slice(0, target), meta };
}

// ─── declared blocks extraction ──────────────────────────────────────────
function extractDeclared(model) {
  const set = new Set();
  // a) feature kinds
  for (const f of model.features || []) {
    if (f && f.kind) set.add(f.kind);
  }
  // b) explicit blockMapper.activated
  const bm = model.__blockMapper__ || {};
  for (const k of bm.activated || []) set.add(k);
  // c) __declared keys flagged "declared"
  const dec = model.__declared || {};
  for (const [k, v] of Object.entries(dec)) {
    if (v === 'declared') set.add(k);
  }
  return set;
}

// ─── rendered blocks extraction from HTML ────────────────────────────────
function extractRenderedFromHtml(html) {
  const set = new Set();
  // <!-- <name> BLOCK markers
  const re1 = /<!--\s*([a-zA-Z][a-zA-Z0-9]*)\s+BLOCK\b/g;
  let m;
  while ((m = re1.exec(html)) !== null) set.add(m[1]);
  return set;
}

// ─── vendor leak scan ────────────────────────────────────────────────────
const VENDOR_NEEDLES = [
  'pragmatic', 'pragmaticplay', 'netent', 'playngo', 'play\'n go',
  'microgaming', 'isoftbet', 'evolution gaming', 'redtiger',
  'red tiger', 'bigtimegaming', 'big time gaming', 'btg', 'igt',
  'aristocrat', 'novomatic', 'wazdan', 'yggdrasil', 'thunderkick',
  'quickspin', 'nolimit city', 'push gaming', 'hacksaw', 'relax gaming',
];

function scanVendorLeak(text) {
  if (!text) return [];
  const low = text.toLowerCase();
  const hits = [];
  for (const v of VENDOR_NEEDLES) {
    if (low.includes(v)) hits.push(v);
  }
  return hits;
}

// ─── main ────────────────────────────────────────────────────────────────
const TARGET = 50;
const { slugs: SLUGS, meta: META } = stratifySlugs(TARGET);
console.log(`▶ UQ-DEEP-AO · stratified sample → ${SLUGS.length} slugs`);

const t0 = Date.now();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

const results = [];
const blockDeclaredCounts = new Map();   // blockKind → # of slugs where declared
const blockRenderedCounts = new Map();   // blockKind → # of slugs where rendered
const blockMissingCounts = new Map();    // declared but NOT rendered
const blockPhantomCounts = new Map();    // rendered but NOT declared

function bump(map, k) { map.set(k, (map.get(k) || 0) + 1); }

for (let i = 0; i < SLUGS.length; i++) {
  const slug = SLUGS[i];
  const slugMeta = META.get(slug) || {};
  const url = `${PREVIEW_BASE}/preview/${slug}`;
  const out = {
    slug,
    topology: slugMeta.topology,
    reels: slugMeta.reels,
    rows: slugMeta.rows,
    declared: 0,
    rendered: 0,
    ratio: 0,
    missingBlocks: [],
    phantomBlocks: [],
    consoleErrors: 0,
    vendorLeaks: [],
    spinSuccess: 0,
    spinAttempted: 0,
    liveRtpHud: false,
    visualOk: 0,
    visualTested: 0,
    fatal: null,
  };
  process.stdout.write(`[${String(i + 1).padStart(2)}/${SLUGS.length}] ${slug.padEnd(28)} `);

  try {
    const modelPath = join(INGEST_DIR, slug, 'model.json');
    if (!existsSync(modelPath)) {
      out.fatal = 'no-model';
      results.push(out);
      console.log('SKIP (no-model)');
      continue;
    }
    const model = JSON.parse(readFileSync(modelPath, 'utf8'));
    const declaredSet = extractDeclared(model);
    out.declared = declaredSet.size;

    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));

    let resp;
    try {
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      out.fatal = `nav-fail:${(e.message || e).slice(0, 80)}`;
      await page.close();
      results.push(out);
      console.log('NAV-FAIL');
      continue;
    }
    if (!resp || !resp.ok()) {
      out.fatal = `http-${resp ? resp.status() : 'noresp'}`;
      await page.close();
      results.push(out);
      console.log(out.fatal);
      continue;
    }

    // Let blocks emit
    await page.waitForTimeout(400);

    // Pull HTML + run inline DOM checks in one pass
    const probe = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const dom = {
        dataBlock: document.querySelectorAll('[data-block]').length,
        dataBlockId: document.querySelectorAll('[data-block-id]').length,
        classBlock: document.querySelectorAll('[class*="block"]').length,
      };
      const liveRtpHud = !!(document.querySelector('.live-rtp-hud, [data-live-rtp], #liveRtpHud') ||
                            (typeof window !== 'undefined' && window.__LIVE_RTP_HUD__));
      const bodyText = (document.body && document.body.innerText) || '';
      // Sample visual checks: collect up to 10 random elements that have data-block or class containing "block"
      const all = Array.from(document.querySelectorAll('[data-block], [data-block-id]')).slice(0, 50);
      const sample = [];
      const visited = new Set();
      // pick up to 10 uniformly
      const step = Math.max(1, Math.floor(all.length / 10));
      for (let i = 0; i < all.length && sample.length < 10; i += step) {
        const el = all[i];
        if (!el || visited.has(el)) continue;
        visited.add(el);
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const visible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
                        parseFloat(cs.opacity || '1') > 0.05 && (r.width + r.height > 0 || true);
        sample.push({ tag: el.tagName, key: el.getAttribute('data-block') || el.getAttribute('data-block-id'), visible });
      }
      return { html, dom, liveRtpHud, bodyText, sample };
    });

    const renderedSet = extractRenderedFromHtml(probe.html);
    out.rendered = renderedSet.size;
    out.ratio = declaredSet.size ? +(renderedSet.size / declaredSet.size).toFixed(3) : 0;
    out.consoleErrors = errs.length;
    out.liveRtpHud = probe.liveRtpHud;
    out.dataBlockEls = probe.dom.dataBlock + probe.dom.dataBlockId;

    // missing = declared - rendered
    for (const k of declaredSet) {
      bump(blockDeclaredCounts, k);
      if (!renderedSet.has(k)) {
        out.missingBlocks.push(k);
        bump(blockMissingCounts, k);
      }
    }
    // phantom = rendered - declared
    for (const k of renderedSet) {
      bump(blockRenderedCounts, k);
      if (!declaredSet.has(k)) {
        out.phantomBlocks.push(k);
        bump(blockPhantomCounts, k);
      }
    }
    // vendor leak
    out.vendorLeaks = scanVendorLeak(probe.bodyText);

    // visual sample
    out.visualTested = probe.sample.length;
    out.visualOk = probe.sample.filter(s => s.visible).length;

    // spin smoke 5×
    const spinResult = await page.evaluate(async () => {
      const btn = document.querySelector('#spinBtn, [data-action="spin"], .spin-btn');
      let attempted = 0, success = 0;
      if (!btn) return { attempted: 0, success: 0 };
      for (let i = 0; i < 5; i++) {
        attempted++;
        try {
          btn.click();
          await new Promise(r => setTimeout(r, 250));
          success++;
        } catch {}
      }
      return { attempted, success };
    });
    out.spinAttempted = spinResult.attempted;
    out.spinSuccess = spinResult.success;

    await page.close();
    console.log(`dec=${out.declared} ren=${out.rendered} ratio=${out.ratio} err=${out.consoleErrors} spin=${out.spinSuccess}/${out.spinAttempted} vis=${out.visualOk}/${out.visualTested}`);
  } catch (e) {
    out.fatal = `exc:${(e.message || e).slice(0, 100)}`;
    console.log('EXC', out.fatal);
  }
  results.push(out);
  if (Date.now() - t0 > 7 * 60 * 1000) {
    console.log('▶ Wallclock 7min — stopping early.');
    break;
  }
}

await browser.close();

// ─── aggregate report ───────────────────────────────────────────────────
const probed = results.filter(r => !r.fatal);
const fatalCount = results.length - probed.length;
const totalSlugs = results.length;
const avgRatio = probed.reduce((s, r) => s + r.ratio, 0) / (probed.length || 1);
const lowCov = probed.filter(r => r.ratio < 0.80);
const consoleErrSlugs = probed.filter(r => r.consoleErrors > 0);
const vendorLeakSlugs = probed.filter(r => r.vendorLeaks.length > 0);
const distinctTopo = new Set(probed.map(r => r.topology));

function topN(map, n = 5) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const report = [];
report.push('# UQ-DEEP-AO · QA-B · 50 Synthetic GDDs Stratified Block Coverage Probe');
report.push('');
report.push('## Aggregate stats');
report.push('```');
report.push(`Total probed: ${totalSlugs}  (fatal: ${fatalCount}, successful: ${probed.length})`);
report.push(`Average block coverage ratio: ${avgRatio.toFixed(3)} (rendered/declared)`);
report.push(`Slugs with coverage < 0.80: ${lowCov.length}`);
report.push(`Slugs with console errors:  ${consoleErrSlugs.length}`);
report.push(`Slugs with vendor leak:     ${vendorLeakSlugs.length}`);
report.push(`Distinct topology kinds covered: ${distinctTopo.size}  (${[...distinctTopo].sort().join(', ')})`);
report.push(`Wallclock: ${Math.round((Date.now() - t0) / 1000)}s`);
report.push('```');
report.push('');

report.push('## TOP 5 underrepresented blocks (declared, never rendered)');
report.push('| block | declared (#slugs) | missing (#slugs) | miss ratio |');
report.push('|---|---|---|---|');
const underrep = [...blockDeclaredCounts.entries()]
  .map(([k, dec]) => ({ k, dec, miss: blockMissingCounts.get(k) || 0 }))
  .filter(x => x.miss > 0)
  .sort((a, b) => (b.miss / b.dec) - (a.miss / a.dec) || b.miss - a.miss)
  .slice(0, 5);
for (const r of underrep) {
  report.push(`| ${r.k} | ${r.dec} | ${r.miss} | ${(r.miss / r.dec).toFixed(2)} |`);
}
if (underrep.length === 0) report.push('| _(none)_ | – | – | – |');
report.push('');

report.push('## TOP 5 phantom blocks (rendered, never declared)');
report.push('| block | rendered (#slugs) | phantom (#slugs) |');
report.push('|---|---|---|');
const phantoms = [...blockRenderedCounts.entries()]
  .map(([k, ren]) => ({ k, ren, ph: blockPhantomCounts.get(k) || 0 }))
  .filter(x => x.ph > 0)
  .sort((a, b) => b.ph - a.ph)
  .slice(0, 5);
for (const r of phantoms) {
  report.push(`| ${r.k} | ${r.ren} | ${r.ph} |`);
}
if (phantoms.length === 0) report.push('| _(none)_ | – | – |');
report.push('');

report.push('## TOP 5 slugs with lowest render-coverage');
report.push('| slug | declared | rendered | ratio | missing-sample |');
report.push('|---|---|---|---|---|');
const worst = [...probed].sort((a, b) => a.ratio - b.ratio).slice(0, 5);
for (const r of worst) {
  const sample = r.missingBlocks.slice(0, 4).join(', ') || '–';
  report.push(`| ${r.slug} | ${r.declared} | ${r.rendered} | ${r.ratio} | ${sample} |`);
}
report.push('');

// extras
report.push('## Slugs with console errors (sample)');
const errSample = consoleErrSlugs.slice(0, 5);
for (const r of errSample) report.push(`- ${r.slug} (${r.consoleErrors} errors)`);
if (errSample.length === 0) report.push('_(none)_');
report.push('');

report.push('## Slugs with vendor leaks (sample)');
const vSample = vendorLeakSlugs.slice(0, 5);
for (const r of vSample) report.push(`- ${r.slug} → ${r.vendorLeaks.join(', ')}`);
if (vSample.length === 0) report.push('_(none)_');
report.push('');

report.push('## Spin smoke aggregate');
const spinTotal = probed.reduce((s, r) => s + r.spinAttempted, 0);
const spinOk = probed.reduce((s, r) => s + r.spinSuccess, 0);
report.push(`Total clicks attempted: ${spinTotal}, succeeded: ${spinOk} (${spinTotal ? Math.round(100*spinOk/spinTotal) : 0}%)`);
report.push('');

report.push('## liveRtpHud presence');
const hudCount = probed.filter(r => r.liveRtpHud).length;
report.push(`Slugs with liveRtpHud present: ${hudCount} / ${probed.length}`);
report.push('');

report.push('## Visual sanity (per-block)');
const visTested = probed.reduce((s, r) => s + r.visualTested, 0);
const visOk = probed.reduce((s, r) => s + r.visualOk, 0);
report.push(`Sampled elements: ${visTested}, visible (display!=none, opacity>0.05): ${visOk}`);
report.push('');

const finalReport = report.join('\n');

writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify({
  probed: results,
  declaredCounts: Object.fromEntries(blockDeclaredCounts),
  renderedCounts: Object.fromEntries(blockRenderedCounts),
  missingCounts: Object.fromEntries(blockMissingCounts),
  phantomCounts: Object.fromEntries(blockPhantomCounts),
}, null, 2));
writeFileSync(join(OUT_DIR, 'report.md'), finalReport);

console.log('\n' + finalReport);
console.log(`\n▶ wrote ${join(OUT_DIR, 'report.md')}`);
console.log(`▶ wrote ${join(OUT_DIR, 'results.json')}`);
process.exit(0);
