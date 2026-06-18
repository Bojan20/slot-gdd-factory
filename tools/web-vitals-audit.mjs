#!/usr/bin/env node
/**
 * tools/web-vitals-audit.mjs · Functional Item #7 — Per-block Web Vitals
 * performance budget gates.
 *
 * Where this sits in the perf stack:
 *   • `tools/fps-budget-audit.mjs` — static source scan (rAF shape, CSS
 *     transition duration). NOT a runtime measurement.
 *   • `tools/fps-budget-audit.mjs --strict` — gate, source-level only.
 *   • THIS PROBE — runtime Core Web Vitals (LCP / CLS / TBT-ish) per
 *     demo block, headless Chromium, deterministic budgets.
 *
 * Budgets (Google CWV "good" thresholds, tightened for static demos):
 *   • LCP   ≤ 1500 ms   (slot demos paint a static frame fast)
 *   • CLS   ≤ 0.05      (static demo must NOT shift after first paint)
 *   • TBT   ≤ 150 ms    (no long task should block ≥ 50 ms during boot)
 *   • Boot  ≤ 1500 ms   (DOMContentLoaded → load completion)
 *
 * Method:
 *   For each `blocks/demos/<name>.html`:
 *     1. Boot in Chromium at 1280×800. CPU throttled 2× to approximate
 *        a mid-tier laptop (regulator submission realism).
 *     2. Install PerformanceObserver for paint, lcp, layout-shift,
 *        longtask BEFORE goto. Buffered: true → catches early entries.
 *     3. goto(waitUntil=load), then 800 ms idle to let CLS finalize.
 *     4. Pull observer results, compute final metrics.
 *     5. Compare each metric against budget, mark PASS/FAIL.
 *
 * Exit codes:
 *   0  every demo within budget (or --report mode)
 *   1  one or more demos over budget AND --strict
 *   2  Chromium fatal / demos missing
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const DEMOS_DIR = resolve(REPO, 'blocks/demos');
const OUT_DIR = resolve(REPO, 'dist/web-vitals');

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict') || argv.includes('--fail-on-violation');
const QUIET = argv.includes('--quiet');

const BUDGET = {
  lcp_ms:  1500,
  cls:     0.05,
  tbt_ms:  150,
  boot_ms: 1500,
};

const bar = (ch = '─', n = 100) => ch.repeat(n);
const log = (...m) => { if (!QUIET) console.log(...m); };

if (!existsSync(DEMOS_DIR)) {
  console.error(`❌ ${DEMOS_DIR} missing.`); process.exit(2);
}
const demos = readdirSync(DEMOS_DIR)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .sort();
if (demos.length === 0) {
  console.error('❌ no demos'); process.exit(2);
}

log(bar('═'));
log(`⚡ Web Vitals audit · ${demos.length} demo(s) · budgets LCP≤${BUDGET.lcp_ms}ms · CLS≤${BUDGET.cls} · TBT≤${BUDGET.tbt_ms}ms · Boot≤${BUDGET.boot_ms}ms`);
log(`   mode: ${STRICT ? 'STRICT (fail on violation)' : 'REPORT'}`);
log(bar('═'));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const cdp = await ctx.newCDPSession(await ctx.newPage().then(async (p) => { return p; }));
/* Throttle CPU to 2× slowdown — approximates the mid-tier mobile/laptop
 * a regulator auditor might run against. Without throttle, modern dev
 * machines paint these tiny demos at < 100 ms LCP which is unrealistic. */
try { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 }); } catch {}

const results = [];

for (const file of demos) {
  const name = basename(file, '.html');
  const abs = resolve(DEMOS_DIR, file);
  const page = await ctx.newPage();

  /* Install observers in init-script BEFORE navigation so buffered
   * entries from page boot are captured. Without addInitScript the
   * observer registers after load and misses the LCP entry. */
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0, longTasks: [], paint: {} };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__vitals.lcp = Math.max(window.__vitals.lcp, e.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__vitals.cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__vitals.longTasks.push({ start: e.startTime, dur: e.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__vitals.paint[e.name] = e.startTime;
      }).observe({ type: 'paint', buffered: true });
    } catch {}
  });

  const bootStart = Date.now();
  let bootMs = 0;
  let stage = 'goto';
  let vitals = null;

  try {
    await page.goto(pathToFileURL(abs).href, { waitUntil: 'load', timeout: 10_000 });
    bootMs = Date.now() - bootStart;
    stage = 'cls-settle';
    /* CLS observer needs idle time to record post-load shifts. */
    await page.waitForTimeout(800);
    stage = 'collect';
    vitals = await page.evaluate(() => window.__vitals);
  } catch (err) {
    log(`  ! ${name.padEnd(40)} stage=${stage} ${err.message}`);
    results.push({ name, ok: false, error: err.message, stage });
    await page.close();
    continue;
  }
  await page.close();

  /* Total Blocking Time = sum of (longtask.dur - 50) for tasks >50 ms. */
  const tbt = vitals.longTasks.reduce((acc, t) => acc + Math.max(0, t.dur - 50), 0);
  const lcp = Math.round(vitals.lcp);
  const cls = +vitals.cls.toFixed(4);

  const checks = [
    { id: 'lcp',  ok: lcp  <= BUDGET.lcp_ms,  v: `${lcp}ms`,  budget: `${BUDGET.lcp_ms}ms` },
    { id: 'cls',  ok: cls  <= BUDGET.cls,     v: `${cls}`,    budget: `${BUDGET.cls}` },
    { id: 'tbt',  ok: tbt  <= BUDGET.tbt_ms,  v: `${Math.round(tbt)}ms`, budget: `${BUDGET.tbt_ms}ms` },
    { id: 'boot', ok: bootMs <= BUDGET.boot_ms, v: `${bootMs}ms`, budget: `${BUDGET.boot_ms}ms` },
  ];
  const ok = checks.every((c) => c.ok);
  const breach = checks.filter((c) => !c.ok).map((c) => `${c.id}=${c.v}>${c.budget}`).join(' ');
  log(`  ${ok ? '✓' : '✗'} ${name.padEnd(40)} LCP=${lcp}ms CLS=${cls} TBT=${Math.round(tbt)}ms Boot=${bootMs}ms ${breach ? '· ' + breach : ''}`);

  results.push({ name, ok, lcp, cls, tbt: Math.round(tbt), bootMs, checks });
}

await ctx.close();
await browser.close();

/* persist */
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'report.json'), JSON.stringify({ budget: BUDGET, generated_at: new Date().toISOString(), results }, null, 2));

/* summary */
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
const byMetric = { lcp: 0, cls: 0, tbt: 0, boot: 0 };
for (const r of results) {
  if (!r.checks) continue;
  for (const c of r.checks) if (!c.ok) byMetric[c.id]++;
}

log(`\n${bar('═')}`);
log('SUMMARY · Web Vitals budget gate');
log(bar('═'));
log(`  Demos passing budget    : ${pass}/${results.length}`);
log(`  Demos over budget       : ${fail}`);
log(`  Per-metric breach count : LCP=${byMetric.lcp}  CLS=${byMetric.cls}  TBT=${byMetric.tbt}  Boot=${byMetric.boot}`);
log(`  Artifacts               : dist/web-vitals/report.json`);

process.exit(fail > 0 && STRICT ? 1 : 0);
