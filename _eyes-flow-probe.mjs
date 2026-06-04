import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errs = []; const logs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,200)); });
page.on('pageerror', e => errs.push('PE: '+e.message.slice(0,200)));

await page.goto('http://127.0.0.1:5180/dist/01_rectangular_5x3_playable.html', { waitUntil:'networkidle' });
await page.waitForFunction(() => window.HookBus && document.getElementById('spinBtn'), null, { timeout: 8000 }).catch(()=>null);

/* Snapshot 1 — IDLE state. */
const idle = await page.evaluate(() => {
  const probe = (id) => {
    const el = document.getElementById(id);
    if (!el) return { exists:false };
    const cs = getComputedStyle(el);
    return {
      exists: true,
      hidden: el.hidden,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      text: (el.textContent||'').trim().slice(0,40),
      dataState: el.getAttribute('data-state') || null,
      classes: el.className,
    };
  };
  return {
    spinBtn:        probe('spinBtn'),
    autoBtn:        probe('autoBtn'),
    turboBtn:       probe('turboBtn'),
    slamStopBtn:    probe('slamStopBtn'),
    forceSkipBtn:   probe('forceSkipBtn'),
    balanceHud:     probe('balanceHud'),
    paytableBtn:    probe('paytableBtn'),
    historyBtn:     probe('historyBtn'),
    settingsBtn:    probe('settingsBtn'),
    autoplayBtn:    probe('autoplayBtn'),
    devFsBtn:       (() => { const el = document.querySelector('.dev-fs-btn'); return el ? { exists:true, hidden:el.hidden } : { exists:false }; })(),
    spinControlEnabled: !!window.SpinControl,
  };
});

console.log('=== IDLE state ===');
console.log(JSON.stringify(idle, null, 2));
await page.screenshot({ path: 'tools/_eyes/flow-idle.png', fullPage: true });

/* Click SPIN, sample at 50ms (SPIN→STOP morph), 300ms (STOP_POST), 1500ms (post-spin). */
await page.evaluate(() => {
  window.__SEEN__ = [];
  const _e = window.HookBus.emit;
  window.HookBus.emit = function(ev, p) {
    window.__SEEN__.push({ ev, dt: performance.now(), p:p?Object.keys(p).join(','):null });
    return _e.call(window.HookBus, ev, p);
  };
});

const sb = await page.$('#spinBtn');
if (sb) await sb.click();

await page.waitForTimeout(80);
const t80 = await page.evaluate(() => ({
  state: document.getElementById('spinBtn')?.getAttribute('data-state'),
  classes: document.getElementById('spinBtn')?.className,
  slamHidden: document.getElementById('slamStopBtn')?.hidden ?? 'no-elem',
}));
console.log('=== t=80ms ===', JSON.stringify(t80));

await page.waitForTimeout(500);
const t580 = await page.evaluate(() => ({
  state: document.getElementById('spinBtn')?.getAttribute('data-state'),
  classes: document.getElementById('spinBtn')?.className,
}));
console.log('=== t=580ms ===', JSON.stringify(t580));
await page.screenshot({ path: 'tools/_eyes/flow-stop.png', fullPage: true });

await page.waitForTimeout(1500);
const tdone = await page.evaluate(() => ({
  state: document.getElementById('spinBtn')?.getAttribute('data-state'),
  events: window.__SEEN__.map(e => e.ev).slice(0, 30).join(','),
}));
console.log('=== t=done ===', JSON.stringify(tdone));
await page.screenshot({ path: 'tools/_eyes/flow-final.png', fullPage: true });

console.log('--- console errors ('+errs.length+') ---');
for (const e of errs.slice(0,10)) console.log('  '+e);
await browser.close();
process.exit(0);
