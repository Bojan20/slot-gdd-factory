#!/usr/bin/env node
/**
 * tools/_ultimate-win-symbol-persistence-probe.mjs · D-10 SYMBOL-PERSIST
 *
 * Boki 2026-06-20: "desava se da neki simboli koji su u win liniji nestranu
 *                   iz reel framea. fix it. iskoristi neki brutalan test za
 *                   to i sve agente koji ti trebaju. ako nemas taj test,
 *                   napisi ga"
 *
 * Brutalan E2E probe koji za svaki real GDD detektuje scenario:
 *   "Simbol koji je bio u win liniji NESTAJE iz reel frame-a posle
 *    onWinPresentationEnd."
 *
 * Arhitektura (split Node ↔ page):
 *   1. install_recorder      — page.evaluate (small): set up window.__D10
 *      sa listener-ima za Start/End i sampler-om winsym cells
 *   2. node-side spin loop   — Node klikne spin, čeka postSpin, poll
 *      window.__D10.endSeen do natural win-cycle završi ili N spinova prođe
 *   3. settle wait + collect — Node spava 1.2s, čita __D10.report
 *   4. analyze               — Node računa failures po cells koje su
 *      bile u winSymCellIds set-u tokom Start..End prozora
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/_ultimate-win-symbol-persistence');

const WARMUP_SPINS = 5;
const MAX_NATURAL_SPINS = 60;
const POST_SPIN_TIMEOUT = 4000;
const POST_END_SETTLE_MS = 1200;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function log(...a) { console.log(...a); }

async function installRecorder(page) {
  await page.evaluate(() => {
    if (window.__D10) return;
    const ALL_CELL_NODES = Array.from(document.querySelectorAll('.cell, .symbol-cell'));
    const CELL_INDEX = new Map();
    ALL_CELL_NODES.forEach((c, i) => CELL_INDEX.set(c, `cell#${i}`));

    function cellKey(el) {
      if (!el) return '';
      if (CELL_INDEX.has(el)) return CELL_INDEX.get(el);
      if (el.id) return el.id;
      return '';
    }

    function snapshotCells(label) {
      const grid = document.getElementById('gridHost') || document.querySelector('.gridHost');
      const gridRect = grid && grid.getBoundingClientRect ? grid.getBoundingClientRect() : null;
      const cells = Array.from(document.querySelectorAll('.cell, .symbol-cell'));
      const out = [];
      for (const c of cells) {
        if (!c || typeof c.getBoundingClientRect !== 'function') continue;
        const r = c.getBoundingClientRect();
        const cs = window.getComputedStyle(c);
        out.push({
          id: cellKey(c),
          textContent: (c.textContent || '').trim(),
          opacity: parseFloat(cs.opacity || '1'),
          visibility: cs.visibility,
          display: cs.display,
          rect: { top: r.top, bottom: r.bottom, width: r.width, height: r.height },
          inFrame: gridRect ? (r.top >= gridRect.top - 1 && r.bottom <= gridRect.bottom + 1) : null,
          isRemoving: c.classList.contains('is-removing'),
          isCollapsing: c.classList.contains('is-collapsing'),
          isFading: c.classList.contains('is-fading'),
          isWinsym: c.classList.contains('cell--winsym'),
        });
      }
      return { label, ts: Date.now(), cells: out, gridRect };
    }

    const rec = {
      preSpin: snapshotCells('preSpin'),
      startEmit: null,
      endEmit: null,
      settled: null,
      winSymCellIds: new Set(),
      eventsCells: 0,
      startSeen: false,
      endSeen: false,
      samplerActive: false,
    };

    let sampler = null;
    function startSampler() {
      if (sampler) return;
      rec.samplerActive = true;
      const tStart = Date.now();
      sampler = setInterval(() => {
        if (Date.now() - tStart > 10000) {
          clearInterval(sampler); sampler = null; rec.samplerActive = false; return;
        }
        try {
          document.querySelectorAll('.cell--winsym, .cell.cell--winsym').forEach(c => {
            const k = cellKey(c);
            if (k) rec.winSymCellIds.add(k);
          });
        } catch (_) {}
      }, 50);
    }
    function stopSampler() {
      if (sampler) { clearInterval(sampler); sampler = null; rec.samplerActive = false; }
    }

    try {
      window.HookBus.on('onWinPresentationStart', (ev) => {
        if (rec.startSeen) return;
        rec.startSeen = true;
        rec.startEmit = snapshotCells('start');
        startSampler();
        try {
          const evCells = (ev && Array.isArray(ev.cells)) ? ev.cells
                          : (ev && Array.isArray(ev.events) ? ev.events.flatMap(e => e.cells || []) : []);
          rec.eventsCells = evCells.length;
          for (const c of evCells) {
            let el = c;
            if (typeof el.getBoundingClientRect !== 'function' && window.__resolveCellElement) el = window.__resolveCellElement(c);
            const k = cellKey(el);
            if (k) rec.winSymCellIds.add(k);
          }
        } catch (_) {}
      }, { priority: 50 });

      window.HookBus.on('onWinPresentationEnd', () => {
        if (!rec.startSeen || rec.endSeen) return;
        rec.endSeen = true;
        rec.endEmit = snapshotCells('end');
        stopSampler();
        setTimeout(() => {
          rec.settled = snapshotCells('settled');
          window.__D10.done = true;
        }, 1200);
      }, { priority: 50 });
    } catch (_) {}

    window.__D10 = {
      rec,
      done: false,
      snapshotCells,
      cellKey,
      stopSampler,
      forceSettleNow() {
        if (!this.rec.settled) {
          this.rec.settled = snapshotCells('settled-forced');
          stopSampler();
        }
        this.done = true;
      },
      getReport() {
        return {
          preSpin: this.rec.preSpin,
          startEmit: this.rec.startEmit,
          endEmit: this.rec.endEmit,
          settled: this.rec.settled,
          winSymCellIds: [...this.rec.winSymCellIds],
          eventsCells: this.rec.eventsCells,
          startSeen: this.rec.startSeen,
          endSeen: this.rec.endSeen,
        };
      },
    };
  });
}

async function clickSpin(page) {
  return await page.evaluate(() => {
    const btn = document.getElementById('spinBtn');
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
}

async function waitPostSpin(page, to) {
  try {
    await page.evaluate((t) => new Promise((res) => {
      let done = false;
      const tm = setTimeout(() => { if (!done) { done = true; res(); } }, t);
      try { window.HookBus.once('postSpin', () => { if (!done) { done = true; clearTimeout(tm); res(); } }); } catch (_) {}
    }), to);
  } catch (_) {}
}

async function checkD10State(page) {
  return await page.evaluate(() => ({
    startSeen: !!(window.__D10 && window.__D10.rec.startSeen),
    endSeen: !!(window.__D10 && window.__D10.rec.endSeen),
    done: !!(window.__D10 && window.__D10.done),
  }));
}

async function getD10Report(page) {
  return await page.evaluate(() => window.__D10 ? window.__D10.getReport() : null);
}

async function runOneGame(browser, gameDir) {
  const slot = resolve(DIST, gameDir, 'slot.html');
  if (!existsSync(slot)) return { game: gameDir, error: 'slot.html missing' };
  const url = pathToFileURL(slot).href;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = { console: [], page: [] };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.page.push(String(e).slice(0, 240)));

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);

  /* Warmup. */
  for (let i = 0; i < WARMUP_SPINS; i++) {
    const ok = await clickSpin(page);
    if (!ok) break;
    await waitPostSpin(page, POST_SPIN_TIMEOUT);
    await page.waitForTimeout(150);
  }

  /* Install recorder. */
  await installRecorder(page);

  /* Spin loop from NODE side, polling __D10 state. */
  let spinsAttempted = 0;
  let startSeen = false;
  while (spinsAttempted < MAX_NATURAL_SPINS && !startSeen) {
    const ok = await clickSpin(page);
    spinsAttempted++;
    if (!ok) { await page.waitForTimeout(300); continue; }
    await waitPostSpin(page, POST_SPIN_TIMEOUT);
    await page.waitForTimeout(120);
    const st = await checkD10State(page);
    if (st.startSeen) startSeen = true;
  }

  let inconclusive = false;
  if (!startSeen) {
    inconclusive = true;
  } else {
    /* Wait for End + settle. */
    let waitedMs = 0;
    while (waitedMs < 8000) {
      const st = await checkD10State(page);
      if (st.done) break;
      await page.waitForTimeout(200);
      waitedMs += 200;
    }
    /* If still not done (End never fired), force settle. */
    await page.evaluate(() => { if (window.__D10 && !window.__D10.done) window.__D10.forceSettleNow(); });
  }

  const report = await getD10Report(page);
  await ctx.close();

  /* Analyze. */
  const failures = [];
  const winCellAnalysis = [];
  if (report && !inconclusive) {
    const settled = report.settled;
    const start = report.startEmit;
    const settledById = new Map((settled && settled.cells || []).map(c => [c.id, c]));
    const startById = new Map((start && start.cells || []).map(c => [c.id, c]));
    for (const id of report.winSymCellIds) {
      const s = startById.get(id) || null;
      const e = settledById.get(id) || null;
      if (!e) {
        failures.push({ id, type: 'missing-at-settle', detail: 'cell vanished from DOM after End + 1.2s' });
        continue;
      }
      const refText = s ? s.textContent : null;
      if (refText && refText !== '' && e.textContent === '') {
        failures.push({ id, type: 'textless-at-settle', refText, detail: 'cell textContent empty after End + 1.2s' });
      }
      if (e.opacity < 0.9) failures.push({ id, type: 'opacity-low', opacity: e.opacity, detail: 'cell opacity < 0.9 after settle' });
      if (e.visibility === 'hidden') failures.push({ id, type: 'visibility-hidden', detail: 'cell visibility:hidden after settle' });
      if (e.display === 'none') failures.push({ id, type: 'display-none', detail: 'cell display:none after settle' });
      if (e.inFrame === false) failures.push({ id, type: 'out-of-frame', rect: e.rect, detail: 'cell bounds outside grid frame' });
      if (e.isRemoving || e.isCollapsing || e.isFading) {
        failures.push({
          id, type: 'lingering-anim-class',
          classes: [e.isRemoving && 'is-removing', e.isCollapsing && 'is-collapsing', e.isFading && 'is-fading'].filter(Boolean),
          detail: 'animation class still on cell after End + 1.2s',
        });
      }
      if (e.isWinsym) failures.push({ id, type: 'lingering-winsym', detail: 'cell--winsym still on cell after End + 1.2s' });
      winCellAnalysis.push({ id, start: s, settled: e });
    }
  }

  const verdict = inconclusive ? 'INCONCLUSIVE' : (failures.length === 0 ? 'PASS' : 'FAIL');
  return {
    game: gameDir,
    durationMs: Date.now() - t0,
    spinsAttempted,
    inconclusive,
    eventsCells: report ? report.eventsCells : 0,
    winCellCount: report ? report.winSymCellIds.length : 0,
    startSeen: report ? report.startSeen : false,
    endSeen: report ? report.endSeen : false,
    failures,
    winCellAnalysis: winCellAnalysis.slice(0, 30),
    errors,
    verdict,
  };
}

