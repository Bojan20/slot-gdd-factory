#!/usr/bin/env node
/**
 * Quick "all buttons present + visible + clickable" audit.
 *
 * Runs against the served dist build and returns:
 *  - per-button: { id, exists, visible, rect, computedDisplay, occluded }
 *  - layout box of side HUD, hub and floating CTAs
 *  - one fullPage screenshot
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const OUT = '/tmp/cortex-buttons-audit';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PORT = 5187;
const URL = `http://127.0.0.1:${PORT}/dist/01_rectangular_5x3_playable.html`;

// Spawn a tiny server
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory',
  stdio: 'ignore',
});

await new Promise((r) => setTimeout(r, 700));

const BUTTONS = [
  'spinBtn',
  'autoBtn',
  'autoplayBtn',
  'turboBtn',
  'paytableBtn',
  'historyBtn',
  'settingsBtn',
  'betStepDown',
  'betChip',
  'betStepUp',
  'devFsBtn',
  'slamStopBtn',
  'forceSkipBtn',
  'bonusBuyBtn',
  'anteBetToggle',
];

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const report = await page.evaluate((ids) => {
    function probe(id) {
      const el = document.getElementById(id);
      if (!el) return { id, exists: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const hidden = el.hidden || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
      const inViewport = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      // Hit-test the center of the rect to detect occlusion
      let occludedBy = null;
      if (!hidden && r.width > 4 && r.height > 4) {
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== el && !el.contains(hit)) {
          occludedBy = hit.id ? `#${hit.id}` : hit.tagName.toLowerCase() + (hit.className ? '.' + String(hit.className).split(' ')[0] : '');
        }
      }
      return {
        id, exists: true, hidden,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        inViewport,
        occludedBy,
      };
    }
    return ids.map(probe);
  }, BUTTONS);

  const screenshot = resolvePath(OUT, 'page.png');
  await page.screenshot({ path: screenshot, fullPage: false });

  // Pretty print
  console.log('\n=== BUTTON AUDIT ===');
  console.log('URL:', URL);
  console.log('viewport: 1440×900\n');
  const rows = report.map((r) => {
    if (!r.exists) return [r.id, '❌ NOT IN DOM', '', '', '', ''];
    const flag = r.hidden ? '⛔ hidden' : (r.occludedBy ? `⚠ occluded by ${r.occludedBy}` : (r.inViewport ? '✅' : '❌ off-screen'));
    return [r.id, flag, `${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h}`, r.display, r.opacity, r.zIndex];
  });
  const headers = ['button', 'state', 'rect', 'display', 'opacity', 'z'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] || '').length)));
  const fmt = (cols) => cols.map((c, i) => String(c || '').padEnd(widths[i])).join('  ');
  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmt(r));
  console.log(`\nscreenshot: ${screenshot}`);
  console.log(`console errors: ${errs.length}`);
  for (const e of errs.slice(0, 5)) console.log('  •', e);

  writeFileSync(resolvePath(OUT, 'report.json'), JSON.stringify({ report, errs }, null, 2));

  await browser.close();
} finally {
  server.kill('SIGTERM');
}
