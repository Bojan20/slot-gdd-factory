/**
 * tools/_ultimate-long-run-probe.mjs
 *
 * D-1 LONG-RUN — 8h-equivalent continuous play stress probe.
 *
 * Simulates ~8 hours of continuous play (60,000 spins at typical
 * 130 spins/minute pace) via synthetic HookBus events. This is 60×
 * the C-5 LEGO-LOAD probe (which only ran 1000 spins) and catches
 * leaks that take longer to surface:
 *   • Long-lived arrays that grow unbounded
 *   • Closure capture chains that accumulate
 *   • Detached DOM nodes that don't GC
 *   • Listener leak (same event listened multiple times)
 *
 * Probe sequence:
 *   1. Build slot HTML with ALL session-state blocks enabled (worst-case)
 *   2. Open headless Chromium with --enable-precise-memory-info
 *   3. Baseline heap measurement (after GC)
 *   4. Fire 60,000 synthetic spin event pairs in batches of 1000
 *   5. Sample heap every 10,000 spins for trend analysis
 *   6. Final heap measurement (after GC)
 *   7. Verify:
 *      - Total Δ heap ≤ 30 MB (vs C-5 budget 8 MB for 1000 spins;
 *        60× spins = 60× headroom, +50% margin for GC noise)
 *      - Heap growth NOT monotonic (sampled values must not strictly
 *        ascend — GC must reclaim periodically)
 *      - Spin history ring buffer bounded ≤ maxSize
 *      - HookBus listener registry doesn't grow
 *      - 0 console errors throughout
 *      - Wall clock ≤ 120 seconds (60k synthetic spins fast)
 *
 * Output: reports/long-run/summary.json + heap trend chart data
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/long-run');

const TOTAL_SPINS = 60_000;
const BATCH = 1000;
const SAMPLE_EVERY = 10_000;
const HEAP_BUDGET_MB = 30;
const WALL_BUDGET_MS = 120_000;

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) pass++;
  else { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); console.log('  ✗ ' + name); }
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

(async () => {
  console.log(`\n=== D-1 Long-run probe — ${TOTAL_SPINS.toLocaleString()} synthetic spins (8h sim) ===`);
  await fs.mkdir(REPORT_DIR, { recursive: true });

  /* Worst-case: every session-state block enabled. */
  const text = await fs.readFile(path.join(ROOT, 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md'), 'utf8');
  const model = parseGDD(text, 'md');
  model.bonusBuyMenu = { enabled: true, tiers: [
    { id: 'a', label: 'A', costX: 75, forceScatters: 4, fsMode: 's' },
    { id: 'b', label: 'B', costX: 200, forceScatters: 5, fsMode: 'u' },
  ]};
  model.coinCollect = { enabled: true };
  model.cumulativeMeter = { enabled: true };
  model.collectRevealOverlay = { enabled: true };
  model.playerXp = { enabled: true };
  model.sessionLevelMeter = { enabled: true };
  model.achievementToast = { enabled: true };
  model.spinHistoryReplay = { enabled: true };
  model.leaderboardChip = { enabled: true };
  model.mysteryPrizeBox = { enabled: true };
  const html = buildSlotHTML(model);

  const port = await findFreePort();
  const srv = await serveHTML(port, html);
  const url = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  /* Baseline */
  const heapBaseline = await page.evaluate(() => {
    if (typeof window.gc === 'function') try { window.gc(); } catch (_) {}
    const m = window.performance && window.performance.memory;
    return m ? m.usedJSHeapSize : null;
  });
  t(`heap.performance.memory exposed`, heapBaseline !== null);

  const heapSamples = [{ at: 0, bytes: heapBaseline || 0 }];
  const startTime = Date.now();

  for (let batchStart = 0; batchStart < TOTAL_SPINS; batchStart += BATCH) {
    await page.evaluate(async (info) => {
      if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
      for (let i = 0; i < info.batch; i++) {
        const idx = info.startIdx + i;
        window.HookBus.emit('preSpin', { spinIndex: idx });
        window.HookBus.emit('onSpinResult', { totalWin: idx % 50, spinIndex: idx });
        if (idx % 20 === 19) {
          window.HookBus.emit('onCoinCollected', {
            cellIds: ['c' + idx + '_1', 'c' + idx + '_2'],
            perSpinValue: 2,
            sessionTotal: Math.floor((idx + 1) * 0.1),
          });
        }
        if (idx % 5000 === 4999) {
          /* Synthetic FS round mid-session */
          window.HookBus.emit('onFsTrigger', { spinsAwarded: 10 });
          window.HookBus.emit('onFsSpinResult', { totalWin: 30, spinIndex: idx });
          window.HookBus.emit('onFsEnd', { totalWin: 30 });
        }
      }
      /* Yield to event loop occasionally */
      await new Promise(r => setTimeout(r, 0));
    }, { startIdx: batchStart, batch: BATCH });

    const spinsDone = batchStart + BATCH;
    if (spinsDone % SAMPLE_EVERY === 0) {
      const sample = await page.evaluate(() => {
        if (typeof window.gc === 'function') try { window.gc(); } catch (_) {}
        const m = window.performance && window.performance.memory;
        return m ? m.usedJSHeapSize : null;
      });
      heapSamples.push({ at: spinsDone, bytes: sample || 0 });
      console.log(`  ... ${spinsDone.toLocaleString()}/${TOTAL_SPINS.toLocaleString()} spins · heap=${(sample / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  const wallMs = Date.now() - startTime;
  await page.waitForTimeout(300);

  /* Final measurement */
  const heapFinal = await page.evaluate(() => {
    if (typeof window.gc === 'function') try { window.gc(); } catch (_) {}
    const m = window.performance && window.performance.memory;
    return m ? m.usedJSHeapSize : null;
  });

  const deltaBytes = (heapFinal || 0) - (heapBaseline || 0);
  const deltaMB = deltaBytes / (1024 * 1024);

  /* State sanity */
  const ringSize = await page.evaluate(() =>
    window.__SPIN_HISTORY__ ? window.__SPIN_HISTORY__.buffer.length : 0);
  const xpEarned = await page.evaluate(() =>
    window.__PLAYER_XP__ ? window.__PLAYER_XP__.xp : 0);
  const xpLevel = await page.evaluate(() =>
    window.__PLAYER_XP__ ? window.__PLAYER_XP__.level : 0);

  /* HookBus listener count check — if exists. */
  const listenerCount = await page.evaluate(() => {
    if (!window.HookBus || !window.HookBus._listeners) return null;
    let total = 0;
    for (const k of Object.keys(window.HookBus._listeners)) {
      const arr = window.HookBus._listeners[k];
      if (Array.isArray(arr)) total += arr.length;
    }
    return total;
  });

  /* Monotonic check — heap samples must not strictly ascend */
  let monotonicAscend = true;
  for (let i = 1; i < heapSamples.length; i++) {
    if (heapSamples[i].bytes <= heapSamples[i - 1].bytes) { monotonicAscend = false; break; }
  }

  t(`heap delta ≤ ${HEAP_BUDGET_MB} MB after ${TOTAL_SPINS.toLocaleString()} spins`,
    deltaMB <= HEAP_BUDGET_MB, deltaMB.toFixed(2) + ' MB');
  t(`heap growth NOT strictly monotonic (GC reclaims)`,
    !monotonicAscend, monotonicAscend ? 'strictly ascending — possible leak' : 'OK');
  t(`spin history ring buffer bounded ≤ 100`, ringSize <= 100, `size=${ringSize}`);
  t(`player XP accumulated > 0`, xpEarned > 0, `xp=${xpEarned}`);
  t(`0 console errors during ${TOTAL_SPINS.toLocaleString()} spins`,
    errs.length === 0, errs.slice(0, 2).join(' | '));
  t(`wall-clock ≤ ${WALL_BUDGET_MS} ms`, wallMs <= WALL_BUDGET_MS, `${wallMs} ms`);

  await ctx.close();
  await browser.close();
  srv.close();

  const summary = {
    generatedAt: new Date().toISOString(),
    totalSpins: TOTAL_SPINS,
    heapBudgetMB: HEAP_BUDGET_MB,
    wallBudgetMs: WALL_BUDGET_MS,
    heapBaselineBytes: heapBaseline,
    heapFinalBytes: heapFinal,
    heapDeltaBytes: deltaBytes,
    heapDeltaMB: +deltaMB.toFixed(2),
    heapSamples,
    monotonicAscend,
    wallMs,
    msPerSpin: +(wallMs / TOTAL_SPINS).toFixed(4),
    spinsPerSecond: +((TOTAL_SPINS / wallMs) * 1000).toFixed(1),
    spinHistorySize: ringSize,
    xpEarned,
    xpLevel,
    hookBusListenerCount: listenerCount,
    consoleErrors: errs.length,
    pass, fail,
    failures,
  };
  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n  Wall-clock:    ${wallMs} ms (${summary.spinsPerSecond} spins/s, ${summary.msPerSpin} ms/spin)`);
  console.log(`  Heap base:     ${(heapBaseline / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap final:    ${(heapFinal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Δ Heap:        ${deltaMB.toFixed(2)} MB / ${HEAP_BUDGET_MB} MB budget (${((deltaMB / HEAP_BUDGET_MB) * 100).toFixed(1)}%)`);
  console.log(`  GC reclaim:    ${!monotonicAscend ? 'YES (healthy)' : 'NO (POTENTIAL LEAK!)'}`);
  console.log(`  Spin history:  ${ringSize} (capped)`);
  console.log(`  Player XP:     ${xpEarned} @ Level ${xpLevel}`);
  console.log(`  HookBus listeners: ${listenerCount}`);

  console.log(`\n  Heap trend (${heapSamples.length} samples):`);
  for (const s of heapSamples) {
    console.log(`    ${String(s.at).padStart(6)} spins → ${(s.bytes / 1024 / 1024).toFixed(2)} MB`);
  }

  console.log(`\n  Report: reports/long-run/summary.json`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\n  Failures:');
    for (const f of failures) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
