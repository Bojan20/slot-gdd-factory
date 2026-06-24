#!/usr/bin/env node
/**
 * LV3 HUD probe — verify Live RTP HUD overlay renders + connects to
 * math-backend on port 9001.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5285;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)],
  { cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const findings = [];
function note(sev, msg) { findings.push({ sev, msg }); console.log(`[${sev}] ${msg}`); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { if (!/serviceWorker/i.test(e.message)) errors.push(e.message); });

await page.goto(`http://127.0.0.1:${PORT}/dist/ingest/cash-eruption-lv3/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const hudPresent = await page.$('#liveRtpHud').then(el => !!el);
note(hudPresent ? 'OK' : 'CRIT', `#liveRtpHud DOM ${hudPresent ? 'present' : 'MISSING'}`);

const state = await page.evaluate(() => ({
  target: window.__LIVE_RTP_TARGET__,
  hud: window.__LIVE_RTP_HUD__ ? {
    n: window.__LIVE_RTP_HUD__.n,
    backendOk: window.__LIVE_RTP_HUD__.backendOk,
    sessionId: window.__LIVE_RTP_HUD__.sessionId,
  } : null,
  driftBadge: document.getElementById('lrhDrift')?.textContent,
  targetText: document.getElementById('lrhTarget')?.textContent,
}));
note(state.target ? 'OK' : 'CRIT', `target RTP = ${state.target}`);
note(state.hud ? 'OK' : 'CRIT', `__LIVE_RTP_HUD__ exposed: ${JSON.stringify(state.hud)}`);
note(state.hud?.backendOk ? 'OK' : 'HIGH', `backend health: ${state.hud?.backendOk ? 'connected' : 'OFFLINE'}`);
note('INFO', `drift badge text: "${state.driftBadge}"`);
note('INFO', `target HUD text: "${state.targetText}"`);

/* Simulate 3 spins via recordSpin API. */
const spinResults = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 3; i++) {
    window.__LAST_SPIN_WIN__ = i === 1 ? 5 : 0;  /* 1 win of 5x */
    window.__SLOT_BET__ = 1;
    if (typeof window.__LIVE_RTP_RECORD__ === 'function') {
      window.__LIVE_RTP_RECORD__(i === 1 ? 5 : 0);
    }
    out.push({
      n: window.__LIVE_RTP_HUD__?.n,
      rtpSum: window.__LIVE_RTP_HUD__?.rtpSum,
    });
  }
  return out;
});
note('INFO', `3 simulated spins: ${JSON.stringify(spinResults)}`);
note(spinResults[2]?.n === 3 ? 'OK' : 'FAIL', `spin counter ended at n=${spinResults[2]?.n}`);

if (errors.length > 0) note('HIGH', `${errors.length} pageerror(s): ${errors[0].slice(0, 100)}`);
else note('OK', '0 pageerrors');

const fail = findings.filter(f => f.sev === 'CRIT' || f.sev === 'FAIL').length;
console.log(`\nTotal: ${findings.length}, CRIT/FAIL: ${fail}`);

await browser.close();
srv.kill();
process.exit(fail > 0 ? 1 : 0);
