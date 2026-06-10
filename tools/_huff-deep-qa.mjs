#!/usr/bin/env node
/**
 * tools/_huff-deep-qa.mjs
 *
 * Boki direktiva: "deep QA, root cause obavezno, ne jedi govna više"
 *
 * Specifične tvrdnje:
 *   A. Huff nema win prezentaciju
 *   B. Ćelije nestaju kad se dešavaju winovi
 *   C. Multiplier force ne radi
 *
 * Plan:
 *   1. Snimam onWinPresentationStart / onWinPresentationEnd hookove
 *   2. Snimam cell mutations (MutationObserver) tokom prve 3 wina
 *   3. Sample-ujem grid každih 200ms, hvatam moment kad cells.length pada
 *      ILI textContent postaje '' ILI ?, i log-ujem koja blok funkcija je
 *      poslednja taknula tu ćeliju
 *   4. Klikam multiplier chip → spin → snimam JESTE LI multiplier aplied,
 *      JESTE LI banner visible, JESTE LI HookBus.getMult() > 1
 *   5. Ako win presentation nikad ne emituje → nađem zašto
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/huff-deep`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;

const PORT = 5260;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1400, height: 900 } },
});
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); if (m.type()==='warning') errs.push('WARN:'+m.text()); });
page.on('pageerror', e => errs.push('PAGE: '+e));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await (await page.$('#fileInput')).setInputFiles(PDF);
await page.waitForSelector('#previewFrame', { timeout: 15000 });
await page.waitForTimeout(1500);
const frame = page.frames().find(f => f !== page.mainFrame());
frame.on('console', m => { if (m.type()==='error') errs.push('[iframe] '+m.text()); });

// Install probes
await frame.evaluate(() => {
  window.__PROBE = {
    winStarts: [],
    winEnds: [],
    cellSamples: [],
    tumbleSteps: [],
    spinResults: [],
    postSpins: [],
    bigWinStarts: [],
  };
  if (window.HookBus) {
    window.HookBus.on('onWinPresentationStart', (p) => {
      window.__PROBE.winStarts.push({ t: Date.now(), ...p });
    });
    window.HookBus.on('onWinPresentationEnd', (p) => {
      window.__PROBE.winEnds.push({ t: Date.now(), ...p });
    });
    window.HookBus.on('onTumbleStep', (p) => {
      window.__PROBE.tumbleSteps.push({ t: Date.now(), chainIndex: p.chainIndex, eventCount: (p.events||[]).length });
    });
    window.HookBus.on('onSpinResult', (p) => {
      window.__PROBE.spinResults.push({ t: Date.now() });
    });
    window.HookBus.on('postSpin', (p) => {
      window.__PROBE.postSpins.push({ t: Date.now(), duringFs: !!p.duringFs });
    });
    window.HookBus.on('onBigWinTierStart', (p) => {
      window.__PROBE.bigWinStarts.push({ t: Date.now(), ...p });
    });
  }
});

// Inspect Huff config
const cfg = await frame.evaluate(() => ({
  shape: window.SHAPE,
  gameEvalKind: window.GAME_EVAL_KIND,
  paylineCount: (window.PAYLINE_POOL || []).length,
  hasTumble: typeof window.runTumbleChain === 'function',
  tumbleMax: window.TUMBLE_MAX_CHAIN,
  freeSpinsEnabled: !!(window.FREESPINS && window.FREESPINS.enabled),
  noWinChance: (() => { try { return window.__NO_WIN_CHANCE; } catch (e) { return undefined; } })(),
  multiplier: window.FREESPINS && window.FREESPINS.multiplier,
  forceFeatureChips: Array.from(document.querySelectorAll('.ufp-chip')).map(c => c.getAttribute('data-ufp-kind')),
  rects: (window.RECT_REELS || []).length,
  reelVisibleLengths: (window.RECT_REELS || []).map(r => (r && r.visible || []).length),
}));
console.log('Huff config:');
console.log(JSON.stringify(cfg, null, 2));

// Force WIN by planting a winning grid then triggering postSpin
// Strategy: directly call applyWinHighlight after planting reels with matching symbols
async function forceWinAttempt(label, planter) {
  console.log(`\n── ${label} ──`);
  await frame.evaluate(planter);
  // simulate a base spin postSpin path:
  const result = await frame.evaluate(async () => {
    if (typeof window.applyWinHighlight !== 'function') return { error: 'no applyWinHighlight' };
    const r = await window.applyWinHighlight();
    return { events: (r || []).length, totalAward: window.__WIN_AWARD__ };
  });
  console.log(`  applyWinHighlight → events=${result.events} award=${result.totalAward}`);
  return result;
}

// Attempt 1: plant all-H1 grid (5 in a row, line 0)
await forceWinAttempt('Plant H1 across reels[0..4] row 1 (top of line 0)', () => {
  if (!window.RECT_REELS) return;
  for (const reel of window.RECT_REELS) {
    if (!reel || !Array.isArray(reel.visible)) continue;
    for (let r = 0; r < reel.visible.length; r++) reel.visible[r] = 'H1';
    if (typeof reel.cells === 'object' && reel.cells) {
      reel.cells.forEach((c, i) => { if (c) c.textContent = 'H1'; });
    }
  }
});

// Snapshot grid after attempt
const afterPlant1 = await frame.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('.cell'));
  return cells.map(c => (c.textContent || '').trim());
});
console.log('  grid after plant:', afterPlant1.join('|'));

await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/01_after_plant_h1.png` });

const probe1 = await frame.evaluate(() => ({ ...window.__PROBE }));
console.log(`  probe: winStarts=${probe1.winStarts.length} winEnds=${probe1.winEnds.length} tumbleSteps=${probe1.tumbleSteps.length}`);
if (probe1.winStarts.length) console.log(`    winStart: award=${probe1.winStarts[0].award} isBigWin=${probe1.winStarts[0].isBigWin}`);

// Now: real spin loop, watching cell content
console.log('\n── Real 20-spin loop, watch cells DURING win presentation ──');
await frame.evaluate(() => { window.__PROBE.cellSamples = []; });
// install per-frame cell sampler
await frame.evaluate(() => {
  let pollToken = null;
  window.__PROBE.startSampling = () => {
    if (pollToken) clearInterval(pollToken);
    pollToken = setInterval(() => {
      const cells = document.querySelectorAll('.cell');
      let empty = 0;
      const emptyIdx = [];
      cells.forEach((c, i) => {
        const t = (c.textContent || '').trim();
        if (!t) { empty++; emptyIdx.push(i); }
      });
      window.__PROBE.cellSamples.push({
        t: Date.now(),
        total: cells.length,
        empty,
        emptyIdx: emptyIdx.slice(0, 6),
        winPresActive: !!window.__SLOT_WIN_PRESENT_ACTIVE__,
        phase: window.FSM ? window.FSM.phase : 'BASE',
      });
    }, 100);
  };
  window.__PROBE.stopSampling = () => { if (pollToken) clearInterval(pollToken); };
});
await frame.evaluate(() => window.__PROBE.startSampling());

let winsObserved = 0;
const winDetails = [];
for (let i = 0; i < 20; i++) {
  // wait base ready
  for (let j = 0; j < 50; j++) {
    const ok = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      const ph = window.FSM ? window.FSM.phase : 'BASE';
      return b && !b.classList.contains('is-spinning') && !b.disabled && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
  const winsBefore = await frame.evaluate(() => window.__PROBE.winStarts.length);
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  // wait for postSpin to fire
  await page.waitForTimeout(3000);
  const winsAfter = await frame.evaluate(() => window.__PROBE.winStarts.length);
  if (winsAfter > winsBefore) {
    winsObserved++;
    const w = await frame.evaluate(() => window.__PROBE.winStarts[window.__PROBE.winStarts.length - 1]);
    winDetails.push({ spin: i + 1, ...w });
    await page.screenshot({ path: `${OUT}/win_${winsObserved}.png` });
    // wait for end
    await page.waitForTimeout(2000);
  }
}
await frame.evaluate(() => window.__PROBE.stopSampling());

const finalProbe = await frame.evaluate(() => ({
  winStarts: window.__PROBE.winStarts,
  winEnds: window.__PROBE.winEnds,
  tumbleSteps: window.__PROBE.tumbleSteps.length,
  spinResults: window.__PROBE.spinResults.length,
  postSpins: window.__PROBE.postSpins.length,
  cellSamples: window.__PROBE.cellSamples,
  bigWinStarts: window.__PROBE.bigWinStarts,
}));

console.log(`\n— SUMMARY (20 base spins) —`);
console.log(`  onSpinResult fired: ${finalProbe.spinResults}`);
console.log(`  postSpin fired:     ${finalProbe.postSpins}`);
console.log(`  onTumbleStep:       ${finalProbe.tumbleSteps}`);
console.log(`  winPresStart:       ${finalProbe.winStarts.length}`);
console.log(`  winPresEnd:         ${finalProbe.winEnds.length}`);
console.log(`  bigWinTierStart:    ${finalProbe.bigWinStarts.length}`);
console.log(`  wins observed:      ${winsObserved}`);
winDetails.forEach(d => console.log(`    spin#${d.spin}: award=${d.award} eventCount=${d.eventCount} isBigWin=${d.isBigWin}`));

// cells during win presentation
const dirtyDuringWin = finalProbe.cellSamples.filter(s => s.winPresActive && s.empty > 0);
console.log(`\n— CELLS DURING WIN PRESENTATION —`);
console.log(`  samples with winPresActive=true: ${finalProbe.cellSamples.filter(s => s.winPresActive).length}`);
console.log(`  samples with empty cells AT THE SAME TIME: ${dirtyDuringWin.length}`);
if (dirtyDuringWin.length) {
  dirtyDuringWin.slice(0, 6).forEach(s => console.log(`    t=${s.t} empty=${s.empty} idx=[${s.emptyIdx.join(',')}] phase=${s.phase}`));
}
const dirtyAnyTime = finalProbe.cellSamples.filter(s => s.empty > 0);
console.log(`  ANY-time samples with empty cells: ${dirtyAnyTime.length}/${finalProbe.cellSamples.length}`);

// Now multiplier chip test
console.log(`\n── MULTIPLIER chip on Huff ──`);
await frame.evaluate(() => {
  window.__PROBE.multTestStart = Date.now();
  document.querySelector('.ufp-chip[data-ufp-kind="multiplier"]').click();
});
await page.waitForTimeout(300);
const multAfterClick = await frame.evaluate(() => ({
  forceFlag: window.__FORCE_FEATURE__,
  banner: !!document.querySelector('.gfb-banner, .feature-banner, .gfb-text, [data-feature-banner]'),
  hookBusMult: window.HookBus && window.HookBus.getMult ? window.HookBus.getMult() : null,
  multOrbActive: !!document.querySelector('.multiplier-orb, [data-multiplier]'),
  persistentMult: window.PERSISTENT_MULTIPLIER ? window.PERSISTENT_MULTIPLIER.current : null,
}));
console.log(`  after click: ${JSON.stringify(multAfterClick)}`);
// spin
await frame.evaluate(() => document.getElementById('spinBtn')?.click());
await page.waitForTimeout(3500);
const multAfterSpin = await frame.evaluate(() => ({
  banner: !!document.querySelector('.gfb-banner, .feature-banner, .gfb-text, [data-feature-banner]'),
  bannerText: (document.querySelector('.gfb-banner, .feature-banner, .gfb-text')?.textContent || '').trim(),
  hookBusMult: window.HookBus && window.HookBus.getMult ? window.HookBus.getMult() : null,
  multOrbActive: !!document.querySelector('.multiplier-orb, [data-multiplier]'),
  persistentMult: window.PERSISTENT_MULTIPLIER ? window.PERSISTENT_MULTIPLIER.current : null,
  bannerClassName: document.querySelector('.gfb-banner, .feature-banner, .gfb-text')?.className,
}));
console.log(`  after spin: ${JSON.stringify(multAfterSpin)}`);
await page.screenshot({ path: `${OUT}/multiplier_after_spin.png` });

writeFileSync(`${OUT}/_probe.json`, JSON.stringify({ cfg, finalProbe, winDetails, multAfterClick, multAfterSpin, errs }, null, 2));
console.log(`\nErrors: ${errs.length}`);
errs.slice(0, 10).forEach(e => console.log('  '+e.slice(0, 200)));

await page.close();
await ctx.close();
await browser.close();
server.kill('SIGTERM');
console.log(`\nArtifacts: ${OUT}`);
