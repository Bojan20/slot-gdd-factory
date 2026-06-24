#!/usr/bin/env node
/**
 * UQ-DEEP-G E2E probe — verify NO lažan "SSE veza prekinuta" after a
 * successful ingest. Uses chromium to navigate /, programmatically
 * pushes a File into the drop-zone via DataTransfer, clicks ingest,
 * watches timeline + console + network for the regression Boki saw.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const URL = 'http://127.0.0.1:5181/';
const SAMPLE_PATH = '/Users/vanvinklstudio/Projects/slot-gdd-factory/samples/CRYSTAL_FORGE_GAME_GDD.md';
if (!existsSync(SAMPLE_PATH)) { console.error('sample missing: ' + SAMPLE_PATH); process.exit(2); }
const SAMPLE_BYTES = readFileSync(SAMPLE_PATH);

const findings = [];
function note(sev, msg) { findings.push({ sev, msg }); console.log(`[${sev}] ${msg}`); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const consoleErrors = [];
const networkFails = [];
page.on('pageerror', e => note('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) networkFails.push(`${r.status()} ${r.url()}`); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#go');

/* Drop a fake File into the #drop zone via DataTransfer. */
await page.evaluate(async (b64) => {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const file = new File([bin], 'CRYSTAL_FORGE_GAME_GDD.md', { type: 'text/markdown' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const drop = document.getElementById('drop');
  drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, Buffer.from(SAMPLE_BYTES).toString('base64'));

await page.waitForTimeout(300);
const disabled = await page.$eval('#go', el => el.disabled);
if (disabled) note('CRIT', 'ingest button still disabled after file drop');
await page.click('#go');

const tWait = Date.now();
let firstTerminalText = null;
while (Date.now() - tWait < 30000) {
  const steps = await page.$$eval('#timeline .step', els => els.map(e => ({ t: e.textContent, c: e.className })));
  const terminal = steps.find(s => s.c.includes('fail') || /done/i.test(s.t));
  if (terminal) { firstTerminalText = terminal.t; break; }
  await page.waitForTimeout(150);
}
if (!firstTerminalText) note('CRIT', '30s timeout: no terminal step (done/fail)');
else {
  if (/SSE veza prekinuta/.test(firstTerminalText)) {
    note('CRIT', 'first terminal step is lažan SSE error: ' + firstTerminalText.slice(0, 200));
  } else if (/done/i.test(firstTerminalText)) {
    note('OK', 'first terminal step = done');
  } else {
    note('FAIL', 'first terminal step is FAIL but not lažan SSE: ' + firstTerminalText.slice(0, 200));
  }
}

await page.waitForTimeout(2000);
const allSteps = await page.$$eval('#timeline .step', els => els.map(e => e.textContent));
const lažanCount = allSteps.filter(s => /SSE veza prekinuta/.test(s)).length;
if (lažanCount > 0) note('CRIT', `lažan SSE error appears ${lažanCount}× in timeline (regression — Boki bug)`);
else note('OK', 'NO lažan SSE error in timeline after 2s of grace');

const recHTML = await page.$eval('#receipts', el => el.innerHTML.slice(0, 300));
if (/running…|veza prekinuta/.test(recHTML)) note('HIGH', 'receipts stuck: ' + recHTML.slice(0, 200));
else note('OK', 'receipts populated');

const previewSrc = await page.$eval('#preview iframe', el => el.src).catch(() => null);
if (!previewSrc) note('HIGH', 'no preview iframe after done');
else note('OK', 'preview iframe src=' + previewSrc);

if (consoleErrors.length > 0) {
  const real = consoleErrors.filter(e => !/favicon/i.test(e));
  if (real.length > 0) note('MED', `console errors: ${real.length} (first: ${real[0].slice(0, 150)})`);
  else note('OK', 'console errors only favicon');
} else { note('OK', 'zero console errors'); }
if (networkFails.length > 0) {
  const real = networkFails.filter(f => !/favicon/i.test(f));
  if (real.length > 0) note('MED', `network 4xx/5xx: ${real.length} (first: ${real[0].slice(0, 150)})`);
  else note('OK', 'network only favicon');
} else { note('OK', 'zero network 4xx/5xx'); }

console.log(`\nTotal findings: ${findings.length}`);
const fail = findings.filter(f => f.sev === 'CRIT' || f.sev === 'FAIL').length;
console.log(`CRIT/FAIL: ${fail}`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
