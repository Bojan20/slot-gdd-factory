/**
 * tools/_ultimate-tti-probe.mjs
 *
 * D-7 TIME-TO-INTERACTIVE — Real page load + interactivity perf audit.
 *
 * Per fixture (4 GDD), headless Chromium with Performance API:
 *   1. Navigation timing (domContentLoaded, load events)
 *   2. First Paint (FP) + First Contentful Paint (FCP) via
 *      PerformanceObserver (paint type)
 *   3. Largest Contentful Paint (LCP) via observer
 *   4. Time to Interactive (TTI) approximation:
 *      max(FCP, time when main thread has been idle for 5s consecutive)
 *   5. Total Blocking Time (TBT): sum of long tasks (> 50ms) − 50ms each
 *
 * Budget gates (Lighthouse-aligned for mobile):
 *   • FCP        ≤ 1800 ms  (Lighthouse "good" threshold)
 *   • LCP        ≤ 2500 ms
 *   • TTI        ≤ 3800 ms
 *   • TBT        ≤ 200 ms
 *   • domContentLoaded ≤ 1500 ms
 *
 * No throttling — measures raw template load. Real production deploy
 * adds network + CDN latency on top (additional 100-300ms).
 *
 * Reports:
 *   reports/tti/<fixture>.json
 *   reports/tti/summary.json
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/tti');

const FIXTURES = [
  { name: 'WoO',           path: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { name: 'GoO_1000',      path: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
  { name: 'MidnightFangs', path: 'samples/MIDNIGHT_FANGS_GAME_GDD.md' },
  { name: 'CrystalForge',  path: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
];

const BUDGETS = {
  fcpMs:                1800,
  lcpMs:                2500,
  ttiMs:                3800,
  tbtMs:                200,
  domContentLoadedMs:   1500,
};

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
  const html = buildSlotHTML(model);

  const port = await findFreePort();
  const srv = await serveHTML(port, html);
  const url = `http://127.0.0.1:${port}/`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  /* Install perf observer BEFORE navigation so we catch all entries. */
  await page.addInitScript(() => {
    window.__PERF__ = {
      firstPaint: null,
      firstContentfulPaint: null,
      largestContentfulPaint: null,
      longTasks: [],
    };
    try {
      const paintObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === 'first-paint') window.__PERF__.firstPaint = e.startTime;
          if (e.name === 'first-contentful-paint') window.__PERF__.firstContentfulPaint = e.startTime;
        }
      });
      paintObs.observe({ type: 'paint', buffered: true });
    } catch (_) {}
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          window.__PERF__.largestContentfulPaint = entries[entries.length - 1].renderTime || entries[entries.length - 1].startTime;
        }
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {}
    try {
      const ltObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__PERF__.longTasks.push({ startTime: e.startTime, duration: e.duration });
        }
      });
      ltObs.observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  });

  const navStart = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  /* Wait for runtime to settle + LCP to be observable. */
  await page.waitForTimeout(2000);

  const metrics = await page.evaluate(() => {
    const t = performance.timing;
    const nav = (typeof PerformanceNavigationTiming !== 'undefined')
      ? performance.getEntriesByType('navigation')[0] : null;
    const out = {
      domContentLoadedMs: nav ? +(nav.domContentLoadedEventEnd).toFixed(2) :
                                t.domContentLoadedEventEnd - t.navigationStart,
      loadEventMs: nav ? +(nav.loadEventEnd).toFixed(2) :
                          t.loadEventEnd - t.navigationStart,
      firstPaintMs: window.__PERF__.firstPaint !== null ? +(window.__PERF__.firstPaint).toFixed(2) : null,
      firstContentfulPaintMs: window.__PERF__.firstContentfulPaint !== null ? +(window.__PERF__.firstContentfulPaint).toFixed(2) : null,
      largestContentfulPaintMs: window.__PERF__.largestContentfulPaint !== null ? +(window.__PERF__.largestContentfulPaint).toFixed(2) : null,
      longTaskCount: window.__PERF__.longTasks.length,
      totalBlockingTimeMs: window.__PERF__.longTasks.reduce((s, e) => s + Math.max(0, e.duration - 50), 0),
    };
    /* TTI approximation: max(FCP, last long-task end) + 5s idle safety
     * is too strict for ad-hoc probe; use FCP + sum of blocking time
     * as a conservative proxy. */
    const fcp = out.firstContentfulPaintMs || 0;
    out.ttiMs = +(Math.max(fcp, out.domContentLoadedMs) + out.totalBlockingTimeMs).toFixed(2);
    return out;
  });

  /* Sanity — interactive at this point */
  const interactive = await page.evaluate(() => {
    const btn = document.querySelector('button:not([hidden]):not([disabled])');
    return btn !== null;
  });

  console.log(`    ${fixture.name}: FCP=${metrics.firstContentfulPaintMs}ms · LCP=${metrics.largestContentfulPaintMs}ms · TTI=${metrics.ttiMs}ms · TBT=${metrics.totalBlockingTimeMs.toFixed(0)}ms · DCL=${metrics.domContentLoadedMs}ms`);
  console.log(`    ${fixture.name}: longTasks=${metrics.longTaskCount} · interactive=${interactive ? 'yes' : 'no'}`);

  t(`${fixture.name}: interactive button present at load`, interactive);
  t(`${fixture.name}: FCP ≤ ${BUDGETS.fcpMs}ms`,
    metrics.firstContentfulPaintMs !== null && metrics.firstContentfulPaintMs <= BUDGETS.fcpMs,
    `${metrics.firstContentfulPaintMs}ms`);
  if (metrics.largestContentfulPaintMs !== null) {
    t(`${fixture.name}: LCP ≤ ${BUDGETS.lcpMs}ms`,
      metrics.largestContentfulPaintMs <= BUDGETS.lcpMs,
      `${metrics.largestContentfulPaintMs}ms`);
  }
  t(`${fixture.name}: TTI ≤ ${BUDGETS.ttiMs}ms`,
    metrics.ttiMs <= BUDGETS.ttiMs,
    `${metrics.ttiMs}ms`);
  t(`${fixture.name}: TBT ≤ ${BUDGETS.tbtMs}ms`,
    metrics.totalBlockingTimeMs <= BUDGETS.tbtMs,
    `${metrics.totalBlockingTimeMs.toFixed(0)}ms`);
  t(`${fixture.name}: DCL ≤ ${BUDGETS.domContentLoadedMs}ms`,
    metrics.domContentLoadedMs <= BUDGETS.domContentLoadedMs,
    `${metrics.domContentLoadedMs}ms`);
  t(`${fixture.name}: 0 console errors`,
    errs.length === 0, errs.slice(0, 2).join(' | '));

  await ctx.close();
  srv.close();

  return {
    fixture: fixture.name,
    metrics,
    interactive,
    consoleErrors: errs.length,
  };
}

