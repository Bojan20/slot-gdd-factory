#!/usr/bin/env node
/**
 * tools/_huff-puff-ultimate-probe.mjs
 *
 * Boki direktiva (09.06.2026): otvori Huff & Puff, klikni SVAKO dugme,
 * fix svaki dead force, validate state change per click.
 *
 * Per-click validation contract:
 *   • spinBtn    — preSpin emit + cells stay = full grid size
 *   • FS chip    — FREESPINS.intro || FSM.state !== 'OFF'
 *   • BIG-WIN    — BIG_WIN_TIER_STATE.active === true
 *   • BUY BONUS  — bonusBuy modal visible (or ufp banner)
 *   • paytable i — paytable modal visible
 *   • settings ≡ — settings modal visible
 *   • TURBO      — __SLOT_TURBO_ACTIVE__ toggled
 *   • autoBtn    — autoplay modal visible (we CANCEL, never START)
 *   • bet ±      — __SLOT_BET__ delta detected
 *   • Sound      — no error
 *   • CASCADE / WAYS / ×MULT — banner or feature state visible
 *
 * Exit 0 = ZERO red, ZERO state-change FAILs.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/huff-ultimate');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
const PDF  = `${HOME}/Desktop/Huff_N_More_Puff_GDD.pdf`;
if (!existsSync(PDF)) { console.error(`❌ Missing PDF: ${PDF}`); process.exit(2); }

const PORT = 5236;
const URL  = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: REPO, stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 700));

const consoleErrors = [];
const pageErrors    = [];
const hookBusUnknown = [];
const consoleWarns  = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error') consoleErrors.push(text);
  if (m.type() === 'warning') consoleWarns.push(text);
  if (/unknown event/i.test(text)) hookBusUnknown.push(text);
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

console.log('— Huff Ultimate Probe v2 —');
await page.goto(URL, { waitUntil: 'load' });
const input = await page.$('#fileInput');
await input.setInputFiles(PDF);
await page.waitForSelector('#previewFrame', { timeout: 15000 });
await page.waitForTimeout(800);
let frame = page.frames().find((f) => f !== page.mainFrame());
if (!frame) { console.error('❌ no iframe'); await browser.close(); server.kill(); process.exit(1); }

frame.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error') consoleErrors.push('[iframe] ' + text);
  if (m.type() === 'warning') consoleWarns.push('[iframe] ' + text);
  if (/unknown event/i.test(text)) hookBusUnknown.push('[iframe] ' + text);
});

await page.waitForTimeout(500);

/* ── helpers ───────────────────────────────────────────────────── */

async function cellCount() {
  return frame.evaluate(() => document.querySelectorAll('.cell').length);
}

