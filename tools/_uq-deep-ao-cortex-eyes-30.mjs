#!/usr/bin/env node
/**
 * tools/_uq-deep-ao-cortex-eyes-30.mjs
 *
 * UQ-DEEP-AO · QA-A · Cortex-eyes massive sweep
 *
 * Boki (24.06.2026): "Prodji sve moguce gddove ... otvori ih u slot gdd
 * projekat, prodji svaki gdd, pogledaj sve lego blokove, da li se pravilno
 * prezentuju u slot builder u browser, cortex oci otvori i sve realno vreme
 * overi da radi savrseno."
 *
 * Live Playwright probe na 30 GDDs (5 baseline + 25 industry-reference).
 * Cilj NIJE potvrditi superiornost — cilj je PRONACI svaku rupu (visual,
 * runtime, math, block-render).
 *
 * Per-slug probe-uje:
 *   1. Console hygiene (errors count + first 3 messages)
 *   2. Page errors (uncaught exceptions)
 *   3. Dialogs (alert/confirm/prompt)
 *   4. Vendor leak scan (IGT / Pragmatic / Cleopatra / Wolf Run / etc.)
 *   5. NaN / Infinity scan
 *   6. Title sanity
 *   7. Block render audit ([data-block], [data-block-id], .block-*)
 *   8. HookBus event surface
 *   9. Spin button — present + clickable + 20 spins
 *  10. liveRtpHud presence + warming badge
 *  11. Visual contracts (.frame / .grid / .cell)
 *  12. Grid dimensions vs model.json
 *
 * SAFE: NE COMMIT — only emits markdown report to stdout + JSON receipt.
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT_DIR = resolve(REPO, 'tools/_eyes/uq-deep-ao');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const PREVIEW_BASE = 'http://127.0.0.1:5181/preview';

const BASELINE = [
  'cash-eruption-foundry-gdd',
  'crystal-forge-game-gdd',
  'midnight-fangs-game-gdd',
  'wrath-of-olympus-game-gdd',
  'gates-of-olympus-1000-game-gdd',
];

// 25 industry-reference pool: per instruction:
//   ls dist/ingest/ | grep -v "^h2-lock-" | grep -v "^[0-9][0-9][0-9]-" | head -25
// We exclude any baseline slug (already in BASELINE) and pad with web-up-smoke.
import { readdirSync } from 'node:fs';
const allIngest = readdirSync(resolve(REPO, 'dist/ingest'))
  .filter(n => !n.startsWith('h2-lock-'))
  .filter(n => !/^[0-9]{3}-/.test(n));
const baselineSet = new Set(BASELINE);
const INDUSTRY = allIngest.filter(n => !baselineSet.has(n)).slice(0, 25);

const ALL_SLUGS = [...BASELINE, ...INDUSTRY];

const VENDOR_RE = /\b(IGT|Pragmatic\s*Play|Pragmatic|Cash\s*Eruption|Wolf\s*Run|Cleopatra|Buffalo\b|NetEnt|Microgaming|Hacksaw|Nolimit|Wazdan|Light\s*&\s*Wonder|L&W|Spielo|Spinomenal|Wrath\s*of\s*Olympus|Gates\s*of\s*Olympus|Huff\s*N\s*(?:More\s*)?Puff|Dancing\s*Drums|Lock\s*It\s*Link|Ultimate\s*Fire\s*Link|Quick\s*Hit|Jin\s*Ji\s*Bao\s*Xi|Rainbow\s*Riches|Jackpot\s*Party|Goldfish|Zeus|Bier\s*Haus|Raging\s*Rhino|Willy\s*Wonka|Monopoly\b|Cai\s*Yuan|Frankenstein|Jin\s*Long|Gold\s*Stacks|Cash\s*Falls|88\s*Fortunes)\b/i;

// Allow these innocuous "vendor-like" tokens in CSS/font-family/data-attr.
const VENDOR_FALSE_POSITIVE_TAGS = new Set([
  'STYLE', 'SCRIPT', 'META',
]);

const SPINS_PER_SLUG = 20;
const WALL_MS_BUDGET = 10 * 60 * 1000;

function log(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}] ${msg}`);
}

function readModelJson(slug) {
  const p = resolve(REPO, 'dist/ingest', slug, 'model.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

async function probeOne(browser, slug) {
  const url = `${PREVIEW_BASE}/${slug}`;
  const result = {
    slug, url,
    httpOk: false,
    consoleErrors: [],
    pageErrors: [],
    dialogs: [],
    vendorHits: [],
    nanScan: { hasNaN: false, hasInfinity: false, samples: [] },
    title: '',
    blocks: { dataBlock: 0, dataBlockId: 0, blockClass: 0, uniqueIds: [] },
    hookbus: { exposed: false, eventCount: 0, sampleEvents: [] },
    spin: { found: false, clickable: false, completed: 0, balanceDelta: null },
    liveRtpHud: { present: false, warming: false, text: '' },
    visualContracts: { framesOk: 0, framesBroken: 0, cellsOk: 0, cellsBroken: 0 },
    grid: { reels: 0, rows: 0, declaredReels: null, declaredRows: null, match: 'unknown' },
    pass: false,
    failReasons: [],
  };

  let ctx;
  try {
    ctx = await browser.newContext({
      viewport: { width: 1366, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') {
        if (result.consoleErrors.length < 30) {
          result.consoleErrors.push(msg.text().slice(0, 240));
        } else {
          result.consoleErrors.length++; // count only
        }
      }
    });
    page.on('pageerror', err => {
      if (result.pageErrors.length < 10) {
        result.pageErrors.push(String(err.message || err).slice(0, 240));
      }
    });
    page.on('dialog', async dlg => {
      result.dialogs.push({ type: dlg.type(), message: dlg.message().slice(0, 120) });
      try { await dlg.dismiss(); } catch {}
    });

    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    result.httpOk = resp && resp.status() >= 200 && resp.status() < 400;
    if (!result.httpOk) {
      result.failReasons.push(`http=${resp ? resp.status() : 'no-resp'}`);
      return result;
    }

    // Settle a bit for late hooks / hud
    await page.waitForTimeout(400);

    result.title = (await page.title()).slice(0, 120);

    // ─── Vendor leak scan over visible body text ───
    const bodyText = await page.evaluate(() => document.body ? (document.body.innerText || '') : '');
    if (bodyText) {
      const re = new RegExp(VENDOR_RE.source, 'gi');
      let m, hits = 0;
      while ((m = re.exec(bodyText)) && hits < 6) {
        result.vendorHits.push(m[0]);
        hits++;
      }
    }
    if (VENDOR_RE.test(result.title)) {
      result.vendorHits.push(`[title] ${result.title}`);
    }

    // ─── NaN / Infinity scan ───
    if (/\bNaN\b/.test(bodyText)) {
      result.nanScan.hasNaN = true;
      result.nanScan.samples.push(bodyText.match(/.{0,20}NaN.{0,20}/)?.[0] || 'NaN');
    }
    if (/\bInfinity\b/.test(bodyText)) {
      result.nanScan.hasInfinity = true;
      result.nanScan.samples.push(bodyText.match(/.{0,20}Infinity.{0,20}/)?.[0] || 'Infinity');
    }

    // ─── Block render audit ───
    const blockData = await page.evaluate(() => {
      const dataBlock   = document.querySelectorAll('[data-block]').length;
      const dataBlockId = document.querySelectorAll('[data-block-id]').length;
      const blockClass  = document.querySelectorAll('[class*="block-"]').length;
      const ids = new Set();
      document.querySelectorAll('[data-block]').forEach(el => {
        const id = el.getAttribute('data-block');
        if (id) ids.add(id);
      });
      document.querySelectorAll('[data-block-id]').forEach(el => {
        const id = el.getAttribute('data-block-id');
        if (id) ids.add(id);
      });
      return {
        dataBlock, dataBlockId, blockClass,
        uniqueIds: Array.from(ids).slice(0, 60),
      };
    });
    result.blocks = blockData;

    // ─── HookBus event surface ───
    const hookData = await page.evaluate(() => {
      const w = window;
      const out = { exposed: false, eventCount: 0, sampleEvents: [] };
      const probes = ['HookBus', '__HOOKBUS__', '__HOOKBUS_EVENTS__'];
      for (const k of probes) {
        const v = w[k];
        if (!v) continue;
        out.exposed = true;
        if (v._listeners && typeof v._listeners === 'object') {
          const keys = Object.keys(v._listeners);
          out.eventCount = keys.length;
          out.sampleEvents = keys.slice(0, 8);
          return out;
        }
        if (Array.isArray(v)) {
          const ev = Array.from(new Set(v.map(x => (x && x.type) || (typeof x === 'string' ? x : '')).filter(Boolean)));
          out.eventCount = ev.length;
          out.sampleEvents = ev.slice(0, 8);
          return out;
        }
        if (typeof v === 'object') {
          const keys = Object.keys(v);
          out.eventCount = keys.length;
          out.sampleEvents = keys.slice(0, 8);
          return out;
        }
      }
      return out;
    });
    result.hookbus = hookData;

    // ─── Grid dimensions ───
    const grid = await page.evaluate(() => {
      const reels = document.querySelectorAll('[data-reel], .reel').length;
      let rows = 0;
      const reelEl = document.querySelector('[data-reel], .reel');
      if (reelEl) {
        rows = reelEl.querySelectorAll('[data-cell], .cell').length;
      }
      if (rows === 0) {
        // try grid -> rows via cell count / reel count
        const totalCells = document.querySelectorAll('[data-cell], .cell').length;
        if (reels > 0) rows = Math.round(totalCells / reels);
      }
      return { reels, rows };
    });
    result.grid.reels = grid.reels;
    result.grid.rows = grid.rows;

    const model = readModelJson(slug);
    if (model && model.topology) {
      result.grid.declaredReels = model.topology.reels ?? null;
      result.grid.declaredRows = model.topology.rows ?? null;
      if (result.grid.declaredReels != null && result.grid.declaredRows != null) {
        if (result.grid.reels === result.grid.declaredReels && result.grid.rows === result.grid.declaredRows) {
          result.grid.match = 'ok';
        } else if (result.grid.reels === 0 && result.grid.rows === 0) {
          result.grid.match = 'no-render';
        } else {
          result.grid.match = `mismatch (${result.grid.reels}x${result.grid.rows} vs ${result.grid.declaredReels}x${result.grid.declaredRows})`;
        }
      }
    }

    // ─── Visual contracts ───
    const visuals = await page.evaluate(() => {
      function isVisible(el) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      let framesOk = 0, framesBroken = 0, cellsOk = 0, cellsBroken = 0;
      document.querySelectorAll('.frame, [data-frame]').forEach(el => {
        if (isVisible(el)) framesOk++; else framesBroken++;
      });
      document.querySelectorAll('[data-cell], .cell').forEach(el => {
        if (isVisible(el)) cellsOk++; else cellsBroken++;
      });
      return { framesOk, framesBroken, cellsOk, cellsBroken };
    });
    result.visualContracts = visuals;

    // ─── Spin button + 20 spins ───
    const spinBtn = await page.$('#spin, [data-action="spin"], button:has-text("SPIN"), button:has-text("Spin")');
    result.spin.found = !!spinBtn;
    if (spinBtn) {
      try {
        const disabled = await spinBtn.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');
        result.spin.clickable = !disabled;
      } catch {
        result.spin.clickable = false;
      }
    }

    if (result.spin.clickable) {
      // capture balance pre
      const balPre = await page.evaluate(() => {
        const el = document.querySelector('[data-balance], .balance, #balance');
        if (!el) return null;
        const t = (el.textContent || '').replace(/[^\d.,-]/g, '').replace(',', '.');
        return parseFloat(t);
      });

      let completed = 0;
      for (let i = 0; i < SPINS_PER_SLUG; i++) {
        try {
          await spinBtn.click({ timeout: 1500, force: true });
          completed++;
          await page.waitForTimeout(120);
        } catch {
          break;
        }
      }
      result.spin.completed = completed;

      const balPost = await page.evaluate(() => {
        const el = document.querySelector('[data-balance], .balance, #balance');
        if (!el) return null;
        const t = (el.textContent || '').replace(/[^\d.,-]/g, '').replace(',', '.');
        return parseFloat(t);
      });
      if (balPre != null && balPost != null && !Number.isNaN(balPre) && !Number.isNaN(balPost)) {
        result.spin.balanceDelta = +(balPost - balPre).toFixed(2);
      }
    }

    // ─── liveRtpHud ───
    const hud = await page.evaluate(() => {
      const sels = ['#liveRtpHud', '[data-block="liveRtpHud"]', '[data-block-id="liveRtpHud"]', '.live-rtp-hud', '#live-rtp-hud'];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) {
          const txt = (el.textContent || '').slice(0, 200);
          const warming = /warm(ing|up)/i.test(txt);
          return { present: true, warming, text: txt };
        }
      }
      return { present: false, warming: false, text: '' };
    });
    result.liveRtpHud = hud;

    // ─── PASS criteria ───
    const fails = [];
    if (result.consoleErrors.length > 0) fails.push(`console=${result.consoleErrors.length}`);
    if (result.pageErrors.length > 0) fails.push(`pageErr=${result.pageErrors.length}`);
    if (result.dialogs.length > 0) fails.push(`dialog=${result.dialogs.length}`);
    if (result.vendorHits.length > 0) fails.push(`vendor=${result.vendorHits.length}`);
    if (result.nanScan.hasNaN || result.nanScan.hasInfinity) fails.push('NaN/Inf');
    if (result.grid.match.startsWith('mismatch')) fails.push(result.grid.match);
    if (result.grid.match === 'no-render') fails.push('no-render');
    if (result.spin.found && result.spin.completed < 10) fails.push(`spins=${result.spin.completed}/${SPINS_PER_SLUG}`);
    if (result.blocks.dataBlock + result.blocks.dataBlockId === 0) fails.push('zero-blocks');

    result.failReasons = fails;
    result.pass = fails.length === 0;

  } catch (err) {
    result.failReasons.push(`exception: ${String(err.message || err).slice(0, 120)}`);
  } finally {
    try { if (ctx) await ctx.close(); } catch {}
  }
  return result;
}

(async function main() {
  const startedAt = Date.now();
  log(`UQ-DEEP-AO Cortex-eyes sweep: ${ALL_SLUGS.length} slugs (${BASELINE.length} baseline + ${INDUSTRY.length} industry-reference pool)`);

  const browser = await chromium.launch({ headless: true });
  const all = [];
  for (let i = 0; i < ALL_SLUGS.length; i++) {
    const slug = ALL_SLUGS[i];
    const elapsed = Date.now() - startedAt;
    if (elapsed > WALL_MS_BUDGET) {
      log(`wallclock budget exhausted at slug ${i}/${ALL_SLUGS.length}, aborting`);
      break;
    }
    log(`[${i + 1}/${ALL_SLUGS.length}] ${slug}`);
    const r = await probeOne(browser, slug);
    all.push(r);
    log(`  → ${r.pass ? 'PASS' : 'FAIL'} | spins=${r.spin.completed}/${SPINS_PER_SLUG} | console=${r.consoleErrors.length} | dialogs=${r.dialogs.length} | vendor=${r.vendorHits.length} | blocks=${r.blocks.dataBlock + r.blocks.dataBlockId} | grid=${r.grid.reels}x${r.grid.rows} (${r.grid.match})`);
  }
  await browser.close();

  // ─── Markdown report ───
  const md = [];
  md.push(`# UQ-DEEP-AO · Cortex-eyes massive sweep (${all.length}/${ALL_SLUGS.length} probed)`);
  md.push('');
  md.push(`Wallclock: ${((Date.now() - startedAt) / 1000).toFixed(1)}s · Preview: ${PREVIEW_BASE}`);
  md.push('');
  md.push('## Per-slug summary');
  md.push('');
  md.push('| slug | PASS | spins | console | dialogs | vendor | NaN | blocks | hooks | grid |');
  md.push('|------|------|-------|---------|---------|--------|-----|--------|-------|------|');
  for (const r of all) {
    const slug = r.slug.length > 38 ? r.slug.slice(0, 35) + '...' : r.slug;
    md.push(`| ${slug} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.spin.completed}/${SPINS_PER_SLUG} | ${r.consoleErrors.length} | ${r.dialogs.length} | ${r.vendorHits.length} | ${r.nanScan.hasNaN || r.nanScan.hasInfinity ? 'Y' : '0'} | ${r.blocks.dataBlock + r.blocks.dataBlockId} | ${r.hookbus.eventCount} | ${r.grid.reels}x${r.grid.rows} (${r.grid.match}) |`);
  }
  md.push('');

  // ─── Aggregate / TOP 10 ───
  const passes = all.filter(r => r.pass).length;
  const fails = all.length - passes;
  md.push('## Aggregate');
  md.push('');
  md.push(`- PASS: ${passes}/${all.length}`);
  md.push(`- FAIL: ${fails}/${all.length}`);
  const totalConsole = all.reduce((s, r) => s + r.consoleErrors.length, 0);
  const totalPageErr = all.reduce((s, r) => s + r.pageErrors.length, 0);
  const totalDialog  = all.reduce((s, r) => s + r.dialogs.length, 0);
  const totalVendor  = all.reduce((s, r) => s + r.vendorHits.length, 0);
  const totalNaN     = all.filter(r => r.nanScan.hasNaN || r.nanScan.hasInfinity).length;
  md.push(`- Total console errors: ${totalConsole}`);
  md.push(`- Total page errors: ${totalPageErr}`);
  md.push(`- Total dialogs: ${totalDialog}`);
  md.push(`- Total vendor hits: ${totalVendor}`);
  md.push(`- Slugs with NaN/Infinity: ${totalNaN}`);
  md.push('');

  // TOP 10 fail patterns
  md.push('## TOP 10 fail patterns');
  md.push('');

  // 1. Most common console error message
  const consoleCounts = new Map();
  for (const r of all) for (const m of r.consoleErrors) {
    const k = m.slice(0, 80);
    consoleCounts.set(k, (consoleCounts.get(k) || 0) + 1);
  }
  const topConsole = [...consoleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  md.push(`**1. Most common console error**`);
  if (topConsole.length === 0) md.push('- (none)');
  else for (const [m, c] of topConsole) md.push(`- ${c}× \`${m}\``);
  md.push('');

  // 2. Most common vendor leak source
  const vendorCounts = new Map();
  for (const r of all) for (const v of r.vendorHits) {
    vendorCounts.set(v, (vendorCounts.get(v) || 0) + 1);
  }
  const topVendor = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  md.push(`**2. Most common vendor leak source**`);
  if (topVendor.length === 0) md.push('- (none)');
  else for (const [v, c] of topVendor) md.push(`- ${c}× \`${v}\``);
  md.push('');

  // 3. Most common dialog trigger
  const dialogCounts = new Map();
  for (const r of all) for (const d of r.dialogs) {
    const k = `${d.type}: ${d.message}`;
    dialogCounts.set(k, (dialogCounts.get(k) || 0) + 1);
  }
  const topDialog = [...dialogCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  md.push(`**3. Most common dialog trigger**`);
  if (topDialog.length === 0) md.push('- (none)');
  else for (const [d, c] of topDialog) md.push(`- ${c}× \`${d}\``);
  md.push('');

  // 4. Most common missing block (= block ID present in some but absent in others, basic heuristic)
  const blockIdCounts = new Map();
  for (const r of all) for (const id of r.blocks.uniqueIds) {
    blockIdCounts.set(id, (blockIdCounts.get(id) || 0) + 1);
  }
  const missingBlocks = [...blockIdCounts.entries()]
    .filter(([_, c]) => c > 0 && c < all.length)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5);
  md.push(`**4. Most-missing blocks (present in some, absent in others)**`);
  if (missingBlocks.length === 0) md.push('- (none — all blocks uniformly present or none rendered)');
  else for (const [id, c] of missingBlocks) md.push(`- \`${id}\` in only ${c}/${all.length} slugs`);
  md.push('');

  // 5. Most common grid mismatch
  const gridMismatch = all.filter(r => r.grid.match.startsWith('mismatch') || r.grid.match === 'no-render');
  md.push(`**5. Grid mismatches**`);
  if (gridMismatch.length === 0) md.push('- (none)');
  else for (const r of gridMismatch.slice(0, 6)) md.push(`- \`${r.slug}\`: ${r.grid.match}`);
  md.push('');

  // 6. Slugs with > 5 console errors
  const highConsole = all.filter(r => r.consoleErrors.length > 5);
  md.push(`**6. Slugs with > 5 console errors**`);
  if (highConsole.length === 0) md.push('- (none)');
  else for (const r of highConsole) md.push(`- \`${r.slug}\` (${r.consoleErrors.length})`);
  md.push('');

  // 7. Slugs with vendor leak
  const vendorSlugs = all.filter(r => r.vendorHits.length > 0);
  md.push(`**7. Slugs with vendor leak**`);
  if (vendorSlugs.length === 0) md.push('- (none — vendor-neutral gate clean)');
  else for (const r of vendorSlugs.slice(0, 10)) md.push(`- \`${r.slug}\` → ${r.vendorHits.slice(0, 3).join(', ')}`);
  md.push('');

  // 8. Broken spin button
  const brokenSpin = all.filter(r => r.spin.found && r.spin.completed < 10);
  md.push(`**8. Broken spin button (< 10 completed spins)**`);
  if (brokenSpin.length === 0) md.push('- (none)');
  else for (const r of brokenSpin) md.push(`- \`${r.slug}\` (${r.spin.completed}/${SPINS_PER_SLUG})`);
  md.push('');

  // 9. Missing liveRtpHud
  const noHud = all.filter(r => !r.liveRtpHud.present);
  md.push(`**9. Slugs missing liveRtpHud**`);
  if (noHud.length === 0) md.push('- (none)');
  else {
    md.push(`- ${noHud.length}/${all.length} slugs lack liveRtpHud`);
    for (const r of noHud.slice(0, 8)) md.push(`  - \`${r.slug}\``);
  }
  md.push('');

  // 10. Zero block-data attrs
  const zeroBlocks = all.filter(r => (r.blocks.dataBlock + r.blocks.dataBlockId) === 0);
  md.push(`**10. Slugs with zero block-data attributes (render gap)**`);
  if (zeroBlocks.length === 0) md.push('- (none)');
  else for (const r of zeroBlocks) md.push(`- \`${r.slug}\` (.block-* count=${r.blocks.blockClass})`);
  md.push('');

  const mdText = md.join('\n');
  const mdPath = resolve(OUT_DIR, `report-${Date.now()}.md`);
  writeFileSync(mdPath, mdText);
  const jsonPath = resolve(OUT_DIR, `receipt-${Date.now()}.json`);
  writeFileSync(jsonPath, JSON.stringify({ startedAt, finishedAt: Date.now(), all }, null, 2));

  log(`report: ${mdPath}`);
  log(`receipt: ${jsonPath}`);
  console.log('\n' + mdText);

  process.exit(0);
})().catch(err => {
  console.error('UQ-DEEP-AO FATAL:', err);
  process.exit(1);
});