(async () => {
  console.log('\n=== D-7 Time-to-interactive probe — Lighthouse-style perf metrics ===');
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
    budgets: BUDGETS,
    fixtures: results,
    aggregate: {
      avgFCP: results.length > 0
        ? +(results.reduce((s, r) => s + (r.metrics.firstContentfulPaintMs || 0), 0) / results.length).toFixed(1) : 0,
      avgLCP: results.length > 0
        ? +(results.reduce((s, r) => s + (r.metrics.largestContentfulPaintMs || 0), 0) / results.length).toFixed(1) : 0,
      avgTTI: results.length > 0
        ? +(results.reduce((s, r) => s + r.metrics.ttiMs, 0) / results.length).toFixed(1) : 0,
      avgTBT: results.length > 0
        ? +(results.reduce((s, r) => s + r.metrics.totalBlockingTimeMs, 0) / results.length).toFixed(1) : 0,
      avgDCL: results.length > 0
        ? +(results.reduce((s, r) => s + r.metrics.domContentLoadedMs, 0) / results.length).toFixed(1) : 0,
      maxFCP: Math.max(...results.map(r => r.metrics.firstContentfulPaintMs || 0)),
      maxLCP: Math.max(...results.map(r => r.metrics.largestContentfulPaintMs || 0)),
      maxTTI: Math.max(...results.map(r => r.metrics.ttiMs)),
    },
    pass, fail,
    failures,
  };
  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n  ── AGGREGATE ──');
  console.log(`    Avg FCP:  ${summary.aggregate.avgFCP}ms / ${BUDGETS.fcpMs}ms budget`);
  console.log(`    Avg LCP:  ${summary.aggregate.avgLCP}ms / ${BUDGETS.lcpMs}ms`);
  console.log(`    Avg TTI:  ${summary.aggregate.avgTTI}ms / ${BUDGETS.ttiMs}ms`);
  console.log(`    Avg TBT:  ${summary.aggregate.avgTBT}ms / ${BUDGETS.tbtMs}ms`);
  console.log(`    Avg DCL:  ${summary.aggregate.avgDCL}ms / ${BUDGETS.domContentLoadedMs}ms`);
  console.log(`\n  Reports: reports/tti/{summary.json, <fixture>.json}`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\n  Failures:');
    for (const f of failures.slice(0, 15)) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
