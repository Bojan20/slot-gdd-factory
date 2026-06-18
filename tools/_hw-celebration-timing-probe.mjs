#!/usr/bin/env node
/**
 * tools/_hw-celebration-timing-probe.mjs
 *
 * Boki: "ne ceka se da se zavrse svi reel stopovi i da ide animacija
 * bonus simbola". Surgical probe to PROVE the celebration is gated
 * correctly: measures the gap between (a) the moment every reel reports
 * spinning=false + stopping=false + bouncing=false, and (b) the moment
 * the bonus-celebrate badge mounts on the DOM.
 *
 * Expected output: badge mounts AFTER reels-settled (positive delta).
 * If delta is negative, the gate is broken.
 *
 * Output:
 *   reports/hw-celebration-timing/result.json
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5292;
const OUT = `${REPO}/reports/hw-celebration-timing`;
mkdirSync(OUT, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', RST = '\x1b[0m';

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.setInputFiles('#fileInput', PDF);
await page.waitForSelector('#previewFrame', { timeout: 30000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());
await frame.waitForFunction(() => !!document.querySelector('.gridHost .cell'), { timeout: 12000 });
await frame.waitForTimeout(800);

console.log('═══ HnP H&W CELEBRATION TIMING PROBE ═════════════════════════════════════');

// Install precision timeline IN-PAGE
await frame.evaluate(() => {
  window.__HW_T = { reelsSettledAt: null, celebrateStartedAt: null, spinResultAt: null, postSpinAt: null, introMountedAt: null, samples: [] };
  const T0 = performance.now();
  // Hook into HookBus to capture event timestamps
  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onSpinResult', () => {
      if (window.__HW_T.spinResultAt === null) window.__HW_T.spinResultAt = Math.round(performance.now() - T0);
    }, { priority: 999 });
    window.HookBus.on('postSpin', () => {
      if (window.__HW_T.postSpinAt === null) window.__HW_T.postSpinAt = Math.round(performance.now() - T0);
    }, { priority: 999 });
    window.HookBus.on('onHoldAndWinIntro', () => {
      if (window.__HW_T.introMountedAt === null) window.__HW_T.introMountedAt = Math.round(performance.now() - T0);
    }, { priority: 999 });
  }
  // MutationObserver on gridHost classList for is-hnw-bonus-celebrating
  const host = document.getElementById('gridHost') || document.querySelector('.gridHost');
  if (host) {
    const mo = new MutationObserver(() => {
      if (host.classList.contains('is-hnw-bonus-celebrating') && window.__HW_T.celebrateStartedAt === null) {
        window.__HW_T.celebrateStartedAt = Math.round(performance.now() - T0);
      }
    });
    mo.observe(host, { attributes: true, attributeFilter: ['class'] });
  }
  // Tight 10ms poll to detect EXACT moment all reels settle
  const id = setInterval(() => {
    const reels = window.RECT_REELS || [];
    if (reels.length === 0) return;
    const anyActive = reels.some(r => r.spinning || r.stopping || r.bouncing);
    const now = Math.round(performance.now() - T0);
    // Sample EVERY tick to find first frame where anyActive flipped from true to false
    const last = window.__HW_T.samples[window.__HW_T.samples.length - 1];
    if (!last || last.anyActive !== anyActive) {
      window.__HW_T.samples.push({ t: now, anyActive, spinning: reels.filter(r=>r.spinning).length, stopping: reels.filter(r=>r.stopping).length, bouncing: reels.filter(r=>r.bouncing).length });
    }
    if (!anyActive && window.__HW_T.reelsSettledAt === null) {
      window.__HW_T.reelsSettledAt = now;
    }
  }, 10);
  setTimeout(() => clearInterval(id), 10000);
});

// Click H&W chip → drives a base spin with FORCE_TRIGGER bonus pile
console.log(`${D}→ Click H&W chip → wait 6s${RST}`);
await frame.evaluate(() => {
  const c = document.querySelector('[data-ufp-kind="hold_and_win"]');
  if (c) c.click();
});
await page.waitForTimeout(6000);

const t = await frame.evaluate(() => window.__HW_T);
const { reelsSettledAt, celebrateStartedAt, spinResultAt, postSpinAt, introMountedAt, samples } = t;

console.log(`\n${Y}═══ TIMING ═══${RST}`);
console.log(`  Reels truly settled at:  ${reelsSettledAt}ms`);
console.log(`  onSpinResult emitted at: ${spinResultAt}ms`);
console.log(`  postSpin emitted at:     ${postSpinAt}ms`);
console.log(`  Celebration started at:  ${celebrateStartedAt}ms`);
console.log(`  Intro mounted at:        ${introMountedAt}ms`);

const delta = celebrateStartedAt !== null && reelsSettledAt !== null ? (celebrateStartedAt - reelsSettledAt) : null;
console.log(`\n${Y}═══ DELTA ═══${RST}`);
console.log(`  Celebration_start − Reels_settled = ${delta}ms`);
if (delta === null) {
  console.log(`  ${R}✗ Could not measure (one timestamp missing)${RST}`);
} else if (delta < 0) {
  console.log(`  ${R}✗ BAD: celebration fired BEFORE reels settled (${delta}ms)${RST}`);
} else if (delta > 500) {
  console.log(`  ${Y}⚠ Celebration delayed ${delta}ms after reels settled — feels sluggish${RST}`);
} else {
  console.log(`  ${G}✓ Celebration fired ${delta}ms AFTER reels settled (correct gate)${RST}`);
}

console.log(`\n${D}Samples (anyActive flips):${RST}`);
for (const s of samples) {
  console.log(`  t=${String(s.t).padStart(5)}ms  active=${s.anyActive ? 'Y' : '.'}  spin=${s.spinning} stop=${s.stopping} bounce=${s.bouncing}`);
}

writeFileSync(`${OUT}/result.json`, JSON.stringify(t, null, 2));

await ctx.close();
await browser.close();
server.kill();
