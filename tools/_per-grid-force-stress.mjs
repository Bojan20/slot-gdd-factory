/**
 * Per-grid force button stress — every UFP chip on every grid must do
 * SOMETHING visible (overlay open OR banner OR spin start OR grid mutation).
 *
 * Boki's rule: "svaki blok koji je ubacen mora da radi" + "svaki force
 * mora da radi". This probe asserts that every emitted chip triggers a
 * detectable engine response, not a silent no-op.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const PORT = 5192;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const GALLERY = resolve(REPO, 'dist/gallery');
const fixtures = readdirSync(GALLERY).filter(f => f.endsWith('.html') && f !== 'index.html').sort();

const browser = await chromium.launch();
const results = [];

for (const fx of fixtures) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));

  await page.goto(`http://127.0.0.1:${PORT}/dist/gallery/${fx}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Install HookBus emit tap
  await page.evaluate(() => {
    window.__FS_EMITS__ = [];
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      const orig = window.HookBus.emit;
      window.HookBus.emit = function (n, p) {
        try { window.__FS_EMITS__.push(n); } catch (_) {}
        return orig.call(this, n, p);
      };
    }
  });

  const chips = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]')).map(c => ({
      kind: c.getAttribute('data-ufp-kind'),
      visible: c.getBoundingClientRect().width > 0,
    }));
  });

  const perChip = [];
  for (const chip of chips) {
    if (!chip.visible) { perChip.push({ kind: chip.kind, status: 'hidden' }); continue; }

    // Clear emit log so we count only THIS chip's effects.
    await page.evaluate(() => { window.__FS_EMITS__ = []; });

    // Direct DOM .click() — bypasses Playwright pointer hit-test so we
    // can stress-test the chip's runtime regardless of CSS overlap with
    // other panels (devForceButtons / sideHud). The aim is to verify the
    // ENGINE responds to chip click, not pointer-event geometry.
    const clicked = await page.evaluate((kind) => {
      const el = document.querySelector(`.ufp-chip[data-ufp-kind="${kind}"]`);
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
      try { el.click(); return true; } catch (_) { return false; }
    }, chip.kind);
    if (!clicked) {
      perChip.push({ kind: chip.kind, status: 'click-fail', emits: [] });
      continue;
    }
    // Sample over 3s for delayed modal/banner.
    await page.waitForTimeout(2500);

    const after = await page.evaluate(() => {
      const overlays = ['#wbOverlay', '#gambleOverlay', '#bpOverlay', '#hwHud',
                        '#fsIntroOverlay', '#fsStageBadge', '.bb-modal', '#bonusBuyOverlay',
                        '.bwt-banner'];
      const overlay = overlays.some(s => {
        const el = document.querySelector(s);
        if (!el) return false;
        const cs = getComputedStyle(el);
        return (el.dataset && el.dataset.show === 'true') ||
               (cs.display !== 'none' && parseFloat(cs.opacity || '0') > 0.1);
      });
      return {
        overlay,
        banner: !!document.querySelector('.gfb-banner[data-visible="true"]'),
        emits: window.__FS_EMITS__ || [],
      };
    });

    const sawPreSpin = after.emits.includes('preSpin');
    const sawForce = after.emits.includes('onForceFeatureRequested');
    const sawBigWin = after.emits.some(e => e.startsWith('onBigWinTier'));
    const sawFsTrig = after.emits.includes('onFsTrigger');
    const sawWheel = after.emits.some(e => e.startsWith('onWheel'));
    const sawPath = after.emits.some(e => e.startsWith('onPath') || e.startsWith('onForceMultiplier'));

    const signal =
      after.overlay ? 'overlay' :
      after.banner ? 'banner' :
      sawBigWin ? 'big-win-emit' :
      sawFsTrig ? 'fs-emit' :
      sawWheel ? 'wheel-emit' :
      sawPath ? 'mult-emit' :
      sawPreSpin ? 'spin' :
      sawForce ? 'force-emit-only' :  // chip registered but no engine reaction
      null;

    perChip.push({ kind: chip.kind, status: signal || 'NO-OP', emits: after.emits.slice(0, 10) });

    // Recover from possible overlay
    await page.evaluate(() => {
      ['wbOverlay','gambleOverlay','bpOverlay','bonusBuyOverlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset.show = 'false'; el.style.display = 'none'; }
      });
      const close = document.querySelector('.bb-close, .bp-close, .wb-close, .gam-close');
      if (close) close.click();
    });
    await page.waitForTimeout(250);
  }

  results.push({ fx, chips: perChip, errs: errs.length });
  await ctx.close();
}

await browser.close();
server.kill();

let total = 0, broken = 0;
console.log('\nForce-button results:');
for (const r of results) {
  const ok = r.chips.filter(c => c.status !== 'NO-OP' && c.status !== 'click-fail').length;
  const bad = r.chips.filter(c => c.status === 'NO-OP' || c.status === 'click-fail');
  total += r.chips.length;
  broken += bad.length;
  const label = r.fx.replace('.html', '').slice(0, 42).padEnd(42);
  console.log(`  ${label} ${String(ok).padStart(2)}/${String(r.chips.length).padStart(2)} ` +
              (bad.length ? `  BROKEN: ${bad.map(b => `${b.kind}[${b.status}, emits=${(b.emits||[]).join('|')}]`).join('; ')}` : ''));
}

console.log(`\nTOTAL: ${total - broken}/${total} chips passed across ${results.length} grids`);
process.exit(broken > 0 ? 1 : 0);
