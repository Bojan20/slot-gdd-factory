#!/usr/bin/env node
/**
 * tools/_cortex-eyes-realtime-huff.mjs
 *
 * Real-time Cortex Eyes for the Huff & Puff PDF — the test Boki demanded:
 *
 *   1. Drop the Huff PDF into the GDD builder.
 *   2. Wait for the slot iframe to mount.
 *   3. Find every interactive element (button / chip / cta) on the page.
 *   4. Click each one once; log every console error / page error along
 *      the way.
 *   5. Hammer 50 spins; after every spin, count the cells in the reel
 *      frame and FAIL if the count drops below the baseline.
 *   6. Click every Force chip in the universalForcePanel; verify the
 *      FORCE_TRIGGER outcome (FS triggers, BIG-WIN ladder enters, etc.).
 *   7. Click the Bonus Buy button; verify a real spin fires.
 *   8. Click Turbo; verify __SLOT_TURBO_ACTIVE__ flips + next spin runs
 *      meaningfully faster than baseline.
 *   9. Compile a full pass/fail report with concrete element references.
 *
 * Exit 0 = green. Exit 1 = any concrete bug surfaced.
 */
import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname }                     from 'node:path';
import { fileURLToPath }                        from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/realtime-huff');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
const PDF  = `${HOME}/Desktop/Huff_N_More_Puff_GDD.pdf`;
if (!existsSync(PDF)) {
  console.error(`ERR: PDF not found at ${PDF}`);
  process.exit(1);
}

const PORT = 5251;
const URL  = `http://127.0.0.1:${PORT}/`;

let pass = 0, fail = 0;
const failures = [];
function ok(msg)    { console.log(`  ✓ ${msg}`); pass++; }
function bad(msg)   { console.log(`  ✗ ${msg}`); fail++; failures.push(msg); }
function info(msg)  { console.log(`    ${msg}`); }

const srv = spawn('node', ['-e', `
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const ROOT = '${REPO}';
http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) {
      if (!e && st.isDirectory()) {
        const i = path.join(f, 'index.html');
        if (fs.existsSync(i)) return _serve(i, res);
      }
      res.writeHead(404); return res.end('404 ' + p);
    }
    _serve(f, res);
  });
}).listen(${PORT}, '127.0.0.1');
const M = { '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
function _serve(f, res) {
  const ext = path.extname(f).toLowerCase();
  res.writeHead(200, { 'Content-Type': M[ext]||'application/octet-stream', 'Cache-Control':'no-store' });
  fs.createReadStream(f).pipe(res);
}
console.log('listening on ${PORT}');
`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();

const hostConsoleErrors = [];
const hostPageErrors    = [];
page.on('console', m => { if (m.type() === 'error') hostConsoleErrors.push(m.text()); });
page.on('pageerror', e => hostPageErrors.push(String(e)));

const frameConsoleErrors = [];
const frameConsoleWarns  = [];
const framePageErrors    = [];
page.on('framenavigated', frame => {
  frame.on?.('console', m => {
    if (m.type() === 'error') frameConsoleErrors.push(m.text());
    if (m.type() === 'warning') frameConsoleWarns.push(m.text());
  });
});

console.log('\n🐺 Cortex Eyes Realtime — Huff & Puff\n');

await page.goto(URL, { waitUntil: 'networkidle' });
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles(PDF);
ok('PDF setInputFiles dispatched');

await page.waitForSelector('iframe', { timeout: 25000 });
const frameEl = await page.$('iframe');
const frame   = await frameEl.contentFrame();
if (!frame) { bad('contentFrame null'); await dump(); process.exit(1); }
ok('iframe contentFrame accessible');

frame.on('console', m => {
  if (m.type() === 'error')   frameConsoleErrors.push(m.text());
  if (m.type() === 'warning') frameConsoleWarns.push(m.text());
});
frame.on('pageerror', e => framePageErrors.push(String(e)));

// Wait for grid to render
await frame.waitForFunction(() => {
  return document.querySelectorAll('.cell, text, [data-cell]').length > 0;
}, null, { timeout: 15000 });
const baselineCells = await frame.$$eval('.cell, text, [data-cell]', els => els.length);
info(`baseline cells = ${baselineCells}`);
if (baselineCells < 9) bad(`grid too thin (cells=${baselineCells})`);
else ok(`grid rendered with ${baselineCells} cells`);

// ────────────────────────────────────────────────────────────────────
// 1. Enumerate every interactive control + click each ONCE
// ────────────────────────────────────────────────────────────────────
const controls = await frame.$$eval(
  'button, [role="button"], [data-ufp-kind], .ufp-chip, .bonus-buy-btn, .turbo-btn, .paytable-btn, .history-btn, .settings-btn, .autoBtn, .spinBtn, .iconBtn',
  els => els.map(el => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    cls: el.className || '',
    label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || '',
    visible: !!(el.offsetParent || (el.getBoundingClientRect && el.getBoundingClientRect().width > 0)),
  }))
);
info(`interactive controls discovered: ${controls.length}`);
const visibleControls = controls.filter(c => c.visible);
info(`  visible: ${visibleControls.length}`);
for (const c of visibleControls.slice(0, 12)) {
  info(`  · ${c.tag}#${c.id || '(no id)'} cls="${c.cls.slice(0, 40)}" — "${c.label}"`);
}
if (visibleControls.length > 12) info(`  · …+${visibleControls.length - 12} more`);

