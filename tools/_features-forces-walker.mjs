#!/usr/bin/env node
/**
 * tools/_features-forces-walker.mjs
 *
 * Boki imperative: "sad tako prodji za ostala tri gdd glavna u folderu
 * i sve ispravi plus napravi da rade i feature i forsovi".
 *
 * For each GDD in samples/, upload it, enumerate every UFP force chip,
 * click each one, and assert that SOMETHING visible happens:
 *   • An overlay (wbOverlay / gambleOverlay / bpOverlay / hwHud / etc.)
 *     becomes visible, OR
 *   • A force banner is painted by genericFeatureBanner, OR
 *   • The spin button gets disabled (a real spin started), OR
 *   • The grid grew at least one new class (cell-spinning, has-orb, etc.)
 *
 * Report: per-GDD, per-kind PASS/FAIL with the matched signal.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = `${REPO}/tools/_eyes/features-forces`;
mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { name: 'wrath',    path: `${REPO}/samples/WRATH_OF_OLYMPUS_GAME_GDD.md` },
  { name: 'crystal',  path: `${REPO}/samples/CRYSTAL_FORGE_GAME_GDD.md` },
  { name: 'gates',    path: `${REPO}/samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md` },
  { name: 'midnight', path: `${REPO}/samples/MIDNIGHT_FANGS_GAME_GDD.md` },
];

const OVERLAY_FOR_KIND = {
  wheel_bonus:  '#wbOverlay',
  gamble:       '#gambleOverlay',
  bonus_pick:   '#bpOverlay',
  hold_and_win: '#hwHud',
  free_spins:   '#fsIntroOverlay,#fsStageBadge',
  bonus_buy:    '.bb-modal,#bonusBuyOverlay',
};

const log = (s) => process.stdout.write(s + '\n');

const PORT = 5988;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page    = await ctx.newPage();

const rows = [];
let pass = 0, fail = 0;

for (const target of TARGETS) {
  log(`\n=== ${target.name} ===`);
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 25000 });
    await page.setInputFiles('#fileInput', target.path);
    await page.waitForSelector('#previewFrame', { timeout: 20000 });
    // Wait for iframe to actually mount.
    let frame = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await page.waitForTimeout(250);
      const candidates = page.frames();
      frame = candidates.find(f => f !== page.mainFrame());
      if (frame) {
        const ready = await frame.evaluate(() => !!document.querySelector('.ufp-chip')).catch(() => false);
        if (ready) break;
        frame = null;
      }
    }
    if (!frame) {
      rows.push({ target: target.name, kind: '-', status: 'FAIL (no iframe / no chips)' });
      fail++;
      continue;
    }

    const chips = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]')).map(c => c.getAttribute('data-ufp-kind'))
    );
    log('  chips: ' + chips.join(','));

    for (const kind of chips) {
      log('    > clicking: ' + kind);
      try {
      // Snapshot state before click
      const before = await frame.evaluate((sel) => {
        const overlays = sel ? sel.split(',').map(s => document.querySelector(s.trim())).filter(Boolean) : [];
        const overlayVisible = overlays.some(el => {
          const cs = getComputedStyle(el);
          return (el.dataset.show === 'true') || (cs.display !== 'none' && parseFloat(cs.opacity) > 0.1);
        });
        const spinBtn = document.getElementById('spinBtn');
        return {
          overlayVisible,
          banner: !!document.querySelector('.gfb-banner[data-visible="true"]'),
          spinDisabled: spinBtn ? spinBtn.disabled : null,
          cellSpinning: !!document.querySelector('.cell.is-spinning,.cell.cell-spinning'),
          hwHudShow: (document.getElementById('hwHud') || {}).dataset?.show,
          fsmPhase: window.FSM && window.FSM.phase,
        };
      }, OVERLAY_FOR_KIND[kind] || null);

      // Click the chip
      const clicked = await frame.evaluate(k => {
        const b = document.querySelector('.ufp-chip[data-ufp-kind="' + k + '"]');
        if (!b) return false;
        b.click();
        return true;
      }, kind);

      await frame.waitForTimeout(2200);

      // Snapshot state after — broad signal capture
      const after = await frame.evaluate((sel) => {
        const overlays = sel ? sel.split(',').map(s => document.querySelector(s.trim())).filter(Boolean) : [];
        const overlayVisible = overlays.some(el => {
          const cs = getComputedStyle(el);
          return (el.dataset.show === 'true') || (cs.display !== 'none' && parseFloat(cs.opacity) > 0.1);
        });
        const spinBtn = document.getElementById('spinBtn');
        const anyOverlayWithData = !!document.querySelector('[data-show="true"]');
        const anyBanner = !!document.querySelector(
          '.gfb-banner[data-visible="true"], .multiplier-banner.show, .stage-badge[data-visible="true"], .toast.show, [class*="-overlay"][data-show="true"]'
        );
        const orbChip = !!document.querySelector('.ufp-mult-chip');
        return {
          overlayVisible,
          anyOverlayWithData,
          banner: anyBanner || orbChip,
          spinDisabled: spinBtn ? spinBtn.disabled : null,
          cellSpinning: !!document.querySelector('.cell.is-spinning, .cell.cell-spinning, .reels.spinning, [data-spinning="true"]'),
          hwHudShow: (document.getElementById('hwHud') || {}).dataset?.show,
          fsmPhase: window.FSM && window.FSM.phase,
          fsActive: window.FSM && /FS|FREE/.test(window.FSM.phase || ''),
          lockedCells: document.querySelectorAll('.cell.is-locked-bonus').length,
          forceFeatureGlobal: window.__FORCE_FEATURE__ || null,
        };
      }, OVERLAY_FOR_KIND[kind] || null);

      let signal = null;
      if (after.overlayVisible && !before.overlayVisible) signal = 'OVERLAY';
      else if (after.overlayVisible) signal = 'OVERLAY (already up)';
      else if (after.hwHudShow === 'true' && before.hwHudShow !== 'true') signal = 'HW-HUD';
      else if (after.lockedCells > before.lockedCells) signal = 'LOCKED-ORBS+' + (after.lockedCells - before.lockedCells);
      else if (after.banner && !before.banner) signal = 'BANNER';
      else if (after.cellSpinning && !before.cellSpinning) signal = 'SPIN';
      else if (after.fsActive && !before.fsActive) signal = 'FS-PHASE';
      else if (after.fsmPhase !== before.fsmPhase) signal = 'FSM:' + after.fsmPhase;
      else if (after.forceFeatureGlobal === kind) signal = 'FORCE-GLOBAL';
      else if (after.anyOverlayWithData && !before.anyOverlayWithData) signal = 'ANY-OVERLAY';

      const ok = !!signal;
      if (ok) pass++; else fail++;
      rows.push({ target: target.name, kind, status: ok ? ('PASS [' + signal + ']') : 'FAIL (no visible reaction)' });

      // Reset overlay state to avoid bleeding into next probe
      await frame.evaluate(() => {
        ['#wbOverlay','#gambleOverlay','#bpOverlay','#hwHud','#fsIntroOverlay','#fsStageBadge'].forEach(s => {
          const el = document.querySelector(s);
          if (el && el.dataset) el.dataset.show = 'false';
        });
        if (window.HW_STATE) window.HW_STATE.active = false;
        if (window.FSM && window.FSM.phase && /FS|FREE/.test(window.FSM.phase)) {
          try { window.FSM.phase = 'IDLE'; } catch (_) {}
        }
      }).catch(() => {});
      await frame.waitForTimeout(150);
      log('      ✓ ' + (rows[rows.length - 1] || { status: '?' }).status);
      } catch (perChipErr) {
        log('      ✗ ' + String(perChipErr).slice(0, 120));
        rows.push({ target: target.name, kind, status: 'FAIL (per-chip ' + String(perChipErr).slice(0, 60) + ')' });
        fail++;
      }
    }
  } catch (e) {
    rows.push({ target: target.name, kind: '-', status: 'FAIL (' + String(e).slice(0, 80) + ')' });
    fail++;
  }
}

await browser.close();
server.kill();

log('\n┌──────────┬────────────────────┬──────────────────────────');
for (const r of rows) {
  log('│ ' + r.target.padEnd(8) + ' │ ' + r.kind.padEnd(18) + ' │ ' + r.status);
}
log('└──────────┴────────────────────┴──────────────────────────');
log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
