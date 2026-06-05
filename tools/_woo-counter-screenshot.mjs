#!/usr/bin/env node
/**
 * Capture WoO reference bigwin counter + our rectangular bigwin counter,
 * side-by-side, so we can compare layout/position exactly. Boki rule:
 * "nadji counter u WoO igri i ubaci ga na istom mestu" — first show what
 * is, then port.
 *
 * WoO: serve from ~/Projects/Wrath Of Olympus/dist and call window
 *      mainController?.bigWin?.show(winAmount, bet) — or manipulate DOM
 *      directly if the controller isn't on window.
 * Rectangular: serve from ./dist and click BW dugme.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/cortex-bigwin-compare';
mkdirSync(OUT, { recursive: true });

const WOO_PORT = 5210;
const FAC_PORT = 5211;
const wooServer = spawn('python3', ['-m', 'http.server', String(WOO_PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/Wrath Of Olympus/dist',
  stdio: 'ignore',
});
const facServer = spawn('python3', ['-m', 'http.server', String(FAC_PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 1200));

try {
  const browser = await chromium.launch();

  // ─── 1. WoO reference screenshot ─────────────────────────────────────
  const wooCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wooPage = await wooCtx.newPage();
  const wooErrors = [];
  wooPage.on('pageerror', e => wooErrors.push(e.message.slice(0, 200)));
  await wooPage.goto(`http://127.0.0.1:${WOO_PORT}/index.html`, { waitUntil: 'networkidle' });
  await wooPage.waitForTimeout(2000);

  // Try multiple strategies to surface the bigWin overlay so we can capture it
  const surfaced = await wooPage.evaluate(() => {
    // Strategy 1: direct DOM manipulation — show the overlay with tier 3 + 1500.00 value
    const ov = document.getElementById('bigWinOverlay');
    const title = document.getElementById('bigWinTitle');
    const value = document.getElementById('bigWinValue');
    if (!ov || !title || !value) return { ok: false, reason: 'no overlay elements' };
    ov.classList.remove('hidden');
    ov.classList.add('show', 'tier-3');
    ov.setAttribute('aria-hidden', 'false');
    ov.style.display = 'flex';
    ov.style.opacity = '1';
    title.textContent = 'EPIC WIN';
    value.textContent = '1500.00';
    return { ok: true };
  });
  console.log('WoO surface result:', surfaced);
  await wooPage.waitForTimeout(800);

  await wooPage.screenshot({ path: `${OUT}/woo-bigwin.png`, fullPage: false });
  console.log('Saved', `${OUT}/woo-bigwin.png`);

  // Capture bounds + computed style of #bigWinValue for the porting plan
  const wooLayout = await wooPage.evaluate(() => {
    const value = document.getElementById('bigWinValue');
    const title = document.getElementById('bigWinTitle');
    const content = document.getElementById('bigWinContent');
    const ov = document.getElementById('bigWinOverlay');
    function snap(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        rect: { x: r.x|0, y: r.y|0, w: r.width|0, h: r.height|0 },
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
        background: cs.background.slice(0, 200),
        backgroundImage: cs.backgroundImage.slice(0, 200),
        border: cs.border,
        padding: cs.padding,
        margin: cs.margin,
        boxShadow: cs.boxShadow.slice(0, 200),
        filter: cs.filter.slice(0, 200),
        textShadow: cs.textShadow.slice(0, 200),
        position: cs.position,
        zIndex: cs.zIndex,
        display: cs.display,
        flexDirection: cs.flexDirection,
        textContent: el.textContent,
      };
    }
    return {
      overlay: snap(ov),
      content: snap(content),
      title:   snap(title),
      value:   snap(value),
      viewportH: window.innerHeight,
      viewportW: window.innerWidth,
    };
  });
  console.log('\nWoO LAYOUT:');
  console.log(JSON.stringify(wooLayout, null, 2));

  await wooCtx.close();

  // ─── 2. Factory rectangular screenshot at the same climax moment ─────
  const facCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const facPage = await facCtx.newPage();
  const facErrors = [];
  facPage.on('pageerror', e => facErrors.push(e.message.slice(0, 200)));
  await facPage.goto(`http://127.0.0.1:${FAC_PORT}/dist/01_rectangular_5x3_playable.html`, { waitUntil: 'networkidle' });
  await facPage.waitForTimeout(800);
  await facPage.waitForFunction(() => {
    const bw = document.getElementById('devBwBtn');
    return bw && !bw.disabled;
  }, { timeout: 8000 }).catch(()=>{});

  // Force a climax-frame snapshot via programmatic enter, then capture during hold
  await facPage.evaluate(() => {
    const bet = window.__SLOT_BET__ || 1;
    window.bigWinTierEnter(5, 1500);
  });
  // Walk to climax: 5×4s tier walkthrough = 20s; capture 1s before end-hold completes
  await facPage.waitForTimeout(22000);

  await facPage.screenshot({ path: `${OUT}/factory-bigwin-rectangular.png`, fullPage: false });
  console.log('Saved', `${OUT}/factory-bigwin-rectangular.png`);

  const facLayout = await facPage.evaluate(() => {
    const banner = document.querySelector('.big-win-tier-banner');
    const label  = document.querySelector('.big-win-tier-label');
    const amount = document.querySelector('.big-win-tier-amount');
    const host   = document.getElementById('bigWinTierHost');
    function snap(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        rect: { x: r.x|0, y: r.y|0, w: r.width|0, h: r.height|0 },
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
        background: cs.background.slice(0, 200),
        backgroundImage: cs.backgroundImage.slice(0, 200),
        border: cs.border,
        padding: cs.padding,
        margin: cs.margin,
        boxShadow: cs.boxShadow.slice(0, 200),
        filter: cs.filter.slice(0, 200),
        textShadow: cs.textShadow.slice(0, 200),
        position: cs.position,
        zIndex: cs.zIndex,
        display: cs.display,
        flexDirection: cs.flexDirection,
        textContent: el.textContent,
      };
    }
    return {
      host:    snap(host),
      banner:  snap(banner),
      label:   snap(label),
      amount:  snap(amount),
      viewportH: window.innerHeight,
      viewportW: window.innerWidth,
    };
  });
  console.log('\nFACTORY LAYOUT:');
  console.log(JSON.stringify(facLayout, null, 2));

  await facCtx.close();
  await browser.close();
} finally {
  wooServer.kill();
  facServer.kill();
}
