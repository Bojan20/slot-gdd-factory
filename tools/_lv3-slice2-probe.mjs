#!/usr/bin/env node
/**
 * LV3 slice 2 probe — verify all 4 LV3 blocks render + connect.
 * Tests: liveRtpHud + batchSimulatorPanel + driftSentinel + backendSpinEngine.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5295;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)],
  { cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const findings = [];
function note(sev, msg) { findings.push({ sev, msg }); console.log(`[${sev}] ${msg}`); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => { if (!/serviceWorker/i.test(e.message)) errs.push(e.message); });

await page.goto(`http://127.0.0.1:${PORT}/dist/ingest/cash-lv3-s2/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const checks = await page.evaluate(() => ({
  hud: !!document.getElementById('liveRtpHud'),
  batchPanel: !!document.getElementById('batchSimPanel'),
  driftToast: !!document.getElementById('driftToast'),
  bspButtonCount: document.querySelectorAll('#batchSimPanel .bsp-btn').length,
  backendSession: window.__BACKEND_SESSION_ID__,
  backendStatus: window.__BACKEND_STATUS__,
  fetchSpinAvailable: typeof window.__BACKEND_FETCH_SPIN__ === 'function',
  hudTarget: window.__LIVE_RTP_TARGET__,
}));

note(checks.hud ? 'OK' : 'CRIT', `liveRtpHud DOM ${checks.hud ? 'present' : 'MISSING'}`);
note(checks.batchPanel ? 'OK' : 'CRIT', `batchSimPanel DOM ${checks.batchPanel ? 'present' : 'MISSING'}`);
note(checks.driftToast ? 'OK' : 'CRIT', `driftToast DOM ${checks.driftToast ? 'present' : 'MISSING'}`);
note(checks.bspButtonCount === 5 ? 'OK' : 'HIGH', `batch panel preset buttons: ${checks.bspButtonCount} (expected 5)`);
note(checks.backendSession ? 'OK' : 'CRIT', `backend session: ${checks.backendSession}`);
note(checks.fetchSpinAvailable ? 'OK' : 'CRIT', `__BACKEND_FETCH_SPIN__: ${checks.fetchSpinAvailable ? 'available' : 'missing'}`);
note('INFO', `target RTP: ${checks.hudTarget} · backend status: ${checks.backendStatus}`);

/* Test backend per-spin fetch live. */
const spinResult = await page.evaluate(async () => {
  if (typeof window.__BACKEND_FETCH_SPIN__ !== 'function') return null;
  const r = await window.__BACKEND_FETCH_SPIN__();
  return r;
});
if (spinResult && typeof spinResult.payX === 'number') {
  note('OK', `backend /spin live: payX=${spinResult.payX.toFixed(4)}, measuredRtp=${spinResult.measuredRtp.toFixed(4)}, n=${spinResult.sessionN}`);
} else {
  note('HIGH', `backend /spin returned: ${JSON.stringify(spinResult)?.slice(0, 100)}`);
}

/* Test batch button click — pick smallest preset (10K) to keep probe fast. */
await page.click('#batchSimPanel .bsp-btn[data-spins="10000"]');
await page.waitForTimeout(2000);
const batchOut = await page.$eval('#bspOut', el => el.textContent || '');
if (/spins/.test(batchOut) && /\d+\.\d+%/.test(batchOut)) {
  note('OK', `batch panel output: ${batchOut.slice(0, 100)}...`);
} else {
  note('HIGH', `batch panel output unclear: ${batchOut.slice(0, 100)}`);
}

if (errs.length > 0) note('HIGH', `${errs.length} pageerror(s): ${errs[0].slice(0, 100)}`);
else note('OK', '0 pageerrors');

const fail = findings.filter(f => f.sev === 'CRIT' || f.sev === 'FAIL').length;
console.log(`\nTotal: ${findings.length}, CRIT/FAIL: ${fail}`);

await browser.close();
srv.kill();
process.exit(fail > 0 ? 1 : 0);