async function main() {
  log('\n🎰 ULTIMATE WIN-SYMBOL PERSISTENCE PROBE · D-10');
  log('   Detektuje: simbol je bio u win liniji ali nestao iz frame-a 1.2s posle End emit.\n');
  const games = readdirSync(DIST).filter((g) => existsSync(resolve(DIST, g, 'slot.html'))).sort();
  if (games.length === 0) { console.error('FATAL: nema dist/real-games'); process.exit(2); }

  const browser = await chromium.launch({ headless: true });
  const reports = [];
  for (const g of games) {
    log(`▸ ${g}`);
    const t0 = Date.now();
    try {
      const r = await runOneGame(browser, g);
      reports.push(r);
      const sym = r.verdict === 'PASS' ? '✓' : (r.verdict === 'FAIL' ? '✗' : '!');
      log(`   ${sym} ${r.verdict} · spins=${r.spinsAttempted} · winCells=${r.winCellCount} · failures=${r.failures.length} · err=${r.errors.console.length + r.errors.page.length} · ${((Date.now()-t0)/1000).toFixed(1)}s`);
      if (r.failures.length > 0) {
        const byType = {};
        for (const f of r.failures) byType[f.type] = (byType[f.type] || 0) + 1;
        for (const [t, n] of Object.entries(byType)) log(`     ✗ ${t}: ${n}`);
      }
    } catch (e) {
      log('   ❌ FAILED:', String(e).slice(0, 200));
      reports.push({ game: g, error: String(e), verdict: 'ERROR' });
    }
  }
  await browser.close();

  const stamp = Date.now();
  const outPath = resolve(OUT, `run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ stamp, reports }, null, 2));

  log('\n══════════════════════════════════════════════════════════════════════');
  log('SUMMARY · WIN-SYMBOL PERSISTENCE');
  log('══════════════════════════════════════════════════════════════════════');
  let totalFails = 0;
  for (const r of reports) {
    const sym = r.verdict === 'PASS' ? '✓' : (r.verdict === 'FAIL' ? '✗' : '!');
    log(`  ${sym} ${(r.game || '?').padEnd(34)} ${(r.verdict || '?').padEnd(12)} winCells=${r.winCellCount || 0} fail=${(r.failures || []).length}`);
    totalFails += (r.failures || []).length;
  }
  log(`\n   Σ failures: ${totalFails} · report ${outPath}\n`);
  process.exit(totalFails === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
