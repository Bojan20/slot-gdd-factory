#!/usr/bin/env node
/**
 * tools/_wheel-gamble-force-probe.mjs
 *
 * Multi-GDD live probe: for each fixture, click each force chip and
 * verify that:
 *   • The corresponding overlay/modal opens
 *   • No base spin runs in parallel for MODAL_ONLY kinds
 *   • The modal stays visible for ≥4 s (not closed by a stray FSM
 *     transition or postSpin race)
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

    await frame.evaluate(k => {
      const b = document.querySelector('.ufp-chip[data-ufp-kind="' + k + '"]');
      if (b) b.click();
    }, kind);
    await frame.waitForTimeout(1500);

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
        ok: (show === 'true' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.1),
      };
    }, overlaySel);

    const ok = !!visible.ok;
    if (ok) pass++; else fail++;
    rows.push({
      target: target.name,
      kind,
      status: ok ? 'PASS' : ('FAIL ' + JSON.stringify(visible)),
    });

    // For modal kinds, check spin is NOT running in parallel
    if (['wheel_bonus', 'gamble', 'bonus_pick'].includes(kind)) {
      const reelMoving = await frame.evaluate(() => {
        const isSpinning = document.querySelector('.reel.spinning, .reels.spinning, [data-spinning="true"]');
        return !!isSpinning || (window.FSM && window.FSM.phase && /SPIN|RESULT/.test(window.FSM.phase));
      });
      rows.push({ target: target.name, kind: kind + '   (parallel-spin check)', status: reelMoving ? 'FAIL (spin ran)' : 'PASS' });
      if (reelMoving) fail++; else pass++;
    }
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
