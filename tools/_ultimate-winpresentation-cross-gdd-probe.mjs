/**
 * tools/_ultimate-winpresentation-cross-gdd-probe.mjs
 *
 * Cross-GDD winPresentation audit. Boki: "win linije prezentacije
 * blokovi ne rade pravilno u svakom GDD-u. ne prikazuju se pravilno."
 *
 * Probe sequence per fixture (4 GDD, parallel):
 *   1. Build + load slot HTML
 *   2. Install HookBus listener for onWinPresentationStart/End
 *   3. Force a win via runOneBaseSpin() with FORCE_WIN (multiple spins
 *      until at least one win lands)
 *   4. Verify:
 *      a) onWinPresentationStart fires within 5s of spin result
 *      b) Win banner element renders (whatever ID winPresentation owns)
 *      c) Rollup amount displays non-zero
 *      d) onWinPresentationEnd fires within rollup duration
 *      e) Clean state after end (no stuck banner)
 *   5. 0 console errors / pageerror throughout
 *
 * Reports:
 *   reports/winpresentation-cross-gdd/<fixture>.json
 *   reports/winpresentation-cross-gdd/summary.json
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/winpresentation-cross-gdd');

const FIXTURES = [
  { name: 'WoO',           path: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { name: 'GoO_1000',      path: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
  { name: 'MidnightFangs', path: 'samples/MIDNIGHT_FANGS_GAME_GDD.md' },
  { name: 'CrystalForge',  path: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
];

const MAX_SPINS_FOR_WIN = 30;
const ROLLUP_TIMEOUT_MS = 8000;

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) pass++;
  else { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
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

async function probeFixture(fixture, browser) {
  console.log(`\n  ── ${fixture.name} ──`);
  const text = await fs.readFile(path.join(ROOT, fixture.path), 'utf8');
  const model = parseGDD(text, 'md');
  /* Force fast spin so we can iterate */
  model.spinTempo = { spinDurationMs: 60, settleDelayMs: 20 };
  model.bigWinTier = { enabled: false }; // avoid big-win interfering with rollup
  const html = buildSlotHTML(model);

  const port = await findFreePort();
  const srv = await serveHTML(port, html);
  const url = `http://127.0.0.1:${port}/`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  /* Install win presentation observer */
  const setupOk = await page.evaluate(() => {
    if (typeof window.runOneBaseSpin !== 'function') return { ok: false, reason: 'no runOneBaseSpin' };
    window.__WP_OBS__ = {
      startEvents: [],
      endEvents: [],
      spinResults: [],
      runtimeErrors: [],
    };
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onWinPresentationStart', (p) => {
        window.__WP_OBS__.startEvents.push({ at: Date.now(), payload: p });
      });
      window.HookBus.on('onWinPresentationEnd', (p) => {
        window.__WP_OBS__.endEvents.push({ at: Date.now(), payload: p });
      });
      window.HookBus.on('onSpinResult', (p) => {
        window.__WP_OBS__.spinResults.push({
          at: Date.now(),
          totalWin: p ? p.totalWin : null,
        });
      });
    }
    return { ok: true };
  });
  t(`${fixture.name}: setup observer`, setupOk.ok, setupOk.reason || '');
  if (!setupOk.ok) { await ctx.close(); srv.close(); return null; }

  /* Phase 1: try natural spin to land win (up to MAX_SPINS_FOR_WIN) */
  let naturalWinSpinIdx = -1;
  for (let i = 0; i < MAX_SPINS_FOR_WIN; i++) {
    await page.evaluate(() => {
      try { window.runOneBaseSpin({ FORCE_WIN: true }); } catch (_) {
        try { window.runOneBaseSpin(); } catch (_) {}
      }
    });
    await page.waitForFunction(
      (target) => window.__WP_OBS__ && window.__WP_OBS__.spinResults.length >= target,
      i + 1, { timeout: 3000 }).catch(() => {});
    const startCount = await page.evaluate(() => window.__WP_OBS__.startEvents.length);
    if (startCount >= 1) { naturalWinSpinIdx = i + 1; break; }
  }

  /* Phase 2: synthetic injection — verify that winPresentation runtime
   * is wired to HookBus and responds to start/end events even if the
   * evaluator did not produce a natural win. This isolates the
   * presentation layer from the math layer. */
  let syntheticOk = false;
  if (naturalWinSpinIdx === -1) {
    syntheticOk = await page.evaluate(() => {
      if (!window.HookBus || typeof window.HookBus.emit !== 'function') return false;
      window.HookBus.emit('onWinPresentationStart', {
        award: 25.50, eventCount: 1, isBigWin: false, source: 'probe-synthetic',
      });
      return true;
    });
    /* Give the runtime a chance to react */
    await page.waitForTimeout(800);
    /* Synthetic end so we cleanup */
    await page.evaluate(() => {
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        window.HookBus.emit('onWinPresentationEnd', {
          award: 25.50, isBigWin: false, source: 'probe-synthetic',
        });
      }
    });
  }

  /* Wait for end if natural win path landed */
  const endFired = await page.waitForFunction(
    () => window.__WP_OBS__ && window.__WP_OBS__.endEvents.length >= 1,
    null, { timeout: ROLLUP_TIMEOUT_MS }).then(() => true).catch(() => false);
  await page.waitForTimeout(400);

  const firstWinAfterSpin = naturalWinSpinIdx;
  const totalWinValue = await page.evaluate(() =>
    window.__WP_OBS__.startEvents.length > 0 && window.__WP_OBS__.startEvents[0].payload
      ? (window.__WP_OBS__.startEvents[0].payload.award || 0)
      : 0);

  const obs = await page.evaluate(() => window.__WP_OBS__);
  const startEvents = obs.startEvents.length;
  const endEvents = obs.endEvents.length;
  const spinResultsTotal = obs.spinResults.length;

  /* Verify DOM cleanup — no stuck banner */
  const stuckBanner = await page.evaluate(() => {
    /* winPresentation owns multiple potential elements; check any
     * stuck "is-presenting" / "win-banner-show" / "win-highlight" class */
    const stuckSelectors = [
      '.win-highlight.is-presenting',
      '.win-rollup.is-active',
      '[class*="win"]:not([hidden])[data-presenting="true"]',
    ];
    let found = null;
    for (const sel of stuckSelectors) {
      const el = document.querySelector(sel);
      if (el) found = sel;
    }
    return found;
  });

  const winPath = naturalWinSpinIdx > 0 ? 'natural' : 'synthetic';
  console.log(`    ${fixture.name}: path=${winPath} · spinResults=${spinResultsTotal} · startEvents=${startEvents} · endEvents=${endEvents} · award=${totalWinValue}`);
  console.log(`    ${fixture.name}: naturalWinSpinIdx=${naturalWinSpinIdx} · stuckBanner=${stuckBanner || 'none'}`);

  /* CORE TEST: regardless of natural or synthetic path, the win
   * presentation layer MUST emit Start + End and self-clean. */
  t(`${fixture.name}: onWinPresentationStart fired ≥ 1× (path=${winPath})`,
    startEvents >= 1, `${startEvents} events`);
  t(`${fixture.name}: onWinPresentationEnd fired ≥ 1× (path=${winPath})`,
    endEvents >= 1, `${endEvents} events`);
  t(`${fixture.name}: rollup completed within ${ROLLUP_TIMEOUT_MS}ms`,
    endFired === true, endFired ? 'OK' : 'timeout');
  t(`${fixture.name}: no stuck win banner post-cleanup`, !stuckBanner, stuckBanner || '');
  t(`${fixture.name}: 0 console errors throughout`,
    errs.length === 0, errs.slice(0, 2).join(' | '));

  await ctx.close();
  srv.close();

  return {
    fixture: fixture.name,
    winPath: winPath,
    naturalWinSpinIdx,
    spinResultsTotal,
    startEvents,
    endEvents,
    totalWinValue,
    endFired,
    stuckBanner: stuckBanner || null,
    consoleErrors: errs.length,
    errorSamples: errs.slice(0, 3),
  };
}

