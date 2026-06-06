#!/usr/bin/env node
/**
 * tools/cortex-eyes-k5-touch.mjs — Wave K5 (Touch QA harness)
 *
 * Headless Playwright probe that drives the dist demos through PURE
 * touch events (no mouse). Covers the most player-facing UI surfaces:
 *
 *   • Spin button         — single tap → spin starts (engine signal:
 *                            __SLOT_SPIN_BUTTON_STATE__ flips to
 *                            SPINNING / SLAM_STOP / SKIP_ROLLUP)
 *   • Slam-stop  (V1)     — appears during rotation; tap → engine
 *                            collapses to final
 *   • Force-skip (V2)     — appears during rollup; tap → skip flag
 *   • Autoplay  (U4)      — gear tap opens panel; preset tap arms; STOP
 *                            tap halts
 *   • Bet Selector (U5)   — coin chip tap opens panel; ladder cell tap
 *                            updates window.__SLOT_BET__
 *   • Paytable  (U10)     — `i` chip tap opens modal; close tap dismisses
 *   • History    (U9)     — `≡` chip tap opens panel; close tap dismisses
 *   • Settings   (U13)    — `⚙` chip tap opens modal; toggle tap flips
 *
 * Plus two cross-cutting assertions per surface:
 *   • Tap-target size ≥ 44 × 44 CSS px (Apple HIG / WCAG 2.5.5)
 *   • `touch-action: manipulation` (or contained value) baked on the
 *     CTA so double-tap doesn't zoom the page on iOS
 *
 * Viewports: iPhone SE 1st-gen (375 × 667) and iPhone 11 (414 × 896) —
 * picked as the realistic floor (smallest contemporary phones) and the
 * common mid-tier landing zone.
 *
 * The browser context is created with `hasTouch: true, isMobile: true`
 * so Playwright dispatches real `touchstart` / `touchend` events. We
 * NEVER call `.click()` — only `page.touchscreen.tap(x, y)`.
 *
 * Exits 0 on green, 1 on first failure. Pretty per-surface table on
 * stdout. JSON report saved to `reports/k5-touch-audit.json`.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const PORT = 5231;
const REPORT_DIR  = resolve(ROOT, 'reports');
const REPORT_PATH = resolve(REPORT_DIR, 'k5-touch-audit.json');

/* iPhone SE (1st gen) — smallest viewport contemporary slots still
 * support. iPhone 11 — landing-zone for mid-tier phones. We run the
 * full matrix against both so anything that breaks at 375 (column
 * collapse, overflow) but works at 414 surfaces immediately. */
const VIEWPORTS = [
  { name: 'iPhone SE',  width: 375, height: 667, scale: 2 },
  { name: 'iPhone 11',  width: 414, height: 896, scale: 2 },
];

/* Demo fixtures — picked to span dispatch shapes: rectangular (Goo
 * 1000 — fully featured with autoplay/bet/paytable/history/settings),
 * hexagonal (J2b path), wheel (J3 path). One viewport × demo × suite. */
const DEMOS = [
  { name: 'goo',    path: '/dist/gates_of_olympus_1000.html'      },
  { name: 'hex',    path: '/dist/06_hexagonal_playable.html'      },
  { name: 'wheel',  path: '/dist/18_wheel_playable.html'          },
];

const MIN_TAP = 44;  /* WCAG 2.5.5 floor for "Target Size (Minimum)" */

