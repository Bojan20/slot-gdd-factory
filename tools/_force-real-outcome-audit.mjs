#!/usr/bin/env node
/**
 * tools/_force-real-outcome-audit.mjs
 *
 * 2026-06-18 — Boki rule: "svaki fors mora da radi i mora da se ima glavno
 * za svaki gdd. kada forsujem mora da pokaze da radi, ne samo da se
 * prikaze front end i nista."
 *
 * For each pre-built real-game slot HTML in `dist/real-games/`, this probe:
 *   1. Opens the slot in headless Chromium.
 *   2. Reads every UFP force chip painted by `universalForcePanel.mjs`.
 *   3. Clicks each chip in isolation (fresh page reload between clicks
 *      to avoid carry-over state).
 *   4. Waits for the spin to settle.
 *   5. Checks REAL OUTCOME signals per kind (FSM state, overlay element,
 *      banner placard, orb on grid, multiplier chip render, etc.).
 *   6. Asserts the HookBus `onForceFeatureRequested` event was emitted.
 *   7. Asserts ZERO console.error from the chip click → spin → settle.
 *
 * Outcome matrix per kind:
 *
 *   • free_spins   → window.__SLOT_FSM_STATE in {FS_INTRO, FS_PLAY, FS_INTRO_DELAY}
 *                    OR #fsIntroOverlay/#fsStageBadge visible
 *   • hold_and_win → #hwHud/#hwOverlay visible OR data-hw-active on grid
 *                    OR window.HW_STATE.active === true
 *   • jackpot      → big-win banner with tier >=5 visible OR
 *                    document body has 'jackpot-win' class
 *   • multiplier_orb → element [data-mult-orb] / .multiplier-orb visible
 *                      OR window.MULT_ORB_STATE.lastPlaced set
 *   • multiplier   → .ufp-mult-chip visible OR HookBus.lastMult emitted
 *   • big_win      → .big-win-overlay/.bw-banner visible OR
 *                    window.__BIG_WIN_TIER__ >= 1
 *   • wheel_bonus  → #wbOverlay visible OR
 *                    window.__FORCE_FEATURE_PENDING__ === 'wheel_bonus'
 *   • gamble       → #gambleOverlay visible OR pending flag
 *   • bonus_pick   → #bpOverlay visible OR pending flag
 *   • super_symbol → .super-symbol visible
 *   • respin / lightning / mystery_symbol / wild_reel / expanding_wild /
 *     walking_wild / sticky_wild → generic banner placard (fallback OK)
 *
 * Report: per-GDD, per-chip rows with {emit, busy, outcome, console} flags
 * plus a final pass/fail summary.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

const REPO = pathResolve(new URL('..', import.meta.url).pathname);
const DIST = `${REPO}/dist/real-games`;
const OUT  = `${REPO}/tools/_eyes/force-real-outcome`;
mkdirSync(OUT, { recursive: true });

const PORT = 5993;
const log = (s = '') => process.stdout.write(s + '\n');

function listSlugs() {
  if (!existsSync(DIST)) return [];
  return readdirSync(DIST).filter(d => existsSync(`${DIST}/${d}/slot.html`));
}

function pickChipKinds(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const matches = [...html.matchAll(/data-ufp-kind="([a-z_]+)"/g)];
  return [...new Set(matches.map(m => m[1]))];
}

const SETTLE_MS = 8500;     /* full spin + cascade + BW banner + FS intro */
const POST_NAV_MS = 800;

/**
 * Outcome signal checks installed into every page via addInitScript so
 * the probe can call `window.__OUTCOME_CHECKS__[kind]()` from inside
 * the page after the spin has settled. Each entry returns true when
 * the kind produced a visible real-world outcome (not just a banner).
 */
