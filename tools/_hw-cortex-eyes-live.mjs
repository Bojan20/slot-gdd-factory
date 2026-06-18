#!/usr/bin/env node
/**
 * tools/_hw-cortex-eyes-live.mjs
 *
 * Boki: "otvori cortex eyes u realnom vremenu istestiraj blok hold and win".
 *
 * Step-by-step REAL-TIME live observation of HnP H&W:
 *   1. Load HnP, snapshot baseline
 *   2. Click H&W chip, log every state change @ 100ms intervals for 20s
 *   3. Capture screenshots at every PHASE transition
 *   4. Track: phase, lockedCells.size, visible orbs, intro visible,
 *      respinsLeft, totalWinX, FORCE_TRIGGER, __FORCE_FEATURE__
 *   5. After natural round end, watch 8s — see if 2nd round triggers
 *   6. Dump TIMELINE table + screenshot directory
 *
 * Output:
 *   reports/hw-cortex-eyes/hnp-{N}.png — screenshots
 *   reports/hw-cortex-eyes/hnp-timeline.txt — full state log
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5290;
const OUT = `${REPO}/reports/hw-cortex-eyes`;
mkdirSync(OUT, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', RST = '\x1b[0m';

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });   // headless for speed; same DOM/JS
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push({ t: Date.now(), kind: 'pageerror', msg: e.message }));
page.on('console', m => { if (m.type() === 'error') errs.push({ t: Date.now(), kind: 'console.error', msg: m.text() }); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.setInputFiles('#fileInput', PDF);
await page.waitForSelector('#previewFrame', { timeout: 30000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());
await frame.waitForFunction(() => !!document.querySelector('.gridHost .cell'), { timeout: 12000 });
await frame.waitForTimeout(800);
frame.on('console', m => { if (m.type() === 'error') errs.push({ t: Date.now(), kind: 'iframe.error', msg: m.text() }); });

console.log('═══ CORTEX EYES · HnP · H&W LIVE TEST ═══════════════════════════════════');

// Install timeline poller in-page
await frame.evaluate(() => {
  window.__HW_TIMELINE = [];
  const T0 = performance.now();
  const id = setInterval(() => {
    const reels = window.RECT_REELS || [];
    const lockedCount = document.querySelectorAll('.gridHost .cell.is-locked-bonus').length;
    const bonusCells = (window.RECT_REELS || []).reduce((sum, r) => {
      let n = 0;
      for (let row = 0; row < r.visibleRows; row++) {
        const c = r.cells[row + 1];
        if (c && (c.textContent || '').trim().toUpperCase() === 'B') n++;
      }
      return sum + n;
    }, 0);
    const introVisible = (function () {
      const i = document.querySelector('.hw-intro');
      return i && i.getAttribute('data-show') === 'true';
    })();
    const summaryVisible = (function () {
      const s = document.querySelector('.hw-summary');
      return s && s.getAttribute('data-show') === 'true';
    })();
    const hudLockedTxt = (function () {
      const el = document.getElementById('hwLocked');
      return el ? (el.textContent || '').trim() : null;
    })();
    const respinsTxt = (function () {
      const el = document.getElementById('hwRespins');
      return el ? (el.textContent || '').trim() : null;
    })();
    const totalTxt = (function () {
      const el = document.getElementById('hwTotal');
      return el ? (el.textContent || '').trim() : null;
    })();
    const celebrating = !!document.querySelector('.cell--hnw-bonus-celebrate');
    const countBadge = !!document.querySelector('.hw-bonus-count-overlay');
    const snap = {
      t: Math.round(performance.now() - T0),
      phase: window.HW_STATE?.phase || null,
      armed: window.HW_STATE?.armed === true,
      entering: window.HW_STATE?.entering === true,
      active: window.HW_STATE?.active === true,
      stateSize: window.HW_STATE?.lockedCells?.size ?? null,
      lockedDom: lockedCount,
      bonusDom: bonusCells,
      respinsLeft: window.HW_STATE?.respinsLeft ?? null,
      totalWinX: window.HW_STATE?.totalWinX ?? null,
      hudL: hudLockedTxt,
      hudR: respinsTxt,
      hudT: totalTxt,
      introVisible,
      summaryVisible,
      celebrating,
      countBadge,
      forceTrig: window.FORCE_TRIGGER ? JSON.stringify(window.FORCE_TRIGGER) : null,
      forcePend: window.__FORCE_FEATURE_PENDING__ || null,
      reelsSpinning: reels.filter(r => r.spinning).length,
      reelsStopping: reels.filter(r => r.stopping).length,
    };
    const prev = window.__HW_TIMELINE[window.__HW_TIMELINE.length - 1];
    if (!prev || JSON.stringify({ ...prev, t: 0 }) !== JSON.stringify({ ...snap, t: 0 })) {
      window.__HW_TIMELINE.push(snap);
    }
  }, 100);
  setTimeout(() => clearInterval(id), 35000);
});

async function shot(label) {
  const p = `${OUT}/${label}.png`;
  try { await page.screenshot({ path: p, fullPage: false }); console.log(`${D}  📸 ${label}.png${RST}`); }
  catch (_) {}
}

// Click H&W chip
console.log(`${D}→ Click H&W chip${RST}`);
await shot('00-pre-click');
await frame.evaluate(() => {
  const c = document.querySelector('[data-ufp-kind="hold_and_win"]');
  if (c) c.click();
});
await page.waitForTimeout(1500);
await shot('01-spin-mid');
await page.waitForTimeout(2200);
await shot('02-celebration');
await page.waitForTimeout(800);
await shot('03-pause-before-intro');
await page.waitForTimeout(1500);
await shot('04-intro-placard');

// Skip intro
await frame.evaluate(() => { const i = document.querySelector('.hw-intro'); if (i) i.click(); });
await page.waitForTimeout(1200);
await shot('05-running-start');

// Drive respins
for (let i = 0; i < 5; i++) {
  const phase = await frame.evaluate(() => window.HW_STATE?.phase);
  if (phase !== 'RUNNING') break;
  await frame.evaluate(() => { const b = document.getElementById('spinBtn'); if (b && !b.disabled) b.click(); });
  await page.waitForTimeout(2500);
  await shot(`06-respin-${i + 1}`);
}

// Skip summary if present
await page.waitForTimeout(1500);
await shot('07-summary');
await frame.evaluate(() => { const s = document.querySelector('.hw-summary'); if (s) s.click(); });
await page.waitForTimeout(2000);
await shot('08-post-summary-idle');
await page.waitForTimeout(6000);   // 6s post-round idle observation
await shot('09-idle-final');

// Dump timeline
const timeline = await frame.evaluate(() => window.__HW_TIMELINE);
const lines = [];
lines.push('═══ HnP H&W TIMELINE (transitions only) ═══');
lines.push('t(ms)  phase     arm  ent  act  stSz  lkDom  bnDom  respL  hudL  intr  sum  celeb  badge  FT  pend');
for (const s of timeline) {
  lines.push([
    String(s.t).padStart(5),
    String(s.phase || 'null').padStart(9),
    s.armed ? ' Y ' : ' . ',
    s.entering ? ' Y ' : ' . ',
    s.active ? ' Y ' : ' . ',
    String(s.stateSize ?? '-').padStart(4),
    String(s.lockedDom).padStart(5),
    String(s.bonusDom).padStart(5),
    String(s.respinsLeft ?? '-').padStart(5),
    String(s.hudL ?? '-').padStart(4),
    s.introVisible ? ' Y ' : ' . ',
    s.summaryVisible ? ' Y ' : ' . ',
    s.celebrating ? '  Y  ' : '  .  ',
    s.countBadge ? '  Y  ' : '  .  ',
    s.forceTrig ? 'Y' : '.',
    s.forcePend || '.',
  ].join('  '));
}
writeFileSync(`${OUT}/hnp-timeline.txt`, lines.join('\n'));
console.log(lines.slice(0, 60).join('\n'));
console.log(`\n${D}... full timeline saved to ${OUT}/hnp-timeline.txt (${timeline.length} rows)${RST}`);

// Identify key transitions
const introCount = timeline.filter(s => s.introVisible).length;
const introStarts = timeline.filter((s, i) => s.introVisible && (i === 0 || !timeline[i-1].introVisible)).length;
const summaryStarts = timeline.filter((s, i) => s.summaryVisible && (i === 0 || !timeline[i-1].summaryVisible)).length;
const phaseFlips = timeline.filter((s, i) => i > 0 && timeline[i-1].phase !== s.phase).map(s => `${s.t}ms→${s.phase}`);
const introVsCeleb = timeline.find(s => s.introVisible && s.celebrating);
const lockedMismatch = timeline.filter(s => s.stateSize !== null && s.lockedDom > 0 && s.stateSize !== s.lockedDom);
const orphanedBonus = timeline.filter(s => s.bonusDom > 0 && s.lockedDom < s.bonusDom);

console.log(`\n${Y}═══ KEY OBSERVATIONS ═══${RST}`);
console.log(`  Phase transitions: ${phaseFlips.join(' · ')}`);
console.log(`  INTRO mounted: ${introStarts}× · SUMMARY mounted: ${summaryStarts}×`);
console.log(`  Intro + celeb concurrent: ${introVsCeleb ? R+'YES (BAD — celebration shown during intro)'+RST : G+'no'+RST}`);
console.log(`  LOCKED state/DOM mismatch frames: ${lockedMismatch.length} ${lockedMismatch.length ? R+'(BAD)'+RST : G+'(ok)'+RST}`);
console.log(`  Bonus glyph not locked: ${orphanedBonus.length} ${orphanedBonus.length ? R+'(BAD: bonus B without is-locked-bonus class)'+RST : G+'(ok)'+RST}`);
console.log(`  console/page errors: ${errs.length} ${errs.length ? R+'(BAD)'+RST : G+'(ok)'+RST}`);
if (errs.length) for (const e of errs.slice(0, 5)) console.log(`    ${R}${e.kind}${RST}: ${e.msg}`);

console.log(`\n${Y}═══ VERDICT ═══${RST}`);
const verdict = [
  ['INTRO triggered exactly 1×', introStarts === 1],
  ['SUMMARY triggered exactly 1×', summaryStarts === 1],
  ['No double H&W (post-round idle)', introStarts <= 1],
  ['No intro+celeb overlap', !introVsCeleb],
  ['LOCKED HUD == DOM', lockedMismatch.length === 0],
  ['No orphan bonus glyphs', orphanedBonus.length === 0],
  ['0 console errors', errs.length === 0],
];
for (const [label, ok] of verdict) console.log(`  ${ok ? G+'✓'+RST : R+'✗'+RST} ${label}`);

await ctx.close();
await browser.close();
server.kill();