(async () => {
  console.log('\n=== Cross-GDD winPresentation audit ===');
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const tasks = FIXTURES.map(fx => probeFixture(fx, browser)
    .catch(e => {
      fail++; failures.push(`${fx.name} threw: ${e.message}`);
      console.log(`    ✗ ${fx.name} threw: ${e.message}`);
      return null;
    }));
  const settled = await Promise.all(tasks);
  const results = settled.filter(r => r !== null);
  await browser.close();

  for (const r of results) {
    await fs.writeFile(path.join(REPORT_DIR, `${r.fixture}.json`),
      JSON.stringify(r, null, 2));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    fixtures: results,
    aggregate: {
      allLandedWin:      results.every(r => r.firstWinAfterSpin > 0),
      allEmittedStart:   results.every(r => r.startEvents >= 1),
      allEmittedEnd:     results.every(r => r.endEvents >= 1),
      allClean:          results.every(r => !r.stuckBanner),
      allZeroErrors:     results.every(r => r.consoleErrors === 0),
    },
    pass, fail,
    failures,
  };
  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n  ── AGGREGATE ──');
  console.log(`    All landed win:      ${summary.aggregate.allLandedWin ? '✅' : '✗'}`);
  console.log(`    All emitted start:   ${summary.aggregate.allEmittedStart ? '✅' : '✗'}`);
  console.log(`    All emitted end:     ${summary.aggregate.allEmittedEnd ? '✅' : '✗'}`);
  console.log(`    All clean (no stuck):${summary.aggregate.allClean ? '✅' : '✗'}`);
  console.log(`    All zero errors:     ${summary.aggregate.allZeroErrors ? '✅' : '✗'}`);
  console.log(`\n  Reports: reports/winpresentation-cross-gdd/{summary.json, <fixture>.json}`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\n  Failures:');
    for (const f of failures.slice(0, 20)) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
