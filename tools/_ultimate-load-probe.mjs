/**
 * tools/_ultimate-load-probe.mjs
 *
 * C-5 LEGO-LOAD — Concurrent spin stress + heap diff audit.
 *
 * Probes:
 *   1. Single-page heap baseline before any spins
 *   2. Fire 1000 synthetic preSpin + onSpinResult event pairs
 *   3. Capture heap delta (post − pre)
 *   4. Verify heap delta ≤ 8 MB (8 KB per spin × 1000 = 8 MB ceiling)
 *   5. Verify 0 console errors during the loop
 *   6. Measure total wall-clock time (informational, no budget gate
 *      since synthetic events don't include real spin animation cost)
 *
 * Notes:
 *   • Memory probe via Chromium's window.performance.memory API only
 *     (Firefox/WebKit don't expose heap stats; we test Chromium only).
 *   • Synthetic events test the event bus + downstream subscribers,
 *     not the engine animation — that's a different probe.
 *
 * Exit 0 = within memory budget, 1 = leak detected.
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/load-probe');

const SPIN_COUNT = 1000;
const HEAP_BUDGET_MB = 8;

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
  console.log(`\n=== Ultimate load probe — ${SPIN_COUNT} synthetic spins × WoO ===`);
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const text = await fs.readFile(path.join(ROOT, 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md'), 'utf8');
  const model = parseGDD(text, 'md');
  /* Enable many subscribers to amplify any leak. */
  model.bonusBuyMenu = { enabled: true, tiers: [
    { id: 'a', label: 'A', costX: 75, forceScatters: 4, fsMode: 's' },
    { id: 'b', label: 'B', costX: 200, forceScatters: 5, fsMode: 'u' },
  ]};
  model.coinCollect = { enabled: true };
  model.cumulativeMeter = { enabled: true };
  model.playerXp = { enabled: true };
  model.sessionLevelMeter = { enabled: true };
  model.achievementToast = { enabled: true };
  model.spinHistoryReplay = { enabled: true };
  model.leaderboardChip = { enabled: true };
  const html = buildSlotHTML(model);

  const port = await findFreePort();
  const srv = await serveHTML(port, html);
  const url = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  /* Wait for runtime to settle */
  await page.waitForTimeout(300);

  /* Force GC if available, then read baseline heap */
  const heapBefore = await page.evaluate(() => {
    if (typeof window.gc === 'function') try { window.gc(); } catch (_) {}
    const m = window.performance && window.performance.memory;
    return m ? m.usedJSHeapSize : null;
  });
  t(`Chromium exposes performance.memory`, heapBefore !== null, `got ${heapBefore}`);

  /* Fire SPIN_COUNT synthetic spin event pairs */
  const startTime = Date.now();
  await page.evaluate(async (count) => {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    for (let i = 0; i < count; i++) {
      window.HookBus.emit('preSpin', { spinIndex: i });
      window.HookBus.emit('onSpinResult', { totalWin: i % 50, spinIndex: i });
      if (i % 10 === 9) window.HookBus.emit('onCoinCollected', { cellIds: ['c1', 'c2'], perSpinValue: 2, sessionTotal: (i + 1) * 0.2 });
      /* Yield to event loop occasionally so we don't block */
      if (i % 100 === 99) await new Promise(r => setTimeout(r, 1));
    }
  }, SPIN_COUNT);
  const wallMs = Date.now() - startTime;

  await page.waitForTimeout(200);

  /* Force GC again + read final heap */
  const heapAfter = await page.evaluate(() => {
    if (typeof window.gc === 'function') try { window.gc(); } catch (_) {}
    const m = window.performance && window.performance.memory;
    return m ? m.usedJSHeapSize : null;
  });

  const deltaBytes = (heapAfter || 0) - (heapBefore || 0);
  const deltaMB = deltaBytes / (1024 * 1024);

  t(`Heap delta after ${SPIN_COUNT} spins ≤ ${HEAP_BUDGET_MB} MB`,
    deltaMB <= HEAP_BUDGET_MB, deltaMB.toFixed(2) + ' MB');
  t(`0 console errors during ${SPIN_COUNT}-spin loop`, errs.length === 0, errs.slice(0, 2).join(' | '));

  /* Check that __SPIN_HISTORY__ ring buffer didn't grow unbounded */
  const historySize = await page.evaluate(() => {
    return window.__SPIN_HISTORY__ ? window.__SPIN_HISTORY__.buffer.length : 0;
  });
  t(`spin history ring buffer bounded ≤ maxSize`, historySize <= 100, `size=${historySize}`);

  /* Check that __PLAYER_XP__ accumulated properly */
  const xp = await page.evaluate(() => window.__PLAYER_XP__ ? window.__PLAYER_XP__.xp : 0);
  t(`playerXp accumulated XP > 0`, xp > 0, `xp=${xp}`);

  await ctx.close();
  await browser.close();
  srv.close();

  console.log(`\n  Wall-clock time:   ${wallMs} ms (${(wallMs / SPIN_COUNT).toFixed(2)} ms/spin)`);
  console.log(`  Heap before:       ${heapBefore !== null ? (heapBefore / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}`);
  console.log(`  Heap after:        ${heapAfter !== null ? (heapAfter / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}`);
  console.log(`  Δ Heap:            ${deltaMB.toFixed(2)} MB / ${HEAP_BUDGET_MB} MB budget`);
  console.log(`  Spin history len:  ${historySize}`);
  console.log(`  Player XP earned:  ${xp}`);

  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    spinCount: SPIN_COUNT,
    heapBudgetMB: HEAP_BUDGET_MB,
    heapBeforeBytes: heapBefore,
    heapAfterBytes: heapAfter,
    heapDeltaBytes: deltaBytes,
    heapDeltaMB: +deltaMB.toFixed(2),
    wallMs,
    msPerSpin: +(wallMs / SPIN_COUNT).toFixed(3),
    historySize,
    xp,
    consoleErrors: errs.length,
    pass, fail,
    failures,
  }, null, 2));

  console.log(`\n  Reports: reports/load-probe/summary.json`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\n  Failures:');
    for (const f of failures) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
