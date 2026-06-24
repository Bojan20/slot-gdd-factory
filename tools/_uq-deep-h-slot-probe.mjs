#!/usr/bin/env node
/**
 * UQ-DEEP-H slot runtime probe — verify the 6 errors Boki saw in cash-
 * eruption-foundry-gdd are gone AND that blocks + reel frame render.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const SLOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory/dist/ingest/cash-eruption-foundry-gdd/index.html';
if (!existsSync(SLOT)) { console.error('slot missing'); process.exit(2); }

const PORT = 5273;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const findings = [];
function note(sev, msg) { findings.push({ sev, msg }); console.log(`[${sev}] ${msg}`); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const pageErrors = [];
const consoleErrors = [];
const consoleWarnings = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error') consoleErrors.push(m.text());
  if (m.type() === 'warning') consoleWarnings.push(m.text());
});

const url = `http://127.0.0.1:${PORT}/dist/ingest/cash-eruption-foundry-gdd/`;
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);  /* let all blocks initialize */

/* Check the 4 specific HookBus warnings Boki saw. */
const expectedWarnings = [
  'onHoldAndWinIntro',
  'onHoldAndWinStart',
  'onWinCapReached',
  'onSelfExcludedBlocked',
];
for (const ev of expectedWarnings) {
  const hit = consoleWarnings.find(w => w.includes(ev));
  if (hit) note('CRIT', `still seeing [HookBus] unknown event: ${ev}`);
  else note('OK', `no [HookBus] warn for ${ev}`);
}

/* Check the 2 specific pageerrors Boki saw. */
const securityErr = pageErrors.find(e => /serviceWorker/i.test(e));
if (securityErr) note('CRIT', 'serviceWorker SecurityError still present: ' + securityErr.slice(0, 150));
else note('OK', 'no serviceWorker SecurityError');

const fsmErr = pageErrors.find(e => /FSM.*before initialization/i.test(e));
if (fsmErr) note('CRIT', 'FSM TDZ ReferenceError still present: ' + fsmErr.slice(0, 150));
else note('OK', 'no FSM TDZ ReferenceError');

/* Verify slot actually rendered. */
const hasGrid = await page.$('#gridHost').then(el => !!el);
const hasFrame = await page.$('.frame').then(el => !!el);
const hasSpinBtn = await page.$('#spinBtn').then(el => !!el);
const cellCount = await page.$$eval('#gridHost .cell, #gridHost [class*=cell]', els => els.length);

if (!hasGrid) note('CRIT', '#gridHost missing — no grid rendered');
else note('OK', '#gridHost present');
if (!hasFrame) note('CRIT', '.frame missing — no reel frame rendered');
else note('OK', '.frame present');
if (!hasSpinBtn) note('CRIT', '#spinBtn missing');
else note('OK', '#spinBtn present');
if (cellCount === 0) note('HIGH', 'gridHost has 0 cells');
else note('OK', `${cellCount} cells rendered`);

/* Click spin and verify no error. */
const beforeErrs = pageErrors.length;
await page.click('#spinBtn').catch(() => {});
await page.waitForTimeout(1500);
const afterErrs = pageErrors.length;
if (afterErrs > beforeErrs) {
  const newErrs = pageErrors.slice(beforeErrs);
  note('CRIT', `spin click introduced ${newErrs.length} pageerror(s): ${newErrs[0].slice(0, 150)}`);
} else {
  note('OK', 'spin click did not introduce new pageerrors');
}

/* Summary of remaining noise. */
const otherErrors = pageErrors.filter(e =>
  !/serviceWorker/i.test(e) && !/FSM.*before initialization/i.test(e));
const otherWarnings = consoleWarnings.filter(w =>
  !expectedWarnings.some(ev => w.includes(ev)) && !/HookBus.*unknown/i.test(w));

console.log(`\n── pageerror remaining: ${otherErrors.length} ──`);
otherErrors.slice(0, 5).forEach(e => console.log('  ' + e.slice(0, 200)));
console.log(`── console warn remaining: ${otherWarnings.length} ──`);
otherWarnings.slice(0, 5).forEach(w => console.log('  ' + w.slice(0, 200)));
console.log(`── console error: ${consoleErrors.length} ──`);
consoleErrors.slice(0, 5).forEach(e => console.log('  ' + e.slice(0, 200)));

const fail = findings.filter(f => f.sev === 'CRIT' || f.sev === 'FAIL').length;
console.log(`\nTotal: ${findings.length}, CRIT/FAIL: ${fail}`);

await browser.close();
srv.kill();
process.exit(fail > 0 ? 1 : 0);
