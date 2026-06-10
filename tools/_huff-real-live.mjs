#!/usr/bin/env node
/**
 * tools/_huff-real-live.mjs
 *
 * Boki imperative: "ne rade svi blokovi, ne rade forsovi, nema win
 * prezentacije, nema win linije countera"
 *
 * Ovo NIJE probe — ovo je INSPEKCIJA. Otvorim Huff u realnom Chromium
 * sa video + screenshotom svakog stage-a + DOM snapshot. Onda
 * konkretno za svaki Boki problem zapisujem:
 *   - GDE u DOM-u je element koji nedostaje
 *   - KOJA klasa/id ga drži skrivenim
 *   - KOJI block ga emit-uje
 *
 * Output: tools/_eyes/huff-real-live/{video, screenshots, _dom-dump.json}
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/huff-real-live`;
mkdirSync(OUT, { recursive: true });
const HOME = process.env.HOME;
const PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;

const PORT = 5267;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
});
const page = await ctx.newPage();
const errs = [];
const consoleAll = [];
page.on('console', m => {
  consoleAll.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 300) });
  if (m.type() === 'error') errs.push(m.text());
});
page.on('pageerror', e => errs.push('PAGE: '+e));

console.log('1. Goto landing page');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.screenshot({ path: `${OUT}/01_landing.png` });

console.log('2. Upload Huff PDF');
await page.waitForSelector('#fileInput', { state: 'attached', timeout: 10000 });
await page.setInputFiles('#fileInput', PDF);
await page.waitForSelector('#previewFrame', { timeout: 25000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/02_after_upload.png` });

const frame = page.frames().find(f => f !== page.mainFrame());
if (!frame) {
  console.log('❌ No iframe');
  process.exit(1);
}
frame.on('console', m => consoleAll.push({ t: Date.now(), type: m.type(), src: 'iframe', text: m.text().slice(0, 300) }));

// SNAPSHOT 0 — initial DOM, every block known
console.log('3. DOM inventory');
const inv0 = await frame.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('.cell'));
  const chips = Array.from(document.querySelectorAll('.ufp-chip')).map(c => ({
    kind: c.getAttribute('data-ufp-kind'),
    label: (c.textContent || '').trim().slice(0, 30),
    visible: getComputedStyle(c).display !== 'none' && parseFloat(getComputedStyle(c).opacity) > 0.5,
  }));
  // Find win-line counter elements — typical class names
  const winCounter = !!document.querySelector(
    '#winCounter, .win-counter, .winRollup, #winRollup, .winCount, .win-amount, [data-win-counter]'
  );
  const winRollupNode = document.querySelector('#winRollup, .winRollup, [data-win-rollup]');
  const balanceNode = document.querySelector('#balance, .balance, .balanceHud, [data-balance]');
  const stageBadge = document.querySelector('#stageBadge, .stage-badge, .stageBadge, [data-stage-badge]');
  // List all top-level HUD components
  const hudItems = Array.from(document.querySelectorAll('.sideHud > *, .hud > *, #hud > *, .topbar > *, .bottombar > *')).map(el => ({
    tag: el.tagName,
    id: el.id,
    cls: Array.from(el.classList).join(' '),
    text: (el.textContent || '').trim().slice(0, 50),
  }));
  return {
    cellCount: cells.length,
    cellsSample: cells.slice(0, 5).map(c => (c.textContent || '').trim()),
    chips,
    winCounter,
    winRollupNode: winRollupNode ? { id: winRollupNode.id, cls: Array.from(winRollupNode.classList).join(' '), text: (winRollupNode.textContent||'').trim().slice(0, 50) } : null,
    balanceNode: balanceNode ? { id: balanceNode.id, cls: Array.from(balanceNode.classList).join(' '), text: (balanceNode.textContent||'').trim().slice(0, 50) } : null,
    stageBadge: stageBadge ? { id: stageBadge.id, cls: Array.from(stageBadge.classList).join(' '), text: (stageBadge.textContent||'').trim().slice(0, 50) } : null,
    hudItems: hudItems.slice(0, 20),
    fsm: window.FSM ? { phase: window.FSM.phase } : null,
    hookBus: !!window.HookBus,
    blockGlobals: {
      hasWinPres: typeof window.applyWinHighlight === 'function',
      hasRunTumble: typeof window.runTumbleChain === 'function',
      hasFs: !!window.FREESPINS,
      hasWildId: window.WILD_ID,
      hasScatterId: window.SCATTER_ID,
      hasSymRegistry: !!window.SYMBOL_REGISTRY,
      hasHwState: !!window.HW_STATE,
      multGet: window.HookBus && typeof window.HookBus.getMult === 'function' ? window.HookBus.getMult() : null,
    },
  };
});
console.log('   cells:', inv0.cellCount, '| chips:', inv0.chips.map(c => c.kind).join(','));
console.log('   winCounter:', inv0.winCounter, '| winRollupNode:', JSON.stringify(inv0.winRollupNode));
console.log('   balanceNode:', JSON.stringify(inv0.balanceNode));
console.log('   stageBadge:', JSON.stringify(inv0.stageBadge));

// Install live tap-counter for every HookBus event before they fire
await frame.evaluate(() => {
  window.__LIVE = { events: {} };
  if (window.HookBus && window.HookBus._all) {
    // Tap into ALL events that exist
    const seenEvents = new Set();
    const origEmit = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.emit = function(name, payload) {
      window.__LIVE.events[name] = (window.__LIVE.events[name] || 0) + 1;
      return origEmit(name, payload);
    };
  } else {
    // Simpler tap
    const origEmit = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.emit = function(name, payload) {
      window.__LIVE.events[name] = (window.__LIVE.events[name] || 0) + 1;
      return origEmit(name, payload);
    };
  }
});

// Spin 15 times, observing per-spin: did win presentation fire, does winCounter update
console.log('\n4. 15 spinova, prati win prezentaciju i win counter');
const spinTrace = [];
for (let i = 0; i < 15; i++) {
  for (let j = 0; j < 50; j++) {
    const ok = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      const ph = window.FSM ? window.FSM.phase : 'BASE';
      return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
    });
    if (ok) break;
    await page.waitForTimeout(150);
  }
  const before = await frame.evaluate(() => ({
    winStarts: window.__LIVE.events.onWinPresentationStart || 0,
    balText: document.querySelector('#balanceHudBalanceValue')?.textContent?.trim() || null,
    winText: document.querySelector('#balanceHudWinValue')?.textContent?.trim() || null,
    rollupAmount: document.querySelector('#winRollupAmount')?.textContent?.trim() || null,
    rollupShow: document.querySelector('#winRollupBanner')?.getAttribute('data-show') || null,
    award: window.__WIN_AWARD__,
  }));
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  /* Wait long enough for postSpin → applyWinHighlight → rollup chain to
   * complete on winning spins (rollup celebration ~2-3s + breath). Below
   * 4s the snapshot races the HUD update on win spins. */
  await page.waitForTimeout(4500);
  const after = await frame.evaluate(() => ({
    winStarts: window.__LIVE.events.onWinPresentationStart || 0,
    balText: document.querySelector('#balanceHudBalanceValue')?.textContent?.trim() || null,
    winText: document.querySelector('#balanceHudWinValue')?.textContent?.trim() || null,
    rollupAmount: document.querySelector('#winRollupAmount')?.textContent?.trim() || null,
    rollupShow: document.querySelector('#winRollupBanner')?.getAttribute('data-show') || null,
    award: window.__WIN_AWARD__,
    payAnyVisible: !!document.querySelector('.payline-overlay-line, .winFlash, .paylineFlash, [data-payline-active="true"]'),
  }));
  const winFired = after.winStarts > before.winStarts;
  spinTrace.push({ i, winFired, before, after });
  if (winFired) {
    await page.screenshot({ path: `${OUT}/spin_${String(i).padStart(2,'0')}_win.png` });
  }
}