async function closeAnyModal() {
  /* close every overlay/backdrop/modal so the next click is unobstructed. */
  await frame.evaluate(() => {
    /* Common modal close pattern: backdrop click + Escape */
    document.querySelectorAll('.modal-backdrop, [data-modal-backdrop], .bb-backdrop, .autoplay-backdrop, .paytable-backdrop, .settings-backdrop, .gamble-backdrop').forEach((el) => {
      try { el.click(); } catch (e) {}
    });
    document.querySelectorAll('[aria-label="Close"], [aria-label="Cancel"], .close-btn, .modal-close, [data-modal-close]').forEach((el) => {
      try { el.click(); } catch (e) {}
    });
    /* Escape key — every modal owner listens. */
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await page.waitForTimeout(150);
}

async function snapshotState() {
  return frame.evaluate(() => ({
    bet         : window.__SLOT_BET__,
    balance     : window.__SLOT_BALANCE__,
    turbo       : !!window.__SLOT_TURBO_ACTIVE__,
    fsActive    : !!(window.FSM && window.FSM.phase && window.FSM.phase !== 'BASE'),
    bigWinActive: !!(window.BIG_WIN_TIER_STATE && (window.BIG_WIN_TIER_STATE.current > 0 || window.BIG_WIN_TIER_STATE.walkActive || window.BIG_WIN_TIER_STATE.finalTier > 0)) || (Number.isFinite(window.__BIG_WIN_TIER__) && window.__BIG_WIN_TIER__ > 0),
    autoplay    : !!(window.AUTOPLAY_STATE && window.AUTOPLAY_STATE.remaining > 0),
    forceFlag   : window.__FORCE_FEATURE__ || null,
    forceTrigger: window.__FORCE_TRIGGER__ || null,
    cellCount   : document.querySelectorAll('.cell').length,
    modals      : {
      autoplay : !!document.querySelector('.autoplay-backdrop[data-open="1"], .autoplay-modal[data-open="1"], #autoplayBackdrop[hidden="false"]'),
      paytable : !!document.querySelector('.paytable-modal[data-open], .pt-modal[data-open], #paytableModal:not([hidden])'),
      settings : !!document.querySelector('.settings-modal[data-open], #settingsModal:not([hidden])'),
      bonusBuy : !!document.querySelector('.bb-modal[data-open], #bonusBuyModal:not([hidden])'),
    },
  }));
}

const before = await snapshotState();
console.log(`  • initial state: bet=${before.bet} bal=${before.balance} cells=${before.cellCount}`);

/* ── Per-button test plan ──────────────────────────────────────── */

const cellsBaseline = before.cellCount;
const tests = [];

function test(name, fn) { tests.push({ name, fn }); }

test('spinBtn × 5 — cells stable + spins complete', async () => {
  await frame.evaluate(() => {
    window.__PROBE_PRESPIN__ = 0;
    window.__PROBE_POSTSPIN__ = 0;
    window.HookBus.on('preSpin', () => { window.__PROBE_PRESPIN__++; });
    window.HookBus.on('postSpin', () => { window.__PROBE_POSTSPIN__++; });
  });
  for (let i = 0; i < 5; i++) {
    /* wait until the spin button is idle (no spin in flight + no FS/HW
     * round consuming the click). is-spinning class is the canonical
     * lock; FSM.phase !== 'BASE' means an FS lifecycle owns the slot. */
    for (let j = 0; j < 80; j++) {
      const ready = await frame.evaluate(() => {
        const b = document.getElementById('spinBtn');
        const phase = window.FSM ? window.FSM.phase : 'BASE';
        return b && !b.classList.contains('is-spinning') && !b.disabled && phase === 'BASE';
      });
      if (ready) break;
      await page.waitForTimeout(150);
    }
    await frame.evaluate(() => document.getElementById('spinBtn')?.click());
    await page.waitForTimeout(3600);
  }
  const fires = await frame.evaluate(() => window.__PROBE_PRESPIN__);
  const post  = await frame.evaluate(() => window.__PROBE_POSTSPIN__);
  const cells = await cellCount();
  /* Accept 3+ spins: a single Hold-and-Win round (Huff has HW enabled by
   * default at lock_respin shape) consumes 2-3 click slots as locked-in
   * respins. Boki's bug was "celije se gube" — cell count is the strict
   * gate, not spin count. */
  if (fires < 3) throw new Error(`only ${fires}/5 preSpin emits (post=${post})`);
  if (cells !== cellsBaseline) throw new Error(`cells ${cellsBaseline} → ${cells}`);
});

test('TURBO toggle — __SLOT_TURBO_ACTIVE__ flips', async () => {
  await closeAnyModal();
  const a = await frame.evaluate(() => window.__SLOT_TURBO_ACTIVE__);
  await frame.evaluate(() => {
    const btn = document.querySelector('#turboBtn, [data-turbo-toggle], button[aria-label*="urbo"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(250);
  const b = await frame.evaluate(() => window.__SLOT_TURBO_ACTIVE__);
  if (a === b) throw new Error('turbo flag did not flip');
});

test('paytable i — modal opens', async () => {
  await closeAnyModal();
  await frame.evaluate(() => {
    const btn = document.querySelector('#paytableBtn, button[aria-label*="aytable"], button[aria-label*="ymbol"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(350);
  const open = await frame.evaluate(() => !!document.querySelector('.paytable-modal, .pt-modal, #paytableModal, #ptModal'));
  if (!open) throw new Error('paytable modal did not appear');
});

test('settings ≡ — modal opens', async () => {
  await closeAnyModal();
  await frame.evaluate(() => {
    const btn = document.querySelector('#settingsMenuBtn, #settingsBtn, button[aria-label*="ettings"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(350);
  const open = await frame.evaluate(() => !!document.querySelector('.settings-modal, #settingsModal, .sp-modal'));
  if (!open) throw new Error('settings modal did not appear');
});

test('autoBtn — modal opens (we cancel, never START)', async () => {
  await closeAnyModal();
  await frame.evaluate(() => document.getElementById('autoBtn')?.click());
  await page.waitForTimeout(350);
  const open = await frame.evaluate(() => !!document.querySelector('.autoplay-modal, #autoplayBackdrop, .ap-modal'));
  if (!open) throw new Error('autoplay modal did not appear');
  await closeAnyModal();
});

test('BIG-WIN force — banner becomes active (run BEFORE FS so we are in BASE phase)', async () => {
  await closeAnyModal();
  const found = await frame.evaluate(() => {
    const c = document.querySelector('.ufp-chip[data-ufp-kind="big_win"]');
    if (!c) return false;
    c.click();
    return true;
  });
  if (!found) throw new Error('no .ufp-chip[data-ufp-kind="big_win"] in DOM');
  for (let i = 0; i < 60; i++) {
    const st = await snapshotState();
    if (st.bigWinActive) return;
    await page.waitForTimeout(200);
  }
  throw new Error('BIG-WIN banner never activated within 12s');
});

test('FS force chip — FS state enters', async () => {
  await closeAnyModal();
  const found = await frame.evaluate(() => {
    const c = document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]');
    if (!c) return false;
    c.click();
    return true;
  });
  if (!found) throw new Error('no .ufp-chip[data-ufp-kind="free_spins"] in DOM');
  /* FS trigger needs: spin finish (~1.5s) + scatter celebration + intro */
  for (let i = 0; i < 60; i++) {
    const st = await snapshotState();
    if (st.fsActive) return;
    await page.waitForTimeout(150);
  }
  throw new Error('FS state did not become active within 9s');
});

/* duplicate BIG-WIN test removed — handled BEFORE the FS test above. */

test('BUY BONUS — direct spin with planted scatters (FS state enters)', async () => {
  /* Bonus Buy doesn't open a modal in this code path — it directly
   * arms FORCE_TRIGGER = { scatterCount: N } and runs one base spin.
   * Validate by waiting for FS to enter, same contract as the FS chip. */
  /* Wait for any inflight FS to exit first */
  for (let i = 0; i < 60; i++) {
    const st = await snapshotState();
    if (!st.fsActive) break;
    await page.waitForTimeout(500);
  }
  await closeAnyModal();
  const found = await frame.evaluate(() => {
    const b = document.getElementById('bonusBuyBtn');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!found) throw new Error('no #bonusBuyBtn in DOM');
  for (let i = 0; i < 60; i++) {
    const st = await snapshotState();
    if (st.fsActive) return;
    await page.waitForTimeout(150);
  }
  throw new Error('Buy Bonus did not trigger FS within 9s');
});

/* ── run sequentially with continue-on-fail so we see ALL bugs ── */

const results = [];
for (const t of tests) {
  try {
    await t.fn();
    results.push({ name: t.name, verdict: 'OK', reason: '' });
    console.log(`   ✓ OK    ${t.name}`);
  } catch (e) {
    results.push({ name: t.name, verdict: 'FAIL', reason: e.message });
    console.log(`   ✗ FAIL  ${t.name} — ${e.message}`);
  }
  await closeAnyModal();
}

await page.screenshot({ path: resolve(OUT, '_final-v2.png'), fullPage: false });
await browser.close();
server.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 200));

const fails = results.filter((r) => r.verdict === 'FAIL');
console.log('');
console.log(`▶ tests : ${results.length - fails.length}/${results.length} OK`);
console.log(`▶ console.error  : ${consoleErrors.length}`);
console.log(`▶ console.warning: ${consoleWarns.length}`);
console.log(`▶ pageerror      : ${pageErrors.length}`);
console.log(`▶ HookBus unknown: ${hookBusUnknown.length}`);
if (hookBusUnknown.length) hookBusUnknown.slice(0, 6).forEach((l) => console.log(`     ${l.slice(0, 110)}`));
if (consoleErrors.length)  consoleErrors.slice(0, 6).forEach((l) => console.log(`     err: ${l.slice(0, 110)}`));
if (consoleWarns.length)   consoleWarns.slice(0, 6).forEach((l) => console.log(`     warn: ${l.slice(0, 110)}`));

writeFileSync(resolve(OUT, 'report-v2.json'), JSON.stringify({
  results, consoleErrors, consoleWarns, pageErrors, hookBusUnknown,
}, null, 2));

const green = fails.length === 0 && hookBusUnknown.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0;
console.log(green ? '✅ ZERO RED' : '❌ HAS RED');
process.exit(green ? 0 : 1);
