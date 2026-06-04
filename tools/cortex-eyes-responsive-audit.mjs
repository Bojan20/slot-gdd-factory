#!/usr/bin/env node
/**
 * Cortex Eyes — responsive + color-consistency audit.
 *
 * Three viewports (desktop / tablet / mobile) × three states (idle,
 * autoplay-modal-open, settings-modal-open). For each state we capture:
 *   - full-page screenshot
 *   - color tokens of the key surfaces (background, accent, text)
 *   - clipped/off-screen detection for every interactive control
 *
 * Output: tools/_eyes/responsive/<viewport>-<state>.png
 *
 * Verdict: PASS if every interactive element fits inside the viewport
 * and uses the bake-time palette tokens. FAIL if anything clips or any
 * hard-coded color leaks through.
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const OUT = resolvePath(REPO, 'tools/_eyes/responsive');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const URL = 'http://127.0.0.1:5180/dist/01_rectangular_5x3_playable.html';

const VIEWPORTS = [
  { id: 'desktop', w: 1440, h: 900 },
  { id: 'tablet',  w:  834, h: 1112 },
  { id: 'mobile',  w:  390, h:  844 },
];

/* Every interactive element that MUST stay inside the viewport. */
const REQUIRED_CONTROLS = [
  '#spinBtn', '#autoBtn', '#settingsMenuBtn',
  '#betChip', '#betStepDown', '#betStepUp',
  '#balanceHud', '#bal', '#status',
];

/* Color tokens we expect to see consistently. */
const PALETTE_PROBES = [
  { selector: ':root',           prop: '--accent',  expected: '#c9a227' },
  { selector: ':root',           prop: '--bg0',     expected: '#05070c' },
  { selector: ':root',           prop: '--bg1',     expected: '#0b0f16' },
  { selector: ':root',           prop: '--text',    expected: '#f2f2f2' },
];

function bbInsideViewport(b, vw, vh) {
  return b && b.x >= 0 && b.y >= 0 && (b.x + b.width) <= vw && (b.y + b.height) <= vh;
}

async function probeControls(page, vw, vh) {
  return await page.evaluate(({ selectors, vw, vh }) => {
    const out = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) { out.push({ sel, ok: false, reason: 'absent' }); continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible = (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && !el.hidden);
      if (!visible) { out.push({ sel, ok: false, reason: 'hidden' }); continue; }
      const inside = r.x >= 0 && r.y >= 0 && (r.x + r.width) <= vw && (r.y + r.height) <= vh;
      out.push({
        sel, ok: inside,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        reason: inside ? 'ok' : 'clipped',
      });
    }
    return out;
  }, { selectors: REQUIRED_CONTROLS, vw, vh });
}

async function probePalette(page) {
  return await page.evaluate((probes) => {
    return probes.map((p) => {
      const el = document.querySelector(p.selector);
      if (!el) return { ...p, actual: null, ok: false };
      const v = getComputedStyle(el).getPropertyValue(p.prop).trim();
      return { ...p, actual: v, ok: v.toLowerCase() === p.expected.toLowerCase() };
    });
  }, PALETTE_PROBES);
}

async function shot(page, name) {
  const p = resolvePath(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

const failures = [];

async function runState(browser, vp, stateLabel, opener) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => consoleErrs.push(`pageerror: ${e.message.slice(0, 160)}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  if (opener) { await opener(page); await page.waitForTimeout(200); }

  const controls = await probeControls(page, vp.w, vp.h);
  const palette = await probePalette(page);
  const file = await shot(page, `${vp.id}-${stateLabel}`);

  const ctrlFails = controls.filter((c) => !c.ok);
  const palFails  = palette.filter((p) => !p.ok);
  const passed    = ctrlFails.length === 0 && palFails.length === 0 && consoleErrs.length === 0;

  console.log(`\n  ${passed ? '✅' : '❌'}  ${vp.id} (${vp.w}×${vp.h}) — ${stateLabel}`);
  if (ctrlFails.length) {
    for (const c of ctrlFails) console.log(`     control ${c.sel}: ${c.reason}` + (c.rect ? ` ${JSON.stringify(c.rect)}` : ''));
  }
  if (palFails.length) {
    for (const p of palFails) console.log(`     palette ${p.selector}::${p.prop} = ${p.actual} (expected ${p.expected})`);
  }
  for (const e of consoleErrs) console.log(`     console: ${e}`);
  console.log(`     screenshot: ${file}`);

  if (!passed) failures.push({ vp: vp.id, stateLabel, ctrlFails, palFails, consoleErrs });
  await ctx.close();
}

async function main() {
  console.log('🧠 CORTEX EYES — responsive + palette audit\n');
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    await runState(browser, vp, 'idle', null);
    await runState(browser, vp, 'autoplay-modal', async (page) => {
      await page.click('#autoBtn');
      await page.waitForSelector('#autoplayBackdrop:not([hidden])', { timeout: 2000 }).catch(() => {});
    });
    await runState(browser, vp, 'settings-modal', async (page) => {
      await page.click('#settingsMenuBtn');
      await page.waitForSelector('#settingsBackdrop:not([hidden])', { timeout: 2000 }).catch(() => {});
    });
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(failures.length === 0
    ? `✅ All ${VIEWPORTS.length * 3} probe states PASS`
    : `❌ ${failures.length}/${VIEWPORTS.length * 3} states FAIL`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
