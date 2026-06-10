#!/usr/bin/env node
/**
 * tools/_force-modal-test.mjs
 *
 * Boki: "wheel mi ne radi, force. gamble takodje."
 *
 * Test: click each force chip on Huff PDF, verify the modal opens.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5272;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGE: '+e));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForSelector('#fileInput', { state: 'attached', timeout: 10000 });
await page.setInputFiles('#fileInput', PDF);
await page.waitForSelector('#previewFrame', { timeout: 25000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());

const chips = await frame.evaluate(() =>
  Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind'))
);
console.log('Available chips:', chips.join(', '));

const tests = [
  { kind: 'wheel_bonus', overlay: '#wbOverlay', overlayName: 'wbOverlay' },
  { kind: 'gamble', overlay: '#gambleOverlay', overlayName: 'gambleOverlay' },
];

for (const t of tests) {
  if (!chips.includes(t.kind)) { console.log(`  ⚠️  ${t.kind}: NOT in chips list, skipping`); continue; }
  // Close any open overlays first
  await frame.evaluate(() => {
    try { if (typeof window.wbClose === 'function') window.wbClose(); } catch (_) {}
    try { if (typeof window.gambleCollect === 'function') window.gambleCollect(); } catch (_) {}
  });
  await page.waitForTimeout(200);
  const before = await frame.evaluate((sel) => {
    const o = document.querySelector(sel);
    return o ? o.dataset.show : null;
  }, t.overlay);
  await frame.evaluate((k) => document.querySelector(`.ufp-chip[data-ufp-kind="${k}"]`)?.click(), t.kind);
  await page.waitForTimeout(500);
  const after = await frame.evaluate((sel) => {
    const o = document.querySelector(sel);
    return o ? { show: o.dataset.show, exists: true } : { exists: false };
  }, t.overlay);
  const opened = after.show === 'true';
  console.log(`  ${opened ? '✅' : '❌'} ${t.kind} → ${t.overlayName} show ${before}→${after.show || 'N/A'}`);
}

console.log(`\nConsole errors: ${errs.length}`);
errs.slice(0, 5).forEach(e => console.log('  ', e.slice(0, 200)));

await page.close();
await ctx.close();
await browser.close();
server.kill('SIGTERM');