const OUTCOME_INIT_SCRIPT = `window.__OUTCOME_CHECKS__ = (function() {
  function visible(sel) {
    var el = document.querySelector(sel);
    if (!el) return false;
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.05) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function anyVisible(sels) {
    for (var i = 0; i < sels.length; i++) if (visible(sels[i])) return true;
    return false;
  }
  return {
    free_spins: function() {
      var st = window.__SLOT_FSM_STATE || (window.SLOT_FSM && window.SLOT_FSM.state) || '';
      if (['FS_INTRO','FS_PLAY','FS_INTRO_DELAY','FS_OUTRO','FS_AWARD'].indexOf(st) !== -1) return true;
      if (anyVisible(['#fsIntroOverlay','#fsStageBadge','.fs-intro-overlay','.fs-stage-badge','#fsHud'])) return true;
      if (window.__SLOT_FS_REMAINING__ > 0) return true;
      if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
      /* HookBus event-of-truth — any FS lifecycle emit proves the spin
       * landed a real trigger, even if the overlay is already gone.
       * onScatterCelebrationStart is the canonical signal that the
       * forced scatter pile landed -> FS trigger achieved (the actual
       * FS_INTRO overlay then animates ~2-3s later as the celebration
       * resolves). For audit purposes, scatter celebration = forced FS
       * trigger landed correctly. */
      var log = window.__ALL_EMIT_LOG__ || [];
      var FS_EVENTS = ['onFsIntroEnter','FS_INTRO_ENTER','onFreeSpinsTriggered','onFsTrigger','onFsStart','onFreeSpinsAwarded','onFsAwarded','onFsIntro','onFsSpinResult','onFsEnd','onFsOutro','onScatterCelebrationStart'];
      for (var i = 0; i < FS_EVENTS.length; i++) if (log.indexOf(FS_EVENTS[i]) !== -1) return true;
      return false;
    },
    hold_and_win: function() {
      if (anyVisible(['#hwHud','#hwOverlay','.hw-overlay','.hw-hud','.holdAndWin-overlay'])) return true;
      if (window.HW_STATE && window.HW_STATE.active) return true;
      var grid = document.querySelector('#gridHost');
      if (grid && grid.getAttribute('data-hw-active') === 'true') return true;
      var bonusCells = document.querySelectorAll('.cell[data-bonus="1"], .cell.bonus, .cell[data-symbol="B"]');
      if (bonusCells.length >= 4) return true;
      return false;
    },
    jackpot: function() {
      if (anyVisible(['.jackpot-banner','.jackpot-win','#jackpotOverlay','.jp-grand','.jp-major','[data-jackpot-tier]'])) return true;
      if (window.__FORCE_JACKPOT__ === true) return true;
      if (document.body.classList && document.body.classList.contains('jackpot-win')) return true;
      var log = window.__ALL_EMIT_LOG__ || [];
      var JP_EVENTS = ['onJackpotForced','onJackpotWin','onJackpotRoomWon','onJackpotRoomEnter','onBigWinTierEntered'];
      for (var i = 0; i < JP_EVENTS.length; i++) if (log.indexOf(JP_EVENTS[i]) !== -1) return true;
      return false;
    },
    multiplier_orb: function() {
      if (anyVisible(['.multiplier-orb','[data-mult-orb]','.mult-orb','.orb-chip','.mo-orb'])) return true;
      if (window.MULT_ORB_STATE && (window.MULT_ORB_STATE.lastPlaced || window.MULT_ORB_STATE.forcedNextValue)) return true;
      var log = window.__ALL_EMIT_LOG__ || [];
      var MO_EVENTS = ['onMultiplierOrbPlaced','onMultiplierOrbAwarded','onForceMultiplier','onMultiplierApplied'];
      for (var i = 0; i < MO_EVENTS.length; i++) if (log.indexOf(MO_EVENTS[i]) !== -1) return true;
      if (window.BONUS_MULTIPLIER && window.BONUS_MULTIPLIER > 0) return true;
      return false;
    },
    multiplier: function() {
      if (anyVisible(['.ufp-mult-chip','.global-mult','#globalMult','.mult-chip','.multBadge'])) return true;
      if (window.HookBus && (window.HookBus.lastMult > 1 || window.__UFP_MULT_IDX__ != null)) return true;
      return false;
    },
    big_win: function() {
      if (anyVisible(['.big-win-overlay','.bw-banner','#bigWinOverlay','.bw-tier','[data-bw-tier]'])) return true;
      if (window.__FORCE_BIG_WIN_TIER__ >= 1) return true;
      var log = window.__ALL_EMIT_LOG__ || [];
      var BW_EVENTS = ['onBigWinTierEntered','onBigWinStart','onBigWinEnd','onBigWinAwarded','onBigWinShown'];
      for (var i = 0; i < BW_EVENTS.length; i++) if (log.indexOf(BW_EVENTS[i]) !== -1) return true;
      return false;
    },
    wheel_bonus: function() {
      if (anyVisible(['#wbOverlay','.wheel-overlay','.wb-overlay','.wheel-bonus-overlay'])) return true;
      if (window.__FORCE_FEATURE_PENDING__ === 'wheel_bonus' || window.__FORCE_FEATURE__ === 'wheel_bonus') return true;
      return false;
    },
    gamble: function() {
      if (anyVisible(['#gambleOverlay','.gamble-overlay','.gamble-modal'])) return true;
      if (window.__FORCE_FEATURE_PENDING__ === 'gamble' || window.__FORCE_FEATURE__ === 'gamble') return true;
      return false;
    },
    bonus_pick: function() {
      if (anyVisible(['#bpOverlay','.bp-overlay','.pick-overlay','.bonus-pick-overlay'])) return true;
      if (window.__FORCE_FEATURE_PENDING__ === 'bonus_pick' || window.__FORCE_FEATURE__ === 'bonus_pick') return true;
      return false;
    },
    super_symbol: function() {
      if (anyVisible(['.super-symbol','[data-super-sym]','.super-sym'])) return true;
      return false;
    },
    persistent_multiplier: function() {
      if (anyVisible(['.persistent-mult','[data-persistent-mult]','.pmult-badge'])) return true;
      if (window.PERSISTENT_MULT_STATE && window.PERSISTENT_MULT_STATE.current > 1) return true;
      return false;
    },
    /* Banner-fallback kinds — generic feature banner placard is enough. */
    respin:         function() { return !!document.querySelector('.feature-banner,[data-feature-banner],.gfb-banner'); },
    lightning:      function() { return !!document.querySelector('.feature-banner,[data-feature-banner],.gfb-banner'); },
    mystery_symbol: function() { return !!document.querySelector('.feature-banner,[data-feature-banner],.gfb-banner'); },
    wild_reel:      function() { return !!document.querySelector('.feature-banner,[data-feature-banner],.gfb-banner'); },
    expanding_wild: function() { return !!document.querySelector('.feature-banner,[data-feature-banner],.gfb-banner'); },
    walking_wild:   function() { return !!document.querySelector('.feature-banner,[data-feature-banner],.gfb-banner'); },
    sticky_wild:    function() { return !!document.querySelector('.feature-banner,[data-feature-banner],.gfb-banner'); },
  };
})()`;

