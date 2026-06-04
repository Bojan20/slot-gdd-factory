#!/usr/bin/env node
/**
 * Open autoplay modal headless, screenshot, audit interactive elements.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = '/tmp/cortex-autoplay';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5189;
const URL = `http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  // Idle screenshot
  await page.screenshot({ path: resolve(OUT, '01-idle.png') });

  // Click the sideHud autoBtn
  await page.click('#autoBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, '02-modal-open.png') });

  // Audit modal contents
  const audit = await page.evaluate(() => {
    function probe(id) {
      const el = document.getElementById(id);
      if (!el) return { id, exists: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id,
        exists: true,
        hidden: el.hidden,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0',
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    }
    const stepCount = document.querySelectorAll('#autoplaySteps .autoplay-step').length;
    const stepSelected = document.querySelector('#autoplaySteps .autoplay-step.is-selected');
    return {
      backdrop: probe('autoplayBackdrop'),
      modal: probe('autoplayModal'),
      title: probe('autoplayTitle'),
      closeBtn: probe('autoplayCloseBtn'),
      steps: probe('autoplaySteps'),
      stepCount,
      stepSelected: stepSelected ? stepSelected.textContent : null,
      featureToggle: probe('autoplayStopFeatureToggle'),
      swxInput: probe('autoplayStopSingleWinX'),
      winInput: probe('autoplayStopWinAbove'),
      lossInput: probe('autoplayStopLossAbove'),
      cancelBtn: probe('autoplayCancelBtn'),
      startBtn: probe('autoplayStart'),
    };
  });

  console.log('\n=== AUTOPLAY MODAL AUDIT ===');
  console.log(JSON.stringify(audit, null, 2));

  // Toggle the feature switch, fill an input, then close via ESC
  await page.click('#autoplayStopFeatureToggle');
  await page.fill('#autoplayStopSingleWinX', '50');
  await page.fill('#autoplayStopWinAbove', '100');
  await page.fill('#autoplayStopLossAbove', '25');
  await page.screenshot({ path: resolve(OUT, '03-modal-filled.png') });

  const stateAfter = await page.evaluate(() => {
    return {
      togglePressed: document.getElementById('autoplayStopFeatureToggle').getAttribute('aria-pressed'),
      swx: document.getElementById('autoplayStopSingleWinX').value,
      win: document.getElementById('autoplayStopWinAbove').value,
      loss: document.getElementById('autoplayStopLossAbove').value,
    };
  });
  console.log('\nstate after edit:', stateAfter);

  // Press ESC
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const escClosed = await page.evaluate(() => document.getElementById('autoplayBackdrop').hidden);
  console.log('ESC closed modal:', escClosed);
  await page.screenshot({ path: resolve(OUT, '04-after-esc.png') });

  console.log('\nconsole errors:', errs.length);
  for (const e of errs.slice(0, 6)) console.log('  •', e);
  console.log('\nscreenshots:', OUT);

  await browser.close();
} finally {
  server.kill('SIGTERM');
}
