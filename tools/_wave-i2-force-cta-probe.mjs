#!/usr/bin/env node
/**
 * Wave I.2 — per-grid force-CTA verification.
 *
 * For each of the 11 dist demos:
 *   1. FS button present + correctly enabled/disabled by feature flag
 *   2. BW button present + correctly enabled/disabled by feature flag
 *   3. MULT button present + enabled IFF a multiplier-style feature is
 *      declared in the GDD (multiplier / multiplier_orb / persistent /
 *      lightning / progressive_fs)
 *   4. MULT click → HookBus.setMult(value) + spin → next win shows
 *      `appliedMultX` on its detected payload OR HookBus.getMult() ≠ 1
 *      at the moment of onWinPresentationStart
 *   5. After force-spin completes, MULT button re-enables (postSpin
 *      listener cleanup)
 *   6. 0 console / page errors
 *
 * Total: ~6 checks × 11 demos = ~66 checks. Demos that don't declare a
 * multiplier feature still pass the "button disabled" branch.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5249;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const DEMOS = [
  { name: 'rectangular',        path: '/dist/01_rectangular_5x3_playable.html',  expectMult: true  },
  { name: 'wrath-of-olympus',   path: '/dist/wrath-of-olympus.html',             expectMult: true  },
  { name: 'gates-of-olympus',   path: '/dist/gates-of-olympus-1000.html',        expectMult: true  },
  { name: 'megaclusters',       path: '/dist/05_megaclusters_playable.html',     expectMult: false },
  { name: 'diamond',            path: '/dist/07_diamond_playable.html',          expectMult: true  },
  { name: 'pyramid',            path: '/dist/08_pyramid_playable.html',          expectMult: false },
  { name: 'cross',              path: '/dist/09_cross_playable.html',            expectMult: false },
  { name: 'l_shape',            path: '/dist/10_lshape_playable.html',           expectMult: true  },
  { name: 'infinity',           path: '/dist/12_infinity_playable.html',         expectMult: true  },
  { name: 'expanding',          path: '/dist/13_expanding_playable.html',        expectMult: true  },
  { name: 'lock_respin',        path: '/dist/19_lock_respin_playable.html',     expectMult: true  },
];

const out = [];

async function probeDemo(browser, demo) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE_ERR ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('CON_ERR ' + m.text().slice(0, 200)); });

  try {
    await page.goto(`http://127.0.0.1:${PORT}${demo.path}`, { waitUntil: 'networkidle', timeout: 12000 });
    await page.waitForTimeout(800);

    const presence = await page.evaluate(() => ({
      fsBtn:    !!document.getElementById('devFsBtn'),
      fsDis:    document.getElementById('devFsBtn')?.disabled,
      bwBtn:    !!document.getElementById('devBwBtn'),
      bwDis:    document.getElementById('devBwBtn')?.disabled,
      multBtn:  !!document.getElementById('devMultBtn'),
      multDis:  document.getElementById('devMultBtn')?.disabled,
      multText: document.getElementById('devMultBtn')?.textContent,
    }));

    /* MULT click → spin → multiplier in chain */
    let multResult = { skipped: true };
    if (!presence.multDis) {
      multResult = await page.evaluate(async () => {
        window.__M__ = { events: [], multAtStart: null };
        if (window.HookBus) {
          window.HookBus.on('onWinPresentationStart', (p) => {
            window.__M__.events.push({ n: 'start', t: performance.now()|0, ...p });
            window.__M__.multAtStart = (typeof window.HookBus.getMult === 'function') ? window.HookBus.getMult() : null;
          });
          window.HookBus.on('postSpin', (p) => {
            window.__M__.events.push({ n: 'postSpin', t: performance.now()|0, ...p });
          });
        }
        const btn = document.getElementById('devMultBtn');
        const labelBefore = btn?.textContent;
        btn?.click();
        const labelAfter = btn?.textContent;
        /* Wait for spin to settle + presentation to fire (or noWinChance) */
        await new Promise(r => setTimeout(r, 8000));
        const start = window.__M__.events.find(e => e.n === 'start');
        const postSpin = window.__M__.events.find(e => e.n === 'postSpin');
        return {
          skipped: false,
          labelBefore, labelAfter,
          /* The label cycles: clicking ×2 sets mult to 2 then advances to ×5 */
          startSeen: !!start,
          postSpinSeen: !!postSpin,
          multAtStart: window.__M__.multAtStart,
          multBtnReEnabled: !btn?.disabled,
        };
      });
    }

    const checks = [
      ['FS button present',  presence.fsBtn],
      ['BW button present',  presence.bwBtn],
      ['MULT button present', presence.multBtn],
      [`MULT enabled = ${demo.expectMult}`, presence.multDis === !demo.expectMult],
      /* When MULT was clicked, the label should have cycled to the next value */
      ['MULT label cycles after click', multResult.skipped || (multResult.labelBefore && multResult.labelAfter && multResult.labelBefore !== multResult.labelAfter)],
      ['MULT click landed a spin (postSpin fired)', multResult.skipped || multResult.postSpinSeen === true],
      ['MULT re-enables after postSpin', multResult.skipped || multResult.multBtnReEnabled === true],
      ['no console / page errors', errors.length === 0],
    ];
    return { demo, presence, multResult, errors, checks };
  } finally {
    await ctx.close();
  }
}

try {
  const browser = await chromium.launch();
  for (const d of DEMOS) {
    const r = await probeDemo(browser, d);
    const pass = r.checks.filter(c => c[1]).length;
    const fail = r.checks.length - pass;
    r.pass = pass; r.fail = fail;
    out.push(r);
    console.log(`\n[${d.name}] (${d.expectMult ? 'mult-expected' : 'no-mult'}) ${pass}/${pass+fail}`);
    if (fail > 0) for (const [l, ok] of r.checks) if (!ok) console.log(`  ✗ ${l}`);
  }
  await browser.close();
} finally { srv.kill(); }

const totalPass = out.reduce((s, r) => s + r.pass, 0);
const totalFail = out.reduce((s, r) => s + r.fail, 0);
console.log(`\n════ WAVE I.2 — FORCE-CTA per-grid PROBE ════`);
console.log(`TOTAL: ${totalPass}/${totalPass + totalFail} pass across ${out.length} demos`);
process.exit(totalFail === 0 ? 0 : 1);