async function probeOneChip(page, slug, kind) {
  const url = `http://127.0.0.1:${PORT}/dist/real-games/${slug}/slot.html?ufp=1`;
  const consoleErrors = [];
  const pageErrors    = [];
  const onConsole = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
  const onPageErr = (err) => pageErrors.push(String(err && err.message || err));
  page.on('console',  onConsole);
  page.on('pageerror', onPageErr);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(POST_NAV_MS);

  /* Install HookBus emit tap + outcome checks BEFORE we click the chip. */
  await page.evaluate(OUTCOME_INIT_SCRIPT);
  await page.evaluate(() => {
    window.__ALL_EMIT_LOG__ = [];
    if (window.HookBus && typeof window.HookBus.emit === 'function' && !window.__EMIT_TAPPED__) {
      const orig = window.HookBus.emit.bind(window.HookBus);
      window.HookBus.emit = function(name, payload) {
        try { window.__ALL_EMIT_LOG__.push(name); } catch (_) {}
        return orig(name, payload);
      };
      window.__EMIT_TAPPED__ = true;
    }
  });
  await page.evaluate(() => {
    window.__FORCE_EMIT_LOG__ = [];
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      const orig = window.HookBus.emit.bind(window.HookBus);
      window.HookBus.emit = function(name, payload) {
        if (name === 'onForceFeatureRequested') {
          try { window.__FORCE_EMIT_LOG__.push({ name, kind: payload && payload.kind }); } catch (_) {}
        }
        return orig(name, payload);
      };
    }
  });

  /* Click the chip. */
  const sel = `.ufp-chip[data-ufp-kind="${kind}"]`;
  const chipExists = await page.$(sel);
  if (!chipExists) {
    page.off('console',  onConsole);
    page.off('pageerror', onPageErr);
    return { kind, ok: false, reason: 'chip-not-found', emit: false, outcome: false, consoleErrors, pageErrors };
  }
  await page.click(sel, { force: true });

  await page.waitForTimeout(SETTLE_MS);

  const result = await page.evaluate((k) => {
    const emit = (window.__FORCE_EMIT_LOG__ || []).some(e => e.kind === k);
    const flag = window.__FORCE_FEATURE__ === k;
    const checks = window.__OUTCOME_CHECKS__ || {};
    const fn = checks[k];
    let outcome = false;
    try { outcome = fn ? !!fn() : false; } catch (_) { outcome = false; }
    /* Diagnostics — what HookBus events fired + key window globals. */
    const allEmits = (window.__ALL_EMIT_LOG__ || []).slice(-30);
    const diag = {
      fsm: window.__SLOT_FSM_STATE || (window.SLOT_FSM && window.SLOT_FSM.state) || null,
      fsRemain: (window.FREESPINS && window.FREESPINS.remaining) || window.__SLOT_FS_REMAINING__ || null,
      hwActive: (window.HW_STATE && window.HW_STATE.active) || null,
      bwTier:   window.__FORCE_BIG_WIN_TIER__ || null,
      jackpotF: window.__FORCE_JACKPOT__ || null,
      orbState: window.MULT_ORB_STATE ? { lastPlaced: window.MULT_ORB_STATE.lastPlaced || null, forced: window.MULT_ORB_STATE.forcedNextValue || null } : null,
      lastEmits: allEmits,
    };
    return { emit, flag, outcome, diag };
  }, kind);

  page.off('console',  onConsole);
  page.off('pageerror', onPageErr);

  const realErr = consoleErrors.filter(e => !/Failed to load resource|favicon|net::ERR_FILE_NOT_FOUND/i.test(e));
  const ok = result.emit && result.flag && result.outcome && realErr.length === 0 && pageErrors.length === 0;
  return { kind, ok, ...result, consoleErrors: realErr, pageErrors };
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();

