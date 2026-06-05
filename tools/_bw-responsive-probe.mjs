#!/usr/bin/env node
/**
 * BW responsive sizing probe.
 *
 * Verifies that big-win banner sizing tracks the reels frame (not the
 * viewport), per the Wave H5.15 frame-anchored refactor. Three viewports
 * (desktop 1440x900, tablet 1024x680, phone portrait 414x800) — for each:
 *
 *   1. measure reels frame bbox
 *   2. read host element bbox + computed --bw-frame-w/h vars
 *   3. force a BW tier and read the live banner font-size
 *   4. assert (a) host bbox matches frame bbox within 1 px
 *           (b) computed --bw-frame-w equals frame width
 *           (c) banner font-size scales linearly with frame width
 *               between viewports (ratio within 0.85..1.18 of expected)
 *
 * Single dist target — rectangular_5x3 fixture has the cleanest layout
 * for measurement (no FS overlay markup).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5196;
const ROOT = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const URL_PATH = '/dist/wrath-of-olympus.html';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet',  width: 1024, height: 680 },
  { name: 'phone',   width:  414, height: 800 },
];

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const results = [];
let totalFail = 0;

try {
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('PAGE_ERR ' + e.message.slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE_ERR ' + m.text().slice(0, 200)); });

    await page.goto(`http://127.0.0.1:${PORT}${URL_PATH}`, { waitUntil: 'networkidle' });
    // Allow ResizeObserver to complete its first tick.
    await page.waitForTimeout(400);

    const measurement = await page.evaluate(() => {
      function rect(el) {
        if (!el || !el.getBoundingClientRect) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }
      const frame = document.querySelector('#frameHost');
      const host  = document.getElementById('bigWinTierHost');
      const baseline = {
        frame: rect(frame),
        host:  rect(host),
        hostCSSVars: host ? {
          x: host.style.getPropertyValue('--bw-frame-x'),
          y: host.style.getPropertyValue('--bw-frame-y'),
          w: host.style.getPropertyValue('--bw-frame-w'),
          h: host.style.getPropertyValue('--bw-frame-h'),
        } : null,
      };
      // Force tier 3 (mid ladder) with a fixed award. COMPOUND default
      // is true so the banner mounts at tier 1 first and walks up to 3.
      // We sample whatever tier the banner is currently in and compare
      // against the per-tier coefficient — that's the genuine
      // responsive-scaling signal the refactor is meant to produce.
      let banner = null;
      let bannerFontPx = null;
      let activeTier = null;
      if (typeof window.bigWinTierEnter === 'function') {
        try { window.bigWinTierEnter(3, 100); } catch (_) {}
        banner = document.querySelector('.big-win-tier-banner');
        if (banner) {
          const cs = window.getComputedStyle(banner);
          bannerFontPx = parseFloat(cs.fontSize);
          activeTier = Number(banner.getAttribute('data-tier'));
        }
      }
      return { baseline, bannerFontPx, activeTier };
    });

    // Reset BW state for next viewport iteration cleanliness.
    await page.evaluate(() => {
      try { window.bigWinTierExit && window.bigWinTierExit('skipped'); } catch (_) {}
    });

    const { baseline, bannerFontPx, activeTier } = measurement;
    const f = baseline.frame, h = baseline.host;
    const dx = h && f ? Math.abs(h.x - f.x) : Infinity;
    const dy = h && f ? Math.abs(h.y - f.y) : Infinity;
    const dw = h && f ? Math.abs(h.w - f.w) : Infinity;
    const dh = h && f ? Math.abs(h.h - f.h) : Infinity;
    const cssW = baseline.hostCSSVars ? parseFloat(baseline.hostCSSVars.w) : NaN;
    const cssH = baseline.hostCSSVars ? parseFloat(baseline.hostCSSVars.h) : NaN;
    const cssWMatch = f ? Math.abs(cssW - f.w) < 1 : false;
    const cssHMatch = f ? Math.abs(cssH - f.h) < 1 : false;

    const checks = [
      ['frame node measured',          f && f.w > 0 && f.h > 0],
      ['host node mounted',            !!h],
      ['host left ≈ frame left  (±1 px)', dx <= 1],
      ['host top  ≈ frame top   (±1 px)', dy <= 1],
      ['host width ≈ frame width (±1 px)', dw <= 1],
      ['host height ≈ frame height (±1 px)', dh <= 1],
      ['--bw-frame-w ≈ frame width  (±1 px)', cssWMatch],
      ['--bw-frame-h ≈ frame height (±1 px)', cssHMatch],
      ['banner rendered with positive font-size', bannerFontPx > 0],
      ['no console / page errors',     errs.length === 0],
    ];
    const pass = checks.filter(c => c[1]).length;
    const fail = checks.length - pass;
    totalFail += fail;

    results.push({
      viewport: vp,
      frame: f,
      host: h,
      hostCSSVars: baseline.hostCSSVars,
      bannerFontPx,
      activeTier,
      checks,
      pass,
      fail,
      errors: errs,
    });

    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}

// Cross-viewport linear-scale check on banner font-size.
// COMPOUND walkthrough starts at tier 1, so we sample whichever tier is
// active and compare against ITS coefficient. The whole point is that
// font-size derives from --bw-frame-w via the tier-specific clamp:
//   tier 1: clamp(40,  0.075 × w, 90)
//   tier 2: clamp(46,  0.085 × w, 102)
//   tier 3: clamp(52,  0.095 × w, 114)
//   tier 4: clamp(58,  0.105 × w, 126)
//   tier 5: clamp(64,  0.115 × w, 140)
const TIER_SPEC = {
  1: { floor: 40, coef: 0.075, ceil: 90  },
  2: { floor: 46, coef: 0.085, ceil: 102 },
  3: { floor: 52, coef: 0.095, ceil: 114 },
  4: { floor: 58, coef: 0.105, ceil: 126 },
  5: { floor: 64, coef: 0.115, ceil: 140 },
};
function expectedForTier(tier, frameW) {
  const s = TIER_SPEC[tier];
  if (!s || !frameW || !isFinite(frameW)) return null;
  return Math.min(s.ceil, Math.max(s.floor, s.coef * frameW));
}
function within(actual, exp, tol = 0.04) {
  if (!isFinite(actual) || !isFinite(exp)) return false;
  return Math.abs(actual - exp) / exp <= tol;
}
const scaleChecks = results.map(r => {
  const exp = expectedForTier(r.activeTier, r.frame?.w);
  return [
    `${r.viewport.name.padEnd(7)} tier-${r.activeTier} font ${r.bannerFontPx?.toFixed(2)} ≈ ${exp?.toFixed(2)} (clamp from --bw-frame-w=${r.frame?.w?.toFixed(0)}px)`,
    within(r.bannerFontPx, exp),
  ];
});
const scalePass = scaleChecks.filter(c => c[1]).length;
const scaleFail = scaleChecks.length - scalePass;
totalFail += scaleFail;

console.log('\n══════════════ BW RESPONSIVE PROBE RESULTS ══════════════');
for (const r of results) {
  console.log(`\n[${r.viewport.name}  ${r.viewport.width}x${r.viewport.height}]`);
  console.log(`  frame bbox: ${r.frame ? `${r.frame.w.toFixed(1)}x${r.frame.h.toFixed(1)} @ (${r.frame.x.toFixed(1)}, ${r.frame.y.toFixed(1)})` : 'N/A'}`);
  console.log(`  host bbox:  ${r.host  ? `${r.host.w.toFixed(1)}x${r.host.h.toFixed(1)} @ (${r.host.x.toFixed(1)}, ${r.host.y.toFixed(1)})` : 'N/A'}`);
  console.log(`  CSS vars:   x=${r.hostCSSVars?.x}, y=${r.hostCSSVars?.y}, w=${r.hostCSSVars?.w}, h=${r.hostCSSVars?.h}`);
  console.log(`  banner tier ${r.activeTier} font-size: ${r.bannerFontPx?.toFixed(2)} px (expected ≈ ${expectedForTier(r.activeTier, r.frame?.w)?.toFixed(2)})`);
  console.log(`  checks: ${r.pass}/${r.checks.length} pass`);
  for (const [label, ok] of r.checks) if (!ok) console.log(`    ✗ ${label}`);
  if (r.errors.length) {
    console.log(`  ERRORS:`);
    r.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
  }
}
console.log('\n[cross-viewport scale]');
for (const [label, ok] of scaleChecks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);

console.log(`\nTOTAL FAIL: ${totalFail}`);
process.exit(totalFail === 0 ? 0 : 1);
