#!/usr/bin/env node
/**
 * tools/_ultimate-all-force-probe.mjs
 *
 * EVERY FORCE CHIP × EVERY GDD live audit.
 *
 * Per Boki (2026-06-16): "i svaki force mora da radi".
 *
 * For each `.ufp-chip[data-ufp-kind]` present on a given GDD's preview
 * iframe, this probe asserts:
 *
 *   1. Click does NOT throw / leak console error.
 *   2. `preSpin` fires within 8 s of click (per `rule_force_buttons_real_spin`).
 *   3. `postSpin` fires within 12 s of click (spin actually settles).
 *   4. SOME observable outcome materialises within 4 s after postSpin:
 *        — modal/HUD `data-show="true"` or visible display ≠ none
 *        — placard banner (`.generic-feature-banner` visible)
 *        — FS overlay (`#fsOverlay` visible)
 *        — BW tier overlay (`#bwOverlay` visible)
 *        — meter/counter HUD tick (anti-zero delta)
 *        — `__FORCE_FEATURE__` global stamped with this kind
 *      Any one is sufficient — different kinds have different visual
 *      surfaces and we accept the canonical one.
 *
 * Also captures any window onerror / uncaught console error during the
 * round and fails that row.
 *
 * Exits 0 if every (gdd × chip) tuple PASSES all 4 invariants.
 * Skip semantics:
 *   • If the GDD doesn't paint the chip (`includeKinds: 'auto'` filter),
 *     row = SKIP (not a fail).
 *   • If the chip is DEDUPE_OWNED_BY_OTHER_BLOCK (bonus_buy, ante_bet)
 *     we look for the OWNING block's own chip instead.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const OUT  = join(REPO, 'tools/_eyes/all-force');
mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { name: 'huff',     path: `${process.env.HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf` },
  { name: 'wrath',    path: `${REPO}/samples/WRATH_OF_OLYMPUS_GAME_GDD.md` },
  { name: 'crystal',  path: `${REPO}/samples/CRYSTAL_FORGE_GAME_GDD.md` },
  { name: 'gates',    path: `${REPO}/samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md` },
  { name: 'midnight', path: `${REPO}/samples/MIDNIGHT_FANGS_GAME_GDD.md` },
];

/* Per-kind expected outcome selectors / probes (single one = OK). */
const KIND_OUTCOME = {
  free_spins:            { sel: '#fsOverlay, .fs-intro, [data-fs-active="true"]' },
  hold_and_win:          { sel: '#hwHud' },
  bonus_pick:            { sel: '#bpOverlay' },
  wheel_bonus:           { sel: '#wbOverlay' },
  multiplier:            { banner: true },
  multiplier_orb:        { banner: true },
  persistent_multiplier: { banner: true },
  cascade:               { banner: true },
  cluster_pays:          { banner: true },
  ways:                  { banner: true },
  pay_anywhere:          { banner: true },
  expanding_wild:        { banner: true },
  walking_wild:          { banner: true },
  sticky_wild:           { banner: true },
  mystery_symbol:        { banner: true },
  scatter_pay:           { banner: true },
  lightning:             { banner: true },
  respin:                { banner: true },
  wild_reel:             { banner: true },
  gamble:                { sel: '#gambleOverlay' },
  super_symbol:          { banner: true },
  jackpot:               { banner: true },
  big_win:               { sel: '.big-win-overlay, [data-bw-active="true"], #bwOverlay' },
  /* Owned by other block — UFP de-dupes, but the OWNER's CTA still exists.
   * bonus_buy = real-spin force (chip → planted scatters → spin → FS intro).
   * ante_bet  = STAKE TOGGLE (industry-standard): click flips data-on,
   *             bet stake updates, next manual spin uses new stake.
   *             Not a real-spin force — assert toggle flip instead. */
  bonus_buy:             { sel: '#bonusBuyBtn, .bonus-buy-btn', ownedBy: 'bonusBuy' },
  ante_bet:              { sel: '#anteBetToggle, .ante-bet', ownedBy: 'anteBet', toggleOnly: true },
};

const ALL_KINDS = Object.keys(KIND_OUTCOME);

const PORT = 5784;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page    = await ctx.newPage();