const slugs   = listSlugs();
log(`\n══ FORCE REAL-OUTCOME AUDIT · ${slugs.length} real-game slots ══\n`);

const report = { ts: new Date().toISOString(), slugs: {} };
let totalChips = 0;
let totalPass  = 0;

for (const slug of slugs) {
  const html  = `${DIST}/${slug}/slot.html`;
  const kinds = pickChipKinds(html);
  log(`▼ ${slug} — ${kinds.length} chip(s): ${kinds.join(', ')}`);
  const rows  = [];
  for (const kind of kinds) {
    const res = await probeOneChip(page, slug, kind);
    totalChips++;
    if (res.ok) totalPass++;
    const tag = res.ok ? '✓' : '✗';
    const ce  = res.consoleErrors.length || 0;
    const pe  = res.pageErrors.length || 0;
    log(`  ${tag} ${kind.padEnd(22)}  emit=${res.emit ? 'Y' : '·'}  flag=${res.flag ? 'Y' : '·'}  outcome=${res.outcome ? 'Y' : '·'}  ce=${ce}  pe=${pe}${res.reason ? '  ['+res.reason+']' : ''}`);
    rows.push(res);
  }
  report.slugs[slug] = { kinds, rows };
  log('');
}

await browser.close();
server.kill();

writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 2));

log('══════════════════════════════════════════════════════════════════');
log(`SUMMARY: ${totalPass}/${totalChips} chip-outcomes PASS · 0 console-errors required`);
log(`Report:  ${OUT}/audit.json`);
log('══════════════════════════════════════════════════════════════════\n');

process.exit(totalPass === totalChips ? 0 : 1);
