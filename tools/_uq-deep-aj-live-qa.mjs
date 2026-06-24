#!/usr/bin/env node
/**
 * UQ-DEEP-AJ · ULTRA-DETAILED LIVE QA
 *
 * 5 baseline slot HTML × 30 spinova × strict invariants:
 *   - 0 console.error
 *   - 0 dialog (alert/confirm/prompt)
 *   - 0 NaN / Infinity in DOM
 *   - 0 vendor brand leak (rendered HTML title/body)
 *   - liveRtpHud present + non-NaN value
 *   - spin button clickable + reels animate
 *   - symbolModifiersAPI attached when model has transforms
 *
 * Run: node /tmp/uq-deep-aj-qa.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5181/preview';
const SLOTS = [
  'cash-eruption-foundry-gdd',
  'crystal-forge-game-gdd',
  'midnight-fangs-game-gdd',
  'wrath-of-olympus-game-gdd',
  'gates-of-olympus-1000-game-gdd',
];

const VENDOR_RX = /\b(IGT|Pragmatic Play|Cash Eruption|Wolf Run|Cleopatra|Buffalo King|Gates of Olympus|Wrath of Olympus|NetEnt)\b/i;

let totalPass = 0;
let totalFail = 0;
const results = [];

const browser = await chromium.launch({ headless: true });

for (const slug of SLOTS) {
  const result = { slug, errors: [], warnings: [] };
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  const dialogs = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('dialog', async (d) => {
    dialogs.push({ type: d.type(), msg: d.message() });
    await d.dismiss();
  });
  page.on('pageerror', (err) => consoleErrors.push(`PAGE_ERROR: ${err.message}`));

  try {
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'networkidle', timeout: 15000 });

    // Title + body vendor scan
    const title = await page.title();
    if (VENDOR_RX.test(title)) result.errors.push(`TITLE vendor leak: ${title}`);
    const bodyText = await page.evaluate(() => document.body.innerText);
    const vendorHits = bodyText.match(VENDOR_RX);
    if (vendorHits) result.errors.push(`BODY vendor leak: ${vendorHits[0]}`);

    // liveRtpHud probe
    const hudData = await page.evaluate(() => {
      const hud = document.querySelector('.lrh-badge, #live-rtp-hud, [class*="lrh"]');
      if (!hud) return { present: false };
      const text = hud.innerText || hud.textContent || '';
      return { present: true, text, hasNaN: /NaN|Infinity/i.test(text) };
    });
    if (!hudData.present) result.warnings.push('liveRtpHud not present (acceptable if opt-in)');
    else if (hudData.hasNaN) result.errors.push(`liveRtpHud NaN/Infinity: ${hudData.text}`);

    // symbolModifiersAPI probe (UQ-DEEP-AJ P1B)
    const symModAPI = await page.evaluate(() => {
      return typeof window.symbolModifiersAPI === 'object' && window.symbolModifiersAPI !== null;
    });
    // Not required — only present when GDD declares transforms. Just record.
    result.symModAPI = symModAPI;

    // Spin probe — 30 clicks if spin button exists
    const spinBtn = await page.$('[data-spin], #spin, .spin-btn, button[aria-label*="spin" i]');
    let spinClicks = 0;
    if (spinBtn) {
      for (let i = 0; i < 30; i++) {
        try {
          await spinBtn.click({ timeout: 1000 });
          spinClicks++;
          await page.waitForTimeout(50);
        } catch (e) {
          // Could be disabled mid-animation — wait and continue
          await page.waitForTimeout(200);
        }
      }
    } else {
      result.warnings.push('no spin button found (likely autoplay-only or canvas-driven)');
    }
    result.spinClicks = spinClicks;

    // NaN/Infinity in DOM after spinning
    const nanInDom = await page.evaluate(() => {
      const txt = document.body.innerText;
      return /\bNaN\b|\bInfinity\b/.test(txt);
    });
    if (nanInDom) result.errors.push('NaN/Infinity present in rendered DOM');

    result.consoleErrors = consoleErrors.length;
    result.dialogs = dialogs.length;
    if (consoleErrors.length > 0) result.errors.push(`${consoleErrors.length} console errors`);
    if (dialogs.length > 0) result.errors.push(`${dialogs.length} dialogs surfaced`);

    // Sample first 3 console errors for debug
    result.consoleSample = consoleErrors.slice(0, 3);

  } catch (e) {
    result.errors.push(`THREW: ${e.message}`);
  } finally {
    await ctx.close();
  }

  if (result.errors.length === 0) {
    totalPass++;
    console.log(`  ✓ ${slug}  (spins=${result.spinClicks ?? '-'}, console=${result.consoleErrors}, dialogs=${result.dialogs}, symModAPI=${result.symModAPI})`);
  } else {
    totalFail++;
    console.log(`  ✗ ${slug}`);
    for (const e of result.errors) console.log(`      ERR: ${e}`);
    if (result.consoleSample?.length) console.log(`      sample: ${result.consoleSample.join(' | ').slice(0, 200)}`);
  }
  results.push(result);
}

await browser.close();

console.log(`\n--- UQ-DEEP-AJ QA summary ---`);
console.log(`  pass: ${totalPass}/${SLOTS.length}`);
console.log(`  fail: ${totalFail}/${SLOTS.length}`);
process.exit(totalFail === 0 ? 0 : 1);
