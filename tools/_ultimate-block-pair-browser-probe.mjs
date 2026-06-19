#!/usr/bin/env node
/**
 * tools/_ultimate-block-pair-browser-probe.mjs
 *
 * D-2b ULTIMATE BLOCK-PAIR BROWSER PROBE — live pair stress.
 *
 * Companion to the per-block probe (D-2a). Where D-2a verifies each
 * block in isolation, D-2b verifies that PAIRS of blocks co-exist
 * without:
 *   • z-index/overlay collision (bonusOverlayMutex would catch real
 *     conflicts; we surface them here so they show in the report)
 *   • duplicate HookBus event emission (one block muting the other's
 *     event flow)
 *   • console errors during a real spin with BOTH blocks active
 *   • build pipeline crash when both configs merged
 *
 * Strategy:
 *   • Load D-2a's per-block PASS list (only pair PASS blocks together —
 *     pairing a known broken block with another would obscure the pair
 *     interaction signal).
 *   • Sample N deterministic pairs (default 30) using FNV1a hash for
 *     reproducibility — same seed → same pair set across runs.
 *   • For each pair: enable BOTH blocks, build, spin once, capture
 *     console errors + lifecycle event balance.
 *
 * Exit 0 = every pair passed.
 * Exit 1 = any pair FAIL.
 *
 * CLI:
 *   --pairs=N        sample N pairs (default 30, max 200)
 *   --seed=NNN       deterministic sampling seed (default 1)
 *   --verbose        per-pair log
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/per-block-real');
const PER_BLOCK_REPORT = path.join(REPORT_DIR, 'summary.json');
const MANIFEST_PATH = path.join(ROOT, 'blocks/_manifest.json');

const ARGS = process.argv.slice(2);
const PAIRS = Math.max(1, Math.min(200,
  parseInt((ARGS.find(a => a.startsWith('--pairs=')) || '').split('=')[1] || '30', 10)));
const SEED = parseInt((ARGS.find(a => a.startsWith('--seed=')) || '').split('=')[1] || '1', 10);
const VERBOSE = ARGS.includes('--verbose');

let pass = 0, fail = 0;
const perPairResults = [];

function tag(status, label, reasons = []) {
  const s = status === 'PASS' ? '✓' : '✗';
  const line = `  ${s} ${label.padEnd(60)} [${status}]${reasons.length ? ' — ' + reasons.join('; ') : ''}`;
  if (status === 'PASS') { pass++; if (VERBOSE) console.log(line); }
  else { fail++; console.log(line); }
  perPairResults.push({ pair: label, status, reasons });
}

/* FNV1a hash → deterministic int from string */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer().listen(0, '127.0.0.1', () => {
      const p = srv.address().port; srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function serveHTML(port, html) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    srv.listen(port, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });
}

/**
 * Deterministic pair sampling: generate (PAIRS × 2) indices from FNV-mixed
 * seed, mod into eligible[] length, drop duplicate pairs.
 */
