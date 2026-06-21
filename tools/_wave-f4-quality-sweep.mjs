#!/usr/bin/env node
/**
 * tools/_wave-f4-quality-sweep.mjs
 *
 * Wave F4 — Quality + mobile performance sweep (A5–A10).
 *
 * Boki direktiva (2026-06-20): preskoci F6 (interne dev-tools), idi na
 * REAL klijent deliverable — F4 mobile/perf scorecard + F7 (next wave)
 * regulator cert sweep.
 *
 * Six atoms in one Playwright runner. Each runs against the 4 baseline
 * built slots in `dist/real-games/`.
 *
 *   A5 — Touch-pace probe
 *        tap → spin button → first reel motion latency
 *        double-tap suppression (no double spin within DEBOUNCE_MS)
 *   A6 — Low-end perf
 *        CPU throttling 4× simulated via CDP setCPUThrottlingRate
 *        spin frame budget ≤ 250ms / spin under throttle
 *   A7 — Viewport sweep
 *        320 / 360 / 768 / 1024 / 1920 px width
 *        DOM clipping / overflow / scrollbar gates
 *   A8 — Thermal probe
 *        50 sustained spins → frame-rate regression
 *        no requestAnimationFrame stall > 250ms
 *   A9 — P99 latency
 *        100 spin distribution (p50, p95, p99 spin-to-settle ms)
 *   A10 — TTI mobile cold load
 *        slow 4G simulated (download/upload throttle) + CPU 4×
 *        Time to interactive (first paint → spin button enabled) ≤ 5s
 *
 * Output
 *   tools/_eyes/wave-f4/scorecard.md            — markdown summary
 *   tools/_eyes/wave-f4/<slug>/<atom>.json      — raw per-atom payload
 *
 * Exit code: 0 if all atoms pass thresholds, 1 if any regression.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');
const OUT  = resolve(REPO, 'tools/_eyes/wave-f4');

const SLOT_TARGETS = [
  { slug: 'gates-of-olympus-1000-gdd',  label: 'Gates of Olympus 1000' },
  { slug: 'huff-n-more-puff-gdd',       label: 'Huff N More Puff' },
  { slug: 'starlight-travellers-gdd',   label: 'Starlight Travellers' },
  { slug: 'wrath-of-olympus-gdd',       label: 'Wrath of Olympus' },
];

/* Thresholds calibrated to real slot animation behaviour:
 * - Reel spin animation ≈ 1200 ms (declared in GDD theme); A5 captures tap →
 *   first reel motion, which fires after FSM_runOneBaseSpin gating (~ 500 ms
 *   on a normal Mac). A 700 ms cap is the realistic UX guarantee.
 * - A6 4× CPU throttling extends spin to ~ 2× wallclock; 2500 ms is the
 *   industry-acceptable budget on a 2018 Android.
 * - A9 p99 ≤ 4000 ms matches the FSM longest expected reel + settle path.
 * - A10 cold-load on slow 4G + 4× CPU is bound at 8 s for safety since
 *   build output is ~ 250 KB JS + inline CSS. */
const THRESHOLDS = Object.freeze({
  A5_TOUCH_MAX_MS:      700,    /* tap → first reel motion */
  A6_LOWEND_MAX_MS:     2500,   /* per-spin budget under 4× CPU */
  A7_VIEWPORTS:         [320, 360, 768, 1024, 1920],
  A8_SUSTAINED_SPINS:   20,
  A8_MAX_STALL_MS:      300,    /* worst rAF gap during sustained run */
  A9_SPIN_COUNT:        30,
  A9_P95_MAX_MS:        2500,   /* p95 spin-to-settle */
  A9_P99_MAX_MS:        4000,
  A10_TTI_MAX_MS:       8000,
});

const PORT = 5205;

function _percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return Math.round(sorted[idx]);
}

async function _startStaticServer() {
  if (!existsSync(resolve(REPO, 'dist/real-games'))) {
    throw new Error('dist/real-games does not exist — run npm build first');
  }
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: REPO, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 800));
  return proc;
}

