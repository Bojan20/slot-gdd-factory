#!/usr/bin/env node
/** Inspect live Huff playable state after each force-chip click. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const HOME = process.env.HOME;
const PDF  = (existsSync(`${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`) ? `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` : `${HOME}/Desktop/Huff_N_More_Puff_GDD.pdf`);
if (!existsSync(PDF)) { console.error('no PDF'); process.exit(2); }
const PORT = 5237;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: process.cwd(), stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /unknown event|FORCE|fs|FSM|FREESPINS/i.test(t)) {
    console.log('  console:', m.type(), '·', t.slice(0, 140));
  }
});
page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 140)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await (await page.$('#fileInput')).setInputFiles(PDF);
await page.waitForSelector('#previewFrame', { timeout: 15000 });
await page.waitForTimeout(800);
const frame = page.frames().find((f) => f !== page.mainFrame());

console.log('— BEFORE any click —');
const before = await frame.evaluate(() => ({
  hasHookBus: !!window.HookBus,
  hasRunOneBaseSpin: typeof window.runOneBaseSpin,
  hasFREESPINS: typeof window.FREESPINS,
  FREESPINS: window.FREESPINS ? Object.keys(window.FREESPINS) : null,
  hasFSM: typeof window.FSM,
  FSM: window.FSM ? Object.keys(window.FSM) : null,
  hasFORCE_TRIGGER: typeof window.FORCE_TRIGGER,
  FORCE_TRIGGER: window.FORCE_TRIGGER,
  hasBIG_WIN_STATE: typeof window.BIG_WIN_TIER_STATE,
  BIG_WIN_TIER_STATE: window.BIG_WIN_TIER_STATE,
  chipKinds: Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]')).map(c => c.getAttribute('data-ufp-kind')),
  spinBtnEnabled: (() => { const b = document.getElementById('spinBtn'); return b ? { disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') } : null; })(),
  hasBonusBuyBtn: !!document.getElementById('bonusBuyBtn'),
}));
console.dir(before, { depth: 4 });

/* Pre-arm hookbus counters BEFORE the click so we capture the first emit. */
await frame.evaluate(() => {
  window.__DBG_PRESPIN__ = 0;
  window.__DBG_ONSPINRESULT__ = 0;
  window.__DBG_FSTRIGGER__ = 0;
  window.__DBG_PHASES__ = [];
  window.HookBus.on('preSpin', () => { window.__DBG_PRESPIN__++; window.__DBG_PHASES__.push('preSpin:' + window.FSM.phase); }, { priority: -100 });
  window.HookBus.on('onSpinResult', () => { window.__DBG_ONSPINRESULT__++; window.__DBG_PHASES__.push('onSpinResult:' + window.FSM.phase); }, { priority: -100 });
  window.HookBus.on('onFsTrigger', () => { window.__DBG_FSTRIGGER__++; window.__DBG_PHASES__.push('onFsTrigger:' + window.FSM.phase); }, { priority: -100 });
  window.HookBus.on('postSpin', () => { window.__DBG_PHASES__.push('postSpin:' + window.FSM.phase); }, { priority: -100 });
});

console.log('\n— click FS chip —');
const fsClick = await frame.evaluate(() => {
  const c = document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]');
  if (!c) return 'no chip';
  c.click();
  return { clicked: true, FORCE_TRIGGER: window.FORCE_TRIGGER, __FORCE_FEATURE__: window.__FORCE_FEATURE__ };
});
console.log('  immediate:', fsClick);
for (let s = 0; s < 6; s++) {
  await page.waitForTimeout(500);
  const st = await frame.evaluate(() => ({
    t: Date.now() % 100000,
    phase: window.FSM ? window.FSM.phase : null,
    spinBtn_isSpinning: (() => { const b = document.getElementById('spinBtn'); return b ? b.classList.contains('is-spinning') : null; })(),
    FORCE_TRIGGER: window.FORCE_TRIGGER,
    preSpin: window.__DBG_PRESPIN__,
    onSpinResult: window.__DBG_ONSPINRESULT__,
    onFsTrigger: window.__DBG_FSTRIGGER__,
    phases: window.__DBG_PHASES__.slice(-6),
  }));
  console.log(`  t+${(s+1)*0.5}s:`, st);
}

console.log('\n— click BIG-WIN chip —');
await frame.evaluate(() => { window.__FORCE_FEATURE__ = null; window.FORCE_TRIGGER = null; });
const bwClick = await frame.evaluate(() => {
  const c = document.querySelector('.ufp-chip[data-ufp-kind="big_win"]');
  if (!c) return 'no chip';
  c.click();
  return { clicked: true, __FORCE_BIG_WIN_TIER__: window.__FORCE_BIG_WIN_TIER__, __FORCE_FEATURE__: window.__FORCE_FEATURE__ };
});
console.log('  immediate:', bwClick);

for (let s = 0; s < 5; s++) {
  await page.waitForTimeout(800);
  const st = await frame.evaluate(() => ({
    BWS: window.BIG_WIN_TIER_STATE,
    __FORCE_BIG_WIN_TIER__: window.__FORCE_BIG_WIN_TIER__,
    FSM_state: window.FSM ? window.FSM.state : null,
  }));
  console.log(`  t+${s+1}s:`, st);
}

await browser.close();
server.kill('SIGTERM');