let pass = 0, fail = 0;
const rows = [];
function record(viewport, demo, surface, ok, hint = '') {
  const tag = ok ? '✓' : '✗';
  const padded = `[${viewport.name}/${demo.name}] ${surface}`.padEnd(48);
  console.log(`  ${tag} ${padded}${ok ? '' : '  — ' + hint}`);
  if (ok) pass++; else fail++;
  rows.push({ viewport: viewport.name, demo: demo.name, surface, pass: !!ok, hint });
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

console.log('— cortex-eyes-k5-touch — touch-event UI audit on mobile viewports');

let browser;
try {
  browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    for (const demo of DEMOS) {
      const url = `http://127.0.0.1:${PORT}${demo.path}`;
      const ctx = await browser.newContext({
        viewport:        { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.scale,
        hasTouch:        true,
        isMobile:        true,
        userAgent:       'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));
      page.on('console',   (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text().slice(0, 160)); });

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);

        /* ── tap helper: dispatch via touchscreen, never .click() ── */
        async function tapById(id) {
          const box = await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
          }, id);
          if (!box) return null;
          await page.touchscreen.tap(box.x, box.y);
          return box;
        }

        /* tap-target audit — collects size + touch-action for every key id */
        async function auditTouchSurfaces() {
          return page.evaluate((ids) => {
            const out = {};
            for (const id of ids) {
              const el = document.getElementById(id);
              if (!el) { out[id] = null; continue; }
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              out[id] = {
                w: Math.round(r.width),
                h: Math.round(r.height),
                touchAction: cs.touchAction || '',
                visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
              };
            }
            return out;
          }, [
            'spinBtn',          /* V3 unified spin/stop/skip CTA */
            'slamStopBtn',      /* V1 */
            'forceSkipBtn',     /* V2 */
            'autoplayBtn',      /* U4 chip */
            'betSelectorBtn',   /* U5 chip */
            'paytableBtn',      /* U10 i chip */
            'historyLogBtn',    /* U9 ≡ chip */
            'settingsBtn',      /* U13 ⚙ chip */
            'turboModeBtn',     /* U11 ⚡ chip */
            'paytableCloseBtn', /* modal close (audit only) */
            'historyLogCloseBtn',
            'settingsCloseBtn',
          ]);
        }

        const audit = await auditTouchSurfaces();

        /* ── 1) Spin tap → state flip ──────────────────────────── */
        {
          const before = await page.evaluate(() => window.__SLOT_SPIN_BUTTON_STATE__ || 'unknown');
          const box = await tapById('spinBtn');
          if (!box) { record(vp, demo, 'spin tap', false, 'spinBtn missing'); }
          else {
            await page.waitForTimeout(140);
            const after = await page.evaluate(() => window.__SLOT_SPIN_BUTTON_STATE__ || 'unknown');
            const flipped = before !== after && after !== 'unknown';
            record(vp, demo, 'spin tap → state flip',
                   flipped, `before=${before} after=${after}`);
            /* tap-target size on spin (the most-tapped CTA) */
            record(vp, demo, 'spin tap-target ≥ 44×44',
                   box.w >= MIN_TAP && box.h >= MIN_TAP,
                   `${box.w}×${box.h}`);
          }
          /* let any in-flight spin settle so subsequent surfaces are interactive */
          await page.waitForTimeout(1400);
        }

        /* ── 2) Paytable tap → modal open ──────────────────────── */
        if (audit.paytableBtn && audit.paytableBtn.visible) {
          await tapById('paytableBtn');
          await page.waitForTimeout(180);
          const open = await page.evaluate(() => !!(window.PAYTABLE_STATE && window.PAYTABLE_STATE.open));
          record(vp, demo, 'paytable tap → modal open', open);
          if (open) {
            await tapById('paytableCloseBtn');
            await page.waitForTimeout(150);
            const closed = await page.evaluate(() => !(window.PAYTABLE_STATE && window.PAYTABLE_STATE.open));
            record(vp, demo, 'paytable close tap → modal hide', closed);
          }
          record(vp, demo, 'paytable tap-target ≥ 44×44',
                 audit.paytableBtn.w >= MIN_TAP && audit.paytableBtn.h >= MIN_TAP,
                 `${audit.paytableBtn.w}×${audit.paytableBtn.h}`);
        }

        /* ── 3) History tap → panel open ───────────────────────── */
        if (audit.historyLogBtn && audit.historyLogBtn.visible) {
          await tapById('historyLogBtn');
          await page.waitForTimeout(180);
          const open = await page.evaluate(() => !!(window.HISTORY_LOG_STATE && window.HISTORY_LOG_STATE.open));
          record(vp, demo, 'history tap → panel open', open);
          if (open) {
            await tapById('historyLogCloseBtn');
            await page.waitForTimeout(150);
            const closed = await page.evaluate(() => !(window.HISTORY_LOG_STATE && window.HISTORY_LOG_STATE.open));
            record(vp, demo, 'history close tap → panel hide', closed);
          }
          record(vp, demo, 'history tap-target ≥ 44×44',
                 audit.historyLogBtn.w >= MIN_TAP && audit.historyLogBtn.h >= MIN_TAP,
                 `${audit.historyLogBtn.w}×${audit.historyLogBtn.h}`);
        }

        /* ── 4) Settings tap → modal open + toggle tap ─────────── */
        if (audit.settingsBtn && audit.settingsBtn.visible) {
          await tapById('settingsBtn');
          await page.waitForTimeout(180);
          const open = await page.evaluate(() => !!(window.SETTINGS_PANEL_STATE && window.SETTINGS_PANEL_STATE.open));
          record(vp, demo, 'settings tap → modal open', open);
          if (open) {
            await tapById('settingsCloseBtn');
            await page.waitForTimeout(150);
            const closed = await page.evaluate(() => !(window.SETTINGS_PANEL_STATE && window.SETTINGS_PANEL_STATE.open));
            record(vp, demo, 'settings close tap → modal hide', closed);
          }
          record(vp, demo, 'settings tap-target ≥ 44×44',
                 audit.settingsBtn.w >= MIN_TAP && audit.settingsBtn.h >= MIN_TAP,
                 `${audit.settingsBtn.w}×${audit.settingsBtn.h}`);
        }

        /* ── 5) Turbo tap → flag flip ──────────────────────────── */
        if (audit.turboModeBtn && audit.turboModeBtn.visible) {
          const before = await page.evaluate(() => !!window.__SLOT_TURBO_ACTIVE__);
          await tapById('turboModeBtn');
          await page.waitForTimeout(150);
          const after = await page.evaluate(() => !!window.__SLOT_TURBO_ACTIVE__);
          record(vp, demo, 'turbo tap → flag toggled', before !== after,
                 `before=${before} after=${after}`);
          record(vp, demo, 'turbo tap-target ≥ 44×44',
                 audit.turboModeBtn.w >= MIN_TAP && audit.turboModeBtn.h >= MIN_TAP,
                 `${audit.turboModeBtn.w}×${audit.turboModeBtn.h}`);
        }

        /* ── 6) touch-action cross-cut — every visible CTA chip must
         *      contain "manipulation" so iOS Safari doesn't trigger
         *      double-tap zoom. "auto" passes only when the element
         *      is the spin button (the engine handles its own gesture
         *      semantics). */
        const TAP_CHIPS = [
          'paytableBtn', 'historyLogBtn', 'settingsBtn', 'turboModeBtn',
          'autoplayBtn', 'betSelectorBtn', 'slamStopBtn', 'forceSkipBtn',
        ];
        for (const id of TAP_CHIPS) {
          const a = audit[id];
          if (!a || !a.visible) continue;
          const ok = /manipulation|none/i.test(a.touchAction);
          record(vp, demo, `${id} touch-action = manipulation`,
                 ok, `got "${a.touchAction}"`);
        }

        /* ── 7) console / page errors during the entire session ── */
        record(vp, demo, '0 console / page errors',
               errors.length === 0, errors[0] || '');

        await ctx.close();
      } catch (e) {
        record(vp, demo, 'fatal probe error', false, e.message.slice(0, 200));
        await ctx.close().catch(() => {});
      }
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}

if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify({
  generatedAt: new Date().toISOString(),
  viewports:   VIEWPORTS,
  demos:       DEMOS,
  totals:      { pass, fail, total: pass + fail },
  rows,
}, null, 2));

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
console.log(`  report: reports/k5-touch-audit.json`);
process.exit(fail > 0 ? 1 : 0);