console.log('\n   spinTrace (all 15):');
spinTrace.forEach(s => console.log(`     spin ${String(s.i).padStart(2)}: win=${s.winFired ? '✅' : '–'} bal ${s.before.balText}→${s.after.balText} winHUD ${s.before.winText}→${s.after.winText} rollup ${s.before.rollupAmount}→${s.after.rollupAmount} show=${s.before.rollupShow}→${s.after.rollupShow} award=${s.after.award}`));

// Chip sweep — click each ufp-chip and snapshot reactions
console.log('\n5. Chip sweep');
const chipsKinds = inv0.chips.map(c => c.kind);
const chipResults = {};
for (const kind of chipsKinds) {
  // wait BASE
  for (let j = 0; j < 60; j++) {
    const ok = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      const ph = window.FSM ? window.FSM.phase : 'BASE';
      return b && !b.disabled && !b.classList.contains('is-spinning') && ph === 'BASE' && !window.__SLOT_WIN_PRESENT_ACTIVE__;
    });
    if (ok) break;
    await page.waitForTimeout(150);
  }
  const before = await frame.evaluate(() => ({
    forceEvts: window.__LIVE.events.onForceFeatureRequested || 0,
    multEvts: window.__LIVE.events.onForceMultiplier || 0,
    fsTrig: window.__LIVE.events.onFsTrigger || 0,
    bigWin: window.__LIVE.events.onBigWinTierEntered || 0,
    bannerVisible: !!document.querySelector('.gfb-banner.visible, .feature-banner.visible'),
    bannerText: (document.querySelector('.gfb-banner, .feature-banner, .gfb-text')?.textContent || '').trim(),
  }));
  await frame.evaluate((k) => document.querySelector(`.ufp-chip[data-ufp-kind="${k}"]`)?.click(), kind);
  await page.waitForTimeout(500);
  const afterClick = await frame.evaluate(() => ({
    forceEvts: window.__LIVE.events.onForceFeatureRequested || 0,
    multEvts: window.__LIVE.events.onForceMultiplier || 0,
    fsTrig: window.__LIVE.events.onFsTrigger || 0,
    bigWin: window.__LIVE.events.onBigWinTierEntered || 0,
    bannerVisible: !!document.querySelector('.gfb-banner.visible, .feature-banner.visible'),
    bannerText: (document.querySelector('.gfb-banner, .feature-banner, .gfb-text')?.textContent || '').trim(),
    flagSet: window.__FORCE_FEATURE__,
  }));
  // spin to fully exercise force
  await frame.evaluate(() => document.getElementById('spinBtn')?.click());
  await page.waitForTimeout(3000);
  const afterSpin = await frame.evaluate(() => ({
    winStarts: window.__LIVE.events.onWinPresentationStart || 0,
    forceEvts: window.__LIVE.events.onForceFeatureRequested || 0,
    multEvts: window.__LIVE.events.onForceMultiplier || 0,
    fsTrig: window.__LIVE.events.onFsTrigger || 0,
    fsActive: window.FSM && window.FSM.phase && window.FSM.phase.startsWith('FS_'),
    bigWin: window.__LIVE.events.onBigWinTierEntered || 0,
    rollupText: document.querySelector('#winRollup, .winRollup, .win-counter, .winCount, [data-win-rollup]')?.textContent?.trim() || null,
    multNow: window.HookBus && window.HookBus.getMult ? window.HookBus.getMult() : null,
  }));
  chipResults[kind] = {
    chipFiredHook: afterClick.forceEvts > before.forceEvts || afterClick.multEvts > before.multEvts,
    bannerShown: afterClick.bannerVisible || afterClick.bannerText.length > 0,
    flagSet: afterClick.flagSet,
    fsTriggered: afterSpin.fsTrig > before.fsTrig,
    bigWinTriggered: afterSpin.bigWin > before.bigWin,
    multApplied: afterSpin.multNow !== null && afterSpin.multNow > 1,
    afterSpinRollup: afterSpin.rollupText,
  };
  await page.screenshot({ path: `${OUT}/chip_${kind}.png` });
  // dismiss any modal/overlay
  await frame.evaluate(() => {
    const close = document.querySelector('.modal-close, .ufp-close, [data-close], .overlay-close');
    if (close) close.click();
  });
  await page.waitForTimeout(500);
}

console.log('\n6. Final report\n');
console.log('── chip results ──');
for (const [kind, r] of Object.entries(chipResults)) {
  const status = r.chipFiredHook ? '✅' : '❌';
  console.log(`  ${status} ${kind.padEnd(18)} hook=${r.chipFiredHook} banner=${r.bannerShown} fsTrig=${r.fsTriggered} bigWin=${r.bigWinTriggered} multApplied=${r.multApplied} flag=${r.flagSet}`);
}

const finalEvents = await frame.evaluate(() => window.__LIVE.events);
console.log('\n── HookBus emit counts ──');
Object.entries(finalEvents).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)} ${k}`));

console.log('\n── console errors ──');
console.log(`  total: ${errs.length}`);
errs.slice(0, 10).forEach(e => console.log(`    ${e.slice(0, 200)}`));

// Save full DOM dump
writeFileSync(`${OUT}/_dom-dump.json`, JSON.stringify({
  inv0,
  spinTrace,
  chipResults,
  finalEvents,
  errs,
  consoleAll: consoleAll.slice(-50),
}, null, 2));

await page.close();
await ctx.close();
await browser.close();
server.kill('SIGTERM');
console.log(`\nArtifacts: ${OUT}`);