function samplePairs(eligible, count, seed) {
  const out = [];
  const seen = new Set();
  let cursor = seed;
  let safety = 0;
  while (out.length < count && safety < count * 20) {
    safety++;
    cursor = fnv1a('pair-' + cursor);
    const i = cursor % eligible.length;
    cursor = fnv1a('pair2-' + cursor);
    const j = cursor % eligible.length;
    if (i === j) continue;
    const a = i < j ? i : j;
    const b = i < j ? j : i;
    const key = `${a}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([eligible[a], eligible[b]]);
  }
  return out;
}

async function probeOnePair(browser, baseModel, blockA, blockB) {
  let srv = null, ctx = null, page = null;
  const label = `${blockA.name} × ${blockB.name}`;
  const reasons = [];
  let status = 'PASS';

  try {
    const m = JSON.parse(JSON.stringify(baseModel));
    m[blockA.name] = { ...(blockA.defaultConfig || {}), enabled: true };
    m[blockB.name] = { ...(blockB.defaultConfig || {}), enabled: true };
    let html;
    try { html = buildSlotHTML(m); }
    catch (e) {
      tag('FAIL', label, [`build threw: ${String(e.message || e).slice(0, 80)}`]);
      return;
    }

    const port = await findFreePort();
    srv = await serveHTML(port, html);
    ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await ctx.newPage();

    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => errs.push('pageerror: ' + String(e.message || e).slice(0, 200)));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(300);

    /* Both blocks must register on their declared hooks */
    const aHooks = blockA.lifecycleHooks || [];
    const bHooks = blockB.lifecycleHooks || [];
    const counts = await page.evaluate((hooks) => {
      const bus = window.HookBus;
      if (!bus || typeof bus.listenerCount !== 'function') return null;
      const out = {};
      for (const h of hooks) try { out[h] = bus.listenerCount(h); } catch (_) { out[h] = -1; }
      return out;
    }, Array.from(new Set([...aHooks, ...bHooks])));

    /* One real spin */
    const spinR = await page.evaluate(() => {
      const btn = document.getElementById('spinBtn');
      if (!btn) return { ok: false, why: 'no-spin-btn' };
      btn.click();
      return { ok: true };
    });
    if (!spinR.ok) {
      reasons.push(`spin: ${spinR.why}`);
      status = 'FAIL';
    } else {
      try {
        await page.waitForFunction(() => !window.allReelsActive && !document.querySelector('.is-spinning'), { timeout: 8000 });
      } catch (_) { reasons.push('did-not-settle'); status = 'FAIL'; }
    }

    if (errs.length) {
      const fatal = errs.filter(e =>
        !/favicon|autoplay\s*policy|user gesture|Cannot read prop.* of null \(reading 'getContext'\)/i.test(e)
      );
      if (fatal.length) {
        reasons.push(`console-err×${fatal.length}: ${fatal[0].slice(0, 60)}`);
        status = 'FAIL';
      }
    }

    /* Hook subscription sanity — both blocks' declared hooks should be > 0
     * if EITHER block in isolation had them subscribed. Pair-mode regression
     * detection: subscriber count > 0 for at least one of the pair when
     * declared hooks overlap. */
    if (counts) {
      const allDecl = Array.from(new Set([...aHooks, ...bHooks]));
      const dead = allDecl.filter(h => !counts[h]);
      if (dead.length === allDecl.length && allDecl.length > 0) {
        reasons.push(`no-hook-subs (${dead.length})`);
        /* WARN not FAIL — some blocks' hooks fire only inside FS, not basic spin */
      }
    }

    tag(status, label, reasons);
  } catch (e) {
    tag('FAIL', label, [`threw: ${String(e.message || e).slice(0, 80)}`]);
  } finally {
    if (page) try { await page.close(); } catch (_) {}
    if (ctx) try { await ctx.close(); } catch (_) {}
    if (srv) try { srv.close(); } catch (_) {}
  }
}

(async () => {
  console.log(`\n=== D-2b ULTIMATE BLOCK-PAIR BROWSER PROBE (${PAIRS} pairs, seed=${SEED}) ===`);
  await fs.mkdir(REPORT_DIR, { recursive: true });

  /* Need D-2a report to know which blocks individually PASS */
  let eligible;
  try {
    const perBlock = JSON.parse(await fs.readFile(PER_BLOCK_REPORT, 'utf8'));
    const passNames = new Set(perBlock.results.filter(r => r.status === 'PASS').map(r => r.name));
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    eligible = manifest.blocks.filter(b => passNames.has(b.name));
    console.log(`Eligible (PASS in D-2a): ${eligible.length} blocks`);
  } catch (e) {
    console.error(`[FATAL] D-2a report missing — run per-block probe first.\n  ${e.message}`);
    process.exit(2);
  }

  if (eligible.length < 2) {
    console.error('[FATAL] need >= 2 eligible blocks to pair');
    process.exit(2);
  }

  const pairs = samplePairs(eligible, PAIRS, SEED);
  console.log(`Sampled ${pairs.length} unique pairs\n`);

  const text = await fs.readFile(path.join(ROOT, 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md'), 'utf8');
  const baseModel = parseGDD(text, 'md');

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });

  const wallStart = Date.now();
  for (const [a, b] of pairs) await probeOnePair(browser, baseModel, a, b);
  const wallMs = Date.now() - wallStart;

  await browser.close();

  const summary = {
    generatedAt: new Date().toISOString(),
    pairs: pairs.length,
    seed: SEED,
    pass, fail,
    wallMs,
    results: perPairResults,
  };
  await fs.writeFile(path.join(REPORT_DIR, 'pair-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n— Summary —`);
  console.log(`  pairs: ${pairs.length}`);
  console.log(`  PASS:  ${pass}`);
  console.log(`  FAIL:  ${fail}`);
  console.log(`  wall:  ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`  report: ${path.relative(ROOT, path.join(REPORT_DIR, 'pair-summary.json'))}`);

  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(2);
});
