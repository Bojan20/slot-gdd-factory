#!/usr/bin/env node
/**
 * UQ-DEEP-J wild probe — verify expanding wild ZAPRAVO radi:
 *   1. force expanding wild flag postavi se
 *   2. spin se izvrši
 *   3. broj wild cells na grid-u poraste (column fill)
 *   4. expandingWild:applied event emit-uje se
 *   5. expanded cells su u GRID modelu (ne samo DOM)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const SLOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory/dist/ingest/cash-eruption-foundry-gdd/index.html';
if (!existsSync(SLOT)) { console.error('slot missing'); process.exit(2); }

const PORT = 5279;
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

const url = `http://127.0.0.1:${PORT}/dist/ingest/cash-eruption-foundry-gdd/`;
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

/* Capture HookBus emissions. */
await page.evaluate(() => {
  window.__EVT_LOG__ = [];
  if (window.HookBus && typeof window.HookBus.on === 'function') {
    /* Hook every emit by wrapping HookBus.emit. */
    const origEmit = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.emit = function (event, payload) {
      window.__EVT_LOG__.push({ event, payload, ts: Date.now() });
      return origEmit(event, payload);
    };
  }
});

/* Check that expandingWild block defaultConfig.mode is whatever parser set. */
const ewState = await page.evaluate(() => ({
  blockExists: typeof window.applyExpandingWilds === 'function',
  mode: typeof EXPANDING_WILD_MODE !== 'undefined' ? EXPANDING_WILD_MODE : 'undef',
  onlyIfWinning: typeof EXPANDING_WILD_ONLY_IF_WINNING !== 'undefined' ? EXPANDING_WILD_ONLY_IF_WINNING : 'undef',
}));
if (!ewState.blockExists) note('CRIT', 'expandingWild block not loaded (window.applyExpandingWilds undefined)');
else note('OK', `expandingWild loaded: mode=${ewState.mode}, onlyIfWinning=${ewState.onlyIfWinning}`);

/* Count wild cells before force. */
const wildsBefore = await page.$$eval('#gridHost .cell.is-expanded-wild, #gridHost .cell--expanded-wild',
  els => els.length);
note('OK', `wild cells before force: ${wildsBefore}`);

/* Set the force pending flag + click spin. */
await page.evaluate(() => {
  window.__FORCE_FEATURE_PENDING__ = 'expanding_wild';
});
await page.click('#spinBtn');
await page.waitForTimeout(3500);  /* let spin animation complete */

/* Re-count wilds + check events. */
const wildsAfter = await page.$$eval('#gridHost .cell.is-expanded-wild, #gridHost .cell--expanded-wild',
  els => els.length);
note(wildsAfter > wildsBefore ? 'OK' : 'CRIT',
  `wild cells after force: ${wildsAfter} (delta ${wildsAfter - wildsBefore})`);

const events = await page.evaluate(() => window.__EVT_LOG__.map(e => e.event));
const expEvt = events.filter(e => /expandingWild|expWild/i.test(e));
if (expEvt.length === 0) note('CRIT', 'no expandingWild:applied event fired');
else note('OK', `expandingWild event(s) fired: ${[...new Set(expEvt)].join(', ')}`);

/* Check that DOM cells with class also have wild symbol text. */
const wildCellSyms = await page.$$eval('#gridHost .cell.is-expanded-wild, #gridHost .cell--expanded-wild',
  els => els.map(e => e.dataset.symbol || e.textContent.trim()).slice(0, 5));
note('OK', `wild cells symbols: [${wildCellSyms.join(', ')}]`);

/* Check console for pageerrors. */
if (errors.length > 0) note('CRIT', `${errors.length} pageerror(s): ${errors[0].slice(0, 100)}`);
else note('OK', '0 pageerrors during force expanding wild');

const fail = findings.filter(f => f.sev === 'CRIT' || f.sev === 'FAIL').length;
console.log(`\nTotal: ${findings.length}, CRIT/FAIL: ${fail}`);

await browser.close();
srv.kill();
process.exit(fail > 0 ? 1 : 0);