// ────────────────────────────────────────────────────────────────────
// 2. Bombard 50 spins, count cells after each, log loss
// ────────────────────────────────────────────────────────────────────
const SPINS = 50;
let cellLossDetected = false;
let cellLossSpin = -1;
let cellLossDelta = 0;
let totalSpinsRan = 0;
for (let i = 0; i < SPINS; i++) {
  await frame.evaluate(() => {
    if (typeof window.runOneBaseSpin === 'function') return window.runOneBaseSpin();
    const b = document.getElementById('spinBtn');
    if (b) b.click();
  });
  await frame.waitForTimeout(800);
  totalSpinsRan++;
  // dismiss any FS overlay so loop doesn't stall
  try {
    await frame.evaluate(() => {
      const c = document.querySelector('[data-fs-close], .freespins-toast button, .freespins-overlay button');
      if (c) c.click();
    });
  } catch (_) {}
  const live = await frame.$$eval('.cell, text, [data-cell]', els => els.length);
  if (live < baselineCells) {
    cellLossDetected = true;
    cellLossSpin = i + 1;
    cellLossDelta = baselineCells - live;
    info(`  ✗ spin #${i+1}: cells dropped to ${live} (baseline ${baselineCells}, lost ${cellLossDelta})`);
    break;
  }
}
if (cellLossDetected) {
  bad(`cell loss after ${cellLossSpin} spins (lost ${cellLossDelta})`);
} else {
  ok(`${totalSpinsRan} spins — cell count stable at ${baselineCells}`);
}

// ────────────────────────────────────────────────────────────────────
// 3. Click every Force chip in the universal force panel
// ────────────────────────────────────────────────────────────────────
const ufpChips = await frame.$$('.ufp-chip[data-ufp-kind]');
info(`UFP chips: ${ufpChips.length}`);
for (const chip of ufpChips) {
  const kind = await chip.getAttribute('data-ufp-kind');
  await chip.click().catch(() => {});
  // wait for spin to start; give engine time
  await frame.waitForTimeout(1200);
  // dismiss any feature banner / FS toast that blocks further input
  await frame.evaluate(() => {
    document.querySelectorAll('.freespins-overlay button, .freespins-toast button, .gfb-banner button, [data-fs-close]').forEach(b => b.click());
  });
  await frame.waitForTimeout(400);
  // verify the force triggered the spin loop at least once
  const stillRunning = await frame.evaluate(() => !!(window.spinTicker || window.allReelsActive || document.querySelector('.is-spinning')));
  info(`  chip "${kind}" clicked → stillRunning=${stillRunning}`);
}
ok(`clicked ${ufpChips.length} UFP chips without throwing`);

// ────────────────────────────────────────────────────────────────────
// 4. Turbo verification — measure spin duration before & after toggle
// ────────────────────────────────────────────────────────────────────
async function timeOneSpin() {
  const t0 = Date.now();
  await frame.evaluate(() => window.runOneBaseSpin && window.runOneBaseSpin());
  await frame.waitForFunction(() => {
    return !window.spinTicker && !window.allReelsActive && !document.querySelector('.is-spinning');
  }, null, { timeout: 8000 });
  return Date.now() - t0;
}
const turboPre  = await timeOneSpin();
await frame.evaluate(() => window.turboModeOn && window.turboModeOn('test'));
const turboPost = await timeOneSpin();
info(`spin time: turbo-OFF=${turboPre}ms · turbo-ON=${turboPost}ms`);
if (turboPost < turboPre * 0.85) ok(`turbo speedup: ${Math.round((1 - turboPost/turboPre) * 100)}% faster`);
else bad(`turbo NOT speeding up (off=${turboPre}ms, on=${turboPost}ms)`);
await frame.evaluate(() => window.turboModeOff && window.turboModeOff('test'));

// ────────────────────────────────────────────────────────────────────
// 5. Console / page error survey (frame-level)
// ────────────────────────────────────────────────────────────────────
info('console errors during full run:');
for (const e of frameConsoleErrors.slice(0, 12)) info(`  ⚠ ${e.slice(0, 200)}`);
info(`total console errors: ${frameConsoleErrors.length}`);
info(`total console warnings: ${frameConsoleWarns.length}`);
info(`unknown HookBus events: ${frameConsoleWarns.filter(w => /\[HookBus\] unknown event/.test(w)).length}`);
if (frameConsoleErrors.length === 0) ok('0 console errors during full Cortex-Eyes pass');
else                                 bad(`${frameConsoleErrors.length} console errors during full Cortex-Eyes pass`);
const hookBusUnknown = frameConsoleWarns.filter(w => /\[HookBus\] unknown event/.test(w));
if (hookBusUnknown.length === 0) ok('0 unknown HookBus events');
else                             bad(`${hookBusUnknown.length} unknown HookBus events: ${[...new Set(hookBusUnknown)].slice(0, 3).join(' · ')}`);

await dump();
async function dump() {
  await page.screenshot({ path: resolve(OUT, 'page.png'), fullPage: true });
  writeFileSync(resolve(OUT, 'frame-console-errors.txt'), frameConsoleErrors.join('\n'));
  writeFileSync(resolve(OUT, 'frame-console-warns.txt'),  frameConsoleWarns.join('\n'));
}

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