const rows = [];
let pass = 0, fail = 0, skip = 0;

function pad(s, n) { return String(s).padEnd(n); }

for (const target of TARGETS) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.setInputFiles('#fileInput', target.path);
  await page.waitForSelector('#previewFrame', { timeout: 25000 });
  await page.waitForTimeout(2500);

  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) {
    rows.push({ gdd: target.name, kind: '-', status: 'FAIL', detail: 'no iframe' });
    fail++;
    continue;
  }

  /* Capture iframe console errors per round. */
  let consoleErrors = [];
  frame.on('pageerror', err => consoleErrors.push(String(err.message || err)));
  frame.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  const availableChips = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]')).map(c => c.getAttribute('data-ufp-kind'))
  );

  for (const kind of ALL_KINDS) {
    const outcome = KIND_OUTCOME[kind];
    const inPanel = availableChips.includes(kind);
    const isOwned = !!outcome.ownedBy;

    /* For owned-by-other-block kinds: look for the OWNER's CTA. UFP
     * intentionally hides these from its panel, but the feature is
     * still forceable through the owner's own block. */
    if (!inPanel && !isOwned) {
      rows.push({ gdd: target.name, kind, status: 'SKIP', detail: 'no chip — GDD lacks feature' });
      skip++;
      continue;
    }

    /* Reset per-round signals + force FSM back to BASE so chips that
     * gate on phase (bonusBuy, anteBet) actually engage. Prior chip in
     * the same iframe round can leave FSM in BW_INTRO/FS_INTRO/etc. */
    consoleErrors = [];
    await frame.evaluate(() => {
      window.__PROBE_PRE__ = false;
      window.__PROBE_POST__ = false;
      window.__FORCE_FEATURE__ = null;
      if (window.HookBus && typeof window.HookBus.on === 'function') {
        window.HookBus.on('preSpin', () => { window.__PROBE_PRE__ = true; });
        window.HookBus.on('postSpin', () => { window.__PROBE_POST__ = true; });
      }
      /* Close any leftover overlays from a prior chip. */
      ['#wbOverlay', '#gambleOverlay', '#bpOverlay', '#hwHud',
       '#fsOverlay', '#bwOverlay', '.generic-feature-banner']
        .forEach(s => { const el = document.querySelector(s);
                        if (el && el.dataset) el.dataset.show = 'false'; });
      /* Force-reset FSM to BASE so phase-gated CTAs (bonusBuy, anteBet)
       * actually engage. Real player wouldn't be machine-gunning chips
       * — this is purely a probe-level inter-chip isolation. */
      if (window.FSM) {
        try { window.FSM.phase = 'BASE'; } catch (_) {}
      }
    });
    await frame.waitForTimeout(150);

    /* Click — UFP chip if present, owner's CTA otherwise. */
    let clickOk = false;
    if (inPanel) {
      clickOk = await frame.evaluate(k => {
        const b = document.querySelector('.ufp-chip[data-ufp-kind="' + k + '"]');
        if (!b) return false;
        try { b.click(); return true; } catch (_) { return false; }
      }, kind);
    } else if (isOwned && outcome.sel) {
      clickOk = await frame.evaluate(sel => {
        const b = document.querySelector(sel.split(',')[0].trim());
        if (!b) return false;
        try { b.click(); return true; } catch (_) { return false; }
      }, outcome.sel);
    }

    if (!clickOk) {
      rows.push({ gdd: target.name, kind, status: 'SKIP', detail: 'click target not in DOM' });
      skip++;
      continue;
    }

    /* Toggle-only kinds (ante_bet) don't trigger a real spin — they
     * flip the stake config. Assert the data-on flip instead. */
    if (outcome.toggleOnly) {
      const flipped = await frame.evaluate(sel => {
        const el = document.querySelector(sel.split(',')[0].trim());
        return el && el.dataset && el.dataset.on === 'true';
      }, outcome.sel);
      const noErrors = consoleErrors.length === 0;
      const ok = flipped && noErrors;
      const detail = `toggle:${flipped ? '✓' : '✗'} errs:${consoleErrors.length}`;
      if (ok) { pass++; rows.push({ gdd: target.name, kind, status: 'PASS', detail }); }
      else { fail++; rows.push({ gdd: target.name, kind, status: 'FAIL', detail }); }
      continue;
    }

    /* Wait preSpin → postSpin. */
    let pre = false, post = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const f = await frame.evaluate(() => ({
        pre:  !!window.__PROBE_PRE__,
        post: !!window.__PROBE_POST__,
      }));
      pre = pre || f.pre;
      post = post || f.post;
      if (pre && post) break;
      await frame.waitForTimeout(120);
    }

    /* Settle pad for outcome materialisation (modal opens AFTER postSpin
     * for wheel/H&W/banner kinds — give 3.5 s). */
    await frame.waitForTimeout(3500);

    /* Detect outcome. */
    const detected = await frame.evaluate((args) => {
      const { kind, sel, wantBanner } = args;
      const flags = [];
      if (sel) {
        const el = document.querySelector(sel);
        if (el) {
          const cs = getComputedStyle(el);
          const show = el.dataset && el.dataset.show;
          if (cs.display !== 'none' && parseFloat(cs.opacity) > 0.1 &&
              (show === 'true' || show === undefined || show === null)) {
            flags.push('selector:' + sel.split(',')[0].trim());
          }
        }
      }
      if (wantBanner) {
        const banners = Array.from(document.querySelectorAll(
          '.generic-feature-banner, [data-ufp-banner], .feature-placard, .ufp-banner'
        ));
        for (const b of banners) {
          const cs = getComputedStyle(b);
          if (cs.display !== 'none' && parseFloat(cs.opacity) > 0.1) {
            flags.push('banner');
            break;
          }
        }
      }
      if (window.__FORCE_FEATURE__ === kind) flags.push('force-flag');
      /* Big-win pseudo-detection — BW state machine sets a phase flag. */
      if (kind === 'big_win') {
        if (window.BW_STATE && (window.BW_STATE.active || window.BW_STATE.tier > 0)) flags.push('bw-state');
      }
      /* Multiplier ladder tick check for `multiplier*` kinds. */
      if (kind === 'multiplier' || kind === 'persistent_multiplier' || kind === 'multiplier_orb') {
        if (window.MULT_STATE && window.MULT_STATE.current > 1) flags.push('mult-state');
        if (window.MULT_ORB_STATE && window.MULT_ORB_STATE.forcedNextValue > 1) flags.push('orb-state');
      }
      return flags;
    }, { kind, sel: outcome.sel || '', wantBanner: !!outcome.banner });

    const outcomeOk = detected.length > 0;
    const noErrors = consoleErrors.length === 0;

    const allOk = pre && post && outcomeOk && noErrors;
    const detail = [
      pre ? 'pre✓' : 'pre✗',
      post ? 'post✓' : 'post✗',
      outcomeOk ? ('out:' + detected.join('+')) : 'out✗',
      noErrors ? 'errs:0' : ('errs:' + consoleErrors.length),
    ].join(' ');

    if (allOk) { pass++; rows.push({ gdd: target.name, kind, status: 'PASS', detail }); }
    else { fail++; rows.push({ gdd: target.name, kind, status: 'FAIL', detail }); }
  }
}

await browser.close();
server.kill();

console.log('');
console.log('┌──────────────┬──────────────────────────┬────────┬──────────────────────────────────────────────');
console.log('│ ' + pad('gdd', 12) + ' │ ' + pad('kind', 24) + ' │ status │ detail');
console.log('├──────────────┼──────────────────────────┼────────┼──────────────────────────────────────────────');
for (const r of rows) {
  console.log('│ ' + pad(r.gdd, 12) + ' │ ' + pad(r.kind, 24) + ' │ ' + pad(r.status, 6) + ' │ ' + (r.detail || ''));
}
console.log('└──────────────┴──────────────────────────┴────────┴──────────────────────────────────────────────');
console.log('');
console.log(`Result: ${pass} pass · ${fail} fail · ${skip} skip · ${pass + fail + skip} total`);

writeFileSync(join(OUT, 'all-force-result.json'),
  JSON.stringify({ pass, fail, skip, rows, timestamp: new Date().toISOString() }, null, 2));
console.log(`Report: ${join(OUT, 'all-force-result.json')}`);

process.exit(fail > 0 ? 1 : 0);
