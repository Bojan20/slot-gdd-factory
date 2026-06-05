#!/usr/bin/env node
/**
 * BW-force symbol-pulse probe — verifies H5.14 fix for Boki rule
 * 05.06.2026: "Isto napravi za force Big Win da se vidi animacija
 * simbola pre nego sto pocne big win."
 *
 * Pre-H5.14: BW force synth event had cells:[] → playSymbolCelebration
 * had no targets → 800ms silent window before tier banner.
 *
 * Post-H5.14: BW force synthesises up to 8 grid cells into synth.cells
 * → 800ms VISIBLE pulse (cell--winsym class on multiple cells) BEFORE
 * onWinPresentationEnd → bigWinTier banner.
 *
 * Detection: sample document.querySelectorAll('.cell--winsym').length
 * every 60ms throughout BW click + 1s window. Maximum count > 0 during
 * the window proves cells are being pulsed.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5229;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular',         path: '/dist/01_rectangular_5x3_playable.html' },
  { name: 'wrath-of-olympus',    path: '/dist/wrath-of-olympus.html' },
];

const out = [];

try {
  const browser = await chromium.launch();
  for (const d of DEMOS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('ERR ' + e.message.slice(0,200)));
    page.on('console', m => { if (m.type()==='error') errors.push('CON ' + m.text().slice(0,200)); });
    await page.goto(`http://127.0.0.1:${PORT}${d.path}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const bw = document.getElementById('devBwBtn');
      return bw && !bw.disabled;
    }, { timeout: 8000 }).catch(()=>{});
    await page.waitForTimeout(500);

    // Click BW + sample cell--winsym count over time
    const result = await page.evaluate(async () => {
      window.__SP__ = { events: [], samples: [] };
      const evs = ['onWinPresentationStart','onWinPresentationEnd','onBigWinTierEntered'];
      if (window.HookBus) evs.forEach(n => window.HookBus.on(n, p => window.__SP__.events.push({ n, t: performance.now()|0, ...p })));

      const grid = document.querySelector('.gridHost') || document.getElementById('gridHost') || document.querySelector('.reelsHost');
      const sampler = setInterval(() => {
        window.__SP__.samples.push({
          t: (performance.now()|0),
          winsymCount: document.querySelectorAll('.cell--winsym').length,
          cyclingClass: !!grid?.classList?.contains('is-winsym-cycling'),
        });
      }, 60);

      // Wait for state to be ready
      while (document.getElementById('spinBtn')?.disabled) {
        await new Promise(r => setTimeout(r, 80));
      }
      await new Promise(r => setTimeout(r, 200));

      const bw = document.getElementById('devBwBtn');
      if (!bw || bw.disabled) {
        clearInterval(sampler);
        return { error: 'BW not available' };
      }
      bw.click();

      // Wait long enough for spin (~3s) + symbol celeb (800ms) + early big-win frames (~500ms)
      await new Promise(r => setTimeout(r, 5500));
      clearInterval(sampler);

      const start = window.__SP__.events.find(e => e.n === 'onWinPresentationStart');
      const end = window.__SP__.events.find(e => e.n === 'onWinPresentationEnd');
      const bwEntered = window.__SP__.events.find(e => e.n === 'onBigWinTierEntered');

      // Find samples DURING the celebration window (start.t .. end.t)
      const duringCelebration = start && end
        ? window.__SP__.samples.filter(s => s.t >= start.t && s.t <= end.t)
        : [];
      const maxWinsymDuringCeleb = duringCelebration.reduce((m, s) => Math.max(m, s.winsymCount), 0);
      const sampleCountInWindow = duringCelebration.length;
      const cyclingDuringCeleb = duringCelebration.some(s => s.cyclingClass);

      // Samples AFTER end (during big-win banner) — winsym should be cleared
      const afterEnd = end ? window.__SP__.samples.filter(s => s.t > end.t && s.t <= end.t + 400) : [];
      const winsymAfterEnd = afterEnd.length > 0 ? afterEnd[0].winsymCount : 0;

      return {
        startSeen: !!start,
        endSeen: !!end,
        bwEnteredSeen: !!bwEntered,
        startToEndMs: (start && end) ? (end.t - start.t) : null,
        maxWinsymDuringCeleb,
        sampleCountInWindow,
        cyclingDuringCeleb,
        winsymAfterEnd,
        bwEnteredAfterEnd: (bwEntered && end) ? bwEntered.t >= end.t : null,
      };
    });

    const checks = [
      ['onWinPresentationStart fired',                       result.startSeen],
      ['onWinPresentationEnd fired',                         result.endSeen],
      ['celebration duration ≈ 800ms (700-1200)',            result.startToEndMs >= 700 && result.startToEndMs <= 1200],
      ['samples taken during celebration (≥ 8)',             result.sampleCountInWindow >= 8],
      ['cell--winsym present DURING celebration (count > 0)', result.maxWinsymDuringCeleb > 0],
      ['cells pulsed at MULTIPLE positions (count ≥ 5)',     result.maxWinsymDuringCeleb >= 5],
      ['is-winsym-cycling class observed',                   result.cyclingDuringCeleb === true],
      ['cells cleared after celebration end',                result.winsymAfterEnd === 0],
      ['bigWinTier entered AFTER WinPresEnd',                result.bwEnteredAfterEnd === true],
      ['no console / page errors',                           errors.length === 0],
    ];

    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    out.push({ demo: d.name, result, errors, checks, pass, fail });
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

let totalPass = 0, totalFail = 0;
console.log('\n════ BW-FORCE SYMBOL-PULSE PROBE (Wave H5.14) ════');
for (const r of out) {
  console.log(`\n[${r.demo}]`);
  console.log(`  startToEnd=${r.result.startToEndMs}ms, maxWinsymDuringCeleb=${r.result.maxWinsymDuringCeleb}, samples in window=${r.result.sampleCountInWindow}`);
  console.log(`  cyclingDuringCeleb=${r.result.cyclingDuringCeleb}, winsymAfterEnd=${r.result.winsymAfterEnd}, bwEnteredAfterEnd=${r.result.bwEnteredAfterEnd}`);
  if (r.errors.length) r.errors.slice(0,3).forEach(e => console.log(`  err: ${e}`));
  for (const [l, ok] of r.checks) if (!ok) console.log(`    ✗ ${l}`);
  console.log(`  ${r.pass}/${r.checks.length} pass`);
  totalPass += r.pass; totalFail += r.fail;
}
console.log(`\nTOTAL: ${totalPass}/${totalPass+totalFail} pass`);
process.exit(totalFail === 0 ? 0 : 1);
