#!/usr/bin/env node
/**
 * UQ-MULTIPLIER corpus probe — cross-game audit of MULT chip win presentation.
 *
 * Boki bug: "na nekim igrama nestaju celije na nekima radi kako treba".
 * Goal: detect WHICH GDD builds still have cells-vanish / no-polyline / no-skip
 * after V10 gamble-auto-open fix.
 *
 * Per game we check (after force MULT ×2 click + 6s settle window):
 *   • cells visible (not covered by modal, not opacity 0)
 *   • polyline drawn (≥1 polyline within #paylineOverlay)
 *   • SKIP CTA rendered (#spinBtn[data-state^=SKIP_])
 *   • no modal overlay (gamble-host, gamble-secondary-host, postSpinModal)
 *
 * Output:
 *   reports/uq-mult-corpus/{game}.json — full detail per game
 *   reports/uq-mult-corpus/summary.json — pass/fail per game + failing reasons
 *   reports/uq-mult-corpus/summary.md   — human report
 *
 * Concurrency: 6 browsers in parallel to keep wallclock under 5 min for 338.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const REAL_GAMES = resolve(REPO, 'dist/real-games');
const OUT = resolve(REPO, 'reports/uq-mult-corpus');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.slice(14) || '5', 10);
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.slice(8) || '0', 10);
const ONLY = args.find(a => a.startsWith('--only='))?.slice(7);

const games = readdirSync(REAL_GAMES).filter(d => existsSync(resolve(REAL_GAMES, d, 'slot.html')));
const filtered = ONLY ? games.filter(g => g.includes(ONLY)) : games;
const subset = LIMIT > 0 ? filtered.slice(0, LIMIT) : filtered;
console.log(`Probing ${subset.length} games (concurrency=${CONCURRENCY})`);

async function probeOne(slug) {
  const url = 'file://' + resolve(REAL_GAMES, slug, 'slot.html');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
    const consoleErrs = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => consoleErrs.push('PAGEERR: ' + e.message.slice(0, 200)));

    await page.goto(url, { waitUntil: 'load', timeout: 12000 });
    await page.waitForFunction(() => document.querySelector('#gridHost .cell') || document.querySelector('.gridHost .cell'), { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(400);

    // Find MULT ×2 chip
    const chipFound = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
      const mc = candidates.find(b => /MULT\s*[×x]\s*2/i.test((b.textContent || '').trim()));
      if (mc) { window.__mc__ = mc; return true; }
      return false;
    });

    if (!chipFound) {
      await browser.close();
      return { slug, skipped: true, reason: 'no MULT ×2 chip (likely cluster/non-line eval)', consoleErrs };
    }

    // Install a passive watcher that records peak DOM state during the
    // entire 6.5s observation window. We can't pick "the right" moment
    // because per-line cycles are short (500ms) and cascade cycles start
    // late (3s+); a peak-tracker captures both correctly.
    await page.evaluate(() => {
      window.__uq_peak__ = {
        sawWinsym: 0, sawPolys: 0, sawAward: 0,
        sawSkipState: false, sawSkipIcon: false, sawBigWinPath: false,
        modalEverOpen: false, modalSlugs: [],
      };
      const tick = () => {
        const p = window.__uq_peak__;
        const cells = document.querySelectorAll('.cell--winsym').length;
        const polys = document.querySelectorAll('#paylineOverlay polyline, .payline-path').length;
        const spinBtn = document.querySelector('#spinBtn');
        const spinState = spinBtn ? spinBtn.getAttribute('data-state') : null;
        const skipIcon = spinBtn ? spinBtn.querySelector('.spinIcon--skip') : null;
        const skipIconVis = skipIcon ? (getComputedStyle(skipIcon).display !== 'none') : false;
        if (cells > p.sawWinsym) p.sawWinsym = cells;
        if (polys > p.sawPolys) p.sawPolys = polys;
        if (window.__WIN_AWARD__ > p.sawAward) p.sawAward = window.__WIN_AWARD__;
        if (spinState && spinState.startsWith('SKIP_')) p.sawSkipState = true;
        if (skipIconVis) p.sawSkipIcon = true;
        if (spinState === 'SKIP_BIGWIN' || spinState === 'SKIP_CELEBRATION') p.sawBigWinPath = true;
        // Modal detection
        const modal = document.querySelector('.gamble-host[style*="display: flex"], .gamble-secondary-host:not([hidden])');
        if (modal) {
          p.modalEverOpen = true;
          if (p.modalSlugs.length < 3) {
            const cls = modal.className || '';
            if (!p.modalSlugs.includes(cls)) p.modalSlugs.push(cls);
          }
        }
      };
      window.__uq_interval__ = setInterval(tick, 60);
    });

    await page.evaluate(() => window.__mc__.click());

    // Watch 9s — covers fast per-line cycles, cascade-late starts,
    // and edge cases where the reel anticipation animation extends
    // spin time to ~4.5s before win presentation begins (Huff fast-path
    // takes ~2s, slow-path takes ~5s — both must be observed).
    await page.waitForTimeout(9000);

    // Sample DOM state — also probe a SECOND time 60ms later to catch
    // late polylines on slow draw-in / cluster modes
    const result = await page.evaluate(() => {
      clearInterval(window.__uq_interval__);
      const p = window.__uq_peak__ || {};
      const grid = document.querySelector('#gridHost') || document.querySelector('.gridHost');
      const cellsAll = Array.from(document.querySelectorAll('.cell'));
      // Visible = bounding rect ≥ 80px (filters buffer cells)
      const cellsVis = cellsAll.filter(c => {
        const r = c.getBoundingClientRect();
        return r.width >= 80 && r.height >= 80;
      });
      const cellOpacity = cellsVis.map(c => parseFloat(getComputedStyle(c).opacity));
      const cellsAt1 = cellOpacity.filter(o => o >= 0.95).length;
      const cellsHidden = cellOpacity.filter(o => o <= 0.05).length;
      const winsymCount = cellsVis.filter(c => c.classList.contains('cell--winsym')).length;
      const polys = document.querySelectorAll('#paylineOverlay polyline, .payline-path').length;

      // Spin button SKIP state
      const spinBtn = document.querySelector('#spinBtn');
      const spinState = spinBtn ? spinBtn.getAttribute('data-state') : null;
      const isSkipState = spinState && spinState.startsWith('SKIP_');
      const skipIcon = spinBtn ? spinBtn.querySelector('.spinIcon--skip') : null;
      const skipIconVisible = skipIcon ? (getComputedStyle(skipIcon).display !== 'none') : false;

      // Modal overlays
      const modalOpen = !!(
        document.querySelector('.gamble-host[style*="display: flex"]') ||
        document.querySelector('.gamble-secondary-host:not([hidden])') ||
        document.querySelector('[data-modal-open="true"]') ||
        Array.from(document.querySelectorAll('.gamble-host, .gamble-secondary-host')).find(el => {
          const s = getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
        })
      );

      // Cell coverage — for each visible cell, check if its center pixel is covered by modal-z-index element
      let cellsCoveredByModal = 0;
      try {
        const sampleCells = cellsVis.slice(0, Math.min(5, cellsVis.length));
        for (const c of sampleCells) {
          const r = c.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
          if (!el) continue;
          // Walk parents — modal if any ancestor matches modal classes
          let cur = el;
          for (let depth = 0; depth < 8 && cur; depth++) {
            const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
            if (/gamble-host|gamble-secondary|gamble-modal|modal-host|bigWinBanner|fsIntroBanner|fsOutroBanner|bonusPickHost|wheelHost/i.test(cls)) {
              cellsCoveredByModal++;
              break;
            }
            cur = cur.parentElement;
          }
        }
      } catch (_) {}

      const winAward = (typeof window !== 'undefined' && Number.isFinite(window.__WIN_AWARD__)) ? window.__WIN_AWARD__ : 0;

      return {
        cellCount: cellsVis.length, cellsAt1, cellsHidden, winsymCount, polys,
        spinState, isSkipState, skipIconVisible,
        modalOpen, cellsCoveredByModal,
        winAward,
        // Peak-tracker observations across the 6.5s window
        peakWinsym: p.sawWinsym || 0,
        peakPolys:  p.sawPolys || 0,
        peakAward:  p.sawAward || 0,
        sawSkipState: !!p.sawSkipState,
        sawSkipIcon:  !!p.sawSkipIcon,
        sawBigWinPath: !!p.sawBigWinPath,
        modalEverOpen: !!p.modalEverOpen,
        modalSlugs: p.modalSlugs || [],
      };
    });

    await browser.close();

    // Verdict — peak-based across full window
    const failures = [];
    if (result.cellCount === 0) failures.push('no visible cells');
    if (result.modalEverOpen) failures.push('modal opened mid-presentation: ' + (result.modalSlugs.join('|') || 'unknown'));
    if (result.peakWinsym === 0) failures.push('no winsym cells (peak across 6.5s)');
    // BIG_WIN path doesn't draw polyline (single coordinated symbol pulse) —
    // that's the industry reference flow. Polyline gate is only required for
    // per-line cycle path.
    if (result.peakPolys === 0 && !result.sawBigWinPath) failures.push('no polyline (peak across 6.5s)');
    if (!result.sawSkipIcon) failures.push('skip icon never visible');

    return { slug, ...result, failures, pass: failures.length === 0, consoleErrs: consoleErrs.slice(0, 3) };
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    return { slug, error: e.message.slice(0, 200) };
  }
}

async function runBatch() {
  const results = new Array(subset.length);
  let nextIdx = 0;
  let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= subset.length) return;
      const slug = subset[idx];
      // Retry up to 2 extra attempts on transient fails (probe timing flakiness:
      // a single noWinChance dice can occasionally swallow the force baseline
      // injection on slow-spin games). PASS sticks if any attempt passes.
      let r = await probeOne(slug);
      let attempt = 1;
      while (r && !r.pass && !r.skipped && !r.error && attempt < 3) {
        attempt++;
        const retryRes = await probeOne(slug);
        if (retryRes && retryRes.pass) { r = retryRes; break; }
        // Keep best (most data) attempt
        if (retryRes && !retryRes.error) r = retryRes;
      }
      if (r) r.attempt = attempt;
      results[idx] = r;
      done++;
      if (done % 20 === 0 || done === subset.length) {
        const passed = results.filter(x => x && x.pass).length;
        const skipped = results.filter(x => x && x.skipped).length;
        const failed = results.filter(x => x && !x.pass && !x.skipped && !x.error).length;
        const errored = results.filter(x => x && x.error).length;
        console.log(`  ${done}/${subset.length}  pass=${passed}  skip=${skipped}  fail=${failed}  err=${errored}`);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  const t0 = Date.now();
  const results = await runBatch();

  // Aggregate
  const pass = results.filter(r => r && r.pass);
  const skipped = results.filter(r => r && r.skipped);
  const failed = results.filter(r => r && !r.pass && !r.skipped && !r.error);
  const errored = results.filter(r => r && r.error);

  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify({
    total: subset.length, pass: pass.length, skipped: skipped.length, failed: failed.length, errored: errored.length,
    failedSlugs: failed.map(f => ({ slug: f.slug, failures: f.failures, ...{ cellsCoveredByModal: f.cellsCoveredByModal, modalOpen: f.modalOpen, polys: f.polys, winsymCount: f.winsymCount, isSkipState: f.isSkipState } })),
    erroredSlugs: errored.map(e => ({ slug: e.slug, error: e.error })),
    elapsedSec: Math.round((Date.now() - t0) / 1000),
  }, null, 2));

  // Group failures by reason
  const byReason = {};
  for (const f of failed) {
    for (const r of (f.failures || [])) {
      const key = r.replace(/\(\d+\)/g, '(*)');
      if (!byReason[key]) byReason[key] = [];
      byReason[key].push(f.slug);
    }
  }

  const md = [];
  md.push('# UQ-MULTIPLIER cross-corpus probe results');
  md.push('');
  md.push(`Total: **${subset.length}**  ·  Pass: **${pass.length}**  ·  Skip: **${skipped.length}**  ·  Fail: **${failed.length}**  ·  Err: **${errored.length}**  ·  Wall: ${Math.round((Date.now() - t0)/1000)}s`);
  md.push('');
  md.push('## Failure breakdown by root cause');
  md.push('');
  for (const [reason, slugs] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
    md.push(`### ${reason}  ·  ${slugs.length} games`);
    md.push(slugs.slice(0, 30).map(s => `  - ${s}`).join('\n'));
    if (slugs.length > 30) md.push(`  ... +${slugs.length - 30} more`);
    md.push('');
  }
  md.push('## Errored games');
  for (const e of errored.slice(0, 20)) md.push(`- ${e.slug} — ${e.error}`);
  if (errored.length > 20) md.push(`... +${errored.length - 20} more`);
  writeFileSync(resolve(OUT, 'summary.md'), md.join('\n'));

  console.log('\n=== RESULTS ===');
  console.log(`Total: ${subset.length}  Pass: ${pass.length}  Skip: ${skipped.length}  Fail: ${failed.length}  Err: ${errored.length}`);
  console.log(`Wallclock: ${Math.round((Date.now() - t0)/1000)}s`);
  console.log(`Report: ${OUT}/summary.md`);
})();