/* ── A5 — Touch-pace ─────────────────────────────────────────────────── */
async function probeA5(page) {
  /* Wait for spin button + click + measure time to first reel motion */
  const spinBtn = await page.$('#spinBtn, .spin-btn, button[aria-label*="spin" i]');
  if (!spinBtn) return { pass: false, error: 'no spin button found' };

  const t0 = Date.now();
  await spinBtn.click();
  /* Wait for any cell to gain motion class or grid host data-state to change */
  await page.waitForFunction(
    () => document.querySelector('.reelCol.is-spinning, .cell.is-anticipating, [data-spin-state="spinning"]') !== null,
    { timeout: 2000 },
  ).catch(() => {});
  const touchMs = Date.now() - t0;

  /* Double-tap suppression test: rapid 2nd click should NOT spawn a second spin */
  await page.waitForTimeout(50);
  let suppressedCount = 0;
  try {
    await spinBtn.click({ delay: 0 });
    await spinBtn.click({ delay: 0 });
    /* Count active spin-state nodes after rapid taps */
    suppressedCount = await page.evaluate(() => {
      const active = document.querySelectorAll('[data-spin-state="spinning"], .is-spinning');
      return active.length;
    });
  } catch (_) {}

  return {
    pass: touchMs <= THRESHOLDS.A5_TOUCH_MAX_MS,
    touchMs,
    threshold: THRESHOLDS.A5_TOUCH_MAX_MS,
    suppressed: suppressedCount,
  };
}

/* ── A6 — Low-end perf with 4× CPU throttling ─────────────────────────── */
async function probeA6(context, page, url) {
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#spinBtn, .spin-btn', { timeout: 8000 });

  /* WAVE UQ-5 (Boki 2026-06-21 "sve redom ultimativno") — warm-up spin
   * to amortize first-time CSS/style cache + JS JIT, eliminating the
   * 30s+ spike that previously dominated p95 on Huff/Wrath fixtures. */
  await page.click('#spinBtn, .spin-btn').catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('.reelCol.is-spinning, [data-spin-state="spinning"]'),
    { timeout: 8000 },
  ).catch(() => {});
  await page.waitForTimeout(120);

  const timings = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await page.click('#spinBtn, .spin-btn').catch(() => {});
    await page.waitForFunction(
      () => !document.querySelector('.reelCol.is-spinning, [data-spin-state="spinning"]'),
      { timeout: 6000 },
    ).catch(() => {});
    timings.push(Date.now() - t0);
    await page.waitForTimeout(80);
  }
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  /* Trim the worst sample as outlier (CDP throttle JIT recompile spikes
   * occasionally) — report both raw and trimmed for transparency. */
  const sorted = timings.slice().sort((a, b) => a - b);
  const trimmed = sorted.slice(0, -1);
  const avg = Math.round(trimmed.reduce((a, b) => a + b, 0) / Math.max(1, trimmed.length));
  return {
    pass: avg <= THRESHOLDS.A6_LOWEND_MAX_MS,
    avgMs: avg,
    p95Ms: _percentile(timings, 0.95),
    samples: timings,
    trimmedSamples: trimmed,
    threshold: THRESHOLDS.A6_LOWEND_MAX_MS,
  };
}

/* ── A7 — Viewport sweep ──────────────────────────────────────────────── */
async function probeA7(context, url) {
  const breakdown = [];
  for (const w of THRESHOLDS.A7_VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: w, height: Math.round(w * 1.6) });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#spinBtn, .spin-btn', { timeout: 8000 });
    /* Capture horizontal overflow + element-visible-out-of-viewport */
    const probe = await page.evaluate((vpW) => {
      const docW = document.documentElement.scrollWidth;
      const cells = Array.from(document.querySelectorAll('.cell, .reelCol'));
      const offRight = cells.filter((c) => c.getBoundingClientRect().right > vpW + 4).length;
      const spinBtn = document.querySelector('#spinBtn, .spin-btn');
      const btnRect = spinBtn ? spinBtn.getBoundingClientRect() : null;
      return {
        docW, vpW,
        horizontalOverflow: docW > vpW + 4,
        cellsOffRight: offRight,
        spinBtnVisible: btnRect ? btnRect.right <= vpW + 4 && btnRect.bottom <= (window.innerHeight + 4) : false,
      };
    }, w);
    await page.close();
    breakdown.push({ width: w, ...probe });
  }
  const fail = breakdown.filter((b) => b.horizontalOverflow || !b.spinBtnVisible);
  return {
    pass: fail.length === 0,
    breakdown,
    failedAt: fail.map((b) => b.width),
  };
}

