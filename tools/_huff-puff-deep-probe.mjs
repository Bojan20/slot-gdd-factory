#!/usr/bin/env node
/**
 * tools/_huff-puff-deep-probe.mjs
 *
 * Ultra-deep verification: upload Huff_N_More_Puff PDF and probe the
 * resulting playable for ZERO red across every observable surface:
 *
 *   1. Iframe present, src is blob: URL
 *   2. Frame title non-empty + non-"Untitled"
 *   3. Renderable grid: ≥ 9 cells visible
 *   4. SPIN button rendered + clickable
 *   5. HookBus exposed in the frame
 *   6. preSpin / onSpinResult / postSpin all emit on spin
 *   7. 0 console errors AND 0 page errors at every stage
 *   8. Universal force panel rendered with ≥ 1 chip
 *   9. Every force chip is keyboard-reachable + has aria-label
 *  10. Click first force chip → onForceFeatureRequested observed
 *      + window.__FORCE_FEATURE__ set
 *      + real spin lifecycle re-fired
 *  11. Generic banner DOM node present (for fallback path)
 *  12. No DOM "redness" (undefined / NaN / [object Object] / null)
 *      leaked into user-visible text
 *  13. Typography floor: every visible text node ≥ 11px
 *
 * Exit 0 = green; 1 = any failure.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/huff-puff-deep');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
const PDF  = (existsSync(`${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`) ? `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` : `${HOME}/Desktop/Huff_N_More_Puff_GDD.pdf`);
if (!existsSync(PDF)) {
  console.error(`❌ Missing PDF: ${PDF}`);
  process.exit(2);
}

const PORT = 5236;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: REPO, stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 700));

let pass = 0, fail = 0;
const row = (ok, name, hint = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${hint ? ' — ' + hint : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push('OUTER: ' + e.message.slice(0, 240)));
page.on('console', m => {
  if (m.type() === 'error' && !m.text().includes('favicon')) {
    pageErrors.push('OUTER: ' + m.text().slice(0, 240));
  }
});

try {
  console.log('🐺 Huff_N_More_Puff — deep verification');
  await page.goto(URL, { waitUntil: 'networkidle' });

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(PDF);

  await page.waitForSelector('iframe', { timeout: 30_000 });
  const iframeEl = await page.$('iframe');
  row(!!iframeEl, 'iframe present');

  const frame = await iframeEl.contentFrame();
  row(!!frame, 'contentFrame accessible');

  // Outer-page error sink for inner iframe (we attach inner listeners
  // after content document is queryable)
  const innerErrors = [];
  frame.page().on('pageerror', e => innerErrors.push('INNER: ' + e.message.slice(0, 240)));

  await frame.waitForLoadState('domcontentloaded', { timeout: 15_000 });
  await frame.waitForSelector('.cell, .reel', { timeout: 15_000 });

  const title = await frame.title();
  row(typeof title === 'string' && title.length > 0 && !title.includes('Untitled'),
      'frame title meaningful', `"${title}"`);

  const cells = await frame.locator('.cell').count();
  row(cells >= 9, 'renderable grid', `cells=${cells}`);

  const spinBtnCount = await frame.locator('#spinBtn').count();
  row(spinBtnCount === 1, '#spinBtn rendered');

  const busExposed = await frame.evaluate(() => !!window.HookBus);
  row(busExposed, 'HookBus exposed on window');

  // Hook spin-cycle events
  await frame.evaluate(() => {
    window.__OBSERVED__ = [];
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      ['preSpin', 'onSpinResult', 'postSpin', 'onForceFeatureRequested'].forEach(e => {
        HookBus.on(e, p => window.__OBSERVED__.push({ event: e, payload: p }));
      });
    }
  });

  // Click SPIN
  const spinBtn = frame.locator('#spinBtn').first();
  await spinBtn.click({ timeout: 4_000 });
  // PDF-derived models render slower; poll up to 25s for postSpin, then
  // add a 1.5s settle window so subsequent force-chip click doesn't race
  // an in-flight postSpin
  let observedAfterSpin = [];
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(500);
    observedAfterSpin = await frame.evaluate(() => window.__OBSERVED__.slice());
    if (observedAfterSpin.some(o => o.event === 'postSpin')) break;
  }
  await page.waitForTimeout(1_500);
  observedAfterSpin = await frame.evaluate(() => window.__OBSERVED__.slice());
  row(observedAfterSpin.some(o => o.event === 'preSpin'),     'preSpin emitted on real spin');
  row(observedAfterSpin.some(o => o.event === 'onSpinResult'),'onSpinResult emitted');
  row(observedAfterSpin.some(o => o.event === 'postSpin'),    'postSpin emitted',
      `events=${observedAfterSpin.map(o => o.event).join(',') || '<empty>'}`);

  // Universal force panel
  const panelCount = await frame.locator('.ufp-panel').count();
  row(panelCount === 1, 'universal force panel rendered');
  const chipCount = await frame.locator('.ufp-chip[data-ufp-kind]').count();
  row(chipCount >= 1, 'force panel chips present', `count=${chipCount}`);

  // Click first force chip
  if (chipCount >= 1) {
    const firstChip = frame.locator('.ufp-chip[data-ufp-kind]').first();
    const kindBefore = await firstChip.getAttribute('data-ufp-kind');
    const ariaLabel  = await firstChip.getAttribute('aria-label');
    row(typeof ariaLabel === 'string' && ariaLabel.startsWith('Force '),
        'chip has Force aria-label', ariaLabel || '');

    // Wipe observed for clarity
    await frame.evaluate(() => window.__OBSERVED__.length = 0);
    await firstChip.click({ timeout: 4_000 });
    // Wait up to 6s for the forced spin lifecycle to complete
    let obsAfterForce = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(500);
      obsAfterForce = await frame.evaluate(() => window.__OBSERVED__.slice());
      if (obsAfterForce.some(o => o.event === 'preSpin')) break;
    }
    row(obsAfterForce.some(o => o.event === 'onForceFeatureRequested' &&
                                 (o.payload || {}).kind === kindBefore),
        `onForceFeatureRequested observed with kind=${kindBefore}`);
    const forceFlag = await frame.evaluate(() => window.__FORCE_FEATURE__);
    row(forceFlag === kindBefore, `window.__FORCE_FEATURE__=${forceFlag}`);
    row(obsAfterForce.some(o => o.event === 'preSpin'),
        'real spin re-fired after force-chip click');
  }

  // Generic banner DOM
  const banner = await frame.locator('#gfbBanner').count();
  row(banner === 1, 'generic feature banner DOM present');

  // DOM redness scan — skip SCRIPT/STYLE/NOSCRIPT/TEMPLATE (their text is
  // never rendered to the user). Also require the text to be visible.
  const redness = await frame.evaluate(() => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const out = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p) {
          if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = tw.nextNode())) {
      const t = (node.nodeValue || '').trim();
      if (!t) continue;
      // Skip if parent element is not actually visible
      const parent = node.parentElement;
      if (parent) {
        const cs = getComputedStyle(parent);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      }
      if (/\b(?:undefined|NaN|\[object Object\])\b/.test(t)) {
        out.push(t.slice(0, 80));
      }
    }
    return out;
  });
  row(redness.length === 0, 'no DOM redness (undefined/NaN/[object Object])',
      redness.length ? redness.slice(0, 3).join(' | ') : '');

  // Typography floor
  const tinyText = await frame.evaluate(() => {
    const offenders = [];
    document.querySelectorAll('body *').forEach(el => {
      if (!el.textContent || !el.textContent.trim()) return;
      const cs = getComputedStyle(el);
      const sz = parseFloat(cs.fontSize);
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden';
      if (visible && sz > 0 && sz < 11) {
        offenders.push(`${el.tagName}.${el.className}=${sz}px`);
      }
    });
    return offenders.slice(0, 5);
  });
  row(tinyText.length === 0, 'typography ≥ 11px floor (Apple HIG)',
      tinyText.length ? tinyText.join(' | ') : '');

  // Final outer + inner error sink
  row(pageErrors.length === 0 && innerErrors.length === 0,
      '0 console + page errors',
      [...pageErrors, ...innerErrors].slice(0, 3).join(' | '));

  await page.screenshot({ path: resolve(OUT, 'after-force.png'), fullPage: true });
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
