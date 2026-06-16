#!/usr/bin/env node
/**
 * tools/_wheel-gamble-force-probe.mjs
 *
 * Multi-GDD live probe — UPDATED 2026-06-16 for `rule_force_buttons_real_spin`.
 *
 * Force pattern (current contract):
 *   chip click  →  base spin runs  →  postSpin hook  →  overlay opens
 *
 * Per kind:
 *   • wheel_bonus / gamble / bonus_pick: chip arms `__FORCE_*_OPEN__` flag,
 *     spin runs, postSpin opens overlay. We wait long enough (≤8 s) for
 *     the spin to complete and the overlay to render.
 *   • hold_and_win: chip plants FORCE_TRIGGER → spin lands bonus pile →
 *     postSpin → hwMaybeEnter activates HW HUD. Fallback `hwForceSeed`
 *     fires at HW_T_FORCE_FALLBACK_MS (≈2.6 s) if the natural pile
 *     refuses to land.
 *
 * We assert: (a) spin DID run after chip click, (b) overlay/HUD visible
 * after the spin settles. Old "no parallel spin" assertion is INVERTED
 * because real-spin pattern requires the spin to happen.
 *
 * Exits 0 if every probe row passes its assertion.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/wheel-gamble-force`;
mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { name: 'huff',        path: `${process.env.HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'wrath',       path: `${REPO}/samples/WRATH_OF_OLYMPUS_GAME_GDD.md` },
  { name: 'crystal',     path: `${REPO}/samples/CRYSTAL_FORGE_GAME_GDD.md` },
  { name: 'gates',       path: `${REPO}/samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md` },
  { name: 'midnight',    path: `${REPO}/samples/MIDNIGHT_FANGS_GAME_GDD.md` },
];

const PORT = 5783;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page    = await ctx.newPage();

const rows = [];
let pass = 0, fail = 0;

const FORCE_KINDS = [
  { kind: 'wheel_bonus',  overlaySel: '#wbOverlay'      },
  { kind: 'gamble',       overlaySel: '#gambleOverlay'  },
  { kind: 'bonus_pick',   overlaySel: '#bpOverlay'      },
  { kind: 'hold_and_win', overlaySel: '#hwHud'          },
];

for (const target of TARGETS) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.setInputFiles('#fileInput', target.path);
  await page.waitForSelector('#previewFrame', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) {
    rows.push({ target: target.name, kind: '-', status: 'FAIL (no iframe)' });
    fail++;
    continue;
  }

  const availableChips = await frame.evaluate(() => Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]')).map(c => c.getAttribute('data-ufp-kind')));

  for (const { kind, overlaySel } of FORCE_KINDS) {
    if (!availableChips.includes(kind)) {
      rows.push({ target: target.name, kind, status: 'skip (no chip — GDD lacks this feature)' });
      continue;
    }

    // Close any prior overlay first
    await frame.evaluate((sels) => {
      sels.forEach(s => { const el = document.querySelector(s); if (el && el.dataset) el.dataset.show = 'false'; });
    }, FORCE_KINDS.map(f => f.overlaySel));
    await frame.waitForTimeout(100);

    /* Arm canonical spin signal via HookBus BEFORE clicking chip. The
     * preSpin event is the single authoritative "real spin starting"
     * signal per LEGO contract — reelEngine.runOneBaseSpin emits it. */
    await frame.evaluate(() => {
      window.__PROBE_SAW_PRESPIN__ = false;
      window.__PROBE_SAW_POSTSPIN__ = false;
      if (window.HookBus && typeof window.HookBus.on === 'function') {
        window.HookBus.on('preSpin', () => { window.__PROBE_SAW_PRESPIN__ = true; });
        window.HookBus.on('postSpin', () => { window.__PROBE_SAW_POSTSPIN__ = true; });
      }
    });

    await frame.evaluate(k => {
      const b = document.querySelector('.ufp-chip[data-ufp-kind="' + k + '"]');
      if (b) b.click();
    }, kind);

    /* Wait until postSpin fires (preSpin → spin runs → postSpin) — capped
     * at 8 s. */
    let spinRan = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const flags = await frame.evaluate(() => ({
        pre:  !!window.__PROBE_SAW_PRESPIN__,
        post: !!window.__PROBE_SAW_POSTSPIN__,
      }));
      if (flags.pre) spinRan = true;
      if (flags.pre && flags.post) break;
      await frame.waitForTimeout(120);
    }

    /* Settle pad — allow postSpin → wbOpen / hwForceSeed to land. */
    await frame.waitForTimeout(kind === 'hold_and_win' ? 3200 : 700);

    const visible = await frame.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return { exists: false };
      const cs = getComputedStyle(el);
      const show = el.dataset && el.dataset.show;
      return {
        exists: true,
        show,
        display: cs.display,
        opacity: cs.opacity,
        /* H&W HUD uses display flex w/o data-show; modal kinds use data-show. */
        ok: (cs.display !== 'none' && parseFloat(cs.opacity) > 0.1 &&
             (show === 'true' || show === undefined || show === null)),
      };
    }, overlaySel);

    const ok = !!visible.ok;
    if (ok) pass++; else fail++;
    rows.push({
      target: target.name,
      kind,
      status: ok ? 'PASS' : ('FAIL ' + JSON.stringify(visible)),
    });

    /* Real-spin assertion (positive): a force chip MUST cause a real
     * base spin per `rule_force_buttons_real_spin`. */
    rows.push({
      target: target.name,
      kind: kind + '   (real-spin check)',
      status: spinRan ? 'PASS' : 'FAIL (no spin ran)',
    });
    if (spinRan) pass++; else fail++;
  }
}

await browser.close();
server.kill();

console.log('\n┌──────────────┬──────────────────────────────┬─────────');
for (const r of rows) {
  console.log('│ ' + r.target.padEnd(12) + ' │ ' + r.kind.padEnd(28) + ' │ ' + r.status);
}
console.log('└──────────────┴──────────────────────────────┴─────────');
console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