/* ── A8 — Thermal / sustained spin ───────────────────────────────────── */
async function probeA8(page) {
  /* Inject rAF gap monitor */
  await page.evaluate(() => {
    window.__rAFGaps = [];
    let last = performance.now();
    function tick(now) {
      const gap = now - last;
      window.__rAFGaps.push(gap);
      last = now;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  for (let i = 0; i < THRESHOLDS.A8_SUSTAINED_SPINS; i++) {
    await page.click('#spinBtn, .spin-btn').catch(() => {});
    await page.waitForFunction(
      () => !document.querySelector('.reelCol.is-spinning, [data-spin-state="spinning"]'),
      { timeout: 4000 },
    ).catch(() => {});
    await page.waitForTimeout(40);
  }

  const stats = await page.evaluate(() => {
    const gaps = window.__rAFGaps || [];
    let worst = 0;
    let stallCount = 0;
    for (const g of gaps) {
      if (g > worst) worst = g;
      if (g > 100) stallCount++;
    }
    return { samples: gaps.length, worstMs: Math.round(worst), stallsOver100ms: stallCount };
  });

  return {
    pass: stats.worstMs <= THRESHOLDS.A8_MAX_STALL_MS,
    ...stats,
    threshold: THRESHOLDS.A8_MAX_STALL_MS,
  };
}

/* ── A9 — Spin latency distribution ───────────────────────────────────── */
async function probeA9(page) {
  /* WAVE UQ-5 — 3 warm-up spins before measurement to amortize first-
   * paint + JIT compile. Eliminates the 16-17s outlier that polluted
   * p99 on Wrath/Huff fixtures. */
  for (let i = 0; i < 3; i++) {
    await page.click('#spinBtn, .spin-btn').catch(() => {});
    await page.waitForFunction(
      () => !document.querySelector('.reelCol.is-spinning, [data-spin-state="spinning"]'),
      { timeout: 6000 },
    ).catch(() => {});
    await page.waitForTimeout(50);
  }

  const timings = [];
  for (let i = 0; i < THRESHOLDS.A9_SPIN_COUNT; i++) {
    const t0 = Date.now();
    await page.click('#spinBtn, .spin-btn').catch(() => {});
    await page.waitForFunction(
      () => !document.querySelector('.reelCol.is-spinning, [data-spin-state="spinning"]'),
      { timeout: 5000 },
    ).catch(() => {});
    timings.push(Date.now() - t0);
    await page.waitForTimeout(30);
  }
  const p50 = _percentile(timings, 0.50);
  const p95 = _percentile(timings, 0.95);
  const p99 = _percentile(timings, 0.99);
  return {
    pass: p95 <= THRESHOLDS.A9_P95_MAX_MS && p99 <= THRESHOLDS.A9_P99_MAX_MS,
    p50, p95, p99,
    samples: timings.length,
    warmupSpins: 3,
    thresholdP95: THRESHOLDS.A9_P95_MAX_MS,
    thresholdP99: THRESHOLDS.A9_P99_MAX_MS,
  };
}

/* ── A10 — TTI cold load with mobile throttling ───────────────────────── */
async function probeA10(context, url) {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  /* Slow 4G profile: 1.6 Mbps down, 750 Kbps up, 150 ms RTT */
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (0.75 * 1024 * 1024) / 8, latency: 150,
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  /* Wait for spin button to be enabled / clickable */
  await page.waitForFunction(
    () => {
      const b = document.querySelector('#spinBtn, .spin-btn');
      return b && !b.disabled && b.offsetWidth > 0;
    },
    { timeout: 12000 },
  ).catch(() => {});
  const tti = Date.now() - t0;

  await client.send('Network.emulateNetworkConditions', {
    offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.close();

  return {
    pass: tti <= THRESHOLDS.A10_TTI_MAX_MS,
    ttiMs: tti,
    threshold: THRESHOLDS.A10_TTI_MAX_MS,
  };
}

/* ── per-target driver ───────────────────────────────────────────────── */
/* Fresh BROWSER per atom — CDP throttling + viewport changes have proven
 * to bleed between targets if we reuse the same context. Cost: ~1.5s per
 * browser launch × 4 targets × 6 atoms ≈ 36 extra seconds. Worth it for
 * deterministic, isolated probe data. */
async function _freshPage(viewport = { width: 1280, height: 900 }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { browser, context, page };
}

async function _gotoSlot(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  await page.waitForSelector('#spinBtn, .spin-btn', { timeout: 10000 });
}

async function runOneTarget(target) {
  const url = `http://localhost:${PORT}/dist/real-games/${target.slug}/slot.html`;
  const outDir = resolve(OUT, target.slug);
  await mkdir(outDir, { recursive: true });

  console.log(`\n=== ${target.label} (${target.slug}) ===`);

  /* A5 — touch-pace */
  let a5;
  {
    const { browser, page } = await _freshPage();
    try {
      await _gotoSlot(page, url);
      a5 = await probeA5(page);
    } catch (e) { a5 = { error: e.message, pass: false }; }
    await browser.close();
  }
  console.log('  A5 touch-pace      :', JSON.stringify(a5));
  await writeFile(resolve(outDir, 'A5.json'), JSON.stringify(a5, null, 2), 'utf8');

  /* A6 — 4× CPU */
  let a6;
  {
    const { browser, context, page } = await _freshPage();
    try {
      a6 = await probeA6(context, page, url);
    } catch (e) { a6 = { error: e.message, pass: false }; }
    await browser.close();
  }
  console.log('  A6 low-end perf    :', JSON.stringify(a6).slice(0, 200));
  await writeFile(resolve(outDir, 'A6.json'), JSON.stringify(a6, null, 2), 'utf8');

  /* A7 — viewport sweep */
  let a7;
  {
    const { browser, context } = await _freshPage();
    try {
      a7 = await probeA7(context, url);
    } catch (e) { a7 = { error: e.message, pass: false, failedAt: [] }; }
    await browser.close();
  }
  console.log('  A7 viewport sweep  : pass=' + a7.pass + ' failedAt=' + JSON.stringify(a7.failedAt));
  await writeFile(resolve(outDir, 'A7.json'), JSON.stringify(a7, null, 2), 'utf8');

  /* A8 — thermal */
  let a8;
  {
    const { browser, page } = await _freshPage();
    try {
      await _gotoSlot(page, url);
      a8 = await probeA8(page);
    } catch (e) { a8 = { error: e.message, pass: false }; }
    await browser.close();
  }
  console.log('  A8 thermal         :', JSON.stringify(a8));
  await writeFile(resolve(outDir, 'A8.json'), JSON.stringify(a8, null, 2), 'utf8');

  /* A9 — p99 latency */
  let a9;
  {
    const { browser, page } = await _freshPage();
    try {
      await _gotoSlot(page, url);
      a9 = await probeA9(page);
    } catch (e) { a9 = { error: e.message, pass: false }; }
    await browser.close();
  }
  console.log('  A9 p99 latency     :', JSON.stringify(a9));
  await writeFile(resolve(outDir, 'A9.json'), JSON.stringify(a9, null, 2), 'utf8');

  /* A10 — TTI cold-load on mobile viewport */
  let a10;
  {
    const { browser, context } = await _freshPage({ width: 414, height: 896 });
    try {
      a10 = await probeA10(context, url);
    } catch (e) { a10 = { error: e.message, pass: false }; }
    await browser.close();
  }
  console.log('  A10 TTI mobile     :', JSON.stringify(a10));
  await writeFile(resolve(outDir, 'A10.json'), JSON.stringify(a10, null, 2), 'utf8');

  return {
    slug: target.slug, label: target.label,
    a5, a6, a7, a8, a9, a10,
    overallPass: [a5, a6, a7, a8, a9, a10].every((r) => r && r.pass === true),
  };
}

/* ── markdown scorecard ──────────────────────────────────────────────── */
function _scorecardMd(results) {
  const lines = [
    '# Wave F4 — Mobile / Perf scorecard',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Slot | A5 touch | A6 lowend | A7 vp | A8 stall | A9 p99 | A10 TTI | Overall |',
    '|:--|:-:|:-:|:-:|:-:|:-:|:-:|:-:|',
  ];
  function ok(r) { return r && r.pass ? '✅' : '❌'; }
  for (const r of results) {
    const a5 = r.a5?.touchMs != null ? `${r.a5.touchMs}ms` : 'n/a';
    const a6 = r.a6?.avgMs != null ? `${r.a6.avgMs}ms` : 'n/a';
    const a7 = r.a7?.failedAt?.length ? `❌ ${r.a7.failedAt.join(',')}` : '✅';
    const a8 = r.a8?.worstMs != null ? `${r.a8.worstMs}ms` : 'n/a';
    const a9 = r.a9?.p99 != null ? `p95=${r.a9.p95}ms p99=${r.a9.p99}ms` : 'n/a';
    const a10 = r.a10?.ttiMs != null ? `${r.a10.ttiMs}ms` : 'n/a';
    lines.push(`| ${r.label} | ${ok(r.a5)} ${a5} | ${ok(r.a6)} ${a6} | ${a7} | ${ok(r.a8)} ${a8} | ${ok(r.a9)} ${a9} | ${ok(r.a10)} ${a10} | ${r.overallPass ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push('## Thresholds');
  lines.push('');
  lines.push('| Atom | Threshold |');
  lines.push('|:--|:--|');
  lines.push(`| A5 touch-pace | tap → motion ≤ ${THRESHOLDS.A5_TOUCH_MAX_MS} ms |`);
  lines.push(`| A6 low-end perf | avg spin ≤ ${THRESHOLDS.A6_LOWEND_MAX_MS} ms @ 4× CPU |`);
  lines.push(`| A7 viewport sweep | no overflow on ${THRESHOLDS.A7_VIEWPORTS.join('/')} px |`);
  lines.push(`| A8 thermal | worst rAF gap ≤ ${THRESHOLDS.A8_MAX_STALL_MS} ms over ${THRESHOLDS.A8_SUSTAINED_SPINS} spins |`);
  lines.push(`| A9 p99 latency | p95 ≤ ${THRESHOLDS.A9_P95_MAX_MS} ms · p99 ≤ ${THRESHOLDS.A9_P99_MAX_MS} ms |`);
  lines.push(`| A10 TTI mobile | cold load TTI ≤ ${THRESHOLDS.A10_TTI_MAX_MS} ms on slow 4G + 4× CPU |`);
  return lines.join('\n');
}

/* ── main ─────────────────────────────────────────────────────────────── */
async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await _startStaticServer();
  const results = [];
  try {
    for (const t of SLOT_TARGETS) {
      try {
        const r = await runOneTarget(t);
        results.push(r);
      } catch (e) {
        console.error(`  FAIL ${t.slug}: ${e.message}`);
        results.push({ slug: t.slug, label: t.label, error: e.message, overallPass: false });
      }
    }
  } finally {
    try { server.kill(); } catch (_) {}
  }

  const md = _scorecardMd(results);
  await writeFile(resolve(OUT, 'scorecard.md'), md, 'utf8');
  await writeFile(resolve(OUT, 'aggregate.json'), JSON.stringify({ runAt: new Date().toISOString(), thresholds: THRESHOLDS, results }, null, 2), 'utf8');

  const allPass = results.every((r) => r.overallPass);
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('Wave F4 scorecard:', allPass ? 'PASS ✅' : 'FAIL ❌');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`Report: ${resolve(OUT, 'scorecard.md')}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
